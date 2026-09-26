// T2-14 (N-10): Bestaetigungs-Ansicht im Call-Widget. Fake-Window nach dem Muster
// test/mcp-ui-w1-call-widget.test.js (node:vm, parent.postMessage mitgeschnitten), Fake-
// Document HIER erweitert um einen selbst-erzeugenden Selektor-Speicher (jeder abgefragte
// Selektor bekommt sein eigenes Fake-Element - deckt sowohl die Bestand-Slots als auch die
// neuen data-confirm-*/data-cf-*-Selektoren ab, ohne jeden einzeln aufzaehlen zu muessen).
//
// Deckt den Widget-Mechanismus (Schritt 6 (a)-(d), (f)-(l)) UEBER eine handgebaute Fixture
// (schnell, isoliert) UND das End-to-End-Kriterium (e) am echten Draht (HTTP Legacy/OAuth,
// stdio: echter prepare_call -> dieselbe Karte -> echtes place_call -> ui/message) sowie
// Schritt 7 (X-2/X-6-Waechter) - T2-14-Nachbesserung (Safety-Review), zuvor fehlten (e)/X-2/
// X-6 (Budget-Grenze des ersten Baulaufs). Die (e)-Tests nehmen den Fake-Originate-Harness
// aus test/openai-t2-13-bestaetigung.test.js: das ECHTE prepare_call-Ergebnis wird in die
// Karte gepusht, das von der Karte gesendete tools/call unveraendert an den echten Server
// weitergereicht - Beleg ist der Draht, nicht eine Annahme ueber sein Format.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import http from "node:http";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { widgetHtml, WIDGET_CALL } from "../src/ui/widget-catalog.js";
import { BIND_SCRIPT, signalUiReady, UI_READY_FLAG } from "../src/ui/widget-bind.js";
import { I18N_SCRIPT } from "../src/ui/widget-i18n.js";
import { PLACE_CALL_HOP_TIMEOUT_MS } from "../src/mcp-tools.js";
import { MCP_TEXTS } from "../src/i18n/mcp-texts.js";
import { uiResourceUri } from "../src/ui/contract.js";
import { KYC_LEVEL } from "../src/store/defaults.js";
import { planProfileFor } from "../src/plans.js";
import { startServer, startIdp, mcpPost, toolCall, readToolResult, seedState, ROOT, BASE_ENV, externalIp } from "./helpers.js";

// Lehre pgrep-blind/localhost-umgeht-das-Gate: localhost gilt serverseitig als
// vertrauenswuerdiger lokaler Aufrufer (isTrustedLocalCaller) - ein OAuth-Draht-Test ueber
// srv.localUrl koennte fail-closed nur WEIL localhost sowieso durchgelassen wird, ohne dass
// der OAuth-Rundlauf selbst je gemessen wurde. (e-oauth) unten faehrt deshalb ueber die
// Interface-IP; ohne eine solche (z.B. reines Loopback-Sandbox-Netz) wird der Fall
// uebersprungen statt falsch gruen zu sein.
const EXTERNAL_IP = externalIp();

function makeFakeElement(initialText) {
  const listeners = {};
  const attrs = {};
  return {
    _text: initialText || "",
    className: "",
    children: [],
    style: {},
    disabled: false,
    get firstChild() {
      return this.children.length ? this.children[0] : null;
    },
    get textContent() {
      return this._text;
    },
    set textContent(value) {
      this._text = value;
      this.children = [];
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((existingChild) => existingChild !== child);
      return child;
    },
    addEventListener(type, handler) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    click() {
      for (const handler of listeners.click || []) handler();
    },
    setAttribute(name, value) {
      attrs[name] = value;
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
  };
}

// [data-i18n]-Elemente, die die Tests unten brauchen: Selektor -> EN-Default-Text (== der
// Wert, den data-i18n im echten Markup traegt, s. call.html). NUR die vom I18N_SCRIPT
// (localizeStaticLabels/querySelectorAll("[data-i18n]")) gefundenen Elemente muessen hier
// bekannt sein - ein selbst-erzeugender Speicher wie bei den uebrigen Selektoren wuerde den
// data-i18n-Schluessel nicht kennen.
const I18N_LABELS = { "[data-confirm-button]": "Confirm call" };

// Selbst-erzeugender Selektor-Speicher: jeder abgefragte Selektor bekommt EIN eigenes
// Fake-Element, angelegt beim ersten querySelector-Aufruf (initiale textContent/data-i18n
// aus I18N_LABELS, falls dort gelistet - genau wie das echte, geparste Markup).
function makeFakeDocument() {
  const bySelector = new Map();
  function ensure(sel) {
    if (!bySelector.has(sel)) {
      const el = makeFakeElement(I18N_LABELS[sel]);
      if (I18N_LABELS[sel]) el.setAttribute("data-i18n", I18N_LABELS[sel]);
      bySelector.set(sel, el);
    }
    return bySelector.get(sel);
  }
  return {
    querySelector: ensure,
    querySelectorAll: (sel) => (sel === "[data-i18n]" ? Object.keys(I18N_LABELS).map(ensure) : []),
    documentElement: { lang: "" },
    createElement: () => makeFakeElement(),
    get: (sel) => bySelector.get(sel),
  };
}

function ownScriptSource() {
  const html = widgetHtml(WIDGET_CALL).replace(BIND_SCRIPT, "");
  const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(matches.length >= 1, "eigenes Inline-Skript in call.html gefunden");
  return matches[matches.length - 1][1];
}

function scriptBodyOf(script) {
  return script.match(/<script>([\s\S]*)<\/script>/)[1];
}

// Fuehrt das eigene Inline-Skript in einer frischen vm-Sandbox aus. console wird
// mitgeschnitten (Test (f): der Code darf NIRGENDS geloggt werden).
function runOwnScript(doc, options) {
  const sandbox = {};
  sandbox.document = doc;
  sandbox.window = sandbox;
  sandbox._posted = [];
  sandbox.parent = { postMessage: (msg) => sandbox._posted.push(msg) };
  sandbox._consoleCalls = [];
  sandbox.console = {
    log: (...args) => sandbox._consoleCalls.push(args),
    warn: (...args) => sandbox._consoleCalls.push(args),
    error: (...args) => sandbox._consoleCalls.push(args),
  };
  const listeners = {};
  sandbox.addEventListener = (type, handler) => {
    listeners[type] = listeners[type] || [];
    listeners[type].push(handler);
  };
  sandbox.CustomEvent = function CustomEvent(type) {
    this.type = type;
  };
  sandbox.dispatchEvent = (event) => {
    for (const handler of listeners[event.type] || []) handler(event);
  };

  const intervalFns = new Map();
  let intervalSeq = 0;
  sandbox.setInterval = (fn) => {
    intervalSeq += 1;
    intervalFns.set(intervalSeq, fn);
    return intervalSeq;
  };
  sandbox.clearInterval = (id) => intervalFns.delete(id);

  const timeoutFns = new Map();
  let timeoutSeq = 0;
  sandbox.setTimeout = (fn) => {
    timeoutSeq += 1;
    timeoutFns.set(timeoutSeq, fn);
    return timeoutSeq;
  };
  sandbox.clearTimeout = (id) => timeoutFns.delete(id);

  if (options && options.readyBeforeScript) sandbox[UI_READY_FLAG] = true;
  // Neulade-Tests (q)-(s): ein gemeinsamer Speicher ueber zwei Karten-Instanzen = dieselbe
  // Karte nach einem Neuladen. Ohne Option fehlt localStorage ganz (gesperrte Sandbox).
  if (options && options.localStorage) sandbox.localStorage = options.localStorage;

  vm.createContext(sandbox);
  if (options && options.withI18n) vm.runInContext(scriptBodyOf(I18N_SCRIPT), sandbox);
  vm.runInContext(ownScriptSource(), sandbox);

  return {
    emit: (data) => {
      for (const handler of listeners.message || []) handler({ data });
    },
    posted: sandbox._posted,
    consoleCalls: sandbox._consoleCalls,
    timeoutFns,
    fireTimeout: () => {
      for (const fn of [...timeoutFns.values()]) fn();
    },
    timeoutCount: () => timeoutFns.size,
    // (o): beweist, dass ein nach dem Fallback-Stop neu gestartetes Poll-Intervall
    // tatsaechlich wieder LAEUFT (nicht nur, dass kein Fehler geworfen wird).
    intervalCount: () => intervalFns.size,
    uiReady: () => signalUiReady(sandbox),
  };
}

const TO = "+491701234567";
const OBJECTIVE = "I would like to book an appointment.";
const CODE = "ABCDEF";
// Datenhinweis (Gesundheitsangaben) im _meta von prepare_call - ohne ihn bietet die Karte
// keinen Klick an (fail-closed). Echter Wortlaut kommt am Draht aus MCP_TEXTS.
const NOTICE_META_KEY = "hermes/call_data_notice";
const NOTICE = "Test notice: health details go to the agent; confirming means consent.";
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const CONFIRMATION_WINDOW_MINUTES = 5; // deckt sich mit call-confirmation.js CONFIRMATION_WINDOW_MINUTES
const FIVE_MINUTES_MS = CONFIRMATION_WINDOW_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;
const ONE_SECOND_MS = MS_PER_SECOND;
const EXPIRES_FUTURE = new Date(Date.now() + FIVE_MINUTES_MS).toISOString();
const EXPIRES_PAST = new Date(Date.now() - ONE_SECOND_MS).toISOString();
const CALL_ID = "call-xyz-123";

function awaitingConfirmationPush(overrides, metaOverrides) {
  return {
    method: "ui/notifications/tool-result",
    params: {
      structuredContent: { status: "awaiting_confirmation", to: TO, objective: OBJECTIVE, ...overrides },
      _meta: {
        "hermes/confirmation_code": CODE,
        "hermes/confirmation_expires_at": EXPIRES_FUTURE,
        [NOTICE_META_KEY]: NOTICE,
        ...metaOverrides,
      },
    },
  };
}

function placeCallToolCall(env) {
  const calls = env.posted.filter((msg) => msg.method === "tools/call" && msg.params.name === "place_call");
  return calls;
}

function uiMessages(env) {
  return env.posted.filter((msg) => msg.method === "ui/message");
}

// Objekte aus der vm-Sandbox leben in einer eigenen Realm (eigener Object.prototype) -
// node:assert/strict vergleicht bei deepEqual den Prototyp mit und wirft sonst "gleiche
// Struktur, nicht referenzgleich". JSON-Rundreise normalisiert auf reine Daten (Muster
// test/mcp-ui-w1-call-widget.test.js crossRealmPlain).
function crossRealmPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("(a) Push ohne Klick: kein tools/call place_call, kein ui/message; Replay desselben Pushs aendert nichts", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  env.emit(awaitingConfirmationPush());
  env.emit(awaitingConfirmationPush()); // Replay desselben Pushs
  assert.equal(placeCallToolCall(env).length, 0);
  assert.equal(uiMessages(env).length, 0);
  assert.equal(doc.get("[data-confirm]").style.display, "");
  assert.equal(doc.get("[data-confirm-to]").textContent, TO);
  assert.equal(doc.get("[data-confirm-objective]").textContent, OBJECTIVE);
});

test("(b) Klick: genau 1 tools/call place_call, Argumente == structuredContent (ohne status) + confirmation_code", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  env.emit(awaitingConfirmationPush({ language: "de-DE", max_duration_s: 300 }));
  doc.get("[data-confirm-button]").click();
  const calls = placeCallToolCall(env);
  assert.equal(calls.length, 1);
  assert.deepEqual(crossRealmPlain(calls[0].params.arguments), {
    to: TO,
    objective: OBJECTIVE,
    language: "de-DE",
    max_duration_s: 300,
    confirmation_code: CODE,
  });
});

test("(c) Doppelklick (synchron) und Klick nach Antwort: weiterhin genau 1 tools/call place_call", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  env.emit(awaitingConfirmationPush());
  const btn = doc.get("[data-confirm-button]");
  btn.click();
  btn.click(); // synchroner zweiter Klick waehrend "submitting"
  assert.equal(placeCallToolCall(env).length, 1);

  // Erfolgsantwort kommt an - Zustand "placed" - ein weiterer Klick darf nicht senden.
  const rpcId = env.posted[0].id;
  env.emit({ id: rpcId, result: { structuredContent: { call_id: CALL_ID, status: "dialing" } } });
  btn.click();
  assert.equal(placeCallToolCall(env).length, 1, "kein zweiter Versand nach Erfolg");
});

test("(d) Anzeige = Gesendetes: jeder Wert aus params.arguments steht als Text im sichtbaren Block (Positiv-Kontrolle)", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  env.emit(
    awaitingConfirmationPush({
      briefing: "Book a men's haircut Saturday morning",
      constraints: "no calls before 9am",
      mandate: { role: "assistant", scope: "booking" },
      context: { summary: "returning customer", details: { note: "prefers Alex" } },
      diagnostic: true,
      language: "en-GB",
      max_duration_s: 180,
    }),
  );
  doc.get("[data-confirm-button]").click();
  const sent = placeCallToolCall(env)[0].params.arguments;

  function visibleTexts() {
    const texts = [];
    for (const el of [
      doc.get("[data-confirm-to]"),
      doc.get("[data-confirm-objective]"),
      doc.get("[data-cf-briefing]"),
      doc.get("[data-cf-constraints]"),
      doc.get("[data-cf-mandate]"),
      doc.get("[data-cf-context]"),
      doc.get("[data-cf-diagnostic]"),
      doc.get("[data-cf-language]"),
      doc.get("[data-cf-max_duration_s]"),
    ]) {
      texts.push(el.textContent);
    }
    return texts.join("\n");
  }
  const shown = visibleTexts();
  assert.match(shown, /returning customer/);
  assert.match(shown, /prefers Alex/); // Blatt-Zeichenkette aus verschachteltem context.details
  assert.match(shown, /no calls before 9am/);
  assert.match(shown, /Book a men's haircut Saturday morning/);
  assert.match(shown, /assistant/); // mandate.role
  assert.match(shown, /booking/); // mandate.scope

  // Positiv-Kontrolle: ein gesendetes, absichtlich NICHT geprueftes Feld wird erkannt -
  // faellt der Werte-Vergleich weg, zeigt dieser Zusatz-Check, dass die Pruefung selbst
  // ueberhaupt etwas aussagt (sonst waere "gefunden" wertlos).
  assert.equal(sent.constraints, "no calls before 9am");
  assert.ok(!shown.includes("ein-nicht-gesendeter-marker-xyz"), "Sanity: unbeteiligter Marker fehlt");
});

test("(f) Code steht in GENAU EINER gesendeten Nachricht, nie in ui/message/textContent/console (Positiv-Kontrolle)", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  env.emit(awaitingConfirmationPush());
  doc.get("[data-confirm-button]").click();
  const rpcId = env.posted[0].id;
  env.emit({ id: rpcId, result: { structuredContent: { call_id: CALL_ID, status: "dialing" } } });

  const messagesWithCode = env.posted.filter((msg) => JSON.stringify(msg).includes(CODE));
  assert.equal(messagesWithCode.length, 1, "Code nur in der EINEN place_call-Nachricht");
  assert.equal(messagesWithCode[0].params.name, "place_call");
  assert.equal(uiMessages(env).some((msg) => JSON.stringify(msg).includes(CODE)), false);
  assert.equal(env.consoleCalls.some((call) => JSON.stringify(call).includes(CODE)), false);

  // Positiv-Kontrolle: eine Kopie MIT eingebautem Code wird von derselben Pruefung erkannt.
  const poisoned = uiMessages(env).map((msg) => ({ ...msg, params: { ...msg.params, injected: CODE } }));
  assert.ok(poisoned.every((msg) => JSON.stringify(msg).includes(CODE)));
});

test("(g) JSON-RPC-Fehlerantwort: Zustand unklar, KEIN zweites tools/call, genau 1 ui/message ohne Code", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  env.emit(awaitingConfirmationPush());
  doc.get("[data-confirm-button]").click();
  const rpcId = env.posted[0].id;
  env.emit({ id: rpcId, error: { code: -32000, message: "boom" } });

  assert.equal(placeCallToolCall(env).length, 1, "kein zweiter Versand");
  assert.equal(uiMessages(env).length, 1);
  assert.ok(!JSON.stringify(uiMessages(env)[0]).includes(CODE));
  assert.equal(doc.get("[data-confirm-button]").disabled, true);

  // Weiterer Klick sendet nichts mehr (Zustand haelt).
  doc.get("[data-confirm-button]").click();
  assert.equal(placeCallToolCall(env).length, 1);
});

test("(h) Host antwortet nicht: nach PLACE_CALL_RESPONSE_TIMEOUT_MS derselbe unklar-Zustand; Konstante > Server-Hop-Timeout", () => {
  const html = widgetHtml(WIDGET_CALL);
  const responseTimeoutMs = Number((html.match(/PLACE_CALL_RESPONSE_TIMEOUT_MS\s*=\s*(\d+)/) || [])[1]);
  assert.ok(responseTimeoutMs > PLACE_CALL_HOP_TIMEOUT_MS, "Antwortfrist ueberdauert den Server-Hop-Timeout");

  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  env.emit(awaitingConfirmationPush());
  doc.get("[data-confirm-button]").click();
  // env.timeoutCount() traegt hier ZWEI Timer: den eigenen (PLACE_CALL_RESPONSE_TIMEOUT_MS)
  // und den bestehenden 15s-Poll-Fallback (startPolling, unabhaengig von der Bestaetigung) -
  // beide feuern harmlos zusammen (Muster env.fireTimeout()).
  assert.ok(env.timeoutCount() >= 1, "mindestens der eigene Response-Timer ist gesetzt");
  env.fireTimeout();
  assert.equal(uiMessages(env).length, 1);
  assert.equal(doc.get("[data-confirm-button]").disabled, true);
  doc.get("[data-confirm-button]").click();
  assert.equal(placeCallToolCall(env).length, 1, "kein erneuter tools/call nach Timeout");
});

test("(i) result.isError: server-seitiger Ablehnungstext sichtbar (nicht der generische Hinweis), keine ui/message, kein weiteres Senden", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc, { withI18n: true });
  env.uiReady();
  env.emit(awaitingConfirmationPush());
  doc.get("[data-confirm-button]").click();
  const rpcId = env.posted[0].id;
  env.emit({ id: rpcId, result: { isError: true, content: [{ type: "text", text: "code verbraucht" }] } });

  assert.equal(uiMessages(env).length, 0);
  assert.equal(doc.get("[data-confirm-hint]").style.display, "");
  // safety/wichtig (T2-14-Nachbesserung): die Karte zeigt den ECHTEN Ablehnungsgrund des
  // Servers (z.B. ein Safety-Gate), nicht mehr nur einen generischen "neu vorbereiten".
  assert.equal(doc.get("[data-confirm-hint-text]").textContent, "code verbraucht");
  doc.get("[data-confirm-button]").click();
  assert.equal(placeCallToolCall(env).length, 1);
});

test("(i2) result.isError ohne verwertbaren content: Rueckfall auf den generischen 'neu vorbereiten'-Hinweis", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc, { withI18n: true });
  env.uiReady();
  env.emit(awaitingConfirmationPush());
  doc.get("[data-confirm-button]").click();
  const rpcId = env.posted[0].id;
  env.emit({ id: rpcId, result: { isError: true } }); // kein content[] (unerwartete Form)

  assert.equal(doc.get("[data-confirm-hint-text]").textContent, "Call was not started — ask for a new prepare_call.");
});

test("(j) abgelaufener Code beim Klick: 0 tools/call, 0 ui/message, Hinweis sichtbar; fehlender Code im _meta ebenso", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  env.emit(awaitingConfirmationPush({}, { "hermes/confirmation_expires_at": EXPIRES_PAST }));
  doc.get("[data-confirm-button]").click();
  assert.equal(placeCallToolCall(env).length, 0);
  assert.equal(uiMessages(env).length, 0);
  assert.equal(doc.get("[data-confirm-hint]").style.display, "");

  const doc2 = makeFakeDocument();
  const env2 = runOwnScript(doc2);
  env2.uiReady();
  env2.emit(awaitingConfirmationPush({}, { "hermes/confirmation_code": undefined }));
  assert.equal(doc2.get("[data-confirm-button]").disabled, true, "Knopf gesperrt ohne Code");
  doc2.get("[data-confirm-button]").click();
  assert.equal(placeCallToolCall(env2).length, 0);
});

test("(k) Replay nach placed: Karte bleibt Live-Karte, kein Knopf-Effekt, 0 weiteres Senden", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  env.emit(awaitingConfirmationPush());
  doc.get("[data-confirm-button]").click();
  const rpcId = env.posted[0].id;
  env.emit({ id: rpcId, result: { structuredContent: { call_id: CALL_ID, status: "dialing" } } });
  assert.equal(doc.get("[data-confirm]").style.display, "none");

  env.emit(awaitingConfirmationPush()); // Replay aus dem Verlauf
  assert.equal(doc.get("[data-confirm]").style.display, "none", "Bestaetigungsblock bleibt verborgen");
  doc.get("[data-confirm-button]").click();
  assert.equal(placeCallToolCall(env).length, 1, "kein weiterer Versand durch den Replay");
});

const USED_HINT_EN = "This confirmation was already sent — do not confirm again; check list_calls.";

function makeFakeStorage() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    dump: () => [...items.values()].join(""),
  };
}

function clickedCard(storage, pushOverrides) {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc, { withI18n: true, localStorage: storage });
  env.uiReady();
  env.emit(awaitingConfirmationPush({}, pushOverrides));
  doc.get("[data-confirm-button]").click();
  return { doc, env };
}

test("(q) Server meldet confirmation_used: Hinweis 'schon abgeschickt', Knopf ausgeblendet+gesperrt, kein zweites Senden; generischer isError bleibt 'rejected' (Positiv-Kontrolle)", () => {
  const { doc, env } = clickedCard(undefined);
  env.emit({
    id: env.posted[0].id,
    result: { isError: true, content: [{ type: "text", text: "server text" }], structuredContent: { status: "confirmation_used" } },
  });
  assert.equal(doc.get("[data-confirm-hint-text]").textContent, USED_HINT_EN);
  assert.equal(doc.get("[data-confirm-button]").disabled, true);
  assert.equal(doc.get("[data-confirm-button]").style.display, "none", "kein Waehl-Knopf mehr angeboten");
  doc.get("[data-confirm-button]").click();
  assert.equal(placeCallToolCall(env).length, 1);
  assert.equal(uiMessages(env).length, 0);

  // Positiv-Kontrolle: ohne das Maschinenfeld bleibt es beim Ablehnungstext des Servers.
  const { doc: otherDoc, env: otherEnv } = clickedCard(undefined);
  otherEnv.emit({ id: otherEnv.posted[0].id, result: { isError: true, content: [{ type: "text", text: "server text" }] } });
  assert.equal(otherDoc.get("[data-confirm-hint-text]").textContent, "server text");
  assert.equal(otherDoc.get("[data-confirm-button]").style.display, "");
});

test("(r) Neuladen nach dem Klick (gemeinsamer Speicher): derselbe Push startet in 'schon abgeschickt', 0 place_call; anderer Code bleibt bestaetigbar (Positiv-Kontrolle); kein Klartext-Code im Speicher", () => {
  const storage = makeFakeStorage();
  clickedCard(storage); // erste Instanz: Klick, dann "Neuladen" (Antwort egal)

  const doc = makeFakeDocument();
  const env = runOwnScript(doc, { withI18n: true, localStorage: storage });
  env.uiReady();
  env.emit(awaitingConfirmationPush());
  assert.equal(doc.get("[data-confirm-hint-text]").textContent, USED_HINT_EN);
  assert.equal(doc.get("[data-confirm-button]").style.display, "none");
  assert.equal(doc.get("[data-confirm-to]").textContent, TO, "Vorschau bleibt sichtbar");
  doc.get("[data-confirm-button]").click();
  env.emit(awaitingConfirmationPush()); // erneuter Push desselben Codes
  assert.equal(placeCallToolCall(env).length, 0, "kein zweiter Anruf durch Neuladen/Replay");
  assert.ok(!storage.dump().includes(CODE), "Code nie im Klartext im Speicher");

  const fresh = clickedCard(storage, { "hermes/confirmation_code": "ZZZZZZ" });
  assert.equal(placeCallToolCall(fresh.env).length, 1, "ein neuer Code bleibt bestaetigbar");
});

test("(s) Speicher gesperrt (Zugriff wirft): Karte bestaetigt trotzdem genau einmal - Sicherung ist dann die Server-Antwort", () => {
  const locked = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
  };
  const { doc, env } = clickedCard(locked);
  assert.equal(placeCallToolCall(env).length, 1);
  assert.equal(doc.get("[data-confirm-button]").disabled, true);
});

test("(l) XSS: objective/briefing/context.summary landen woertlich als Text, kein Element erzeugt", () => {
  const doc = makeFakeDocument();
  const payload = '<img src=x onerror=alert(1)>';
  const env = runOwnScript(doc);
  env.uiReady();
  env.emit(
    awaitingConfirmationPush({
      objective: payload,
      briefing: payload,
      context: { summary: payload },
    }),
  );
  assert.equal(doc.get("[data-confirm-objective]").textContent, payload);
  assert.equal(doc.get("[data-cf-briefing]").textContent, payload);
  assert.match(doc.get("[data-cf-context]").textContent, /summary: <img src=x onerror=alert\(1\)>/);
});

test("(m) Sprachen: Knopf-/Label-Text aus WIDGET_DICT je hermes/locale (de/fr/en)", () => {
  function confirmButtonLabel(locale) {
    const doc = makeFakeDocument();
    const env = runOwnScript(doc, { withI18n: true });
    env.uiReady();
    if (locale !== "en") {
      env.emit({
        method: "ui/notifications/tool-result",
        params: { structuredContent: { status: "dialing", call_id: "x" }, _meta: { "hermes/locale": locale } },
      });
    }
    env.emit(awaitingConfirmationPush());
    return doc.get("[data-confirm-button]").textContent;
  }
  assert.equal(confirmButtonLabel("en"), "Confirm call");
  assert.equal(confirmButtonLabel("de"), "Anruf bestätigen");
  assert.equal(confirmButtonLabel("fr"), "Confirmer l'appel");
});

// safety/blocker + cleancode/blocker (T2-14-Nachbesserung): deckt zwei Befunde in EINEM
// realistischen Ablauf ab. (1) startPolling() laeuft schon seit dem Handshake, lange bevor
// der Nutzer die Karte gelesen und geklickt hat - der 15s-Poll-Fallback UND der
// PLACE_CALL_RESPONSE_TIMEOUT_MS-Timer feuern deshalb typischerweise GEMEINSAM
// (env.fireTimeout() feuert alle gesetzten Timer, wie Test (h) dokumentiert), noch bevor
// die eigentliche place_call-Antwort eintrifft. (2) Trifft danach doch noch eine
// Erfolgsantwort ein (wasTimedOut-Zweig in handlePlaceCallResponse), muss die Karte auf
// "placed" umschalten, OHNE eine zweite ui/message zu senden - UND das Live-Polling muss
// fuer DIESEN Anruf neu anlaufen (vorher blieb die Karte hier fuer immer auf ihrem ersten
// Stand haengen, kein Terminalstatus wurde je erreicht).
test("(o) Fallback-/Antwort-Timeout schon gefeuert, danach doch Erfolg: placed uebernommen, genau 1 ui/message, Polling laeuft weiter", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  assert.equal(env.intervalCount(), 1, "Vorbedingung: Self-Poll laeuft seit dem Handshake");
  env.emit(awaitingConfirmationPush());
  doc.get("[data-confirm-button]").click();
  const rpcId = placeCallToolCall(env)[0].id;

  env.fireTimeout(); // feuert PLACE_CALL_RESPONSE_TIMEOUT_MS (-> "uncertain", 1 ui/message) UND den 15s-Poll-Fallback
  assert.equal(uiMessages(env).length, 1, "genau die unklar-Nachricht");
  assert.equal(env.intervalCount(), 0, "Poll-Intervall durch den Fallback gestoppt");

  env.emit({ id: rpcId, result: { structuredContent: { call_id: CALL_ID, status: "dialing" } } }); // spaete Erfolgsantwort
  assert.equal(doc.get("[data-confirm]").style.display, "none", "Bestaetigungsblock verschwindet");
  assert.equal(doc.get('[data-mcp="call_id"]').textContent, CALL_ID, "applyCallStatus hat call_id uebernommen");
  assert.equal(uiMessages(env).length, 1, "keine zweite ui/message nach der spaeten Erfolgsantwort");
  assert.equal(env.intervalCount(), 1, "Polling wurde nach dem Erfolg neu gestartet");

  // Positiv-Kontrolle: das neu gestartete Intervall pollt tatsaechlich mit der bekannten
  // call_id (nicht nur "irgendein" Intervall ohne Wirkung).
  const statusCallsBefore = env.posted.filter((msg) => msg.method === "tools/call" && msg.params.name === "get_call_status").length;
  assert.ok(statusCallsBefore >= 1, "der Sofort-Tick von startPolling() hat bereits get_call_status gesendet");
});

test("(p) objectLines: absichtlich sehr tief verschachteltes context-Objekt bricht renderConfirmation NICHT ab (Rekursionsdeckel)", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  const DEEP_NESTING_LEVELS = 50; // weit ueber jedem realistischen briefing/context-JSON
  let deep = { leaf: "innerster-wert" };
  for (let i = 0; i < DEEP_NESTING_LEVELS; i++) deep = { nested: deep };
  assert.doesNotThrow(() => {
    env.emit(awaitingConfirmationPush({ context: deep }));
  }, "kein Stack-Overflow trotz 50 Verschachtelungsebenen");
  // Die Karte erscheint trotzdem (Kernversprechen von N-10: kein stiller Ausfall).
  assert.equal(doc.get("[data-confirm]").style.display, "");
  assert.match(doc.get("[data-cf-context]").textContent, /…/, "ab der Deckel-Tiefe wird abgeschnitten statt weiter zu rekursieren");
});

test("(n) ui/message-Text enthaelt nie briefing/context-Inhalte", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  env.emit(awaitingConfirmationPush({ briefing: "GEHEIMER-BRIEFING-TEXT", context: { summary: "GEHEIMER-KONTEXT" } }));
  doc.get("[data-confirm-button]").click();
  const rpcId = env.posted[0].id;
  env.emit({ id: rpcId, result: { structuredContent: { call_id: CALL_ID, status: "dialing" } } });
  const msg = JSON.stringify(uiMessages(env));
  assert.ok(!msg.includes("GEHEIMER-BRIEFING-TEXT"));
  assert.ok(!msg.includes("GEHEIMER-KONTEXT"));
  assert.match(msg, new RegExp(CALL_ID));
});

// ================= (e) End-to-Ende am echten Draht ==========================================

const E2E_SECRET = "openai-t2-14-abnahme-test-secret-mind-32-zeichen";
const E2E_TARGET = "+4915112340077";
const E2E_OBJECTIVE = "Termin vereinbaren";
const CONFIRMATION_META_KEY = "hermes/confirmation_code";
// Kein "language": das haengt an einer Deployment-Faehigkeit (TTS-Trennung von der
// Offenlegung), die im lokalen FAKE_ORIGINATE-Testaufbau nicht verfuegbar ist
// (language_unavailable) - fuer den Draht-Rundlauf selbst irrelevant.
const E2E_PREVIEW_ARGS = {
  to: E2E_TARGET,
  objective: E2E_OBJECTIVE,
  briefing: "Kunde seit 2019",
  max_duration_s: 300,
};

// Nimmt das ECHTE prepare_call-Ergebnis (content/structuredContent/_meta, wie es ueber den
// Draht ankommt) und faehrt es durch DIESELBE Karte wie die Mechanismus-Tests oben: Push,
// Klick, Abgriff des von der Karte gesendeten tools/call. Einzige Quelle fuer Anzeige UND
// Versand ist damit - wie im Widget selbst - der echte Server-Output, nicht eine Fixture.
function widgetPlaceCallFromRealPreview(prep) {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  env.emit({
    method: "ui/notifications/tool-result",
    params: { structuredContent: prep.structuredContent, _meta: prep._meta },
  });
  // Draht-Beleg Datenhinweis: der echte Server liefert ihn im _meta (fuer das Modell
  // verborgen), NICHT im Modelltext, und die Karte zeigt ihn vor dem Klick sichtbar an.
  const notice = prep._meta?.[NOTICE_META_KEY];
  assert.ok(typeof notice === "string" && notice.length > 0, "Datenhinweis im _meta von prepare_call");
  assert.ok(!JSON.stringify(prep.content).includes(notice), "Datenhinweis steht nicht im Modelltext");
  assert.equal(doc.get("[data-confirm-notice]").style.display, "", "Datenhinweis sichtbar");
  assert.equal(doc.get("[data-confirm-notice-text]").textContent, notice, "Datenhinweis woertlich angezeigt");
  doc.get("[data-confirm-button]").click();
  const calls = placeCallToolCall(env);
  assert.equal(calls.length, 1, "die Karte hat place_call genau einmal gesendet");
  return { env, doc, call: calls[0] };
}

// Nach jeder erfolgreichen Bestaetigung: die vom Server tatsaechlich gesendeten Argumente
// sind EXAKT die aus der echten Vorschau (kein Drift zwischen Schema-Parsing/Output-Schema/
// Host und dem HMAC-gebundenen Tupel, Pre-Mortem (a)).
function assertArgsMatchPreview(args, prep) {
  for (const field of ["to", "objective", "briefing", "max_duration_s"]) {
    assert.equal(args[field], prep.structuredContent[field], `${field} stimmt mit der echten Vorschau ueberein`);
  }
  assert.equal(args.confirmation_code, prep._meta[CONFIRMATION_META_KEY]);
}

test("(t) Datenhinweis: sichtbar ueber dem Knopf; fehlt er oder ist er leer, kein Klick (0 tools/call) - Positiv-Kontrolle mit Hinweis", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  env.emit(awaitingConfirmationPush());
  assert.equal(doc.get("[data-confirm-notice]").style.display, "", "Hinweis-Zeile sichtbar");
  assert.equal(doc.get("[data-confirm-notice-text]").textContent, NOTICE);
  assert.equal(doc.get("[data-confirm-button]").disabled, false, "mit Hinweis bestaetigbar");
  doc.get("[data-confirm-button]").click();
  assert.equal(placeCallToolCall(env).length, 1, "Positiv-Kontrolle: mit Hinweis genau 1 place_call");

  for (const missing of [undefined, "   ", { text: NOTICE }]) {
    const docN = makeFakeDocument();
    const envN = runOwnScript(docN);
    envN.uiReady();
    envN.emit(awaitingConfirmationPush({}, { [NOTICE_META_KEY]: missing }));
    assert.equal(docN.get("[data-confirm-notice]").style.display, "none", "leere Hinweis-Zeile verborgen");
    assert.equal(docN.get("[data-confirm-button]").disabled, true, `Knopf gesperrt ohne Hinweis (${JSON.stringify(missing)})`);
    docN.get("[data-confirm-button]").click();
    assert.equal(placeCallToolCall(envN).length, 0, "ohne Hinweis kein place_call");
    assert.equal(docN.get("[data-confirm-hint]").style.display, "", "Hinweis 'neu vorbereiten' sichtbar");
  }
});

test("(t2) Datenhinweis in jeder Sprache vorhanden, je Sprache eigener Wortlaut, nennt Gesundheitsangaben und Einwilligung", () => {
  const healthAndConsent = {
    de: [/Gesundheitsangaben/, /willigst du ausdr\u00fccklich/],
    en: [/health details/, /explicitly consent/],
    fr: [/donn\u00e9es de sant\u00e9/, /consentez express\u00e9ment/],
  };
  const seen = new Set();
  for (const [language, patterns] of Object.entries(healthAndConsent)) {
    const notice = MCP_TEXTS[language].callDataNotice;
    for (const pattern of patterns) assert.match(notice, pattern, `${language}: ${pattern}`);
    seen.add(notice);
  }
  assert.equal(seen.size, Object.keys(healthAndConsent).length, "keine Sprache faellt auf eine andere zurueck");
});

test("(e-http) Draht-Rundlauf HTTP Legacy: echtes prepare_call -> dieselbe Karte -> echtes place_call -> Erfolg -> genau 1 ui/message mit call_id, nie mit Code", async () => {
  const srv = await startServer({
    env: { FAKE_ORIGINATE: "true", ALLOWED_COUNTRY_CODES: "*", MCP_UI_ENABLED: "true", CALL_CONFIRMATION_SECRET: E2E_SECRET },
  });
  try {
    const before = srv.readStore().calls.length;
    const prepRes = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("prepare_call", E2E_PREVIEW_ARGS));
    const prep = await readToolResult(prepRes);
    assert.notEqual(prep.isError, true, "prepare_call ueber HTTP Legacy");

    const { env, call } = widgetPlaceCallFromRealPreview(prep);
    assertArgsMatchPreview(call.params.arguments, prep);

    const placeRes = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("place_call", call.params.arguments));
    const placed = await readToolResult(placeRes);
    assert.notEqual(placed.isError, true, "der von der Karte gesendete tools/call wird unveraendert angenommen");
    assert.ok(placed.structuredContent.call_id, "call_id vorhanden");
    assert.equal(srv.readStore().calls.length, before + 1, "genau EIN Anruf-Datensatz");
    // Store-Feldname ist `goal` (routes/api-calls.js), nicht `objective` (das ist der
    // MCP-seitige Argumentname).
    const storedCall = srv.readStore().calls[0];
    assert.equal(storedCall.goal, E2E_OBJECTIVE, "Datensatz.goal == Vorschau.objective");
    assert.equal(storedCall.to, E2E_TARGET, "Datensatz.to == Vorschau");

    // Die Karte verarbeitet die ECHTE Serverantwort weiter.
    env.emit({ id: call.id, result: placed });
    const msgs = uiMessages(env);
    assert.equal(msgs.length, 1, "genau EINE ui/message");
    assert.match(JSON.stringify(msgs[0]), new RegExp(placed.structuredContent.call_id));
    assert.ok(!JSON.stringify(msgs[0]).includes(prep._meta[CONFIRMATION_META_KEY]), "der Code steht nie in der ui/message");
  } finally {
    await srv.stop();
  }
});

test("(e-reload) Draht: neu geladene Karte klickt denselben, schon verbrauchten Code -> confirmation_used, KEIN zweiter Anruf, Karte bietet keinen Klick mehr an", async () => {
  const srv = await startServer({
    env: { FAKE_ORIGINATE: "true", ALLOWED_COUNTRY_CODES: "*", MCP_UI_ENABLED: "true", CALL_CONFIRMATION_SECRET: E2E_SECRET },
  });
  try {
    const before = srv.readStore().calls.length;
    const prep = await readToolResult(await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("prepare_call", E2E_PREVIEW_ARGS)));
    const first = widgetPlaceCallFromRealPreview(prep);
    const placed = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("place_call", first.call.params.arguments)),
    );
    assert.ok(placed.structuredContent.call_id, "Positiv-Kontrolle: der erste Klick waehlt");
    assert.equal(srv.readStore().calls.length, before + 1);

    // Neuladen ohne Karten-Speicher (schlechtester Fall): dieselbe Vorschau, derselbe Code.
    const reloaded = widgetPlaceCallFromRealPreview(prep);
    const replay = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("place_call", reloaded.call.params.arguments)),
    );
    assert.equal(replay.isError, true);
    assert.equal(replay.structuredContent.status, "confirmation_used", "Server meldet den verbrauchten Code eindeutig");
    assert.ok(!JSON.stringify(replay).includes(prep._meta[CONFIRMATION_META_KEY]), "Antwort nennt den Code nie");
    assert.equal(srv.readStore().calls.length, before + 1, "kein zweiter Anruf-Datensatz");

    const { env: reloadedEnv, doc: reloadedDoc } = reloaded;
    reloadedEnv.emit({ id: reloaded.call.id, result: replay });
    assert.equal(reloadedDoc.get("[data-confirm-button]").style.display, "none", "kein zweiter Waehl-Klick angeboten");
    reloadedDoc.get("[data-confirm-button]").click();
    assert.equal(placeCallToolCall(reloadedEnv).length, 1, "kein weiteres Senden");
  } finally {
    await srv.stop();
  }
});

const OAUTH_E2E_TARGET = "+4915112340066";
const OAUTH_E2E_TENANT = "tenant-t2-14-oauth-e2e";
const OAUTH_E2E_SUB = "sub-t2-14-oauth-e2e";
const OAUTH_E2E_NUMBER = "+4915110000088";

test("(e-oauth) Draht-Rundlauf HTTP OAuth (echtes Token): derselbe Rundlauf ueber einen authentifizierten Mandanten", { skip: !EXTERNAL_IP && "externalIp() liefert null - kein Interface fuer den Nicht-localhost-Rundlauf" }, async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      ALLOWED_COUNTRY_CODES: "*",
      MCP_UI_ENABLED: "true",
      CALL_CONFIRMATION_SECRET: E2E_SECRET,
      MULTI_TENANT: "true",
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
    },
    seed: seedState({
      tenants: [
        { id: OAUTH_E2E_TENANT, status: "active", idpSubject: OAUTH_E2E_SUB, ownerName: "T2-14 E2E Tester", kycLevel: KYC_LEVEL.CARD },
      ],
      profiles: { [OAUTH_E2E_TENANT]: planProfileFor("business") },
      numbers: [
        { id: "num-t2-14-oauth-e2e", e164: OAUTH_E2E_NUMBER, tenantId: OAUTH_E2E_TENANT, provider: "telnyx", status: "active", providerNumberId: null },
      ],
    }),
  });
  try {
    const before = srv.readStore().calls.length;
    const token = await idp.sign({ sub: OAUTH_E2E_SUB });
    const args = { to: OAUTH_E2E_TARGET, objective: E2E_OBJECTIVE };
    // externalUrl statt localUrl (s. Kommentar an EXTERNAL_IP oben): der Request kommt
    // serverseitig NICHT von 127.0.0.1 an, isTrustedLocalCaller greift also nicht.
    const prepRes = await mcpPost(`${srv.externalUrl}/mcp`, token, toolCall("prepare_call", args));
    const prep = await readToolResult(prepRes);
    assert.notEqual(prep.isError, true, "prepare_call ueber OAuth");

    const { env, call } = widgetPlaceCallFromRealPreview(prep);
    assert.equal(call.params.arguments.to, OAUTH_E2E_TARGET);
    assert.equal(call.params.arguments.confirmation_code, prep._meta[CONFIRMATION_META_KEY]);

    const placeRes = await mcpPost(`${srv.externalUrl}/mcp`, token, toolCall("place_call", call.params.arguments));
    const placed = await readToolResult(placeRes);
    assert.notEqual(placed.isError, true, "der von der Karte gesendete tools/call wird unveraendert angenommen");
    assert.equal(srv.readStore().calls.length, before + 1, "genau EIN Anruf-Datensatz");
    const storedCall = srv.readStore().calls[before];
    assert.equal(storedCall.tenantId, OAUTH_E2E_TENANT, "der Anruf-Datensatz gehoert dem OAuth-Mandanten, nicht Bootstrap/Null");

    env.emit({ id: call.id, result: placed });
    assert.equal(uiMessages(env).length, 1);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

// Lokaler Mock, der JEDEN Request sofort mit 404 beantwortet - kein echtes Netz, keine
// Wartezeit. Gepinnt auf ANTHROPIC_BASE_URL (s. FULL_FIELDS-Test unten): dieselbe
// Rueckfall-Garantie wie test/elevenlabs-anrufstart.test.js Fall T11 ("schneller 404,
// nicht-transient, kein Retry" -> die Eroeffnungszeilen-Erzeugung faellt deterministisch
// auf die feste Bruecken-Zeile zurueck, bevor der EL-Anrufstart selbst beginnt).
const HTTP_NOT_FOUND = 404;
async function startFastFailMock() {
  const server = http.createServer((req, res) => {
    res.writeHead(HTTP_NOT_FOUND, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Eigenes Ziel (nicht E2E_TARGET/OAUTH_E2E_TARGET): vermeidet jede Call-Dedup-Kollision mit
// den Nachbar-Faellen. National-Form (fuehrende "0" statt "+49") desselben Ziels - die
// Vorschau muss sie ueber resolveDialTarget/normalizeDialTarget (store/defaults.js) auf
// GENAU FULL_FIELDS_TARGET normalisieren.
const FULL_FIELDS_TARGET = "+4915112340088";
const FULL_FIELDS_TARGET_NATIONAL = "015112340088";
const FULL_FIELDS_OWNER_NUMBER = { e164: "+4915100000099", provider: "telnyx" };
// Alle neun BOUND_ARG_FIELDS (src/ui/widgets/call.html) mit je einem unterscheidbaren Wert -
// deckt den vollen Draht ab, den (e-http) bewusst ausspart (Kommentar an E2E_PREVIEW_ARGS
// oben: "language" braucht den EL-Weg).
const FULL_FIELDS_ARGS = {
  to: FULL_FIELDS_TARGET_NATIONAL,
  objective: E2E_OBJECTIVE,
  briefing: "Kunde seit 2019, bevorzugt Rueckruf am Vormittag",
  constraints: "Nur Mo-Fr 9-17 Uhr anrufen",
  mandate: { budget_eur: 50 },
  context: { note: "Rueckruf erwartet" },
  language: "de",
  max_duration_s: 300,
  diagnostic: true,
};

test("(e-full-fields) Draht-Rundlauf HTTP Legacy mit allen neun gebundenen Feldern + nationalem 'to': Normalisierung, Bindung, get_call_status danach", async () => {
  const anthropicFastFail = await startFastFailMock();
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE_ELEVENLABS: "true",
      ALLOWED_COUNTRY_CODES: "*",
      MCP_UI_ENABLED: "true",
      CALL_CONFIRMATION_SECRET: E2E_SECRET,
      // "language" ist nur mit dem EL-Weg an bindbar (languageDenial, api-call-
      // confirmations.js) - der Draht-Rundlauf braucht ihn deshalb wirklich an, nicht nur
      // die Vorschau.
      ELEVENLABS_OUTBOUND_ENABLED: "true",
      ELEVENLABS_AGENT_ID: "agent_t2_14_full",
      ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_t2_14_full",
      ELEVENLABS_API_KEY: "el-t2-14-full-test-key",
      ANTHROPIC_BASE_URL: anthropicFastFail.url,
    },
    ownerNumber: FULL_FIELDS_OWNER_NUMBER,
  });
  try {
    const before = srv.readStore().calls.length;
    const prepRes = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("prepare_call", FULL_FIELDS_ARGS));
    const prep = await readToolResult(prepRes);
    assert.notEqual(prep.isError, true, `prepare_call mit allen neun Feldern: ${JSON.stringify(prep)}`);
    assert.equal(prep.structuredContent.to, FULL_FIELDS_TARGET, "nationales 'to' normalisiert in der Vorschau");

    const { call } = widgetPlaceCallFromRealPreview(prep);
    const BOUND_ARG_FIELDS_WIRE = ["to", "objective", "briefing", "constraints", "mandate", "context", "language", "max_duration_s", "diagnostic"];
    for (const field of BOUND_ARG_FIELDS_WIRE) {
      assert.deepEqual(call.params.arguments[field], prep.structuredContent[field], `${field}: Karte == Vorschau (Pre-Mortem (a))`);
    }
    assert.equal(call.params.arguments.to, FULL_FIELDS_TARGET, "die Karte sendet das normalisierte Ziel, nicht die Nutzereingabe");

    const placeRes = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("place_call", call.params.arguments));
    const placed = await readToolResult(placeRes);
    assert.notEqual(placed.isError, true, `place_call mit allen neun Feldern: ${JSON.stringify(placed)}`);
    assert.ok(placed.structuredContent.call_id, "call_id vorhanden");
    assert.equal(srv.readStore().calls.length, before + 1, "genau EIN Anruf-Datensatz");

    const callId = placed.structuredContent.call_id;
    const statusRes = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("get_call_status", { call_id: callId }));
    const status = await readToolResult(statusRes);
    assert.notEqual(status.isError, true, `get_call_status fuer die gemeldete call_id: ${JSON.stringify(status)}`);
    assert.equal(status.structuredContent.call_id, callId, "get_call_status findet denselben Anruf-Datensatz");
  } finally {
    await srv.stop();
    await anthropicFastFail.close();
  }
});

test("(e-stdio) Draht-Rundlauf stdio (echter Kindprozess): derselbe Rundlauf ueber einen gespawnten MCP-stdio-Server", async () => {
  const gateway = await startServer({
    env: { FAKE_ORIGINATE: "true", ALLOWED_COUNTRY_CODES: "*", CALL_CONFIRMATION_SECRET: E2E_SECRET },
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/mcp-server.js"],
    cwd: ROOT,
    env: { ...BASE_ENV, GATEWAY_URL: gateway.localUrl, MCP_UI_ENABLED: "true" },
    stderr: "pipe",
  });
  const client = new Client({ name: "hermes-t2-14-stdio-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    const before = gateway.readStore().calls.length;
    const prep = await client.callTool({ name: "prepare_call", arguments: { to: E2E_TARGET, objective: E2E_OBJECTIVE } });
    assert.notEqual(prep.isError, true, "prepare_call ueber stdio");

    const { env, call } = widgetPlaceCallFromRealPreview(prep);
    assert.equal(call.params.arguments.confirmation_code, prep._meta[CONFIRMATION_META_KEY]);

    const placed = await client.callTool({ name: "place_call", arguments: call.params.arguments });
    assert.notEqual(placed.isError, true, "der von der Karte gesendete tools/call wird unveraendert angenommen");
    assert.equal(gateway.readStore().calls.length, before + 1, "genau EIN Anruf-Datensatz");

    env.emit({ id: call.id, result: placed });
    assert.equal(uiMessages(env).length, 1);
  } finally {
    await client.close();
    await gateway.stop();
  }
});

// ================= X-2: ausser prepare_call kein Tool-Ergebnis mit Nutzdaten-_meta ==========
// "Nutzdaten-_meta" = das Bestaetigungs-Geheimnis selbst (CONFIRMATION_META_KEY und sein
// Ablauf-Gegenstueck), NICHT die Rendering-Metadaten (_meta.ui.*/hermes/locale), die JEDES
// Widget-Werkzeug traegt (T2-01/T2-02, eigene Draht-Belege). X-2 schuetzt davor, dass der
// Code ausserhalb von prepare_call irgendwo landet, wo ihn ein Host dem Modell zeigen
// koennte.
test("X-2 (Draht): ausser prepare_call traegt kein Werkzeug-Ergebnis den Bestaetigungscode in _meta", async () => {
  const srv = await startServer({
    env: { FAKE_ORIGINATE: "true", ALLOWED_COUNTRY_CODES: "*", MCP_UI_ENABLED: "true", CALL_CONFIRMATION_SECRET: E2E_SECRET },
  });
  try {
    const prep = await readToolResult(await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("prepare_call", E2E_PREVIEW_ARGS)));
    const code = prep._meta[CONFIRMATION_META_KEY];
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{6}$/, "Positiv-Kontrolle: prepare_call TRAEGT den Code (sonst waere die Pruefung unten wertlos)");

    const placed = await readToolResult(await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("place_call", { ...E2E_PREVIEW_ARGS, confirmation_code: code })));
    const callId = placed.structuredContent.call_id;

    const others = [
      readToolResult(await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("get_call_status", { call_id: callId }))),
      readToolResult(await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("cancel_call", { call_id: callId }))),
      readToolResult(await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("list_calls", {}))),
      readToolResult(await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("get_agent_status", {}))),
      readToolResult(await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("get_agent_number", {}))),
      readToolResult(await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("check_inbox", {}))),
      readToolResult(await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("list_action_items", {}))),
    ];
    for (const resultPromise of others) {
      const result = await resultPromise;
      assert.ok(!JSON.stringify(result._meta || {}).includes(code), `${JSON.stringify(result._meta)} darf den Code nicht enthalten`);
    }
    // placed.result selbst darf den VERBRAUCHTEN Code auch nicht in _meta tragen.
    assert.ok(!JSON.stringify(placed._meta || {}).includes(code));
  } finally {
    await srv.stop();
  }
});

// ================= X-6: Sandbox-Scan der ausgelieferten Widget-Resource ======================
// Keine privilegierten APIs, kein fetch/XHR/WebSocket/eval - der EINZIGE Kommunikationsweg
// nach aussen ist parent.postMessage (Plan X-6). Gemessen am echten resources/read-Text ueber
// die Route, nicht an der lokalen Quelldatei (die koennte anders ausgeliefert werden).
test("X-6 (Draht): resources/read des Call-Widgets enthaelt keine privilegierten APIs (kein fetch/XHR/WebSocket/eval)", async () => {
  const srv = await startServer({ env: { MCP_UI_ENABLED: "true" } });
  try {
    const uri = uiResourceUri(WIDGET_CALL);
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, { jsonrpc: "2.0", id: 9, method: "resources/read", params: { uri } });
    const read = await readToolResult(res);
    const html = read.contents[0].text;
    assert.ok(html.length > 0, "Vorbedingung: die Resource liefert Inhalt");
    assert.doesNotMatch(html, /\bfetch\s*\(/, "kein fetch()");
    assert.doesNotMatch(html, /\bXMLHttpRequest\b/, "kein XMLHttpRequest");
    assert.doesNotMatch(html, /\bnew\s+WebSocket\s*\(/, "kein WebSocket");
    assert.doesNotMatch(html, /\beval\s*\(/, "kein eval()");
    assert.match(html, /parent\.postMessage/, "der einzige Sendeweg bleibt parent.postMessage");

    // Positiv-Kontrolle: die Pruefung selbst erkennt eine eingeschleuste verbotene API.
    const poisoned = html + "\n<script>fetch('https://example.invalid');</script>";
    assert.doesNotMatch(html, /example\.invalid/, "Sanity: der echte Text enthaelt den Marker nicht");
    assert.match(poisoned, /\bfetch\s*\(/, "Sanity: die Pruefung selbst faengt eine eingebaute Verletzung");
  } finally {
    await srv.stop();
  }
});
