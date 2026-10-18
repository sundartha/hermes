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
import { mountCookieConsentLog } from "../cookie-consent-log.js";
import { mountSelfServiceRoutes } from "../self-service-routes.js";
import { createRateLimiter } from "../middleware.js";
import { setTenantIdentityIfAbsent } from "../store/state-ops.js";
import { runReleaseReconcile } from "../release-reconcile.js";
import { numberProvisioning } from "../telephony/registry.js";
import { PROVIDER } from "../store/defaults.js";
import { sipRegistrarWennAktiv } from "../elevenlabs/nummern-registrierung.js";
import { stripeBilling } from "../billing/stripe.js";
import { makeStripeWebhookRoute } from "../routes/stripe-webhook.js";
import { isSelfServiceLive } from "../config.js";
import { makeWorkosManagement } from "../workos-management.js";
import { runContractEndCleanupSweep } from "../billing/contract-end-cleanup.js";
import { runStripeSubscriptionReconcile } from "../billing/stripe-reconcile.js";
import { makeSmtpMailer } from "../smtp-mail.js";
import { makeBrevoMailer } from "../brevo-mail.js";
import { mailerKonstruierbar } from "../boot-guard.js";
import { runCancellationMailSweep } from "../billing/cancellation-mail.js";

const RELEASE_RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const CONTRACT_END_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

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

const CANCELLATION_MAIL_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

function scheduleCancellationMailSweep(deps) {
  scheduleSweep("[cancellation-mail]", CANCELLATION_MAIL_SWEEP_INTERVAL_MS, () => runCancellationMailSweep(deps));
}

const STRIPE_RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
  if (config.mail.brevoApiKey) return _makeBrevoMailer(config);
  return _makeSmtpMailer(config);
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
  accountsRef, auditStoreRef,
}) {
  const portalRunner = await createPortalRunner();
  const oidc = makeOidc(config);
  const accounts = makeAccounts(portalRunner, {
    defaultCountry: config.provisioning.provisioningCountry,
  });
  if (accountsRef) accountsRef.current = accounts;
  const sessions = makeSessions(portalRunner);
  const auditStore = makeAuditStore(portalRunner); if (auditStoreRef) Object.assign(auditStoreRef, { current: auditStore });
  const telnyxProvisioner = numberProvisioning(PROVIDER.TELNYX);
  scheduleReleaseReconcile({
    store,
    provisioner: telnyxProvisioner,
    audit: auditStore,
    graceMs: config.provisioning.releaseGraceMs, sipRegistrar: sipRegistrarWennAktiv(config),
  });
  const workosManagement = config.auth.workosManagementApiKey
    ? makeWorkosManagement(config)
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

  app.use("/auth", createRateLimiter(config.auth.loginRateLimitPerMin));
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
      applyTenantIdentity,
    }),
  );

  app.get("/api/portal/state", webAuthMw, async (req, res) => {
    try {
      const calls = await portalStore.listCalls(req.tenant.tenantId);
      res.json({ tenantId: req.tenant.tenantId, calls });
    } catch (e) {
      console.error("[portal] state", e.message);
      res.status(500).json({ error: "interner Fehler" });
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

  app.post(
    stripeWebhookPath,
    makeStripeWebhookRoute({
      config, store, audit, accounts, sessions, billing: stripeBilling, provision, messaging,
      numberProvisioner: telnyxProvisioner,
      workos: workosManagement,
      auditStore, sipRegistrar: sipRegistrarWennAktiv(config),
    }),
  );

  if (config.billing.paymentEnabled) {
    scheduleStripeReconcile({
      store,
      billing: stripeBilling,
      webhookDeps: {
        store, accounts, sessions, audit, req: null, provision, billing: stripeBilling,
        numberProvisioner: telnyxProvisioner,
        workos: workosManagement,
        auditStore, sipRegistrar: sipRegistrarWennAktiv(config),
      },
    });
  }

  console.log("[boot] Web-Login aktiv");

  return { webAuthMw, adminMw };
}
