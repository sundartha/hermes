import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KOSTENPROFIL,
  PFLICHTTYPEN_UNGEMESSEN,
  istBekanntesKostenprofil,
  kostenprofilFuerAnruf,
  legacyKostenprofil,
  pflichtTraegerFuerProfil,
  pflichttypenFuerProfil,
  pruefeKostenart,
  pruefeProfil,
} from "../../src/billing/kostenarten.js";

const ENV_PFLICHTTYPEN = Object.freeze(["sip-trunking", "recording"]);

const VOLLE_ZEILE = Object.freeze({ quelle: "q", waehrung: "USD", pflicht: false, preisquelle: "p" });
const GUTES_PROFIL = Object.freeze({
  pflichttypen: Object.freeze(["sip-trunking"]),
  traeger: { elevenlabs_convai: { einsammler: "KV2-4" } },
});

test("Kostenprofil bekannt: jedes echte Profil ja, fremde Werte nein, Zeichenketten-Umwandlung wie bisher", () => {
  const faelle = [
    [KOSTENPROFIL.EL_CONVAI_SIP, true],
    [KOSTENPROFIL.TELNYX_BUDGET, true],
    [KOSTENPROFIL.TELNYX_INBOUND_BUDGET, true],
    [KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI, true],
    [KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI, true],
    [["telnyx_budget"], true],
    ["constructor", false],
    ["__proto__", false],
    ["toString", false],
    ["EL_CONVAI_SIP", false],
    ["", false],
    [undefined, false],
    [null, false],
    [5, false],
    [{}, false],
  ];
  for (const [wert, erwartet] of faelle) assert.equal(istBekanntesKostenprofil(wert), erwartet);
});

test("Pflichttypen je Profil: Env-Menge, feste Liste oder ungemessen, fremde Profile ungemessen", () => {
  assert.deepEqual(pflichttypenFuerProfil(KOSTENPROFIL.EL_CONVAI_SIP, ENV_PFLICHTTYPEN), ["sip-trunking"]);
  assert.equal(pflichttypenFuerProfil(KOSTENPROFIL.TELNYX_BUDGET, ENV_PFLICHTTYPEN), ENV_PFLICHTTYPEN);
  assert.equal(pflichttypenFuerProfil(KOSTENPROFIL.TELNYX_INBOUND_BUDGET, ENV_PFLICHTTYPEN), ENV_PFLICHTTYPEN);
  assert.equal(pflichttypenFuerProfil(KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI, ENV_PFLICHTTYPEN), PFLICHTTYPEN_UNGEMESSEN);
  assert.equal(pflichttypenFuerProfil(KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI, ENV_PFLICHTTYPEN), PFLICHTTYPEN_UNGEMESSEN);
  for (const fremd of ["constructor", "__proto__", "", undefined, null, 7])
    assert.equal(pflichttypenFuerProfil(fremd, ENV_PFLICHTTYPEN), PFLICHTTYPEN_UNGEMESSEN);
});

test("Pflichttraeger je Profil: nur Traeger mit Beleg-Einsammler, fremde Profile keine", () => {
  assert.deepEqual(pflichtTraegerFuerProfil(KOSTENPROFIL.EL_CONVAI_SIP), ["elevenlabs_convai", "telnyx_sip"]);
  assert.deepEqual(pflichtTraegerFuerProfil(KOSTENPROFIL.TELNYX_BUDGET), ["telnyx_call_records"]);
  assert.deepEqual(pflichtTraegerFuerProfil(KOSTENPROFIL.TELNYX_INBOUND_BUDGET), ["telnyx_call_records"]);
  assert.deepEqual(pflichtTraegerFuerProfil(KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI), [
    "elevenlabs_convai",
    "telnyx_call_records",
  ]);
  assert.deepEqual(pflichtTraegerFuerProfil(KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI), [
    "elevenlabs_convai",
    "telnyx_call_records",
  ]);
  for (const fremd of ["constructor", "__proto__", "", undefined, null])
    assert.deepEqual(pflichtTraegerFuerProfil(fremd), []);
});

test("Kostenprofil je Anruf: gespeichertes Profil gewinnt, sonst Herleitung aus SIP-Kennung und Richtung", () => {
  const faelle = [
    [{ costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI, sipCallId: "sip" }, KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI],
    [{ costProfile: "fremdes_profil", sipCallId: "sip" }, "fremdes_profil"],
    [{ costProfile: "", sipCallId: "sip" }, ""],
    [{ costProfile: null, sipCallId: "sip" }, KOSTENPROFIL.EL_CONVAI_SIP],
    [{ sipCallId: "sip", direction: "inbound" }, KOSTENPROFIL.EL_CONVAI_SIP],
    [{ direction: "inbound" }, KOSTENPROFIL.TELNYX_INBOUND_BUDGET],
    [{ direction: "outbound" }, KOSTENPROFIL.TELNYX_BUDGET],
    [{}, KOSTENPROFIL.TELNYX_BUDGET],
    [null, KOSTENPROFIL.TELNYX_BUDGET],
    [undefined, KOSTENPROFIL.TELNYX_BUDGET],
  ];
  for (const [anruf, erwartet] of faelle) assert.equal(kostenprofilFuerAnruf(anruf), erwartet);
  assert.equal(legacyKostenprofil({ sipCallId: "sip", direction: "inbound" }), KOSTENPROFIL.EL_CONVAI_SIP);
});

test("Katalogzeile pruefen: gueltige Zeilen bestehen, ungueltige werfen mit dem bisherigen Text", () => {
  const faelle = [
    [{ ...VOLLE_ZEILE }, undefined],
    [{ ...VOLLE_ZEILE, pflicht: true }, undefined],
    [{ ...VOLLE_ZEILE, pflicht: true, waehrung: "EUR" }, undefined],
    [{ ...VOLLE_ZEILE, belegtypen: ["a"] }, undefined],
    [{ ...VOLLE_ZEILE, quelle: "  " }, /'x'\.quelle fehlt oder ist leer/],
    [{ ...VOLLE_ZEILE, waehrung: 3 }, /'x'\.waehrung fehlt oder ist leer/],
    [{ ...VOLLE_ZEILE, preisquelle: "" }, /'x'\.preisquelle fehlt oder ist leer/],
    [{ ...VOLLE_ZEILE, pflicht: "ja" }, /'x'\.pflicht fehlt oder ist kein Boolean/],
    [{ ...VOLLE_ZEILE, pflicht: true, waehrung: "Bucket" }, /belegpflichtig, traegt aber keine harte Waehrung/],
    [{ ...VOLLE_ZEILE, belegtypen: [] }, /'x'\.belegtypen ist kein nicht-leeres String-Array/],
    [{ ...VOLLE_ZEILE, belegtypen: [" "] }, /'x'\.belegtypen ist kein nicht-leeres String-Array/],
  ];
  for (const [zeile, fehler] of faelle) {
    if (fehler === undefined) assert.doesNotThrow(() => pruefeKostenart("x", zeile));
    else assert.throws(() => pruefeKostenart("x", zeile), fehler);
  }
});

test("Profil pruefen: gueltiges besteht, fehlerhafte Traeger und Pflichttypen werfen mit dem bisherigen Text", () => {
  const faelle = [
    [GUTES_PROFIL, undefined],
    [{ ...GUTES_PROFIL, pflichttypen: "aus_env_pflichtmenge" }, undefined],
    [{ ...GUTES_PROFIL, pflichttypen: PFLICHTTYPEN_UNGEMESSEN }, undefined],
    [null, /Profil 'x'\.traeger ist kein Objekt/],
    [undefined, /Profil 'x'\.traeger ist kein Objekt/],
    [{ ...GUTES_PROFIL, traeger: null }, /Profil 'x'\.traeger ist kein Objekt/],
    [{ ...GUTES_PROFIL, traeger: [] }, /Profil 'x'\.traeger ist kein Objekt/],
    [{ ...GUTES_PROFIL, traeger: "t" }, /Profil 'x'\.traeger ist kein Objekt/],
    [{ ...GUTES_PROFIL, traeger: {} }, /Profil 'x'\.traeger ist leer/],
    [{ ...GUTES_PROFIL, traeger: { unbekannt: { einsammler: "KV2-4" } } }, /Traeger 'unbekannt' ohne Katalogzeile/],
    [{ ...GUTES_PROFIL, traeger: { sms: null } }, /Traeger 'sms' - einsammler fehlt/],
    [{ ...GUTES_PROFIL, traeger: { sms: 4 } }, /Traeger 'sms' - einsammler fehlt/],
    [{ ...GUTES_PROFIL, traeger: { sms: "text" } }, /Traeger 'sms' - einsammler fehlt/],
    [{ ...GUTES_PROFIL, traeger: { sms: {} } }, /Traeger 'sms' - einsammler fehlt/],
    [{ ...GUTES_PROFIL, traeger: { sms: { einsammler: "frei" } } }, /Traeger 'sms' - einsammler fehlt/],
    [{ ...GUTES_PROFIL, traeger: { sms: { einsammler: 4 } } }, /Traeger 'sms' - einsammler fehlt/],
    [{ ...GUTES_PROFIL, pflichttypen: ["a"] }, /pflichttypen ist weder der Env-Marker/],
    [{ ...GUTES_PROFIL, pflichttypen: Object.freeze([]) }, /pflichttypen ist weder der Env-Marker/],
  ];
  for (const [profil, fehler] of faelle) {
    if (fehler === undefined) assert.doesNotThrow(() => pruefeProfil("x", profil));
    else assert.throws(() => pruefeProfil("x", profil), fehler);
  }
});
