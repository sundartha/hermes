import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ALTVERSTOESSE,
  BEREICHE_DATEI,
  EINGANGSREGEL,
  KONFIGURATION,
  TESTIMPORTE,
  istGruen,
  istRot,
  liste,
  pruefe,
} from "./abhaengigkeiten-probe.js";
import { REPO_ROOT, probeRepository, writeFiles } from "./probe-repo.js";

const APP_JS = "src/app.js";
const APP_TS = "src/app.ts";
const INTERN_JS = "src/store/intern.js";
const INTERN_TS = "src/store/intern.ts";
const TEST = "test/anrufe/anruf-starten.test.js";
const FASSADE = "speicher-nur-ueber-fassade";

function app(ziel, typ = "") {
  return `import { wert } from "./store/${ziel}";\n\nexport function kopie(faktor${typ}) {\n  return wert * faktor;\n}\n`;
}

function intern(typ = "") {
  return `export const wert${typ} = 1;\n`;
}

function testDatei(ziel) {
  return `import { wert } from "../../${ziel}";\nexport const genutzt = wert;\n`;
}

function eintrag(name, von, nach) {
  return { type: "dependency", from: von, to: nach, rule: { severity: "error", name } };
}

function grundstand(context) {
  return probeRepository(context, {
    [KONFIGURATION]: readFileSync(join(REPO_ROOT, KONFIGURATION), "utf8"),
    [BEREICHE_DATEI]: readFileSync(join(REPO_ROOT, BEREICHE_DATEI), "utf8"),
    [APP_JS]: app("intern.js"),
    [INTERN_JS]: intern(),
    [TEST]: testDatei(INTERN_JS),
    [ALTVERSTOESSE]: liste([eintrag(FASSADE, APP_JS, INTERN_JS)]),
    [TESTIMPORTE]: liste([eintrag(EINGANGSREGEL, TEST, INTERN_JS)]),
  });
}

function umbenannt(context, dateien, { alt }) {
  const verzeichnis = grundstand(context);
  rmSync(join(verzeichnis, alt));
  writeFiles(verzeichnis, dateien);
  return verzeichnis;
}

const APP_NUR_TYPEN = app("intern.js", ": number");
const APP_GEAENDERT = APP_NUR_TYPEN.replace("wert * faktor", "wert + faktor");
const APP_PAAR = { alt: APP_JS, neu: APP_TS };
const APP_VERSCHOBEN = liste([eintrag(FASSADE, APP_TS, INTERN_JS)]);

test("Umbenennung nur mit Typen, Eintrag auf den neuen Pfad verschoben, ist grün", (context) => {
  const ergebnis = pruefe(
    umbenannt(context, { [APP_TS]: APP_NUR_TYPEN, [ALTVERSTOESSE]: APP_VERSCHOBEN }, APP_PAAR),
  );
  istGruen(ergebnis);
});

test("Umbenennung mit Verhaltensänderung und verschobenem Eintrag ist rot wie ein neu eingefrorener Eintrag", (context) => {
  const ergebnis = pruefe(
    umbenannt(context, { [APP_TS]: APP_GEAENDERT, [ALTVERSTOESSE]: APP_VERSCHOBEN }, APP_PAAR),
  );
  istRot(
    ergebnis,
    /darf nur kürzer werden, neu eingefroren ist: src\/app\.ts → src\/store\/intern\.js/,
  );
});

test("Umbenennung ohne verschobenen Eintrag bleibt ein neuer Verstoß", (context) => {
  const ergebnis = pruefe(umbenannt(context, { [APP_TS]: APP_NUR_TYPEN }, APP_PAAR));
  istRot(ergebnis, /Neuer Verstoß: src\/app\.ts → src\/store\/intern\.js/);
});

test("alter und verschobener Eintrag zusammen sind einer mehr als auf der Basis und rot", (context) => {
  const beide = liste([eintrag(FASSADE, APP_JS, INTERN_JS), eintrag(FASSADE, APP_TS, INTERN_JS)]);
  const ergebnis = pruefe(
    umbenannt(context, { [APP_TS]: APP_NUR_TYPEN, [ALTVERSTOESSE]: beide }, APP_PAAR),
  );
  istRot(
    ergebnis,
    /darf nur kürzer werden, neu eingefroren ist: src\/app\.ts → src\/store\/intern\.js/,
  );
});

test("das Ziel eines Eintrags wird ebenso auf den alten Pfad zurückgeführt", (context) => {
  const ergebnis = pruefe(
    umbenannt(
      context,
      {
        [INTERN_TS]: intern(": number"),
        [APP_JS]: app("intern.ts"),
        [TEST]: testDatei(INTERN_TS),
        [ALTVERSTOESSE]: liste([eintrag(FASSADE, APP_JS, INTERN_TS)]),
        [TESTIMPORTE]: liste([eintrag(EINGANGSREGEL, TEST, INTERN_TS)]),
      },
      { alt: INTERN_JS, neu: INTERN_TS },
    ),
  );
  istGruen(ergebnis);
});

test("eine .ts-Datei ohne Paar mit eigenem Eintrag ist so streng wie eine neue .js-Datei", (context) => {
  const verzeichnis = grundstand(context);
  writeFiles(verzeichnis, {
    "src/neu.ts": app("intern.js", ": number"),
    [ALTVERSTOESSE]: liste([
      eintrag(FASSADE, APP_JS, INTERN_JS),
      eintrag(FASSADE, "src/neu.ts", INTERN_JS),
    ]),
  });
  const ergebnis = pruefe(verzeichnis);
  istRot(ergebnis, /neu eingefroren ist: src\/neu\.ts → src\/store\/intern\.js/);
});

test("Eingänge, Fachlogik und die Speicher-Fassade gelten als .ts wie als .js", (context) => {
  const verzeichnis = grundstand(context);
  writeFiles(verzeichnis, {
    "src/routes/voice.ts": "export const wert: number = 2;\n",
    "src/call-result.ts": "export const wert: number = 3;\n",
    "src/store.ts": 'export { wert } from "./store/intern.js";\n',
    "test/anrufe/eingang.test.js": testDatei("src/routes/voice.ts"),
    "test/anrufe/fachlogik.test.js": testDatei("src/call-result.ts"),
  });
  const ergebnis = pruefe(verzeichnis);
  istGruen(ergebnis);
});
