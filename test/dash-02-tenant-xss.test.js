// DASH-02 (PLAN-LAUNCH-TESTS.md, Launch-Testlauf 1): tenant.html XSS / esc()-Frontend.
// Boesartige Namen/Ziele/Summaries/Notification-Texte muessen durch renderCalls,
// callBody, renderNotifications und planCard AUSSCHLIESSLICH als escapte Text-Entities
// im gerenderten Markup landen - nie als rohes, browserfaehiges Tag/Attribut-Escape.
//
// Technik (Regel 2, "keine neuen Dependencies" -> KEIN jsdom, wie der Plan es urspruenglich
// vorschlug): tenant.html ist eine statische Datei ohne Server-Template, ihr Inline-Skript
// wird 1:1 wie in test/ui-02-call-widget-xss.test.js / test/mcp-ui-w1-call-widget.test.js
// per node:vm in einer minimalen Sandbox ausgefuehrt. Anders als das Widget-Skript (das
// ausschliesslich textContent nutzt) baut tenant.html HTML-STRINGS per Template-Literal und
// weist sie ueber innerHTML zu - hier gibt es also tatsaechlich einen innerHTML-Pfad. Statt
// eines echten HTML-Parsers (den wir ohne jsdom nicht haben) wird direkt auf dem resultierenden
// Markup-STRING geprueft: der rohe Payload (z.B. "<img") darf darin nicht vorkommen, die
// escapte Form (z.B. "&lt;img") schon - das ist exakt das, was esc() garantieren soll.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TENANT_HTML = readFileSync(
  fileURLToPath(new URL("../public/tenant.html", import.meta.url)),
  "utf8",
);

// XSS-Payloads aus dem Testplan (DASH-02): <img onerror>, Tag-Breakout, Anfuehrungszeichen.
const PAYLOAD_IMG = '<img src=x onerror=alert(1)>';
const PAYLOAD_BREAKOUT = '</div><script>alert(1)</script>';
const PAYLOAD_SINGLE_QUOTE = "'";
const PAYLOAD_DOUBLE_QUOTE = '"';
const ALL_PAYLOADS = [PAYLOAD_IMG, PAYLOAD_BREAKOUT, PAYLOAD_SINGLE_QUOTE, PAYLOAD_DOUBLE_QUOTE];

function ownScriptSource() {
  const matches = [...TENANT_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(matches.length === 1, "genau ein Inline-Skript in tenant.html gefunden");
  return matches[0][1];
}

// Minimales Fake-Element: innerHTML ist eine reine String-Property (kein Parsing, kein
// echtes DOM) - genau das macht den Test moeglich, ohne jsdom einzufuehren. Wir pruefen
// bewusst den resultierenden MARKUP-STRING, nicht geparste Kind-Knoten.
function makeFakeElement() {
  return {
    _html: "",
    get innerHTML() {
      return this._html;
    },
    set innerHTML(v) {
      this._html = v;
    },
    textContent: "",
    value: "",
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    onclick: null,
  };
}

function makeFakeDocument() {
  const byId = new Map();
  return {
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, makeFakeElement());
      return byId.get(id);
    },
  };
}

// Fuehrt das eigene Inline-Skript von tenant.html in einer frischen vm-Sandbox aus. Die
// Boot-Sequenz am Skript-Ende (Event-Listener-Bindung, showCheckoutReturn-IIFE,
// loadPlanCatalog().then(refresh)) braucht ein paar zusaetzliche Browser-Globals, die eine
// vm-Sandbox NICHT automatisch mitbringt (anders als Sprachbausteine wie Intl) - alle
// fail-soft, damit der Boot durchlaeuft, ohne dass wir echtes Netz/DOM brauchen.
function runOwnScript() {
  const doc = makeFakeDocument();
  const sandbox = {
    document: doc,
    location: { search: "", pathname: "/tenant.html" },
    history: { replaceState() {} },
    URLSearchParams,
    Intl,
    fetch: async () => ({ ok: false }),
    setTimeout: () => 1,
    clearTimeout() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(ownScriptSource(), sandbox);
  return { sandbox, doc };
}

test("DASH-02 statisch: renderCalls/callBody/planCard/renderNotifications fuehren Nutzerfelder ausschliesslich durch esc()", () => {
  const script = ownScriptSource();
  assert.match(script, /function esc\(s\)/, "esc() existiert");
  // Die Stellen, an denen Nutzerdaten (who/goal/summary/notification-Felder/Plan-Anzeige)
  // interpoliert werden, muessen esc(...) umschliessen - keine rohe Interpolation.
  assert.match(script, /esc\(who\)/, "who (from/to) laeuft durch esc()");
  assert.match(script, /c\.goal\?esc\(c\.goal\)/, "goal laeuft durch esc()");
  assert.match(script, /esc\(c\.summary\)/, "summary laeuft durch esc()");
  assert.match(script, /esc\(n\.title\)/, "notification-title laeuft durch esc()");
  assert.match(script, /esc\(n\.body\)/, "notification-body laeuft durch esc()");
  assert.match(script, /esc\(plan\.name\)/, "plan.name laeuft durch esc()");
  assert.match(script, /esc\(plan\.slug\)/, "plan.slug (im data-plan-Attribut) laeuft durch esc()");
});

test("DASH-02: esc() neutralisiert alle 4 Plan-Payloads (&, <, >, \") einzeln, korrekt", () => {
  const { sandbox } = runOwnScript();
  assert.equal(sandbox.esc(PAYLOAD_IMG), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(sandbox.esc(PAYLOAD_BREAKOUT), "&lt;/div&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(sandbox.esc(PAYLOAD_SINGLE_QUOTE), "'", "einzelnes Anfuehrungszeichen bleibt (kein Attribut-Kontext mit einfachen Quotes im Markup)");
  assert.equal(sandbox.esc(PAYLOAD_DOUBLE_QUOTE), "&quot;");
  assert.equal(sandbox.esc(null), "", "null -> leerer String, kein 'null'-Text");
  assert.equal(sandbox.esc(undefined), "", "undefined -> leerer String");
});

// Extrahiert den Inhalt EINES spezifischen Feld-Containers aus dem Markup-String. Praeziser
// als eine globale "Payload kommt im ganzen Dokument nicht vor"-Pruefung, die bei simplen
// Ein-Zeichen-Payloads wie '"' falsch negativ waere (das Zeichen kommt legitim tausendfach
// im umgebenden Boilerplate-Markup vor, z.B. in class="..."-Attributen).
function fieldContent(html, className) {
  const m = html.match(new RegExp(`<div class="${className}">([\\s\\S]*?)</div>`));
  return m ? m[1] : null;
}

for (const [idx, payload] of ALL_PAYLOADS.entries()) {
  test(`DASH-02: renderCalls mit boesartigem Namen (from) + Ziel (goal) + Summary im Inbound-Call -> nur escapter Text (Payload ${idx + 1}/${ALL_PAYLOADS.length}: ${JSON.stringify(payload)})`, () => {
    const { sandbox, doc } = runOwnScript();
    sandbox.renderCalls([
      {
        direction: "inbound",
        from: payload,
        goal: payload,
        summary: payload,
        status: "completed",
        objectiveAchieved: true,
      },
    ]);
    const html = doc.getElementById("calls").innerHTML;
    const escaped = sandbox.esc(payload);
    // Feldgenau statt global: der Name-Container (.cn) darf NUR die escapte Form enthalten.
    assert.equal(fieldContent(html, "cn"), escaped, "Name-Feld (.cn) enthaelt exakt die escapte Form");
    assert.equal(fieldContent(html, "cm"), escaped, "Ziel-Feld (.cm) enthaelt exakt die escapte Form");
    assert.equal(fieldContent(html, "cs"), escaped, "Summary-Feld (.cs) enthaelt exakt die escapte Form");
    // Direkter Beweis gegen den Breakout-Fall: das echte, ungeschlossene "<script>"-Tag
    // darf im Ergebnis-String nicht auftauchen (nur die escapte &lt;script&gt;-Textform).
    assert.ok(!/<script>/i.test(html), "kein echtes <script>-Tag im gerenderten Markup");
    assert.ok(!/<img\s/i.test(html), "kein echtes <img>-Tag im gerenderten Markup");
  });
}

test("DASH-02: renderCalls mit boesartigem Ziel (to) im Outbound-Call -> nur escapter Text", () => {
  const { sandbox, doc } = runOwnScript();
  sandbox.renderCalls([
    { direction: "outbound", to: PAYLOAD_IMG, goal: null, summary: null, status: "active" },
  ]);
  const html = doc.getElementById("calls").innerHTML;
  assert.ok(!html.includes(PAYLOAD_IMG), "roher <img>-Payload nicht im Markup");
  assert.ok(html.includes(sandbox.esc(PAYLOAD_IMG)), "escapte Form vorhanden");
  assert.ok(!/<img\s/i.test(html), "kein echtes <img>-Tag");
});

test("DASH-02: renderNotifications mit boesartigem title/body -> nur escapter Text", () => {
  const { sandbox, doc } = runOwnScript();
  sandbox.renderNotifications([{ title: PAYLOAD_BREAKOUT, body: PAYLOAD_IMG, at: "2026-07-01T00:00:00.000Z" }]);
  const html = doc.getElementById("notifications").innerHTML;
  assert.ok(!html.includes(PAYLOAD_BREAKOUT), "roher Breakout-Payload nicht im Markup (title)");
  assert.ok(!html.includes(PAYLOAD_IMG), "roher <img>-Payload nicht im Markup (body)");
  assert.ok(html.includes(sandbox.esc(PAYLOAD_BREAKOUT)), "escapte title-Form vorhanden");
  assert.ok(html.includes(sandbox.esc(PAYLOAD_IMG)), "escapte body-Form vorhanden");
  assert.ok(!/<script>/i.test(html) && !/<img\s/i.test(html), "kein echtes Tag im Markup");
});

for (const [idx, payload] of ALL_PAYLOADS.entries()) {
  test(`DASH-02: planCard/renderPlanCards mit boesartigem Plan-Namen + Slug -> nur escapter Text, kein Attribut-Breakout (Payload ${idx + 1}/${ALL_PAYLOADS.length}: ${JSON.stringify(payload)})`, () => {
    const { sandbox, doc } = runOwnScript();
    sandbox.renderPlanCards(
      [
        {
          slug: payload,
          name: payload,
          amountCents: 1900,
          currency: "eur",
          featured: false,
          features: [payload],
        },
      ],
      null,
    );
    const html = doc.getElementById("subButtons").innerHTML;
    const escaped = sandbox.esc(payload);
    // Feldgenau: Name-Container (.plan-name) darf NUR die escapte Form enthalten.
    assert.equal(fieldContent(html, "plan-name"), escaped, "Plan-Name enthaelt exakt die escapte Form");
    assert.ok(!/<script>/i.test(html) && !/<img\s/i.test(html), "kein echtes Tag im Markup");
    // Attribut-Breakout-Check: data-plan="${esc(plan.slug)}" ist doppelt gequotet - der
    // gefaehrliche Payload dafuer ist das Anfuehrungszeichen selbst. Extraktion statt globaler
    // Substring-Suche, weil ein einzelnes '"' sonst trivial anderswo im Boilerplate matcht.
    const attrMatch = html.match(/data-plan="([^"]*)"/);
    assert.ok(attrMatch, "data-plan-Attribut wohlgeformt vorhanden (kein vorzeitig geschlossenes Attribut)");
    assert.equal(attrMatch[1], escaped, "data-plan-Attributwert ist exakt die escapte Form (kein Breakout)");
  });
}
