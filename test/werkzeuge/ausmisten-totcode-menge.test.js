import assert from "node:assert/strict";
import { chdir, cwd } from "node:process";
import { test } from "node:test";

import { dynamischeZiele } from "../../tools/tests-ausmisten/importe.mjs";
import { planeTotcode } from "../../tools/tests-ausmisten/totcode-menge.mjs";
import { removedCases } from "../../tools/testschutz/entfernt.mjs";
import {
  DOPPELT,
  EINGANG_QUELLE,
  FREMDE_QUELLE,
  GATE_TEST,
  GRUNDDATEIEN,
  RECHNEN_HILFE,
  RECHNEN_TEST,
  UHR_QUELLE,
  ausmistenRepo,
} from "./ausmisten/hilfen.mjs";

const UHR_TEST = "test/uhr.test.js";
const KERN = "src/post/kern.js";
const SPERRE = "src/sperre.js";
const ZWEITER_GATE_TEST = "test/gate-zwei.test.js";
const FALL = "trimmt den Eingang";
const EINRUECKUNG = 2;
const ALTES = "\nexport function alt(text) {\n  return text;\n}\n";
const NEUER_EINGANG = "export function eingang(text) {\n  return text.trimStart();\n}\n";
const NEUE_UHR = "export function jetzt() {\n  return 1;\n}\n";
const WOERTER = ["Zuerst", "Danach", "Zuletzt", "Außerdem", "Schließlich", "Nebenbei"];
const KEIN_TOTER_CODE = "prüft keinen toten Code";
const NICHT_GELISTET = "steht aber nicht auf der Liste";
const NICHT_GENAU = "nicht genau als ganzer Fall entfernt";

function mitAltem(pfad, grund = GRUNDDATEIEN[pfad]) {
  return { [pfad]: `${grund}${ALTES}` };
}

function ohneAltes(pfad) {
  return { [pfad]: GRUNDDATEIEN[pfad] };
}

const OHNE_ALTES = ohneAltes(EINGANG_QUELLE);

function totesRepo(context, dateien = {}) {
  return ausmistenRepo(context, { ...mitAltem(EINGANG_QUELLE), ...dateien });
}

function zurueck(repo) {
  repo.git(["reset", "-q", "--hard", repo.master]);
  repo.git(["clean", "-q", "-f", "-d"]);
}

function eigenerTest(importPfad, thema) {
  return [
    `import { strictEqual as gleich${thema} } from "node:assert";`,
    `import { describe as gruppe${thema}, it as fall${thema} } from "node:test";`,
    `import * as geprueft${thema} from ${JSON.stringify(importPfad)};`,
    "",
    `gruppe${thema}(${JSON.stringify(`${thema} als eigene Gruppe`)}, () => {`,
    ...WOERTER.map(
      (wort) =>
        `  fall${thema}(${JSON.stringify(`${wort} prüft ${thema} eigenständig`)}, () => gleich${thema}(typeof geprueft${thema}, "object"));`,
    ),
    "});",
    "",
  ].join("\n");
}

function gateTests(tests) {
  const gates = { Denylist: { module: [SPERRE], tests } };
  return `${JSON.stringify(gates, null, EINRUECKUNG)}\n`;
}

const KERN_KURZ = "export function kern(text) {\n  return text.trim();\n}\n";
const EINGANG_MIT_KERN =
  'import { kern } from "./kern.js";\n\nexport function eingang(text) {\n  return kern(text);\n}\n';
const TRANSITIV = {
  [EINGANG_QUELLE]: `${EINGANG_MIT_KERN}${ALTES}`,
  [KERN]: `${KERN_KURZ}${ALTES}`,
};

const ZWEI_FAELLE = [
  GRUNDDATEIEN[DOPPELT],
  `test(${JSON.stringify(FALL)}, () => {`,
  '  assert.equal(modul.eingang(" a "), "a");',
  "});",
  "",
].join("\n");

function mitZweiterGateDatei(repo) {
  return repo.committe(
    {
      ...ohneAltes(SPERRE),
      [ZWEITER_GATE_TEST]: eigenerTest("../src/sperre.js", "Sperre"),
      "tools/gate-tests.json": gateTests([ZWEITER_GATE_TEST]),
    },
    [GATE_TEST],
  );
}

function imRepo(repo, aufgabe) {
  const vorher = cwd();
  chdir(repo.ordner);
  try {
    return aufgabe();
  } finally {
    chdir(vorher);
  }
}

async function plane(repo, kopf, liste) {
  const vorher = cwd();
  chdir(repo.ordner);
  try {
    return await planeTotcode({ basis: repo.master, kopf, liste });
  } finally {
    chdir(vorher);
  }
}

function erwarteGruen(plan) {
  assert.deepEqual(plan.verstoesse, []);
}

function erwarteRot(plan, datei, teil) {
  const treffer = plan.verstoesse.some(
    (verstoss) => verstoss.datei === datei && verstoss.grund.includes(teil),
  );
  assert.ok(treffer, JSON.stringify(plan.verstoesse, null, EINRUECKUNG));
}

function erwarteOhne(plan, teil) {
  const treffer = plan.verstoesse.filter(({ grund }) => grund.includes(teil));
  assert.deepEqual(treffer, []);
}

test("ausmisten-totcode-menge: eine gelistete gelöschte Testdatei ist alter Test, ihre Quelle mit reinem Lösch-Hunk die Messmenge, das Ergebnis ist JSON", async (context) => {
  const repo = totesRepo(context);
  const kopf = repo.committe(OHNE_ALTES, [DOPPELT]);

  const plan = await plane(repo, kopf, [DOPPELT]);

  erwarteGruen(plan);
  assert.deepEqual(plan.geloeschteTests, [DOPPELT]);
  assert.deepEqual(plan.alteTests, [DOPPELT]);
  assert.deepEqual(plan.messmenge, [EINGANG_QUELLE]);
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
});

test("ausmisten-totcode-menge: eine gelistete Datei, die der PR nicht löscht, ist rot", async (context) => {
  const repo = totesRepo(context);
  const kopf = repo.committe(OHNE_ALTES);

  const plan = await plane(repo, kopf, [DOPPELT]);

  erwarteRot(plan, DOPPELT, "löscht die Datei aber nicht");
  assert.deepEqual(plan.geloeschteTests, []);
});

test("ausmisten-totcode-menge: eine gelöschte Testdatei, die nicht auf der Liste steht, ist ein Verstoß", async (context) => {
  const repo = totesRepo(context);
  const kopf = repo.committe(OHNE_ALTES, [DOPPELT, UHR_TEST]);

  const plan = await plane(repo, kopf, [DOPPELT]);

  erwarteRot(plan, UHR_TEST, NICHT_GELISTET);
  assert.deepEqual(plan.geloeschteTests, [DOPPELT]);
  assert.deepEqual(plan.nichtGelistet, [UHR_TEST]);
});

test("ausmisten-totcode-menge: ohne gelistete gelöschte Datei ist die Menge leer und rot", async (context) => {
  const repo = totesRepo(context);
  const kopf = repo.committe(OHNE_ALTES, [DOPPELT, UHR_TEST]);

  const plan = await plane(repo, kopf, []);

  erwarteRot(plan, "", "keine gelöschte Testdatei");
  erwarteRot(plan, DOPPELT, NICHT_GELISTET);
  assert.deepEqual(plan.alteTests, []);
  assert.deepEqual(plan.nichtGelistet, [DOPPELT, UHR_TEST]);
});

test("ausmisten-totcode-menge: eine gelistete Datei, die umbenannt oder mit kleiner Änderung kopiert wird, ist keine Löschung und rot", async (context) => {
  const repo = totesRepo(context);
  const neu = "test/post/doppelt-neu.test.js";
  const umbenannt = repo.committe({ ...OHNE_ALTES, [neu]: GRUNDDATEIEN[DOPPELT] }, [DOPPELT]);
  const gleich = await plane(repo, umbenannt, [DOPPELT]);
  zurueck(repo);
  const veraendert = GRUNDDATEIEN[DOPPELT].replace("noch einmal", "ein drittes Mal");
  const kopie = repo.committe({ ...OHNE_ALTES, [neu]: veraendert }, [DOPPELT]);
  const aehnlich = await plane(repo, kopie, [DOPPELT]);

  erwarteRot(gleich, DOPPELT, `umbenannt oder kopiert nach ${neu}`);
  assert.deepEqual(gleich.geloeschteTests, []);
  erwarteRot(aehnlich, DOPPELT, `umbenannt oder kopiert nach ${neu}`);
});

test("ausmisten-totcode-menge: eine gelistete Datei neben einem neuen, anderen Test ist keine Umbenennung", async (context) => {
  const repo = totesRepo(context);
  const neu = "test/post/anders.test.js";
  const kopf = repo.committe(
    { ...OHNE_ALTES, [neu]: eigenerTest("../../src/post/eingang.js", "Anders") },
    [DOPPELT],
  );

  const plan = await plane(repo, kopf, [DOPPELT]);

  erwarteGruen(plan);
  assert.deepEqual(plan.geloeschteTests, [DOPPELT]);
});

test("ausmisten-totcode-menge: ein gelisteter Pfad, den es in der Basis nicht gibt, und eine Datei mit „.test.“ im Namen, die keine Testdatei ist, sind rot", async (context) => {
  const daten = "test/post/daten.test.json";
  const fehlt = "test/post/fehlt.test.js";
  const repo = totesRepo(context, { [daten]: "{}\n" });
  const kopf = repo.committe(OHNE_ALTES, [DOPPELT, daten]);

  const plan = await plane(repo, kopf, [DOPPELT, daten, fehlt]);

  erwarteRot(plan, fehlt, "die Datei gibt es in der Basis nicht");
  erwarteRot(plan, daten, "weder Testdatei");
  assert.deepEqual(plan.geloeschteTests, [DOPPELT]);
  assert.deepEqual(plan.geloeschteHilfen, []);
});

test("ausmisten-totcode-menge: ein Fall-Eintrag aus test/werkzeuge/ oder aus einer Testhilfe ist rot, auch wenn der Fall genau entfernt ist", async (context) => {
  const werkzeug = "test/werkzeuge/eingang.test.js";
  const repo = totesRepo(context, { [werkzeug]: ZWEI_FAELLE });
  const kopf = repo.committe({ ...OHNE_ALTES, [werkzeug]: GRUNDDATEIEN[DOPPELT] });

  const plan = await plane(repo, kopf, [`${werkzeug}: ${FALL}`, `${RECHNEN_HILFE}: ${FALL}`]);

  erwarteRot(plan, werkzeug, "einzelne Fälle nur aus");
  erwarteRot(plan, RECHNEN_HILFE, "einzelne Fälle nur aus");
  assert.deepEqual(plan.faelle, []);
});

test("ausmisten-totcode-menge: Dateien unter test/sicherheit/ und test/werkzeuge/ sind ausgenommen, andere Ordner nicht", async (context) => {
  const inhalt = GRUNDDATEIEN[DOPPELT];
  const pfade = ["test/sicherheit/eingang.test.js", "test/werkzeuge/eingang.test.js"];
  const frei = "test/schutz/eingang.test.js";
  const repo = totesRepo(
    context,
    Object.fromEntries([...pfade, frei].map((pfad) => [pfad, inhalt])),
  );

  for (const pfad of pfade) {
    const kopf = repo.committe(OHNE_ALTES, [pfad]);
    erwarteRot(await plane(repo, kopf, [pfad]), pfad, "test/sicherheit/");
    zurueck(repo);
  }
  const kopf = repo.committe(OHNE_ALTES, [frei]);
  const plan = await plane(repo, kopf, [frei]);

  erwarteGruen(plan);
  assert.deepEqual(plan.geloeschteTests, [frei]);
});

test("ausmisten-totcode-menge: eine Gate-Datei ohne Gate-Namen auf der Liste und ohne verbleibende Gate-Datei ist zweimal rot", async (context) => {
  const repo = totesRepo(context, mitAltem(SPERRE));
  const kopf = repo.committe(ohneAltes(SPERRE), [GATE_TEST]);

  const plan = await plane(repo, kopf, [GATE_TEST]);

  erwarteRot(plan, GATE_TEST, "Gate Denylist steht nicht als Name auf der Liste");
  erwarteRot(plan, GATE_TEST, "keine Testdatei, die im Kopf existiert");
});

test("ausmisten-totcode-menge: eine Gate-Datei mit Gate-Namen, aber ohne verbleibende Gate-Datei im Kopf ist rot", async (context) => {
  const repo = totesRepo(context, mitAltem(SPERRE));
  const kopf = repo.committe(ohneAltes(SPERRE), [GATE_TEST]);

  const plan = await plane(repo, kopf, [GATE_TEST, "Denylist"]);

  erwarteRot(plan, GATE_TEST, "keine Testdatei, die im Kopf existiert");
  erwarteOhne(plan, "steht nicht als Name");
});

test("ausmisten-totcode-menge: eine Gate-Datei mit verbleibender Gate-Datei, aber ohne Gate-Namen ist rot", async (context) => {
  const repo = totesRepo(context, mitAltem(SPERRE));
  const kopf = mitZweiterGateDatei(repo);

  const plan = await plane(repo, kopf, [GATE_TEST]);

  erwarteRot(plan, GATE_TEST, "Gate Denylist steht nicht als Name auf der Liste");
  erwarteOhne(plan, "die im Kopf existiert");
});

test("ausmisten-totcode-menge: eine Gate-Datei mit Gate-Namen und verbleibender Gate-Datei im Kopf ist grün", async (context) => {
  const repo = totesRepo(context, mitAltem(SPERRE));
  const kopf = mitZweiterGateDatei(repo);

  const plan = await plane(repo, kopf, [GATE_TEST, "Denylist"]);

  erwarteGruen(plan);
  assert.deepEqual(plan.gates, { Denylist: [GATE_TEST] });
  assert.deepEqual(plan.messmenge, [SPERRE]);
});

test("ausmisten-totcode-menge: ein Name auf der Liste ohne gelistete Gate-Datei ist rot", async (context) => {
  const repo = totesRepo(context);
  const kopf = repo.committe(OHNE_ALTES, [DOPPELT]);

  const plan = await plane(repo, kopf, [DOPPELT, "Denylist"]);

  erwarteRot(plan, "Denylist", "kein Gate einer gelisteten Gate-Datei");
});

test("ausmisten-totcode-menge: eine Testhilfe, deren Nutzer der PR mit löscht und listet, ist grün", async (context) => {
  const repo = ausmistenRepo(context, mitAltem(FREMDE_QUELLE));
  const kopf = repo.committe(ohneAltes(FREMDE_QUELLE), [RECHNEN_HILFE, RECHNEN_TEST]);

  const plan = await plane(repo, kopf, [RECHNEN_HILFE, RECHNEN_TEST]);

  erwarteGruen(plan);
  assert.deepEqual(plan.geloeschteHilfen, [RECHNEN_HILFE]);
  assert.deepEqual(plan.geloeschteTests, [RECHNEN_TEST]);
  assert.deepEqual(plan.messmenge, [FREMDE_QUELLE]);
});

test("ausmisten-totcode-menge: eine Testhilfe mit noch vorhandenem Nutzer ist rot", async (context) => {
  const repo = ausmistenRepo(context, mitAltem(FREMDE_QUELLE));
  const kopf = repo.committe(ohneAltes(FREMDE_QUELLE), [RECHNEN_HILFE]);

  const plan = await plane(repo, kopf, [RECHNEN_HILFE]);

  erwarteRot(plan, RECHNEN_HILFE, `im Kopf nennen sie noch ${RECHNEN_TEST}`);
  erwarteRot(plan, RECHNEN_HILFE, `nicht löscht und listet: ${RECHNEN_TEST}`);
});

test("ausmisten-totcode-menge: eine Testhilfe, deren gelöschter Nutzer nicht auf der Liste steht, ist rot", async (context) => {
  const repo = ausmistenRepo(context, mitAltem(FREMDE_QUELLE));
  const kopf = repo.committe(ohneAltes(FREMDE_QUELLE), [RECHNEN_HILFE, RECHNEN_TEST]);

  const plan = await plane(repo, kopf, [RECHNEN_HILFE]);

  erwarteRot(plan, RECHNEN_HILFE, `nicht löscht und listet: ${RECHNEN_TEST}`);
  erwarteRot(plan, RECHNEN_TEST, NICHT_GELISTET);
  erwarteOhne(plan, "im Kopf nennen sie noch");
});

test("ausmisten-totcode-menge: ein Test, der keine gelöschte Datei und keine gelöschten Zeilen erreicht, ist rot", async (context) => {
  const repo = ausmistenRepo(context);
  const kopf = repo.committe({}, [UHR_TEST]);

  const plan = await plane(repo, kopf, [UHR_TEST]);

  erwarteRot(plan, UHR_TEST, KEIN_TOTER_CODE);
});

test("ausmisten-totcode-menge: eine bloße Änderung der erreichten Quelle macht den Test nicht zum Totcode-Test", async (context) => {
  const repo = ausmistenRepo(context);
  const kopf = repo.committe({ [UHR_QUELLE]: NEUE_UHR }, [UHR_TEST]);

  const plan = await plane(repo, kopf, [UHR_TEST]);

  erwarteRot(plan, UHR_TEST, KEIN_TOTER_CODE);
  assert.deepEqual(plan.messmenge, [UHR_QUELLE]);
});

test("ausmisten-totcode-menge: eine gelöschte Quelle oder ein reiner Lösch-Hunk ist toter Code; gelöschte Quellen fehlen in der Messmenge", async (context) => {
  const repo = ausmistenRepo(context, mitAltem(UHR_QUELLE));
  const hunk = await plane(repo, repo.committe(ohneAltes(UHR_QUELLE), [UHR_TEST]), [UHR_TEST]);
  zurueck(repo);
  const geloescht = await plane(repo, repo.committe({}, [UHR_TEST, UHR_QUELLE]), [UHR_TEST]);

  erwarteGruen(hunk);
  assert.deepEqual(hunk.messmenge, [UHR_QUELLE]);
  erwarteGruen(geloescht);
  assert.deepEqual(geloescht.messmenge, []);
});

test("ausmisten-totcode-menge: eine nur umbenannte Quelle ist kein toter Code", async (context) => {
  const repo = ausmistenRepo(context);
  const neu = "src/uhr/zeit-neu.js";
  const kopf = repo.committe({ [neu]: GRUNDDATEIEN[UHR_QUELLE] }, [UHR_TEST, UHR_QUELLE]);

  const plan = await plane(repo, kopf, [UHR_TEST]);

  erwarteRot(plan, UHR_TEST, KEIN_TOTER_CODE);
  assert.deepEqual(plan.umbenannt, [{ von: UHR_QUELLE, nach: neu }]);
});

test("ausmisten-totcode-menge: eine nur transitiv erreichte Quelle mit reinem Lösch-Hunk macht den Test zum Totcode-Test und steht in der Messmenge", async (context) => {
  const repo = ausmistenRepo(context, TRANSITIV);
  const kopf = repo.committe({ [KERN]: KERN_KURZ }, [DOPPELT]);

  const plan = await plane(repo, kopf, [DOPPELT]);

  erwarteGruen(plan);
  assert.deepEqual(plan.messmenge, [EINGANG_QUELLE, KERN]);
});

test("ausmisten-totcode-menge: eine transitiv erreichte Quelle, die der Kopf löscht, fehlt in der Messmenge; eine umbenannte bleibt", async (context) => {
  const repo = ausmistenRepo(context, TRANSITIV);
  const ohneKern = repo.committe({ [EINGANG_QUELLE]: NEUER_EINGANG }, [DOPPELT, KERN]);
  const geloescht = await plane(repo, ohneKern, [DOPPELT]);
  zurueck(repo);
  const neu = "src/post/kern-neu.js";
  const umbenannt = repo.committe(
    {
      [EINGANG_QUELLE]: EINGANG_MIT_KERN.replace("./kern.js", "./kern-neu.js"),
      [neu]: TRANSITIV[KERN],
    },
    [DOPPELT, KERN],
  );
  const mitNeuemNamen = await plane(repo, umbenannt, [DOPPELT]);

  erwarteGruen(geloescht);
  assert.deepEqual(geloescht.messmenge, [EINGANG_QUELLE]);
  erwarteGruen(mitNeuemNamen);
  assert.deepEqual(mitNeuemNamen.messmenge, [EINGANG_QUELLE, KERN]);
  assert.deepEqual(mitNeuemNamen.umbenannt, [{ von: KERN, nach: neu }]);
});

test("ausmisten-totcode-menge: „Stryker disable“ in einer Datei der Messmenge ist rot, in der Basis wie im Kopf", async (context) => {
  const abgeschaltet = `// Stryker disable next-line all\n${KERN_KURZ}`;
  const repo = ausmistenRepo(context, TRANSITIV);
  const imKopf = await plane(repo, repo.committe({ [KERN]: abgeschaltet }, [DOPPELT]), [DOPPELT]);
  const basis = ausmistenRepo(context, { ...TRANSITIV, [KERN]: `${abgeschaltet}${ALTES}` });
  const inDerBasis = await plane(basis, basis.committe({ [KERN]: KERN_KURZ }, [DOPPELT]), [
    DOPPELT,
  ]);

  erwarteRot(imKopf, KERN, "Stryker disable");
  erwarteRot(inDerBasis, KERN, "Stryker disable");
});

test("ausmisten-totcode-menge: ein genau entfernter, gelisteter Fall bringt die Datei mit ihrer Basis-Fassung in die alten Tests", async (context) => {
  const repo = totesRepo(context, { [DOPPELT]: ZWEI_FAELLE });
  const kopf = repo.committe({ ...OHNE_ALTES, [DOPPELT]: GRUNDDATEIEN[DOPPELT] });

  const plan = await plane(repo, kopf, [`${DOPPELT}: ${FALL}`]);

  erwarteGruen(plan);
  assert.deepEqual(plan.faelle, [{ datei: DOPPELT, fall: FALL }]);
  assert.deepEqual(plan.alteTests, [DOPPELT]);
  assert.deepEqual(plan.geloeschteTests, []);
  assert.deepEqual(plan.messmenge, [EINGANG_QUELLE]);
});

test("ausmisten-totcode-menge: ein Fall-Eintrag für eine unveränderte oder gelöschte Datei ist rot", async (context) => {
  const repo = totesRepo(context, { [DOPPELT]: ZWEI_FAELLE });
  const unveraendert = await plane(repo, repo.committe(OHNE_ALTES), [`${DOPPELT}: ${FALL}`]);
  zurueck(repo);
  const geloescht = await plane(repo, repo.committe(OHNE_ALTES, [DOPPELT]), [
    `${DOPPELT}: ${FALL}`,
  ]);

  erwarteRot(unveraendert, DOPPELT, "der PR ändert die Datei nicht");
  erwarteRot(geloescht, DOPPELT, "die Datei fehlt im Kopf");
});

test("ausmisten-totcode-menge: ein gelisteter Fall, neben dem sich ein Kommentar oder eine Leerzeile ändert, ist nicht genau entfernt und rot", async (context) => {
  const repo = totesRepo(context, { [DOPPELT]: ZWEI_FAELLE });
  const mitKommentar = `${GRUNDDATEIEN[DOPPELT]}// bleibt\n`;
  const kommentar = await plane(repo, repo.committe({ ...OHNE_ALTES, [DOPPELT]: mitKommentar }), [
    `${DOPPELT}: ${FALL}`,
  ]);
  zurueck(repo);
  const mitLeerzeile = GRUNDDATEIEN[DOPPELT].replace('";\n', '";\n\n');
  const leerzeile = await plane(repo, repo.committe({ ...OHNE_ALTES, [DOPPELT]: mitLeerzeile }), [
    `${DOPPELT}: ${FALL}`,
  ]);

  erwarteRot(kommentar, DOPPELT, NICHT_GENAU);
  erwarteRot(leerzeile, DOPPELT, NICHT_GENAU);
  assert.deepEqual(leerzeile.alteTests, []);
});

test("ausmisten-totcode-menge: ein genau entfernter Fall, der nicht auf der Liste steht, ist ein Verstoß", async (context) => {
  const repo = totesRepo(context, { [DOPPELT]: ZWEI_FAELLE });
  const kopf = repo.committe({ ...OHNE_ALTES, [DOPPELT]: GRUNDDATEIEN[DOPPELT] }, [UHR_TEST]);

  const plan = await plane(repo, kopf, [UHR_TEST]);

  erwarteRot(plan, `${DOPPELT}: ${FALL}`, NICHT_GELISTET);
  assert.deepEqual(plan.nichtGelistet, [`${DOPPELT}: ${FALL}`]);
});

test("ausmisten-totcode-menge: ein entfernter Untertest ist kein ganzer Fall und rot", async (context) => {
  const gruppe = (faelle) =>
    [
      'import assert from "node:assert/strict";',
      'import { test } from "node:test";',
      'import * as modul from "../../src/post/eingang.js";',
      "",
      'test("gruppe", async (t) => {',
      ...faelle.map((name) => `  await t.test(${JSON.stringify(name)}, () => assert.ok(modul));`),
      "});",
      "",
    ].join("\n");
  const repo = totesRepo(context, { [DOPPELT]: gruppe([FALL, "bleibt"]) });
  const kopf = repo.committe({ ...OHNE_ALTES, [DOPPELT]: gruppe(["bleibt"]) });

  const plan = await plane(repo, kopf, [`${DOPPELT}: ${FALL}`]);

  erwarteRot(plan, DOPPELT, NICHT_GENAU);
  assert.deepEqual(plan.faelle, []);
});

test("ausmisten-totcode-menge: removedCases prüft den übergebenen Nachher-Text, nicht HEAD, und lässt nur die Leerzeile am Fall weg", (context) => {
  const folge = "test/post/folge.test.js";
  const danach = "assert.ok(modul);\n";
  const repo = totesRepo(context, { [DOPPELT]: ZWEI_FAELLE, [folge]: `${ZWEI_FAELLE}${danach}` });
  repo.committe({ [DOPPELT]: GRUNDDATEIEN[DOPPELT] });
  const faelle = (nachher, datei = DOPPELT) =>
    imRepo(repo, () => removedCases(repo.master, datei, nachher));

  assert.deepEqual(faelle(GRUNDDATEIEN[DOPPELT]), [FALL]);
  assert.deepEqual(faelle(`${GRUNDDATEIEN[DOPPELT]}\n`), [FALL]);
  assert.deepEqual(faelle(`${GRUNDDATEIEN[DOPPELT]}// noch etwas\n`), []);
  assert.deepEqual(faelle(`\n${GRUNDDATEIEN[DOPPELT]}`), []);
  assert.deepEqual(faelle(ZWEI_FAELLE), []);
  assert.deepEqual(faelle(`${GRUNDDATEIEN[DOPPELT]}${danach}`, folge), [FALL]);
  assert.deepEqual(faelle(`${GRUNDDATEIEN[DOPPELT]}\n${danach}`, folge), [FALL]);
  assert.deepEqual(faelle(`${GRUNDDATEIEN[DOPPELT]}\n\n${danach}`, folge), []);
});

test("ausmisten-totcode-menge: removedCases erkennt einen Blatt-Fall in einer describe-Gruppe", (context) => {
  const gruppe = "test/post/gruppe.test.js";
  const faelleIn = (namen) =>
    [
      'import assert from "node:assert/strict";',
      'import { describe, it } from "node:test";',
      "",
      'describe("Gruppe", () => {',
      ...namen.map((name) => `  it(${JSON.stringify(name)}, () => assert.ok(name));`),
      "});",
      "",
    ].join("\n");
  const repo = totesRepo(context, { [gruppe]: faelleIn(["bleibt", FALL, "auch"]) });

  const faelle = imRepo(repo, () =>
    removedCases(repo.master, gruppe, faelleIn(["bleibt", "auch"])),
  );

  assert.deepEqual(faelle, [FALL]);
});

test("ausmisten-totcode-menge: ein gelöschter Test, der tools/ über ein gestartetes Programm prüft, ist rot", async (context) => {
  const lauf = "test/post/lauf.test.js";
  const inhalt = `${GRUNDDATEIEN[DOPPELT]}const PROGRAMM = "tools/lauf.mjs";\nassert.ok(PROGRAMM);\n`;
  const repo = totesRepo(context, { [lauf]: inhalt });
  const kopf = repo.committe(OHNE_ALTES, [lauf]);

  const plan = await plane(repo, kopf, [lauf]);

  erwarteRot(plan, lauf, "prüft tools/ oder scripts/ (test/post/lauf.test.js)");
});

test("ausmisten-totcode-menge: ein gelöschter Test, der eine nicht gemessene Datei liest oder importiert, die im Kopf bleibt, ist rot", async (context) => {
  const liest = "test/post/seite.test.js";
  const importiert = "test/post/web.test.js";
  const seite = "public/seite.html";
  const web = "apps/web/rechner.js";
  const repo = totesRepo(context, {
    [seite]: "<p>Seite</p>\n",
    [web]: "export const rechner = 1;\n",
    [liest]: `${GRUNDDATEIEN[DOPPELT]}const SEITE = "public/seite.html";\nassert.ok(SEITE);\n`,
    [importiert]: `${GRUNDDATEIEN[DOPPELT]}import * as rechner from "../../apps/web/rechner.js";\nassert.ok(rechner);\n`,
  });
  const bleibt = await plane(repo, repo.committe(OHNE_ALTES, [liest, importiert]), [
    liest,
    importiert,
  ]);
  zurueck(repo);
  const weg = await plane(repo, repo.committe(OHNE_ALTES, [liest, importiert, seite, web]), [
    liest,
    importiert,
  ]);

  erwarteRot(bleibt, liest, `erreicht in der Basis ${seite}`);
  erwarteRot(bleibt, importiert, `erreicht in der Basis ${web}`);
  erwarteGruen(weg);
});

test("ausmisten-totcode-menge: ein gelöschter Test, der eine lebende Quelle unter src/ nur als Text nennt, ist rot, auch wenn er toten Code importiert", async (context) => {
  const nennt = "test/post/nennt.test.js";
  const inhalt = `${GRUNDDATEIEN[DOPPELT]}const UHR = "src/uhr/zeit.js";\nassert.ok(UHR);\n`;
  const repo = totesRepo(context, { [nennt]: inhalt });
  const kopf = repo.committe(OHNE_ALTES, [nennt]);

  const plan = await plane(repo, kopf, [nennt]);

  erwarteRot(plan, nennt, `nennt ${UHR_QUELLE} nur als Text`);
  erwarteOhne(plan, KEIN_TOTER_CODE);
});

test("ausmisten-totcode-menge: ein dynamischer Import ohne festes, vorhandenes Ziel ist rot, ein fester nicht", async (context) => {
  const fest = "test/post/fest.test.js";
  const berechnet = "test/post/berechnet.test.js";
  const fehlt = "test/post/fehlt.test.js";
  const oben = "test/post/oben.test.js";
  const leerzeichen = "test/post/leerzeichen.test.js";
  const vorlage = "test/post/vorlage.test.js";
  const endung = "test/post/endung.test.js";
  const kopfteil = 'import assert from "node:assert/strict";\n';
  const repo = totesRepo(context, {
    [fest]: `${kopfteil}const modul = await import("../../src/post/eingang.js");\nassert.ok(modul);\n`,
    [berechnet]: `${kopfteil}const ZIEL = "../../src/post/eingang.js";\nconst modul = await import(ZIEL);\nassert.ok(modul);\n`,
    [fehlt]: `${kopfteil}const modul = await import("../../src/post/fehlt.js");\nassert.ok(modul);\n`,
    [oben]: `${kopfteil}const modul = await import("../../../aussen.js");\nassert.ok(modul);\n`,
    [leerzeichen]: `${kopfteil}const ZIEL = "../../src/post/eingang.js";\nconst modul = await import (ZIEL);\nassert.ok(modul);\n`,
    [vorlage]: `${kopfteil}const modul = await import(\`../../src/post/eingang.js\`);\nassert.ok(modul);\n`,
    [endung]: `${kopfteil}import { eingang } from "../../src/post/eingang.js";\nconst modul = await import("../../src/post/typ.js");\nassert.ok(modul && eingang);\n`,
    "src/post/typ.ts": "export const typ: number = 1;\n",
  });
  const kopf = repo.committe(OHNE_ALTES, [
    fest,
    berechnet,
    fehlt,
    oben,
    leerzeichen,
    vorlage,
    endung,
  ]);

  const plan = await plane(repo, kopf, [
    fest,
    berechnet,
    fehlt,
    oben,
    leerzeichen,
    vorlage,
    endung,
  ]);

  erwarteRot(plan, berechnet, "dynamischer Import ohne sicher auflösbares Ziel");
  erwarteRot(plan, fehlt, "dynamischer Import ohne sicher auflösbares Ziel");
  erwarteRot(plan, oben, "dynamischer Import ohne sicher auflösbares Ziel");
  erwarteRot(plan, leerzeichen, "dynamischer Import ohne sicher auflösbares Ziel");
  const festeGruende = plan.verstoesse.filter(({ datei }) =>
    [fest, vorlage, endung].includes(datei),
  );
  assert.deepEqual(festeGruende, []);
  zurueck(repo);
  assert.deepEqual(
    imRepo(repo, () => dynamischeZiele(endung)),
    ["src/post/typ.ts"],
  );
});
