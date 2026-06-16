// In-Memory-Queue-Adapter (P6b2, Default QUEUE_BACKEND=memory). Deterministisch:
// enqueue legt einen Job in eine Liste, drain() verarbeitet sie synchron-sequentiell
// (KEIN setInterval/Timer -> Tests rufen drain). Idempotenz ueber idempotencyKey
// (zweites Enqueue desselben Keys -> derselbe Job, kein Duplikat). Kein IO, kein State
// ausserhalb dieser Closure -> ein Adapter pro Prozess (Konstruktion in registry).
// Status-Strings aus defaults.js (EINE Quelle, G5/G13: derselbe Wert wie die
// persistente Job-Spur im Store-Spiegel).
import { PROVISIONING_JOB_STATUS } from "../../../store/defaults.js";

export function makeMemoryQueue() {
  const jobs = []; // [{ id, kind, payload, idempotencyKey, status }]
  const byKey = new Map(); // idempotencyKey -> jobId

  function enqueue({ kind, payload, idempotencyKey }) {
    const existing = byKey.get(idempotencyKey);
    if (existing) return existing; // Idempotenz-Schloss (kein Doppel-Job)
    const id = "job_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    jobs.push({ id, kind, payload, idempotencyKey, status: PROVISIONING_JOB_STATUS.QUEUED });
    byKey.set(idempotencyKey, id);
    return id;
  }

  // Verarbeitet alle QUEUED Jobs sequentiell. handler-Fehler -> Job 'failed',
  // drain wirft NICHT (ein kaputter Job darf den Rest nicht blocken); der handler
  // selbst persistiert den Fachzustand (failed-Number). Liefert die Zahl verarbeiteter Jobs.
  async function drain(handler) {
    let processed = 0;
    for (const job of jobs) {
      if (job.status !== PROVISIONING_JOB_STATUS.QUEUED) continue;
      try {
        await handler(job);
        job.status = PROVISIONING_JOB_STATUS.DONE;
      } catch {
        job.status = PROVISIONING_JOB_STATUS.FAILED; // Fachzustand-Rollback liegt im handler
      }
      processed++;
    }
    return processed;
  }

  const jobStatus = (id) => jobs.find((j) => j.id === id)?.status ?? null;
  return { enqueue, drain, jobStatus };
}
