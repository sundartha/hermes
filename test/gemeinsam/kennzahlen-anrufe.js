export function zeitpunkt(tageVorher, uhrzeit) {
  const jetzt = new Date();
  const tag = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate() - tageVorher)).toISOString().slice(0, 10);
  return new Date(`${tag}T${uhrzeit}Z`).toISOString();
}

let zaehler = 0;

export async function anrufEinfuegen(db, fall) {
  zaehler += 1;
  const zeile = {
    direction: "outbound",
    status: "completed",
    started_at: zeitpunkt(0, "09:00:00"),
    answered_at: null,
    ended_at: null,
    failure_reason: null,
    objective_achieved: null,
    consults: null,
    estimated_cost_cents: null,
    ...fall,
  };
  await db.transaction(async (transaktion) => {
    const { rows } = await transaktion.query("SELECT id FROM tenant ORDER BY created_at LIMIT 1");
    const tenantId = rows[0].id;
    await transaktion.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    await transaktion.query(
      `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, answered_at, ended_at,
         failure_reason, objective_achieved, consults, estimated_cost_cents)
       VALUES ($1, $2, 'kennzahlen-test', $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
      [
        `call_kennzahlen_${zaehler}`,
        tenantId,
        zeile.direction,
        zeile.status,
        zeile.started_at,
        zeile.answered_at,
        zeile.ended_at,
        zeile.failure_reason,
        zeile.objective_achieved,
        zeile.consults,
        zeile.estimated_cost_cents,
      ],
    );
  });
}

export function wertVon(zeilen, messwert, labels = {}) {
  const gefunden = zeilen.filter(
    (zeile) =>
      zeile.messwert === messwert &&
      zeile.richtung === (labels.richtung ?? "") &&
      zeile.ergebnis === (labels.ergebnis ?? "") &&
      zeile.ziel === (labels.ziel ?? "") &&
      zeile.plan === (labels.plan ?? ""),
  );
  if (gefunden.length !== 1) throw new Error(`Messwert ${messwert} ${JSON.stringify(labels)}: ${gefunden.length} Zeilen statt 1`);
  return Number(gefunden[0].wert);
}
