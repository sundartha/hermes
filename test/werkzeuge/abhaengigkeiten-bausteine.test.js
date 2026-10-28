import assert from "node:assert/strict";
import { readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { KONFIGURATION, istGruen, istRot, pruefe } from "./abhaengigkeiten-probe.js";
import { REPO_ROOT, commitAll, probeRepository, writeFiles } from "./probe-repo.js";

const KARTE = "tools/bausteine.json";
const EXIT_ABBRUCH = 2;

function karte(aenderung = {}, schichten = [["werk"], ["kasse", "fach"], ["start"]]) {
  const bausteine = [
    { baustein: "start", zweck: "Baut zusammen.", quellen: ["src/app.js"], eingaenge: [], nutzt: [], importiertJedeDatei: true },
    { baustein: "werk", zweck: "Hilfen.", quellen: ["src/werk/", "src/alt/"], eingaenge: "alle", nutzt: [] },
    { baustein: "kasse", zweck: "Kasse.", quellen: ["src/kasse/"], eingaenge: ["src/kasse/tor.js"], nutzt: [] },
    { baustein: "fach", zweck: "Fach.", quellen: ["src/fach/", "src/kasse/sonder.js"], eingaenge: ["src/fach/tor.js"], nutzt: ["kasse"] },
  ].map((eintrag) => ({ ...eintrag, ...aenderung[eintrag.baustein] }));
  const roh = {
    schichten,
    bausteine,
    altlast: [{ von: "werk", nach: "fach" }],
  };
  return `${JSON.stringify(roh, null, 2)}\n`;
}

const BASIS = {
  [KONFIGURATION]: readFileSync(join(REPO_ROOT, KONFIGURATION), "utf8"),
  [KARTE]: karte(),
  "src/werk/zeit.js": "export const zeit = 1;\n",
  "src/kasse/tor.js": "export const kasse = 1;\n",
  "src/kasse/innen.js": "export const innen = 2;\n",
  "src/kasse/sonder.js": 'import { kasse } from "./tor.js";\nexport const sonder = kasse;\n',
  "src/fach/tor.js": 'import { kasse } from "../kasse/tor.js";\nexport const tor = kasse;\n',
  "src/alt/alt.js": 'import { tor } from "../fach/tor.js";\nexport const alt = tor;\n',
  "src/app.js": 'import { innen } from "./kasse/innen.js";\nimport { alt } from "./alt/alt.js";\nexport const app = [innen, alt];\n',
};

function nachAenderung(context, dateien) {
  const verzeichnis = probeRepository(context, BASIS);
  writeFiles(verzeichnis, dateien);
  commitAll(verzeichnis, "Aenderung");
  return pruefe(verzeichnis);
}

test("bausteine: die Probe-Karte ist grün und nennt Dateien, Bausteine und eingefrorene Altlast", (context) => {
  const ergebnis = pruefe(probeRepository(context, BASIS));
  istGruen(ergebnis);
  assert.match(ergebnis.stdout, /7 Quelldateien in 4 Bausteinen.*1 Bausteinpaare mit Importen gegen die Schichtfolge eingefroren in tools\/bausteine\.json, 0 davon ohne Import/);
});

test("bausteine: ohne Karte meldet das Werkzeug keinen Baustein-Befund und keine Baustein-Zeile", (context) => {
  const ohneKarte = Object.fromEntries(Object.entries(BASIS).filter(([pfad]) => pfad !== KARTE));
  const verzeichnis = probeRepository(context, ohneKarte);
  const ergebnis = pruefe(verzeichnis);
  istGruen(ergebnis);
  assert.doesNotMatch(ergebnis.stdout, /Bausteinen/);
});

test("bausteine: eine neue Datei direkt in src/ ist rot und nennt den Baustein, der sie nutzt, mit seinem Ordner", (context) => {
  const ergebnis = nachAenderung(context, {
    "src/neu.js": "export const neu = 1;\n",
    "src/fach/tor.js": 'import { kasse } from "../kasse/tor.js";\nimport { neu } from "../neu.js";\nexport const tor = [kasse, neu];\n',
  });
  istRot(ergebnis, /Neue Datei direkt in src\/: src\/neu\.js gehört zu keinem Baustein in tools\/bausteine\.json\. Sie wird von fach genutzt \(Ordner src\/fach\/\)/);
});

test("bausteine: eine neue Datei in einem Ordner ohne Baustein ist rot", (context) => {
  istRot(nachAenderung(context, { "src/routes/neu.js": "export const route = 1;\n" }), /Datei ohne Baustein: src\/routes\/neu\.js/);
});

test("bausteine: eine Datei in zwei Ordnern der Karte ist rot und nennt beide Bausteine", (context) => {
  const ergebnis = nachAenderung(context, { [KARTE]: karte({ fach: { quellen: ["src/fach/", "src/kasse/"] } }) });
  istRot(ergebnis, /Datei src\/kasse\/tor\.js trifft in tools\/bausteine\.json mehrere Bausteine \(kasse, fach\)/);
});

test("bausteine: ein genannter Dateiname gilt vor dem Ordner eines anderen Bausteins", (context) => {
  const ergebnis = nachAenderung(context, {
    "src/kasse/sonder.js": 'import { innen } from "./innen.js";\nexport const sonder = innen;\n',
  });
  istRot(ergebnis, /src\/kasse\/sonder\.js → src\/kasse\/innen\.js: src\/kasse\/innen\.js ist kein Eingang von kasse/);
  assert.doesNotMatch(ergebnis.stderr, /mehrere Bausteine/);
});

test("bausteine: ein Import auf eine Datei, die kein Eingang ist, ist rot und nennt einen Eingang daneben", (context) => {
  const ergebnis = nachAenderung(context, {
    "src/fach/tor.js": 'import { innen } from "../kasse/innen.js";\nexport const tor = innen;\n',
  });
  istRot(ergebnis, /src\/fach\/tor\.js → src\/kasse\/innen\.js: src\/kasse\/innen\.js ist kein Eingang von kasse\. Importiere über einen Eingang von kasse \(etwa src\/kasse\/tor\.js;/);
});

test("bausteine: ein Import auf einen Baustein ohne Eingänge nennt, dass er heute keinen hat", (context) => {
  const ergebnis = nachAenderung(context, { [KARTE]: karte({ fach: { eingaenge: [] } }) });
  istRot(ergebnis, /src\/alt\/alt\.js → src\/fach\/tor\.js: src\/fach\/tor\.js ist kein Eingang von fach\. Importiere über einen Eingang von fach \(er hat heute keinen; alle stehen in tools\/bausteine\.json\)/);
});

test("bausteine: jede Datei eines Grundbausteins ist Eingang, und start importiert jede Datei", (context) => {
  istGruen(
    nachAenderung(context, {
      "src/fach/tor.js": 'import { kasse } from "../kasse/tor.js";\nimport { zeit } from "../werk/zeit.js";\nexport const tor = [kasse, zeit];\n',
      "src/app.js": 'import { innen } from "./kasse/innen.js";\nimport { tor } from "./fach/tor.js";\nexport const app = [innen, tor];\n',
    }),
  );
});

test("bausteine: ein Import gegen die Schichtfolge ist rot und nennt, was der Baustein nutzen darf", (context) => {
  const ergebnis = nachAenderung(context, {
    "src/werk/zeit.js": 'import { kasse } from "../kasse/tor.js";\nexport const zeit = kasse;\n',
  });
  istRot(ergebnis, /src\/werk\/zeit\.js → src\/kasse\/tor\.js: werk darf kasse nicht nutzen; .*\(werk nutzt: nichts\)/);
});

test("bausteine: ein Fachbaustein nutzt einen anderen derselben Schicht nur, wenn nutzt ihn nennt", (context) => {
  const ergebnis = nachAenderung(context, { [KARTE]: karte({ fach: { nutzt: [] } }) });
  istRot(ergebnis, /src\/fach\/tor\.js → src\/kasse\/tor\.js: fach darf kasse nicht nutzen; .*\(fach nutzt: werk\)/);
});

test("bausteine: ein Baustein, der in keiner Schicht der Karte steht, bricht die Prüfung mit Exit 2 ab und nennt ihn", (context) => {
  const ergebnis = nachAenderung(context, { [KARTE]: karte({}, [["werk"], ["kasse", "fach"]]) });
  assert.equal(ergebnis.status, EXIT_ABBRUCH, ergebnis.stderr);
  assert.match(ergebnis.stderr, /tools\/bausteine\.json: start steht in keiner Schicht\./);
});

test("bausteine: Altlast gilt je Bausteinpaar; ein weiterer Import auf dem Paar braucht trotzdem einen Eingang", (context) => {
  istGruen(nachAenderung(context, { "src/alt/zweit.js": 'import { tor } from "../fach/tor.js";\nexport const zweit = tor;\n' }));
  const ergebnis = nachAenderung(context, {
    "src/fach/innen.js": "export const innen = 1;\n",
    "src/alt/zweit.js": 'import { innen } from "../fach/innen.js";\nexport const zweit = innen;\n',
  });
  istRot(ergebnis, /src\/alt\/zweit\.js → src\/fach\/innen\.js: src\/fach\/innen\.js ist kein Eingang von fach/);
  assert.doesNotMatch(ergebnis.stderr, /darf fach nicht nutzen/);
});

test("bausteine: ein Altlast-Paar ohne Import wird als streichbar gezählt", (context) => {
  const ergebnis = nachAenderung(context, { "src/alt/alt.js": "export const alt = 1;\n" });
  istGruen(ergebnis);
  assert.match(ergebnis.stdout, /1 Bausteinpaare mit Importen gegen die Schichtfolge eingefroren in tools\/bausteine\.json, 1 davon ohne Import/);
});

test("bausteine: die Umbenennung genannter Dateien und Eingänge nach .ts bleibt ohne Kartenänderung grün", (context) => {
  const verzeichnis = probeRepository(context, BASIS);
  for (const pfad of ["src/kasse/tor", "src/fach/tor", "src/app"]) renameSync(join(verzeichnis, `${pfad}.js`), join(verzeichnis, `${pfad}.ts`));
  writeFiles(verzeichnis, {
    "src/kasse/sonder.js": 'import { kasse } from "./tor.ts";\nexport const sonder = kasse;\n',
    "src/fach/tor.ts": 'import { kasse } from "../kasse/tor.ts";\nexport const tor: number = kasse;\n',
    "src/alt/alt.js": 'import { tor } from "../fach/tor.ts";\nexport const alt = tor;\n',
  });
  commitAll(verzeichnis, "Umbenennung");
  const ergebnis = pruefe(verzeichnis);
  istGruen(ergebnis);
  assert.match(ergebnis.stdout, /0 davon ohne Import/);
});

test("bausteine: die Karte im Repo nennt nur Ordner und .js-Dateien unter src/, die für .ts mitgelten", () => {
  const { bausteine } = JSON.parse(readFileSync(join(REPO_ROOT, KARTE), "utf8"));
  const pfade = bausteine.flatMap(({ quellen, eingaenge }) => [...quellen, ...(Array.isArray(eingaenge) ? eingaenge : [])]);
  assert.deepEqual(pfade.filter((pfad) => !/^src\/[\w./-]+(?:\/|\.js)$/.test(pfad)), []);
});
