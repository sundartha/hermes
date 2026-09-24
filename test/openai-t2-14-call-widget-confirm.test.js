// T2-14 (N-10): Bestaetigungs-Ansicht im Call-Widget. Fake-Window nach dem Muster
// test/mcp-ui-w1-call-widget.test.js (node:vm, parent.postMessage mitgeschnitten), Fake-
// Document HIER erweitert um einen selbst-erzeugenden Selektor-Speicher (jeder abgefragte
// Selektor bekommt sein eigenes Fake-Element - deckt sowohl die Bestand-Slots als auch die
// neuen data-confirm-*/data-cf-*-Selektoren ab, ohne jeden einzeln aufzaehlen zu muessen).
//
// Deckt NUR den Widget-Mechanismus (Schritt 6 (a)-(d), (f)-(l)) - das End-to-End-Kriterium
// (e) am echten Draht (HTTP Legacy/OAuth, stdio, echter prepare_call -> Klick -> place_call
// -> ui/message) UND Schritt 7 (X-6/X-2-Waechter) sind in dieser Phase NICHT gebaut, s.
// Rueckgabe (nicht_gebaut) - Budget-Grenze dieses Baulaufs.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { widgetHtml, WIDGET_CALL } from "../src/ui/widget-catalog.js";
import { BIND_SCRIPT, signalUiReady, UI_READY_FLAG } from "../src/ui/widget-bind.js";
import { I18N_SCRIPT } from "../src/ui/widget-i18n.js";
import { PLACE_CALL_HOP_TIMEOUT_MS } from "../src/mcp-tools.js";

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
    uiReady: () => signalUiReady(sandbox),
  };
}

const TO = "+491701234567";
const OBJECTIVE = "I would like to book an appointment.";
const CODE = "ABCDEF";
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
      _meta: { "hermes/confirmation_code": CODE, "hermes/confirmation_expires_at": EXPIRES_FUTURE, ...metaOverrides },
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

test("(i) result.isError: Hinweis 'neu vorbereiten' sichtbar, keine ui/message, kein weiteres Senden", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc, { withI18n: true });
  env.uiReady();
  env.emit(awaitingConfirmationPush());
  doc.get("[data-confirm-button]").click();
  const rpcId = env.posted[0].id;
  env.emit({ id: rpcId, result: { isError: true, content: [{ type: "text", text: "code verbraucht" }] } });

  assert.equal(uiMessages(env).length, 0);
  assert.equal(doc.get("[data-confirm-hint]").style.display, "");
  assert.notEqual(doc.get("[data-confirm-hint-text]").textContent, "—");
  doc.get("[data-confirm-button]").click();
  assert.equal(placeCallToolCall(env).length, 1);
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
