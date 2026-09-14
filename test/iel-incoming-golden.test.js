// IEL-B1-GOLDEN — GOLDEN MASTER des Inbound-TeXML fuer /voice/incoming.
//
// Gegenstand ist genau EINE Zusage: solange der EL-Inbound-Schalter aus ist ODER der
// anrufende Tenant nicht gepinnt ist, bleibt das ausgelieferte TeXML byte-identisch zum
// heutigen Budget-Pfad. Das Fixture wurde VOR jeder Produktionsaenderung dieser Kette
// aufgenommen (Muster test/b3-wire-golden-master.test.js).
//
// Neu aufnehmen (und nur dann, wenn eine Aenderung des Inbound-TeXML ausdruecklich
// gewollt ist):
//
//     IEL_GOLDEN_RECORD=1 node --test test/iel-incoming-golden.test.js
//
// Der Aufnahme-Zweig ist kein toter Code, sondern der einzige reproduzierbare Weg, die
// Fixture zu erzeugen.
//
// Sprache "de" wird am Seed gepinnt, unabhaengig vom Weltdefault-Schalter (Lehre
// i18n-w3-bahn12).
//
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang (package.json
// config.i18nCatalogPattern) - Praefix ist "IEL-B1-GOLDEN-<n>:".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, postTelnyxIncoming, seedWithTelnyxNumber, normalizeIncomingTexml } from "./helpers.js";

const RECORD = process.env.IEL_GOLDEN_RECORD === "1";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PATH = path.join(ROOT, "test", "fixtures", "iel-incoming-budget-golden.xml");
const HTTP_OK = 200;
const GOLDEN_CALL_SID = "CAielgolden";
const GOLDEN_LANGUAGE = "de";

async function renderIncoming(env) {
  const srv = await startServer({ env, seed: seedWithTelnyxNumber({ language: GOLDEN_LANGUAGE }) });
  try {
    const res = await postTelnyxIncoming(srv, { callSid: GOLDEN_CALL_SID });
    assert.equal(res.status, HTTP_OK);
    return { texml: normalizeIncomingTexml(await res.text()), stdout: srv.stdout };
  } finally {
    await srv.stop();
  }
}

function goldenFixture() {
  return fs.readFileSync(FIXTURE_PATH, "utf8");
}

test("IEL-B1-GOLDEN-1: Schalter aus, Default-Env - Inbound-TeXML byte-identisch zum Golden Master", async () => {
  const { texml } = await renderIncoming({});
  if (RECORD) {
    fs.writeFileSync(FIXTURE_PATH, `${texml}\n`);
    return;
  }
  assert.equal(`${texml}\n`, goldenFixture());
});
