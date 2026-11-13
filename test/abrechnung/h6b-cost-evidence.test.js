import assert from "node:assert/strict";
import { test } from "node:test";

import {
  callCostEvidence,
  createCall,
  makeDefaultState,
  recordCallCostEvidence,
  registerTenant,
} from "../../src/store/state-ops.js";
import { settlementProjektion } from "../../src/billing/kosten-projektion.ts";
import { KOSTENART } from "../../src/billing/kostenarten.js";
import { REIFE } from "../../src/begriffe/abrechnung.js";

const TELNYX = KOSTENART.TELNYX_CALL_RECORDS;
const REF_MAX = 128;
const TEXT_MAX = 64;
const QUELLE_MAX = 64;

const TENANT_ID = "t_h6b";
const ANDERER_TRAEGER = KOSTENART.AI_TOKEN;

function neu() {
  const state = makeDefaultState();
  registerTenant(state, TENANT_ID);
  const call = createCall(state, {
    direction: "outbound",
    from: "+49123",
    to: "+49456",
    tenantId: TENANT_ID,
  });
  return { state, callId: call.id };
}

function buche(umgebung, extra) {
  return recordCallCostEvidence(umgebung.state, {
    callId: umgebung.callId,
    traeger: TELNYX,
    reife: REIFE.BELEGT,
    ...extra,
  });
}

function zeileVon(umgebung, traeger = TELNYX) {
  return callCostEvidence(umgebung.state, umgebung.callId).find((zeile) => zeile.traeger === traeger);
}

test("h6b belegRef: Muster und Laenge", () => {
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
  ];
  for (const [wert, gueltig] of tabelle) {
    const umgebung = neu();
    if (gueltig) {
      buche(umgebung, { belegRef: wert });
      assert.equal(zeileVon(umgebung).belegRef, wert);
    } else {
      assert.throws(
        () => buche(umgebung, { belegRef: wert }),
        { message: `cost-evidence: belegRef '${wert}' hat kein gueltiges Format` },
        String(wert),
      );
    }
  }
});

test("h6b Traeger und Reife: nur bekannte werden gebucht", () => {
  const umgebung = neu();
  for (const reife of Object.values(REIFE)) {
    const traeger = reife === REIFE.STRUKTURELL_UNBESCHAFFBAR ? ANDERER_TRAEGER : TELNYX;
    assert.doesNotThrow(() => buche(umgebung, { traeger, reife }), reife);
  }
  for (const traeger of ["toString", "unbekannt"])
    assert.throws(
      () => buche(umgebung, { traeger }),
      { message: `cost-evidence: unbekannter Traeger '${traeger}'` },
      traeger,
    );
  assert.throws(() => buche(umgebung, { reife: "fertig" }), {
    message: "cost-evidence: unbekannte Reife 'fertig'",
  });
});

test("h6b Reife-Wechsel: Fortschritt ja, Rueckschritt nein, Terminal bleibt", () => {
  const { ERWARTET, VORLAEUFIG, BELEGT, STRUKTURELL_UNBESCHAFFBAR: ENDE } = REIFE;
  const tabelle = [
    [ERWARTET, ERWARTET, true],
    [ERWARTET, VORLAEUFIG, true],
    [ERWARTET, BELEGT, true],
    [VORLAEUFIG, VORLAEUFIG, true],
    [VORLAEUFIG, BELEGT, true],
    [BELEGT, BELEGT, true],
    [VORLAEUFIG, ERWARTET, false],
    [BELEGT, VORLAEUFIG, false],
    [BELEGT, ERWARTET, false],
    [ERWARTET, ENDE, true],
    [BELEGT, ENDE, true],
    [ENDE, ENDE, true],
    [ENDE, BELEGT, false],
    [ENDE, ERWARTET, false],
  ];
  for (const [von, nach, erlaubt] of tabelle) {
    const umgebung = neu();
    buche(umgebung, { reife: von });
    if (erlaubt) {
      const { evidence } = buche(umgebung, { reife: nach });
      assert.equal(evidence.reife, nach, `${von} -> ${nach}`);
    } else {
      assert.throws(
        () => buche(umgebung, { reife: nach }),
        { message: new RegExp(`Reife-Rueckschritt '${von}' -> '${nach}'`) },
        `${von} -> ${nach}`,
      );
    }
  }
});

test("h6b Terminal: gleiche Reife aendert nichts, andere Reifen melden changed", () => {
  const umgebung = neu();
  buche(umgebung, { reife: REIFE.STRUKTURELL_UNBESCHAFFBAR, versuche: 1 });
  const wieder = buche(umgebung, { reife: REIFE.STRUKTURELL_UNBESCHAFFBAR, versuche: 5 });
  assert.equal(wieder.changed, false);
  assert.equal(wieder.evidence.versuche, 1);
  const andere = neu();
  buche(andere, { reife: REIFE.VORLAEUFIG });
  const zweite = buche(andere, { reife: REIFE.VORLAEUFIG, versuche: 2 });
  assert.equal(zweite.changed, true);
  assert.equal(zweite.evidence.versuche, 2);
});

test("h6b Detail: nur erlaubte Preis- und Mengenfelder bleiben", () => {
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
    [{ rate: 1, inner: { rate: 2 }, tier: "a" }, { rate: 1, tier: "a" }],
    [{ a: { b: { c: { d: { e: { rate: 1 } } } } } }, { rate: 1 }],
    [{ a: { b: { c: { d: { e: { f: { rate: 1 } } } } } } }, null],
    [null, null],
    ["rate", null],
    [5, null],
    [true, null],
  ];
  for (const [roh, erwartet] of tabelle) {
    const umgebung = neu();
    buche(umgebung, { detail: roh });
    const detail = zeileVon(umgebung).detail;
    assert.deepEqual(detail, erwartet, JSON.stringify(roh));
    if (erwartet !== null) assert.equal(Object.isFrozen(detail), true);
  }
});

function eingabe(extra = {}) {
  return { reife: REIFE.BELEGT, ...extra };
}

test("h6b Eingabe: gueltige Eingaben werden gebucht", () => {
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
  for (const e of gueltig) assert.doesNotThrow(() => buche(neu(), e), JSON.stringify(e));
});

test("h6b Eingabe: Fehlertexte je Verstoss", () => {
  const zaehler = "muss eine nicht-negative Ganzzahl sein";
  const tabelle = [
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
    [
      eingabe({ betragMikroCents: 5, waehrung: "" }),
      "cost-evidence: ein Betrag ohne Waehrung ist nicht buchbar",
    ],
    [eingabe({ quelle: "Gross" }), "cost-evidence: quelle 'Gross' hat kein gueltiges Format"],
    [
      eingabe({ quelle: "a".repeat(QUELLE_MAX + 1) }),
      `cost-evidence: quelle '${"a".repeat(QUELLE_MAX + 1)}' hat kein gueltiges Format`,
    ],
    [eingabe({ versuche: -1 }), `cost-evidence: 'versuche' ${zaehler}`],
    [eingabe({ versuche: 1.5 }), `cost-evidence: 'versuche' ${zaehler}`],
    [eingabe({ abstandZumGespraechsendeS: -2 }), `cost-evidence: 'abstandZumGespraechsendeS' ${zaehler}`],
    [eingabe({ nachreifbar: "ja" }), "cost-evidence: 'nachreifbar' muss ein Boolean sein, nicht 'ja'"],
    [eingabe({ nachreifbar: null }), "cost-evidence: 'nachreifbar' muss ein Boolean sein, nicht 'null'"],
  ];
  for (const [e, text] of tabelle) assert.throws(() => buche(neu(), e), { message: text }, text);
});

test("h6b Zeile: Grundwerte und Wertfelder der Eingabe", () => {
  const leer = neu();
  const { evidence } = buche(leer, {});
  assert.match(evidence.id, /^cce_/);
  assert.deepEqual(
    { ...evidence, id: "x" },
    {
      id: "x",
      tenantId: TENANT_ID,
      callId: leer.callId,
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
    },
  );
  const voll = neu();
  const gesetzt = buche(voll, {
    betragMikroCents: 7,
    waehrung: "EUR",
    quelle: "api",
    belegRef: "r1",
    versuche: 3,
    gemessenAt: "2026-11-13T10:00:00.000Z",
    abstandZumGespraechsendeS: 90,
    detail: { rate: 2, geheim: "x" },
    nachreifbar: false,
  });
  assert.deepEqual(
    { ...gesetzt.evidence, id: "x" },
    {
      id: "x",
      tenantId: TENANT_ID,
      callId: voll.callId,
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
    },
  );
});

test("h6b Fortschreibung: nur gesetzte Felder, nachreifbar false bleibt false", () => {
  const umgebung = neu();
  buche(umgebung, { reife: REIFE.VORLAEUFIG, versuche: 4, belegRef: "r9", nachreifbar: false });
  buche(umgebung, { reife: REIFE.BELEGT, nachreifbar: true });
  const nachher = zeileVon(umgebung);
  assert.equal(nachher.nachreifbar, false);
  assert.equal(nachher.versuche, 4);
  assert.equal(nachher.belegRef, "r9");
  assert.equal(nachher.reife, REIFE.BELEGT);

  const offen = neu();
  buche(offen, { reife: REIFE.VORLAEUFIG, nachreifbar: true });
  buche(offen, { reife: REIFE.BELEGT, nachreifbar: false, detail: { tier: "a", rest: 1 } });
  assert.equal(zeileVon(offen).nachreifbar, false);
  assert.deepEqual(zeileVon(offen).detail, { tier: "a" });
  buche(offen, { reife: REIFE.BELEGT, versuche: 2 });
  assert.equal(zeileVon(offen).nachreifbar, false);
  assert.deepEqual(zeileVon(offen).detail, { tier: "a" });
  assert.equal(zeileVon(offen).versuche, 2);

  const frei = neu();
  buche(frei, { reife: REIFE.VORLAEUFIG });
  buche(frei, { reife: REIFE.BELEGT });
  assert.equal(zeileVon(frei).nachreifbar, true);
  buche(frei, { reife: REIFE.BELEGT, detail: undefined, versuche: 1 });
  assert.equal(zeileVon(frei).detail, null);
});

test("h6b Summe: nur vorlaeufige und belegte Zeilen mit gueltigem Betrag", () => {
  const summe = (belege) => settlementProjektion({ call: null, belege }).summeMikroCents;
  const zeilen = [
    { traeger: TELNYX, reife: REIFE.BELEGT, betragMikroCents: 100 },
    { traeger: TELNYX, reife: REIFE.VORLAEUFIG, betragMikroCents: 20 },
    { traeger: TELNYX, reife: REIFE.BELEGT, betragMikroCents: 0 },
    { traeger: TELNYX, reife: REIFE.ERWARTET, betragMikroCents: 500 },
    { traeger: TELNYX, reife: REIFE.STRUKTURELL_UNBESCHAFFBAR, betragMikroCents: 700 },
    { traeger: TELNYX, reife: REIFE.BELEGT, betragMikroCents: null },
    { traeger: TELNYX, reife: REIFE.BELEGT },
    { traeger: TELNYX, reife: REIFE.BELEGT, betragMikroCents: -5 },
    { traeger: TELNYX, reife: REIFE.BELEGT, betragMikroCents: 1.5 },
    { traeger: TELNYX, betragMikroCents: 9 },
  ];
  assert.equal(summe(zeilen.slice(0, 3)), 120);
  assert.equal(summe(zeilen.slice(2, 3)), 0);
  assert.equal(summe(zeilen.slice(3, 5)), null);
  assert.equal(summe(zeilen.slice(5, 7)), null);
  assert.equal(summe([]), null);
  assert.equal(summe([zeilen[0], zeilen[3], zeilen[4]]), 100);
  assert.equal(summe([zeilen[0], zeilen[7]]), 100);
  assert.equal(summe([zeilen[0], zeilen[8]]), 100);
  assert.equal(summe([zeilen[0], zeilen[9]]), 100);
});
