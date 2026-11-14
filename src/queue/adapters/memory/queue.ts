import { PROVISIONING_JOB_STATUS } from "../../../begriffe/nummern.js";
import { requireIdempotencyKey } from "../../idempotency-key.js";
import { herzschlagUeberfaellig } from "../../zeitplan-frist.ts";

interface Job {
  id: string;
  kind: string;
  payload: unknown;
  idempotencyKey: string;
  status: (typeof PROVISIONING_JOB_STATUS)[keyof typeof PROVISIONING_JOB_STATUS];
}

interface Auftrag {
  kind: string;
  payload: unknown;
  idempotencyKey: string;
}

interface MemoryQueue {
  enqueue: (auftrag: Auftrag) => string;
  drain: (handler: (job: Job) => unknown, art?: string) => Promise<number>;
  jobStatus: (id: string) => Job["status"] | null;
  plane: (name: string, intervallMs: number, lauf: () => unknown) => Promise<void>;
  ueberfaellige: () => Promise<string[]>;
}

interface Zeitplan {
  intervallMs: number;
  seitMs: number;
  zuletztMs: number | null;
}

const JOB_ID_RADIX = 36;
const JOB_ID_RANDOM_START = 2;
const JOB_ID_RANDOM_END = 6;

export function makeMemoryQueue(): MemoryQueue {
  const jobs: Job[] = [];
  const byKey = new Map<string, string>();

  function enqueue({ kind, payload, idempotencyKey }: Auftrag): string {
    requireIdempotencyKey(idempotencyKey);
    const existing = byKey.get(idempotencyKey);
    if (existing) return existing;
    const random = Math.random().toString(JOB_ID_RADIX).slice(JOB_ID_RANDOM_START, JOB_ID_RANDOM_END);
    const id = "job_" + Date.now().toString(JOB_ID_RADIX) + random;
    jobs.push({ id, kind, payload, idempotencyKey, status: PROVISIONING_JOB_STATUS.QUEUED });
    byKey.set(idempotencyKey, id);
    return id;
  }

  async function drain(handler: (job: Job) => unknown, art?: string): Promise<number> {
    let processed = 0;
    for (const job of jobs) {
      if (job.status !== PROVISIONING_JOB_STATUS.QUEUED) continue;
      if (art !== undefined && job.kind !== art) continue;
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

  const jobStatus = (id: string) => jobs.find((j) => j.id === id)?.status ?? null;
  const geplant = new Map<string, Zeitplan>();

  function plane(name: string, intervallMs: number, lauf: () => unknown): Promise<void> {
    const eintrag: Zeitplan = { intervallMs, seitMs: Date.now(), zuletztMs: null };
    geplant.set(name, eintrag);
    setInterval(() => {
      Promise.resolve(lauf()).then(
        () => {
          eintrag.zuletztMs = Date.now();
        },
        (fehler: unknown) => {
          throw fehler;
        },
      );
    }, intervallMs).unref();
    return Promise.resolve();
  }

  function ueberfaellige(): Promise<string[]> {
    const jetztMs = Date.now();
    return Promise.resolve(
      [...geplant].filter(([, eintrag]) => herzschlagUeberfaellig({ ...eintrag, jetztMs })).map(([name]) => name),
    );
  }

  return { enqueue, drain, jobStatus, plane, ueberfaellige };
}
