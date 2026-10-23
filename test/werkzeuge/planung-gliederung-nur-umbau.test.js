import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { AUFTRAG, EXIT_PASST_NICHT } from "./planung-plane-probe.js";
import { LAUF_FRIST_MS, ORDNER, aufrufe, exit, planOrdner, planeIn } from "./planung-probe.js";

const ABSICHT = "Die Prüfung soll in eine eigene Funktion wandern, ohne dass sich nach außen etwas ändert. Nicht gewollt ist ein neues Verhalten nebenbei. Im Zweifel bleibt der Code, wie er ist.";
const UMBAU_PITCH = [
  "# P-001 Umbau",
  "",
  "Planung freigegeben: 15000000 Token",
  "",
  "## Absicht",
  ABSICHT,
  "",
  "## Altfunktionen",
  "keine, weil die Prüfung in src/callee-is-owner.js keine Funktion mit Lint-Befunden trifft",
  "",
  "## Anforderungen",
  "",
  "keine neuen, weil sich nach außen nichts zeigt; das Prüfbare steht unter „Bleibt unverändert“",
  "",
  "## Bleibt unverändert",
  "",
  "keins, weil die bestehenden Tests das Verhalten unverändert prüfen",
  "",
].join("\n");
const OHNE_ANGRIFFSWEGE = ["# P-001 Umbau: Sicherheitsprüfung", "", "## 2. Angriffswege", "", "keine Angriffswege gefunden", "", "## 3. Lückenprüfung", ""].join("\n");
const MIT_T1 = ["# P-001 Umbau: Sicherheitsprüfung", "", "## 2. Angriffswege", "", "### T1: Der Umbau verliert eine Prüfung", "", "Ausgang: verhindern", "", "## 3. Lückenprüfung", ""].join("\n");
const PASST_NICHT = "Zerlegung passt nicht: Der Umbau ist schon erledigt (Fundstellen: pitch.md, ## Anforderungen; pitch.md, ## Bleibt unverändert)";

function planeUmbau(context, sicherheit, antworten) {
  const wurzel = planOrdner(context);
  writeFileSync(join(wurzel, ORDNER, "pitch.md"), UMBAU_PITCH);
  writeFileSync(join(wurzel, ORDNER, "sicherheit.md"), sicherheit);
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: antworten, argumente: ["plane", ORDNER] });
}

test("gliederung-nur-umbau: plane fragt bei einem reinen Umbau-Pitch ohne Nummern keine Gliederung und keinen Erkunder und schneidet mit allen Dokumenten", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeUmbau(context, OHNE_ANGRIFFSWEGE, { "planer|## Zuschnitt": [PASST_NICHT] });
  exit(lauf, EXIT_PASST_NICHT);
  assert.deepEqual(aufrufe(lauf, "planer", "## Gliederung"), []);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  assert.deepEqual(JSON.parse(readFileSync(join(lauf.wurzel, ORDNER, "planung", "gliederung.json"), "utf8")), { gruppen: [] });
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(zuschnitt.eingabe.includes(ABSICHT), zuschnitt.eingabe);
  assert.ok(zuschnitt.eingabe.includes("keine Angriffswege gefunden"), zuschnitt.eingabe);
  assert.ok(zuschnitt.eingabe.includes("### tools/bereiche.json"), zuschnitt.eingabe);
});

test("gliederung-nur-umbau: plane fragt bei einem reinen Umbau-Pitch mit T1 die Gliederung wie bisher", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeUmbau(context, MIT_T1, { "planer|## Gliederung": [PASST_NICHT] });
  exit(lauf, EXIT_PASST_NICHT);
  const [gliederung] = aufrufe(lauf, "planer", "## Gliederung");
  assert.ok(gliederung.eingabe.includes("#### T1 ("), gliederung.eingabe);
  assert.deepEqual(aufrufe(lauf, "planer", "## Zuschnitt"), []);
});
