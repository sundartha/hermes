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

import {
  callRows,
  bindList,
  callTimeLabel,
  callDurationLabel,
  callMetaLabel,
  callDirectionLabel,
  fillCallModal,
} from "../src/lib/render.js";

// Simuliert die DE-Sprachwahl fuer getLang() (lib/i18n.js), OHNE setLang() zu rufen --
// setLang() greift auf `document` zu (document.documentElement.lang, dispatchEvent),
// das es in node:test nicht gibt. getLang() liest NUR localStorage.getItem, darum
// reicht ein minimaler Stub. Restauriert globalThis.localStorage danach (auch wenn es
// vorher gar nicht existierte -- Node hat von Haus aus keinen globalThis.localStorage).
function withLang(lang, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => lang };
  try {
    fn();
  } finally {
    if (had) globalThis.localStorage = original;
    else delete globalThis.localStorage;
  }
}

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

// ---- DOM-Bau: Normalfall + Klick oeffnet das Detail-Fenster -----------------
test("callRows rendert pro Call eine anklickbare Zeile (Richtung, Name, Meta, Status) und ruft onSelect(call, button) auf", () => {
  const data = {
    calls: [
      {
        direction: "outbound",
        to: "+4915112345",
        from: "+49301",
        goal: "Termin",
        status: "completed",
        startedAt: "2026-06-23T09:00:00.000Z",
        answeredAt: "2026-06-23T09:00:05.000Z",
        endedAt: "2026-06-23T09:02:45.000Z",
      },
      { direction: "inbound", from: "+49302", status: "active", startedAt: "2026-06-23T09:00:00.000Z" },
    ],
  };
  const selections = [];
  const rows = callRows(fakeDocument, data, (call, button) => selections.push({ call, button }));
  assert.equal(rows.length, 2);
  const all = textOf(rows);
  assert.ok(all.includes("+4915112345")); // outbound -> to
  assert.ok(all.includes("Termin")); // goal als Untertitel
  assert.ok(all.includes("+49302")); // inbound -> from
  assert.ok(all.includes("Inbound call")); // kein goal -> Standardtext
  assert.ok(rows[1].hasClass("status-badge--active"));
  assert.equal(rows[1].find("status-badge").textContent, "LIVE");
  assert.equal(rows[0].find("status-badge").textContent, "ENDED"); // Spec §7-Tabelle, NICHT "Completed"

  // Die ganze Zeile ist ein echter <button> -- Tastatur-/Screenreader-
  // Zugaenglichkeit ohne zusaetzliche Keydown-Verdrahtung.
  const button = rows[0].find("call-row__link");
  assert.equal(button.tag, "button");
  button.click();
  assert.equal(selections.length, 1);
  assert.equal(selections[0].call, data.calls[0]);
  assert.equal(selections[0].button, button);
});

// Befund 3 (Fix-Runde): dritte Zeile der Anrufzeile zeigt die Zusammenfassung,
// faellt ohne Summary auf den bisherigen Richtungs-Untertitel zurueck.
test("callRows: dritte Zeile zeigt die Zusammenfassung, faellt ohne Summary auf den Richtungs-Untertitel zurueck", () => {
  const rows = callRows(fakeDocument, {
    calls: [
      {
        direction: "inbound",
        from: "+49301",
        goal: "Rueckruf",
        status: "completed",
        summary: "Appointment request — Thursday 14:00 proposed and booked.",
      },
      { direction: "outbound", to: "+49302", status: "completed" },
    ],
  });
  assert.equal(rows[0].find("call-sub").textContent, "Appointment request — Thursday 14:00 proposed and booked.");
  assert.equal(rows[1].find("call-sub").textContent, "Outbound call");
});

test("callRows: onSelect ist optional (Default no-op) -- ein Klick ohne Handler wirft nicht", () => {
  const rows = callRows(fakeDocument, { calls: [{ direction: "inbound", status: "completed" }] });
  assert.doesNotThrow(() => rows[0].find("call-row__link").click());
});

// ---- Zeit/Dauer-Meta (Spec §7: "Today, 09:12 · 2:40") -----------------------
test("callTimeLabel: Today-Praefix am selben Kalendertag wie `now`, sonst Monat + Tag; ungueltig -> leer", () => {
  const now = new Date(2026, 5, 23, 12, 0, 0);
  const sameDay = new Date(2026, 5, 23, 9, 5, 0);
  const expectedSame = `Today, ${String(sameDay.getHours()).padStart(2, "0")}:${String(sameDay.getMinutes()).padStart(2, "0")}`;
  assert.equal(callTimeLabel({ startedAt: sameDay.toISOString() }, now), expectedSame);

  const otherDay = new Date(2026, 4, 1, 9, 5, 0);
  const expectedOther = `May 1, ${String(otherDay.getHours()).padStart(2, "0")}:${String(otherDay.getMinutes()).padStart(2, "0")}`;
  assert.equal(callTimeLabel({ startedAt: otherDay.toISOString() }, now), expectedOther);

  // answeredAt hat Vorrang vor startedAt (Anker "abgenommen" statt "geklingelt").
  assert.equal(
    callTimeLabel({ startedAt: otherDay.toISOString(), answeredAt: sameDay.toISOString() }, now),
    expectedSame,
  );

  assert.equal(callTimeLabel({}, now), "");
  assert.equal(callTimeLabel({ startedAt: "nope" }, now), "");
  assert.equal(callTimeLabel(null, now), "");
});

test("callDurationLabel: m:ss von answeredAt bis endedAt bzw. bis `now` (laufender Anruf); ohne answeredAt -> leer", () => {
  const answeredAt = new Date(2026, 5, 23, 9, 0, 0);
  const endedAt = new Date(2026, 5, 23, 9, 2, 40);
  assert.equal(
    callDurationLabel({ answeredAt: answeredAt.toISOString(), endedAt: endedAt.toISOString() }),
    "2:40",
  );

  const now = new Date(2026, 5, 23, 9, 1, 30);
  assert.equal(callDurationLabel({ answeredAt: answeredAt.toISOString() }, now), "1:30");

  // Nie abgenommen (failed/cancelled vor Abnahme) -> keine erfundene Dauer.
  assert.equal(callDurationLabel({}), "");
  assert.equal(callDurationLabel({ answeredAt: "nope" }), "");
});

test("callMetaLabel: Zeit + Dauer getrennt durch Mittelpunkt; nur Zeit ohne Dauer; leer ohne Zeit-Anker", () => {
  const now = new Date(2026, 5, 23, 9, 5, 0);
  const answeredAt = new Date(2026, 5, 23, 9, 0, 5);
  const endedAt = new Date(2026, 5, 23, 9, 2, 45);
  const full = { startedAt: answeredAt.toISOString(), answeredAt: answeredAt.toISOString(), endedAt: endedAt.toISOString() };
  assert.match(callMetaLabel(full, now), /^Today, \d{2}:\d{2} · 2:40$/);

  const neverAnswered = { startedAt: answeredAt.toISOString() };
  assert.match(callMetaLabel(neverAnswered, now), /^Today, \d{2}:\d{2}$/);

  assert.equal(callMetaLabel({}, now), "");
});

// ---- Richtungs-Beschriftung des Detail-Fenster-Kopfs (Spec §8) --------------
test("callDirectionLabel: Incoming/Outgoing, fehlende Richtung faellt auf Incoming zurueck", () => {
  assert.equal(callDirectionLabel({ direction: CALL_DIRECTION.INBOUND }), "Incoming");
  assert.equal(callDirectionLabel({ direction: CALL_DIRECTION.OUTBOUND }), "Outgoing");
  assert.equal(callDirectionLabel({}), "Incoming");
  assert.equal(callDirectionLabel(null), "Incoming");
});

// ---- fillCallModal: das EINE Detail-Fenster wird je Klick neu befuellt -----
function makeModalTargets() {
  return {
    directionEl: fakeDocument.createElement("span"),
    contactEl: fakeDocument.createElement("div"),
    summaryEl: fakeDocument.createElement("div"),
    transcriptEl: fakeDocument.createElement("div"),
  };
}

test("fillCallModal: Richtung, Anrufer-Zeile (CONTACT-Label + Name + Meta + Status) und Transkript", () => {
  const targets = makeModalTargets();
  const call = {
    direction: "inbound",
    from: "+49302",
    status: "completed",
    startedAt: "2026-06-23T09:00:00.000Z",
    answeredAt: "2026-06-23T09:00:05.000Z",
    endedAt: "2026-06-23T09:02:45.000Z",
    transcript: [
      { role: "agent", text: "Guten Tag, wie kann ich helfen?", at: "2026-06-23T09:00:05.000Z" },
      { role: "caller", text: "Ich haette gern einen Rueckruf.", at: "2026-06-23T09:00:10.000Z" },
    ],
  };

  fillCallModal(fakeDocument, targets, call);

  assert.equal(targets.directionEl.textContent, "Incoming");
  assert.ok(targets.contactEl.allText().includes("CONTACT"));
  assert.ok(targets.contactEl.allText().includes("+49302"));
  const pill = targets.contactEl.find("status-badge");
  assert.ok(pill);
  assert.equal(pill.textContent, "ENDED");

  const log = targets.transcriptEl.find("chat-log");
  assert.equal(log.children.length, 2);
  assert.ok(log.children[0].hasClass("chat-bubble--agent"));
  assert.ok(log.children[1].hasClass("chat-bubble--counterparty"));
  assert.ok(log.children[0].allText().includes("Guten Tag, wie kann ich helfen?"));
});

test("fillCallModal: Summary-Box nur sichtbar+befuellt, wenn eine Summary existiert", () => {
  const withSummary = makeModalTargets();
  fillCallModal(fakeDocument, withSummary, {
    direction: "inbound",
    status: "completed",
    summary: "Rueckruf vereinbart",
  });
  assert.equal(withSummary.summaryEl.hidden, false);
  assert.ok(withSummary.summaryEl.allText().includes("Rueckruf vereinbart"));

  const withoutSummary = makeModalTargets();
  fillCallModal(fakeDocument, withoutSummary, { direction: "outbound", to: "+491", status: "active" });
  assert.equal(withoutSummary.summaryEl.hidden, true);
  assert.equal(withoutSummary.summaryEl.children.length, 0);
  assert.equal(withoutSummary.directionEl.textContent, "Outgoing");
});

test("fillCallModal: Anruf ohne Transkript zeigt eine ruhige Leerzustand-Zeile, kein leeres <ul>", () => {
  const targets = makeModalTargets();
  fillCallModal(fakeDocument, targets, { direction: "inbound", status: "completed" });
  const empty = targets.transcriptEl.find("call-modal__empty");
  assert.ok(empty, "Leerzustand-Element fehlt");
  assert.equal(empty.textContent, "No conversation recorded.");
  assert.ok(!targets.transcriptEl.find("chat-log"), "chat-log sollte bei leerem Transkript nicht gebaut werden");
});

test("fillCallModal: wiederholter Aufruf ersetzt den Inhalt (ein Modal, je Klick neu befuellt)", () => {
  const targets = makeModalTargets();
  fillCallModal(fakeDocument, targets, { direction: "inbound", from: "+49301", status: "completed", summary: "Erster Anruf" });
  fillCallModal(fakeDocument, targets, { direction: "outbound", to: "+49302", status: "active" });
  assert.equal(targets.directionEl.textContent, "Outgoing");
  assert.ok(targets.contactEl.allText().includes("+49302"));
  assert.ok(!targets.contactEl.allText().includes("+49301"));
  assert.equal(targets.summaryEl.hidden, true); // die alte Summary ist weg
});

// ---- XSS-Beleg: Tenant-Strings landen als Text, nie als HTML -----------------
test('Tenant-Strings mit </>/" und <script> landen ausschliesslich als textContent (Zeile)', () => {
  const attack = '<script>alert("x")</script><img src="y" onerror="z">';
  // Der boese String in den Tenant-Quellen der Zeile: Gegenstelle (from), goal.
  // Wuerde irgendwo innerHTML gesetzt, wirft das Fake-Element -> der Test
  // scheitert. Hier passiert das NICHT, und der Wortlaut taucht woertlich
  // (un-escaped, aber als Text) im Teilbaum auf.
  const rows = callRows(fakeDocument, {
    calls: [{ direction: "inbound", from: attack, goal: attack, status: "completed" }],
  });
  assert.ok(textOf(rows).includes(attack));
});

test('Tenant-Strings mit </>/" und <script> landen ausschliesslich als textContent (Detail-Fenster)', () => {
  const attack = '<script>alert("x")</script><img src="y" onerror="z">';
  const targets = makeModalTargets();
  // Der boese String in jeder Tenant-Quelle des Modals: Gegenstelle (from),
  // Summary, Transkript-Text.
  fillCallModal(fakeDocument, targets, {
    direction: "inbound",
    from: attack,
    status: "completed",
    summary: attack,
    transcript: [{ role: "caller", text: attack }],
  });
  assert.ok(targets.contactEl.allText().includes(attack));
  assert.ok(targets.summaryEl.allText().includes(attack));
  assert.ok(targets.transcriptEl.allText().includes(attack));
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

// ---- Dashboard-i18n Etappe 2: DE-Modus (Status-Pillen, Richtung, Datum) -----
test("DE-Modus: Status-Pillen LIVE/BEENDET/ABGEBROCHEN/FEHLGESCHLAGEN statt der EN-Kurzform", () => {
  withLang("de", () => {
    const rows = callRows(fakeDocument, {
      calls: [
        { direction: "inbound", from: "+49301", status: "active" },
        { direction: "inbound", from: "+49302", status: "completed" },
        { direction: "inbound", from: "+49303", status: "cancelled" },
        { direction: "inbound", from: "+49304", status: "weird" }, // faellt auf failed
      ],
    });
    assert.equal(rows[0].find("status-badge").textContent, "LIVE");
    assert.equal(rows[1].find("status-badge").textContent, "BEENDET");
    assert.equal(rows[2].find("status-badge").textContent, "ABGEBROCHEN");
    assert.equal(rows[3].find("status-badge").textContent, "FEHLGESCHLAGEN");
  });
});

test("DE-Modus: Richtungs-Beschriftung Eingehend/Ausgehend (Detail-Fenster-Kopf)", () => {
  withLang("de", () => {
    assert.equal(callDirectionLabel({ direction: CALL_DIRECTION.INBOUND }), "Eingehend");
    assert.equal(callDirectionLabel({ direction: CALL_DIRECTION.OUTBOUND }), "Ausgehend");
  });
});

test("DE-Modus: callTimeLabel zeigt 'Heute' + deutsches Monatskuerzel, weiterhin ohne Intl/toLocale", () => {
  withLang("de", () => {
    const now = new Date(2026, 5, 23, 12, 0, 0); // 23. Juni
    const sameDay = new Date(2026, 5, 23, 9, 5, 0);
    const expectedSame = `Heute, ${String(sameDay.getHours()).padStart(2, "0")}:${String(sameDay.getMinutes()).padStart(2, "0")}`;
    assert.equal(callTimeLabel({ startedAt: sameDay.toISOString() }, now), expectedSame);

    const otherDay = new Date(2026, 4, 1, 9, 5, 0); // 1. Mai
    const expectedOther = `Mai 1, ${String(otherDay.getHours()).padStart(2, "0")}:${String(otherDay.getMinutes()).padStart(2, "0")}`;
    assert.equal(callTimeLabel({ startedAt: otherDay.toISOString() }, now), expectedOther);
  });
});

test("DE-Modus: leere Anrufliste/Transkript und Kontakt-/Zusammenfassungs-Labels sind deutsch", () => {
  withLang("de", () => {
    const rows = callRows(fakeDocument, {});
    assert.equal(textOf(rows), "Noch keine Anrufe — verbinde deinen ersten Agenten!");

    const targets = makeModalTargets();
    fillCallModal(fakeDocument, targets, { direction: "inbound", from: "+49301", status: "completed", summary: "Rueckruf" });
    assert.ok(targets.contactEl.allText().includes("KONTAKT"));
    assert.ok(targets.summaryEl.allText().includes("Zusammenfassung"));

    const empty = makeModalTargets();
    fillCallModal(fakeDocument, empty, { direction: "inbound", status: "completed" });
    assert.equal(empty.transcriptEl.find("call-modal__empty").textContent, "Kein Gespräch aufgezeichnet.");
  });
});

test("EN bleibt unveraendert Default ausserhalb von withLang (getLang() wirft in Node nicht)", () => {
  const rows = callRows(fakeDocument, { calls: [{ direction: "inbound", status: "completed" }] });
  assert.equal(rows[0].find("status-badge").textContent, "ENDED");
});
