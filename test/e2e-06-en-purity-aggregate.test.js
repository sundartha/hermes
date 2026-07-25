// E2E-06 (i18n-Testkatalog, tasks/i18n-tests/11-luecken-und-e2e.md:989) - Sprach-
// Reinheits-Aggregat ueber ALLE nutzersichtbaren Kanaele, erweitert PROMPT-14 (das heute
// nur 3 Kanaele aggregiert: Greeting, Prompt, SMS).
//
// SOLL (rot): germanLeakCount === 0 fuer einen EN-Tenant, ueber alle Kanaele.
//
// Abdeckung dieses Tests: 8 der 9 im Katalog genannten Kanaele, real ausgefuehrt oder per
// statischem Text-Check (kein Build/Netz). NICHT nachgebaut: Kanal 3 (die messages-/
// tool_result-Kette, GAP-28) - das braucht den vollen Claude-Tool-Loop (echter/gemockter
// LLM-Turn) und ist damit ein eigenstaendiges, deutlich teureres Vorhaben; die anderen acht
// Kanaele tragen die Aussage bereits mit einem zweistelligen Befund (s.u.), das entspricht
// der im Katalog dokumentierten Erwartung ("mit einem zweistelligen Zaehler").
//
// DATA_DIR im before VOR dem ersten claude.js-Import (Repo-Regel, Muster
// test/claude-identity.test.js) - store.tenantContext() liest sonst das echte
// data/store.json.
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
} from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { signValue, makeWebAuthRoutes } from "../src/web-auth.js";
import express from "express";

const TENANT_EN = "t_e2e06_en";

// Deutsche Signal-/Funktionswoerter, die in einem rein-englischen Kanal NICHT vorkommen
// duerfen (Muster WEB-05/E2E-02: "Guten Tag"/"Hallo"/"kann gerade nicht"/"Anruf").
const GERMAN_STOPWORDS =
  /Guten Tag|Hallo|kann gerade nicht|Anruf|Gegenseite|Bitte spaeter erneut|Nachricht|Ungueltige|Anmeldung fehlgeschlagen|Sitzung abgelaufen|Grund|Besitzer|Auftrag/;

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

test("E2E-06 (SOLL rot): germanLeakCount ueber acht Kanaele ist 0 fuer einen EN-Tenant", async () => {
  const leaks = [];
  const callEn = seedCall({ tenantId: TENANT_EN, language: "en", direction: "outbound", goal: "Termin verschieben" });

  // Kanal 2: systemPrompt (D28/PROMPT-09 - locale-frei, deutsches Prompt-Geruest).
  leaksOf("systemPrompt", systemPrompt(callEn), leaks);
  // Kanal 2b: toolDefs() (locale-frei per Konstruktion, Beleg claude.js:303-353).
  leaksOf("toolDefs", JSON.stringify(toolDefs()), leaks);
  // Kanal 4: openingText/goal-Rahmung (GAP-29) - disclosureSentence + bridgePhrase.
  leaksOf("openingText", openingText(callEn), leaks);

  // Kanal 1: Inbound-Greeting (WEB-05, spawn - Muster E2E-02/E2E-04).
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

  // Kanal 5: Summary-SMS + Notification-Titel (WEB-14, Muster call-finish-Fake-Store).
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
    },
    config: { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} },
    metering: { recordVoiceMinuteMeter: () => {}, reconcileOutboundVoiceBudget: () => {} },
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

  // Kanal 6: Gate-Ablehnungstexte (numberGateError/Budget-402) - statischer Text-Check
  // (keine Sprachverzweigung im Code, src/telephony/outbound-gates.js:278-297,329-351).
  const gatesSrc = fs.readFileSync(path.join(ROOT, "src/telephony/outbound-gates.js"), "utf8");
  leaksOf("gateRejectionLiterals", gatesSrc.match(/message:\s*`[^`]+`|message:\s*"[^"]+"/g)?.join(" ") || "", leaks);

  // Kanal 7: MCP-Tool-Beschreibungen/-Fehlermeldungen - statischer Text-Check
  // (src/mcp-tools.js:65-67,77-79,108-110,339-342, keine Sprachverzweigung).
  const mcpSrc = fs.readFileSync(path.join(ROOT, "src/mcp-tools.js"), "utf8");
  leaksOf("mcpErrorLiterals", mcpSrc, leaks);

  // Kanal 8: Self-Service-/Auth-Fehlerseiten (CSRF, Session abgelaufen, Anmeldung
  // fehlgeschlagen) - reale Router-Antworten (Muster test/web-auth.test.js).
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

  // Kanal 9: tenant.html Labels/Zahlenformate (de-DE hartkodiert).
  const tenantHtml = fs.readFileSync(path.join(ROOT, "public/tenant.html"), "utf8");
  if (/toLocaleString\("de-DE"\)|Intl\.NumberFormat\("de-DE"\)/.test(tenantHtml)) leaks.push("tenantHtmlFormat");

  const TOTAL_CHECKED_LABELS = 10; // systemPrompt, toolDefs, openingText, inboundGreeting,
  // summarySms, notificationTitle, gateRejectionLiterals, mcpErrorLiterals, authCsrfError,
  // tenantHtmlFormat - ueber 8 der 9 Katalog-Kanaele (Kanal 3 fehlt, s. Kopfkommentar).
  assert.deepEqual(
    leaks,
    [],
    `SOLL: germanLeakCount muss 0 sein fuer einen EN-Tenant (gemessene Lecks: ` +
      `${leaks.join(", ")} - ${leaks.length} von ${TOTAL_CHECKED_LABELS} geprueften Signalen)`,
  );
});
