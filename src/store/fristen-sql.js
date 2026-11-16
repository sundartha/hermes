import { MAX_CALL_DURATION_CAP_S } from "../begriffe/anrufe.js";
import { MS_PER_SECOND } from "../utils/timer.js";

const FEHLER = "[fristen] faellige Fristen lesen fehlgeschlagen:";
const ABGEHOBEN_PLUS_DAUER = `(answered_at::timestamptz + COALESCE(NULLIF(max_duration_s, 0), $4::int) * interval '1 second')`;
const FRISTEN = Object.freeze({
  hoechstdauer: {
    feld: "fristHoechstdauerAt",
    faelligUm: `COALESCE(frist_hoechstdauer_at, ${ABGEHOBEN_PLUS_DAUER})`,
    dauerS: (call) => call.maxDurationS || MAX_CALL_DURATION_CAP_S,
  },
});
const SETZEN_SQL = "UPDATE call SET frist_hoechstdauer_at = $3 WHERE tenant_id = $1 AND id = $2 AND status = 'active'";
const MANDANTEN_SQL = "SELECT id FROM tenant ORDER BY id";
const KONTEXT_SQL = "SELECT set_config('app.current_tenant', $1, true)";

const holenSql = (faelligUm) => `WITH faellig AS (
  SELECT id, ${faelligUm} AS faellig_um FROM call
  WHERE tenant_id = $1 AND status = 'active' AND ${faelligUm} <= now()
    AND (frist_lease_bis IS NULL OR frist_lease_bis <= now())
  ORDER BY ${faelligUm}, id
  LIMIT $2
  FOR UPDATE SKIP LOCKED)
UPDATE call
SET frist_lease_bis = now() + $3::double precision * interval '1 millisecond',
    frist_versuche = call.frist_versuche + 1
FROM faellig
WHERE call.id = faellig.id AND call.tenant_id = $1
RETURNING call.id, call.tenant_id, faellig.faellig_um, call.frist_versuche::int AS versuche`;

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

export function macheFristenSql({ runner, einreihen }) {
  return {
    setzeHoechstdauer: ({ callId, tenantId, faelligAt }) =>
      einreihen((client) => imMandanten(client, tenantId, [SETZEN_SQL, [tenantId, callId, faelligAt]])),
    faellige: async ({ art, limitJeMandant, leaseMs }) => {
      const sql = holenSql(frist(art).faelligUm);
      try {
        return await runner.withClient(async (client) => {
          const { rows: mandanten } = await client.query(MANDANTEN_SQL);
          const gefunden = [];
          for (const { id } of mandanten) {
            const zeilen = await imMandanten(client, id, [sql, [id, limitJeMandant, leaseMs, MAX_CALL_DURATION_CAP_S]]);
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
  const { feld, dauerS } = frist(art);
  const faelligMs = (call) => (call[feld] ? alsMs(call[feld]) : alsMs(call.answeredAt) + dauerS(call) * MS_PER_SECOND);
  const frei = (call) => call.status === "active" && faelligMs(call) <= jetztMs && !(alsMs(call.fristLeaseBis) > jetztMs);
  const faellig = state.calls
    .filter(frei)
    .sort((links, rechts) => faelligMs(links) - faelligMs(rechts) || links.id.localeCompare(rechts.id));
  const jeMandant = new Map();
  const gefunden = [];
  for (const call of faellig) {
    const bisher = jeMandant.get(call.tenantId) ?? 0;
    if (bisher >= limitJeMandant) continue;
    jeMandant.set(call.tenantId, bisher + 1);
    call.fristLeaseBis = new Date(jetztMs + leaseMs).toISOString();
    call.fristVersuche = (call.fristVersuche ?? 0) + 1;
    gefunden.push(treffer({ callId: call.id, tenantId: call.tenantId, faelligUm: faelligMs(call), versuche: call.fristVersuche }));
  }
  return gefunden;
}

export function setzeHoechstdauerImSpiegel(state, { callId, faelligAt }) {
  const call = state.calls.find((eintrag) => eintrag.id === callId);
  if (call?.status === "active") call.fristHoechstdauerAt = faelligAt;
}
