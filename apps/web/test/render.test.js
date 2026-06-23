// W4-Tests: die reinen Render-/Status-/Escaping-Helfer (lib/api.js) und der
// DOM-Bau (lib/render.js). Reine Logik, kein Browser-DOM: ein winziges Fake-
// `document` bildet exakt die im Bau genutzten DOM-Operationen nach
// (createElement, className, textContent, append). So laeuft alles mit
// node:test ohne Netz/DOM-Library.
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
  actionItemsFrom,
  calendarFrom,
  isAgentLive,
  callCounterparty,
  callSubtitle,
  callStatusLabel,
  callStatusKind,
  isAppointment,
  calendarDateParts,
} from "../src/lib/api.js";

import { callRows, actionItemRows, calendarRows, bindList } from "../src/lib/render.js";

// ---- Fake-DOM ---------------------------------------------------------------
// Nur die Operationen, die lib/render.js wirklich nutzt. `innerHTML` ist eine
// Falle: ein Schreibzugriff wirft -> belegt, dass der Bau ihn nie nutzt.
class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.className = "";
    this.textContent = "";
    this.children = [];
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
  // Hilfs-Sicht fuer die Tests: der gesamte sichtbare Text dieses Teilbaums.
  allText() {
    return this.textContent + this.children.map((c) => c.allText()).join("");
  }
  // Hilfs-Sicht: existiert irgendwo im Teilbaum die gesuchte className?
  hasClass(name) {
    if (this.className.split(" ").includes(name)) return true;
    return this.children.some((c) => c.hasClass(name));
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
test("callsFrom/actionItemsFrom/calendarFrom: leere Liste bei fehlenden/null Feldern", () => {
  for (const input of [undefined, null, {}, { calls: null }, { calls: "x" }]) {
    assert.deepEqual(callsFrom(input), []);
  }
  assert.deepEqual(actionItemsFrom(undefined), []);
  assert.deepEqual(calendarFrom(null), []);
  // Echte Arrays werden unveraendert durchgereicht.
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
  assert.equal(callCounterparty({ direction: CALL_DIRECTION.OUTBOUND, to: "+491", from: "+492" }), "+491");
  assert.equal(callCounterparty({ direction: CALL_DIRECTION.INBOUND, to: "+491", from: "+492" }), "+492");
  assert.equal(callCounterparty({ direction: CALL_DIRECTION.OUTBOUND }), "");
  assert.equal(callCounterparty(null), "");
});

test("callSubtitle: goal hat Vorrang, sonst richtungsabhaengiger Standardtext", () => {
  assert.equal(callSubtitle({ direction: "inbound", goal: "Rueckruf" }), "Rueckruf");
  assert.equal(callSubtitle({ direction: "inbound" }), "Eingehender Anruf");
  assert.equal(callSubtitle({ direction: "outbound" }), "Ausgehender Anruf");
});

test("callStatusLabel/callStatusKind: bekannte Status + fail-closed auf failed", () => {
  assert.equal(callStatusLabel({ status: "active" }), "Live");
  assert.equal(callStatusLabel({ status: "completed" }), "Beendet");
  assert.equal(callStatusLabel({ status: "cancelled" }), "Abgebrochen");
  assert.equal(callStatusLabel({ status: "failed" }), "Fehlgeschlagen");
  // Unbekannter/fehlender Status -> Fehler-Beschriftung + Fehler-Klasse.
  assert.equal(callStatusLabel({ status: "weird" }), "Fehlgeschlagen");
  assert.equal(callStatusLabel({}), "Fehlgeschlagen");
  assert.equal(callStatusKind({ status: "active" }), "active");
  assert.equal(callStatusKind({ status: "weird" }), "failed");
});

// ---- Action-Item-Helfer -----------------------------------------------------
test("isAppointment: nur type==='appointment'", () => {
  assert.equal(isAppointment({ type: "appointment" }), true);
  assert.equal(isAppointment({ type: "todo" }), false);
  assert.equal(isAppointment(null), false);
});

// ---- Kalender-Helfer --------------------------------------------------------
test("calendarDateParts: Tag/Monat/Wochentag aus ISO-start, ungueltig -> leer", () => {
  const parts = calendarDateParts({ start: "2026-06-23T09:30:00.000Z" });
  assert.equal(parts.day, "23");
  assert.ok(parts.month.length > 0);
  assert.ok(parts.when.length > 0);
  assert.deepEqual(calendarDateParts({ start: "nope" }), { day: "", month: "", when: "" });
  assert.deepEqual(calendarDateParts({}), { day: "", month: "", when: "" });
  assert.deepEqual(calendarDateParts(null), { day: "", month: "", when: "" });
});

// ---- DOM-Bau: Empty-States --------------------------------------------------
test("callRows/actionItemRows/calendarRows: leere Daten -> genau eine Empty-Zeile", () => {
  for (const rows of [callRows(fakeDocument, {}), actionItemRows(fakeDocument, {}), calendarRows(fakeDocument, {})]) {
    assert.equal(rows.length, 1);
    assert.ok(rows[0].hasClass("data-empty"));
  }
  assert.equal(textOf(callRows(fakeDocument, {})), "Noch keine Anrufe — verbinde deinen ersten Agent!");
  assert.equal(textOf(actionItemRows(fakeDocument, {})), "Noch keine Action Items.");
  assert.equal(textOf(calendarRows(fakeDocument, {})), "Noch keine Termine.");
});

// ---- DOM-Bau: Normalfall + Begrenzung --------------------------------------
test("callRows rendert pro Call eine Zeile mit Gegenstelle, Untertitel und Status", () => {
  const data = {
    calls: [
      { direction: "outbound", to: "+4915112345", from: "+49301", goal: "Termin", status: "completed" },
      { direction: "inbound", from: "+49302", status: "active" },
    ],
  };
  const rows = callRows(fakeDocument, data);
  assert.equal(rows.length, 2);
  const all = textOf(rows);
  assert.ok(all.includes("+4915112345")); // outbound -> to
  assert.ok(all.includes("Termin")); // goal als Untertitel
  assert.ok(all.includes("+49302")); // inbound -> from
  assert.ok(all.includes("Eingehender Anruf")); // kein goal -> Standardtext
  assert.ok(rows[1].hasClass("status-badge--active"));
});

test("actionItemRows begrenzt auf 12 und taggt Termine", () => {
  const items = Array.from({ length: 15 }, (_, i) => ({ text: `Item ${i}`, type: "todo" }));
  items[0] = { text: "Mit Tag", type: "appointment" };
  const rows = actionItemRows(fakeDocument, { actionItems: items });
  assert.equal(rows.length, 12); // MAX_ITEMS
  assert.ok(rows[0].hasClass("tag--appointment"));
  assert.ok(textOf([rows[0]]).includes("Termin"));
});

test("calendarRows begrenzt auf 6 Termine", () => {
  const events = Array.from({ length: 9 }, (_, i) => ({
    title: `Event ${i}`,
    start: "2026-06-23T09:00:00.000Z",
  }));
  const rows = calendarRows(fakeDocument, { calendar: events });
  assert.equal(rows.length, 6); // MAX_EVENTS
  assert.ok(textOf(rows).includes("Event 0"));
});

// ---- XSS-Beleg: Tenant-Strings landen als Text, nie als HTML -----------------
test("Tenant-Strings mit </>/\" und <script> landen ausschliesslich als textContent", () => {
  const attack = '<script>alert("x")</script><img src="y" onerror="z">';
  // Der boese String in jeder Tenant-Quelle: Gegenstelle (from), goal,
  // Item-Text, Kalender-Titel. Wuerde irgendwo innerHTML gesetzt, wirft das
  // Fake-Element -> der Test scheitert. Hier passiert das NICHT, und der Wort-
  // laut taucht woertlich (un-escaped, aber als Text) im Teilbaum auf.
  const calls = callRows(fakeDocument, {
    calls: [{ direction: "inbound", from: attack, goal: attack, status: "completed" }],
  });
  const items = actionItemRows(fakeDocument, { actionItems: [{ text: attack, type: "appointment" }] });
  const cal = calendarRows(fakeDocument, {
    calendar: [{ title: attack, start: "2026-06-23T09:00:00.000Z" }],
  });

  // Der rohe String steht woertlich im textContent (Beleg: er ging durch
  // textContent, nicht durch innerHTML -> der Browser parst ihn nie als HTML).
  assert.ok(textOf(calls).includes(attack));
  assert.ok(textOf(items).includes(attack));
  assert.ok(textOf(cal).includes(attack));
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
