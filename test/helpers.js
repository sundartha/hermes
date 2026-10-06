import assert from "node:assert/strict";
import { spawn } from "child_process";
import crypto from "node:crypto";
import dns from "node:dns";
import fs from "fs";
import http from "node:http";
import net from "node:net";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { starteAnthropicAttrappe } from "./helpers/anthropic-attrappe.js";
import { testkostenZaehler } from "./testkosten.js";
import { BOOTSTRAP_TENANT_ID, DEFAULT_GREETING } from "../src/store/defaults.js";
import { makeDefaultState } from "../src/store/state-ops.js";
import * as stateOps from "../src/store/state-ops.js";
import { PAYMENT_METHOD_TYPE_CARD } from "../src/billing/payment-method-eligibility.js";
import {
  SIP_PASSWORD_MIN_LENGTH,
  INIT_WEBHOOK_TOKEN_MIN_LENGTH,
} from "../src/elevenlabs/inbound-path-decision.js";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STARTUP_TIMEOUT_MS = 15000;

export const OWNER_TEST_NUMBER = Object.freeze({ e164: "+15005550006", provider: "telnyx" });

export const DOMESTIC_TEST_NUMBER = Object.freeze({ e164: "+4930111222333", provider: "telnyx" });

export const OWNER_TEST_FIRST_NAME = "Jonas";
export const OWNER_TEST_LAST_NAME = "Beispiel";
const OWNER_TEST_NAME = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;

export const TOOL_COUNT_WITH_CONSULT = 12;
export const TOOL_COUNT_WITHOUT_CONSULT = 10;
export const TOOLS_WITH_OUTPUT_SCHEMA = 10;

dns.setDefaultResultOrder("ipv6first");
net.setDefaultAutoSelectFamily(false);

export const anthropicAttrappe = await starteAnthropicAttrappe();
const serverStarts = testkostenZaehler("serverStarts");

export const BASE_ENV = {
  NODE_ENV: "test",
  ANTHROPIC_BASE_URL: anthropicAttrappe.url,
  PORT: "0",
  DATA_DIR: "",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  LLM_PROVIDER: "anthropic",
  DEEPSEEK_API_KEY: "",
  CLAUDE_MODEL: "claude-haiku-4-5",
  MAX_BUDGET_EUR: "30",
  LLM_REQUEST_TIMEOUT_MS: "3500",
  LLM_MAX_RETRIES: "2",
  LLM_BACKOFF_MS: "1",
  LLM_BREAKER_THRESHOLD: "5",
  LLM_BREAKER_WINDOW_MS: "10000",
  LLM_BREAKER_COOLDOWN_MS: "30000",
  METRICS_ENABLED: "false",
  RENDER_GIT_COMMIT: "",
  MACHINE_DETECTION_ENABLED: "false",
  MACHINE_DETECTION_TIMEOUT_S: "5",
  SEND_SMS_SUMMARY: "false",
  PUBLIC_URL: "https://agent.test",
  DASHBOARD_PASSWORD: "",
  MCP_AUTH_TOKEN: "",
  LOGIN_COOKIE_TTL_SECONDS: "1800",
  ALLOWED_NUMBERS: "",
  OUTBOUND_FROZEN: "false",
  CSRF_ENFORCE: "true",
  MCP_ORIGIN_ENFORCE: "true",
  MCP_ALLOWED_ORIGINS: "",
  OUTBOUND_ANI_GATE_ENABLED: "false",
  PRICE_DRIFT_MIN_INTERVAL_MS: "0",
  PRICE_DRIFT_UNKNOWN_ESCALATE_AFTER: "3",
  ALLOWED_COUNTRY_CODES: "*",
  MAX_CALLS_PER_HOUR: "100",
  PROFILES_JSON: "",
  OWNER_NUMBER_SEED: "",
  OWNER_NUMBER_PROVIDER: "",
  BOOTSTRAP_E164: "",
  BOOTSTRAP_PROVIDER: "",
  PLATFORM_ANI_E164: "",
  OWNER_IDP_SUBJECT: "",
  CAP_FAREWELL_LEAD_MS: "20000",
  RESERVE_RELEASE_GRACE_MS: "15000",
  BUDGET_WATCHDOG_INTERVAL_MS: "600000",
  FAKE_ORIGINATE: "false",
  SHUTDOWN_DRAIN_TIMEOUT_MS: "8000",
  STT_SPEECH_TIMEOUT_SEC: "2",
  STT_PROFILE: "accurate",
  MAX_EMPTY_TURNS: "3",
  CALLER_SUBSTANCE_MIN_LEN: "2",
  SKIP_TWILIO_SIGNATURE_CHECK: "true",
  RATE_LIMIT_PER_MIN: "1000",
  RETENTION_DAYS: "0",
  DIAGNOSTIC_RETENTION_DAYS: "0",
  EVIDENCE_RETENTION_DAYS: "0",
  OWNER_SELF_CALL_ENABLED: "false",
  OWNER_SELF_CALL_TENANT_IDS: "",
  INBOUND_OWNER_GREETING_ENABLED: "false",
  INBOUND_OWNER_GREETING_TENANT_IDS: "",
  TELNYX_API_KEY: "",
  TELNYX_PUBLIC_KEY: "",
  TELNYX_API_BASE: "",
  TELNYX_CONNECTION_ID: "",
  TELNYX_SIP_TRUNK_USERNAME: "",
  TELNYX_SIP_TRUNK_PASSWORD: "",
  TELNYX_ACCOUNT_SID: "",
  TELNYX_ELEVENLABS_VOICE_ID: "",
  ELEVENLABS_PLAY_TTS_ENABLED: "false",
  ELEVENLABS_API_KEY: "",
  ELEVENLABS_VOICE_ID: "",
  ELEVENLABS_MODEL: "",
  ELEVENLABS_API_BASE: "http://127.0.0.1:9",
  ELEVENLABS_OUTPUT_FORMAT: "",
  ELEVENLABS_SYNTH_TIMEOUT_MS: "2000",
  ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS: "10000",
  ELEVENLABS_TTS_TOKEN_TTL_MS: "60000",
  ELEVENLABS_OUTBOUND_ENABLED: "false",
  ELEVENLABS_TENANT_TOKEN_REQUIRED: "false",
  ELEVENLABS_AGENT_ID: "",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "",
  ELEVENLABS_NUMBER_REGISTRATION_ENABLED: "false",
  FAKE_ORIGINATE_ELEVENLABS: "false",
  ELEVENLABS_RESULT_POLL_MS: "60000",
  ELEVENLABS_INBOUND_ENABLED: "false",
  ELEVENLABS_INBOUND_TENANT_IDS: "",
  ELEVENLABS_INBOUND_SCOPE: "",
  ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED: "",
  ELEVENLABS_INBOUND_SIP_USER: "",
  ELEVENLABS_INBOUND_SIP_PASSWORD: "",
  ELEVENLABS_INIT_WEBHOOK_TOKEN: "",
  RENDER_API_KEY: "",
  OPENAI_APPS_CHALLENGE_TOKEN: "",
  STORE_BACKEND: "json",
  DATABASE_URL: "",
  QUEUE_BACKEND: "memory",
  MAX_NUMBERS: "5",
  MAX_NUMBERS_PER_TENANT: "1",
  PROVISIONING_ENABLED: "false",
  PROVISIONING_COUNTRY: "DE",
  PROVISIONING_REDRIVE_MAX_AGE_MS: "0",
  PROVISIONING_RETRY_MAX_ATTEMPTS: "0",
  PROVISIONING_RETRY_MIN_INTERVAL_MS: "0",
  RELEASE_GRACE_DAYS: "0",
  FORCE_NUMBER_COUNTRY: "",
  GEO_ENABLED: "false",
  GEO_DB_PATH: "",
  WORLD_DEFAULT_LANGUAGE_ENABLED: "true",
  MULTI_TENANT: "false",
  SELF_SERVICE_ENABLED: "false",
  WEB_DIST_DIR: "",
  DEV_LOGIN_ENABLED: "false",
  MCP_UI_ENABLED: "false",
  ASSISTANT_CONTEXT_ENABLED: "false",
  PRECALL_BRIEFING_ENABLED: "false",
  PRECALL_BRIEFING_MODEL: "claude-sonnet-5",
  PRECALL_BRIEFING_TIMEOUT_MS: "6000",
  CALL_SUMMARY_TIMEOUT_MS: "20000",
  RESEARCH_ENABLED: "false",
  RESEARCH_SEARCH_FEE_CENTS: "1",
  LOOKUP_ENABLED: "false",
  LOOKUP_SEARCH_FEE_CENTS: "1",
  EXA_API_KEY: "",
  ELEVENLABS_OPENING_LINE_LLM_ENABLED: "true",
  EXA_API_BASE: "",
  CONSULT_ENABLED: "false",
  IN_CALL_CONSULT_ENABLED: "false",
  CONSULT_WAIT_MS: "4000",
  CONSULT_OPEN_MS: "47000",
  EL_CONSULT_DELIVERY_MS: "5000",
  EL_CONSULT_ACK_MS: "5000",
  EL_CONSULT_ANSWER_MS: "30000",
  THINKING_SIGNAL_ENABLED: "false",
  TOOL_FOLLOW_UP_ENABLED: "false",
  PAYMENT_ENABLED: "false",
  STRIPE_SECRET_KEY: "",
  STRIPE_API_BASE: "",
  NUMBER_SETUP_FEE_CENTS: "0",
  BILLING_FLUSH_EPOCH: "",
  PAYMENT_CURRENCY: "eur",
  PROVIDER_CURRENCY: "USD",
  PROVIDER_TO_BUCKET_RATE_MICRO: "920000",
  COST_TRUING_DELAY_MINUTES: "30",
  COST_TRUING_SWEEP_INTERVAL_MS: "3600000",
  COST_TRUING_MAX_ATTEMPTS: "5",
  COST_TRUING_REQUIRED_RECORD_TYPES: "sip-trunking,call-control",
  COST_TRUING_MIN_COVERAGE_PERCENT: "80",
  COST_TRUING_COVERAGE_STALL_SWEEPS: "8",
  KOSTEN_HEARTBEAT_FENSTER_H: "6",
  COST_SETTLE_DEADLINE_HOURS: "48",
  EL_EVIDENCE_MIN_AGE_MINUTES: "15",
  COST_DRIFT_WARN_PERCENT: "50",
  COST_ALERT_DEBOUNCE_MS: "86400000",
  COST_CALIBRATION_MIN_SAMPLES: "20",
  STRIPE_STARTER_PRICE_ID: "",
  STRIPE_BUSINESS_PRICE_ID: "",
  STRIPE_WEBHOOK_SECRET: "",
  VOICE_TARIFF_DOMESTIC_CENTS: "0",
  VOICE_TARIFF_DEFAULT_CENTS: "0",
  VOICE_TARIFF_INBOUND_CENTS: "0",
  VOICE_TARIFF_FULL_COST_FLOOR_CENTS: "0",
  VOICE_TARIFF_GRUNDBETRAG_CENTS: "",
  DEFAULT_TENANT_BUDGET_CENTS: "0",
  PLATFORM_SPEND_WARN_PERCENT: "0",
  PLATFORM_ALERT_SMS_TO: "",
  PLATFORM_ALERT_MAIL_TO: "",
  OUTAGE_ALERT_WINDOW_MS: "0",
  OUTAGE_ALERT_MIN_FAILURES: "3",
  OUTAGE_ALERT_MIN_ATTEMPTS: "20",
  OUTAGE_ALERT_FAIL_SHARE_PERCENT: "20",
  OUTAGE_ALERT_DEBOUNCE_MS: "21600000",
  OUTAGE_ALERT_RETRY_MS: "900000",
  OUTAGE_ALERT_SELF_TEST_INTERVAL_MS: "0",
  INBOUND_OUTAGE_ALERT_WINDOW_MS: "0",
  INBOUND_OUTAGE_ALERT_MIN_FAILURES: "2",
  INBOUND_OUTAGE_ALERT_MIN_ATTEMPTS: "20",
  INBOUND_OUTAGE_ALERT_FAIL_SHARE_PERCENT: "10",
  PLATFORM_HOLD_ESCALATION_MAX_AGE_MS: "0",
  PAID_WITHOUT_NUMBER_GRACE_MS: "0",
  BUDGET_MONTH_ENABLED: "false",
  TTS_CHARACTER_QUOTA: "39981",
  TTS_CHARACTER_QUOTA_WARN_PERCENT: "0",
  TTS_QUOTA_CYCLE_ANCHOR_DAY: "3",
  PLATFORM_FIXED_COST_CENTS_PER_MONTH: "600",
  NUMBER_MONTHLY_COST_CENTS: "92",
  PER_TARGET_CALL_CAP: "1000",
  PER_TARGET_WINDOW_MS: "86400000",
  MCP_AUTH: "",
  OAUTH_ISSUER_URL: "",
  OAUTH_AUDIENCE: "",
  RENDER_EXTERNAL_URL: "",
  CALL_CONFIRMATION_SECRET: "",
};

export function quelltexteUnter(verzeichnis) {
  return fs.readdirSync(path.join(ROOT, verzeichnis), { withFileTypes: true }).flatMap((eintrag) => {
    const relativ = path.join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) return quelltexteUnter(relativ);
    return eintrag.name.endsWith(".js") ? [[relativ, fs.readFileSync(path.join(ROOT, relativ), "utf8")]] : [];
  });
}

export function externalIp() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

export function tempDataDir(seedState, rawStore) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-test-"));
  if (typeof rawStore === "string") fs.writeFileSync(path.join(dir, "store.json"), rawStore);
  else if (seedState)
    fs.writeFileSync(path.join(dir, "store.json"), JSON.stringify(seedState, null, 2));
  return dir;
}

export function seedState({
  calls = [],
  actionItems = [],
  notifications = [],
  settings = {},
  profiles = {},
  tenants,
  numbers,
} = {}) {
  return {
    settings: {
      agentName: "Hermes",
      greeting: DEFAULT_GREETING,
      allowCalendar: true,
      allowBooking: true,
      allowSummaries: true,
      allowPersonalData: false,
      allowBankData: false,
      allowResearch: false,
      allowCallMemory: false,
      ...settings,
    },
    calls,
    actionItems,
    calendar: [],
    usage: { inputTokens: 0, outputTokens: 0, costEur: 0, calls: calls.length },
    notifications,
    profiles,
    ...(tenants ? { tenants } : {}),
    ...(numbers ? { numbers } : {}),
  };
}

function ensureOwnerNumber(seed, ownerNumber = OWNER_TEST_NUMBER) {
  if (ownerNumber === null) return seed;
  const state = seed || makeDefaultState();
  const numbers = Array.isArray(state.numbers) ? [...state.numbers] : [];
  const hasOwnerActive = numbers.some(
    (n) => n.tenantId === BOOTSTRAP_TENANT_ID && n.status === "active",
  );
  if (!hasOwnerActive) {
    numbers.push({
      id: "num_owner_seed",
      e164: ownerNumber.e164,
      tenantId: BOOTSTRAP_TENANT_ID,
      provider: ownerNumber.provider,
      status: "active",
      providerNumberId: null,
    });
  }
  return { ...state, tenants: ensureOwnerIdentity(state.tenants), numbers };
}

function ensureOwnerIdentity(tenants) {
  const list = Array.isArray(tenants) ? [...tenants] : [];
  const owner = list.find((t) => t.id === BOOTSTRAP_TENANT_ID);
  const identity = {
    status: "active",
    firstName: OWNER_TEST_FIRST_NAME,
    ownerName: OWNER_TEST_NAME,
  };
  if (!owner) {
    list.push({ id: BOOTSTRAP_TENANT_ID, ...identity });
  } else if (!owner.ownerName) {
    Object.assign(owner, identity, { status: owner.status });
  }
  return list;
}

export function seedCall(overrides = {}) {
  return {
    id: "call_test1",
    tenantId: BOOTSTRAP_TENANT_ID,
    twilioSid: null,
    direction: "outbound",
    from: "+15005550006",
    to: "+4915112345678",
    goal: "Testziel",
    briefing: null,
    constraints: null,
    callerName: null,
    language: "de",
    maxDurationS: 60,
    status: "active",
    startedAt: new Date().toISOString(),
    answeredAt: null,
    endedAt: null,
    transcript: [],
    summary: null,
    objectiveAchieved: null,
    actionItemIds: [],
    ...overrides,
  };
}

function outboundEndedCall(id, costTruedSource) {
  return seedCall({
    id,
    direction: "outbound",
    answeredAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    estimatedCostCents: 20,
    costTruedSource,
  });
}

export function outboundCallsSeed(count, proven, prefix) {
  const calls = [];
  for (let i = 0; i < count; i++) {
    calls.push(outboundEndedCall(`${prefix}${i}`, i < proven ? "telnyx_detail_records" : "unavailable"));
  }
  return seedState({ calls });
}

export async function waitForLog(srv, regex, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!regex.test(srv.stdout)) {
    if (Date.now() > deadline)
      throw new Error(`Log-Pattern ${regex} nicht gefunden in:\n${srv.stdout}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

export function assertGateAbsent(res) {
  assert.notEqual(res.status, 401, "kein Gate mehr - 401 waere eine Wiederauferstehung");
  assert.equal(
    res.headers.get("www-authenticate"),
    null,
    "kein www-authenticate -> kein Gate mehr davor",
  );
}

export async function waitForStoreState(srv, predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate(srv.readStore())) {
    if (Date.now() > deadline)
      throw new Error(`Store-Zustand nicht erreicht:\n${JSON.stringify(srv.readStore().calls)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
  return srv.readStore();
}

const WAIT_UNTIL_DEFAULT_TIMEOUT_MS = 500;
const WAIT_UNTIL_DEFAULT_POLL_INTERVAL_MS = 5;

export async function waitUntil(
  predicate,
  { timeoutMs = WAIT_UNTIL_DEFAULT_TIMEOUT_MS, pollIntervalMs = WAIT_UNTIL_DEFAULT_POLL_INTERVAL_MS } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Bedingung nicht innerhalb der Testfrist erreicht");
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export async function withFetch(fetchImpl, run) {
  const orig = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = orig;
  }
}

export function storeOpsFacade(state) {
  return {
    load: () => state,
    getCall: (id) => stateOps.getCall(state, id),
    addTranscript: (id, rolle, text) => stateOps.addTranscript(state, id, rolle, text),
    recordProviderCallResult: (id, ergebnis) => stateOps.recordProviderCallResult(state, id, ergebnis),
    recordProviderCollectedFields: (id, felder) => stateOps.recordProviderCollectedFields(state, id, felder),
    recordCalleeConfirmedTimezone: (id, zone) => stateOps.recordCalleeConfirmedTimezone(state, id, zone),
    recordSipCallId: () => {},
    recordElDetectorCounts: () => {},
    recordFromRegistrationSource: (id, quelle) =>
      stateOps.recordFromRegistrationSource(state, id, quelle),
    recordActualSender: (id, herkunft) => stateOps.recordActualSender(state, id, herkunft),
    trueUpAnsweredAt: (id, iso) => stateOps.trueUpAnsweredAt(state, id, iso),
    recordAnsweredUnclearReason: (id, grund) => stateOps.recordAnsweredUnclearReason(state, id, grund),
    recordFailureReason: (id, grund) => stateOps.recordFailureReason(state, id, grund),
    setCallEndedAt: (id, status, iso) => stateOps.setCallEndedAt(state, id, status, iso),
    endCallRecord: (id, status) => stateOps.endCallRecord(state, id, status).call,
    addActionItem: (id, text, typ) => stateOps.addActionItem(state, id, text, typ),
    callActionItems: (id) => stateOps.callActionItems(state, id),
    save: () => {},
  };
}

export async function startTelnyxProvisioningMock() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push({ method: req.method, path: req.url, body });
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v2/available_phone_numbers"))
        return res.end(JSON.stringify({ data: [{ phone_number: "+4915799990001" }] }));
      if (req.url === "/v2/number_orders")
        return res.end(
          JSON.stringify({
            data: { phone_numbers: [{ id: "ord_sub_1", phone_number: "+4915799990001" }] },
          }),
        );
      if (req.url.startsWith("/v2/phone_numbers?"))
        return res.end(
          JSON.stringify({ data: [{ id: "num_ext_1", phone_number: "+4915799990001" }] }),
        );
      res.end(JSON.stringify({ data: {} }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

export async function captureConsole(fn) {
  const lines = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...a) => lines.push(a.map(String).join(" "));
  console.warn = (...a) => lines.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
  return lines;
}

export function fakeBilling(overrides = {}) {
  const log = [];
  const base = {
    async placeHold(args) {
      log.push(["placeHold", args]);
      return { paymentIntentId: "pi_fake_1" };
    },
    async captureHold(id, amt) {
      log.push(["captureHold", id, amt]);
    },
    async cancelHold(id) {
      log.push(["cancelHold", id]);
    },
    async reportMeter(args) {
      log.push(["reportMeter", args]);
    },
    async retrievePaymentMethodType(id) {
      log.push(["retrievePaymentMethodType", id]);
      return PAYMENT_METHOD_TYPE_CARD;
    },
  };
  return { log, ...base, ...overrides };
}

export function fakeProvisioner(overrides = {}) {
  const log = [];
  const orderCalls = [];
  const base = {
    async searchNumbers({ countryCode } = {}) {
      log.push(`search:${countryCode}`);
      return [{ e164: "+4915799990001" }];
    },
    async orderNumber({ e164, connectionId, idempotencyKey }) {
      log.push(`order:${e164}:${idempotencyKey}`);
      orderCalls.push({ e164, connectionId, idempotencyKey });
      return { e164, providerNumberId: "num_ext_1" };
    },
    async releaseNumber(id) {
      log.push(`release:${id}`);
    },
  };
  return { log, orderCalls, ...base, ...overrides };
}

export function fakeSipRegistrar(overrides = {}) {
  const removeCalls = [];
  return {
    removeCalls,
    async removeRegistration(phoneNumberId) {
      removeCalls.push(phoneNumberId);
      if (overrides.removeRegistration) return overrides.removeRegistration(phoneNumberId);
      return { accepted: true, status: 200 };
    },
  };
}

export function noopWatchdog() {
  return {
    arm() {},
    observeTurn: () => ({ loopExceeded: false, turnSeq: 0 }),
    noteAgentSpeech() {},
    clear() {},
    scheduleFarewellHangup: () => ({ delayMs: 0 }),
  };
}

export function makeConfigOverrides(configObj) {
  const namespaceOfKey = {};
  for (const namespace of Object.keys(configObj)) {
    for (const key of Object.keys(configObj[namespace])) namespaceOfKey[key] = namespace;
  }
  const readValue = (key) => configObj[namespaceOfKey[key]][key];
  const writeValue = (key, value) => {
    configObj[namespaceOfKey[key]][key] = value;
  };
  async function withConfig(key, value, fn) {
    const saved = readValue(key);
    writeValue(key, value);
    try {
      return await fn();
    } finally {
      writeValue(key, saved);
    }
  }
  function withBlankedConfig(key, fn) {
    return withConfig(key, "", fn);
  }
  function withConfigOverrides(overrides, fn) {
    const saved = {};
    for (const k of Object.keys(overrides)) saved[k] = readValue(k);
    for (const k of Object.keys(overrides)) writeValue(k, overrides[k]);
    try {
      return fn();
    } finally {
      for (const k of Object.keys(saved)) writeValue(k, saved[k]);
    }
  }
  return { withConfig, withBlankedConfig, withConfigOverrides };
}

const STRIPE_TEST_API_BASE = "https://api.stripe.test";
export function makeStripeStub(configObj, secret) {
  const { withConfig } = makeConfigOverrides(configObj);
  return function withStripeStub(impl, fn) {
    const originalFetch = global.fetch;
    global.fetch = impl;
    return withConfig("stripeSecretKey", secret, () =>
      withConfig("stripeApiBase", STRIPE_TEST_API_BASE, fn),
    ).finally(() => {
      global.fetch = originalFetch;
    });
  };
}

export const CONFIG_REQUIRED_OK = Object.freeze({
  anthropicApiKey: "x",
  publicUrl: "https://example.test",
  mcpAuth: "",
  storeBackend: "json",
  paymentEnabled: false,
});

export const TELNYX_TEST_OWNER_NUMBER = Object.freeze({
  e164: "+4915005551234",
  provider: "telnyx",
});
export const TELNYX_TEST_PEER_NUMBER = "+4915112345678";
export const TELNYX_TEST_TENANT_NUMBER = "+4915255555555";
export const TELNYX_TEST_SIGNATURE_HEADERS = Object.freeze({
  "telnyx-signature-ed25519": "sig",
  "telnyx-timestamp": "1",
});

const ED25519_RAW_KEY_LEN = 32;
const MS_PER_S = 1000;

export const nowSeconds = () => Math.floor(Date.now() / MS_PER_S);

export function makeTelnyxSigner() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyBase64: publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-ED25519_RAW_KEY_LEN)
      .toString("base64"),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    sign(ts, rawBody) {
      const signed = Buffer.concat([Buffer.from(`${ts}|`), Buffer.from(rawBody)]);
      return crypto.sign(null, signed, privateKey).toString("base64");
    },
  };
}

export const PLAN_PRICE_BOOT_ENV = Object.freeze({
  STRIPE_STARTER_PRICE_ID: "price_test_starter",
  STRIPE_BUSINESS_PRICE_ID: "price_test_business",
});

export const EL_INBOUND_ACCESS_BOOT_ENV = Object.freeze({
  ELEVENLABS_INBOUND_SIP_USER: "iel-test-sip-user",
  ELEVENLABS_INBOUND_SIP_PASSWORD: "p".repeat(SIP_PASSWORD_MIN_LENGTH),
  ELEVENLABS_INIT_WEBHOOK_TOKEN: "t".repeat(INIT_WEBHOOK_TOKEN_MIN_LENGTH),
});

export function placeCall(srv, to = TELNYX_TEST_PEER_NUMBER) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });
}

export function postTelnyxIncoming(
  srv,
  { callSid = "CAtest", from = TELNYX_TEST_PEER_NUMBER, to = TELNYX_TEST_TENANT_NUMBER } = {},
) {
  const body = { From: from, To: to };
  if (callSid) body.CallSid = callSid;
  return fetch(`${srv.localUrl}/voice/incoming`, {
    method: "POST",
    headers: TELNYX_TEST_SIGNATURE_HEADERS,
    body: new URLSearchParams(body),
  });
}

export function normalizeIncomingTexml(texml) {
  return texml
    .replaceAll(/callId=call_[a-zA-Z0-9]+/g, "callId=call_X")
    .replaceAll(/turnToken=[a-f0-9]+/g, "turnToken=X");
}

export function seedWithTelnyxNumber({ language } = {}) {
  return seedState({
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas" }],
    numbers: [
      {
        id: "num_telnyx",
        e164: TELNYX_TEST_TENANT_NUMBER,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
        language,
      },
    ],
  });
}

export const MCP_AUDIENCE = "https://agent.test/mcp";
const KID = "test-key-1";

export async function startIdp({ metadataPath = "/.well-known/openid-configuration" } = {}) {
  const { OAUTH_SCOPES } = await import("../src/auth.js");
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };

  const server = http.createServer((req, res) => {
    if (req.url === metadataPath) {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
    }
    if (req.url === "/jwks") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ keys: [jwk] }));
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const issuer = `http://127.0.0.1:${server.address().port}`;

  const wrong = await generateKeyPair("RS256");

  const buildJwt = (claims, { iss, aud, exp }) => {
    if (exp === null) {
      const jwt = new SignJWT({ ...claims })
        .setProtectedHeader({ alg: "RS256", kid: KID })
        .setIssuer(iss)
        .setAudience(aud);
      return jwt.setIssuedAt();
    }
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(exp);
  };

  const DEFAULT_TEST_SCOPE = OAUTH_SCOPES.join(" ");
  const mitScopeDefault = (claims) => {
    if ("scope" in claims || "scp" in claims) return claims;
    return { scope: DEFAULT_TEST_SCOPE, ...claims };
  };

  const sign = (
    claims = {},
    { key = privateKey, exp = "5m", aud = MCP_AUDIENCE, iss = issuer, noSubject = false } = {},
  ) => {
    let jwt = buildJwt(mitScopeDefault(claims), { iss, aud, exp });
    if (!noSubject) jwt = jwt.setSubject(claims.sub || "user-1");
    return jwt.sign(key);
  };

  return {
    issuer,
    sign,
    wrongKey: wrong.privateKey,
    close: () => new Promise((r) => server.close(r)),
  };
}

export function mcpPost(url, token, body = { jsonrpc: "2.0", id: 1, method: "initialize" }) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

export const toolCall = (name, args = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name, arguments: args },
});

export async function readToolResult(res) {
  return (await readRpcMessage(res)).result;
}

export async function readRpcMessage(res) {
  const body = await res.text();
  const trimmed = body.trim();
  const raw = trimmed.startsWith("{")
    ? trimmed
    : (body.split(/\r?\n/).find((l) => l.startsWith("data:")) || "").slice("data:".length).trim();
  if (!raw) throw new Error(`Keine JSON-RPC-Daten in der MCP-Antwort:\n${body}`);
  return JSON.parse(raw);
}

export function assertReauthChallenge(result) {
  assert.equal(result.isError, true);
  const challenge = result._meta?.["mcp/www_authenticate"];
  assert.ok(Array.isArray(challenge) && challenge.length === 1, "genau eine Challenge");
  assert.ok(
    challenge[0].startsWith('Bearer resource_metadata="https://agent.test/.well-known/oauth-protected-resource"'),
    "resource_metadata zuerst, PUBLIC_URL aus BASE_ENV",
  );
  assert.ok(challenge[0].includes('scope="openid email offline_access"'));
  assert.ok(challenge[0].includes('error="insufficient_scope"'));
  assert.ok(challenge[0].includes('error_description="'));
}

export async function startServerExpectExit({
  env = {},
  seed,
  rawStore,
  ownerNumber,
  dataDir: reuseDataDir,
  timeoutMs = 8000,
} = {}) {
  const dataDir =
    reuseDataDir || tempDataDir(rawStore ? seed : ensureOwnerNumber(seed, ownerNumber), rawStore);
  serverStarts.zaehle(1);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...BASE_ENV, ...env, DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d.toString()));
  child.stderr.on("data", (d) => (output += d.toString()));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Server ist NICHT beendet (Boot-Refusal erwartet). Output:\n${output}`));
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output, dataDir });
    });
  });
}

export async function startServer({
  env = {},
  seed,
  rawStore,
  ownerNumber,
  dataDir: reuseDataDir,
} = {}) {
  const dataDir =
    reuseDataDir || tempDataDir(rawStore ? seed : ensureOwnerNumber(seed, ownerNumber), rawStore);
  serverStarts.zaehle(1);
  const child = spawn(process.execPath, ["test/helpers/server-mit-elternwaechter.mjs"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...BASE_ENV, ...env, DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const output = { text: "" };
  child.stdout.on("data", (d) => (output.text += d.toString()));
  child.stderr.on("data", (d) => (output.text += d.toString()));

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Server-Start Timeout. Output:\n${output.text}`)),
      STARTUP_TIMEOUT_MS,
    );
    const onData = (d) => {
      const m = output.text.match(/laeuft auf http:\/\/localhost:(\d+)/);
      if (m) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve(parseInt(m[1], 10));
      }
    };
    child.stdout.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server vorzeitig beendet (code ${code}). Output:\n${output.text}`));
    });
  });

  return {
    port,
    dataDir,
    child,
    localUrl: `http://localhost:${port}`,
    externalUrl: externalIp() ? `http://${externalIp()}:${port}` : null,
    get stdout() {
      return output.text;
    },
    readStore() {
      return JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
    },
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    },
  };
}

export const GERMAN_STOPWORDS =
  /Guten Tag|Hallo|kann gerade nicht|Anruf|Gegenseite|Bitte spaeter erneut|Nachricht|Ungueltige|Anmeldung fehlgeschlagen|Sitzung abgelaufen|Grund|Besitzer|Auftrag/;
