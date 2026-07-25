// GAP-33 - Produktionskonfigurations-Smoke: die Suite faehrt die AUSGELIEFERTE Env.
//
// Der wichtigste Einzeltest von PLAN-I18N-TESTS.md (Kapitel 5, Abbruchpunkt W1): ohne
// ihn beweist kein gruener Test etwas ueber Produktion, weil test/helpers.js BASE_ENV
// genau die Gates neutralisiert, um die es beim internationalen Launch geht.
//
// Fuenf Aussagen, in dieser Reihenfolge:
//   1. Meta - prodEnv() laesst keinen in BASE_ENV neutralisierten Gate-Schluessel aus.
//      Automatisch abgeleitet: eine kuenftig neu neutralisierte Env-Var faellt hier auf,
//      ohne dass jemand eine Liste pflegt.
//   2. Meta - die Liste der ungemessenen Achsen bleibt widerspruchsfrei und lebendig.
//   3. Die Live-Konfiguration bootet (ein Boot-Refusal macht jede weitere Aussage leer).
//   4. Outbound kommt unter den Live-Werten bis zum Provider-Aufruf durch - je einmal
//      auf der Inlands-Tarifachse und auf der Auslands-Tarifachse.
//   5. BEFUND - der Blueprint render.yaml ist nicht startfaehig.
//
// Signal fuer (4): TWILIO_ACCOUNT_SID ist ein Dummy ohne "AC"-Praefix (PROD_DUMMY_SECRETS),
// der Twilio-Client wirft damit synchron VOR jedem Netzzugriff. 500 = alle Gates passiert,
// 403/429/402 = ein Gate hat gesperrt. Kein Netz, kein echter Anruf.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, placeCall } from "./helpers.js";
import {
  LIVE_ENV,
  LIVE_MEASURED,
  LIVE_UNMEASURED,
  PROD_ENV_EXEMPTIONS,
  RENDER_ENV,
  blueprintEnv,
  divergentGateKeys,
  prodEnv,
} from "./prod-env.js";

// Inlandsziel: +49 steht in VOICE_TARIFF_DOMESTIC_PREFIXES (src/config.js:105) und faehrt
// damit den guenstigen Satz.
const TARGET_DOMESTIC = "+4915112345678";
// Auslandsziel: +1 steht NICHT in VOICE_TARIFF_DOMESTIC_PREFIXES. Nach der Owner-
// Entscheidung 7.11 (weltweiter Start, alle Maerkte gleichzeitig) muss auch dieses Ziel
// durchkommen - der Test formuliert diesen Sollzustand (kanonische Liste R1).
const TARGET_INTERNATIONAL = "+12025550143";

test("GAP-33 Meta: prodEnv() setzt jeden in BASE_ENV neutralisierten Gate-Schluessel auf den ausgelieferten Wert", () => {
  const env = prodEnv();
  const uncovered = divergentGateKeys().filter((key) => env[key] !== LIVE_ENV[key]);
  assert.deepEqual(
    uncovered,
    [],
    `Diese Env-Vars sind in BASE_ENV neutralisiert und live scharf gestellt, ` +
      `ohne dass ein Lauf sie auf den ausgelieferten Wert setzt: ${uncovered.join(", ")}`,
  );
});

test("GAP-33 Meta: die ungemessenen Achsen sind widerspruchsfrei und keine Karteileichen", () => {
  const contradicting = Object.keys(LIVE_UNMEASURED).filter((key) => key in LIVE_MEASURED);
  assert.deepEqual(
    contradicting,
    [],
    `Als ungemessen gefuehrt UND gleichzeitig gemessen - einer der beiden Eintraege ist ` +
      `falsch: ${contradicting.join(", ")}`,
  );

  const orphaned = Object.keys(LIVE_UNMEASURED).filter((key) => !(key in RENDER_ENV));
  assert.deepEqual(
    orphaned,
    [],
    `Als ungemessen gefuehrt, kommt aber in render.yaml gar nicht mehr vor - der Eintrag ` +
      `ist tot und verschleiert nur noch eine Luecke: ${orphaned.join(", ")}`,
  );

  // Beide Listen beschreiben "nicht live-belegt", aber mit verschiedenem Ersatzwert
  // (Blueprint-Wert gegen BASE_ENV-Wert). Ein Schluessel in beiden Listen hiesse, dass
  // unklar ist, welcher Wert tatsaechlich laeuft.
  const doubled = Object.keys(LIVE_UNMEASURED).filter((key) => key in PROD_ENV_EXEMPTIONS);
  assert.deepEqual(
    doubled,
    [],
    `Steht in beiden Ersatzwert-Listen - der tatsaechlich gefahrene Wert ist damit ` +
      `nicht mehr ablesbar: ${doubled.join(", ")}`,
  );
});

test("GAP-33: der Server bootet unter den ausgelieferten Live-Werten", async () => {
  const srv = await startServer({ env: prodEnv() });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200, "Boot unter ausgelieferten Werten muss /healthz bedienen");
  } finally {
    await srv.stop();
  }
});

test("GAP-33: Outbound ins Inland kommt unter ausgelieferten Werten bis zum Provider durch", async () => {
  const srv = await startServer({ env: prodEnv() });
  try {
    const res = await placeCall(srv, TARGET_DOMESTIC);
    assert.equal(
      res.status,
      500,
      `${TARGET_DOMESTIC} muss unter den ausgelieferten Werten alle Gates passieren, ` +
        `Antwort war ${res.status}: ${await res.text()}`,
    );
  } finally {
    await srv.stop();
  }
});

test("GAP-33: Outbound ins Ausland kommt unter ausgelieferten Werten bis zum Provider durch", async () => {
  const srv = await startServer({ env: prodEnv() });
  try {
    const res = await placeCall(srv, TARGET_INTERNATIONAL);
    assert.equal(
      res.status,
      500,
      `${TARGET_INTERNATIONAL} muss unter den ausgelieferten Werten alle Gates passieren ` +
        `(Owner-Entscheidung 7.11: weltweiter Start), Antwort war ${res.status}: ` +
        `${await res.text()}`,
    );
  } finally {
    await srv.stop();
  }
});

// Abgrenzung zu test/env-docs-spend-cap-coherence.test.js:127 (LCT P6): jener Test rechnet
// STATISCH EINE Achse nach (plan_cap_inert aus MAX_BUDGET_EUR) und pinnt sie bewusst als
// bekannte Luecke, mit Aufhebungsanleitung im Kommentar. Dieser hier startet den Prozess
// wirklich und deckt damit JEDEN Boot-Blocker des Blueprints - er hat den zweiten,
// unabhaengigen Blocker (COST_TRUING_REQUIRED_RECORD_TYPES leer, render.yaml:212-213)
// ueberhaupt erst sichtbar gemacht. Wer MAX_BUDGET_EUR im Blueprint anhebt, dreht dort die
// Assertion und muss hier NICHTS aendern - dieser Test wird von selbst gruen, sobald der
// Blueprint wirklich startet.
test("GAP-33 Befund: der Blueprint render.yaml ist startfaehig", async () => {
  let srv = null;
  try {
    srv = await startServer({ env: blueprintEnv() });
  } catch (err) {
    assert.fail(
      `render.yaml ist die einzige versionierte Beschreibung des Dienstes und damit der ` +
        `Wiederherstellungs-Pfad - ein Deploy daraus startet nicht: ${err.message}`,
    );
  }
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200, "Boot unter den Blueprint-Werten muss /healthz bedienen");
  } finally {
    await srv.stop();
  }
});
