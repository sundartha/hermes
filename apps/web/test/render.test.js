// W4-Tests: die reinen Render-/Status-/Escaping-Helfer (lib/api.js) und der
// DOM-Bau (lib/render.js). Reine Logik, kein Browser-DOM: ein winziges Fake-
// `document` bildet exakt die im Bau genutzten DOM-Operationen nach
// (createElement, className, textContent, append, setAttribute,
// addEventListener). So laeuft alles mit node:test ohne Netz/DOM-Library.
//
// XSS-BELEG (Leitplanke): das Fake-Element wirft, sobald jemand innerHTML mit
// einem Wert setzt -> ein Test mit einem Tenant-String, der `<`, `"` und
// `<script>` enthaelt, belegt, dass der Wert ausschliesslich als textContent
// landet (kein roh-injizierter Tag/Attribut-Ausbruch).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AUTH_STATE,
  AUTH_EVENT,
  CALL_DIRECTION,
  callsFrom,
  isAgentLive,
  callCounterparty,
  callSubtitle,
  callStatusLabel,
  callStatusKind,
  transcriptFrom,
  isAgentTurn,
  turnRoleLabel,
  turnTimeLabel,
  callSummary,
} from "../src/lib/api.js";

import { callRows, bindList } from "../src/lib/render.js";

// ---- Fake-DOM ---------------------------------------------------------------
// Nur die Operationen, die lib/render.js wirklich nutzt. `innerHTML` ist eine
// Falle: ein Schreibzugriff wirft -> belegt, dass der Bau ihn nie nutzt.
class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.className = "";
    this.textContent = "";
    this.children = [];
    this.attrs = {};
    this.listeners = {};
  }
  set innerHTML(_value) {
    throw new Error("innerHTML darf nie gesetzt werden (XSS-Schutz, nur textContent)");
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  // Wie der echte DOM: ersetzt alle Kinder durch die uebergebenen (leer ->
  // Container geleert). bindList nutzt genau das.
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  addEventListener(type, handler) {
    (this.listeners[type] ??= []).push(handler);
  }
  click() {
    for (const handler of this.listeners.click || []) handler();
  }
  // Hilfs-Sicht fuer die Tests: der gesamte sichtbare Text dieses Teilbaums.
  // Ausgeblendete Knoten (hidden) tragen nichts zum sichtbaren Text bei --
  // spiegelt das echte DOM ([hidden] { display:none } in app.css).
  allText() {
    if (this.hidden) return "";
    return this.textContent + this.children.map((c) => c.allText()).join("");
  }
  // Hilfs-Sicht: existiert irgendwo im Teilbaum die gesuchte className?
  hasClass(name) {
    if (this.className.split(" ").includes(name)) return true;
    return this.children.some((c) => c.hasClass(name));
  }
  // Findet den ersten Nachfahren (oder sich selbst) mit der gesuchten className.
  find(name) {
    if (this.className.split(" ").includes(name)) return this;
    for (const child of this.children) {
      const hit = child.find(name);
      if (hit) return hit;
    }
    return undefined;
  }
}

const fakeDocument = {
  createElement: (tag) => new FakeElement(tag),
};

// Fake-Document fuer bindList: createElement + ein registriertes Element je id +
// ein AUTH_EVENT-Listener, den der Test selbst ausloesen kann (emit).
function makeBindDocument() {
  const elements = new Map();
  let handler = null;
  return {
    createElement: (tag) => new FakeElement(tag),
    register(id) {
      const node = new FakeElement("ul");
      elements.set(id, node);
      return node;
    },
    getElementById: (id) => elements.get(id),
    addEventListener: (name, fn) => {
      assert.equal(name, AUTH_EVENT);
      handler = fn;
    },
    emit(detail) {
      handler({ detail });
    },
  };
}

// Sammelt den gesamten Text einer Knoten-Liste (z.B. einer gerenderten Liste).
function textOf(nodes) {
  return nodes.map((n) => n.allText()).join("");
}

// ---- Listen-Extraktion (Contract-Grenze, fail-closed) -----------------------
test("callsFrom: leere Liste bei fehlenden/null Feldern", () => {
  for (const input of [undefined, null, {}, { calls: null }, { calls: "x" }]) {
    assert.deepEqual(callsFrom(input), []);
  }
  const calls = [{ direction: "inbound" }];
  assert.equal(callsFrom({ calls }), calls);
});

test("isAgentLive: true nur wenn mindestens ein Call aktiv ist", () => {
  assert.equal(isAgentLive({ calls: [{ status: "completed" }, { status: "active" }] }), true);
  assert.equal(isAgentLive({ calls: [{ status: "completed" }] }), false);
  assert.equal(isAgentLive({ calls: [] }), false);
  assert.equal(isAgentLive(null), false);
});

// ---- Call-Helfer ------------------------------------------------------------
test("callCounterparty: outbound -> to, inbound -> from, fehlend -> leer", () => {
  assert.equal(
    callCounterparty({ direction: CALL_DIRECTION.OUTBOUND, to: "+491", from: "+492" }),
    "+491",
  );
  assert.equal(
    callCounterparty({ direction: CALL_DIRECTION.INBOUND, to: "+491", from: "+492" }),
    "+492",
  );
  assert.equal(callCounterparty({ direction: CALL_DIRECTION.OUTBOUND }), "");
  assert.equal(callCounterparty(null), "");
});

test("callSubtitle: goal hat Vorrang, sonst richtungsabhaengiger Standardtext", () => {
  assert.equal(callSubtitle({ direction: "inbound", goal: "Rueckruf" }), "Rueckruf");
  assert.equal(callSubtitle({ direction: "inbound" }), "Inbound call");
  assert.equal(callSubtitle({ direction: "outbound" }), "Outbound call");
});

test("callStatusLabel/callStatusKind: bekannte Status + fail-closed auf failed", () => {
  assert.equal(callStatusLabel({ status: "active" }), "Live");
  assert.equal(callStatusLabel({ status: "completed" }), "Completed");
  assert.equal(callStatusLabel({ status: "cancelled" }), "Cancelled");
  assert.equal(callStatusLabel({ status: "failed" }), "Failed");
  // Unbekannter/fehlender Status -> Fehler-Beschriftung + Fehler-Klasse.
  assert.equal(callStatusLabel({ status: "weird" }), "Failed");
  assert.equal(callStatusLabel({}), "Failed");
  assert.equal(callStatusKind({ status: "active" }), "active");
  assert.equal(callStatusKind({ status: "weird" }), "failed");
});

// ---- Transkript-Helfer (W4b) -------------------------------------------------
test("transcriptFrom: leere Liste bei fehlendem/kein Array-Transkript", () => {
  assert.deepEqual(transcriptFrom({}), []);
  assert.deepEqual(transcriptFrom(null), []);
  assert.deepEqual(transcriptFrom({ transcript: "x" }), []);
  const transcript = [{ role: "agent", text: "Hallo", at: "2026-06-23T09:00:00.000Z" }];
  assert.equal(transcriptFrom({ transcript }), transcript);
});

test("isAgentTurn/turnRoleLabel: agent vs. Gegenstelle, fail-closed auf Counterparty", () => {
  assert.equal(isAgentTurn({ role: "agent" }), true);
  assert.equal(isAgentTurn({ role: "caller" }), false);
  assert.equal(isAgentTurn(null), false);
  assert.equal(turnRoleLabel({ role: "agent" }), "Agent");
  assert.equal(turnRoleLabel({ role: "caller" }), "Counterparty");
  assert.equal(turnRoleLabel({ role: "weird" }), "Counterparty");
  assert.equal(turnRoleLabel(null), "Counterparty");
});

test("turnTimeLabel: HH:MM aus at, fehlend/ungueltig -> leer (kein Locale-Aufruf)", () => {
  const d = new Date("2026-06-23T09:05:00.000Z");
  const expected = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  assert.equal(turnTimeLabel({ at: "2026-06-23T09:05:00.000Z" }), expected);
  assert.equal(turnTimeLabel({}), "");
  assert.equal(turnTimeLabel({ at: "nope" }), "");
  assert.equal(turnTimeLabel(null), "");
});

test("callSummary: nur ein echter String zaehlt, sonst leer", () => {
  assert.equal(callSummary({ summary: "Termin bestaetigt" }), "Termin bestaetigt");
  assert.equal(callSummary({ summary: null }), "");
  assert.equal(callSummary({}), "");
  assert.equal(callSummary(null), "");
});

// ---- DOM-Bau: Empty-States --------------------------------------------------
test("callRows: leere Daten -> genau eine Empty-Zeile", () => {
  const rows = callRows(fakeDocument, {});
  assert.equal(rows.length, 1);
  assert.ok(rows[0].hasClass("data-empty"));
  assert.equal(textOf(rows), "No calls yet — connect your first agent!");
});

// ---- DOM-Bau: Normalfall + Trigger-Attribute --------------------------------
test("callRows rendert pro Call einen Trigger-Button (Gegenstelle, Untertitel, Status) + Panel", () => {
  const data = {
    calls: [
      {
        direction: "outbound",
        to: "+4915112345",
        from: "+49301",
        goal: "Termin",
        status: "completed",
      },
      { direction: "inbound", from: "+49302", status: "active" },
    ],
  };
  const rows = callRows(fakeDocument, data);
  assert.equal(rows.length, 2);
  const all = textOf(rows);
  assert.ok(all.includes("+4915112345")); // outbound -> to
  assert.ok(all.includes("Termin")); // goal als Untertitel
  assert.ok(all.includes("+49302")); // inbound -> from
  assert.ok(all.includes("Inbound call")); // kein goal -> Standardtext
  assert.ok(rows[1].hasClass("status-badge--active"));

  // Trigger ist ein echter <button> mit aria-expanded/aria-controls, das Panel
  // traegt genau die referenzierte id -- Tastatur-/Screenreader-Zugaenglichkeit.
  const trigger = rows[0].find("call-row__trigger");
  assert.equal(trigger.tag, "button");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  const panel = rows[0].find("call-panel");
  assert.equal(trigger.getAttribute("aria-controls"), panel.id);
});

test("callRows: Anruf ohne Transkript zeigt eine ruhige Leerzustand-Zeile, kein leeres <ul>", () => {
  const rows = callRows(fakeDocument, { calls: [{ direction: "inbound", status: "completed" }] });
  const panel = rows[0].find("call-panel");
  assert.ok(panel.hasClass("call-panel"));
  const empty = panel.find("call-panel__empty");
  assert.ok(empty, "Leerzustand-Element fehlt");
  assert.equal(empty.textContent, "No conversation recorded.");
  assert.ok(!panel.find("chat-log"), "chat-log sollte bei leerem Transkript nicht gebaut werden");
});

test("callRows: Turns werden als Chat-Blasen gerendert, Agent/Gegenstelle unterschieden", () => {
  const data = {
    calls: [
      {
        direction: "inbound",
        status: "completed",
        summary: "Rueckruf vereinbart",
        transcript: [
          { role: "agent", text: "Guten Tag, wie kann ich helfen?", at: "2026-06-23T09:00:00.000Z" },
          { role: "caller", text: "Ich haette gern einen Rueckruf.", at: "2026-06-23T09:00:05.000Z" },
        ],
      },
    ],
  };
  const rows = callRows(fakeDocument, data);
  const panel = rows[0].find("call-panel");
  const summaryBlock = panel.find("call-summary");
  assert.ok(summaryBlock, "Summary-Block fehlt, obwohl summary gesetzt ist");
  assert.ok(summaryBlock.allText().includes("Rueckruf vereinbart"));

  const log = panel.find("chat-log");
  assert.equal(log.children.length, 2);
  assert.ok(log.children[0].hasClass("chat-bubble--agent"));
  assert.ok(log.children[1].hasClass("chat-bubble--counterparty"));
  assert.ok(log.children[0].allText().includes("Guten Tag, wie kann ich helfen?"));
  assert.ok(log.children[1].allText().includes("Ich haette gern einen Rueckruf."));
});

test("callRows: Klick auf den Trigger toggelt Panel + aria-expanded; Accordion laesst nur eins offen", () => {
  const data = {
    calls: [
      { direction: "inbound", status: "completed", transcript: [{ role: "agent", text: "A" }] },
      { direction: "inbound", status: "completed", transcript: [{ role: "agent", text: "B" }] },
    ],
  };
  const rows = callRows(fakeDocument, data);
  const trigger0 = rows[0].find("call-row__trigger");
  const panel0 = rows[0].find("call-panel");
  const trigger1 = rows[1].find("call-row__trigger");
  const panel1 = rows[1].find("call-panel");

  assert.equal(panel0.hidden, true);
  assert.equal(panel1.hidden, true);

  trigger0.click();
  assert.equal(panel0.hidden, false);
  assert.equal(trigger0.getAttribute("aria-expanded"), "true");
  assert.equal(panel1.hidden, true);

  // Ein zweiter Anruf oeffnen -> der erste klappt zu (nur einer offen).
  trigger1.click();
  assert.equal(panel1.hidden, false);
  assert.equal(trigger1.getAttribute("aria-expanded"), "true");
  assert.equal(panel0.hidden, true);
  assert.equal(trigger0.getAttribute("aria-expanded"), "false");

  // Erneuter Klick auf den offenen Trigger klappt zu (Toggle).
  trigger1.click();
  assert.equal(panel1.hidden, true);
  assert.equal(trigger1.getAttribute("aria-expanded"), "false");
});

// ---- XSS-Beleg: Tenant-Strings landen als Text, nie als HTML -----------------
test('Tenant-Strings mit </>/" und <script> landen ausschliesslich als textContent', () => {
  const attack = '<script>alert("x")</script><img src="y" onerror="z">';
  // Der boese String in jeder Tenant-Quelle: Gegenstelle (from), goal,
  // Transkript-Text, Summary. Wuerde irgendwo innerHTML gesetzt, wirft das
  // Fake-Element -> der Test scheitert. Hier passiert das NICHT, und der Wort-
  // laut taucht woertlich (un-escaped, aber als Text) im Teilbaum auf.
  const rows = callRows(fakeDocument, {
    calls: [
      {
        direction: "inbound",
        from: attack,
        goal: attack,
        status: "completed",
        summary: attack,
        transcript: [{ role: "caller", text: attack }],
      },
    ],
  });

  // Der rohe String steht woertlich im textContent (Beleg: er ging durch
  // textContent, nicht durch innerHTML -> der Browser parst ihn nie als HTML).
  assert.ok(textOf(rows).includes(attack));
});

test("Fake-Element: jeder innerHTML-Schreibzugriff wuerde werfen (Tripwire ist scharf)", () => {
  const node = fakeDocument.createElement("div");
  assert.throws(() => {
    node.innerHTML = "<b>x</b>";
  }, /innerHTML/);
});

// ---- bindList: Verdrahtung + Stale-Daten-Schutz -----------------------------
test("bindList rendert im AUTHENTICATED-Zustand die Zeilen in den Container", () => {
  const doc = makeBindDocument();
  const node = doc.register("calls-list");
  bindList(doc, "calls-list", callRows);
  doc.emit({
    state: AUTH_STATE.AUTHENTICATED,
    data: { calls: [{ direction: "inbound", from: "+49301", status: "active" }] },
  });
  assert.equal(node.children.length, 1);
  assert.ok(node.children[0].hasClass("call-row"));
});

test("bindList leert den Container bei JEDEM Nicht-AUTHENTICATED-Zustand (Stale-Schutz)", () => {
  for (const state of [AUTH_STATE.ANONYMOUS, AUTH_STATE.PENDING, AUTH_STATE.ERROR]) {
    const doc = makeBindDocument();
    const node = doc.register("calls-list");
    node.append(new FakeElement("li")); // vorher gefuellt (simuliert alte Daten)
    bindList(doc, "calls-list", callRows);
    doc.emit({ state, data: null });
    assert.equal(node.children.length, 0, `Container nicht geleert bei ${state}`);
  }
});
