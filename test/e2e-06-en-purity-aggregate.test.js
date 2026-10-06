import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  tempDataDir,
  seedState,
  seedCall,
  startServer,
  postTelnyxIncoming,
  ROOT,
  GERMAN_STOPWORDS,
} from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { signValue, makeWebAuthRoutes } from "../src/web-auth.js";
import express from "express";

const TENANT_EN = "t_e2e06_en";

let systemPrompt, toolDefs, openingText;
before(async () => {
  const seed = seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" },
      { id: TENANT_EN, status: "active", ownerName: "Bob Example" },
    ],
    numbers: [
      { id: "num_en", e164: "+12025550188", tenantId: TENANT_EN, provider: "telnyx", status: "active", providerNumberId: null },
    ],
  });
  process.env.DATA_DIR = tempDataDir(seed);
  await import("../src/config.js");
  ({ systemPrompt, toolDefs, openingText } = await import("../src/claude.js"));
});

function leaksOf(label, text, leaks) {
  if (GERMAN_STOPWORDS.test(text)) leaks.push(label);
}

test("Sprachreinheit: germanLeakCount ueber sieben Kanaele ist 0 fuer einen EN-Tenant (ex E2E-06)", async () => {
  const leaks = [];
  const callEn = seedCall({ tenantId: TENANT_EN, language: "en", direction: "outbound", goal: "Termin verschieben" });

  leaksOf("systemPrompt", systemPrompt(callEn), leaks);
  leaksOf("toolDefs", JSON.stringify(toolDefs("en")), leaks);
  leaksOf("openingText", openingText(callEn), leaks);

  const srv = await startServer({
    seed: seedState({
      tenants: [
        { id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" },
        { id: TENANT_EN, status: "active", ownerName: "Bob Example" },
      ],
      numbers: [
        { id: "num_en", e164: "+12025550188", tenantId: TENANT_EN, provider: "telnyx", status: "active", providerNumberId: null },
      ],
    }),
  });
  try {
    const res = await postTelnyxIncoming(srv, { to: "+12025550188", callSid: "CAe2e06" });
    leaksOf("inboundGreeting", await res.text(), leaks);
  } finally {
    await srv.stop();
  }

  const notify = [];
  const sms = [];
  const finish = makeCallFinish({
    store: {
      withStoreLock: (fn) => fn(),
      releaseOutboundReserve: async () => {},
      save: () => {},
      addNotification: (title, body) => notify.push(`${title} ${body}`),
      purgeTranscript: () => {},
      tenantContext: () => ({ settings: { agentName: "Hermes" } }),
      recordUsageEvent: () => {},
      markSummarySmsSent: () => {},
      markBilled: () => {},
      markInboxEntry: () => {},
    },
    config: { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} },
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async ({ body }) => sms.push(body) }),
    summarizeCall: async () => ({ summary: "Call summary", actionItems: [] }),
    planSummarySms: () => ({ send: true, to: "+12025550199", smsFrom: { e164: "+12025550188" }, reason: null }),
    audit: () => {},
  });
  const finishedCall = seedCall({
    tenantId: TENANT_EN,
    language: "en",
    direction: "outbound",
    status: "completed",
    to: "+12025550199",
    transcript: [{ role: "caller", text: "Hi", at: "2026-01-01T00:00:00Z" }],
  });
  await finish.finishCall(finishedCall);
  leaksOf("summarySms", sms[0] || "", leaks);
  leaksOf("notificationTitle", notify[0] || "", leaks);

  const gatesSrc = fs.readFileSync(path.join(ROOT, "src/telephony/outbound-gates.js"), "utf8");
  leaksOf("gateRejectionLiterals", gatesSrc.match(/message:\s*`[^`]+`|message:\s*"[^"]+"/g)?.join(" ") || "", leaks);

  const QUOTED = String.raw`"(?:\\.|[^"\\])*"`;
  const deliveredTextOf = (src) =>
    src
      .replace(/^[ \t]*\/\/.*$/gm, "")
      .replace(new RegExp(String.raw`description:\s*${QUOTED}`, "g"), "")
      .replace(new RegExp(String.raw`\.describe\(\s*${QUOTED}`, "g"), "")
      .replace(new RegExp(String.raw`(tool\(\s*${QUOTED},\s*)${QUOTED}`, "g"), "$1");
  const mcpSrc = fs.readFileSync(path.join(ROOT, "src/mcp-tools.js"), "utf8");
  leaksOf("mcpErrorLiterals", deliveredTextOf(mcpSrc), leaks);

  const app = express();
  app.use(
    makeWebAuthRoutes({
      secret: "e2e06-secret-0123456789",
      redirectUri: "https://agent.test/auth/callback",
      ttlSeconds: 3600,
      oidc: { authorizeUrl: async () => "https://idp.test/authorize", exchange: async () => { throw new Error("boom"); } },
      accounts: { upsertOnFirstLogin: async () => ({ tenantId: "t_x", status: "suspended", role: "member" }) },
      sessions: { create: async () => ({ id: "s" }) },
      audit: { record: async () => {} },
    }),
  );
  const server = await new Promise((r) => app.listen(0, "127.0.0.1", function () { r(this); }));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const csrfRes = await fetch(`${base}/auth/callback?code=x&state=attacker`, {
      headers: { Cookie: `oauth_state=${encodeURIComponent(signValue("real", "e2e06-secret-0123456789"))}` },
    });
    leaksOf("authCsrfError", await csrfRes.text(), leaks);
  } finally {
    await new Promise((r) => server.close(r));
  }

  const TOTAL_CHECKED_LABELS = 9;
  assert.deepEqual(
    leaks,
    [],
    `SOLL: germanLeakCount muss 0 sein fuer einen EN-Tenant (gemessene Lecks: ` +
      `${leaks.join(", ")} - ${leaks.length} von ${TOTAL_CHECKED_LABELS} geprueften Signalen)`,
  );
});
