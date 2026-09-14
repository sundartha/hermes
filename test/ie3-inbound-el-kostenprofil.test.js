// IE3 (PLAN-INBOUND-PARITAET.md): das Kostenprofil telnyx_inbound_el_convai - seine zwei
// Traeger mit echten Einsammlern, seine fail-closed UNGEMESSEN-Pflichtmenge, der neue
// Boot-Riegel (el_inbound_carrier_uncollected) und die Verdrahtung am gespawnten Server.
//
// Der Testname traegt das Praefix IE3- (kein i18n-Katalog-, kein Abnahme-Praefix): diese
// Faelle sind Regressionsschutz und gehoeren in den npm-test-Lauf.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KOSTENPROFIL,
  KOSTENPROFILE,
  KOSTENART,
  EINSAMMLER,
  PFLICHTTYPEN_UNGEMESSEN,
  pflichttypenFuerProfil,
  pflichtTraegerFuerProfil,
  legacyKostenprofil,
  kostenprofilFuerAnruf,
} from "../src/billing/kostenarten.js";
import { latentCostPathFindings, LATENT_COST_PATH_FINDING } from "../src/boot-guard.js";
import { sweepTraegerFuerProfil } from "../src/billing/sweep-kostenbeleg.js";
import { startServer } from "./helpers.js";

const HTTP_OK = 200;
// Der heutige Live-Wert von COST_TRUING_REQUIRED_RECORD_TYPES, als Testeingabe fuer die
// Gegenprobe in IE3-3: fuer die Env-Marker-Profile MUSS pflichttypenFuerProfil genau
// diese Referenz zurueckgeben, fuer das neue Profil darf es sie NICHT.
const ENV_PFLICHTTYPEN = ["sip-trunking", "call-control"];
// Ein gesetzter, aber nie registrierter Profilwert - die fail-closed Gegenprobe.
const UNBEKANNTES_PROFIL = "unbekanntes_profil";
// Eine SIP-Gespraechskennung, wie der EL-Outbound-Weg sie am Anruf hinterlaesst.
const SIP_CALL_ID = "otb_x";

test("IE3-1: das neue Profil steht mit ZWEI Traegern und echten Einsammlern in der Registry", () => {
  const profil = KOSTENPROFILE[KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI];
  assert.ok(profil, "Profil telnyx_inbound_el_convai fehlt in der Registry");
  assert.deepEqual(profil.traeger, {
    [KOSTENART.ELEVENLABS_CONVAI]: { einsammler: EINSAMMLER.KV2_4 },
    [KOSTENART.TELNYX_CALL_RECORDS]: { einsammler: EINSAMMLER.KV2_5G },
  });
  assert.equal(
    Object.hasOwn(profil.traeger, KOSTENART.TELNYX_SIP),
    false,
    "telnyx_sip gehoert hier NICHT hin, solange die Messung IE1/F-D offen ist (kein Traeger ohne Messung)",
  );
});

test("IE3-2 (Reihenfolge-Riegel, B12): sipCallId ohne gesetztes Profil bleibt el_convai_sip - auch inbound", () => {
  assert.equal(
    legacyKostenprofil({ sipCallId: SIP_CALL_ID, direction: "inbound" }),
    KOSTENPROFIL.EL_CONVAI_SIP,
    "sipCallId entscheidet ZUERST und richtungsunabhaengig - unveraendertes Bestandsverhalten",
  );
  assert.equal(
    legacyKostenprofil({ sipCallId: null, direction: "inbound" }),
    KOSTENPROFIL.TELNYX_INBOUND_BUDGET,
  );
  assert.equal(
    kostenprofilFuerAnruf({
      costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
      sipCallId: SIP_CALL_ID,
    }),
    KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
    "ein gesetztes, bekanntes Profil gewinnt - die Legacy-Reihenfolge wird nicht ueberschrieben",
  );
});

test("IE3-3 (fail-closed): pflichttypenFuerProfil liefert fuer das neue Profil die UNGEMESSEN-Menge, NICHT den Env-Wert", () => {
  assert.equal(
    pflichttypenFuerProfil(KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI, ENV_PFLICHTTYPEN),
    PFLICHTTYPEN_UNGEMESSEN,
    "Referenzgleichheit mit der benannten UNGEMESSEN-Konstante, nicht bloss 'leer'",
  );
  // Positiv-Kontrolle: ohne sie saehe "liefert nicht den Env-Wert" aus wie eine Funktion,
  // die ueberhaupt nichts liefert (Lehre pruefkommando-ohne-positiv-kontrolle).
  assert.equal(
    pflichttypenFuerProfil(KOSTENPROFIL.TELNYX_INBOUND_BUDGET, ENV_PFLICHTTYPEN),
    ENV_PFLICHTTYPEN,
    "die Env-Marker-Profile geben dieselbe Referenz zurueck - die Funktion liefert also etwas",
  );
});

test("IE3-4 (Gegenprobe): Schalter an OHNE belegten Kostenpfad -> genau ein FATALER Befund mit Handlung", () => {
  const findings = latentCostPathFindings({
    playTtsEnabled: false,
    elInboundEnabled: true,
    elInboundCarrierHasCollector: false,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, LATENT_COST_PATH_FINDING.EL_INBOUND_CARRIER_UNCOLLECTED);
  assert.equal(findings[0].fatal, true);
  assert.match(findings[0].message, /telnyx_inbound_el_convai/);
  assert.match(findings[0].message, /Handlung:/);
});

test("IE3-4b (Sache, nicht Schalter): Schalter an MIT Einsammler -> kein Befund", () => {
  const findings = latentCostPathFindings({
    playTtsEnabled: false,
    elInboundEnabled: true,
    elInboundCarrierHasCollector: true,
  });
  assert.deepEqual(findings, [], "der Riegel haengt am Kostenpfad, nicht am Schalternamen");
});

test("IE3-4c: Schalter aus, kein Einsammler -> kein Befund", () => {
  const findings = latentCostPathFindings({
    playTtsEnabled: false,
    elInboundEnabled: false,
    elInboundCarrierHasCollector: false,
  });
  assert.deepEqual(findings, []);
});

test("IE3-4d: die echte Ableitung - pflichtTraegerFuerProfil traegt das neue Profil, ein unbekanntes nicht", () => {
  assert.ok(
    pflichtTraegerFuerProfil(KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI).length > 0,
    "genau dieser Ausdruck speist elInboundCarrierHasCollector in boot.js",
  );
  assert.equal(pflichtTraegerFuerProfil(UNBEKANNTES_PROFIL).length, 0);
});

// Welchen Sweep-Traeger MUSS ein Profil laut Registry bekommen? Abgeleitet aus den
// Traegern des Profils, nicht aus der Liste in sweep-kostenbeleg.js - genau darin liegt
// der Riegel: die Liste ist die zweite Stelle, die Registry die erste.
function erwarteterSweepTraeger(traegerNamen) {
  if (traegerNamen.includes(KOSTENART.TELNYX_SIP)) return KOSTENART.TELNYX_SIP;
  if (traegerNamen.includes(KOSTENART.TELNYX_CALL_RECORDS)) return KOSTENART.TELNYX_CALL_RECORDS;
  return null;
}

test("IE3-5 (abgeleiteter Riegel): jedes Profil mit telnyx_call_records liefert diesen Sweep-Traeger - kein Profil faellt aus der Liste", () => {
  for (const [name, profil] of Object.entries(KOSTENPROFILE)) {
    const erwartet = erwarteterSweepTraeger(Object.keys(profil.traeger));
    assert.equal(
      sweepTraegerFuerProfil(name),
      erwartet,
      `sweepTraegerFuerProfil('${name}') laeuft gegen die Profil-Registry auseinander - ` +
        "ein Profil, das telnyx_call_records fuehrt, aber nicht in TELNYX_CALL_RECORDS_PROFILE " +
        "steht, bekommt seine Beleg-Zeile NIE (offeneTraeger bleibt fuer immer nicht-leer). " +
        "Traegt ein Profil je BEIDE Telnyx-Traeger, ist dieser Test absichtlich rot und " +
        "verlangt die Praezedenz-Entscheidung ('kein Anruf bekommt beide').",
    );
  }
});

test("IE3-6 (Verdrahtung, Spawn): ELEVENLABS_INBOUND_ENABLED=true bootet sauber - kein el_inbound_carrier_uncollected", async () => {
  const srv = await startServer({ env: { ELEVENLABS_INBOUND_ENABLED: "true" } });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, HTTP_OK);
    assert.doesNotMatch(srv.stdout, /el_inbound_carrier_uncollected/);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
  } finally {
    await srv.stop();
  }
});

test("IE3-8 (Regression, Default-Konfiguration): Schalter aus -> die Registry ist der einzige Unterschied, kein neuer Boot-Befund", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, HTTP_OK);
    assert.doesNotMatch(srv.stdout, /el_inbound_carrier_uncollected/);
  } finally {
    await srv.stop();
  }
});
