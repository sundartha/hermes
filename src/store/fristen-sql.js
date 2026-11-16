const FEHLER = "[fristen] faellige Fristen lesen fehlgeschlagen:";
const FRISTEN = Object.freeze({
  hoechstdauer: { spalte: "frist_hoechstdauer_at", feld: "fristHoechstdauerAt" },
});
const MANDANTEN_SQL = "SELECT id FROM tenant ORDER BY id";
const KONTEXT_SQL = "SELECT set_config('app.current_tenant', $1, true)";

const holenSql = (spalte) => `WITH faellig AS (
  SELECT id FROM call
  WHERE tenant_id = $1 AND status = 'active' AND ${spalte} <= now()
    AND (frist_lease_bis IS NULL OR frist_lease_bis <= now())
  ORDER BY ${spalte}, id
  LIMIT $2
  FOR UPDATE SKIP LOCKED)
UPDATE call
SET frist_lease_bis = now() + $3::double precision * interval '1 millisecond',
    frist_versuche = call.frist_versuche + 1
FROM faellig
WHERE call.id = faellig.id AND call.tenant_id = $1
RETURNING call.id, call.tenant_id, call.${spalte} AS faellig_um, call.frist_versuche::int AS versuche`;

function frist(art) {
  const eintrag = FRISTEN[art];
  if (!eintrag) throw new Error(`unbekannte Frist: ${art}`);
  return eintrag;
}

const treffer = (callId, tenantId, faelligUm, versuche) => ({
  callId,
  tenantId,
  faelligAt: new Date(faelligUm).toISOString(),
  versuche,
});

async function holeJeMandant(client, tenantId, anweisung) {
  await client.query("BEGIN");
  try {
    await client.query(KONTEXT_SQL, [tenantId]);
    const { rows } = await client.query(...anweisung);
    await client.query("COMMIT");
    return rows.map((zeile) => treffer(zeile.id, zeile.tenant_id, zeile.faellig_um, zeile.versuche));
  } catch (fehler) {
    await client.query("ROLLBACK");
    throw fehler;
  }
}

export function macheFristenSql({ runner }) {
  return {
    faellige: async ({ art, limitJeMandant, leaseMs }) => {
      const sql = holenSql(frist(art).spalte);
      try {
        return await runner.withClient(async (client) => {
          const { rows: mandanten } = await client.query(MANDANTEN_SQL);
          const gefunden = [];
          for (const { id } of mandanten) {
            gefunden.push(...(await holeJeMandant(client, id, [sql, [id, limitJeMandant, leaseMs]])));
          }
          return gefunden;
        });
      } catch (fehler) {
        console.error(FEHLER, fehler.message);
        throw fehler;
      }
    },
  };
}

const alsMs = (iso) => Date.parse(iso);

export function faelligeAusSpiegel(state, { art, jetztMs, limitJeMandant, leaseMs }) {
  const { feld } = frist(art);
  const frei = (call) => call.status === "active" && call[feld] && alsMs(call[feld]) <= jetztMs && !(alsMs(call.fristLeaseBis) > jetztMs);
  const faellig = state.calls
    .filter(frei)
    .sort((a, b) => alsMs(a[feld]) - alsMs(b[feld]) || a.id.localeCompare(b.id));
  const jeMandant = new Map();
  const gefunden = [];
  for (const call of faellig) {
    const bisher = jeMandant.get(call.tenantId) ?? 0;
    if (bisher >= limitJeMandant) continue;
    jeMandant.set(call.tenantId, bisher + 1);
    call.fristLeaseBis = new Date(jetztMs + leaseMs).toISOString();
    call.fristVersuche = (call.fristVersuche ?? 0) + 1;
    gefunden.push(treffer(call.id, call.tenantId, call[feld], call.fristVersuche));
  }
  return gefunden;
}
