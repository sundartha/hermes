const DEFAULT_SCHEMA = "pgboss";
const DEAD_LETTER_SUFFIX = "_totpost";
const POOL_MAX = 4;
const RETRY_LIMIT = 3;
const RETRY_DELAY_SECONDS = 30;
const RETRY_DELAY_MAX_SECONDS = 600;
const EXPIRE_SECONDS = 300;
const RETENTION_SECONDS = 604800;
const DELETE_AFTER_SECONDS = 86400;
const DEAD_LETTER_RETENTION_SECONDS = 2592000;
const FETCH_BATCH_SIZE = 5;
const STOP_TIMEOUT_MS = 20000;
const ID_SEPARATOR = "/";

const STATE_TO_STATUS = Object.freeze({
  created: "queued",
  retry: "queued",
  active: "queued",
  completed: "done",
  failed: "failed",
  cancelled: "failed",
});

function publicId(kind, id) {
  return `${kind}${ID_SEPARATOR}${id}`;
}

function toQueuedJob(job) {
  return {
    id: publicId(job.name, job.id),
    kind: job.name,
    payload: job.data.payload,
    idempotencyKey: job.data.idempotencyKey,
  };
}

async function createBoss({ connectionString, schema, poolMax, clock, logger, bossOptions }) {
  const { PgBoss } = await import("pg-boss");
  const instance = new PgBoss({
    connectionString,
    schema,
    max: poolMax,
    schedule: false,
    ...(clock ? { clock } : {}),
    ...bossOptions,
  });
  instance.on("error", (err) => logger.error("[queue] pg-boss:", err.message));
  await instance.start();
  return instance;
}

async function ensureQueue(instance, kind) {
  await instance.createQueue(kind + DEAD_LETTER_SUFFIX, {
    retentionSeconds: DEAD_LETTER_RETENTION_SECONDS,
    deleteAfterSeconds: DEAD_LETTER_RETENTION_SECONDS,
  });
  await instance.createQueue(kind, {
    policy: "exclusive",
    deadLetter: kind + DEAD_LETTER_SUFFIX,
    retryLimit: RETRY_LIMIT,
    retryDelay: RETRY_DELAY_SECONDS,
    retryBackoff: true,
    retryDelayMax: RETRY_DELAY_MAX_SECONDS,
    expireInSeconds: EXPIRE_SECONDS,
    retentionSeconds: RETENTION_SECONDS,
    deleteAfterSeconds: DELETE_AFTER_SECONDS,
  });
}

async function workQueueNames(instance) {
  const queues = await instance.getQueues();
  return queues.map((queue) => queue.name).filter((name) => !name.endsWith(DEAD_LETTER_SUFFIX));
}

async function settle(instance, job, handler) {
  try {
    await handler(toQueuedJob(job));
    await instance.complete(job.name, job.id);
  } catch (err) {
    await instance.fail(job.name, job.id, { message: String(err?.message ?? err) });
  }
}

async function drainKind(instance, kind, handler) {
  let processed = 0;
  for (;;) {
    const jobs = await instance.fetch(kind, { batchSize: FETCH_BATCH_SIZE });
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
} = {}) {
  if (!bossOptions.db && (typeof connectionString !== "string" || connectionString === ""))
    throw new Error(
      "pg-boss-Queue braucht DATABASE_URL (direkte Verbindung, kein Transaktions-Pooler)",
    );
  let starting = null;
  const ensured = new Map();

  function start() {
    starting ??= createBoss({
      connectionString,
      schema,
      poolMax,
      clock,
      logger,
      bossOptions,
    }).catch((err) => {
      starting = null;
      throw err;
    });
    return starting;
  }

  async function enqueue({ kind, payload, idempotencyKey }) {
    if (typeof idempotencyKey !== "string" || idempotencyKey === "")
      throw new TypeError("enqueue: idempotencyKey muss ein nicht-leerer String sein");
    const instance = await start();
    if (!ensured.has(kind))
      ensured.set(
        kind,
        ensureQueue(instance, kind).catch((err) => {
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
    const [existing] = await instance.findJobs(kind, { key: idempotencyKey });
    return existing ? publicId(kind, existing.id) : null;
  }

  async function drain(handler) {
    const instance = await start();
    let processed = 0;
    for (const kind of await workQueueNames(instance))
      processed += await drainKind(instance, kind, handler);
    return processed;
  }

  async function jobStatus(id) {
    const instance = await start();
    const at = id.indexOf(ID_SEPARATOR);
    const job = await instance.getJobById(id.slice(0, at), id.slice(at + 1));
    return job ? (STATE_TO_STATUS[job.state] ?? null) : null;
  }

  async function stop() {
    if (!starting) return;
    const instance = await starting.catch(() => null);
    starting = null;
    ensured.clear();
    if (instance) await instance.stop({ graceful: true, timeout: STOP_TIMEOUT_MS, close: true });
  }

  return { enqueue, drain, jobStatus, start, stop };
}
