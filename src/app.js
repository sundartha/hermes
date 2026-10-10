import path from "path";
import express from "express";
import {
  securityHeaders,
  createRateLimiter,
  errorHandler,
  makeFixedWindowCounter,
  RATE_WINDOW_MS,
  RATE_SWEEP_INTERVAL_MS,
} from "./middleware.js";
import { registerWellKnown } from "./auth.js";
import { makeMcpDrosseln } from "./mcp-rate-limit.js";
import { PLAN_CATALOG } from "./plans.js";
import {
  voiceControl,
  webhookEvents,
  inboundSignatureVerifier,
  providerFromHeaders,
} from "./telephony/registry.js";
import { terminateAndBillCall, hangUpAction, billThunk, elevenLabsHangUpAction } from "./telephony/call-termination.js";
import { stripeBilling } from "./billing/stripe.js";
import { makeVoiceRoutes } from "./routes/voice.js";
import { makeElevenLabsWebhookRoutes } from "./routes/webhooks-elevenlabs.js";
import {
  INIT_FEHLVERSUCHE_PRO_MIN,
  initTokenSchranke,
  istInitWebhookAnfrage,
  makeElevenLabsInitWebhookRoutes,
} from "./routes/webhooks-elevenlabs-init.js";
import { makeConsultRaised } from "./conversation/consult-raised.js";
import { makeReadRoutes } from "./routes/api-read.js";
import { makeInboxRoutes } from "./routes/api-inbox.js";
import { makeBillingRoutes } from "./routes/api-billing.js";
import { makeCallRoutes } from "./routes/api-calls.js";
import { makeCallConfirmationRoutes } from "./routes/api-call-confirmations.js";
import { makeOnboardRoutes } from "./routes/api-onboard.js";
import { makeDeployInfoRoutes } from "./routes/api-deploy-info.js";
import { ANRUFE_LAUFEND_PATH, anrufeLaufendHandler } from "./routes/intern-anrufe-laufend.js";
import { ANRUFPAUSE_PATH, anrufpauseLesenHandler, anrufpauseSetzenHandler } from "./routes/intern-anrufpause.js";
import { makeMcpRoutes } from "./routes/mcp.js";
import { wireWebLogin } from "./wiring/web-login.js";
import { guardedBoot } from "./boot-guard.js";
import { createPortalRunner as defaultCreatePortalRunner } from "./portal-pool.js";
import {
  isTrustedLocalCaller,
  internalIdentity,
  OWNER_ID,
  tenantOwnsCall,
} from "./request-tenant.js";
import { APP_PATH, LEGACY_PORTAL_PATH, LOGIN_ALIAS_PATHS, APP_ALIAS_PATHS } from "./portal-paths.js";

const BODY_LIMIT = "100kb";
const LOGIN_PATH = "/auth/login";
const STRIPE_WEBHOOK_PATH = "/webhooks/stripe";
const VOICE_PATH_PREFIX = "/voice";
const isMcpPost = (req) => req.method === "POST" && req.path === "/mcp";
const OPENAI_CHALLENGE_PATH = "/.well-known/openai-apps-challenge";
export const SECURITY_TXT_PATH = "/.well-known/security.txt";
export const SECURITY_CONTACT = "mailto:kontakt@sundartha.com";
export const SECURITY_TXT_EXPIRES = "2027-09-01T00:00:00.000Z";
export const SECURITY_TXT_BODY =
  `Contact: ${SECURITY_CONTACT}\n` + `Expires: ${SECURITY_TXT_EXPIRES}\n` + `Preferred-Languages: de, en\n`;
const HTTP_FOUND = 302;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const captureRawBody = (req, _res, buf) => {
  if (req.path.startsWith(VOICE_PATH_PREFIX) || req.path === STRIPE_WEBHOOK_PATH)
    Object.assign(req, { rawBody: buf });
};

function respondToParserError(err, res, next) {
  if (!err) return next();
  if (!err.status || err.status < HTTP_BAD_REQUEST || err.status >= HTTP_SERVER_ERROR)
    return next(err);
  res.status(err.status).json({ error: err.type || "bad request" });
}

const withParserErrors = (parser) => (req, res, next) =>
  parser(req, res, (err) => respondToParserError(err, res, next));

function makeInitTokenSchranke(config) {
  const zaehler = makeFixedWindowCounter({
    windowMs: RATE_WINDOW_MS,
    limit: INIT_FEHLVERSUCHE_PRO_MIN,
    sweepMs: RATE_SWEEP_INTERVAL_MS,
  });
  return initTokenSchranke({ config, zaehler });
}

export function installGlobalMiddleware({ app, config }) {
  app.use(securityHeaders);

  const rateLimiter = createRateLimiter(config.safety.rateLimitPerMin);
  const initSchranke = makeInitTokenSchranke(config);
  app.use((req, res, next) => {
    if (istInitWebhookAnfrage(req)) return initSchranke(req, res, next);
    if (isMcpPost(req)) return next();
    if (req.path.startsWith(VOICE_PATH_PREFIX) || isTrustedLocalCaller(req)) return next();
    rateLimiter(req, res, next);
  });

  const urlencodedParser = withParserErrors(
    express.urlencoded({ extended: false, limit: BODY_LIMIT, verify: captureRawBody }),
  );
  const jsonParser = withParserErrors(
    express.json({ limit: BODY_LIMIT, verify: captureRawBody }),
  );
  app.use((req, res, next) => (isMcpPost(req) ? next() : urlencodedParser(req, res, next)));
  app.use((req, res, next) => (isMcpPost(req) ? next() : jsonParser(req, res, next)));

  const mcpDrosseln = makeMcpDrosseln({ limitPerMin: config.safety.rateLimitPerMin });

  return { mcpDrosseln, mcpBodyParsers: [urlencodedParser, jsonParser] };
}

export function registerPublicRoutes({ app, config }) {
  app.get("/healthz", (_req, res) => res.json({ ok: true, commit: config.server.deployedCommit }));

  app.get(SECURITY_TXT_PATH, (_req, res) => res.type("text/plain").send(SECURITY_TXT_BODY));

  app.get("/api/plans", (_req, res) => res.json(PLAN_CATALOG));

  app.get(OPENAI_CHALLENGE_PATH, (_req, res) => {
    const token = config.server.openaiAppsChallengeToken;
    if (!token) return res.status(HTTP_NOT_FOUND).end();
    res.type("text/plain").send(token);
  });

  registerWellKnown(app);

  if (!config.server.webDistDir) {
    app.get("/", (_req, res) => res.redirect(HTTP_FOUND, LOGIN_PATH));
  }
}

export function registerPathRedirects({ app }) {
  const umleitungAuf = (ziel) => (_req, res) => res.redirect(HTTP_FOUND, ziel);
  for (const pfad of LOGIN_ALIAS_PATHS) app.get(pfad, umleitungAuf(LOGIN_PATH));
  for (const pfad of APP_ALIAS_PATHS) app.get(pfad, umleitungAuf(APP_PATH));
}

const ASTRO_ASSET_DIR = "_astro";
const HTML_SUFFIX = ".html";
const IMMUTABLE_MAX_AGE_SECONDS = 31_536_000;
const IMMUTABLE_CACHE_CONTROL = `public, max-age=${IMMUTABLE_MAX_AGE_SECONDS}, immutable`;
const HTML_CACHE_CONTROL = "no-cache";

function cacheControlForStaticFile(filePath, astroDirPrefix) {
  if (filePath.endsWith(HTML_SUFFIX)) return HTML_CACHE_CONTROL;
  if (filePath.startsWith(astroDirPrefix)) return IMMUTABLE_CACHE_CONTROL;
  return null;
}

export function registerStaticServing({ app, config }) {
  if (config.server.webDistDir) {
    app.get(LEGACY_PORTAL_PATH, (req, res) => {
      const queryAt = req.originalUrl.indexOf("?");
      const search = queryAt === -1 ? "" : req.originalUrl.slice(queryAt);
      res.redirect(HTTP_FOUND, APP_PATH + search);
    });
    const astroDirPrefix = path.join(config.server.webDistDir, ASTRO_ASSET_DIR) + path.sep;
    app.use(
      express.static(config.server.webDistDir, {
        extensions: ["html"],
        setHeaders: (res, filePath) => {
          const cacheControl = cacheControlForStaticFile(filePath, astroDirPrefix);
          if (cacheControl) res.set("Cache-Control", cacheControl);
        },
      }),
    );
    app.get("/app/*", (_req, res) => res.sendFile(path.join(config.server.webDistDir, "app", "index.html")));
  }
}

export function registerApiRoutes({ app, deps, operatorAuth }) {
  const {
    config,
    store,
    audit,
    callFinish,
    lifecycle,
    provisioning,
    outboundGates,
    callQuotaDenial,
    requestTenant,
    requireTenant,
    costTruing,
    consultDelivery,
    elevenLabsOutbound,
    mcpDrosseln,
    mcpBodyParsers,
  } = deps;

  app.use(makeCallConfirmationRoutes({ store, config, tenant: { requestTenant } }));

  app.use(
    makeCallRoutes({
      store,
      config,
      audit,
      outboundGates,
      callQuotaDenial,
      voiceControl,
      originateElevenLabsCall: elevenLabsOutbound?.originateCall,
      terminateAndBillCall,
      hangUpAction,
      elevenLabsHangUpAction,
      endActiveCall: elevenLabsOutbound?.endActiveCall,
      awaitAndPersistInboundElResult: elevenLabsOutbound?.awaitAndPersistInboundElResult,
      billThunk,
      finishCall: callFinish.finishCall,
      arm: {
        armMaxDurationTimer: lifecycle.armMaxDurationTimer,
        armReserveReleaseTimer: lifecycle.armReserveReleaseTimer,
      },
      tenant: { requestTenant, requireTenant, tenantOwnsCall },
      consultDelivery,
      internalIdentity,
      OWNER_ID,
    }),
  );

  app.use(
    makeReadRoutes({
      store,
      config,
      audit,
      tenant: { requestTenant, requireTenant, tenantOwnsCall },
    }),
  );

  app.use(
    makeInboxRoutes({
      store,
      audit,
      tenant: { requireTenant },
    }),
  );

  app.use(
    makeBillingRoutes({
      config,
      store,
      audit,
      billing: stripeBilling,
      tenant: { requireTenant },
      costTruing,
      operatorAuth,
    }),
  );

  app.use(makeOnboardRoutes({ store, config, audit, provisioning, operatorAuth }));

  app.use(makeDeployInfoRoutes({ config, operatorAuth }));

  app.use(
    makeMcpRoutes({ config, store, requestTenant, mcpDrosseln, bodyParsers: mcpBodyParsers }),
  );
}

export async function buildApp(deps) {
  const {
    config,
    store,
    audit,
    callFinish,
    lifecycle,
    provisioning,
    ttsStore,
    directiveSynth,
    voiceRender,
    messaging,
    elevenLabsOutbound,
    inboundBridges,
    consultDelivery,
    accountsRef,
    auditStoreRef,
    durableAuditFor,
    createPortalRunner = defaultCreatePortalRunner,
  } = deps;

  const app = express();
  app.set("trust proxy", 1);

  const { mcpDrosseln, mcpBodyParsers } = installGlobalMiddleware({ app, config });
  registerPublicRoutes({ app, config });
  registerPathRedirects({ app });
  app.get(ANRUFE_LAUFEND_PATH, anrufeLaufendHandler({ config, store }));
  app.get(ANRUFPAUSE_PATH, anrufpauseLesenHandler({ config, store }));
  app.post(ANRUFPAUSE_PATH, anrufpauseSetzenHandler({ config, store }));

  let operatorAuth = null;
  if (config.auth.sessionSecret && config.store.storeBackend === "pg") {
    await guardedBoot("Web-Login/Portal", async () => {
      operatorAuth = await wireWebLogin({
        app,
        config,
        store,
        audit,
        provision: provisioning.triggerTenantProvisioning,
        createPortalRunner,
        stripeWebhookPath: STRIPE_WEBHOOK_PATH,
        appPath: APP_PATH,
        messaging,
        accountsRef,
        auditStoreRef,
      });
    });
  }

  registerStaticServing({ app, config });
  app.use(express.static(config.server.publicDir));

  app.use(
    makeVoiceRoutes({
      store,
      config,
      audit,
      voiceRender,
      directiveSynth,
      ttsStore,
      lifecycle,
      finishCall: callFinish.finishCall,
      webhookEvents,
      providerFromHeaders,
      inboundSignatureVerifier,
      terminateAndBillCall,
      billThunk,
      startInboundNachlauf: elevenLabsOutbound?.startInboundNachlauf,
      inboundBridges,
    }),
  );

  app.use(
    makeElevenLabsWebhookRoutes({
      store,
      config,
      consultSlots: consultDelivery,
      onConsultRaised: makeConsultRaised({ store, isDraining: consultDelivery.isDraining }),
      auditFor: durableAuditFor,
    }),
  );

  app.use(makeElevenLabsInitWebhookRoutes({ store, config, bridges: inboundBridges }));

  registerApiRoutes({ app, deps: { ...deps, mcpDrosseln, mcpBodyParsers }, operatorAuth });

  app.use(errorHandler);

  return { app };
}
