// Provisioning-Worker (P6b2): fuehrt EINEN enqueued provision_number-Job aus.
// Dequeue + Provider-Kauf sind aus dem HTTP-Request geloest; der Worker RUFT
// provisionNumber(s, deps, opts) UNVERAENDERT (P6b1-Orchestrierung: Hold-vor-Order,
// kein active ohne Capture, Rollback bleiben dort). KEIN store.save() hier - der
// Aufrufer (Route) persistiert nach dem Drain (wie provisionNumber: reine Fn ueber s).
//
// INVARIANTE (Plan-Schloss): ein Job wird NUR fuer eine Number im Zustand 'requested'
// ausgefuehrt (jeder andere Zustand -> ignoriert, KEIN Provider-Kauf). Das verriegelt
// Doppel-Ausfuehrung (Re-Drain desselben Jobs findet die Number nicht mehr 'requested').
import { findNumber } from "../store/state-ops.js";
import { provisionNumber } from "../onboarding.js";
import { NUMBER_STATUS } from "../store/defaults.js";

// deps = { provisioner, billing? } (wie provisionNumber). opts = die provisionNumber-
// Optionen OHNE numberId (die kommt aus dem Job-Payload). Liefert {skipped} | {number}.
export async function handleProvisionJob(s, job, deps, opts) {
  const { numberId } = job.payload;
  const number = findNumber(s, numberId);
  // Idempotenz-Schloss #2 (Zustandscheck): nur 'requested' wird gekauft. Re-Run eines
  // bereits provisionierten/failed Jobs ist ein No-op (kein Doppelkauf).
  if (!number || number.status !== NUMBER_STATUS.REQUESTED) return { skipped: true, status: number?.status ?? null };
  const result = await provisionNumber(s, deps, { numberId, ...opts });
  return { number: result };
}
