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

const TARGET_DOMESTIC = "+4915112345678";
const TARGET_INTERNATIONAL = "+12025550143";

test("Produktionskonfiguration (GAP-33) Meta: prodEnv() setzt jeden in BASE_ENV neutralisierten Gate-Schluessel auf den ausgelieferten Wert", () => {
  const env = prodEnv();
  const uncovered = divergentGateKeys().filter((key) => env[key] !== LIVE_ENV[key]);
  assert.deepEqual(
    uncovered,
    [],
    `Diese Env-Vars sind in BASE_ENV neutralisiert und live scharf gestellt, ` +
      `ohne dass ein Lauf sie auf den ausgelieferten Wert setzt: ${uncovered.join(", ")}`,
  );
});

test("Produktionskonfiguration (GAP-33) Meta: die ungemessenen Achsen sind widerspruchsfrei und keine Karteileichen", () => {
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

  const doubled = Object.keys(LIVE_UNMEASURED).filter((key) => key in PROD_ENV_EXEMPTIONS);
  assert.deepEqual(
    doubled,
    [],
    `Steht in beiden Ersatzwert-Listen - der tatsaechlich gefahrene Wert ist damit ` +
      `nicht mehr ablesbar: ${doubled.join(", ")}`,
  );
});

test("Produktionskonfiguration (GAP-33): der Server bootet unter den ausgelieferten Live-Werten", async () => {
  const srv = await startServer({ env: prodEnv() });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200, "Boot unter ausgelieferten Werten muss /healthz bedienen");
  } finally {
    await srv.stop();
  }
});

test("Produktionskonfiguration (GAP-33): Outbound ins Inland kommt unter ausgelieferten Werten bis zum Provider durch", async () => {
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

test("Produktionskonfiguration (GAP-33): Outbound ins Ausland kommt unter ausgelieferten Werten bis zum Provider durch", async () => {
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

test("Produktionskonfiguration (GAP-33): der Blueprint render.yaml ist startfaehig", async () => {
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
