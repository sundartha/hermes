import { PROVISIONING_JOB_STATUS } from "../../../store/defaults.js";

const JOB_ID_RADIX = 36;
const JOB_ID_RANDOM_START = 2;
const JOB_ID_RANDOM_END = 6;

export function makeMemoryQueue() {
  const jobs = [];
  const byKey = new Map();

  function enqueue({ kind, payload, idempotencyKey }) {
    if (typeof idempotencyKey !== "string" || idempotencyKey === "")
      throw new TypeError("enqueue: idempotencyKey muss ein nicht-leerer String sein");
    const existing = byKey.get(idempotencyKey);
    if (existing) return existing;
    const random = Math.random().toString(JOB_ID_RADIX).slice(JOB_ID_RANDOM_START, JOB_ID_RANDOM_END);
    const id = "job_" + Date.now().toString(JOB_ID_RADIX) + random;
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
      }
      processed++;
    }
    return processed;
  }

  const jobStatus = (id) => jobs.find((j) => j.id === id)?.status ?? null;
  return { enqueue, drain, jobStatus };
}
