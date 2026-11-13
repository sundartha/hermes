import { Router } from "express";
import { z } from "zod";
import { pruefeAbfrage, pruefeKoerper } from "./utils/eingabe-pruefen.js";
import { createSameOriginGuard } from "./middleware.js";
import { promptLineRejection } from "./routes/_validation.ts";
import { selfServicePatch, hasCardOnFile, lockedSelfServiceKeys } from "./self-service.js";
import { greetingTemplatesFor } from "./i18n/greeting-catalog.js";
import { PERSONA_STYLE_IDS, localeFor } from "./i18n/locales.js";
import { bindCardFromSession, startCheckoutWithStaleCustomerHeal } from "./billing/card-setup.ts";
import { requirePaymentEnabled, requirePublicUrl } from "./billing/payment-gate.ts";
import {
  createTenantSubscription,
  priceIdForPlan,
  activateSubscriptionFromCheckoutSession,
  hasActiveSubscription,
  checkoutSessionIdempotencyKey,
} from "./billing/subscribe.ts";
import { activatePaidTenant, profileAuditDetail } from "./billing/activation.ts";
import { attemptCancellationMailConfirm } from "./billing/cancellation-mail.js";
import { setSubscriptionCancellation } from "./billing/subscription-cancellation.ts";
import { provisionAuditDetail } from "./billing/provision-outcome.ts";
import {
  PROVISION_RETRY_OUTCOME,
  resolveAutoProvisionRetry,
  retriggerFailedProvisioning,
} from "./billing/provision-retry.ts";
import {
  publicCall,
  activeNumberFor,
  numberStatusFor,
  upcomingCalendar,
  tenantLanguage,
  NUMBER_DISPLAY_STATUS,
} from "./store/views.ts";
import { tenantGeo } from "./store/state-ops.js";
import { holdAmountForCountry } from "./telephony/provisioning-geo.js";
import { kauflandFuer, speicherBereiche } from "./store.js";
import { isKnownPlanSlug } from "./plans.ts";
import { tenantQuotaView } from "./billing/meter.js";
import { CHECKOUT_RETURN, subscriptionReturnPath } from "./portal-paths.js";
import {
  planAddNewsletterRecipient,
  newNewsletterTokens,
  newsletterConfirmUrl,
  hashNewsletterToken,
  normalizeEmail,
  publicNewsletterRecipients,
  renderNewsletterPage,
} from "./newsletter-recipients.ts";
import { hashEmail } from "./util.ts";
import {
  HTTP_BAD_GATEWAY,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_FORBIDDEN,
  HTTP_SERVER_ERROR,
  HTTP_SERVICE_UNAVAILABLE,
} from "./utils/http.ts";

const NEXT_SETUP_CHECKOUT = "setup-checkout";

const NUMBER_SETUP_REASON = Object.freeze({
  PAYMENT_METHOD: "payment_method_unsuitable",
  RETRY_PENDING: "retry_pending",
  MANUAL: "manual_review",
});

const REASON_JE_AUSGANG = Object.freeze({
  [PROVISION_RETRY_OUTCOME.PAYMENT_METHOD_UNSUITABLE]: NUMBER_SETUP_REASON.PAYMENT_METHOD,
  [PROVISION_RETRY_OUTCOME.RETRY]: NUMBER_SETUP_REASON.RETRY_PENDING,
  [PROVISION_RETRY_OUTCOME.THROTTLED]: NUMBER_SETUP_REASON.RETRY_PENDING,
});

function numberSetupReason(state, { tenantId, numberStatus, maxAttempts }) {
  if (numberStatus !== NUMBER_DISPLAY_STATUS.FAILED) return "";
  const { outcome } = resolveAutoProvisionRetry(state, { tenantId, maxAttempts });
  return REASON_JE_AUSGANG[outcome] || NUMBER_SETUP_REASON.MANUAL;
}

function agentView(state, { tenantId, ownerName, maxAttempts }) {
  const numberStatus = numberStatusFor(state, tenantId);
  return {
    number: activeNumberFor(state, tenantId),
    owner: ownerName,
    numberStatus,
    numberStatusReason: numberSetupReason(state, { tenantId, numberStatus, maxAttempts }),
  };
}

function maskPrivateNumber(e164) {
  if (!e164) return null;
  return `${e164.slice(0, 3)}…${e164.slice(-4)}`;
}

function paymentView(store, config, tenant) {
  if (!config.billing.paymentEnabled) return {};
  const { planSlug, currentPeriodEnd, cancelAtPeriodEnd } = store.tenantSubscription(tenant);
  return {
    hasCard: hasCardOnFile(store.tenantStripe(tenant)),
    subscription: { planSlug, currentPeriodEnd, cancelAtPeriodEnd },
    quota: tenantQuotaView(store, tenant),
  };
}

function numberSetupFeeCentsFor(s, config, tenant) {
  if (!config.billing.paymentEnabled) return 0;
  const { country: homeCountry } = tenantGeo(s, tenant);
  const country = kauflandFuer(homeCountry);
  return holdAmountForCountry(country, config.billing.numberSetupFeeCents);
}

function returnSuccessUrl(publicUrl, planSlug) {
  const base = `${publicUrl}/api/self-service/billing/return?session_id={CHECKOUT_SESSION_ID}`;
  return planSlug ? `${base}&plan=${planSlug}` : base;
}

function createCheckoutSession({ billing, config, tenant, customerId, planSlug, priceId }) {
  const successUrl = returnSuccessUrl(config.server.publicUrl, planSlug);
  const cancelUrl = `${config.server.publicUrl}${CHECKOUT_RETURN.CARD_CANCELED}`;
  if (!planSlug)
    return billing.createSetupCheckoutSession({ tenantRef: tenant, customerId, successUrl, cancelUrl });
  return billing.createSubscriptionCheckoutSession({
    tenantRef: tenant,
    customerId,
    priceId,
    planSlug,
    successUrl,
    cancelUrl,
    idempotencyKey: checkoutSessionIdempotencyKey({ tenant, planSlug, priceId, customerId }),
  });
}

async function subscribeAndActivate({ store, billing, config, accounts, provision, tenant, planSlug }) {
  const result = await createTenantSubscription({ store, billing, config, tenant, planSlug });
  if (!result.ok) return result;
  const { profile, provisioned } = await activatePaidTenant({ store, accounts, provision, billing, tenant });
  return { ...result, profile, provisioned };
}

function asyncBilling(fn, onError) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`self-service billing route failed: ${err.message}`);
      if (!res.headersSent) onError(res);
    }
  };
}

const billingUnavailable = (res) => res.status(HTTP_BAD_GATEWAY).json({ error: "billing_unavailable" });

async function finishCardOnlyReturn({ store, provision, config, audit, req, tenant }) {
  const { outcome } = await retriggerFailedProvisioning({
    store,
    provision,
    tenantId: tenant,
    maxAttempts: config.provisioning.provisioningRetryMaxAttempts,
  });
  audit("self_service_card_saved", req, `tenant=${tenant} wiederanlauf=${outcome}`);
}

const TOKEN_ABFRAGE = z.object({ token: z.string().catch("") });
const PLAN_TEXT = z.string().refine(isKnownPlanSlug);
const BEKANNTER_PLAN = PLAN_TEXT.nullable().catch(null);
const RUECKKEHR_ABFRAGE = z.object({ session_id: z.string().min(1), plan: BEKANNTER_PLAN });
const koerperMit = (felder) => z.object(felder).catch({});
const PRIVATE_NUMBER_KOERPER = koerperMit({ privateNumber: z.unknown() });
const CONSENT_KOERPER = koerperMit({ consent: z.unknown() });
const EMAIL_KOERPER = koerperMit({ email: z.unknown() });
const ABO_KOERPER = koerperMit({ plan: z.unknown() });
const CHECKOUT_KOERPER = koerperMit({ plan: BEKANNTER_PLAN });
const AGENT_NAME_KOERPER = koerperMit({ agentName: z.unknown() });

export function makeSelfServiceRoutes({
  store,
  webAuthMw,
  webAuthPendingMw,
  audit,
  config,
  billing,
  accounts,
  provision,
  auditStore = { record: async () => {} },
  mailer = null,
}) {
  const router = Router();
  const bereiche = speicherBereiche(store);

  router.get("/api/self-service/state", webAuthMw, async (req, res) => {
    const tenant = req.tenant.tenantId;
    await store.einstellungenNachladen?.(tenant);
    const data = store.exportTenantData(tenant);
    const ctx = store.tenantContext(tenant);
    const agentState = store.load();
    const language = tenantLanguage(agentState, tenant);
    let accountEmail = null;
    if (accounts) {
      try {
        const account = await accounts.accountByTenant(tenant);
        accountEmail = account?.email ?? null;
      } catch (e) {
        console.error("[self-service] accountEmail lookup:", e.message);
      }
    }
    res.json({
      settings: ctx.settings,
      language,
      formatLocale: localeFor(language).dateLocale,
      greetingTemplates: greetingTemplatesFor(language),
      personaStyleIds: PERSONA_STYLE_IDS,
      privateNumber: maskPrivateNumber(store.tenantPrivateNumber(tenant)),
      newsletter: await bereiche.newsletter.tenantNewsletterConsent(tenant),
      accountEmail,
      newsletterRecipients: publicNewsletterRecipients(await bereiche.newsletter.tenantNewsletterRecipients(tenant)),
      ...paymentView(store, config, tenant),
      numberSetupFeeCents: numberSetupFeeCentsFor(agentState, config, tenant),
      currency: config.billing.paymentCurrency,
      calls: data.calls.map(publicCall),
      actionItems: data.actionItems,
      notifications: data.notifications,
      calendar: upcomingCalendar(store, tenant),
      agent: agentView(agentState, {
        tenantId: tenant,
        ownerName: ctx.ownerName,
        maxAttempts: config.provisioning.provisioningRetryMaxAttempts,
      }),
    });
  });

  router.post("/api/self-service/settings", webAuthMw, async (req, res) => {
    const tenant = req.tenant.tenantId;
    const locked = lockedSelfServiceKeys(req.body);
    if (locked.length) {
      audit("self_service_settings_denied", req, `locked=${locked.join(",")}`);
      return res.status(HTTP_CONFLICT).json({ error: "country_change_unsupported", remedy: "contact_support" });
    }
    await store.einstellungenNachladen?.(tenant);
    const current = store.tenantContext(tenant).settings;
    const { clean, rejected } = selfServicePatch(req.body || {}, current);
    const ergebnis = await bereiche.einstellungen.updateSettings(tenant, clean);
    const { settings, changed } = ergebnis;
    if ((await ergebnis.geschrieben) === false) {
      return res.status(HTTP_SERVICE_UNAVAILABLE).json({ error: "settings_not_saved" });
    }
    audit(
      "self_service_settings",
      req,
      `keys=${changed.join(",") || "-"} rejected=${rejected.join(",") || "-"}`,
    );
    res.json(settings);
  });

  router.post("/api/self-service/private-number", webAuthMw, (req, res) => {
    const tenant = req.tenant.tenantId;
    const { privateNumber } = pruefeKoerper(res, { schema: PRIVATE_NUMBER_KOERPER }, req.body);
    try {
      store.setPrivateNumber(tenant, privateNumber);
    } catch {
      audit("self_service_private_number", req, "outcome=rejected");
      return res.status(HTTP_BAD_REQUEST).json({ error: "invalid_private_number" });
    }
    const stored = store.tenantPrivateNumber(tenant) != null;
    audit("self_service_private_number", req, `outcome=${stored ? "set" : "cleared"}`);
    res.json({ ok: true, hasPrivateNumber: stored });
  });

  router.post("/api/self-service/newsletter-consent", webAuthMw, async (req, res) => {
    const tenant = req.tenant.tenantId;
    const { consent } = pruefeKoerper(res, { schema: CONSENT_KOERPER }, req.body);
    try {
      await bereiche.newsletter.setNewsletterConsent(tenant, consent);
    } catch {
      audit("self_service_newsletter_consent", req, "outcome=rejected");
      return res.status(HTTP_BAD_REQUEST).json({ error: "invalid_newsletter_consent" });
    }
    try {
      await auditStore.record({
        actorSub: req.tenant.sub,
        tenantId: tenant,
        action: consent
          ? "self_service_newsletter_consent_granted"
          : "self_service_newsletter_consent_revoked",
      });
    } catch (err) {
      console.error(`self-service newsletter-consent audit write failed: ${err.message}`);
    }
    audit("self_service_newsletter_consent", req, `outcome=${consent ? "granted" : "revoked"}`);
    res.json({ ok: true, newsletterConsent: consent });
  });

  router.post("/api/self-service/newsletter-recipients", webAuthMw, async (req, res) => {
    const tenant = req.tenant.tenantId;
    const { email: rawEmail } = pruefeKoerper(res, { schema: EMAIL_KOERPER }, req.body);
    let accountEmail = null;
    if (accounts) {
      try {
        const account = await accounts.accountByTenant(tenant);
        accountEmail = account?.email ?? null;
      } catch (e) {
        console.error("[self-service] newsletter-recipients accountEmail lookup:", e.message);
      }
    }
    const plan = planAddNewsletterRecipient({ store, tenantId: tenant, rawEmail, accountEmail });
    if (!plan.ok) {
      audit("self_service_newsletter_recipient_add", req, `outcome=rejected reason=${plan.reason}`);
      return res.status(HTTP_BAD_REQUEST).json({ error: plan.reason });
    }
    const tokens = newNewsletterTokens();
    store.addNewsletterRecipient(tenant, {
      email: plan.email,
      tokenHash: tokens.tokenHash,
      tokenExpiresAt: tokens.tokenExpiresAt,
      unsubToken: tokens.unsubToken,
    });
    if (mailer) {
      try {
        const language = tenantLanguage(store.load(), tenant);
        const ownerName = store.tenantContext(tenant).ownerName;
        const t = localeFor(language).newsletter;
        const confirmUrl = newsletterConfirmUrl(config.server.publicUrl, tokens.confirmToken);
        await mailer.sendMail({
          to: plan.email,
          subject: t.confirmMailSubject,
          text: t.confirmMailText(ownerName, confirmUrl),
        });
      } catch (e) {
        console.error("[newsletter-confirm-mail]", e.message);
      }
    }
    try {
      await auditStore.record({
        actorSub: req.tenant.sub,
        tenantId: tenant,
        action: "self_service_newsletter_recipient_added",
        detail: `email_fp=${hashEmail(plan.email)}`,
      });
    } catch (err) {
      console.error(`self-service newsletter-recipients audit write failed: ${err.message}`);
    }
    audit("self_service_newsletter_recipient_add", req, "outcome=pending");
    res.json({ ok: true, status: "pending" });
  });

  router.delete("/api/self-service/newsletter-recipients", webAuthMw, async (req, res) => {
    const tenant = req.tenant.tenantId;
    const email = normalizeEmail(pruefeKoerper(res, { schema: EMAIL_KOERPER }, req.body).email);
    const changed = await bereiche.newsletter.removeNewsletterRecipient(tenant, email);
    try {
      await auditStore.record({
        actorSub: req.tenant.sub,
        tenantId: tenant,
        action: "self_service_newsletter_recipient_removed",
        detail: `email_fp=${hashEmail(email)} changed=${changed}`,
      });
    } catch (err) {
      console.error(`self-service newsletter-recipients audit write failed: ${err.message}`);
    }
    audit("self_service_newsletter_recipient_remove", req, `outcome=${changed ? "removed" : "not_found"}`);
    res.json({ ok: true, removed: changed });
  });

  async function newsletterBestaetigen(req, res) {
    const { token } = pruefeAbfrage(res, { schema: TOKEN_ABFRAGE }, req.query);
    const result = token
      ? await bereiche.newsletter.confirmNewsletterRecipientByToken(
          hashNewsletterToken(token),
          new Date().toISOString(),
        )
      : null;
    const language = result ? tenantLanguage(store.load(), result.tenantId) : null;
    const t = localeFor(language).newsletter;
    if (!result) {
      audit("newsletter_recipient_confirm_failed", req, "reason=invalid_or_expired");
      return res
        .status(HTTP_BAD_REQUEST)
        .type("html")
        .send(renderNewsletterPage({ title: t.invalidPageTitle, body: t.invalidPageBody, lang: language || "de" }));
    }
    auditStore
      .record({
        tenantId: result.tenantId,
        action: "newsletter_recipient_confirmed",
        detail: `email_fp=${hashEmail(result.email)}`,
      })
      .catch((err) => console.error(`newsletter confirm audit write failed: ${err.message}`));
    audit("newsletter_recipient_confirmed", req, `tenant=${result.tenantId}`);
    res
      .type("html")
      .send(renderNewsletterPage({ title: t.confirmedPageTitle, body: t.confirmedPageBody, lang: language }));
  }

  router.get("/newsletter/confirm", (req, res, next) => {
    newsletterBestaetigen(req, res).catch(next);
  });

  async function newsletterAbmelden(req, res) {
    const { token } = pruefeAbfrage(res, { schema: TOKEN_ABFRAGE }, req.query);
    const result = token ? await bereiche.newsletter.unsubscribeNewsletterRecipientByToken(token) : null;
    const language = result ? tenantLanguage(store.load(), result.tenantId) : null;
    const t = localeFor(language).newsletter;
    if (!result) {
      audit("newsletter_recipient_unsubscribe_failed", req, "reason=invalid_or_already_removed");
      return res
        .status(HTTP_BAD_REQUEST)
        .type("html")
        .send(renderNewsletterPage({ title: t.invalidPageTitle, body: t.invalidPageBody, lang: language || "de" }));
    }
    auditStore
      .record({
        tenantId: result.tenantId,
        action: "newsletter_recipient_unsubscribed",
        detail: `email_fp=${hashEmail(result.email)}`,
      })
      .catch((err) => console.error(`newsletter unsubscribe audit write failed: ${err.message}`));
    audit("newsletter_recipient_unsubscribed", req, `tenant=${result.tenantId}`);
    res
      .type("html")
      .send(
        renderNewsletterPage({ title: t.unsubscribedPageTitle, body: t.unsubscribedPageBody, lang: language }),
      );
  }

  router.get("/newsletter/unsubscribe", (req, res, next) => {
    newsletterAbmelden(req, res).catch(next);
  });

  router.get("/api/self-service/billing/status", webAuthPendingMw, (req, res) => {
    const tenant = req.tenant.tenantId;
    const s = store.load();
    res.json({
      paymentEnabled: !!config.billing.paymentEnabled,
      hasCard: hasCardOnFile(store.tenantStripe(tenant)),
      planSlug: store.tenantSubscription(tenant).planSlug,
      status: req.tenant.status,
      numberSetupFeeCents: numberSetupFeeCentsFor(s, config, tenant),
      currency: config.billing.paymentCurrency,
    });
  });

  router.post(
    "/api/self-service/billing/setup-checkout",
    webAuthPendingMw,
    asyncBilling(
      async (req, res) => {
        if (!requirePaymentEnabled(res, config)) return;
        if (!requirePublicUrl(res, config)) return;
        const tenant = req.tenant.tenantId;
        const { plan: planSlug } = pruefeKoerper(res, { schema: CHECKOUT_KOERPER }, req.body);
        const priceId = planSlug ? priceIdForPlan(planSlug, config) : null;
        if (planSlug && !priceId) return res.status(HTTP_SERVER_ERROR).json({ error: "plan_unconfigured" });
        if (planSlug && hasActiveSubscription(store, tenant))
          return res.status(HTTP_CONFLICT).json({ error: "already_subscribed" });
        const { session, healed } = await startCheckoutWithStaleCustomerHeal(
          { store, billing, tenant, retryDelayMs: config.billing.stripeCustomerRetryDelayMs },
          (customerId) =>
            createCheckoutSession({ billing, config, tenant, customerId, planSlug, priceId }),
        );
        if (healed) audit("stripe_customer_self_heal", req, `tenant=${tenant}`);
        audit(
          "self_service_setup_checkout",
          req,
          `tenant=${tenant}${planSlug ? ` plan=${planSlug} mode=subscription` : ""}`,
        );
        res.json({ url: session.url });
      },
      billingUnavailable,
    ),
  );

  router.get(
    "/api/self-service/billing/return",
    webAuthPendingMw,
    asyncBilling(
      async (req, res) => {
        if (!requirePaymentEnabled(res, config)) return;
        const tenant = req.tenant.tenantId;
        const abfrage = pruefeAbfrage(res, { schema: RUECKKEHR_ABFRAGE, meldung: "session_id ist Pflicht" }, req.query);
        if (abfrage === undefined) return;
        const sessionId = abfrage.session_id;

        const carriedPlan = abfrage.plan;
        if (!carriedPlan) {
          const { ok } = await bindCardFromSession({ store, billing, tenant, sessionId });
          if (!ok) {
            audit("self_service_card_mismatch", req, `tenant=${tenant}`);
            return res.status(HTTP_FORBIDDEN).json({ error: "Customer-Mismatch" });
          }
          await finishCardOnlyReturn({ store, provision, config, audit, req, tenant });
          return res.redirect(CHECKOUT_RETURN.CARD_OK);
        }

        const result = await activateSubscriptionFromCheckoutSession({
          store, billing, accounts, provision, tenant, sessionId, expectedPlanSlug: carriedPlan,
        });
        if (result.reason === "customer_mismatch" || result.reason === "plan_mismatch") {
          audit("self_service_card_mismatch", req, `tenant=${tenant} reason=${result.reason}`);
          return res.status(HTTP_FORBIDDEN).json({ error: "Customer-Mismatch" });
        }
        if (result.reason === "subscription_conflict") {
          audit(
            "self_service_subscription_conflict",
            req,
            `tenant=${tenant} plan=${carriedPlan} orphanedSubscriptionId=${result.subscriptionId}`,
          );
          return res.redirect(CHECKOUT_RETURN.SUB_FAILED);
        }
        audit(
          "self_service_subscribe",
          req,
          `tenant=${tenant} plan=${carriedPlan} outcome=${result.ok ? "ok" : result.reason} ` +
            `${profileAuditDetail(result.profile)} ${provisionAuditDetail(result.provisioned)}`,
        );
        const returnPath = subscriptionReturnPath(result);
        res.redirect(returnPath);
      },
      (res) => res.redirect(CHECKOUT_RETURN.CARD_ERROR),
    ),
  );

  router.post(
    "/api/self-service/billing/subscribe",
    webAuthPendingMw,
    asyncBilling(
      async (req, res) => {
        if (!requirePaymentEnabled(res, config)) return;
        const tenant = req.tenant.tenantId;
        const { plan: planSlug } = pruefeKoerper(res, { schema: ABO_KOERPER }, req.body);
        const result = await subscribeAndActivate({
          store, billing, config, accounts, provision, tenant, planSlug,
        });
        if (!result.ok) {
          audit("self_service_subscribe_rejected", req, `tenant=${tenant} reason=${result.reason}`);
          const { status, body } = subscribeReject(result.reason, planSlug);
          return res.status(status).json(body);
        }
        audit(
          "self_service_subscribe",
          req,
          `tenant=${tenant} plan=${planSlug} ${profileAuditDetail(result.profile)} ${provisionAuditDetail(result.provisioned)}`,
        );
        res.json({ plan: result.planSlug, currentPeriodEnd: result.currentPeriodEnd });
      },
      billingUnavailable,
    ),
  );

  router.post(
    "/api/self-service/billing/cancel",
    webAuthMw,
    asyncBilling(
      async (req, res) => {
        if (!requirePaymentEnabled(res, config)) return;
        const tenant = req.tenant.tenantId;
        const result = await setSubscriptionCancellation({ store, billing, tenant, cancel: true });
        if (!result.ok) {
          audit("self_service_cancel_rejected", req, `tenant=${tenant} reason=${result.reason}`);
          return res.status(HTTP_CONFLICT).json({ error: result.reason });
        }
        if (!result.alreadyApplied) {
          await auditStore.record({
            actorSub: req.tenant.sub,
            tenantId: tenant,
            action: "self_service_cancel_scheduled",
            detail: `current_period_end=${result.currentPeriodEnd ?? "unknown"}`,
          });
          try {
            store.setCancellationMailPending(tenant, {
              pending: true,
              receivedAt: new Date().toISOString(),
            });
            await attemptCancellationMailConfirm({
              store,
              mailer,
              accounts,
              config,
              auditStore,
              tenantId: tenant,
            });
          } catch (e) {
            console.error(`[cancellation-mail] Ausloesen fehlgeschlagen tenant=${tenant}: ${e.message}`);
          }
        }
        audit(
          "self_service_cancel",
          req,
          `tenant=${tenant} already_applied=${result.alreadyApplied}`,
        );
        res.json({ cancelAtPeriodEnd: true, currentPeriodEnd: result.currentPeriodEnd });
      },
      billingUnavailable,
    ),
  );

  router.post(
    "/api/self-service/billing/resume",
    webAuthMw,
    asyncBilling(
      async (req, res) => {
        if (!requirePaymentEnabled(res, config)) return;
        const tenant = req.tenant.tenantId;
        const result = await setSubscriptionCancellation({ store, billing, tenant, cancel: false });
        if (!result.ok) {
          audit("self_service_resume_rejected", req, `tenant=${tenant} reason=${result.reason}`);
          return res.status(HTTP_CONFLICT).json({ error: result.reason });
        }
        if (!result.alreadyApplied) {
          await auditStore.record({
            actorSub: req.tenant.sub,
            tenantId: tenant,
            action: "self_service_cancel_resumed",
            detail: `current_period_end=${result.currentPeriodEnd ?? "unknown"}`,
          });
        }
        audit(
          "self_service_resume",
          req,
          `tenant=${tenant} already_applied=${result.alreadyApplied}`,
        );
        res.json({ cancelAtPeriodEnd: false, currentPeriodEnd: result.currentPeriodEnd });
      },
      billingUnavailable,
    ),
  );

  return router;
}

export function mountSelfServiceRoutes(deps) {
  const guarded = Router();
  guarded.use(
    "/api/self-service",
    createSameOriginGuard({ enforce: deps.config.safety.csrfEnforce }),
  );
  guarded.use("/api/self-service/settings", rejectInvalidAgentName(deps.audit));
  guarded.use(makeSelfServiceRoutes(deps));
  return guarded;
}

function rejectInvalidAgentName(audit) {
  return function agentNameLimitMiddleware(req, res, next) {
    const rejection = promptLineRejection(
      "agentName",
      pruefeKoerper(res, { schema: AGENT_NAME_KOERPER }, req.body).agentName,
    );
    if (!rejection) return next();
    audit("self_service_settings_denied", req, `field=agentName reason=${rejection}`);
    res.status(HTTP_BAD_REQUEST).json({ error: "invalid_agent_name", reason: rejection });
  };
}

function subscribeReject(reason, planSlug) {
  if (reason === "no_card")
    return { status: HTTP_CONFLICT, body: { error: reason, next: NEXT_SETUP_CHECKOUT, plan: planSlug } };
  if (reason === "already_subscribed") return { status: HTTP_CONFLICT, body: { error: reason } };
  if (reason === "plan_unconfigured") return { status: HTTP_SERVER_ERROR, body: { error: reason } };
  return { status: HTTP_BAD_REQUEST, body: { error: reason } };
}
