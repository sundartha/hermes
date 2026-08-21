// E2E-06 (i18n-Testkatalog, tasks/i18n-tests/11-luecken-und-e2e.md:989) - Sprach-
// Reinheits-Aggregat ueber ALLE nutzersichtbaren Kanaele, erweitert PROMPT-14 (das heute
// nur 3 Kanaele aggregiert: Greeting, Prompt, SMS).
//
// SOLL (rot): germanLeakCount === 0 fuer einen EN-Tenant, ueber alle Kanaele.
//
// Abdeckung dieses Tests: 7 der 9 im Katalog genannten Kanaele, real ausgefuehrt oder per
// statischem Text-Check (kein Build/Netz). NICHT nachgebaut: Kanal 3 (die messages-/
// tool_result-Kette, GAP-28) - das braucht den vollen Claude-Tool-Loop (echter/gemockter
// LLM-Turn) und ist damit ein eigenstaendiges, deutlich teureres Vorhaben. ENTFALLEN mit
// P14: Kanal 9 (Zahlenformate in public/tenant.html) - die gemessene Oberflaeche ist
// geloescht, apps/web formatiert bewusst en-US (WEB-18 in dashboard-i18n-surface.test.js
// haelt genau das). Die verbleibenden Kanaele tragen die Aussage weiter.
//
// P11-Stand (Phasenbericht): P11 senkte den Zaehler von 8 auf 3 (systemPrompt/toolDefs/
// openingText/inboundGreeting/summarySms/notificationTitle wurden sprachrein); die drei
// Restlecks (gateRejectionLiterals, mcpErrorLiterals, tenantHtmlFormat) lagen ausserhalb
// der P11-Wurzel.
//
// P15-Stand (PLAN-I18N-FIX P15, Auflage A3): die drei Restlecks sind geschlossen
// (Gate-Ablehnungstexte aus i18n/gate-texts.js, MCP-Leertexte/Feldnamen aus i18n/
// mcp-texts.js, tenant.html-Datumsformat vom Server). Der Test ist GRUEN und damit ein
// Regressionsfang statt eines Launch-Gates - deshalb traegt er die Katalog-ID nicht mehr
// am Namensanfang, sondern als "(ex E2E-06)"-Suffix (Zuordnungsregel: package.json
// config.i18nCatalogPattern greift nur am Namensanfang). Der Dateiname bleibt fuer die
// Katalog-Rueckverfolgbarkeit; geloescht wird der Test NICHT.
//
// R5 (im P15-Phasenreport begruendet): der Kanal mcpErrorLiterals mass vorher die
// KOMPLETTE Quelldatei src/mcp-tools.js - inklusive der deutschen Kommentarzeilen, die die
// Repo-Konvention ausdruecklich verlangt. So konnte er strukturell nie gruen werden. Er
// misst jetzt AUSGELIEFERTEN Text (s. deliveredTextOf unten).
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

  // Kanal 2: systemPrompt (D28/PROMPT-09 - locale-frei, deutsches Prompt-Geruest).
  leaksOf("systemPrompt", systemPrompt(callEn), leaks);
  // Kanal 2b: toolDefs("en") (P11: sprachabhaengig; ohne Argument haengt das Ergebnis
  // am Weltdefault-Schalter statt an der Tenant-Sprache).
  leaksOf("toolDefs", JSON.stringify(toolDefs("en")), leaks);
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
      // INBOX-P1: der Marker faellt am Gespraechsende immer (No-op bei false).
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

  // Kanal 6: Gate-Ablehnungstexte (numberGateError/Budget-402) - statischer Text-Check
  // ueber die ausgelieferten message:-Werte in src/telephony/outbound-gates.js.
  const gatesSrc = fs.readFileSync(path.join(ROOT, "src/telephony/outbound-gates.js"), "utf8");
  leaksOf("gateRejectionLiterals", gatesSrc.match(/message:\s*`[^`]+`|message:\s*"[^"]+"/g)?.join(" ") || "", leaks);

  // Kanal 7: MCP-Tool-Texte - statischer Text-Check.
  // R5-KORREKTUR (P15/T4, im Phasenreport begruendet): der Kanal misst TENANT-SICHTBAREN,
  // AUSGELIEFERTEN Text - so wie der Nachbarkanal gateRejectionLiterals mit seinem
  // message:-Muster. Vorher wurde die KOMPLETTE Quelldatei gegriffen, inklusive der
  // deutschen Kommentarzeilen, die die Repo-Konvention ausdruecklich verlangt: der Kanal
  // konnte strukturell nie gruen werden. Abgezogen werden GENAU ZWEI Klassen, beide mit
  // eigener Abdeckung: (1) Kommentarzeilen (Konvention: deutsch); (2) die nach O14 bewusst
  // englischen Tool-/Feld-Beschreibungen (Modellsprache != Nutzersprache) - sie haben mit
  // test/p15-mcp-tool-descriptions-en.test.js einen EIGENEN Waechter, der sie gegen
  // DIESELBE Stopwortliste prueft. Die Stopwortliste selbst, die Kanalzahl und
  // TOTAL_CHECKED_LABELS bleiben unveraendert.
  const QUOTED = String.raw`"(?:\\.|[^"\\])*"`;
  const deliveredTextOf = (src) =>
    src
      .replace(/^[ \t]*\/\/.*$/gm, "")
      .replace(new RegExp(String.raw`description:\s*${QUOTED}`, "g"), "")
      .replace(new RegExp(String.raw`\.describe\(\s*${QUOTED}`, "g"), "")
      .replace(new RegExp(String.raw`(tool\(\s*${QUOTED},\s*)${QUOTED}`, "g"), "$1");
  const mcpSrc = fs.readFileSync(path.join(ROOT, "src/mcp-tools.js"), "utf8");
  leaksOf("mcpErrorLiterals", deliveredTextOf(mcpSrc), leaks);

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

  // Kanal 9 (tenant.html Labels/Zahlenformate) ist mit P14 entfallen - Datei geloescht.

  const TOTAL_CHECKED_LABELS = 9; // systemPrompt, toolDefs, openingText, inboundGreeting,
  // summarySms, notificationTitle, gateRejectionLiterals, mcpErrorLiterals, authCsrfError
  // - ueber 7 der 9 Katalog-Kanaele (Kanal 3 und 9 fehlen, s. Kopfkommentar).
  assert.deepEqual(
    leaks,
    [],
    `SOLL: germanLeakCount muss 0 sein fuer einen EN-Tenant (gemessene Lecks: ` +
      `${leaks.join(", ")} - ${leaks.length} von ${TOTAL_CHECKED_LABELS} geprueften Signalen)`,
  );
});
