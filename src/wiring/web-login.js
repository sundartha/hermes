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
import { makeLoginBremse, makePortalStore } from "../store/portal.js";
import { createPortalRunner as defaultCreatePortalRunner } from "../portal-pool.js";
import { makeAuditStore } from "../audit-store.js";
import { mountCookieConsentLog } from "../cookie-consent-log.js";
import { mountSelfServiceRoutes } from "../self-service-routes.js";
import { createGeteilterRateLimiter } from "../middleware.js";
import { setTenantIdentityIfAbsent } from "../store/state-ops.js";
import { runReleaseReconcile } from "../release-reconcile.js";
import { numberProvisioning } from "../telephony/registry.js";
import { PROVIDER } from "../begriffe/nummern-vergabe.js";
import { sipRegistrarWennAktiv } from "../elevenlabs/nummern-registrierung.js";
import { HTTP_SERVER_ERROR } from "../utils/http.js";
import { MS_PER_HOUR } from "../utils/timer.js";
import { stripeBilling } from "../billing/stripe.js";
import { makeStripeWebhookRoute } from "../routes/stripe-webhook.js";
import { isSelfServiceLive } from "../config.js";
import { makeWorkosManagement } from "../workos-management.js";
import { runContractEndCleanupSweep } from "../billing/contract-end-cleanup.js";
import { runStripeSubscriptionReconcile } from "../billing/stripe-reconcile.js";
import { makeSmtpMailer } from "../smtp-mail.js";
import { makeBrevoMailer } from "../brevo-mail.js";
import { umhuelleAnbieter } from "../utils/anbieter-messung.js";
import { mailerKonstruierbar } from "../boot-guard.js";
import { runCancellationMailSweep } from "../billing/cancellation-mail.js";

const RELEASE_RECONCILE_INTERVAL_MS = 6 * MS_PER_HOUR;

const CONTRACT_END_CLEANUP_INTERVAL_MS = 6 * MS_PER_HOUR;

function scheduleSweep(logTag, intervalMs, sweep) {
  const run = () => void sweep().catch((error) => console.error(logTag, error.message));
  run();
  setInterval(run, intervalMs).unref();
}

function scheduleReleaseReconcile(deps) {
  scheduleSweep("[did-release]", RELEASE_RECONCILE_INTERVAL_MS, () =>
    runReleaseReconcile({ ...deps, nowMs: Date.now() }),
  );
}

function scheduleContractEndCleanup(deps) {
  scheduleSweep("[contract-end]", CONTRACT_END_CLEANUP_INTERVAL_MS, () => runContractEndCleanupSweep(deps));
}

const CANCELLATION_MAIL_SWEEP_INTERVAL_MS = 6 * MS_PER_HOUR;

function scheduleCancellationMailSweep(deps) {
  scheduleSweep("[cancellation-mail]", CANCELLATION_MAIL_SWEEP_INTERVAL_MS, () => runCancellationMailSweep(deps));
}

const STRIPE_RECONCILE_INTERVAL_MS = 6 * MS_PER_HOUR;

function scheduleStripeReconcile(deps) {
  scheduleSweep("[stripe-reconcile]", STRIPE_RECONCILE_INTERVAL_MS, () =>
    runStripeSubscriptionReconcile({ ...deps, nowMs: Date.now() }),
  );
}

export function selectMailer(
  config,
  { _makeBrevoMailer = makeBrevoMailer, _makeSmtpMailer = makeSmtpMailer } = {},
) {
  if (!mailerKonstruierbar(config.mail)) return null;
  if (config.mail.brevoApiKey) return umhuelleAnbieter("brevo", _makeBrevoMailer(config));
  return _makeSmtpMailer(config);
}

function makeApplyTenantIdentity(store) {
  return async (tenantId, identity) => {
    try {
      await store.withStoreLock(() => {
        const state = store.load();
        if (setTenantIdentityIfAbsent(state, tenantId, identity)) store.save();
      });
    } catch (error) {
      console.error("[web-auth] applyTenantIdentity fehlgeschlagen:", error.message);
    }
  };
}

function loginBremseMiddleware(portalRunner, config) {
  const { zaehlen } = makeLoginBremse(portalRunner, config.auth.sessionSecret);
  return createGeteilterRateLimiter({ zaehlen, limitPerMin: config.auth.loginRateLimitPerMin });
}

export async function wireWebLogin({
  app,
  config,
  store,
  audit,
  provision,
  createPortalRunner = defaultCreatePortalRunner,
  stripeWebhookPath,
  appPath,
  messaging,
}) {
  const portalRunner = await createPortalRunner();
  const oidc = umhuelleAnbieter("workos", makeOidc(config));
  const accounts = makeAccounts(portalRunner, {
    defaultCountry: config.provisioning.provisioningCountry,
  });
  const sessions = makeSessions(portalRunner);
  const auditStore = makeAuditStore(portalRunner);
  const telnyxProvisioner = numberProvisioning(PROVIDER.TELNYX);
  scheduleReleaseReconcile({
    store,
    provisioner: telnyxProvisioner,
    audit: auditStore,
    graceMs: config.provisioning.releaseGraceMs, sipRegistrar: sipRegistrarWennAktiv(config),
  });
  const workosManagement = config.auth.workosManagementApiKey
    ? umhuelleAnbieter("workos", makeWorkosManagement(config))
    : null;
  const mailer = selectMailer(config);
  scheduleContractEndCleanup({
    store,
    numberProvisioner: telnyxProvisioner,
    workos: workosManagement,
    auditStore, sipRegistrar: sipRegistrarWennAktiv(config),
  });
  scheduleCancellationMailSweep({ store, mailer, accounts, config, auditStore });
  const portalStore = makePortalStore(portalRunner);
  const webAuthMw = webAuth({ secret: config.auth.sessionSecret, sessions, accounts });
  const webAuthPendingMw = webAuthAllowPending({ secret: config.auth.sessionSecret, sessions, accounts });
  const adminMw = adminOnly({ adminEmails: config.auth.adminEmails });

  app.use("/auth", loginBremseMiddleware(portalRunner, config));
  app.use(
    makeWebAuthRoutes({
      secret: config.auth.sessionSecret,
      redirectUri: config.server.publicUrl + "/auth/callback",
      ttlSeconds: config.auth.sessionTtlSeconds,
      loginCookieTtlSeconds: config.auth.loginCookieTtlSeconds,
      oidc,
      accounts,
      sessions,
      audit: auditStore,
      postLoginPath: config.server.webDistDir ? appPath : undefined,
      postLogoutUrl: config.server.publicUrl + LOGIN_ROUTE,
      devLoginEnabled: config.auth.devLoginEnabled,
      ensureTenant: (tid) => store.ensureTenant(tid),
      bindSub: (sub, tid) => store.bindSubToTenant(sub, tid),
      applyTenantIdentity: makeApplyTenantIdentity(store),
    }),
  );

  app.get("/api/portal/state", webAuthMw, async (req, res) => {
    try {
      const calls = await portalStore.listCalls(req.tenant.tenantId);
      res.json({ tenantId: req.tenant.tenantId, calls });
    } catch (e) {
      console.error("[portal] state", e.message);
      res.status(HTTP_SERVER_ERROR).json({ error: "interner Fehler" });
    }
  });

  app.use(makeAdminRoutes({ accounts, sessions, audit: auditStore, webAuthMw, adminMw, store }));

  mountCookieConsentLog({ app, runner: portalRunner });

  if (isSelfServiceLive(config)) {
    app.use(
      mountSelfServiceRoutes({
        store,
        webAuthMw,
        webAuthPendingMw,
        audit,
        config,
        billing: stripeBilling,
        accounts,
        provision,
        auditStore,
        mailer,
      }),
    );
  }

  const stripeWebhookDeps = {
    store, accounts, sessions, audit, provision, billing: stripeBilling,
    numberProvisioner: telnyxProvisioner,
    workos: workosManagement,
    auditStore, sipRegistrar: sipRegistrarWennAktiv(config),
  };
  app.post(stripeWebhookPath, makeStripeWebhookRoute({ config, messaging, ...stripeWebhookDeps }));

  if (config.billing.paymentEnabled) {
    scheduleStripeReconcile({ store, billing: stripeBilling, webhookDeps: { ...stripeWebhookDeps, req: null } });
  }

  console.log("[boot] Web-Login aktiv");

  return { webAuthMw, adminMw, accounts, auditStore };
}
