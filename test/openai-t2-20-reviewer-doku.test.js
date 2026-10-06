import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer, seedState, mcpPost, readToolResult } from "./helpers.js";
import { interneKennungen } from "./mcp-vertrag-pruefung.js";
import { REVIEWER_SEED_CALLS } from "../scripts/lib/reviewer-demo-seed.mjs";

const DOC_PATH = path.join(ROOT, "docs", "OPENAI-REVIEWER-ACCESS.md");
const ANCHOR_BLOCK = { begin: "ANKER-BEGIN", end: "ANKER-END" };
const SEED_BLOCKS = {
  en: {
    begin: "SEED-EN-BEGIN -->",
    end: "<!-- SEED-EN-END",
    call: "Incoming call from",
    item: "Action item:",
  },
  de: {
    begin: "SEED-DE-BEGIN -->",
    end: "<!-- SEED-DE-END",
    call: "Eingehender Anruf von",
    item: "Action Item:",
  },
};
const SECTIONS = {
  en: { begin: "## English", end: "## Deutsch" },
  de: { begin: "## Deutsch", end: "## Anker" },
};
const LOGIN_SECTION = { en: "### 3. Login path", de: "### 3. Login-Pfad" };
const QUOTE_START = '> "';
const OPENAI_URL = "https://developers.openai.com/";
const TOOLS_LIST_BODY = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const CONSULT_ON = { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" };
const TOOL_NAME_IN_BACKTICKS = /`([a-z]+(?:_[a-z]+)+)`/g;
const NON_TOOL_IDENTIFIERS = new Set(["authorization_servers"]);
const PLACEHOLDERS = [
  "<REVIEWER_EMAIL>",
  "<REVIEWER_PASSWORD>",
  "<MCP_SERVER_URL>",
  "<TEST_TARGET_NUMBER>",
];

const REQUIRED_QUOTES = [
  "When submitting a plugin with an authenticated MCP server, provide a login and password for a fully featured demo account that includes sample data. Plugins that require additional login steps, such as a new account sign-up or 2FA through an inaccessible account, will be rejected.",
  "For servers requiring authentication, our review team must be able to log into a demo account with no further configuration required.",
  "Ensure that the provided URL and credentials are correct, do not feature MFA (including requiring SMS codes, login through systems that require SMS, email or other verification schemes).",
  "Ensure that the provided credentials can be used to log in successfully (test them outside any company networks, local area networks, or other internal networks).",
  "Confirm that the credentials have not expired.",
  "Test account or fixture data required to reproduce it.",
  "Use test cases that reviewers can run without internal context. If your plugin requires authentication, make sure the provided demo credentials can complete each test without MFA, SMS, email confirmation, or private-network access.",
  "Reviewer credentials work without MFA, email confirmation, SMS confirmation, or private-network access.",
  "Reviewer-ready demo credentials when the server uses OAuth.",
];

const WARNINGS = {
  en: [
    "Operator commitment, not a code fact",
    "does not technically restrict",
    "reach real people",
    "fictional",
    "Please do not",
    "retention period",
    "do not expire",
    "no administrator override",
    "without MFA",
    "empty inbox",
    "does not extend the retention",
  ],
  de: [
    "Zusage des Betreibers, keine Code-Tatsache",
    "technisch",
    "echte Menschen",
    "fiktiv",
    "Bitte",
    "Aufbewahrungsfrist",
    "nicht ablaufen",
    "keine Administrator-Ausnahme",
    "ohne MFA",
    "leeren Posteingang",
    "verlaengert die Aufbewahrung vorhandener nicht",
  ],
};

const HYGIENE = [
  { name: "Phase", pattern: /\bPhase\b/, probe: "siehe Phase 3" },
  { name: "P-/E-Nummer", pattern: /\b[PE]\d+[a-z]?\b/, probe: "wie in P7b" },
  { name: "E-Mail", pattern: /[\w.+-]+@[\w-]+\.[\w.]+/, probe: "reviewer@example.com" },
  {
    name: "Nummer ausser 555-01xx",
    pattern: /\+(?!120255501\d\d\b)\d{6,}/,
    probe: "+4915112345678",
  },
  { name: "Stripe-Schluessel", pattern: /\bsk_/, probe: "sk_live_abc" },
  { name: "Webhook-Secret", pattern: /whsec_/, probe: "whsec_abc" },
  {
    name: "Anbieter-Nutzerkennung",
    pattern: /\buser_[A-Za-z0-9]{10,}/,
    probe: "user_01ABCDEFGHJK",
  },
  { name: "Anbieter-Organisation", pattern: /\borg_/, probe: "org_01ABC" },
];

const readDoc = () => fs.readFileSync(DOC_PATH, "utf8");

function between(doc, { begin, end }) {
  const start = doc.indexOf(begin);
  const stop = doc.indexOf(end, start + begin.length);
  assert.ok(start !== -1 && stop > start, `Abschnitt ${begin}..${end} fehlt`);
  return { start, stop: stop + end.length, body: doc.slice(start + begin.length, stop) };
}

const nonEmptyLines = (text) => text.split("\n").filter((line) => line.trim().length > 0);

function proseOf(doc) {
  const { start, stop } = between(doc, ANCHOR_BLOCK);
  return doc.slice(0, start) + doc.slice(stop);
}

const section = (doc, lang) => between(doc, SECTIONS[lang]).body;

function loginSteps(doc, lang) {
  const body = section(doc, lang);
  const start = body.indexOf(LOGIN_SECTION[lang]);
  assert.ok(start !== -1, `${lang}: Login-Abschnitt fehlt`);
  const rest = body.slice(start + LOGIN_SECTION[lang].length);
  const stop = rest.indexOf("\n### ");
  return (stop === -1 ? rest : rest.slice(0, stop)).match(/^\d+\. /gm) || [];
}

function expectedSeedLines({ call, item }) {
  return REVIEWER_SEED_CALLS.flatMap((entry) => [
    `- ${call} ${entry.from}: ${entry.summary}`,
    ...entry.actionItems.map((text) => `  - ${item} ${text}`),
  ]);
}

async function httpToolNames() {
  const srv = await startServer({ seed: seedState({}), env: CONSULT_ON });
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, TOOLS_LIST_BODY);
    return new Set((await readToolResult(res)).tools.map((tool) => tool.name));
  } finally {
    await srv.stop();
  }
}

test("Reviewer-Doku: keine internen Kennungen, Adressen, fremden Nummern oder Secret-Formate", () => {
  const doc = readDoc();
  assert.deepEqual(interneKennungen(doc), []);
  assert.ok(
    interneKennungen("siehe T2-20 und OW-L").length > 0,
    "Positiv-Kontrolle interneKennungen",
  );
  for (const { name, pattern, probe } of HYGIENE) {
    assert.match(probe, pattern, `Positiv-Kontrolle ${name}`);
    assert.doesNotMatch(proseOf(doc), pattern, `${name} im Dokument`);
  }
});

test("Reviewer-Doku: jedes Zitat nennt seine OpenAI-URL, die Soll-Zitate stehen woertlich im EN-Teil", () => {
  const doc = readDoc();
  const lines = doc.split("\n");
  const quoteLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith(QUOTE_START));
  assert.ok(
    quoteLines.length >= REQUIRED_QUOTES.length,
    "zu wenige Zitate - der Extraktor greift nicht",
  );
  for (const { line, index } of quoteLines) {
    assert.ok(
      lines[index + 1]?.includes(OPENAI_URL),
      `Zitat ohne developers.openai.com-URL: ${line}`,
    );
  }
  const english = section(doc, "en");
  for (const quote of REQUIRED_QUOTES)
    assert.ok(english.includes(`${QUOTE_START}${quote}"`), `fehlt: ${quote}`);
});

test("Reviewer-Doku: Beispieldaten in EN und DE sind genau REVIEWER_SEED_CALLS", () => {
  const doc = readDoc();
  for (const [lang, markers] of Object.entries(SEED_BLOCKS)) {
    const actual = nonEmptyLines(between(doc, markers).body);
    assert.deepEqual(actual, expectedSeedLines(markers), `${lang}: Beispieldaten weichen ab`);
  }
});

test("Reviewer-Doku: jeder genannte Werkzeugname steht im echten tools/list ueber HTTP /mcp", async () => {
  const identifiers = [...readDoc().matchAll(TOOL_NAME_IN_BACKTICKS)].map(([, name]) => name);
  const named = new Set(identifiers.filter((name) => !NON_TOOL_IDENTIFIERS.has(name)));
  assert.ok(named.has("list_calls"), "Extraktor greift nicht");
  const authSource = fs.readFileSync(path.join(ROOT, "src", "auth.js"), "utf8");
  for (const name of NON_TOOL_IDENTIFIERS)
    assert.ok(authSource.includes(`${name}:`), `${name} kein Metadatenfeld`);
  const onWire = await httpToolNames();
  assert.deepEqual(
    [...named].filter((name) => !onWire.has(name)),
    [],
    "Werkzeug fehlt im tools/list",
  );
});

test("Reviewer-Doku: EN und DE mit denselben Platzhaltern, Login-Schritten und Warnungen", () => {
  const doc = readDoc();
  for (const lang of ["en", "de"]) {
    const body = section(doc, lang);
    for (const placeholder of PLACEHOLDERS)
      assert.ok(body.includes(placeholder), `${lang}: ${placeholder} fehlt`);
    for (const warning of WARNINGS[lang])
      assert.ok(body.includes(warning), `${lang}: Warnung "${warning}" fehlt`);
  }
  const stepsEn = loginSteps(doc, "en").length;
  assert.ok(stepsEn > 0, "Login-Schritte nicht gefunden");
  assert.equal(loginSteps(doc, "de").length, stepsEn, "gleiche Zahl Login-Schritte");
  const countCommitments = (lang, marker) => section(doc, lang).split(marker).length - 1;
  assert.equal(
    countCommitments("de", "Zusage des Betreibers"),
    countCommitments("en", "Operator commitment"),
    "jede Betreiber-Zusage in beiden Fassungen",
  );
});
