// Queue-Port (P6b2): provider-unabhaengiger Vertrag fuer asynchrone Jobs. Reine
// JSDoc-Typdefs (kein Laufzeit-Code), Muster wie billing/ports.js. Domaenensprache:
// ein Job ist {kind, payload, idempotencyKey}; der Adapter haelt KEINEN Provider-
// /pg-boss-Typ nach aussen. drain() ist deterministisch (Tests rufen es; KEIN Timer).

/**
 * @typedef {Object} Job
 * @property {string} kind            - Job-Typ (P6b2: nur "provision_number")
 * @property {Object} payload         - serialisierbare Nutzlast (z.B. {numberId})
 * @property {string} idempotencyKey  - Doppel-Enqueue/Doppel-Ausfuehrung verhindern
 */

/**
 * @typedef {Object} QueuePort
 * @property {(job: Job) => string} enqueue
 *   Reiht einen Job ein, liefert die jobId. Gleicher idempotencyKey -> kein zweiter Job.
 * @property {(handler: (job: Job) => Promise<void>) => Promise<number>} drain
 *   Fuehrt ALLE wartenden Jobs deterministisch aus (handler je Job), liefert die
 *   Zahl verarbeiteter Jobs. KEIN Timer/Intervall (Tests rufen drain explizit).
 * @property {(jobId: string) => (string|null)} jobStatus
 *   Status eines Jobs (queued|done|failed) oder null (unbekannt).
 */
export {};
