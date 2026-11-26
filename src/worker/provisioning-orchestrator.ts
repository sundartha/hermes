import { makeSingleFlight } from "../single-flight.ts";
import type { Lauf, LaufMitMeldung } from "../utils/zeitplan-im-prozess.ts";
import type { handleProvisionJob as HandleProvisionJob } from "./provisioning.ts";
import { NUMBER_STATUS, PROVISIONING_JOB_STATUS } from "../begriffe/nummern.ts";
import {
  PROVIDER,
  PROVISION_NUMBER_JOB,
  SKIP_VERMERK_SCHLUESSEL,
  shouldPersistProvisionResult,
} from "../begriffe/nummern-vergabe.ts";
import { ANRUFSTART_JOB } from "../begriffe/anrufe.ts";
import { KYC_OUTBOUND_MIN } from "../begriffe/mandant.ts";
import { searchParamsForCountry, holdAmountForCountry } from "../telephony/provisioning-geo.ts";
import { auftragHaltGrund, speicherBereiche } from "../store.js";
import { PROVISION_REASON } from "../billing/provision-outcome.ts";
import { elevenlabsNummern } from "../elevenlabs/nummern-port.ts";
import { fehler as ablehnung, ok, type Ergebnis } from "../utils/ergebnis.ts";

const TAKT_INTERVALL_MS = 30_000;
const ANRUFSTART_TAKT_MS = 2000;
const FREMDER_AUFTRAG = "fremd";
const KEINE_LAGE: Besitzlage = { eigene: null, lebende: [] };
const ABGESCHALTET_MELDUNG = "Warteschlange gestoppt - Auftrag wird zurueckgestellt";

type ProvisionZustand = Parameters<typeof HandleProvisionJob>[0];
type JobDeps = Parameters<typeof HandleProvisionJob> extends [unknown, unknown, infer Deps] ? Deps : never;
interface JobErgebnis {
  skipped?: boolean;
  status?: string | null;
  number?: Nummer;
}
type NummernPort = ReturnType<typeof elevenlabsNummern>;
type SipRegistrar = ReturnType<NummernPort["sipRegistrarWennAktiv"]>;
type TrunkSchreiber = ReturnType<NummernPort["inboundTrunkSchreiberWennErlaubt"]>;

interface LaufDeps {
  provisioner: JobDeps["provisioner"];
  billing?: JobDeps["billing"];
  sipRegistrar?: SipRegistrar;
  inboundTrunkSchreiber?: TrunkSchreiber;
}
type JobOptionen = ReturnType<typeof jobOptionsFor>;
type Taktgeber = ReturnType<typeof setInterval>;

type ElevenlabsKonfig = Parameters<ReturnType<typeof elevenlabsNummern>["sipRegistrarWennAktiv"]>[0] &
  Parameters<ReturnType<typeof elevenlabsNummern>["inboundTrunkSchreiberWennErlaubt"]>[0];

interface BillingKonfig {
  paymentEnabled: boolean;
  numberSetupFeeCents: number;
  paymentCurrency: string | undefined;
}

type Konfiguration = ElevenlabsKonfig & {
  billing: BillingKonfig;
  provisioning: {
    maxNumbers: number;
    maxNumbersPerTenant: number;
    provisioningEnabled: boolean;
    provisioningRedriveMaxAgeMs: number;
  };
};

interface Auftrag {
  kind: string;
  payload: unknown;
  idempotencyKey: string;
}

type Nummer = ProvisionZustand["numbers"][number];

interface Zustand extends ProvisionZustand {
  provisioningJobs: Bereitstellung[];
}

interface Speicher {
  withStoreLock: <T>(arbeit: () => Promise<T> | T) => Promise<T>;
  load: () => Zustand;
  save: () => void;
  stammdatenSchreiben?: (tenantId: string, schluessel: readonly string[]) => void;
  besitzLage?: () => Promise<Besitzlage>;
}

interface Besitzlage {
  eigene: string | null;
  lebende: unknown[];
}

interface FremderAuftrag {
  job: Bereitstellung;
  nummer: Nummer | null;
  instanz: string | null;
}

type Wiederaufnahme = Ergebnis<
  | { reason: "redrive"; numberId: string; jobId: string; job: Bereitstellung }
  | { reason?: undefined; number: Nummer }
>;

type JobSpur = Ergebnis<{ jobId: string }>;

interface Triggerergebnis {
  ok: boolean;
  reason: string;
  numberId?: string;
  jobId?: string;
}

interface NummernkaufBereich {
  ensureTenant: (tenantId: string) => Promise<unknown>;
  legeNummerAn: (eingabe: { tenantId: string; number: Nummer; hoechstens: number; plattformHoechstens: number }) => Promise<{ ok: boolean } | null>;
  entferneNummer: (eingabe: { tenantId: string; numberId: string }) => Promise<unknown>;
  legeAuftragAn: (eingabe: JobEingabe & { number: Nummer; jetztIso: string }) => Promise<Bereitstellung | null>;
  ladeFremdeOffeneAuftraege: (eigene: string | null) => Promise<FremderAuftrag[] | null>;
  uebernimmAuftrag: (eingabe: { tenantId: string; jobId: string; alt: string | null; neu: string | null }) => Promise<boolean>;
}

interface Orchestrator {
  startQueue: () => Promise<void>;
  stopQueue: () => Promise<boolean>;
  reiheAnrufstartEin: (callId: string) => unknown;
  plane: (name: string, intervallMs: number, lauf: Lauf | LaufMitMeldung) => Promise<void>;
  ueberfaelligeZeitplaene: () => Promise<string[]>;
  queueProvisioning: (numberId: string, tenantId: string) => Promise<JobSpur>;
  triggerTenantProvisioning: (tenantId: string) => Promise<Triggerergebnis>;
  runProvisioningDrainExclusive: () => Promise<void>;
  reconcileOrphanedProvisioning: () => Promise<void>;
  settleDueNumberMonthMeters: (optionen?: { tenantId?: string | null }) => Promise<{ gebucht: number }>;
}

interface Abhaengigkeiten {
  store: Speicher;
  config: Konfiguration;
  queue: Warteschlange;
  billing: NonNullable<JobDeps["billing"]>;
  metering: {
    recordNumberMonthMeter: (nummer: Nummer | undefined, jetztIso: string) => unknown;
    recordDueNumberMonthMeters: (
      zustand: Zustand,
      eingabe: { nowIso: string; tenantId: string | null },
    ) => Promise<{ faellig: number; gebucht: number; ohnePreis: number; fehler: number }>;
  };
  numberProvisioning: (anbieter: string) => JobDeps["provisioner"];
  handleProvisionJob: (zustand: Zustand, job: WarteschlangenJob, deps: LaufDeps & { opts: JobOptionen }) => Promise<JobErgebnis>;
  resolveProvisionRetry: (
    zustand: Zustand,
    eingabe: { tenantId: string; nowMs: number; maxAgeMs: number; maxNumbers: number; maxNumbersPerTenant: number },
  ) => Wiederaufnahme;
  audit: (aktion: string, kennung: string | null, detail: string) => unknown;
  recordProvisioningJob: (zustand: Zustand, eingabe: JobEingabe) => Bereitstellung;
  markProvisioningJob: (zustand: Zustand, jobId: string, ...ergebnis: [status: string, lastError?: unknown]) => unknown;
  classifyQueuedProvisioningJobs: (
    zustand: Zustand,
    eingabe: { nowMs: number; maxAgeMs: number; kycMinLevel: string },
  ) => { close: Bereitstellung[]; hold: { job: Bereitstellung; reason: string }[]; redrive: Bereitstellung[] };
  findNumber: (zustand: Zustand, numberId: string) => Nummer | null;
  anrufstartHandler?: ((job: WarteschlangenJob) => unknown) | null;
}

interface JobEingabe {
  numberId: string;
  tenantId: string;
  idempotencyKey: string;
}

interface Bereitstellung {
  id: string;
  numberId: string;
  tenantId: string;
  idempotencyKey: string;
}

interface WarteschlangenJob {
  idempotencyKey: string;
  payload: { numberId: string };
}

interface Warteschlange {
  enqueue: (auftrag: Auftrag) => unknown;
  drain: (handler: ((job: WarteschlangenJob) => unknown) | null, art?: string) => Promise<unknown>;
  start?: () => Promise<unknown>;
  stop?: () => Promise<unknown>;
  plane: (name: string, intervallMs: number, lauf: Lauf | LaufMitMeldung) => Promise<void>;
  ueberfaellige: () => Promise<string[]>;
}

function jobOptionsFor(number: Nummer | null, billingConfig: BillingKonfig) {
  const country = number?.country;
  const geo = searchParamsForCountry(country);
  if (!billingConfig.paymentEnabled) return geo;
  return {
    ...geo,
    holdAmountCents: holdAmountForCountry(country, billingConfig.numberSetupFeeCents),
    currency: billingConfig.paymentCurrency,
  };
}

function skippedOverFailedNumber(result: JobErgebnis) {
  return Boolean(result.skipped && result.status === NUMBER_STATUS.FAILED);
}

function isNewPaidNumber(result: JobErgebnis, billingConfig: BillingKonfig) {
  return Boolean(billingConfig.paymentEnabled && result.number);
}

function enqueueProvisioningJob(einreihen: (auftrag: Auftrag) => unknown, job: Bereitstellung) {
  return einreihen({
    kind: PROVISION_NUMBER_JOB,
    payload: { numberId: job.numberId },
    idempotencyKey: job.idempotencyKey,
  });
}

export function makeProvisioningOrchestrator({
  store,
  config,
  queue,
  billing,
  metering,
  numberProvisioning,
  handleProvisionJob,
  resolveProvisionRetry,
  audit,
  recordProvisioningJob,
  markProvisioningJob,
  classifyQueuedProvisioningJobs,
  findNumber,
  anrufstartHandler = null,
}: Abhaengigkeiten): Orchestrator {
  const bereiche: { nummernkauf: NummernkaufBereich } = speicherBereiche(store);
  let gestoppt = false;

  function einreihen(auftrag: Auftrag) {
    if (gestoppt) return Promise.resolve(null);
    return queue.enqueue(auftrag);
  }

  async function jobAnlegen(zustand: Zustand, eingabe: JobEingabe) {
    const number = findNumber(zustand, eingabe.numberId);
    if (!number) return recordProvisioningJob(zustand, eingabe);
    const inDatenbank = await bereiche.nummernkauf.legeAuftragAn({
      ...eingabe,
      number,
      jetztIso: new Date().toISOString(),
    });
    if (!inDatenbank) return recordProvisioningJob(zustand, eingabe);
    const vorhanden = zustand.provisioningJobs.find((job) => job.idempotencyKey === eingabe.idempotencyKey);
    if (vorhanden) return vorhanden;
    zustand.provisioningJobs.push(inDatenbank);
    return inDatenbank;
  }

  async function nummerUnterSperre(zustand: Zustand, ergebnis: Wiederaufnahme, tenantId: string): Promise<Ergebnis<never> | null> {
    if (!ergebnis.ok || ergebnis.wert.reason === PROVISION_REASON.REDRIVE) return null;
    const { number } = ergebnis.wert;
    const stelle = zustand.numbers.indexOf(number);
    zustand.numbers.splice(stelle, 1);
    const ausDatenbank = () => bereiche.nummernkauf.entferneNummer({ tenantId, numberId: number.id });
    let gebucht;
    try {
      gebucht = await bereiche.nummernkauf.legeNummerAn({
        tenantId,
        number,
        hoechstens: Math.min(1, config.provisioning.maxNumbersPerTenant),
        plattformHoechstens: config.provisioning.maxNumbers,
      });
    } catch (fehler) {
      await ausDatenbank().catch(() => undefined);
      throw fehler;
    }
    if (gebucht && !gebucht.ok) {
      await ausDatenbank();
      return ablehnung(PROVISION_REASON.ALREADY_PROVISIONED);
    }
    zustand.numbers.splice(stelle, 0, number);
    return null;
  }

  async function queueProvisioning(numberId: string, tenantId: string): Promise<JobSpur> {
    const idempotencyKey = `provision_${numberId}`;
    return store
      .withStoreLock(async (): Promise<JobSpur> => {
        const zustand = store.load();
        const job = await jobAnlegen(zustand, { numberId, tenantId, idempotencyKey });
        store.save();
        return ok({ jobId: job.id });
      })
      .then(async (res) => {
        await einreihen({ kind: PROVISION_NUMBER_JOB, payload: { numberId }, idempotencyKey });
        return res;
      })
      .catch((fehler: unknown): JobSpur => {
        console.error("[provision] Job-Spur fehlgeschlagen:", Reflect.get(Object(fehler), "message"));
        return ablehnung(PROVISION_REASON.PERSIST_ERROR);
      });
  }

  async function triggerTenantProvisioning(tenantId: string) {
    await bereiche.nummernkauf.ensureTenant(tenantId);
    await settleDueNumberMonthMeters({ tenantId });
    const numberResult = await store
      .withStoreLock(async () => {
        const zustand = store.load();
        const retry = resolveProvisionRetry(zustand, {
          tenantId,
          nowMs: Date.now(),
          maxAgeMs: config.provisioning.provisioningRedriveMaxAgeMs,
          maxNumbers: config.provisioning.maxNumbers,
          maxNumbersPerTenant: config.provisioning.maxNumbersPerTenant,
        });
        const abgelehnt = await nummerUnterSperre(zustand, retry, tenantId);
        if (abgelehnt) return abgelehnt;
        const grund = retry.ok ? undefined : retry.fehler;
        if (shouldPersistProvisionResult({ ok: retry.ok, reason: grund })) {
          store.save();
          store.stammdatenSchreiben?.(tenantId, SKIP_VERMERK_SCHLUESSEL);
        }
        return retry;
      })
      .catch((fehler: unknown) => {
        console.error(
          "[webhook-provision] Persistenz fehlgeschlagen:",
          Reflect.get(Object(fehler), "message"),
        );
        return ablehnung(PROVISION_REASON.PERSIST_ERROR);
      });
    if (!numberResult.ok) {
      if (numberResult.fehler !== PROVISION_REASON.ALREADY_PROVISIONED)
        audit("webhook_provision_skipped", null, `tenant=${tenantId} grund=${numberResult.fehler}`);
      return { ok: false, reason: numberResult.fehler };
    }
    const vergabe = numberResult.wert;
    const numberId = vergabe.reason === PROVISION_REASON.REDRIVE ? vergabe.numberId : vergabe.number.id;
    if (!config.provisioning.provisioningEnabled) return { ok: true, reason: PROVISION_REASON.DRY_RUN, numberId };
    if (vergabe.reason === PROVISION_REASON.REDRIVE) {
      redriveProvisioningJobs([vergabe.job]);
      return { ok: true, reason: PROVISION_REASON.REDRIVE, numberId, jobId: vergabe.jobId };
    }
    const jobRes = await queueProvisioning(numberId, tenantId);
    if (!jobRes.ok) return { ok: false, reason: PROVISION_REASON.PERSIST_ERROR };
    runProvisioningDrainExclusive().catch((fehler: unknown) => {
      console.error("[provision-drain]", Reflect.get(Object(fehler), "message"));
    });
    return { ok: true, reason: PROVISION_REASON.QUEUED, numberId, jobId: jobRes.wert.jobId };
  }

  async function runQueuedJob(state: Zustand, queuedJob: WarteschlangenJob, deps: LaufDeps) {
    if (gestoppt) throw new Error(ABGESCHALTET_MELDUNG);
    const record = state.provisioningJobs.find(
      (eintrag) => eintrag.idempotencyKey === queuedJob.idempotencyKey,
    );
    const opts = jobOptionsFor(findNumber(state, queuedJob.payload.numberId), config.billing);
    let result;
    try {
      result = await handleProvisionJob(state, queuedJob, { ...deps, opts });
      if (skippedOverFailedNumber(result)) return;
      if (record) markProvisioningJob(state, record.id, PROVISIONING_JOB_STATUS.DONE);
      store.save();
    } catch (fehler) {
      if (record)
        markProvisioningJob(
          state,
          record.id,
          PROVISIONING_JOB_STATUS.FAILED,
          Reflect.get(Object(fehler), "message"),
        );
      store.save();
      console.error("[provision-worker]", Reflect.get(Object(fehler), "message"));
      throw fehler;
    }
    meterNewNumber(result);
  }

  function meterNewNumber(result: JobErgebnis) {
    if (!isNewPaidNumber(result, config.billing)) return;
    try {
      metering.recordNumberMonthMeter(result.number, new Date().toISOString());
    } catch (fehler) {
      console.error(
        "[provision-worker] Monatsbeleg fehlgeschlagen:",
        Reflect.get(Object(fehler), "message"),
      );
    }
  }

  async function runProvisioningDrain() {
    if (gestoppt) return;
    const state = store.load();
    const deps: LaufDeps = { provisioner: numberProvisioning(PROVIDER.TELNYX) };
    deps.sipRegistrar = elevenlabsNummern().sipRegistrarWennAktiv(config);
    deps.inboundTrunkSchreiber = elevenlabsNummern().inboundTrunkSchreiberWennErlaubt(config);
    if (config.billing.paymentEnabled) deps.billing = billing;
    await queue.drain((queuedJob) => runQueuedJob(state, queuedJob, deps), PROVISION_NUMBER_JOB);
  }

  const runProvisioningDrainExclusive = makeSingleFlight(runProvisioningDrain);

  function redriveProvisioningJobs(jobs: Bereitstellung[]) {
    if (!jobs.length) return;
    Promise.all(jobs.map((job) => enqueueProvisioningJob(einreihen, job)))
      .then(() => runProvisioningDrainExclusive())
      .catch((fehler: unknown) => {
        console.error("[provision-redrive]", Reflect.get(Object(fehler), "message"));
      });
  }

  function closeSettledProvisioningJobs(jobs: Bereitstellung[]) {
    if (!jobs.length) return;
    store
      .withStoreLock(() => {
        const zustand = store.load();
        for (const eintrag of jobs)
          markProvisioningJob(zustand, eintrag.id, PROVISIONING_JOB_STATUS.DONE);
        store.save();
      })
      .catch((fehler: unknown) => {
        console.error("[provision-reconcile] close:", Reflect.get(Object(fehler), "message"));
      });
  }

  const gemeldeterHalt = new Map<string, string>();

  function meldeHalt(job: Bereitstellung, grund: string) {
    if (gemeldeterHalt.get(job.id) === grund) return;
    gemeldeterHalt.set(job.id, grund);
    console.warn(
      `[provision-reconcile] hold job=${job.id} number=${job.numberId} tenant=${job.tenantId} grund=${grund}`,
    );
  }

  async function versuchtUebernahme(job: Bereitstellung, alt: string | null, lage: Besitzlage) {
    try {
      return await bereiche.nummernkauf.uebernimmAuftrag({ tenantId: job.tenantId, jobId: job.id, alt, neu: lage.eigene });
    } catch {
      console.error(`[provision-reconcile] Uebernahme fehlgeschlagen job=${job.id}`);
      return false;
    }
  }

  async function uebernehmbareAuftraege(jobs: Bereitstellung[], lage: Besitzlage, besitzer: Map<string, string | null>) {
    const frei: Bereitstellung[] = [];
    for (const job of jobs) {
      const alt = besitzer.get(job.id) ?? null;
      const grund = auftragHaltGrund(alt, lage);
      if (grund === FREMDER_AUFTRAG) {
        console.log(`[provision-reconcile] fremd job=${job.id}`);
        continue;
      }
      if (grund) {
        meldeHalt(job, grund);
        continue;
      }
      if (await versuchtUebernahme(job, alt, lage)) frei.push(job);
    }
    return frei;
  }

  async function reconcileOrphanedJobs() {
    const lage = (await store.besitzLage?.()) ?? KEINE_LAGE;
    const kandidaten = await bereiche.nummernkauf.ladeFremdeOffeneAuftraege(lage.eigene);
    const zustand = store.load();
    const buckets = classifyQueuedProvisioningJobs(
      kandidaten
        ? {
            ...zustand,
            provisioningJobs: kandidaten.map(({ job }) => job),
            numbers: kandidaten.flatMap(({ nummer }) => (nummer ? [nummer] : [])),
          }
        : zustand,
      {
        nowMs: Date.now(),
        maxAgeMs: config.provisioning.provisioningRedriveMaxAgeMs,
        kycMinLevel: KYC_OUTBOUND_MIN,
      },
    );
    closeSettledProvisioningJobs(buckets.close);
    const besitzer = new Map((kandidaten ?? []).map(({ job, instanz }) => [job.id, instanz]));
    for (const { job, reason } of buckets.hold)
      if (auftragHaltGrund(besitzer.get(job.id) ?? null, lage) !== FREMDER_AUFTRAG) meldeHalt(job, reason);
    redriveProvisioningJobs(await uebernehmbareAuftraege(buckets.redrive, lage, besitzer));
  }

  const reconcileOrphanedProvisioning = makeSingleFlight(async () => {
    if (!config.provisioning.provisioningEnabled) return;
    try {
      await reconcileOrphanedJobs();
    } catch {
      console.error("[provision-reconcile] Abgleich der offenen Auftraege fehlgeschlagen");
    }
  });

  let anrufstartGestoppt = false;

  async function runAnrufstartDrain() {
    if (anrufstartGestoppt) return;
    await queue.drain(anrufstartHandler, ANRUFSTART_JOB);
  }

  const runAnrufstartDrainExclusive = makeSingleFlight(runAnrufstartDrain);

  function macheTakt(abruf: () => Promise<void>, praefix: string) {
    let laeuft = false;
    return function beginneTaktAbruf() {
      if (laeuft) return;
      laeuft = true;
      abruf()
        .catch((fehler: unknown) => {
          console.error(praefix, Reflect.get(Object(fehler), "message"));
        })
        .finally(() => {
          laeuft = false;
        });
    };
  }

  let takt: Taktgeber | undefined;
  let anrufstartTakt: Taktgeber | undefined;

  async function startQueue() {
    if (anrufstartHandler)
      anrufstartTakt = setInterval(
        macheTakt(runAnrufstartDrainExclusive, "[anrufstart-takt]"),
        ANRUFSTART_TAKT_MS,
      ).unref();
    if (typeof queue.start !== "function") return;
    await queue.start();
    if (config.provisioning.provisioningEnabled)
      takt = setInterval(
        macheTakt(runProvisioningDrainExclusive, "[provision-takt]"),
        TAKT_INTERVALL_MS,
      ).unref();
  }

  async function stopQueue() {
    clearInterval(anrufstartTakt);
    anrufstartGestoppt = true;
    await runAnrufstartDrainExclusive();
    if (typeof queue.stop !== "function") return false;
    clearInterval(takt);
    gestoppt = true;
    await runProvisioningDrainExclusive();
    await queue.stop();
    return true;
  }

  const plane = (name: string, intervallMs: number, lauf: Lauf | LaufMitMeldung) => queue.plane(name, intervallMs, lauf);
  const ueberfaelligeZeitplaene = () => queue.ueberfaellige();

  async function settleDueNumberMonthMeters({ tenantId = null }: { tenantId?: string | null } = {}) {
    if (!config.billing.paymentEnabled) return { gebucht: 0 };
    try {
      const bilanz = await store.withStoreLock(() =>
        metering.recordDueNumberMonthMeters(store.load(), {
          nowIso: new Date().toISOString(),
          tenantId,
        }),
      );
      if (bilanz.faellig)
        console.log(
          `[number-month] faellig=${String(bilanz.faellig)} gebucht=${String(bilanz.gebucht)} ` +
            `ohne_preis=${String(bilanz.ohnePreis)} fehler=${String(bilanz.fehler)}`,
        );
      return { gebucht: bilanz.gebucht };
    } catch (fehler) {
      console.error("[number-month] Buchung fehlgeschlagen:", Reflect.get(Object(fehler), "message"));
      return { gebucht: 0 };
    }
  }

  const reiheAnrufstartEin = (callId: string) =>
    einreihen({ kind: ANRUFSTART_JOB, payload: { callId }, idempotencyKey: `${ANRUFSTART_JOB}_${callId}` });

  return {
    startQueue,
    stopQueue,
    reiheAnrufstartEin,
    plane,
    ueberfaelligeZeitplaene,
    queueProvisioning,
    triggerTenantProvisioning,
    runProvisioningDrainExclusive,
    reconcileOrphanedProvisioning,
    settleDueNumberMonthMeters,
  };
}
