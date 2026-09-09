// SEC-P6, Waechter 2: wer darf waehlen?
//
// Zusage: je Wahlweg (die Funktionen, die beim Anbieter tatsaechlich einen Anruf
// ausloesen) entspricht die Menge der AUFRUFER in src/ genau der Erwartungsliste. Ein
// zweiter Einstieg in den Anbieter - der Weg, auf dem ein Anruf an Denylist, Land-Gate,
// Kostendecke und OUTBOUND_FROZEN vorbeikaeme (Absolute Regel 1) - macht diesen Test rot.
//
// Rein statisch, KEINE Zeilennummern (C2): gepinnt wird Datei + Symbol. Eine Zeilennummer
// waere bei jeder Einrueckung falsch rot, und ein Waechter, der staendig falsch rot ist,
// wird am naechsten Tag abgeschaltet.
//
// REICHWEITE, benannt statt behauptet: dieser Waechter kennt nur die BEKANNTEN Wahlwege.
// Ein neuer Weg, der den Anbieter per rohem fetch anspricht, wird von ihm nicht gefunden
// (Restrisiko B in PLAN-SECURITY.md) - deshalb wurde scripts/spike2-anruf.mjs in dieser
// Phase geloescht statt nachgeruestet.
//
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang (Lehre
// catalog-id-prefix-misroutes-tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUELLVERZEICHNIS = "src";

// Blockkommentare zuerst, dann Zeilenkommentare. Ohne diesen Schritt meldete der Waechter
// die Prosa-Erwaehnungen in boot.js/config.js/ports.js als Aufrufer, die es nicht gibt -
// er waere aus dem falschen Grund rot.
const ohneKommentare = (quelltext) =>
  quelltext.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

// Definitionen sind keine Aufrufe. `function <name>(` verliert hier seine Klammer und
// kann dadurch von keinem Aufruf-Muster mehr getroffen werden.
const ohneDefinitionen = (quelltext) => quelltext.replace(/\bfunction\s+\w+\s*\(/g, " ");

function produktionsDateien(verzeichnis = QUELLVERZEICHNIS) {
  const dateien = [];
  for (const eintrag of fs.readdirSync(path.join(REPO_ROOT, verzeichnis), {
    withFileTypes: true,
  })) {
    const relativ = path.join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) dateien.push(...produktionsDateien(relativ));
    else if (eintrag.name.endsWith(".js"))
      dateien.push({ pfad: relativ, quelltext: fs.readFileSync(path.join(REPO_ROOT, relativ), "utf8") });
  }
  return dateien;
}

// EINE Suchfunktion fuer den Waechter UND seine Positiv-Kontrolle (G5): die Kontrolle
// beweist sonst nur, dass eine ZWEITE, nie benutzte Funktion anschlaegt.
function sammleAufrufer({ dateien, muster }) {
  return dateien
    .filter(({ quelltext }) => muster.test(ohneDefinitionen(ohneKommentare(quelltext))))
    .map(({ pfad }) => pfad)
    .sort();
}

// Muster ohne /g: ein zustandsbehaftetes RegExp-Objekt liefert bei wiederholtem .test()
// abwechselnd true/false (lastIndex) - genau die Art stiller Luecke, die ein Waechter
// nicht haben darf.
const WAHLWEGE = Object.freeze([
  {
    weg: "TeXML-Origination",
    muster: /voiceControl\([^()]*\)\.originateCall\s*\(/,
    erwarteteAufrufer: ["src/routes/api-calls.js"],
  },
  {
    weg: "Call-Control-Origination",
    muster: /\.originateViaCallControl\s*\(/,
    erwarteteAufrufer: ["src/telnyx-origination.js"],
  },
  {
    weg: "Call-Control-Wrapper",
    muster: /(^|[^\w.])originateAiAssistantCall\s*\(/,
    erwarteteAufrufer: ["src/routes/api-calls.js"],
  },
  {
    weg: "ElevenLabs-Origination",
    muster: /(^|[^\w.])originateElevenLabsCall\s*\(/,
    erwarteteAufrufer: ["src/routes/api-calls.js"],
  },
]);

// Nur Kommentare - kein einziger echter Aufruf. Rohstoff der beiden Selbsttests unten.
const NUR_PROSA = `
// so ruft man es NICHT: voiceControl(p).originateCall({ to })
/* und auch hier nicht: originateAiAssistantCall({ call })
   .originateViaCallControl({ to }) und originateElevenLabsCall(call) */
export const nichts = 1;
`;

test("SEC-P6-10: je Wahlweg entspricht die Aufrufer-Menge der Erwartung", () => {
  const dateien = produktionsDateien();
  assert.ok(dateien.length > 0, "kein Quelltext eingelesen - der Waechter sucht nichts");
  for (const { weg, muster, erwarteteAufrufer } of WAHLWEGE) {
    assert.deepEqual(
      sammleAufrufer({ dateien, muster }),
      [...erwarteteAufrufer].sort(),
      `${weg}: die Menge der Aufrufer weicht von der Erwartungsliste ab`,
    );
  }
});

test("SEC-P6-11 Positiv-Kontrolle: ein synthetischer Zusatz macht rot", () => {
  const dateien = produktionsDateien();
  for (const { weg, muster, erwarteteAufrufer } of WAHLWEGE) {
    // Kein Schreibzugriff auf src/: die erfundene Datei existiert nur in dieser Liste.
    const mitZusatz = [
      ...dateien,
      { pfad: "src/synthetisch.js", quelltext: "voiceControl(p).originateCall({}); originateAiAssistantCall({}); x.originateViaCallControl({}); originateElevenLabsCall(c);" },
    ];
    assert.notDeepEqual(
      sammleAufrufer({ dateien: mitZusatz, muster }),
      [...erwarteteAufrufer].sort(),
      `${weg}: ein zusaetzlicher Aufrufer bliebe unbemerkt`,
    );
  }
});

test("SEC-P6-12: der Kommentar-Filter erkennt Prosa nicht als Aufruf", () => {
  const dateien = [{ pfad: "src/nur-prosa.js", quelltext: NUR_PROSA }];
  for (const { weg, muster } of WAHLWEGE) {
    assert.deepEqual(
      sammleAufrufer({ dateien, muster }),
      [],
      `${weg}: eine Erwaehnung im Kommentar gilt faelschlich als Aufruf`,
    );
  }
});

test("SEC-P6-12b: der Definitions-Filter erkennt eine Definition nicht als Aufruf", () => {
  const dateien = [
    {
      pfad: "src/nur-definition.js",
      quelltext: "export async function originateAiAssistantCall({ call }) { return call; }",
    },
  ];
  const wrapper = WAHLWEGE.find((kandidat) => kandidat.weg === "Call-Control-Wrapper");
  assert.deepEqual(sammleAufrufer({ dateien, muster: wrapper.muster }), []);
});
