import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUELLVERZEICHNIS = "src";

const ohneKommentare = (quelltext) =>
  quelltext.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

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

function sammleAufrufer({ dateien, muster }) {
  return dateien
    .filter(({ quelltext }) => muster.test(ohneDefinitionen(ohneKommentare(quelltext))))
    .map(({ pfad }) => pfad)
    .sort();
}

const WAHLWEGE = Object.freeze([
  {
    weg: "TeXML-Origination",
    muster: /voiceControl\([^()]*\)\.originateCall\s*\(/,
    erwarteteAufrufer: ["src/routes/api-calls.js"],
  },
  {
    weg: "Call-Control-Origination",
    muster: /\.originateViaCallControl\s*\(/,
    erwarteteAufrufer: [],
  },
  {
    weg: "Call-Control-Wrapper",
    muster: /(^|[^\w.])originateAiAssistantCall\s*\(/,
    erwarteteAufrufer: [],
  },
  {
    weg: "ElevenLabs-Origination",
    muster: /(^|[^\w.])originateElevenLabsCall\s*\(/,
    erwarteteAufrufer: ["src/routes/api-calls.js"],
  },
]);

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
