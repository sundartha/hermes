import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeCallResult } from "../../src/call-result.ts";
import { ergebnisZustand, gegenseitenUrteil } from "../../src/telephony/ergebnis-zustand.ts";

const AGENT_ZEILE = { role: "agent", text: "Passt Ihnen Dienstag um 10 Uhr?" };
const ZITAT = "Dienstag um 10 Uhr passt";
const GEGENSEITE_ZEILE = { role: "user", text: "Ja, Dienstag um 10 Uhr passt, das ist fest eingetragen." };
const ABLEHNUNG_ZEILE = { role: "user", text: "Nein, einen Termin vergeben wir nicht." };

const FAELLE = {
  bestaetigt: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: true, confirmation_quote: ZITAT },
    erwartet: ["done_confirmed", null],
  },
  zitatGross: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: {
      objective_achieved: true,
      confirmed_by_counterparty: true,
      confirmation_quote: "  DIENSTAG   um 10 Uhr\npasst ",
    },
    erwartet: ["done_confirmed", null],
  },
  ohneBestaetigung: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true },
    erwartet: ["unconfirmed", null],
  },
  bestaetigungFalse: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: false, confirmation_quote: ZITAT },
    erwartet: ["unconfirmed", null],
  },
  bestaetigungAlsText: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: "true", confirmation_quote: ZITAT },
    erwartet: ["unconfirmed", null],
  },
  ohneZitat: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: true },
    erwartet: ["unconfirmed", null],
  },
  leeresZitat: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: true, confirmation_quote: "   " },
    erwartet: ["unconfirmed", null],
  },
  zitatErfunden: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: true, confirmation_quote: "Mittwoch um 9 Uhr passt" },
    erwartet: ["unconfirmed", null],
  },
  zitatNurVomAgent: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: true, confirmation_quote: "Passt Ihnen Dienstag" },
    erwartet: ["unconfirmed", null],
  },
  zielNichtErreicht: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: false, confirmed_by_counterparty: true, confirmation_quote: ZITAT },
    erwartet: ["unconfirmed", null],
  },
  zielUnklar: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: "unclear", confirmed_by_counterparty: true, confirmation_quote: ZITAT },
    erwartet: ["unconfirmed", null],
  },
  abgelehnt: {
    transcript: [AGENT_ZEILE, ABLEHNUNG_ZEILE],
    modell: { objective_achieved: false, declined: true },
    erwartet: ["not_done", "declined"],
  },
  abgelehntUndBestaetigt: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: true, confirmation_quote: ZITAT, declined: true },
    erwartet: ["not_done", "declined"],
  },
  ablehnungAlsText: {
    transcript: [AGENT_ZEILE, ABLEHNUNG_ZEILE],
    modell: { objective_achieved: false, declined: "true" },
    erwartet: ["unconfirmed", null],
  },
  nurMenue: {
    transcript: [AGENT_ZEILE, { role: "agent", text: "Hallo?" }],
    modell: { objective_achieved: true, confirmed_by_counterparty: true, confirmation_quote: "Hallo" },
    erwartet: ["not_done", "menu-only"],
  },
};

function ergebnisNachAuswertung(fall) {
  const urteil = gegenseitenUrteil(fall.modell, fall.transcript);
  const karte = normalizeCallResult({}, { evidenceAllowed: false, counterparty: urteil });
  return ergebnisZustand({
    answeredAt: "2026-11-20T10:00:05.000Z",
    transcript: fall.transcript,
    objectiveAchieved: fall.modell.objective_achieved,
    result: karte,
  });
}

for (const [name, fall] of Object.entries(FAELLE)) {
  test(`Ergebnis nach Auswertung 4059: ${name}`, () => {
    const ergebnis = ergebnisNachAuswertung(fall);
    assert.deepEqual([ergebnis.result_state, ergebnis.result_reason], fall.erwartet);
  });
}

test("Auswertung 4059: Urteil der Gegenseite als Tabelle", () => {
  const urteil = (name) => gegenseitenUrteil(FAELLE[name].modell, FAELLE[name].transcript);
  assert.deepEqual(urteil("bestaetigt"), { confirmed: true, declined: false });
  assert.deepEqual(urteil("abgelehnt"), { confirmed: false, declined: true });
  assert.deepEqual(urteil("ohneBestaetigung"), { confirmed: false, declined: false });
});

test("Auswertung 4059: eine Zeile der Gegenseite ohne Text belegt kein Zitat", () => {
  const urteil = gegenseitenUrteil(FAELLE.bestaetigt.modell, [AGENT_ZEILE, { role: "user" }]);
  assert.equal(urteil.confirmed, false);
});

test("Auswertung 4059: Karte behaelt das Urteil, auch wenn sonst nichts drinsteht; ohne Urteil bleibt sie leer", () => {
  const opts = { evidenceAllowed: false };
  assert.deepEqual(normalizeCallResult({}, { ...opts, counterparty: { confirmed: true, declined: false } })?.counterparty, {
    confirmed: true,
    declined: false,
  });
  assert.deepEqual(normalizeCallResult({}, { ...opts, counterparty: { confirmed: false, declined: true } })?.counterparty, {
    confirmed: false,
    declined: true,
  });
  assert.equal(normalizeCallResult({}, { ...opts, counterparty: { confirmed: false, declined: false } }), null);
  assert.equal(normalizeCallResult({}, opts), null);
});
