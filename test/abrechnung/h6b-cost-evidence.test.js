import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertCostEvidenceInput,
  belegDetailAusRohdaten,
  buildCostEvidenceRow,
  canSetEvidenceMaturity,
  costEvidenceFortschreibung,
  costEvidenceSumMicroCents,
  costEvidenceValuePatch,
  isBelegRef,
  isKnownMaturity,
  isKnownTraeger,
  isTerminalMaturity,
  summierbareBelegzeilen,
} from "../../src/store/cost-evidence.ts";
import { KOSTENART } from "../../src/billing/kostenarten.js";
import { REIFE } from "../../src/begriffe/abrechnung.js";

const TELNYX = KOSTENART.TELNYX_CALL_RECORDS;
const REF_MAX = 128;
const TEXT_MAX = 64;
const QUELLE_MAX = 64;

test("h6b isBelegRef: Muster und Laenge", () => {
  const tabelle = [
    ["abc_1:=-", true],
    ["A", true],
    ["a".repeat(REF_MAX), true],
    ["a".repeat(REF_MAX + 1), false],
    ["", false],
    ["a b", false],
    ["a.b", false],
    ["a\nb", false],
    [42, false],
    [null, false],
    [undefined, false],
  ];
  for (const [wert, erwartet] of tabelle) assert.equal(isBelegRef(wert), erwartet, String(wert));
});

test("h6b Traeger und Reife erkennen", () => {
  assert.equal(isKnownTraeger(TELNYX), true);
  assert.equal(isKnownTraeger("toString"), false);
  assert.equal(isKnownTraeger("unbekannt"), false);
  for (const reife of Object.values(REIFE)) assert.equal(isKnownMaturity(reife), true, reife);
  assert.equal(isKnownMaturity("fertig"), false);
  assert.equal(isTerminalMaturity(REIFE.STRUKTURELL_UNBESCHAFFBAR), true);
  for (const reife of [REIFE.ERWARTET, REIFE.VORLAEUFIG, REIFE.BELEGT])
    assert.equal(isTerminalMaturity(reife), false, reife);
});

test("h6b canSetEvidenceMaturity: Fortschritt, Terminal, Unbekanntes", () => {
  const { ERWARTET, VORLAEUFIG, BELEGT, STRUKTURELL_UNBESCHAFFBAR: ENDE } = REIFE;
  const tabelle = [
    [ERWARTET, ERWARTET, true],
    [ENDE, ENDE, true],
    ["fremd", "fremd", true],
    [ERWARTET, VORLAEUFIG, true],
    [ERWARTET, BELEGT, true],
    [VORLAEUFIG, BELEGT, true],
    [VORLAEUFIG, ERWARTET, false],
    [BELEGT, VORLAEUFIG, false],
    [BELEGT, ERWARTET, false],
    [ENDE, BELEGT, false],
    [ENDE, ERWARTET, false],
    [ERWARTET, ENDE, true],
    [BELEGT, ENDE, true],
    ["fremd", BELEGT, false],
    [ERWARTET, "fremd", false],
    ["fremd", ENDE, true],
  ];
  for (const [von, nach, erwartet] of tabelle)
    assert.equal(canSetEvidenceMaturity(von, nach), erwartet, `${von} -> ${nach}`);
});

test("h6b belegDetailAusRohdaten: nur erlaubte Preis- und Mengenfelder", () => {
  const tabelle = [
    [{ llm_price: 1.5 }, { llm_price: 1.5 }],
    [{ platform_price: 2 }, { platform_price: 2 }],
    [{ analysis: { price: 3 } }, { analysis_price: 3 }],
    [{ x: { analysis: { price: 3 } } }, { analysis_price: 3 }],
    [{ price: 3 }, null],
    [{ analysis: { other: 3 } }, null],
    [{ billed_sec: 0 }, { billed_sec: 0 }],
    [{ a: { call_duration_secs: 61 } }, { call_duration_secs: 61 }],
    [{ rate: 0.1, tier: "gold" }, { rate: 0.1, tier: "gold" }],
    [{ tier: "t".repeat(TEXT_MAX) }, { tier: "t".repeat(TEXT_MAX) }],
    [{ tier: "t".repeat(TEXT_MAX + 1) }, null],
    [{ tier: "t" }, { tier: "t" }],
    [{ tier: "" }, null],
    [{ rate: Number.NaN }, null],
    [{ rate: Number.POSITIVE_INFINITY }, null],
    [{ rate: true }, null],
    [{ rate: null }, null],
    [{ rate: { tier: "silber" } }, { tier: "silber" }],
    [{ other: 5, name: "x" }, null],
    [{}, null],
    [{ a: { b: { c: { d: { e: { rate: 1 } } } } } }, { rate: 1 }],
    [{ a: { b: { c: { d: { e: { f: { rate: 1 } } } } } } }, null],
  ];
  for (const [roh, erwartet] of tabelle)
    assert.deepEqual(belegDetailAusRohdaten(roh), erwartet, JSON.stringify(roh));
});

test("h6b belegDetailAusRohdaten: Nicht-Objekte, erster Treffer gewinnt, eingefroren", () => {
  for (const roh of [null, undefined, "rate", 5, true]) assert.equal(belegDetailAusRohdaten(roh), null);
  const ergebnis = belegDetailAusRohdaten({ rate: 1, inner: { rate: 2 }, tier: "a" });
  assert.deepEqual(ergebnis, { rate: 1, tier: "a" });
  assert.equal(Object.isFrozen(ergebnis), true);
});

function eingabe(extra = {}) {
  return { traeger: TELNYX, reife: REIFE.BELEGT, ...extra };
}

test("h6b assertCostEvidenceInput: gueltige Eingaben laufen durch", () => {
  const gueltig = [
    eingabe(),
    eingabe({ betragMikroCents: 0, waehrung: "EUR" }),
    eingabe({ betragMikroCents: null, belegRef: null, quelle: null }),
    eingabe({ reife: REIFE.ERWARTET }),
    eingabe({ reife: REIFE.ERWARTET, betragMikroCents: null }),
    eingabe({ belegRef: "ref_1", quelle: "telnyx_api", versuche: 0, abstandZumGespraechsendeS: 7 }),
    eingabe({ quelle: "a".repeat(QUELLE_MAX) }),
    eingabe({ versuche: null, abstandZumGespraechsendeS: null }),
    eingabe({ nachreifbar: false }),
    eingabe({ nachreifbar: true }),
  ];
  for (const e of gueltig) assert.doesNotThrow(() => assertCostEvidenceInput(e), JSON.stringify(e));
});

test("h6b assertCostEvidenceInput: Fehlertexte je Verstoss", () => {
  const tabelle = [
    [eingabe({ traeger: "fremd" }), "cost-evidence: unbekannter Traeger 'fremd'"],
    [eingabe({ reife: "fertig" }), "cost-evidence: unbekannte Reife 'fertig'"],
    [
      eingabe({ reife: REIFE.ERWARTET, betragMikroCents: 5 }),
      "cost-evidence: 'erwartet' darf keinen Betrag tragen",
    ],
    [
      eingabe({ betragMikroCents: -1, waehrung: "EUR" }),
      "cost-evidence: betragMikroCents '-1' ist kein gueltiger Betrag",
    ],
    [
      eingabe({ betragMikroCents: 1.5, waehrung: "EUR" }),
      "cost-evidence: betragMikroCents '1.5' ist kein gueltiger Betrag",
    ],
    [eingabe({ betragMikroCents: 5 }), "cost-evidence: ein Betrag ohne Waehrung ist nicht buchbar"],
    [eingabe({ betragMikroCents: 5, waehrung: "" }), "cost-evidence: ein Betrag ohne Waehrung ist nicht buchbar"],
    [eingabe({ belegRef: "a b" }), "cost-evidence: belegRef 'a b' hat kein gueltiges Format"],
    [eingabe({ quelle: "Gross" }), "cost-evidence: quelle 'Gross' hat kein gueltiges Format"],
    [eingabe({ quelle: "a".repeat(QUELLE_MAX + 1) }), `cost-evidence: quelle '${"a".repeat(QUELLE_MAX + 1)}' hat kein gueltiges Format`],
    [eingabe({ versuche: -1 }), "cost-evidence: 'versuche' muss eine nicht-negative Ganzzahl sein"],
    [eingabe({ versuche: 1.5 }), "cost-evidence: 'versuche' muss eine nicht-negative Ganzzahl sein"],
    [
      eingabe({ abstandZumGespraechsendeS: -2 }),
      "cost-evidence: 'abstandZumGespraechsendeS' muss eine nicht-negative Ganzzahl sein",
    ],
    [eingabe({ nachreifbar: "ja" }), "cost-evidence: 'nachreifbar' muss ein Boolean sein, nicht 'ja'"],
    [eingabe({ nachreifbar: null }), "cost-evidence: 'nachreifbar' muss ein Boolean sein, nicht 'null'"],
  ];
  for (const [e, text] of tabelle)
    assert.throws(() => assertCostEvidenceInput(e), { message: text }, text);
});

test("h6b buildCostEvidenceRow: Grundwerte und Wertfelder der Eingabe", () => {
  const leer = buildCostEvidenceRow({ id: "i1", tenantId: "t1", callId: "c1", eingabe: eingabe() });
  assert.deepEqual(leer, {
    id: "i1",
    tenantId: "t1",
    callId: "c1",
    traeger: TELNYX,
    reife: REIFE.BELEGT,
    betragMikroCents: null,
    waehrung: null,
    quelle: null,
    belegRef: null,
    versuche: 0,
    gemessenAt: null,
    abstandZumGespraechsendeS: null,
    detail: null,
    nachreifbar: true,
  });
  const voll = buildCostEvidenceRow({
    id: "i2",
    tenantId: "t1",
    callId: "c2",
    eingabe: eingabe({
      betragMikroCents: 7,
      waehrung: "EUR",
      quelle: "api",
      belegRef: "r1",
      versuche: 3,
      gemessenAt: "2026-11-13T10:00:00.000Z",
      abstandZumGespraechsendeS: 90,
      detail: { rate: 2, geheim: "x" },
      nachreifbar: false,
    }),
  });
  assert.deepEqual(voll, {
    id: "i2",
    tenantId: "t1",
    callId: "c2",
    traeger: TELNYX,
    reife: REIFE.BELEGT,
    betragMikroCents: 7,
    waehrung: "EUR",
    quelle: "api",
    belegRef: "r1",
    versuche: 3,
    gemessenAt: "2026-11-13T10:00:00.000Z",
    abstandZumGespraechsendeS: 90,
    detail: { rate: 2 },
    nachreifbar: false,
  });
});

test("h6b costEvidenceValuePatch: nur gesetzte Felder, Detail wird gekuerzt", () => {
  assert.deepEqual(costEvidenceValuePatch(eingabe()), {});
  assert.deepEqual(costEvidenceValuePatch({ traeger: TELNYX, versuche: 0, belegRef: null }), {
    versuche: 0,
    belegRef: null,
  });
  assert.deepEqual(costEvidenceValuePatch({ detail: { tier: "a", rest: 1 } }), { detail: { tier: "a" } });
  assert.deepEqual(costEvidenceValuePatch({ detail: "kein Objekt" }), { detail: null });
  assert.deepEqual(costEvidenceValuePatch({ detail: undefined }), {});
  assert.deepEqual(costEvidenceValuePatch({ reife: REIFE.BELEGT, id: "x" }), {});
});

test("h6b costEvidenceFortschreibung: nachreifbar false bleibt false", () => {
  assert.deepEqual(costEvidenceFortschreibung({ nachreifbar: false }, { nachreifbar: true, versuche: 1 }), {
    nachreifbar: false,
    versuche: 1,
  });
  assert.deepEqual(costEvidenceFortschreibung({ nachreifbar: false }, {}), { nachreifbar: false });
  assert.deepEqual(costEvidenceFortschreibung({ nachreifbar: true }, { nachreifbar: false }), {
    nachreifbar: false,
  });
  assert.deepEqual(costEvidenceFortschreibung({ nachreifbar: true }, { versuche: 2 }), { versuche: 2 });
  assert.deepEqual(costEvidenceFortschreibung({}, { versuche: 2 }), { versuche: 2 });
});

test("h6b Summen: nur vorlaeufige und belegte Zeilen mit gueltigem Betrag", () => {
  const zeilen = [
    { reife: REIFE.BELEGT, betragMikroCents: 100 },
    { reife: REIFE.VORLAEUFIG, betragMikroCents: 20 },
    { reife: REIFE.BELEGT, betragMikroCents: 0 },
    { reife: REIFE.ERWARTET, betragMikroCents: 500 },
    { reife: REIFE.STRUKTURELL_UNBESCHAFFBAR, betragMikroCents: 700 },
    { reife: REIFE.BELEGT, betragMikroCents: null },
    { reife: REIFE.BELEGT },
    { reife: REIFE.BELEGT, betragMikroCents: -5 },
    { reife: REIFE.BELEGT, betragMikroCents: 1.5 },
    { betragMikroCents: 9 },
  ];
  assert.deepEqual(summierbareBelegzeilen(zeilen), zeilen.slice(0, 3));
  assert.equal(costEvidenceSumMicroCents(zeilen), 120);
  assert.equal(costEvidenceSumMicroCents([]), 0);
  assert.equal(costEvidenceSumMicroCents(zeilen.slice(3)), 0);
});
