import type { Clock, ConstructorOptions, Job, JobWithMetadata, PgBoss } from "pg-boss";
import { ANRUFSTART_JOB } from "../../../begriffe/anrufe.js";
import { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "../../../utils/timer.js";
import { requireIdempotencyKey } from "../../idempotency-key.js";

interface JobDaten {
  payload: unknown;
  idempotencyKey: string;
}

interface Auftrag extends JobDaten {
  kind: string;
}

interface Logger {
  error: (...args: unknown[]) => unknown;
}

interface PgBossQueueOptionen {
  connectionString?: string | undefined;
  schema?: string;
  clock?: Clock | undefined;
  logger?: Logger;
  poolMax?: number;
  bossOptions?: ConstructorOptions;
}

type BossOptionen = Required<Pick<PgBossQueueOptionen, "schema" | "logger" | "poolMax" | "bossOptions">> &
  Pick<PgBossQueueOptionen, "connectionString" | "clock">;

interface WartenderJob {
  id: string;
  erstellt: Date;
}

interface QueuedJob extends Auftrag {
  id: string;
}

interface PgBossQueue {
  enqueue: (auftrag: Auftrag) => Promise<string | null>;
  drain: (handler: Handler, art?: string) => Promise<number>;
  plane: (name: string, intervallMs: number, lauf: () => unknown) => Promise<void>;
  jobStatus: (id: string) => Promise<"queued" | "done" | "failed" | null>;
  warteschlangeZustand: () => Promise<{ art: string; laenge: number; aeltesteSekunden: number }[]>;
  start: () => Promise<PgBoss>;
  stop: () => Promise<void>;
}

type Handler = (job: QueuedJob) => unknown;

const DEFAULT_SCHEMA = "pgboss";
const DEAD_LETTER_SUFFIX = "_totpost";
const POOL_MAX = 4;
const RETRY_LIMIT = 3;
const RETRY_LIMIT_JE_ART: Readonly<Record<string, number>> = Object.freeze({ [ANRUFSTART_JOB]: 0 });
const RETRY_DELAY_SECONDS = 30;
const RETRY_DELAY_MAX_SECONDS = 600;
const EXPIRE_SECONDS = 300;
const RETENTION_SECONDS = 604800;
const DELETE_AFTER_SECONDS = 86400;
const DEAD_LETTER_RETENTION_SECONDS = 2592000;
const FETCH_BATCH_SIZE = 5;
const STOP_TIMEOUT_MS = 20000;
const ID_SEPARATOR = "/";
const WARTE_SEITE = 1000;
const MS_JE_SEKUNDE = MS_PER_SECOND;
const MINUTEN_JE_STUNDE = 60;
const STUNDEN_JE_TAG = 24;
const ZEITPLAN_PRAEFIX = "zeitplan_";
const INTERNER_PRAEFIX = "__pgboss__";
const ZEITPLAN_ABRUF_SEKUNDEN = 30;

const STATE_TO_STATUS: Readonly<Record<string, "queued" | "done" | "failed">> = Object.freeze({
  created: "queued",
  retry: "queued",
  active: "queued",
  completed: "done",
  failed: "failed",
  cancelled: "failed",
});

function publicId(kind: string, id: string): string {
  return `${kind}${ID_SEPARATOR}${id}`;
}

function toQueuedJob(job: Job<JobDaten>): QueuedJob {
  return {
    id: publicId(job.name, job.id),
    kind: job.name,
    payload: job.data.payload,
    idempotencyKey: job.data.idempotencyKey,
  };
}

async function createBoss({ connectionString, schema, poolMax, clock, logger, bossOptions }: BossOptionen): Promise<PgBoss> {
  const { PgBoss } = await import("pg-boss");
  const instance = new PgBoss({
    ...(connectionString === undefined ? {} : { connectionString }),
    schema,
    max: poolMax,
    schedule: true,
    ...(clock ? { clock } : {}),
    ...bossOptions,
  });
  instance.on("error", (err) => logger.error("[queue] pg-boss:", err.message));
  await instance.start();
  return instance;
}

async function ensureQueue(instance: PgBoss, kind: string): Promise<void> {
  await instance.createQueue(kind + DEAD_LETTER_SUFFIX, {
    retentionSeconds: DEAD_LETTER_RETENTION_SECONDS,
    deleteAfterSeconds: DEAD_LETTER_RETENTION_SECONDS,
  });
  await instance.createQueue(kind, {
    policy: "exclusive",
    deadLetter: kind + DEAD_LETTER_SUFFIX,
    retryLimit: RETRY_LIMIT_JE_ART[kind] ?? RETRY_LIMIT,
    retryDelay: RETRY_DELAY_SECONDS,
    retryBackoff: true,
    retryDelayMax: RETRY_DELAY_MAX_SECONDS,
    expireInSeconds: EXPIRE_SECONDS,
    retentionSeconds: RETENTION_SECONDS,
    deleteAfterSeconds: DELETE_AFTER_SECONDS,
  });
}

async function workQueueNames(instance: PgBoss): Promise<string[]> {
  const queues = await instance.getQueues();
  return queues
    .map((queue) => queue.name)
    .filter(
      (name) =>
        !name.endsWith(DEAD_LETTER_SUFFIX) &&
        !name.startsWith(ZEITPLAN_PRAEFIX) &&
        !name.startsWith(INTERNER_PRAEFIX),
    );
}

function cronFuerTakt(intervallMs: number): string {
  const stunden = intervallMs / MS_PER_HOUR;
  if (Number.isInteger(stunden) && stunden > 0 && STUNDEN_JE_TAG % stunden === 0) return `0 */${String(stunden)} * * *`;
  const minuten = intervallMs / MS_PER_MINUTE;
  if (Number.isInteger(minuten) && minuten > 0 && MINUTEN_JE_STUNDE % minuten === 0) return `*/${String(minuten)} * * * *`;
  throw new Error(`Takt ${String(intervallMs)} ms lässt sich nicht als Zeitplan ausdrücken`);
}

async function ensureZeitplanQueue(instance: PgBoss, queueName: string, intervallMs: number): Promise<void> {
  await instance.createQueue(queueName, {
    policy: "exclusive",
    retryLimit: 0,
    expireInSeconds: intervallMs / MS_JE_SEKUNDE,
    retentionSeconds: RETENTION_SECONDS,
    deleteAfterSeconds: DELETE_AFTER_SECONDS,
  });
}

async function wartendeSeite(instance: PgBoss, kind: string, after?: string): Promise<JobWithMetadata<JobDaten>[]> {
  return instance.findJobs<JobDaten>(kind, { queued: true, limit: WARTE_SEITE, ...(after ? { after } : {}) });
}

async function wartende(instance: PgBoss, kind: string): Promise<WartenderJob[]> {
  const alle: WartenderJob[] = [];
  for (let seite = await wartendeSeite(instance, kind); seite.length > 0; ) {
    let letzteId;
    for (const job of seite) {
      alle.push({ id: job.id, erstellt: job.createdOn });
      letzteId = job.id;
    }
    seite = seite.length < WARTE_SEITE ? [] : await wartendeSeite(instance, kind, letzteId);
  }
  return alle;
}

async function settle(instance: PgBoss, job: Job<JobDaten>, handler: Handler): Promise<void> {
  try {
    await handler(toQueuedJob(job));
    await instance.complete(job.name, job.id);
  } catch (err) {
    await instance.fail(job.name, job.id, { message: String(Reflect.get(Object(err), "message") ?? err) });
  }
}

async function drainKind(instance: PgBoss, kind: string, handler: Handler): Promise<number> {
  let processed = 0;
  for (;;) {
    const jobs = await instance.fetch<JobDaten>(kind, { batchSize: FETCH_BATCH_SIZE });
    if (jobs.length === 0) return processed;
    for (const job of jobs) await settle(instance, job, handler);
    processed += jobs.length;
  }
}

export function makePgBossQueue({
  connectionString,
  schema = DEFAULT_SCHEMA,
  clock,
  logger = console,
  poolMax = POOL_MAX,
  bossOptions = {},
}: PgBossQueueOptionen = {}): PgBossQueue {
  if (!bossOptions.db && (typeof connectionString !== "string" || connectionString === ""))
    throw new Error(
      "pg-boss-Queue braucht DATABASE_URL (direkte Verbindung, kein Transaktions-Pooler)",
    );
  let starting: Promise<PgBoss> | null = null;
  const ensured = new Map<string, Promise<void>>();

  function start() {
    starting ??= createBoss({
      connectionString,
      schema,
      poolMax,
      clock,
      logger,
      bossOptions,
    }).catch((err: unknown) => {
      starting = null;
      throw err;
    });
    return starting;
  }

  async function enqueue({ kind, payload, idempotencyKey }: Auftrag): Promise<string | null> {
    requireIdempotencyKey(idempotencyKey);
    const instance = await start();
    if (!ensured.has(kind))
      ensured.set(
        kind,
        ensureQueue(instance, kind).catch((err: unknown) => {
          ensured.delete(kind);
          throw err;
        }),
      );
    await ensured.get(kind);
    const id = await instance.send(
      kind,
      { payload, idempotencyKey },
      { singletonKey: idempotencyKey },
    );
    if (id) return publicId(kind, id);
    const [existing] = await instance.findJobs<JobDaten>(kind, { key: idempotencyKey });
    return existing ? publicId(kind, existing.id) : null;
  }

  async function drain(handler: Handler, art?: string): Promise<number> {
    const instance = await start();
    let processed = 0;
    for (const kind of await workQueueNames(instance))
      if (art === undefined || kind === art)
        processed += await drainKind(instance, kind, handler);
    return processed;
  }

  async function plane(name: string, intervallMs: number, lauf: () => unknown): Promise<void> {
    const cron = cronFuerTakt(intervallMs);
    const instance = await start();
    const queueName = ZEITPLAN_PRAEFIX + name;
    await ensureZeitplanQueue(instance, queueName, intervallMs);
    await instance.schedule(queueName, cron);
    await instance.work(queueName, { pollingIntervalSeconds: ZEITPLAN_ABRUF_SEKUNDEN }, async () => {
      await lauf();
    });
  }

  async function jobStatus(id: string) {
    const instance = await start();
    const at = id.indexOf(ID_SEPARATOR);
    const [job] = await instance.findJobs<JobDaten>(id.slice(0, at), { id: id.slice(at + 1) });
    return job ? (STATE_TO_STATUS[job.state] ?? null) : null;
  }

  async function warteschlangeZustand() {
    const instance = await start();
    const jetzt = clock ? clock.now() : Date.now();
    const zustaende = [];
    for (const kind of await workQueueNames(instance)) {
      const offen = await wartende(instance, kind);
      const aeltester = offen[0] ? new Date(offen[0].erstellt).getTime() : jetzt;
      zustaende.push({
        art: kind,
        laenge: offen.length,
        aeltesteSekunden: (jetzt - aeltester) / MS_JE_SEKUNDE,
      });
    }
    return zustaende;
  }

  async function stop() {
    if (!starting) return;
    const instance = await starting.catch(() => null);
    starting = null;
    ensured.clear();
    if (instance) await instance.stop({ graceful: true, timeout: STOP_TIMEOUT_MS, close: true });
  }

  return { enqueue, drain, plane, jobStatus, warteschlangeZustand, start, stop };
}
