// Postgres-Store-Backend hinter STORE_BACKEND=pg. Haelt einen synchron
// gespiegelten In-Memory-Zustand (gleicher Shape wie das json-Backend), der bei
// init() einmal aus der DB hydriert wird; jede Mutation laeuft synchron gegen den
// Spiegel (state-ops.js, geteilte Fachlogik) und stoesst danach einen DB-Flush an.
//
// WARUM der Spiegel: die Store-Signaturen sind synchron und werden von den
// Callern teils ohne await aufgerufen (Bridge-Event-Handler, store.save()). pg ist
// async. Der Spiegel ist die kleinste Aenderung, die Contract-Parity zum
// json-Backend erreicht, ohne eine der Signaturen oder einen Caller zu
// veraendern. save() ist deshalb KEIN No-Op: die mutate-then-save()-Stellen
// (call.twilioSid/summary/objectiveAchieved) wirken auf eine Spiegel-Referenz aus
// getCall(); save() flusht den Spiegel zurueck in die DB.
//
// AKZEPTIERTES RESTRISIKO (P3b, single-tenant/ein-Prozess): bei mehreren
// Prozessen kann der Spiegel von der DB driften - gleichwertig zur heutigen
// json-Annahme (ein Prozess haelt den Zustand). Multi-Prozess-Korrektheit ist
// spaeterer Scope, nicht P3b.
import { config } from "../config.js";
import * as ops from "./state-ops.js";
import { BOOTSTRAP_TENANT_ID, DEFAULT_PROVIDER } from "./defaults.js";
import { migrate } from "../db/migrate.js";

// Owner-Tenant zentral in defaults.js; hier re-exportiert, weil Tests + pg-helpers
// die Konstante historisch von store/pg.js importieren (Import-Stabilitaet).
export { BOOTSTRAP_TENANT_ID };

// makePgStore(runner) -> Objekt mit den Store-Funktionen (Namensliste in store.js).
// runner-Vertrag:
//   withClient(fn) : ruft fn(client) auf EINER Verbindung; client.query(text,
//                    params)->{rows} und client.exec(sqlScript) (Mehrfach-DDL).
// KEINE DB-Verbindung hier konstruiert (DIP): Pool/Adapter wird injiziert. init()
// muss vor dem ersten Zugriff erwartet werden (Migration + Hydrierung).
export function makePgStore(runner) {
  let state = null;
  // Serialisiert die DB-Flushes: Mutationen rufen save() synchron, der DB-Write
  // wird an diese Kette gehaengt, damit Flushes nicht ineinander laufen.
  let flushChain = Promise.resolve();

  function requireState() {
    if (!state) throw new Error("pg-Store nicht initialisiert - erst await store.init() aufrufen");
    return state;
  }

  // Migriert + hydriert den Spiegel einmalig aus der DB. Schema/Seeding/Hydrierung
  // laufen auf EINER Verbindung (withClient), damit die RLS-GUC waehrend der
  // tenant-scoped Reads/Inserts gesetzt bleibt (auf einem Pool waere sonst jede
  // Anweisung eine andere Session). Die GUC wird VOR dem Seeding gesetzt, sonst
  // wuerde die RLS-WITH-CHECK die Owner-Inserts unter einer nicht-privilegierten
  // DB-Rolle blocken.
  async function init() {
    await runner.withClient(async (client) => {
      await setTenant(client, BOOTSTRAP_TENANT_ID);
      await migrate(client, BOOTSTRAP_TENANT_ID);
      state = await hydrate(client);
      // Bootstrap-Zeile gezielt flushen (flushTenants ist RLS-frei -> unter der init-GUC
      // zulaessig). EINE Quelle fuer beide Boot-Seeds (idp_subject + kyc_level), G5.
      const flushBootstrap = () =>
        flushTenants(
          client,
          state.tenants.filter((t) => t.id === BOOTSTRAP_TENANT_ID),
        );
      // AM6: Owner-OAuth-Identitaet (OWNER_IDP_SUBJECT) idempotent an den Bootstrap-Tenant
      // binden. Nur bei echter Mutation (set-if-absent) wird die bootstrap-Zeile geflusht;
      // danach ist idp_subject persistent -> Folge-Boots sind No-Op/byte-identisch. P2b bleibt
      // sonst: kein config-derived Daten-Seed (Erst-Setup ueber scripts/bootstrap-tenant.js).
      if (ops.seedBootstrapIdpSubject(state, config.ownerIdpSubject, BOOTSTRAP_TENANT_ID))
        await flushBootstrap();
      // Phase outbound-p1: Owner-Tenant idempotent auf id_verified heilen (set-if-absent),
      // damit er den fail-closed kycReached-Flip ueberlebt. kyc_level round-trippt bereits
      // (rowToTenant/flushTenants). LIVE ist pg -> heilt den realen Prod-Owner beim naechsten
      // Boot ohne Shell (Free-Tier hat kein preDeploy).
      if (ops.seedBootstrapKyc(state, BOOTSTRAP_TENANT_ID)) await flushBootstrap();
    });
    return state;
  }

  // Flusht den kompletten Spiegel in die DB (eine Transaktion auf einer
  // Verbindung, RLS-GUC gesetzt). Full-Upsert + Delete-Missing spiegelt das
  // heutige json-Verhalten (kompletter Datei-Rewrite pro save) und macht jeden
  // mutate-then-save()-Pfad korrekt. save() wird synchron gerufen; der DB-Write
  // haengt an flushChain, damit Flushes nicht ineinander laufen.
  // preFlush (optional): eine zusaetzliche Aktion auf DEMSELBEN Client, INNERHALB
  // derselben Transaktion wie der Flush (P16/G26: aktuell nur eraseTenantData -
  // Hard-Delete der erfassten Call-Zeilen, siehe dort). Ein Rollback des Flush
  // (z.B. transienter DB-Fehler) rollt damit auch den preFlush zurueck - keine
  // teilweise DSGVO-Loeschung. Ohne Argument identisch zum bisherigen save().
  function save(preFlush) {
    const snapshot = requireState();
    flushChain = flushChain
      .then(() => runner.withClient((client) => flush(client, snapshot, preFlush)))
      .catch((err) => {
        console.error("[pg] Flush fehlgeschlagen:", err.message);
      });
    return flushChain;
  }

  return {
    init,
    load: () => requireState(),
    save,
    newId: ops.newId,

    createCall(input) {
      const call = ops.createCall(requireState(), input);
      save();
      return call;
    },
    getCall: (id) => ops.getCall(requireState(), id),
    addTranscript(callId, role, text) {
      if (ops.addTranscript(requireState(), callId, role, text)) save();
    },
    purgeTranscript(callId) {
      if (ops.purgeTranscript(requireState(), callId)) save();
    },
    markAnswered(callId) {
      const { call, changed } = ops.markAnswered(requireState(), callId);
      if (changed) save();
      return call;
    },
    endCallRecord(callId, status = "completed") {
      const { call, changed } = ops.endCallRecord(requireState(), callId, status);
      if (changed) save();
      return call;
    },
    // Persistierter Summary-SMS-Dedup-Marker (F2 P9): Wrapper-Parity zu json.js. Der
    // Flush schreibt summary_sms_sent_at am call-Record -> ueberlebt den Restart (M2).
    markSummarySmsSent(callId) {
      const { call, changed } = ops.markSummarySmsSent(requireState(), callId);
      if (changed) save();
      return call;
    },
    // CDF1 (Report #2 5.4): persistierter Fehlergrund - Wrapper-Parity zu json.js. Der
    // Flush schreibt failure_reason am call-Record (INSERT + ON CONFLICT DO UPDATE).
    recordFailureReason(callId, reason) {
      const { call, changed } = ops.recordFailureReason(requireState(), callId, reason);
      if (changed) save();
      return call;
    },
    countOutboundCallsSince: (sinceIso, filters = {}) =>
      ops.countOutboundCallsSince(requireState(), sinceIso, filters),
    findTenantByNumber: (e164) => ops.findTenantByNumber(requireState(), e164),
    // Schwester-Query + Sprach-Aufloesung (F1 Phase 4). Reine Leser auf dem Spiegel.
    numberRecordByE164: (e164) => ops.numberRecordByE164(requireState(), e164),
    resolveCallLanguage: (args) => ops.resolveCallLanguage(requireState(), args),

    addActionItem(callId, text, type = "todo") {
      const item = ops.addActionItem(requireState(), callId, text, type);
      save();
      return item;
    },
    toggleActionItem(id) {
      const item = ops.toggleActionItem(requireState(), id);
      if (item) save();
      return item;
    },

    getCalendar: (tenantId) => ops.getCalendar(requireState(), tenantId),
    addCalendarEvent(tenantId, title, startIso, endIso) {
      const ev = ops.addCalendarEvent(requireState(), tenantId, title, startIso, endIso);
      save();
      return ev;
    },
    findConflict: (tenantId, startIso, endIso) =>
      ops.findConflict(requireState(), tenantId, startIso, endIso),

    // Tenant-Kontext-Seam (I0): liest den hydrierten Spiegel (kein DB-Roundtrip).
    // Owner-Identitaet nicht mehr config-derived (P2b): leerer ownerName-Fallback ""
    // (Wrapper-Parity zu json.js); der Owner-Tenant traegt ownerName im Store.
    tenantContext: (tenantId) => ops.tenantContext(requireState(), "", tenantId),

    trackUsage(tenantId, inputTokens, outputTokens, cfg) {
      const usage = ops.trackUsage(requireState(), tenantId, inputTokens, outputTokens, cfg);
      save();
      return usage;
    },
    budgetExceeded: (tenantId, cfg) => ops.budgetExceeded(requireState(), tenantId, cfg),
    globalBudgetExceeded: (cfg) => ops.globalBudgetExceeded(requireState(), cfg),
    // Vorab-Reservierung (outbound-p1c): reine Query, kein save (wie budgetExceeded).
    reserveExceedsBudget: (tenantId, reserveCents, cfg) =>
      ops.reserveExceedsBudget(requireState(), tenantId, reserveCents, cfg),
    // Reconcile (outbound-p1c): Mutation -> save (wie trackUsage). flushUsage persistiert
    // den costEur-Bucket des Tenants.
    addVoiceUsageCostCents(tenantId, costCents) {
      const usage = ops.addVoiceUsageCostCents(requireState(), tenantId, costCents);
      save();
      return usage;
    },
    // Lese-Zugriff auf den Usage-Bucket eines Tenants (I5): liest den Spiegel
    // (kein DB-Roundtrip), Wrapper-Parity zu json.js. Reine Query, kein save.
    usageOf: (tenantId) => ops.usageOf(requireState(), tenantId),

    // ---- Reserve-Ledger (OUT-05): Wrapper-Parity zu json.js ----
    // Reine In-Memory-Mutation auf dem Spiegel (kein save/Flush): reservations wird von
    // flush() NIE geschrieben (keine Spalte) -> strukturell ephemer, wie im json-Backend.
    // reservationOf ist reine Query (analog usageOf).
    tryReserveOutboundBudget: (tenantId, reserveCents, cfg) =>
      ops.tryReserveOutboundBudget(requireState(), tenantId, reserveCents, cfg),
    releaseOutboundReserve: (call) => ops.releaseOutboundReserve(requireState(), call),
    reservationOf: (tenantId) => ops.reservationFor(requireState(), tenantId),

    // ---- Per-Tenant-Budget + Metering (P6b3): Wrapper-Parity zu json.js ----
    setTenantBudget(tenantId, amounts) {
      const row = ops.setTenantBudget(requireState(), tenantId, amounts);
      save();
      return row;
    },
    recordUsageEvent(input) {
      const event = ops.recordUsageEvent(requireState(), input);
      save();
      return event;
    },
    // Tages-Cap-Zaehler der gesendeten Summary-SMS (F2 P8): liest den Spiegel
    // (kein DB-Roundtrip), Wrapper-Parity zu json.js. Reine Query, kein save.
    dailySmsCount: (tenantId, sinceIso) => ops.dailySmsCount(requireState(), tenantId, sinceIso),
    // Minuten-Kontingent-Gate-Praedikat (B1b): liest den hydrierten usage_event-Spiegel
    // (kein DB-Roundtrip, KEINE neue SQL), Wrapper-Parity zu json.js. Reine Query, kein save.
    planMinutesExceeded: (tenantId, opts) => ops.planMinutesExceeded(requireState(), tenantId, opts),
    pendingMeterEvents: () => ops.pendingMeterEvents(requireState()),
    markMeterEventsSent(eventIds) {
      const n = ops.markMeterEventsSent(requireState(), eventIds);
      if (n) save();
      return n;
    },

    // ---- KYC (P6b4): Wrapper-Parity zu json.js ----
    setKycLevel(tenantId, level) {
      const tenant = ops.setKycLevel(requireState(), tenantId, level);
      save();
      return tenant;
    },
    kycReached: (tenantId, minLevel) => ops.kycReached(requireState(), tenantId, minLevel),

    // ---- Abo-gekoppeltes Outbound-Allowlist-Gate (W5): Wrapper-Parity zu json.js ----
    tenantActiveSubscriber: (tenantId, minLevel) =>
      ops.tenantActiveSubscriber(requireState(), tenantId, minLevel),
    tenantInactive: (tenantId) => ops.tenantInactive(requireState(), tenantId),

    // ---- Stripe-Customer/Karte pro Tenant (Pay1): Wrapper-Parity zu json.js ----
    setTenantStripe(tenantId, patch) {
      const tenant = ops.setTenantStripe(requireState(), tenantId, patch);
      save();
      return tenant;
    },
    tenantStripe: (tenantId) => ops.tenantStripe(requireState(), tenantId),

    // ---- Abo-Referenzen pro Tenant (W4): Wrapper-Parity zu json.js ----
    setTenantSubscription(tenantId, patch) {
      const tenant = ops.setTenantSubscription(requireState(), tenantId, patch);
      save();
      return tenant;
    },
    tenantSubscription: (tenantId) => ops.tenantSubscription(requireState(), tenantId),
    findTenantBySubscription: (subscriptionId) =>
      ops.findTenantBySubscription(requireState(), subscriptionId),

    // ---- Private Summary-Nummer pro Tenant (F2): Wrapper-Parity zu json.js ----
    setPrivateNumber(tenantId, raw) {
      const tenant = ops.setPrivateNumber(requireState(), tenantId, raw);
      save();
      return tenant;
    },
    tenantPrivateNumber: (tenantId) => ops.tenantPrivateNumber(requireState(), tenantId),

    // ---- Geo-Location pro Tenant (F1): Wrapper-Parity zu json.js ----
    setTenantGeo(tenantId, patch) {
      const tenant = ops.setTenantGeo(requireState(), tenantId, patch);
      save();
      return tenant;
    },

    addNotification(title, body, callId) {
      ops.addNotification(requireState(), title, body, callId);
      save();
    },

    // Owner-/Bestandsnummer direkt 'active' eintragen (CLI scripts/seed-owner-number.js):
    // die EINE legitime Ausnahme zur Transition-Kette (idempotent ueber normNum). Der
    // neue Spiegel-Eintrag wird vom save()->flushTenantScope->flushNumbers persistiert.
    seedBootstrapNumber(e164, tenantId, provider) {
      ops.seedBootstrapNumber(requireState(), e164, tenantId, provider);
      return save();
    },

    // Bootstrap-Tenant (CLI scripts/bootstrap-tenant.js, P2b): Tenant-Record + aktive
    // Bestandsnummer in EINER Mutation. save() flusht beides (flushTenants + flushNumbers).
    bootstrapTenant(e164, tenantId, provider) {
      ops.bootstrapTenant(requireState(), e164, tenantId, provider);
      return save();
    },

    // Default = config.retentionDays, identisch zum json-Backend: der einzige
    // Produktiv-Caller (server.js) ruft no-arg. Ohne diesen Default waere die
    // DSGVO-Retention unter STORE_BACKEND=pg still abgeschaltet (Absolute Regel).
    pruneOldData(days = config.retentionDays) {
      const removed = ops.pruneOldData(requireState(), days);
      if (removed.calls || removed.notifications || removed.actionItems) save();
      return removed;
    },

    // Per-Tenant-DSGVO-Loeschung (Art. 17): mutiert den Spiegel (call-verknuepfte
    // Daten des Tenants raus). actionItems/notifications reconciled der normale Flush
    // weiterhin ueber deleteMissing mit leerer keep-Liste (DELETE WHERE tenant_id) - die
    // beiden Tabellen sind vom F8-Reconcile-Schutz nicht betroffen. Die call-Zeilen
    // selbst NICHT mehr: deleteMissingCallsKeepActive (F8/A6) schuetzt seit F8 jede
    // status=active-Zeile bei leerer keep-Liste - das schuetzte sonst faelschlich den
    // EIGENEN aktiven Call des Tenants vor der Loeschung (Recht auf Loeschung MUSS
    // diesen Schutz durchbrechen; der Schutz gilt nur FREMDEN/unbekannten Zeilen eines
    // Overlap-Prozesses). Deshalb: die betroffenen Call-IDs VOR der Mutation sichern
    // (dieselbe Scope-Quelle wie exportTenantData, ops.tenantCallScope - kein zweiter
    // Filter mit derselben Regel) und per preFlush unconditional hart loeschen - INNERHALB
    // derselben Transaktion wie der normale Flush (P16/G26), direkt nach BEGIN. Ein
    // Rollback des Flush rollt damit auch den Hard-Delete zurueck statt eine teilweise
    // DSGVO-Loeschung zu hinterlassen (transcript_segment faellt per ON DELETE CASCADE mit).
    eraseTenantData(tenantId) {
      const state = requireState();
      const eraseCallIds = ops.tenantCallScope(state, tenantId).calls.map((c) => c.id);
      const removed = ops.eraseTenantData(state, tenantId);
      // F2 P10: auch eine geloeschte privateNumber (PII) muss persistieren - sonst kaeme sie
      // bei einem Tenant ganz ohne Calls nach dem Restart zurueck (flushTenants schreibt NULL).
      if (removed.calls || removed.actionItems || removed.notifications || removed.privateNumber)
        save((client) => hardDeleteCalls(client, tenantId, eraseCallIds));
      return removed;
    },
    exportTenantData: (tenantId) => ops.exportTenantData(requireState(), tenantId),

    updateSettings(tenantId, patch) {
      const result = ops.updateSettings(requireState(), tenantId, patch);
      save();
      return result;
    },

    resolveProfile: (tenantId) => ops.resolveProfile(requireState(), tenantId),
    // Tenant-Aufloesung (I4): liest den hydrierten Spiegel (Wrapper-Parity zu json.js).
    resolveTenant: (idpSubject) => ops.resolveTenant(requireState(), idpSubject),

    // Nach-Boot-Spiegel-Nachzug eines einzelnen Tenants (Signup-Hydrierung). Der OIDC-
    // Web-Login (accounts.upsertOnFirstLogin) legt die tenant-Zeile NACH dem Boot in der
    // DB an; der Spiegel wird sonst nur bei init() hydriert -> ein frisch registrierter
    // Tenant fehlt in s.tenants, bis jede WRITE-Store-Op (setTenantStripe/setKycLevel/
    // setTenantSubscription/...) ueber findTenant fail-closed wirft. ensureTenant zieht
    // GENAU diesen Tenant idempotent + FAIL-SAFE nach. KRITISCH (Regel 1): es uebernimmt
    // NUR den REALEN DB-status (nie ein hartcodiertes ACTIVE) - drei Gates lesen den
    // Spiegel-status (requestNumber/tenantInactive/tenantActiveSubscriber); ein faelschlich
    // aktiver Spiegel machte einen suspendierten Tenant outbound-faehig. Eigene Methode
    // (kein ops-Wrapper): braucht runner (DB-Read) UND Spiegel zugleich.
    async ensureTenant(tenantId) {
      try {
        const state = requireState();
        return await runner.withClient(async (client) => {
          // Billiger Existenz-/Status-Read: der haeufige Fall (Tenant schon im Spiegel -
          // jeder Provision-Trigger, jeder Folge-Login) braucht nur den accounts-owned
          // status, nicht alle Spalten. KEINE Zeile -> Tenant existiert nicht in der DB
          // -> false (NIE einen Tenant aus dem Nichts erfinden).
          const statusRows = (
            await client.query(`SELECT status FROM tenant WHERE id = $1`, [tenantId])
          ).rows;
          if (statusRows.length === 0) return false;
          const present = ops.findTenant(state, tenantId);
          if (present) {
            // NUR den status nachziehen - das einzige accounts-owned, nie geflushte Feld.
            // Spiegel-eigene Felder (kyc/stripe/sub/identitaet/private_number) bleiben
            // unberuehrt, sonst clobberte der Nachzug ungeflushte Writes.
            present.status = statusRows[0].status;
            return true;
          }
          // Abwesend (frischer Web-Login nach Boot): vollen Tenant-Row holen, dann SYNCHRON
          // unmittelbar vor dem push erneut pruefen (KEIN await dazwischen): zwei parallele
          // erste Logins desselben Tenants duerfen ihn nicht doppelt in den Spiegel legen.
          const full = (
            await client.query(`SELECT ${TENANT_COLUMNS} FROM tenant WHERE id = $1`, [tenantId])
          ).rows[0];
          const raced = ops.findTenant(state, tenantId);
          if (raced) {
            raced.status = full.status;
            return true;
          }
          state.tenants.push(rowToTenant(full));
          // tenant-scoped Zeilen nachladen (settings/calls/...): fuer einen frischen Signup
          // leer (nichts angelegt), aber zukunftssicher. Eigener tenant_id-Filter je Query
          // (zweite Linie zur RLS) - kein Cross-Tenant-Leck.
          await hydrateTenantInto(client, state, tenantId);
          return true;
        });
      } catch (e) {
        // FAIL-SAFE: ein DB-Schluckauf darf den Login-/Provision-Pfad nie mit einer
        // Rejection treffen. Kein Secret im Log (nur die Meldung). Der Spiegel bleibt
        // unveraendert -> die Setter werfen weiter fail-CLOSED (kein Gate geht auf).
        console.error("[pg] ensureTenant fehlgeschlagen:", e.message);
        return false;
      }
    },
    listProfiles: () => ops.listProfiles(requireState()),
    setProfile(tenantId, patch) {
      const result = ops.setProfile(requireState(), tenantId, patch);
      save();
      return result;
    },
    deleteProfile(tenantId) {
      const ok = ops.deleteProfile(requireState(), tenantId);
      if (ok) save();
      return ok;
    },
  };
}

// Setzt die RLS-GUC fuer die laufende Verbindung (session-weit). flush setzt sie
// zusaetzlich transaktionslokal.
async function setTenant(client, tenantId) {
  await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
}

// ---- Hydrierung: DB-Zeilen -> verschachtelter Spiegel-Shape (multi-tenant, I8) ----
// Laeuft auf einer Verbindung. Liest zuerst die tenant-Tabelle (state.tenants), dann
// pro Tenant unter dessen RLS-GUC die tenant-scoped Zeilen in die Buckets/Listen.
// makeDefaultState() EINMAL (Owner-Buckets vorbelegt); pro Tenant werden Buckets
// gefuellt (settings/calendar/usage) bzw. Listen angehaengt (calls/actionItems/
// notifications/numbers). profiles sind global keyed-by-tenantId (Phase S; vormals email)
// und werden in EINEM tenant-unabhaengigen Schritt nach der Tenant-Schleife geladen.
async function hydrate(client) {
  const state = ops.makeDefaultState();
  state.tenants = await hydrateTenants(client);
  for (const tenant of state.tenants) {
    await setTenant(client, tenant.id);
    await hydrateTenantInto(client, state, tenant.id);
  }
  // Profiles global (Owner-Removal P5): an KEINEN Tenant gebunden. Die profile-Tabelle
  // haengt nicht mehr an app.current_tenant (Policy profile_global, USING(true)) - die
  // gesetzte GUC ist fuer diesen Read irrelevant. EIN Read, nicht pro Tenant.
  state.profiles = await hydrateProfiles(client);
  return state;
}

// Liest die globale profile-Tabelle (tenant_id-PK, Phase S) in die flache {tenantId: data}-
// Map des Spiegels. Tenant-unabhaengig (global, kein RLS-Filter).
async function hydrateProfiles(client) {
  const rows = (await client.query(`SELECT tenant_id, data FROM profile`)).rows;
  return Object.fromEntries(rows.map((r) => [r.tenant_id, r.data]));
}

// Spalten der tenant-Tabelle, geteilt von hydrateTenants (Boot-Hydrierung) UND
// ensureTenant (Nach-Boot-Spiegel-Nachzug eines einzelnen Tenants): EINE Quelle, damit
// SELECT-Liste und rowToTenant nie auseinanderdriften (G5). KEINE GUC noetig - die
// tenant-Tabelle hat keine RLS.
const TENANT_COLUMNS =
  "id, status, owner_name, first_name, idp_subject, kyc_level, stripe_customer_id, " +
  "stripe_payment_method_id, stripe_subscription_id, stripe_plan_slug, " +
  "stripe_current_period_end, stripe_current_period_start, country, default_language, " +
  "private_number, number_provision_skip_reason, number_provision_skip_at";

// Eine tenant-Zeile -> Tenant-Record. Alle optionalen Felder NUR-nicht-null hydrieren:
// owner_name/idp_subject/first_name sonst -> leeres Feld, das den leeren tenantContext-
// Fallback "" bzw. die firstName-Ableitung verdeckte (G1); kyc_level/stripe_*/geo/
// private_number analog -> Owner/Bestand ohne Wert behaelt KEIN leeres Feld, der jeweilige
// Code-Fallback greift (kein json<->pg-Drift, R6/R7). KRITISCH (I8-Lehre): die
// stripe_subscription_* MUESSEN hier UND in flushTenants stehen, sonst loescht der naechste
// Flush das Abo (Datenverlust). Tenants kommen ueber bootstrap-tenant/Onboarding/Web-Login
// (P2b: kein config-Seed). Geteilt von hydrateTenants UND ensureTenant (G5).
function rowToTenant(r) {
  const tenant = { id: r.id, status: r.status };
  if (r.owner_name != null) tenant.ownerName = r.owner_name;
  if (r.first_name != null) tenant.firstName = r.first_name;
  if (r.idp_subject != null) tenant.idpSubject = r.idp_subject;
  if (r.kyc_level != null) tenant.kycLevel = r.kyc_level;
  if (r.stripe_customer_id != null) tenant.stripeCustomerId = r.stripe_customer_id;
  if (r.stripe_payment_method_id != null) tenant.stripePaymentMethodId = r.stripe_payment_method_id;
  if (r.stripe_subscription_id != null) tenant.stripeSubscriptionId = r.stripe_subscription_id;
  if (r.stripe_plan_slug != null) tenant.stripePlanSlug = r.stripe_plan_slug;
  // BIGINT kommt als String aus pg -> zurueck zur Zahl (Unix-Sekunden, kein Float-Geld).
  if (r.stripe_current_period_end != null)
    tenant.stripeCurrentPeriodEnd = Number(r.stripe_current_period_end);
  if (r.stripe_current_period_start != null)
    tenant.stripeCurrentPeriodStart = Number(r.stripe_current_period_start);
  if (r.country != null) tenant.country = r.country;
  if (r.default_language != null) tenant.defaultLanguage = r.default_language;
  if (r.private_number != null) tenant.privateNumber = r.private_number;
  if (r.number_provision_skip_reason != null)
    tenant.numberProvisionSkipReason = r.number_provision_skip_reason;
  if (r.number_provision_skip_at != null) tenant.numberProvisionSkipAt = r.number_provision_skip_at;
  return tenant;
}

// tenant-Tabelle -> Tenant-Records (Boot-Hydrierung). Reine Projektion ueber rowToTenant
// (byte-identisch zur frueheren Inline-Map).
async function hydrateTenants(client) {
  const rows = (await client.query(`SELECT ${TENANT_COLUMNS} FROM tenant`)).rows;
  return rows.map(rowToTenant);
}

// Liest die tenant-scoped Zeilen EINES Tenants (RLS-GUC ist gesetzt) und fuellt sie
// in den Spiegel: settings/calendar/usage in den Map-Bucket dieses Tenants, calls/
// actionItems/notifications/numbers an die globalen Listen ANGEHAENGT (nicht
// ueberschrieben - sonst verloeren frueher hydrierte Tenants ihre Daten). profiles
// sind NICHT tenant-scoped (Owner-Removal P5) -> eigener Schritt in hydrate().
async function hydrateTenantInto(client, state, tenantId) {
  const settingsRows = (
    await client.query(`SELECT * FROM settings WHERE tenant_id = $1`, [tenantId])
  ).rows;
  const callRows = (
    await client.query(`SELECT * FROM call WHERE tenant_id = $1 ORDER BY seq DESC`, [tenantId])
  ).rows;
  const segRows = (
    await client.query(`SELECT * FROM transcript_segment WHERE tenant_id = $1 ORDER BY id ASC`, [
      tenantId,
    ])
  ).rows;
  const itemRows = (
    await client.query(`SELECT * FROM action_item WHERE tenant_id = $1 ORDER BY seq DESC`, [
      tenantId,
    ])
  ).rows;
  const calRows = (
    await client.query(`SELECT * FROM calendar_event WHERE tenant_id = $1 ORDER BY seq ASC`, [
      tenantId,
    ])
  ).rows;
  const usageRows = (await client.query(`SELECT * FROM usage WHERE tenant_id = $1`, [tenantId]))
    .rows;
  const notifRows = (
    await client.query(`SELECT * FROM notification WHERE tenant_id = $1 ORDER BY seq DESC`, [
      tenantId,
    ])
  ).rows;
  const numberRows = (
    await client.query(
      `SELECT id, e164, tenant_id, provider, status, provider_number_id, payment_intent_id, country, language FROM number WHERE tenant_id = $1`,
      [tenantId],
    )
  ).rows;
  const jobRows = (
    await client.query(
      `SELECT id, tenant_id, number_id, kind, status, idempotency_key, attempts, last_error, created_at
       FROM provisioning_job WHERE tenant_id = $1`,
      [tenantId],
    )
  ).rows;
  const budgetRows = (
    await client.query(
      `SELECT tenant_id, budget_cents, hard_cap_cents FROM tenant_budget WHERE tenant_id = $1`,
      [tenantId],
    )
  ).rows;
  const ueRows = (
    await client.query(
      `SELECT id, tenant_id, call_id, kind, quantity, cost_cents, occurred_at, stripe_meter_sent
       FROM usage_event WHERE tenant_id = $1 ORDER BY id ASC`,
      [tenantId],
    )
  ).rows;

  const segmentsByCall = groupTranscripts(segRows);
  const itemIdsByCall = groupActionItemIds(itemRows);

  if (settingsRows.length) state.settings[tenantId] = rowToSettings(settingsRows[0]);
  if (usageRows.length) state.usage[tenantId] = rowToUsage(usageRows[0]);
  state.calendar[tenantId] = calRows.map(rowToCalendarEvent);
  state.calls.push(...callRows.map((r) => rowToCall(r, segmentsByCall, itemIdsByCall)));
  state.actionItems.push(...itemRows.map(rowToActionItem));
  state.notifications.push(...notifRows.map(rowToNotification));
  state.numbers.push(
    ...numberRows.map((r) => ({
      id: r.id,
      e164: r.e164,
      tenantId: r.tenant_id,
      provider: r.provider,
      status: r.status,
      providerNumberId: r.provider_number_id,
      paymentIntentId: r.payment_intent_id ?? null,
      // Geo (F1): Bestands-Nummer ohne Wert -> null (kein undefined-Drift, Muster wie
      // payment_intent_id); der Code-Fallback || DE/de der Konsumenten greift.
      country: r.country ?? null,
      language: r.language ?? null,
    })),
  );
  state.provisioningJobs.push(
    ...jobRows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      numberId: r.number_id,
      kind: r.kind,
      status: r.status,
      idempotencyKey: r.idempotency_key,
      attempts: r.attempts,
      lastError: r.last_error ?? null,
      // TIMESTAMPTZ -> ISO-String (Parity zum json-Backend, das ISO haelt).
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    })),
  );
  state.tenantBudgets.push(
    ...budgetRows.map((r) => ({
      tenantId: r.tenant_id,
      budgetCents: Number(r.budget_cents),
      hardCapCents: Number(r.hard_cap_cents),
    })),
  );
  state.usageEvents.push(
    ...ueRows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      callId: r.call_id,
      kind: r.kind,
      quantity: Number(r.quantity),
      costCents: Number(r.cost_cents),
      occurredAt: r.occurred_at,
      stripeMeterSent: r.stripe_meter_sent,
    })),
  );
}

function groupTranscripts(segRows) {
  const byCall = new Map();
  for (const r of segRows) {
    if (!byCall.has(r.call_id)) byCall.set(r.call_id, []);
    byCall.get(r.call_id).push({ role: r.role, text: r.text, at: r.at });
  }
  return byCall;
}

// action_item ist nach seq DESC sortiert (neueste zuerst, wie unshift). Die
// actionItemIds eines Calls in chronologischer Reihenfolge (aeltester push zuerst)
// -> beim Gruppieren von hinten nach vorne anfuegen.
function groupActionItemIds(itemRows) {
  const byCall = new Map();
  for (let i = itemRows.length - 1; i >= 0; i--) {
    const r = itemRows[i];
    if (r.call_id == null) continue;
    if (!byCall.has(r.call_id)) byCall.set(r.call_id, []);
    byCall.get(r.call_id).push(r.id);
  }
  return byCall;
}

function rowToSettings(r) {
  return {
    agentName: r.agent_name,
    greeting: r.greeting,
    allowCalendar: r.allow_calendar,
    allowBooking: r.allow_booking,
    allowSummaries: r.allow_summaries,
    // F2 P7: Opt-Out fuer die Summary-SMS. ?? true = Bestands-Zeilen vor dem Migrate
    // (Spalte fehlte) fallen auf Opt-In zurueck -> kein stiller SMS-Verlust (M1).
    smsSummaryOptIn: r.sms_summary_opt_in ?? true,
    allowPersonalData: r.allow_personal_data,
    allowBankData: r.allow_bank_data,
    // F1 Phase 4: optionales Override, Spalte NULLABLE. NULL -> null (nicht gesetzt);
    // die Praezedenz (resolveCallLanguage) faellt dann auf number/tenant/'de' durch.
    language: r.language ?? null,
    // P2: stehender Tenant-Stil, Spalte NULLABLE. NULL/fehlend (Bestands-Zeile vor dem
    // Migrate) -> null = neutral (Siezen) -> agentStyle=null byte-identisch (Muster language).
    agentStyle: r.agent_style ?? null,
  };
}

function rowToCall(r, segmentsByCall, itemIdsByCall) {
  return {
    id: r.id,
    // tenantId hydrieren (I8): der Flush partitioniert state.calls per call.tenantId
    // (flushTenantScope/ops.tenantCallScope). Ohne dieses Feld faende der Owner-Filter nach der
    // Re-Hydrierung keinen einzigen Call (undefined !== "owner") und loeschte beim
    // naechsten Flush alle Calls des Tenants. createCall setzt tenantId bereits im
    // Spiegel (json-Parity) - hier wird es aus der DB-Spalte rekonstruiert.
    tenantId: r.tenant_id,
    streamToken: r.stream_token,
    twilioSid: r.twilio_sid,
    direction: r.direction,
    from: r.from_e164,
    to: r.to_e164,
    goal: r.goal,
    briefing: r.briefing,
    constraints: r.constraints,
    // P3: Per-Call-Kontext mit-hydrieren. Ohne diese Zeile ginge context beim Restart
    // verloren UND der naechste Flush wuerde ihn ueberschreiben (JSONB auto-geparst zu
    // Objekt|null, Muster summary_sms_sent_at/I8). NULL -> null (json-Parity).
    context: r.context ?? null,
    callerName: r.caller_name,
    language: r.language,
    maxDurationS: r.max_duration_s,
    requestedBy: r.requested_by,
    provider: r.provider,
    status: r.status,
    startedAt: r.started_at,
    answeredAt: r.answered_at,
    endedAt: r.ended_at,
    transcript: segmentsByCall.get(r.id) || [],
    summary: r.summary,
    objectiveAchieved: r.objective_achieved,
    // F2 P9 (M2): persistierten Summary-SMS-Dedup-Marker hydrieren. Ohne dieses Feld
    // ginge der Marker beim Prozess-Restart verloren (Spalte da, aber nie gelesen) und
    // ein spaeter /voice/status-Retry sendete eine zweite Summary-SMS. NULL -> null
    // (kein Marker, byte-identisch zur createCall-Initialisierung + json-Hydrierung).
    summarySmsSentAt: r.summary_sms_sent_at ?? null,
    // CDF1: persistierten Fehlergrund hydrieren (NULL -> null, json-Parity). Ohne diese Zeile
    // ginge er beim Restart verloren UND der naechste Flush wuerde ihn ueberschreiben.
    failureReason: r.failure_reason ?? null,
    actionItemIds: itemIdsByCall.get(r.id) || [],
  };
}

function rowToActionItem(r) {
  return {
    id: r.id,
    callId: r.call_id,
    text: r.text,
    type: r.type,
    done: r.done,
    createdAt: r.created_at,
  };
}

function rowToCalendarEvent(r) {
  return { id: r.id, title: r.title, start: r.starts_at, end: r.ends_at };
}

function rowToUsage(r) {
  return {
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    costEur: Number(r.cost_eur),
    calls: Number(r.calls),
  };
}

function rowToNotification(r) {
  return { id: r.id, title: r.title, body: r.body, callId: r.call_id, at: r.at };
}

// ---- Flush: Spiegel -> DB (multi-tenant, I8). Eine Transaktion ueber den ganzen
// Spiegel. preFlush (optional, siehe save()) laeuft ALS ERSTES nach BEGIN, damit ein
// Rollback des restlichen Flush ihn mit zurueckrollt (P16/G26 - Atomaritaet: sonst
// bliebe ein Hard-Delete bestehen, obwohl der Flush selbst fehlschlug). Danach wird
// die tenant-Tabelle geschrieben (kein RLS, kein GUC noetig; die FK-Ziele muessen vor
// den tenant-scoped Inserts existieren), dann pro Tenant die RLS-GUC setzen und NUR
// dessen Scheibe flushen - exakt das owner-pinned Verhalten von frueher, nur N-fach.
// Bei genau einem Tenant und ohne preFlush identisch zu vorher.
// client = die von withClient gebundene Verbindung.
async function flush(client, state, preFlush) {
  await client.query("BEGIN");
  try {
    if (preFlush) await preFlush(client);
    await flushTenants(client, state.tenants);
    for (const tenant of state.tenants) {
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
      await flushTenantScope(client, tenant.id, state);
    }
    // Profiles sind global (Owner-Removal P5): EIN Flush pro Transaktion, an KEINEN
    // Tenant gebunden (Policy profile_global, kein app.current_tenant). Liegt bewusst
    // AUSSERHALB der per-Tenant-Schleife - sonst N-fach gegen dieselben Zeilen.
    await flushProfiles(client, state.profiles);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

// Flusht die tenant-scoped Scheibe EINES Tenants (RLS-GUC ist gesetzt). Die
// call-verknuepften Entitaeten (calls + ihre actionItems/notifications) werden ueber
// ops.tenantCallScope partitioniert - dieselbe Quelle wie eraseTenantData/
// exportTenantData (EIN Filter mit derselben Regel, G5) - sonst blockte die
// RLS-WITH-CHECK den Insert einer Call-Zeile mit fremder tenant_id unter dieser GUC.
// settings/calendar/usage/numbers ueber die bestehenden pro-Tenant-Accessoren bzw.
// den numbers-Filter. profiles sind NICHT tenant-scoped (Owner-Removal P5) -> eigener
// globaler Flush in flush().
async function flushTenantScope(client, tenantId, state) {
  const { calls, callIds } = ops.tenantCallScope(state, tenantId);
  await flushCalls(client, tenantId, calls);
  await flushActionItems(
    client,
    tenantId,
    state.actionItems.filter((a) => callIds.has(a.callId)),
  );
  await flushCalendar(client, tenantId, ops.calendarFor(state, tenantId));
  await flushNotifications(client, tenantId, notificationsForTenant(state, tenantId, callIds));
  await flushSettings(client, tenantId, ops.settingsFor(state, tenantId));
  await flushUsage(client, tenantId, ops.usageFor(state, tenantId));
  await flushNumbers(client, tenantId, state.numbers);
  await flushProvisioningJobs(client, tenantId, state.provisioningJobs);
  await flushTenantBudgets(client, tenantId, state.tenantBudgets);
  await flushUsageEvents(client, tenantId, state.usageEvents);
}

// tenant-Tabelle round-trippen (I8): id/status/owner_name/idp_subject upsert. KEINE
// RLS auf der tenant-Tabelle -> keine GUC noetig (anders als die 10 Daten-Tabellen).
// owner_name/idp_subject sind NULLABLE; ein Owner ohne eigenen Namen schreibt NULL
// (Owner-Fallback bleibt). Lebt VOR den tenant-scoped Inserts, weil diese per FK
// auf tenant(id) verweisen.
// p6-funnel: Der Lebenszyklus-status gehoert der accounts-Schicht (upsertOnFirstLogin
// = suspended bei Anlage, setStatus = Admin/Aktivierung/Webhook, seedDefaults = Owner).
// Beim INSERT setzt der Flush status (neuer Mirror-only-Tenant: Operator-Onboard/Owner);
// per ON CONFLICT wird status NICHT ueberschrieben - sonst degradiert/reaktiviert der
// Mirror einen bestehenden Tenant (Clobber des suspended frischer Web-Logins).
async function flushTenants(client, tenants) {
  for (const t of tenants) {
    await client.query(
      `INSERT INTO tenant (id, status, owner_name, first_name, idp_subject, kyc_level, stripe_customer_id, stripe_payment_method_id, stripe_subscription_id, stripe_plan_slug, stripe_current_period_end, stripe_current_period_start, country, default_language, private_number, number_provision_skip_reason, number_provision_skip_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (id) DO UPDATE SET
         owner_name=EXCLUDED.owner_name,
         first_name=EXCLUDED.first_name,
         idp_subject=EXCLUDED.idp_subject, kyc_level=EXCLUDED.kyc_level,
         stripe_customer_id=EXCLUDED.stripe_customer_id,
         stripe_payment_method_id=EXCLUDED.stripe_payment_method_id,
         stripe_subscription_id=EXCLUDED.stripe_subscription_id,
         stripe_plan_slug=EXCLUDED.stripe_plan_slug,
         stripe_current_period_end=EXCLUDED.stripe_current_period_end,
         stripe_current_period_start=EXCLUDED.stripe_current_period_start,
         country=EXCLUDED.country, default_language=EXCLUDED.default_language,
         private_number=EXCLUDED.private_number,
         number_provision_skip_reason=EXCLUDED.number_provision_skip_reason,
         number_provision_skip_at=EXCLUDED.number_provision_skip_at`,
      [
        t.id,
        t.status,
        t.ownerName ?? null,
        t.firstName ?? null,
        t.idpSubject ?? null,
        t.kycLevel ?? null,
        t.stripeCustomerId ?? null,
        t.stripePaymentMethodId ?? null,
        t.stripeSubscriptionId ?? null,
        t.stripePlanSlug ?? null,
        t.stripeCurrentPeriodEnd ?? null,
        t.stripeCurrentPeriodStart ?? null,
        t.country ?? null,
        t.defaultLanguage ?? null,
        t.privateNumber ?? null,
        t.numberProvisionSkipReason ?? null,
        t.numberProvisionSkipAt ?? null,
      ],
    );
  }
}

// Notifications eines Tenants: call-verknuepfte ueber callIds; manuelle (callId=null)
// sind keinem Call/Tenant zuordbar -> sie gehoeren dem Owner (dokumentierte
// Entscheidung, I8). So flusht jede manuelle Notification GENAU einmal (unter Owner)
// und keine Notification faellt zwischen die Tenants.
function notificationsForTenant(state, tenantId, callIds) {
  return state.notifications.filter(
    (n) => callIds.has(n.callId) || (n.callId == null && tenantId === BOOTSTRAP_TENANT_ID),
  );
}

// settings/usage haben tenant_id als PK und genau eine Zeile pro Tenant. Upsert
// (INSERT ON CONFLICT) statt blossem UPDATE (I8): der Owner hat seine Zeile aus
// seedDefaults -> ON CONFLICT DO UPDATE wirkt byte-identisch zum frueheren UPDATE;
// ein neuer Tenant (kein Seed) bekommt seine Zeile erst hier angelegt. Gleiches
// Upsert-Muster wie flushCalls/flushCalendar/flushNumbers (G5).
async function flushSettings(client, tenantId, settings) {
  await client.query(
    `INSERT INTO settings
       (tenant_id, agent_name, greeting, allow_calendar, allow_booking,
        allow_summaries, allow_personal_data, allow_bank_data, sms_summary_opt_in, language,
        agent_style)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (tenant_id) DO UPDATE SET
       agent_name=EXCLUDED.agent_name, greeting=EXCLUDED.greeting,
       allow_calendar=EXCLUDED.allow_calendar, allow_booking=EXCLUDED.allow_booking,
       allow_summaries=EXCLUDED.allow_summaries, allow_personal_data=EXCLUDED.allow_personal_data,
       allow_bank_data=EXCLUDED.allow_bank_data, sms_summary_opt_in=EXCLUDED.sms_summary_opt_in,
       language=EXCLUDED.language, agent_style=EXCLUDED.agent_style`,
    [
      tenantId,
      settings.agentName,
      settings.greeting,
      settings.allowCalendar,
      settings.allowBooking,
      settings.allowSummaries,
      settings.allowPersonalData,
      settings.allowBankData,
      settings.smsSummaryOptIn,
      settings.language,
      settings.agentStyle ?? null,
    ],
  );
}

async function flushUsage(client, tenantId, usage) {
  await client.query(
    `INSERT INTO usage (tenant_id, input_tokens, output_tokens, cost_eur, calls)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id) DO UPDATE SET
       input_tokens=EXCLUDED.input_tokens, output_tokens=EXCLUDED.output_tokens,
       cost_eur=EXCLUDED.cost_eur, calls=EXCLUDED.calls`,
    [tenantId, usage.inputTokens, usage.outputTokens, usage.costEur, usage.calls],
  );
}

async function flushCalls(client, tenantId, calls) {
  await deleteMissingCallsKeepActive(
    client,
    tenantId,
    calls.map((c) => c.id),
  );
  for (const c of calls) {
    await client.query(
      `INSERT INTO call
         (id, tenant_id, stream_token, twilio_sid, direction, from_e164, to_e164, goal,
          briefing, constraints, caller_name, language, max_duration_s, requested_by,
          status, started_at, answered_at, ended_at, summary, objective_achieved, provider,
          summary_sms_sent_at, context, failure_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       ON CONFLICT (id) DO UPDATE SET
         twilio_sid=EXCLUDED.twilio_sid, status=EXCLUDED.status, answered_at=EXCLUDED.answered_at,
         ended_at=EXCLUDED.ended_at, summary=EXCLUDED.summary,
         objective_achieved=EXCLUDED.objective_achieved, provider=EXCLUDED.provider,
         summary_sms_sent_at=EXCLUDED.summary_sms_sent_at, failure_reason=EXCLUDED.failure_reason`,
      [
        c.id,
        tenantId,
        c.streamToken,
        c.twilioSid,
        c.direction,
        c.from,
        c.to,
        c.goal,
        c.briefing,
        c.constraints,
        c.callerName,
        c.language,
        c.maxDurationS,
        c.requestedBy,
        c.status,
        c.startedAt,
        c.answeredAt,
        c.endedAt,
        c.summary,
        serializeObjective(c.objectiveAchieved),
        c.provider || DEFAULT_PROVIDER,
        c.summarySmsSentAt ?? null,
        // P3: Per-Call-Kontext als JSONB (Muster profile.data: Objekt -> JSON.stringify,
        // sonst NULL). NICHT im ON CONFLICT DO UPDATE SET - wie goal/briefing/constraints
        // bei Create gesetzt und danach unveraenderlich.
        c.context ? JSON.stringify(c.context) : null,
        // CDF1: Fehlergrund-Token ($24). IM ON CONFLICT DO UPDATE SET (anders als context),
        // weil er NACH dem Create im /voice/status-Callback gesetzt wird.
        c.failureReason ?? null,
      ],
    );
    await flushTranscript(client, tenantId, c);
  }
}

// Transkript-Segmente sind append-only: nur fehlende anhaengen. EINZIGE Ausnahme:
// ein geleertes Spiegel-Transkript (Roh-Transkript-Purge nach Summary, #7) wird
// auf die DB reconciled -> die persistierten Segmente DIESES Calls werden geloescht.
// Tenant-Schutz doppelt verankert wie bei deleteMissingByText: expliziter
// tenant_id-Filter im Statement PLUS RLS-GUC (FORCE-RLS, set_config in flush) als
// zweite Linie. Trifft NUR diesen Call dieses Tenants; andere bleiben unberuehrt.
async function flushTranscript(client, tenantId, call) {
  if (call.transcript.length === 0) {
    await client.query(`DELETE FROM transcript_segment WHERE tenant_id=$1 AND call_id=$2`, [
      tenantId,
      call.id,
    ]);
    return;
  }
  const existing = Number(
    (await client.query(`SELECT count(*) AS n FROM transcript_segment WHERE call_id=$1`, [call.id]))
      .rows[0].n,
  );
  for (let i = existing; i < call.transcript.length; i++) {
    const seg = call.transcript[i];
    await client.query(
      `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1,$2,$3,$4,$5)`,
      [call.id, tenantId, seg.role, seg.text, seg.at],
    );
  }
}

async function flushActionItems(client, tenantId, items) {
  await deleteMissing(
    client,
    "action_item",
    tenantId,
    items.map((i) => i.id),
  );
  // Aelteste zuerst einfuegen, damit seq die unshift-Reihenfolge widerspiegelt.
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    await client.query(
      `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET done=EXCLUDED.done`,
      [it.id, tenantId, it.callId, it.text, it.type, it.done, it.createdAt],
    );
  }
}

async function flushCalendar(client, tenantId, events) {
  await deleteMissing(
    client,
    "calendar_event",
    tenantId,
    events.map((e) => e.id),
  );
  for (const ev of events) {
    await client.query(
      `INSERT INTO calendar_event (id, tenant_id, title, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at`,
      [ev.id, tenantId, ev.title, ev.start, ev.end],
    );
  }
}

async function flushNotifications(client, tenantId, notifications) {
  await deleteMissing(
    client,
    "notification",
    tenantId,
    notifications.map((n) => n.id),
  );
  // Aelteste zuerst, damit seq die unshift-Reihenfolge (neueste zuerst) ergibt.
  for (let i = notifications.length - 1; i >= 0; i--) {
    const n = notifications[i];
    await client.query(
      `INSERT INTO notification (id, tenant_id, title, body, call_id, at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [n.id, tenantId, n.title, n.body, n.callId, n.at],
    );
  }
}

// Profile-Flush (global, an KEINEN Tenant gebunden): profile.tenant_id ist PK allein
// (schema.sql, Phase S - die Spalte haelt tenantIds); deleteMissingProfiles raeumt entfernte
// Profile ab, ohne RLS-Tenant-Filter. Policy profile_global schuetzt die Tabelle (kein
// Tenant-Filter, global lesbar/schreibbar - die Zugriffskontrolle liegt eine Schicht hoeher).
async function flushProfiles(client, profiles) {
  const tenantIds = Object.keys(profiles);
  await deleteMissingProfiles(client, tenantIds);
  for (const [tenantId, data] of Object.entries(profiles)) {
    await client.query(
      `INSERT INTO profile (tenant_id, data) VALUES ($1,$2)
       ON CONFLICT (tenant_id) DO UPDATE SET data=EXCLUDED.data`,
      [tenantId, JSON.stringify(data)],
    );
  }
}

// Loescht Profile-Zeilen, deren tenant_id nicht mehr im Spiegel steht (global, kein
// RLS-Tenant-Filter). Leere keep-Liste -> alle Profile weg (Parity zu deleteMissing).
async function deleteMissingProfiles(client, keepTenantIds) {
  if (keepTenantIds.length === 0) {
    await client.query(`DELETE FROM profile`);
    return;
  }
  await client.query(`DELETE FROM profile WHERE tenant_id <> ALL($1::text[])`, [keepTenantIds]);
}

// number-Flush (Onboarding-Lifecycle): id-PK-Upsert mit allen Lifecycle-Feldern
// (status, provider_number_id, e164 NULLABLE fuer 'requested').
// Multi-Tenant (I8): flush ruft flushNumbers pro Tenant unter dessen RLS-GUC; der
// own-Filter haelt das pro Aufruf auf die Nummern DIESES Tenants (zweite Linie zur
// per-Tenant-GUC). So round-trippen die Nummern aller Tenants (nicht mehr owner-only).
async function flushNumbers(client, tenantId, numbers) {
  const own = numbers.filter((n) => n.tenantId === tenantId);
  await deleteMissing(
    client,
    "number",
    tenantId,
    own.map((n) => n.id),
  );
  for (const n of own) {
    await client.query(
      `INSERT INTO number (id, tenant_id, e164, provider, status, provider_number_id, payment_intent_id, country, language)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         e164=EXCLUDED.e164, provider=EXCLUDED.provider,
         status=EXCLUDED.status, provider_number_id=EXCLUDED.provider_number_id,
         payment_intent_id=EXCLUDED.payment_intent_id,
         country=EXCLUDED.country, language=EXCLUDED.language`,
      [
        n.id,
        tenantId,
        n.e164 ?? null,
        n.provider || DEFAULT_PROVIDER,
        n.status,
        n.providerNumberId ?? null,
        n.paymentIntentId ?? null,
        n.country ?? null,
        n.language ?? null,
      ],
    );
  }
}

// provisioning_job-Flush (async Worker, P6b2): id-PK-Upsert der Job-Spur. own-Filter
// + deleteMissing pro Tenant unter dessen RLS-GUC (zweite Linie, Muster wie
// flushNumbers). status/attempts/last_error koennen sich aendern (Worker-Lauf), der
// Rest (number_id/kind/idempotency_key) bleibt nach dem Insert stabil. created_at ist
// application-provided (F4, gegen DB-now()-Skew) und bleibt nach dem Insert immutable.
async function flushProvisioningJobs(client, tenantId, jobs) {
  const own = jobs.filter((j) => j.tenantId === tenantId);
  await deleteMissing(
    client,
    "provisioning_job",
    tenantId,
    own.map((j) => j.id),
  );
  for (const j of own) {
    await client.query(
      `INSERT INTO provisioning_job (id, tenant_id, number_id, kind, status, idempotency_key, attempts, last_error, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         status=EXCLUDED.status, attempts=EXCLUDED.attempts, last_error=EXCLUDED.last_error`,
      [
        j.id,
        tenantId,
        j.numberId,
        j.kind,
        j.status,
        j.idempotencyKey,
        j.attempts,
        j.lastError ?? null,
        j.createdAt,
      ],
    );
  }
}

// tenant_budget-Flush (P6b3): PK = tenant_id (eine Zeile pro Tenant), kein
// deleteMissing noetig (setTenantBudget loescht nie). own-Filter pro Tenant unter
// dessen RLS-GUC (zweite Linie, Muster wie flushNumbers). Upsert wie flushSettings/
// flushUsage. Money als GANZZAHL Cents.
async function flushTenantBudgets(client, tenantId, budgets) {
  const own = budgets.filter((b) => b.tenantId === tenantId);
  for (const b of own) {
    await client.query(
      `INSERT INTO tenant_budget (tenant_id, budget_cents, hard_cap_cents)
       VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id) DO UPDATE SET
         budget_cents=EXCLUDED.budget_cents, hard_cap_cents=EXCLUDED.hard_cap_cents`,
      [tenantId, b.budgetCents, b.hardCapCents],
    );
  }
}

// usage_event-Flush (P6b3): append-only id-PK-Ledger. own-Filter + deleteMissing
// (Retention/Erase koennten Events entfernen) + Upsert (nur stripe_meter_sent
// aenderbar nach dem Insert). Muster wie flushProvisioningJobs.
async function flushUsageEvents(client, tenantId, events) {
  const own = events.filter((e) => e.tenantId === tenantId);
  await deleteMissing(
    client,
    "usage_event",
    tenantId,
    own.map((e) => e.id),
  );
  for (const e of own) {
    await client.query(
      `INSERT INTO usage_event (id, tenant_id, call_id, kind, quantity, cost_cents, occurred_at, stripe_meter_sent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET stripe_meter_sent=EXCLUDED.stripe_meter_sent`,
      [e.id, tenantId, e.callId, e.kind, e.quantity, e.costCents, e.occurredAt, e.stripeMeterSent],
    );
  }
}

// objectiveAchieved kann string ODER boolean sein (json speichert beides). Die
// TEXT-Spalte haelt die String-Form; null bleibt null.
function serializeObjective(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

// Loescht Zeilen des Tenants, deren TEXT-PK nicht mehr im Spiegel steht (Retention
// /Prune). Leere keep-Liste -> alle Zeilen des Tenants weg.
async function deleteMissing(client, table, tenantId, keepIds) {
  await deleteMissingByText(client, table, "id", tenantId, keepIds);
}

async function deleteMissingByText(client, table, column, tenantId, keepValues) {
  if (keepValues.length === 0) {
    await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId]);
    return;
  }
  await client.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND ${column} <> ALL($2::text[])`, [
    tenantId,
    keepValues,
  ]);
}

// Reconcile-Prune fuer die call-Tabelle (A6/DEPLOY-04): entfernt Retention-Zeilen
// des Tenants wie deleteMissing, schuetzt aber jedes laufende Gespraech - eine
// DB-Zeile mit status=CALL_STATUS_ACTIVE, die der (divergente) Spiegel NICHT kennt,
// wird NIE geloescht. Der eigene aktive Call steht ohnehin in keepIds (Upsert) ->
// geschuetzt sind nur FREMDE aktive Zeilen eines Overlap-/Restart-Prozesses.
// Bewusst call-lokal, NICHT im generischen deleteMissing (8 Tabellen): status=active
// heisst nur bei call "laufendes Gespraech"; bei number waere es eine aktive DID ->
// genereller Schutz verhinderte legitimes Prunen.
const CALL_STATUS_ACTIVE = "active";
async function deleteMissingCallsKeepActive(client, tenantId, keepIds) {
  if (keepIds.length === 0) {
    await client.query(`DELETE FROM call WHERE tenant_id=$1 AND status <> $2`, [
      tenantId,
      CALL_STATUS_ACTIVE,
    ]);
    return;
  }
  await client.query(
    `DELETE FROM call WHERE tenant_id=$1 AND status <> $2 AND id <> ALL($3::text[])`,
    [tenantId, CALL_STATUS_ACTIVE, keepIds],
  );
}

// DSGVO-Art.-17-Hard-Delete (Gegenstueck zu deleteMissingCallsKeepActive): loescht
// GENAU die uebergebenen Call-IDs, UNABHAENGIG vom status. Der Reconcile-Schutz oben
// gilt nur FREMDEN/unbekannten Zeilen eines Overlap-Prozesses - beim Erase sind es
// die EIGENEN, per tenantCallScope erfassten Zeilen des Tenants, deren Loeschung
// der Nutzer aktiv verlangt hat (Recht auf Loeschung sticht den Reconcile-Schutz).
// Laeuft als preFlush INNERHALB derselben Transaktion wie der Flush (P16/G26,
// direkt nach BEGIN) - deshalb GUC TRANSAKTIONSLOKAL setzen (dritter Parameter true),
// genau wie der per-Tenant-Flush danach. Ein Rollback des restlichen Flush (z.B.
// transienter DB-Fehler in einer Folge-Tabelle) rollt diesen Delete mit zurueck,
// statt eine teilweise DSGVO-Loeschung zu hinterlassen.
async function hardDeleteCalls(client, tenantId, callIds) {
  if (callIds.length === 0) return;
  await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  await client.query(`DELETE FROM call WHERE tenant_id=$1 AND id = ANY($2::text[])`, [
    tenantId,
    callIds,
  ]);
}
