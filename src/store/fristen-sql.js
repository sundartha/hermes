import { MAX_CALL_DURATION_CAP_S } from "../begriffe/anrufe.js";
import { MS_PER_SECOND } from "../utils/timer.ts";

const FEHLER = "[fristen] faellige Fristen lesen fehlgeschlagen:";
const ABGEHOBEN_PLUS_DAUER = `(answered_at::timestamptz + COALESCE(NULLIF(max_duration_s, 0), $4::int) * interval '1 second')`;
const AKTIV_SQL = "status = 'active'";
const istAktiv = (call) => call.status === "active";
const FRISTEN = Object.freeze({
  hoechstdauer: {
    feld: "fristHoechstdauerAt",
    leaseFeld: "fristLeaseBis",
    versucheFeld: "fristVersuche",
    leaseSpalte: "frist_lease_bis",
    versucheSpalte: "frist_versuche",
    bedingung: AKTIV_SQL,
    offen: istAktiv,
    faelligUm: `COALESCE(frist_hoechstdauer_at, ${ABGEHOBEN_PLUS_DAUER})`,
    parameter: [MAX_CALL_DURATION_CAP_S],
    dauerS: (call) => call.maxDurationS || MAX_CALL_DURATION_CAP_S,
  },
  geld: {
    feld: "fristGeldAt",
    leaseFeld: "fristGeldLeaseBis",
    versucheFeld: "fristGeldVersuche",
    leaseSpalte: "frist_geld_lease_bis",
    versucheSpalte: "frist_geld_versuche",
    bedingung: AKTIV_SQL,
    offen: istAktiv,
    faelligUm: "COALESCE(frist_geld_at, answered_at::timestamptz)",
    parameter: [],
    dauerS: () => 0,
  },
  reserve: {
    feld: "fristReserveAt",
    leaseFeld: "fristReserveLeaseBis",
    versucheFeld: "fristReserveVersuche",
    leaseSpalte: "frist_reserve_lease_bis",
    versucheSpalte: "frist_reserve_versuche",
    bedingung: "frist_reserve_at IS NOT NULL",
    offen: (call) => Boolean(call.fristReserveAt),
    faelligUm: "frist_reserve_at",
    parameter: [],
  },
  abfrage: {
    feld: "fristAbfrageAt",
    leaseFeld: "fristAbfrageLeaseBis",
    versucheFeld: "fristAbfrageVersuche",
    leaseSpalte: "frist_abfrage_lease_bis",
    versucheSpalte: "frist_abfrage_versuche",
    bedingung: `${AKTIV_SQL} AND frist_abfrage_at IS NOT NULL`,
    offen: (call) => istAktiv(call) && Boolean(call.fristAbfrageAt),
    faelligUm: "frist_abfrage_at",
    parameter: [],
    nurOhneLebendenBesitzer: true,
  },
  uebergabe: {
    feld: "fristUebergabeAt",
    leaseFeld: "fristUebergabeLeaseBis",
    versucheFeld: "fristUebergabeVersuche",
    leaseSpalte: "frist_uebergabe_lease_bis",
    versucheSpalte: "frist_uebergabe_versuche",
    bedingung: `${AKTIV_SQL} AND frist_uebergabe_at IS NOT NULL`,
    offen: (call) => istAktiv(call) && Boolean(call.fristUebergabeAt),
    faelligUm: "frist_uebergabe_at",
    parameter: [],
    nurOhneLebendenBesitzer: true,
  },
});
const SETZEN_SQL = "UPDATE call SET frist_hoechstdauer_at = $3 WHERE tenant_id = $1 AND id = $2 AND status = 'active'";
const SETZEN_GELD_SQL =
  "UPDATE call SET frist_geld_at = $3, frist_geld_versuche = 0 WHERE tenant_id = $1 AND id = $2 AND status = 'active'";
const SETZEN_RESERVE_SQL =
  "UPDATE call SET frist_reserve_at = $3, frist_reserve_versuche = 0 WHERE tenant_id = $1 AND id = $2";
const SETZEN_ABFRAGE_SQL =
  "UPDATE call SET frist_abfrage_at = $3, frist_abfrage_versuche = 0 WHERE tenant_id = $1 AND id = $2 AND status = 'active'";
const SETZEN_UEBERGABE_SQL = `UPDATE call SET frist_uebergabe_versuche = 0,
  frist_uebergabe_at = CASE WHEN $3::timestamptz IS NULL THEN NULL ELSE LEAST(COALESCE(frist_uebergabe_at, $3::timestamptz), $3::timestamptz) END
  WHERE tenant_id = $1 AND id = $2 AND status = 'active'`;
const MANDANTEN_SQL = "SELECT id FROM tenant ORDER BY id";
const KONTEXT_SQL = "SELECT set_config('app.current_tenant', $1, true)";

const ohneLebendenBesitzer = (eintrag) =>
  eintrag.nurOhneLebendenBesitzer
    ? ` AND NOT COALESCE(instanz = ANY($${4 + eintrag.parameter.length}::text[]), false)`
    : "";

const holenSql = (eintrag) => {
  const { bedingung, faelligUm, leaseSpalte, versucheSpalte } = eintrag;
  return `WITH faellig AS (
  SELECT id, ${faelligUm} AS faellig_um FROM call
  WHERE tenant_id = $1 AND ${bedingung}${ohneLebendenBesitzer(eintrag)} AND ${faelligUm} <= now()
    AND (${leaseSpalte} IS NULL OR ${leaseSpalte} <= now())
  ORDER BY ${faelligUm}, id
  LIMIT $2
  FOR UPDATE SKIP LOCKED)
UPDATE call
SET ${leaseSpalte} = now() + $3::double precision * interval '1 millisecond',
    ${versucheSpalte} = call.${versucheSpalte} + 1
FROM faellig
WHERE call.id = faellig.id AND call.tenant_id = $1
RETURNING call.id, call.tenant_id, faellig.faellig_um, call.${versucheSpalte}::int AS versuche`;
};

async function fremdeLebende(besitzLage) {
  const { eigene, lebende } = await besitzLage();
  return (lebende ?? []).filter((kennung) => kennung !== eigene);
}

function frist(art) {
  const eintrag = FRISTEN[art];
  if (!eintrag) throw new Error(`unbekannte Frist: ${art}`);
  return eintrag;
}

const treffer = ({ callId, tenantId, faelligUm, versuche }) => ({
  callId,
  tenantId,
  faelligAt: new Date(faelligUm).toISOString(),
  versuche,
});

async function imMandanten(client, tenantId, anweisung) {
  await client.query("BEGIN");
  try {
    await client.query(KONTEXT_SQL, [tenantId]);
    const { rows } = await client.query(...anweisung);
    await client.query("COMMIT");
    return rows;
  } catch (fehler) {
    await client.query("ROLLBACK");
    throw fehler;
  }
}

const alsTreffer = (zeile) =>
  treffer({ callId: zeile.id, tenantId: zeile.tenant_id, faelligUm: zeile.faellig_um, versuche: zeile.versuche });

export function macheFristenSql({ runner, einreihen, besitzLage }) {
  return {
    setzeHoechstdauer: ({ callId, tenantId, faelligAt }) =>
      einreihen((client) => imMandanten(client, tenantId, [SETZEN_SQL, [tenantId, callId, faelligAt]])),
    setzeGeld: ({ callId, tenantId, faelligAt }) =>
      einreihen((client) => imMandanten(client, tenantId, [SETZEN_GELD_SQL, [tenantId, callId, faelligAt]])),
    setzeReserve: ({ callId, tenantId, faelligAt }) =>
      einreihen((client) => imMandanten(client, tenantId, [SETZEN_RESERVE_SQL, [tenantId, callId, faelligAt]])),
    setzeAbfrage: ({ callId, tenantId, faelligAt }) =>
      einreihen((client) => imMandanten(client, tenantId, [SETZEN_ABFRAGE_SQL, [tenantId, callId, faelligAt]])),
    setzeUebergabe: ({ callId, tenantId, faelligAt }) =>
      einreihen((client) => imMandanten(client, tenantId, [SETZEN_UEBERGABE_SQL, [tenantId, callId, faelligAt]])),
    faellige: async ({ art, limitJeMandant, leaseMs }) => {
      const eintrag = frist(art);
      const sql = holenSql(eintrag);
      const fremde = eintrag.nurOhneLebendenBesitzer ? [await fremdeLebende(besitzLage)] : [];
      try {
        return await runner.withClient(async (client) => {
          const { rows: mandanten } = await client.query(MANDANTEN_SQL);
          const gefunden = [];
          for (const { id } of mandanten) {
            const zeilen = await imMandanten(client, id, [sql, [id, limitJeMandant, leaseMs, ...eintrag.parameter, ...fremde]]);
            gefunden.push(...zeilen.map(alsTreffer));
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
  const { feld, dauerS, leaseFeld, versucheFeld, offen } = frist(art);
  const faelligMs = (call) => (call[feld] ? alsMs(call[feld]) : alsMs(call.answeredAt) + dauerS(call) * MS_PER_SECOND);
  const frei = (call) => offen(call) && faelligMs(call) <= jetztMs && !(alsMs(call[leaseFeld]) > jetztMs);
  const faellig = state.calls
    .filter(frei)
    .sort((links, rechts) => faelligMs(links) - faelligMs(rechts) || links.id.localeCompare(rechts.id));
  const jeMandant = new Map();
  const gefunden = [];
  for (const call of faellig) {
    const bisher = jeMandant.get(call.tenantId) ?? 0;
    if (bisher >= limitJeMandant) continue;
    jeMandant.set(call.tenantId, bisher + 1);
    call[leaseFeld] = new Date(jetztMs + leaseMs).toISOString();
    call[versucheFeld] = (call[versucheFeld] ?? 0) + 1;
    gefunden.push(treffer({ callId: call.id, tenantId: call.tenantId, faelligUm: faelligMs(call), versuche: call[versucheFeld] }));
  }
  return gefunden;
}

export function setzeHoechstdauerImSpiegel(state, { callId, faelligAt }) {
  const call = state.calls.find((eintrag) => eintrag.id === callId);
  if (call?.status === "active") call.fristHoechstdauerAt = faelligAt;
}

export function setzeGeldImSpiegel(state, { callId, faelligAt }) {
  const call = state.calls.find((eintrag) => eintrag.id === callId);
  if (call?.status !== "active") return;
  call.fristGeldAt = faelligAt;
  call.fristGeldVersuche = 0;
}

export function setzeReserveImSpiegel(state, { callId, faelligAt }) {
  const call = state.calls.find((eintrag) => eintrag.id === callId);
  if (!call) return;
  call.fristReserveAt = faelligAt;
  call.fristReserveVersuche = 0;
}

export function setzeAbfrageImSpiegel(state, { callId, faelligAt }) {
  const call = state.calls.find((eintrag) => eintrag.id === callId);
  if (call?.status !== "active") return;
  call.fristAbfrageAt = faelligAt;
  call.fristAbfrageVersuche = 0;
}

export function setzeUebergabeImSpiegel(state, { callId, faelligAt }) {
  const call = state.calls.find((eintrag) => eintrag.id === callId);
  if (call?.status !== "active") return;
  const bleibt = alsMs(call.fristUebergabeAt) < alsMs(faelligAt);
  if (!bleibt) call.fristUebergabeAt = faelligAt;
  call.fristUebergabeVersuche = 0;
}
