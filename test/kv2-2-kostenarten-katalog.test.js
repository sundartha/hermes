import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KOSTENARTEN,
  KOSTENPROFILE,
  KOSTENART,
  KOSTENPROFIL,
  EINSAMMLER,
  pruefeKostenart,
  pruefeProfil,
} from "../src/billing/kostenarten.js";
import { ASSIGNABLE_COST_RECORD_TYPES } from "../src/telephony/adapters/telnyx/voice.js";

const VOLLSTAENDIGE_ZEILE = { quelle: "x", waehrung: "USD", pflicht: true, preisquelle: "y" };

test("KV2-2-a1: fehlendes quelle wirft", () => {
  const { quelle: _quelle, ...rest } = VOLLSTAENDIGE_ZEILE;
  assert.throws(() => pruefeKostenart("x", rest), /quelle fehlt/);
});

test("KV2-2-a2: fehlendes waehrung wirft", () => {
  const { waehrung: _waehrung, ...rest } = VOLLSTAENDIGE_ZEILE;
  assert.throws(() => pruefeKostenart("x", rest), /waehrung fehlt/);
});

test("KV2-2-a3: fehlendes pflicht wirft", () => {
  const { pflicht: _pflicht, ...rest } = VOLLSTAENDIGE_ZEILE;
  assert.throws(() => pruefeKostenart("x", rest), /pflicht fehlt/);
});

test("KV2-2-a4: fehlendes preisquelle wirft", () => {
  const { preisquelle: _preisquelle, ...rest } = VOLLSTAENDIGE_ZEILE;
  assert.throws(() => pruefeKostenart("x", rest), /preisquelle fehlt/);
});

test("KV2-2-a5: pflicht:true mit weicher Waehrung wirft (harte Waehrung noetig)", () => {
  assert.throws(
    () => pruefeKostenart("x", { ...VOLLSTAENDIGE_ZEILE, waehrung: "Bucket" }),
    /belegpflichtig.*harte Waehrung/,
  );
});

test("KV2-2-a6 (Positivkontrolle): vollstaendige Zeile besteht pruefeKostenart", () => {
  assert.doesNotThrow(() => pruefeKostenart("x", VOLLSTAENDIGE_ZEILE));
});

test("KV2-2-a7: die Validierung lief zur BAUZEIT - der Import selbst ist der Beweis", () => {
  assert.ok(Object.isFrozen(KOSTENARTEN), "KOSTENARTEN ist eingefroren");
  for (const [name, zeile] of Object.entries(KOSTENARTEN)) {
    assert.doesNotThrow(() => pruefeKostenart(name, zeile), `Zeile '${name}' besteht die Pruefung`);
  }
});

const ERWARTETE_ANZAHL_KOSTENARTEN = 16;

test("KV2-2-d1: der Katalog hat GENAU 16 Zeilen (Loeschschutz, kein Vollstaendigkeitsbeweis)", () => {
  assert.equal(Object.keys(KOSTENARTEN).length, ERWARTETE_ANZAHL_KOSTENARTEN);
});

test("KV2-2-d2: die drei zuletzt ergaenzten Zeilen sind da", () => {
  assert.ok(Object.hasOwn(KOSTENARTEN, KOSTENART.TELNYX_INFERENCE));
  assert.ok(Object.hasOwn(KOSTENARTEN, KOSTENART.MAIL_ZUSAMMENFASSUNG));
  assert.ok(Object.hasOwn(KOSTENARTEN, KOSTENART.WORKOS_AUTH));
});

const telnyxCallRecordsZeile = KOSTENARTEN[KOSTENART.TELNYX_CALL_RECORDS];

test("KV2-2-g1: die belegtypen-Menge von telnyx_call_records == ASSIGNABLE_COST_RECORD_TYPES", () => {
  const katalogMenge = [...telnyxCallRecordsZeile.belegtypen].sort();
  const adapterMenge = [...ASSIGNABLE_COST_RECORD_TYPES].sort();
  assert.deepEqual(katalogMenge, adapterMenge);
});

test("KV2-2-g2 (Gegenprobe): die Menge ist nicht leer und enthaelt 'inference' NICHT", () => {
  const menge = telnyxCallRecordsZeile.belegtypen;
  assert.ok(menge.length > 0);
  assert.ok(!menge.includes("inference"), "inference gehoert zu Katalogzeile #15, nicht #3");
});

test("KV2-2-i1: ueber ALLE Profile/Traeger - einsammler ist Phasenkennung ODER nicht_belegpflichtig", () => {
  const erlaubt = new Set(Object.values(EINSAMMLER));
  for (const [profilName, profil] of Object.entries(KOSTENPROFILE)) {
    for (const [traeger, eintrag] of Object.entries(profil.traeger)) {
      assert.ok(
        erlaubt.has(eintrag.einsammler),
        `Profil '${profilName}', Traeger '${traeger}': einsammler '${eintrag.einsammler}' ist kein erlaubter Wert`,
      );
    }
  }
});

test("KV2-2-i2 (Gegenprobe auf einer KOPIE): ein dritter, freier Wert faellt durch - die echte Registry bleibt unberuehrt", () => {
  const kopie = structuredClone(KOSTENPROFILE);
  kopie.kunstprofil = { traeger: { [KOSTENART.TELNYX_SIP]: { einsammler: "irgendwas" } } };
  assert.throws(() => pruefeProfil("kunstprofil", kopie.kunstprofil), /einsammler/);
  const telnyxBudgetTraeger = KOSTENPROFILE[KOSTENPROFIL.TELNYX_BUDGET].traeger;
  assert.equal(telnyxBudgetTraeger[KOSTENART.TELNYX_CALL_RECORDS].einsammler, EINSAMMLER.KV2_5G);
});

test("KV2-2-i3: Biconditional Katalog <-> Registry (einsammler=nicht_belegpflichtig <=> Katalogzeile.pflicht===false)", () => {
  for (const profil of Object.values(KOSTENPROFILE)) {
    for (const [traeger, eintrag] of Object.entries(profil.traeger)) {
      const istNichtBelegpflichtig = eintrag.einsammler === EINSAMMLER.NICHT_BELEGPFLICHTIG;
      const katalogSagtNichtPflicht = KOSTENARTEN[traeger].pflicht === false;
      assert.equal(
        istNichtBelegpflichtig,
        katalogSagtNichtPflicht,
        `Traeger '${traeger}': einsammler-Nichtbelegpflicht und Katalog-pflicht widersprechen sich`,
      );
    }
  }
});

test("KV2-2-i4: jeder Profil-Traeger hat eine Katalogzeile", () => {
  for (const profil of Object.values(KOSTENPROFILE)) {
    for (const traeger of Object.keys(profil.traeger)) {
      assert.ok(Object.hasOwn(KOSTENARTEN, traeger), `Traeger '${traeger}' hat keine Katalogzeile`);
    }
  }
});
