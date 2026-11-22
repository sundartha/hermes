import { MANDANTEN_SQL, imMandanten } from "./fristen-sql.js";

const FEHLER = "[vorspann-fristen] faellige Fristen lesen fehlgeschlagen:";
const FRISTEN = Object.freeze({
  klingel: { at: "frist_klingel_at", lease: "frist_klingel_lease_bis", versuche: "frist_klingel_versuche" },
  wiedergabe: { at: "frist_wiedergabe_at", lease: "frist_wiedergabe_lease_bis", versuche: "frist_wiedergabe_versuche" },
  elBein: { at: "frist_el_bein_at", lease: "frist_el_bein_lease_bis", versuche: "frist_el_bein_versuche" },
});

const holenSql = ({ at, lease, versuche }) => `WITH faellig AS (
  SELECT call_id FROM vorspann_zustand
  WHERE tenant_id = $1 AND ${at} IS NOT NULL AND ${at} <= now()
    AND (${lease} IS NULL OR ${lease} <= now())
  ORDER BY ${at}, call_id
  LIMIT $2
  FOR UPDATE SKIP LOCKED)
UPDATE vorspann_zustand v
SET ${lease} = now() + $3::double precision * interval '1 millisecond',
    ${versuche} = v.${versuche} + 1
FROM faellig
WHERE v.call_id = faellig.call_id AND v.tenant_id = $1
RETURNING v.call_id, v.tenant_id, v.${at} AS faellig_um, v.${versuche}::int AS versuche`;

const setzenSql = ({ at, versuche }) =>
  `UPDATE vorspann_zustand SET ${at} = $3, ${versuche} = 0 WHERE tenant_id = $1 AND call_id = $2`;

const alsTreffer = (frist) => (zeile) => ({
  callId: zeile.call_id,
  tenantId: zeile.tenant_id,
  frist,
  faelligAt: new Date(zeile.faellig_um).toISOString(),
  versuche: zeile.versuche,
});

export function macheVorspannFristenSql({ runner }) {
  const setzen = ({ tenantId, callId, frist, faelligAt }) =>
    runner.withClient((client) => imMandanten(client, tenantId, [setzenSql(FRISTEN[frist]), [tenantId, callId, faelligAt]]));
  return {
    setze: setzen,
    leere: ({ tenantId, callId, frist }) => setzen({ tenantId, callId, frist, faelligAt: null }),
    faellige: async ({ limitJeMandant, leaseMs }) => {
      try {
        return await runner.withClient(async (client) => {
          const { rows: mandanten } = await client.query(MANDANTEN_SQL);
          const gefunden = [];
          for (const { id } of mandanten) {
            for (const [frist, spalten] of Object.entries(FRISTEN)) {
              const zeilen = await imMandanten(client, id, [holenSql(spalten), [id, limitJeMandant, leaseMs]]);
              gefunden.push(...zeilen.map(alsTreffer(frist)));
            }
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

export function macheSpeicherVorspannFristen({ zustand, jetzt = Date.now }) {
  const eintraege = new Map();
  const schluessel = ({ tenantId, callId }) => `${tenantId}/${callId}`;
  const setzen = async ({ tenantId, callId, frist, faelligAt }) => {
    if (!FRISTEN[frist] || !(await zustand.lade({ tenantId, callId }))) return;
    const marken = eintraege.get(schluessel({ tenantId, callId })) ?? { tenantId, callId };
    marken[frist] = { ...marken[frist], faelligAt, versuche: 0 };
    eintraege.set(schluessel({ tenantId, callId }), marken);
  };
  return {
    setze: setzen,
    leere: ({ tenantId, callId, frist }) => setzen({ tenantId, callId, frist, faelligAt: null }),
    faellige: async ({ limitJeMandant, leaseMs }) => {
      const jetztMs = jetzt();
      const gefunden = [];
      const jeMandant = new Map();
      for (const frist of Object.keys(FRISTEN)) {
        const reif = [...eintraege.values()]
          .filter((marken) => {
            const stand = marken[frist];
            return stand?.faelligAt && Date.parse(stand.faelligAt) <= jetztMs && !(stand.leaseBis > jetztMs);
          })
          .sort((links, rechts) => Date.parse(links[frist].faelligAt) - Date.parse(rechts[frist].faelligAt) || links.callId.localeCompare(rechts.callId));
        for (const marken of reif) {
          if (!(await zustand.lade(marken))) continue;
          const bisher = jeMandant.get(`${frist}/${marken.tenantId}`) ?? 0;
          if (bisher >= limitJeMandant) continue;
          jeMandant.set(`${frist}/${marken.tenantId}`, bisher + 1);
          const stand = marken[frist];
          stand.leaseBis = jetztMs + leaseMs;
          stand.versuche += 1;
          gefunden.push({
            callId: marken.callId,
            tenantId: marken.tenantId,
            frist,
            faelligAt: new Date(stand.faelligAt).toISOString(),
            versuche: stand.versuche,
          });
        }
      }
      return gefunden;
    },
  };
}
