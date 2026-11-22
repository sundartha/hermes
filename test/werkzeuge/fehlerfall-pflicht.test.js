import assert from "node:assert/strict";
import { test } from "node:test";

import { fehlerfallPflicht } from "../../tools/pruefen.mjs";

const GRUND = "Reiner Umbau: nur Namen und Reihenfolge geändert, jede Ausgabe bleibt gleich.";
const mitAbschnitt = (text) => `## Was\n\nx\n\n## Kein Fehlerfall\n\n${text}\n\n## Danach\n\ny`;

const GESCHUETZT = [
  "src/elevenlabs/convai.ts",
  "src/elevenlabs/vorspann-wahl.js",
  "src/telephony/telnyx-adapter.ts",
  "src/conversation/schritt.js",
  "src/routes/voice.ts",
  "src/store/instanz-besitz.js",
  "src/store/zustand/lesen.js",
];

for (const datei of GESCHUETZT) {
  test(`Änderung an ${datei} ohne neue Testdatei und ohne Begründung ist rot und nennt Pfad und Pflicht`, () => {
    const meldungen = fehlerfallPflicht([datei, "docs/x.md"], [], "## Was\n\nx");
    assert.equal(meldungen.length, 1);
    assert.ok(meldungen[0].includes(datei));
    assert.ok(meldungen[0].includes("Fehlerfall"));
    assert.ok(meldungen[0].includes("## Kein Fehlerfall"));
  });
}

test("Eine neue Testdatei erfüllt die Pflicht", () => {
  assert.deepEqual(fehlerfallPflicht(["src/telephony/telnyx-adapter.ts"], ["test/telefonie/neu.test.js"], ""), []);
});

test("Eine neue Datei unter test/, die kein Test ist, erfüllt die Pflicht nicht", () => {
  assert.equal(fehlerfallPflicht(["src/routes/voice.ts"], ["test/gemeinsam/hilfe.js"], "").length, 1);
});

test("Ohne Änderung an geschützten Pfaden bleibt der PR unberührt", () => {
  assert.deepEqual(fehlerfallPflicht(["src/store/andere.js", "src/elevenlabsx/a.js", "src/routes/voice-andere.ts", "tools/pruefen.mjs"], [], ""), []);
  assert.deepEqual(fehlerfallPflicht([], [], undefined), []);
});

test("Der Abschnitt „Kein Fehlerfall“ mit Begründung von mindestens 40 Zeichen erfüllt die Pflicht", () => {
  assert.equal(GRUND.length > 40, true);
  assert.deepEqual(fehlerfallPflicht(["src/routes/voice.ts"], [], mitAbschnitt(GRUND)), []);
  assert.deepEqual(fehlerfallPflicht(["src/routes/voice.ts"], [], mitAbschnitt("x".repeat(40))), []);
});

test("Eine Begründung unter 40 Zeichen oder ein fehlender Abschnitt bleibt rot", () => {
  assert.equal(fehlerfallPflicht(["src/routes/voice.ts"], [], mitAbschnitt("x".repeat(39))).length, 1);
  assert.equal(fehlerfallPflicht(["src/routes/voice.ts"], [], mitAbschnitt("   ")).length, 1);
  assert.equal(fehlerfallPflicht(["src/routes/voice.ts"], [], `## Was\n\n${GRUND}`).length, 1);
});
