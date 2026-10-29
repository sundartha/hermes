import assert from "node:assert/strict";
import { test } from "node:test";

import { befundSchluessel } from "../../tools/eslint-rules/bestand.js";
import { bestandsDatei } from "./hermes-regeln-probe.js";
import { probeDirectory } from "./probe-repo.js";
import { befundTexte, befundZeilen } from "./testregeln-probe.js";

const REGEL = "hermes-tests/anfrage-mit-frist";
const BESTAND = "tools/basis/anfrage-mit-frist.json";
const DATEI = "src/billing/probe.js";
const ANDERE_DATEI = "src/billing/andere.js";
const TEST_DATEI = "test/anrufe/probe.test.js";
const ABRUF = 'await fetch(url(PAYMENT_INTENTS_PATH), { method: "POST", headers, body });';
const ABRUF_TEXT = 'fetch(url(PAYMENT_INTENTS_PATH), { method: "POST", headers, body })';
const ANDERER_ABRUF = "await fetch(url(REFUNDS_PATH), { method: 'POST', body });";

function befunde(verzeichnis, zeilen, datei = DATEI) {
  return befundZeilen({ verzeichnis, datei, regel: REGEL, bestand: BESTAND }, zeilen);
}

test("anfrage-mit-frist im Produktcode: ein fetch ohne Frist wird ohne Bestandseintrag gemeldet", (context) => {
  const verzeichnis = probeDirectory(context, {});
  assert.deepEqual(befunde(verzeichnis, [ABRUF]), [ABRUF]);
  assert.deepEqual(befunde(verzeichnis, [ABRUF], ANDERE_DATEI), [ABRUF]);
});

test("anfrage-mit-frist im Produktcode: ein fetch mit AbortSignal.timeout bleibt frei", (context) => {
  const verzeichnis = probeDirectory(context, {});
  const mitFrist =
    'await fetch(url(PAYMENT_INTENTS_PATH), { method: "POST", signal: AbortSignal.timeout(STRIPE_FRIST_MS) });';
  assert.deepEqual(befunde(verzeichnis, [mitFrist]), []);
});

test("anfrage-mit-frist im Produktcode: ein eingefrorener Aufruf ist frei, derselbe ein zweites Mal und ein anderer in der Datei nicht", (context) => {
  const verzeichnis = probeDirectory(context, {
    [BESTAND]: bestandsDatei([befundSchluessel(DATEI, ABRUF_TEXT)]),
  });
  assert.deepEqual(befunde(verzeichnis, [ABRUF]), []);
  assert.deepEqual(befunde(verzeichnis, [ABRUF, ABRUF]), [ABRUF]);
  assert.deepEqual(befunde(verzeichnis, [ABRUF, ANDERER_ABRUF]), [ANDERER_ABRUF]);
});

test("anfrage-mit-frist im Produktcode: der Eintrag einer anderen Datei macht den Aufruf nicht frei", (context) => {
  const verzeichnis = probeDirectory(context, {
    [BESTAND]: bestandsDatei([befundSchluessel(ANDERE_DATEI, ABRUF_TEXT)]),
  });
  assert.deepEqual(befunde(verzeichnis, [ABRUF]), [ABRUF]);
  assert.deepEqual(befunde(verzeichnis, [ABRUF], ANDERE_DATEI), []);
});

test("anfrage-mit-frist im Produktcode: ein Aufruf über _fetch = fetch wird gemeldet, ein übergebener fetchImpl nicht", (context) => {
  const verzeichnis = probeDirectory(context, {});
  const ueberAlias = ["let _fetch = fetch;", "await _fetch(url, { method: 'POST', body });"];
  assert.deepEqual(befunde(verzeichnis, ueberAlias), [ueberAlias[1]]);
  const ueberParameter = [
    "export async function sende(fetchImpl, url) {",
    "  return fetchImpl(url, { method: 'POST' });",
    "}",
  ];
  assert.deepEqual(befunde(verzeichnis, ueberParameter), []);
});

test("anfrage-mit-frist im Produktcode: die Meldung unter src/ nennt AbortSignal.timeout, unter test/ bleibt der Testhelfer", (context) => {
  const verzeichnis = probeDirectory(context, {});
  const [imProdukt] = befundTexte({ verzeichnis, datei: DATEI, regel: REGEL }, [ABRUF]);
  const [imTest] = befundTexte({ verzeichnis, datei: TEST_DATEI, regel: REGEL }, [ABRUF]);
  assert.match(imProdukt, /signal: AbortSignal\.timeout\(<benannte Frist in ms>\)/);
  assert.doesNotMatch(imProdukt, /abrufMitFrist|mitAntwortfrist|anfrageMitFrist|Test/);
  assert.match(imTest, /abrufMitFrist oder mitAntwortfrist/);
  assert.match(imTest, /hängt der Test bei einem Mutanten/);
});

test("anfrage-mit-frist im Produktcode: unter test/ meldet die Regel ohne Bestand weiter jeden Aufruf", (context) => {
  const verzeichnis = probeDirectory(context, {
    [BESTAND]: bestandsDatei([befundSchluessel(TEST_DATEI, ABRUF_TEXT)]),
  });
  assert.deepEqual(
    befundZeilen({ verzeichnis, datei: TEST_DATEI, regel: REGEL }, [ABRUF]),
    [ABRUF],
  );
});
