const MS_JE_MINUTE = 60000;
const BEZEICHNER = /^[a-z_][a-z0-9_]{0,62}$/;
const JUENGSTER_EINTRAG_SQL = [
  "SELECT greatest(",
  "(SELECT max(at) FROM audit_log),",
  "(SELECT max(created_at) FROM session),",
  "(SELECT max(created_at) FROM tenant),",
  "(SELECT max(created_at) FROM account),",
  "(SELECT max(at) FROM cookie_consent_log)",
  ") AS juengster",
].join(" ");
const MENGEN_SQL =
  "SELECT (SELECT count(*) FROM tenant) AS mandanten, (SELECT count(*) FROM account) AS konten";

function schemaWerkzeug() {
  return import("../../scripts/lib/pg-schema-abgleich.mjs");
}

export async function erwartetesSchema() {
  const { expectedSchemaColumns } = await schemaWerkzeug();
  return expectedSchemaColumns();
}

async function zeitpunktEingehalten(client, zeitpunkt) {
  try {
    const { rows } = await client.query(JUENGSTER_EINTRAG_SQL);
    const juengster = rows[0]?.juengster ?? null;
    if (juengster === null) return { ok: true, abstandMinuten: null };
    const abstand = zeitpunkt - new Date(juengster).getTime();
    return { ok: abstand >= 0, abstandMinuten: Math.round(abstand / MS_JE_MINUTE) };
  } catch {
    return { ok: false, abstandMinuten: null };
  }
}

async function mengenLesen(client) {
  try {
    const { rows } = await client.query(MENGEN_SQL);
    return { mandanten: Number(rows[0].mandanten), konten: Number(rows[0].konten) };
  } catch {
    return null;
  }
}

async function tabelleLesbar(client, tabelle) {
  if (!BEZEICHNER.test(tabelle)) return false;
  try {
    await client.query(["SELECT 1 FROM", '"' + tabelle + '"', "LIMIT 1"].join(" "));
    return true;
  } catch {
    return false;
  }
}

async function tabellenLesbar(client, tabellen) {
  const nichtLesbar = [];
  for (const tabelle of tabellen) {
    if (!(await tabelleLesbar(client, tabelle))) nichtLesbar.push(tabelle);
  }
  return { gesamt: tabellen.length, lesbar: tabellen.length - nichtLesbar.length, nichtLesbar };
}

async function schemaAbgleich(client, erwartet) {
  const { readSchemaColumns, schemaDifferences } = await schemaWerkzeug();
  try {
    const { missing, unknown } = schemaDifferences(erwartet, await readSchemaColumns(client));
    return { fehlend: missing.length, unbekannt: unknown.length };
  } catch {
    return null;
  }
}

export async function pruefenVorDemStart(client, { zeitpunkt, erwartet }) {
  const mengen = await mengenLesen(client);
  return {
    p1: await zeitpunktEingehalten(client, zeitpunkt),
    p2: { ok: mengen !== null && mengen.mandanten > 0 && mengen.konten > 0 },
    p3: await tabellenLesbar(client, [...erwartet.keys()].sort()),
    p4: await schemaAbgleich(client, erwartet),
    mengen,
  };
}

export async function pruefenNachDemEnde(client, { erwartet, mengenVorher }) {
  const schema = await schemaAbgleich(client, erwartet);
  const mengen = await mengenLesen(client);
  const nichtWeniger =
    mengen !== null &&
    mengenVorher !== null &&
    mengen.mandanten >= mengenVorher.mandanten &&
    mengen.konten >= mengenVorher.konten;
  return {
    p5: { ok: schema !== null && schema.fehlend === 0, schema },
    p6: { ok: nichtWeniger },
  };
}
