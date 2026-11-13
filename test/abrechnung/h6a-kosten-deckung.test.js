import { test } from "node:test";
import assert from "node:assert/strict";
import { kostenBuchBericht, istBuchBefundCode, deckungsZeile, KOSTEN_BEFUND } from "../../src/billing/kosten-deckung.ts";
import { KOSTENPROFIL, KOSTENART } from "../../src/billing/kostenarten.js";
import { REIFE } from "../../src/begriffe/abrechnung.js";
import { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "../../src/utils/timer.js";

const JETZT = Date.parse("2026-11-13T12:00:00.000Z");
const DECKUNG_FENSTER_MS = 3 * MS_PER_HOUR;
const ABRECHNUNG = {
  costTruingDelayMinutes: 5,
  costTruingSweepIntervalMs: MS_PER_MINUTE,
  costSettleDeadlineHours: 24,
  kostenHeartbeatFensterH: 6,
  costTruingMinCoveragePercent: 80,
};
const SEKUNDEN_UEBER_DECKEL = 1801;
const SEKUNDEN_UNTER_DECKEL = 1000;

const vorMin = (minuten) => new Date(JETZT - minuten * MS_PER_MINUTE).toISOString();
const vorSek = (sekunden) => new Date(JETZT - sekunden * MS_PER_SECOND).toISOString();
const anruf = (id, extra = {}) => ({ id, costProfile: KOSTENPROFIL.TELNYX_BUDGET, endedAt: vorMin(30), ...extra });
const beleg = (callId, traeger, reife) => ({ callId, traeger, reife });
const bericht = (state, abrechnung = ABRECHNUNG) =>
  kostenBuchBericht({ state, billing: abrechnung, nowMs: JETZT, deckungFensterMs: DECKUNG_FENSTER_MS });

const TELNYX = KOSTENART.TELNYX_CALL_RECORDS;

function zustandMitLuecken() {
  return {
    calls: [
      anruf("a1"),
      anruf("a2"),
      anruf("a3"),
      anruf("a4"),
      anruf("a5"),
      anruf("zu_frisch", { endedAt: vorMin(2) }),
      anruf("ohne_ende", { endedAt: null, startedAt: vorSek(SEKUNDEN_UEBER_DECKEL) }),
      anruf("ohne_ende_jung", { endedAt: null, startedAt: vorSek(SEKUNDEN_UNTER_DECKEL) }),
      anruf("ohne_ende_ohne_start", { endedAt: null }),
      anruf("ohne_ende_uralt", { endedAt: null, startedAt: vorMin(24 * 60) }),
      anruf("ende_kaputt", { endedAt: "kein datum" }),
      anruf("ohne_profil", { costProfile: null }),
    ],
    callCostEvidence: [
      beleg("a1", TELNYX, REIFE.BELEGT),
      beleg("a2", TELNYX, REIFE.BELEGT),
      beleg("a3", TELNYX, REIFE.ERWARTET),
      beleg("a4", TELNYX, REIFE.VORLAEUFIG),
      beleg("a5", TELNYX, REIFE.STRUKTURELL_UNBESCHAFFBAR),
    ],
  };
}

test("h6a Bericht: Deckung, Herzschlag, nie beendet und profillos aus einem Zustand", () => {
  const ergebnis = bericht(zustandMitLuecken());
  assert.deepEqual(ergebnis.deckung, [
    { traeger: TELNYX, kandidaten: 5, belegt: 2, offen: 3, unbeschaffbar: 1, prozent: 40 },
  ]);
  assert.deepEqual(ergebnis.herzschlag, [{ traeger: TELNYX, beendet: 6, angelegt: 4 }]);
  assert.equal(ergebnis.nieBeendet, 1);
  assert.equal(ergebnis.profillos, 1);
  assert.equal(ergebnis.fensterH, 6);
  assert.equal(ergebnis.herzschlagAktiv, true);
  assert.equal(ergebnis.schwelleProzent, 80);
  assert.equal(ergebnis.zeile, `buch=${TELNYX}(5/2/3/1) herzschlag=${TELNYX}(6/4) nie_beendet=1 profillos=1`);
});

test("h6a Bericht: Befund Deckung unter Schwelle nennt alle Zaehler im Detail", () => {
  const ergebnis = bericht(zustandMitLuecken());
  assert.deepEqual(ergebnis.befunde, [
    {
      code: `${KOSTEN_BEFUND.DECKUNG_UNTER_SCHWELLE}:${TELNYX}`,
      detail: `traeger=${TELNYX} deckung=40% schwelle=80% kandidaten=5 belegt=2 offen=3 unbeschaffbar=1`,
    },
    { code: KOSTEN_BEFUND.PROFIL_FEHLT, detail: "fenster_h=6 anrufe=1" },
  ]);
});

test("h6a Bericht: nur Anrufe ohne Kostenprofil im Fenster werden gezaehlt und gemeldet", () => {
  const state = {
    calls: [
      anruf("p1", { costProfile: null }),
      anruf("p2", { costProfile: "" }),
      anruf("p3", { costProfile: null, endedAt: vorMin(2) }),
      anruf("p4", { costProfile: null, endedAt: null }),
      anruf("p5"),
    ],
    callCostEvidence: [],
  };
  const ergebnis = bericht(state);
  assert.equal(ergebnis.profillos, 2);
  const befund = ergebnis.befunde.find((eintrag) => eintrag.code === "profil-fehlt");
  assert.deepEqual(befund, { code: "profil-fehlt", detail: "fenster_h=6 anrufe=2" });
});

test("h6a Bericht: Traeger ohne jede angelegte Zeile ist Erfassung tot und verdraengt den Deckungsbefund", () => {
  const state = {
    calls: [anruf("e1", { costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI }), anruf("e2", { costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI })],
    callCostEvidence: [beleg("e1", TELNYX, REIFE.BELEGT), beleg("e2", TELNYX, REIFE.BELEGT)],
  };
  const ergebnis = bericht(state);
  assert.deepEqual(ergebnis.herzschlag, [
    { traeger: KOSTENART.ELEVENLABS_CONVAI, beendet: 2, angelegt: 0 },
    { traeger: TELNYX, beendet: 2, angelegt: 2 },
  ]);
  assert.deepEqual(ergebnis.befunde, [
    {
      code: `${KOSTEN_BEFUND.ERFASSUNG_TOT}:${KOSTENART.ELEVENLABS_CONVAI}`,
      detail: `traeger=${KOSTENART.ELEVENLABS_CONVAI} fenster_h=6 beendet=2 angelegt=0`,
    },
  ]);
});

test("h6a Bericht: Herzschlagfenster kuerzer als die Karenz schaltet den Herzschlag aus", () => {
  const ergebnis = bericht(zustandMitLuecken(), { ...ABRECHNUNG, kostenHeartbeatFensterH: 0.05 });
  assert.equal(ergebnis.herzschlagAktiv, false);
  assert.deepEqual(ergebnis.herzschlag, []);
  assert.equal(ergebnis.profillos, 0);
  assert.match(ergebnis.zeile, / herzschlag=aus /);
});

test("h6a Bericht: Deckungsfenster kuerzer als die Karenz liefert eine leere Deckung", () => {
  const ergebnis = kostenBuchBericht({ state: zustandMitLuecken(), billing: ABRECHNUNG, nowMs: JETZT, deckungFensterMs: MS_PER_MINUTE });
  assert.deepEqual(ergebnis.deckung, []);
  assert.match(ergebnis.zeile, /^buch=keine /);
});

const LEERE_ZUSTAENDE = [
  ["null", null],
  ["leeres Objekt", {}],
  ["Listen keine Felder", { calls: "x", callCostEvidence: "y" }],
];

for (const [name, state] of LEERE_ZUSTAENDE) {
  test(`h6a Bericht: Zustand ${name} ergibt einen leeren Bericht`, () => {
    const ergebnis = bericht(state);
    assert.equal(ergebnis.zeile, "buch=keine herzschlag=keine nie_beendet=0 profillos=0");
    assert.deepEqual(ergebnis.befunde, []);
  });
}

test("h6a Bericht: Traeger sind nach Name sortiert und Schluessel in fester Reihenfolge", () => {
  const state = {
    calls: [anruf("s1", { costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI })],
    callCostEvidence: [],
  };
  const ergebnis = bericht(state);
  assert.deepEqual(ergebnis.deckung.map((eintrag) => eintrag.traeger), [KOSTENART.ELEVENLABS_CONVAI, TELNYX]);
  assert.deepEqual(Object.keys(ergebnis), [
    "deckung",
    "herzschlag",
    "nieBeendet",
    "profillos",
    "fensterH",
    "herzschlagAktiv",
    "schwelleProzent",
    "zeile",
    "befunde",
  ]);
  assert.deepEqual(Object.keys(ergebnis.deckung[0]), ["traeger", "kandidaten", "belegt", "offen", "unbeschaffbar", "prozent"]);
});

test("h6a deckungsZeile: Herzschlag aus und leere Listen", () => {
  const leer = { deckung: [], herzschlag: [], nieBeendet: 3, profillos: 2, herzschlagAktiv: false };
  assert.equal(deckungsZeile(leer), "buch=keine herzschlag=aus nie_beendet=3 profillos=2");
  assert.equal(deckungsZeile({ ...leer, herzschlagAktiv: true }), "buch=keine herzschlag=keine nie_beendet=3 profillos=2");
});

const BEFUND_CODES = [
  ["deckung-unter-schwelle:telnyx_sip", true],
  ["erfassung-tot:elevenlabs_convai", true],
  ["profil-fehlt", true],
  ["deckung-unter-schwelle-x:telnyx_sip", false],
  ["kosten:profil-fehlt", false],
  ["", false],
];

for (const [code, erwartet] of BEFUND_CODES) {
  test(`h6a istBuchBefundCode("${code}") ist ${String(erwartet)}`, () => {
    assert.equal(istBuchBefundCode(code), erwartet);
  });
}
