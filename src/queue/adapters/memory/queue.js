import { PROVISIONING_JOB_STATUS } from "../../../store/defaults.js";

export function makeMemoryQueue() {
  const jobs = [];
  const byKey = new Map();

  function enqueue({ kind, payload, idempotencyKey }) {
    const existing = byKey.get(idempotencyKey);
    if (existing) return existing;
    const id = "job_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    jobs.push({ id, kind, payload, idempotencyKey, status: PROVISIONING_JOB_STATUS.QUEUED });
    byKey.set(idempotencyKey, id);
    return id;
  }

  async function drain(handler) {
    let processed = 0;
    for (const job of jobs) {
      if (job.status !== PROVISIONING_JOB_STATUS.QUEUED) continue;
      try {
        await handler(job);
        job.status = PROVISIONING_JOB_STATUS.DONE;
      } catch {
        job.status = PROVISIONING_JOB_STATUS.FAILED;
        job.versuche = 0;
      }
      processed++;
    }
    return processed;
  }

  const jobStatus = (id) => jobs.find((j) => j.id === id)?.status ?? null;
  return { enqueue, drain, jobStatus };
}
