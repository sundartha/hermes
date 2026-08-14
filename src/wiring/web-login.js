// ---- wireWebLogin (Server-Slim P13) ---------------------------------------------
// Kompositions-Glue fuer den gesamten OIDC-/Portal-/Accounts-/Sessions-/AuditStore-
// Block inkl. /auth, /api/portal/state, Admin-/Self-Service-Mounts, Stripe-Webhook-
// Mount und Release-Reconcile-Scheduler. REINE Verschiebung aus server.js (byte-
// identische Mount-Reihenfolge, gleiche Semantik). Laeuft in der Wurzel unter
// guardedBoot (fail-OPEN) - ein Portal-pg-Fehler toetet die Telefonie nicht
// (boot-decoupling.test.js). Konstruktion (hier) getrennt von der Anwendung (Wurzel).
//
// createPortalRunner ist injiziert (DIP-Seam wie boot-guard.test.js): der einzige
// infrastruktur-beruehrende Kollaborator (pg-Pool) - so ist der Q1-Happy-Path-Marker
// offline fakebar, ohne erreichbare DB und ohne Kindprozess+pglite. provision ist
// provisioning.triggerTenantProvisioning - eine Methode der EINEN P6-Provisioning-
// Orchestrator-Instanz, die in server.js VOR diesem Block konstruiert wird (TDZ-
// Vermeidung, siehe Kommentar dort) und dort weitere server.js-lokale Kollaboratoren
// (Queue/Metering) schliesst - injiziert, nicht importiert. Alle uebrigen
// Kollaboratoren sind reine Factories/Helfer/Konstanten ohne eigenen Laufzeit-State
// und werden direkt importiert (gleiche Konvention wie in server.js selbst); nur
// Laufzeit-Instanzen (app/store/audit) + die geteilten Pfad-Konstanten
// (STRIPE_WEBHOOK_PATH bleibt EINE Quelle) werden injiziert.
import {
  makeWebAuthRoutes,
  makeAdminRoutes,
  makeOidc,
  makeAccounts,
  makeSessions,
  webAuth,
  webAuthAllowPending,
  adminOnly,
  LOGIN_ROUTE,
} from "../web-auth.js";
import { makePortalStore } from "../store/portal.js";
import { makeAuditStore } from "../audit-store.js";
import { makeSelfServiceRoutes } from "../self-service-routes.js";
import { createRateLimiter } from "../middleware.js";
import { setTenantIdentityIfAbsent } from "../store/state-ops.js";
import { runReleaseReconcile } from "../release-reconcile.js";
import { numberProvisioning } from "../telephony/registry.js";
import { PROVIDER } from "../store/defaults.js";
import { stripeBilling } from "../billing/stripe.js";
import { makeStripeWebhookRoute } from "../routes/stripe-webhook.js";
import { isSelfServiceLive } from "../config.js";
import { makeWorkosManagement } from "../workos-management.js";
import { runContractEndCleanupSweep } from "../billing/contract-end-cleanup.js";
import { makeSmtpMailer } from "../smtp-mail.js";
import { runCancellationMailSweep } from "../billing/cancellation-mail.js";

// tenant-prolif-d: Sweep-Kadenz des DID-Release-Reconcilers (interne Kadenz, kein
// Operator-Knopf -> Modul-Konstante; der Sicherheits-Knopf ist RELEASE_GRACE_DAYS/config).
const RELEASE_RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;

// 312k-Phase 4: Sweep-Kadenz des Vertragsende-Aufraeumens (Rufnummer freigeben + WorkOS-
// Identitaet loeschen) - EIGENSTAENDIG von RELEASE_RECONCILE_INTERVAL_MS (kein geteilter
// Timer: ein haengender Provider-Call in dem einen Sweep darf den anderen nie verzoegern).
// Selbe Grosse wie der DID-Release-Reconciler (Muster), kein Operator-Knopf noetig - anders
// als RELEASE_GRACE_DAYS ist hier kein Beobachtungsmodus vorgesehen: die Owner-Entscheidung
// (nur bei KUENDIGUNG) ist bereits die Sicherung, kein weiterer Schalter noetig.
const CONTRACT_END_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Boot-Lauf + periodischer Sweep des DID-Release-Reconcilers. fire-and-forget; nowMs
// pro Lauf injiziert -> reiner Klassifizierer/Executor bleibt Date.now-frei. (byte-
// identisch aus server.js verschoben.)
function scheduleReleaseReconcile(deps) {
  const run = () =>
    void runReleaseReconcile({ ...deps, nowMs: Date.now() }).catch((e) =>
      console.error("[did-release]", e.message),
    );
  run();
  setInterval(run, RELEASE_RECONCILE_INTERVAL_MS).unref();
}

// Boot-Lauf + periodischer Sweep des Vertragsende-Aufraeumens (312k-Phase 4). Muster
// scheduleReleaseReconcile: fire-and-forget, eigener catch-Riegel (ein Fehler hier darf den
// Boot nie stoppen), unref() (der Timer haelt den Prozess/Test-Runner nicht am Beenden).
function scheduleContractEndCleanup(deps) {
  const run = () =>
    void runContractEndCleanupSweep(deps).catch((e) => console.error("[contract-end]", e.message));
  run();
  setInterval(run, CONTRACT_END_CLEANUP_INTERVAL_MS).unref();
}

// 312k-Phase 5: Sweep-Kadenz der Kuendigungsbestaetigung per E-Mail - EIGENSTAENDIG von
// den anderen beiden Sweeps (kein geteilter Timer). Gleiche Groesse (Muster), kein
// Operator-Knopf noetig (dieselbe Owner-Entscheidung wie bei der Kuendigung selbst).
const CANCELLATION_MAIL_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Boot-Lauf + periodischer Sweep der Kuendigungsbestaetigung (312k-Phase 5). Muster
// scheduleContractEndCleanup: fire-and-forget, eigener catch-Riegel, unref() (der Timer
// haelt den Prozess/Test-Runner nicht am Beenden).
function scheduleCancellationMailSweep(deps) {
  const run = () =>
    void runCancellationMailSweep(deps).catch((e) => console.error("[cancellation-mail]", e.message));
  run();
  setInterval(run, CANCELLATION_MAIL_SWEEP_INTERVAL_MS).unref();
}

export async function wireWebLogin({
  app,
  config,
  store,
  audit,
  provision,
  createPortalRunner,
  stripeWebhookPath,
  appPath,
  messaging,
  // F2-Mail: spaet gebundene Accounts-Zelle (server.js, Muster operatorAuth in app.js).
  // Optional (Default undefined) - der Routen-Inventar-Test (route-auth-inventory.test.js)
  // baut den Graph ohne sie; der Guard unten macht das No-op statt eines TypeErrors.
  accountsRef,
}) {
  const portalRunner = await createPortalRunner();
  const oidc = makeOidc(config);
  // P8/LANG-02: der Login-Pfad legt den Tenant mit Land/Sprache/Zeitzone an (Plattform-
  // Default, kein IP-Geo - s. makeAccounts). Ohne das bekaeme jeder Web-Login-Kunde nach
  // dem Weltdefault-Flip (P10) die falsche Sprache, weil sein Tenant kein Land traegt.
  const accounts = makeAccounts(portalRunner, {
    defaultCountry: config.provisioning.provisioningCountry,
  });
  // F2-Mail: die Zelle NACH dem Bau von accounts befuellen - callFinish (server.js,
  // synchron VOR diesem asynchronen Block konstruiert) liest accountsRef.current bei
  // jedem Call-Ende frisch und findet ab hier die echte accounts-Instanz.
  if (accountsRef) accountsRef.current = accounts;
  const sessions = makeSessions(portalRunner);
  const auditStore = makeAuditStore(portalRunner);
  // EINE Instanz (G5), geteilt vom DID-Release-Reconciler UND dem 312k-Phase-4-
  // Vertragsende-Aufraeumen - beide releasen ausschliesslich Telnyx-DIDs ueber denselben Port.
  const telnyxProvisioner = numberProvisioning(PROVIDER.TELNYX);
  // tenant-prolif-d: DID-Release-Reconcile scharfschalten (Boot-Lauf + Sweep). Der
  // Provider laeuft ueber den bestehenden NumberProvisioning-Port (nur Telnyx). graceMs=0
  // (Default) = Observe-Only -> loggt nur Kandidaten, gibt nichts frei.
  scheduleReleaseReconcile({
    store,
    provisioner: telnyxProvisioner,
    audit: auditStore,
    graceMs: config.provisioning.releaseGraceMs,
  });
  // 312k-Phase 4: WorkOS-Management-Adapter NUR konstruieren, wenn ein eigens dafuer
  // vergebener Schluessel gesetzt ist (config.auth.workosManagementApiKey) - NICHT
  // oidcClientSecret (der Anmeldeschluessel gehoert nicht auf einen Loeschpfad, s.
  // workos-management.js). Ungesetzt (Auslieferungszustand) -> null: die Loeschung wird
  // gar nicht erst versucht, attemptContractEndCleanup vermerkt sie offen + protokolliert.
  const workosManagement = config.auth.workosManagementApiKey
    ? makeWorkosManagement(config)
    : null;
  // 312k-Phase 5: SMTP-Mailer NUR konstruieren, wenn ein Host gesetzt ist
  // (config.mail.smtpHost) - Muster workosManagement. Ungesetzt (Auslieferungszustand) ->
  // null: die Kuendigungsbestaetigung wird gar nicht erst versucht,
  // attemptCancellationMailConfirm vermerkt sie offen + protokolliert.
  const mailer = config.mail.smtpHost ? makeSmtpMailer(config) : null;
  // smtp-boot-probe: die Boot-Sonde selbst haengt NICHT an diesem pg-gated Block (der bei
  // STORE_BACKEND=json gar nicht laeuft, s. app.js) - sie sitzt unconditional in boot.js
  // (bootServer), Muster PROV-01 (reconcileOrphanedProvisioning), damit der Betreiber den
  // SMTP-Zustand auch ohne laufendes Portal/pg-Backend sieht.
  // Boot-Lauf + Sweep des Vertragsende-Aufraeumens (Rufnummer freigeben + WorkOS-Identitaet
  // loeschen, NUR fuer Tenants mit noch offenem Teilschritt - s. tenantsPendingContractEnd-
  // Cleanup, state-ops.js). Der direkte Aufruf sitzt in billing/webhook.js (SUSPEND-Zweig);
  // dieser Sweep ist NUR der Retry-Pfad fuer einen zuvor fehlgeschlagenen Versuch.
  scheduleContractEndCleanup({
    store,
    numberProvisioner: telnyxProvisioner,
    workos: workosManagement,
    auditStore,
  });
  // Boot-Lauf + Sweep der Kuendigungsbestaetigung per E-Mail (312k-Phase 5, NUR fuer
  // Tenants mit noch offenem Vermerk - s. tenantsPendingCancellationMail, state-ops.js).
  // Der direkte Ausloeser sitzt in self-service-routes.js (cancel-Route); dieser Sweep
  // ist NUR der Retry-Pfad fuer einen zuvor fehlgeschlagenen/uebersprungenen Versuch.
  scheduleCancellationMailSweep({ store, mailer, accounts, config, auditStore });
  const portalStore = makePortalStore(portalRunner);
  const webAuthMw = webAuth({ secret: config.auth.sessionSecret, sessions, accounts });
  // P5: pending-Variante fuer die Self-Aktivierungs-Routen (suspended erreichbar, sonst
  // 403-Deadlock). Gleiche Session-Mechanik, nur das Status-Gate ist gelockert (web-auth.js).
  const webAuthPendingMw = webAuthAllowPending({ secret: config.auth.sessionSecret, sessions, accounts });
  const adminMw = adminOnly({ adminEmails: config.auth.adminEmails });

  // P2b: Vor-/Nachname aus dem verifizierten IdP-Profil set-if-absent in den Gate-Store
  // schreiben (gleiche Kompositions-Quelle wie /api/onboard: applyOwnerIdentity ueber
  // setTenantIdentityIfAbsent + Store-Lock, G5). FAIL-OPEN wie ensureTenant: ein Store-
  // Schluckauf darf den Login NICHT blocken -> Folge ist ein eingeloggter Tenant ohne
  // ownerName, den das Outbound-Identitaets-Gate fail-CLOSED sperrt (kein Leak). save() NUR
  // bei echter Mutation (set-if-absent: Folge-Logins = No-Op). Kein Secret im Log. (byte-
  // identisch aus server.js verschoben.)
  const applyTenantIdentity = async (tenantId, identity) => {
    try {
      await store.withStoreLock(() => {
        const s = store.load();
        if (setTenantIdentityIfAbsent(s, tenantId, identity)) store.save();
      });
    } catch (e) {
      console.error("[web-auth] applyTenantIdentity fehlgeschlagen:", e.message);
    }
  };

  const loginRateLimiter = createRateLimiter(config.auth.loginRateLimitPerMin);
  app.use("/auth", loginRateLimiter);
  app.use(
    makeWebAuthRoutes({
      secret: config.auth.sessionSecret,
      redirectUri: config.server.publicUrl + "/auth/callback",
      ttlSeconds: config.auth.sessionTtlSeconds,
      // Login-Flow-Cookie-TTL (state/pkce/nonce), separat von der Session-TTL: grosszuegig
      // genug fuer den Mail-Verify-Round-Trip; Ablauf faengt die Callback-Recovery benign ab.
      loginCookieTtlSeconds: config.auth.loginCookieTtlSeconds,
      oidc,
      accounts,
      sessions,
      audit: auditStore,
      // Post-Login auf die App-Shell (/app) im unified Build. P14: der frueher zweite
      // Zweig (altes Kunden-Portal public/tenant.html, flag-gegatet) ist entfallen - die
      // Datei existiert nicht mehr, ein Redirect dorthin waere ein 404 direkt nach dem
      // Login. Ohne WEB_DIST_DIR bleibt der Default "/" (byte-identisch zum Bestand).
      postLoginPath: config.server.webDistDir ? appPath : undefined,
      // WorkOS-Sign-out-Rueckkehr-URL (return_to), symmetrisch zu redirectUri oben. Muss im
      // WorkOS-Dashboard als Sign-out-Redirect-URL registriert sein.
      postLogoutUrl: config.server.publicUrl + LOGIN_ROUTE,
      // Lokaler Dev-Login-Shim (NUR mit config.auth.devLoginEnabled, fail-closed): mintet dieselbe
      // Session wie der echte Callback fuer den Chrome-e2e-Loop ohne WorkOS.
      devLoginEnabled: config.auth.devLoginEnabled,
      // Signup-Spiegel-Nachzug: zieht den per accounts.upsertOnFirstLogin (mintSession) frisch
      // angelegten Tenant in den pg-Store-Spiegel, BEVOR der Self-Service-Subscribe-Pfad eine
      // WRITE-Store-Op (setTenantStripe etc.) ausloest, die ihn sonst nicht faende.
      ensureTenant: (tid) => store.ensureTenant(tid),
      // tenant-prolif-b: nach dem Login den (evtl. gemergten) sub in den Resolver-Index
      // spiegeln (mintSession), damit der MCP/REST-Kanal den kanonischen Tenant ohne Neustart
      // aufloest. Fassade store.bindSubToTenant (beide Backends).
      bindSub: (sub, tid) => store.bindSubToTenant(sub, tid),
      // P2b: Identitaets-Write (Vor-/Nachname aus dem verifizierten IdP-Profil) ueber die
      // Fassade in den Gate-Store - sonst sperrt das Outbound-Identitaets-Gate den Web-Tenant.
      applyTenantIdentity,
    }),
  );

  // Kunden-Portal (READ-only, tenant-scoped ueber portalStore). webAuthMw setzt req.tenant
  // (fail-closed); portalStore.withTenant erzwingt RLS. KEINE Owner-Daten. Ausschliesslich
  // ueber webAuth (Kunden-Session) gesichert - seit AUTH-P7 die einzige Schicht davor.
  app.get("/api/portal/state", webAuthMw, async (req, res) => {
    try {
      const calls = await portalStore.listCalls(req.tenant.tenantId);
      res.json({ tenantId: req.tenant.tenantId, calls });
    } catch (e) {
      console.error("[portal] state", e.message);
      res.status(500).json({ error: "interner Fehler" });
    }
  });

  // ---- Admin: Tenant freigeben / suspendieren (admin-allowlist, fail-closed) ----
  // Routen-Handler in makeAdminRoutes (web-auth.js), damit der Test exakt denselben Handler
  // prueft statt einer Replik (G5). suspend invalidiert sofort alle Sessions des Tenants;
  // jede Aktion auditiert; nicht-existenter Tenant -> 404. store: approve loescht den
  // suspended_at-Grace-Anker (tenant-prolif-c Invariante 2, G3-Fix).
  app.use(makeAdminRoutes({ accounts, sessions, audit: auditStore, webAuthMw, adminMw, store }));

  // ---- Self-Service (I9 + #3): web-session-only, hinter webAuthMw ----------------
  // Konvergenz #3: Self-Service haengt jetzt am echten OIDC-Browser-Login statt am
  // X-Internal-Identity-Pfad. NUR hier (im Web-Login-Block: sessionSecret + pg) registriert
  // -> ohne Web-Login-Infra existieren die Routen nicht (404). Zusaetzlich an
  // SELF_SERVICE_ENABLED + MULTI_TENANT gegated (eigenes Reife-Flag; ohne MULTI_TENANT keyt
  // der Mirror nur den Owner-Bucket). Ausschliesslich ueber webAuthMw (Kunden-Session)
  // gesichert, keine Admin-Sitzung. audit = util.audit (nur Keys, keine Werte/PII).
  if (isSelfServiceLive(config)) {
    app.use(
      makeSelfServiceRoutes({
        store,
        webAuthMw,
        webAuthPendingMw,
        audit,
        config,
        billing: stripeBilling,
        accounts,
        provision,
        // 312k-P3: Nachweis auf dauerhaftem Datentraeger (§ 312k BGB) fuer die
        // Kuendigung/Ruecknahme - derselbe auditStore, den makeAdminRoutes oben schon
        // fuer tenant_approve/tenant_suspend nutzt (EINE Postgres-audit_log-Quelle,
        // KEIN zweiter Schreibpfad). util.audit (Parameter audit oben) bleibt reiner
        // console.log und ist fuer den gesetzlich verlangten Nachweis untauglich.
        auditStore,
        // 312k-Phase 5: derselbe SMTP-Mailer wie der periodische Sweep oben
        // (scheduleCancellationMailSweep) - EINE Quelle, kein Drift.
        mailer,
      }),
    );
  }

  // ---- Stripe-Webhook (W4): Abo-Lifecycle nachziehen ------------------------------
  // KEINE Sitzungspflicht (Stripe kann keine Credentials senden) - die Sicherung ist die
  // HMAC-Signaturpruefung gegen STRIPE_WEBHOOK_SECRET (fail-closed, eigener Begruendungs-
  // Kommentar wie /voice). Ohne PAYMENT_ENABLED -> 404 (byte-identisch). Liegt im
  // guardedBoot-Block, weil applyStripeWebhookSerialized accounts.setStatus +
  // sessions.invalidateByTenant braucht (nur hier konstruiert). Serialisiert pro Stripe-
  // Korrelationsschluessel (subscriptionId, Fallback tenantRef) + verwirft veraltete/doppelte
  // Events (Ordnungswache) - Details in billing/webhook.js. Idempotent: jeder Event wirkt nur
  // als Vorwaerts-Zustand.
  app.post(
    stripeWebhookPath,
    makeStripeWebhookRoute({
      config, store, audit, accounts, sessions, billing: stripeBilling, provision, messaging,
      // 312k-Phase 4: derselbe Telnyx-Port/WorkOS-Adapter/durable Nachweis wie der
      // periodische Sweep oben (scheduleContractEndCleanup) - EINE Quelle, kein Drift.
      numberProvisioner: telnyxProvisioner,
      workos: workosManagement,
      auditStore,
    }),
  );

  // Q1: positiver Boot-Marker im Erfolgsfall - eigene Zeile. Erreicht NUR wenn alle Mounts
  // durchliefen; wirft ein Schritt vorher, faengt guardedBoot es als "deaktiviert" (fail-open)
  // ab und diese Zeile bleibt aus. Macht den fail-open-Zustand dauerhaft sichtbar (Render-Log)
  // statt lautlos 404.
  console.log("[boot] Web-Login aktiv");

  // AUTH-P6: die Betreiber-Sicherung nach oben reichen. webAuthMw/adminMw entstehen fuer
  // die Admin-Routen ohnehin HIER - ein zweiter Bau waere eine zweite Wahrheit darueber,
  // wer Admin ist (G5). Rueckgabe erst NACH allen Mounts: wirft ein Schritt vorher, faengt
  // guardedBoot es ab, der Aufrufer bekommt nichts und mountet die Betreiber-Routen nicht.
  return { webAuthMw, adminMw };
}
