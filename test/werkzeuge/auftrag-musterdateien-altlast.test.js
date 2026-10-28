import assert from "node:assert/strict";
import { test } from "node:test";

import { altlastBefunde, altlisten, erwaehnungen, formBefunde } from "../../tools/auftrag/musterpruefung.mjs";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";

const VORBILD = "src/routes/vorbild.js";
const MUSTER_DATEI = "tools/auftrag/musterdateien.json";
const ROUTENFORM = "router";

function musterJson(eintrag = {}) {
  return JSON.stringify({ regel: "Regel.", bau: [{ art: "Route", praefix: "src/routes/", datei: VORBILD, ...eintrag }], test: [] });
}

function mitListe(context, liste, inhalt) {
  return probeDirectory(context, { [MUSTER_DATEI]: musterJson(), [VORBILD]: "export const A = 1;\n", [liste]: inhalt });
}

const LISTEN_MIT_EINTRAG = [
  ["eslint-suppressions.json", `{ "${VORBILD}": { "id-length": { "count": 1 } } }`],
  ["eslint-legacy-exceptions.json", `{ "${VORBILD}": { "reason": "alt" } }`],
  [".dependency-cruiser-known-violations.json", `[{ "from": "${VORBILD}", "to": "src/x.js" }]`],
  ["tools/basis/test-importe.json", `[{ "from": "test/a.test.js", "to": "${VORBILD}", "unresolvedTo": "../${VORBILD}" }]`],
  ["tools/basis/knip.json", `{ "befunde": ["exports|${VORBILD}|nichtGenutzt"] }`],
  ["tools/basis/jscpd.json", `{ "befunde": ["${VORBILD}|src/anderes.js|51"] }`],
  ["tools/basis/semgrep.json", `{ "befunde": ["regel|${VORBILD}|abc"] }`],
  ["tools/basis/eine-neue-liste.json", `["${VORBILD}"]`],
];

test("Vorbild ohne Altlast: jedes Vorbild des echten Repos steht in keiner Liste geduldeter Befunde", () => {
  assert.deepEqual(altlastBefunde(REPO_ROOT), []);
});

test("Vorbild ohne Altlast: die Prüfung liest die drei Listen im Hauptordner und jede Datei unter tools/basis", () => {
  const listen = altlisten(REPO_ROOT);
  for (const liste of ["eslint-suppressions.json", "eslint-legacy-exceptions.json", ".dependency-cruiser-known-violations.json", "tools/basis/test-importe.json", "tools/basis/jscpd.json", "tools/basis/knip.json"])
    assert.ok(listen.includes(liste), liste);
});

test("Vorbild ohne Altlast: ein Eintrag in einer der Listen macht die Prüfung rot und nennt Datei, Liste und Ausweg", (context) => {
  for (const [liste, inhalt] of LISTEN_MIT_EINTRAG) {
    const befunde = altlastBefunde(mitListe(context, liste, inhalt));
    assert.equal(befunde.length, 1, `${liste}: ${befunde.join("\n")}`);
    assert.ok(befunde[0].startsWith(`Das Vorbild ${VORBILD} (Route) steht in ${liste} (Fundstellen: `), befunde[0]);
    assert.ok(befunde[0].includes(`Tausche es in ${MUSTER_DATEI} gegen eine Datei ohne Einträge`), befunde[0]);
  }
});

test("Vorbild ohne Altlast: Listen ohne den Pfad des Vorbilds bleiben grün, auch bei längeren Pfaden mit gleichem Anfang oder Ende", (context) => {
  const inhalt = JSON.stringify({ a: "src/routes/vorbild.js.alt", b: "src/routes/vorbild.jsx", c: "apps/web/src/routes/vorbild.js", d: "src/routes/vorbild-neu.js" });
  assert.deepEqual(altlastBefunde(mitListe(context, "tools/basis/knip.json", inhalt)), []);
});

test("Vorbild ohne Altlast: die Fundstellen werden gezählt, auch in einem relativen Pfad", () => {
  assert.equal(erwaehnungen(`"${VORBILD}" und "../${VORBILD}" und "../../${VORBILD}"`, VORBILD), 3);
  assert.equal(erwaehnungen(`"x${VORBILD}"`, VORBILD), 0);
});

test("Form des Vorbilds: ein Vorbild, das die geforderte Form nicht zeigt, macht die Prüfung rot und nennt die Form", (context) => {
  const wurzel = probeDirectory(context, { [MUSTER_DATEI]: musterJson({ form: ROUTENFORM }), [VORBILD]: "export function einzelHandler() {}\n" });
  const befunde = formBefunde(wurzel);
  assert.equal(befunde.length, 1, befunde.join("\n"));
  assert.ok(befunde[0].includes(`Das Vorbild ${VORBILD} (Route) zeigt nicht die geforderte Form „router“: ein Express-Router`), befunde[0]);
});

test("Form des Vorbilds: eine unbekannte Form macht die Prüfung rot und nennt die bekannten", (context) => {
  const wurzel = probeDirectory(context, { [MUSTER_DATEI]: musterJson({ form: "erfunden" }), [VORBILD]: "export function makeVorbildRoutes({ store }) {}\n" });
  const befunde = formBefunde(wurzel);
  assert.equal(befunde.length, 1, befunde.join("\n"));
  assert.ok(befunde[0].includes("„erfunden“: unbekannt (bekannt: router)"), befunde[0]);
});

test("Form des Vorbilds: ein Vorbild mit der Form und ein Eintrag ohne Form bleiben grün", (context) => {
  const mitForm = probeDirectory(context, { [MUSTER_DATEI]: musterJson({ form: ROUTENFORM }), [VORBILD]: "export function makeVorbildRoutes({ store }) {}\n" });
  assert.deepEqual(formBefunde(mitForm), []);
  const ohneForm = probeDirectory(context, { [MUSTER_DATEI]: musterJson(), [VORBILD]: "export const A = 1;\n" });
  assert.deepEqual(formBefunde(ohneForm), []);
});

test("Form des Vorbilds: die Vorbilder des echten Repos zeigen ihre Form", () => {
  assert.deepEqual(formBefunde(REPO_ROOT), []);
});
