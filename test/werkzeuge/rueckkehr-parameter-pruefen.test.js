import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_USAGE = 2;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT_PATH = join(REPO_ROOT, "tools", "rueckkehr-parameter-pruefen.mjs");
const SHELL_FILE = "apps/web/src/components/app/BillingIsland.astro";
const DATE_PAGE = "apps/web/src/pages/konto.astro";
const PORTAL_PATHS = [
  "export const CHECKOUT_RETURN = Object.freeze({",
  '  KARTE_GESPEICHERT: "/app?card=ok",',
  '  ABO_GESCHEITERT: "/app?sub=failed",',
  "});",
].join("\n");
const CARD_BRANCH = '    if (card === RETURN_OK) return "Karte gespeichert";';
const SUB_BRANCH = '    if (sub === RETURN_FAILED) return "Abo gescheitert";';

function shellSource(branches) {
  return [
    "<div></div>",
    "<script>",
    '  const RETURN_PARAM_CARD = "card";',
    '  const RETURN_PARAM_SUB = "sub";',
    '  const RETURN_OK = "ok";',
    '  const RETURN_FAILED = "failed";',
    "  function returnMessageText(card, sub) {",
    ...branches,
    '    return "";',
    "  }",
    "  const params = new URLSearchParams(window.location.search);",
    "  returnMessageText(params.get(RETURN_PARAM_CARD), params.get(RETURN_PARAM_SUB));",
    "</script>",
  ].join("\n");
}

function miniRoot(files) {
  const root = mkdtempSync(join(tmpdir(), "rueckkehr-parameter-"));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

function runScript(args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
}

function runInMiniRoot(kontext, files) {
  const root = miniRoot({ "src/portal-paths.js": PORTAL_PATHS, ...files });
  kontext.after(() => rmSync(root, { recursive: true, force: true }));
  return runScript(["--wurzel", root]);
}

test("das echte Repo wertet jeden Rueckkehr-Parameter aus und formatiert in keinem .astro-Skript", () => {
  const result = runScript([]);
  assert.equal(result.stdout, "");
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("eine saubere Mini-Wurzel bleibt ohne Befund", (kontext) => {
  const result = runInMiniRoot(kontext, { [SHELL_FILE]: shellSource([CARD_BRANCH, SUB_BRANCH]) });
  assert.equal(result.stdout, "");
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("fehlt der Shell ein Rueckkehr-Zweig, meldet das Skript genau diesen Fall", (kontext) => {
  const result = runInMiniRoot(kontext, { [SHELL_FILE]: shellSource([CARD_BRANCH]) });
  assert.equal(result.status, EXIT_FINDING, result.stderr);
  assert.match(result.stdout, /BillingIsland\.astro:\d+ ABO_GESCHEITERT: kein Zweig "sub === RETURN_FAILED"/);
  assert.doesNotMatch(result.stdout, /KARTE_GESPEICHERT/);
});

test("ein dritter Rueckkehr-Parameter, den die Shell liest, aber nicht an returnMessageText gibt, wird gemeldet", (kontext) => {
  const shell = shellSource([CARD_BRANCH, SUB_BRANCH]).replace(
    "  const params",
    '  const RETURN_PARAM_SETUP = "setup";\n  const params',
  );
  const result = runInMiniRoot(kontext, {
    "src/portal-paths.js": PORTAL_PATHS.replace("});", '  EINRICHTUNG_GESPEICHERT: "/app?setup=ok",\n});'),
    [SHELL_FILE]: shell.replace("  returnMessageText(", "  params.get(RETURN_PARAM_SETUP);\n  returnMessageText("),
  });
  assert.equal(result.status, EXIT_FINDING, result.stderr);
  assert.match(result.stdout, /EINRICHTUNG_GESPEICHERT: die Shell gibt RETURN_PARAM_SETUP nicht an returnMessageText weiter/);
  assert.doesNotMatch(result.stdout, /KARTE_GESPEICHERT|ABO_GESCHEITERT/);
});

test("vertauscht die Shell die Argumente von returnMessageText, wird jeder Fall gemeldet", (kontext) => {
  const shell = shellSource([CARD_BRANCH, SUB_BRANCH]).replace(
    "returnMessageText(params.get(RETURN_PARAM_CARD), params.get(RETURN_PARAM_SUB))",
    "returnMessageText(params.get(RETURN_PARAM_SUB), params.get(RETURN_PARAM_CARD))",
  );
  const result = runInMiniRoot(kontext, { [SHELL_FILE]: shell });
  assert.equal(result.status, EXIT_FINDING, result.stderr);
  assert.match(result.stdout, /KARTE_GESPEICHERT: kein Zweig "sub === RETURN_OK"/);
  assert.match(result.stdout, /ABO_GESCHEITERT: kein Zweig "card === RETURN_FAILED"/);
});

test("ein Datumsformat mit de-DE in einem .astro-Skript ist ein Befund mit Datei und Zeile", (kontext) => {
  const page = ["---", "---", "<p></p>", "<script>", '  new Date().toLocaleDateString("de-DE");', "</script>"];
  const result = runInMiniRoot(kontext, {
    [SHELL_FILE]: shellSource([CARD_BRANCH, SUB_BRANCH]),
    [DATE_PAGE]: page.join("\n"),
  });
  assert.equal(result.status, EXIT_FINDING, result.stderr);
  assert.match(result.stdout, /konto\.astro:5 toLocale /);
  assert.match(result.stdout, /konto\.astro:5 de-DE /);
});

test("ein falscher Aufruf oder eine fehlende Datei endet mit Exit 2", (kontext) => {
  assert.equal(runScript(["--unbekannt"]).status, EXIT_USAGE);
  assert.equal(runScript(["ueberzaehlig"]).status, EXIT_USAGE);
  const result = runInMiniRoot(kontext, {});
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /Datei fehlt/);
});

test("ein Zweig fuer einen laengeren Bezeichner zaehlt nicht als Zweig fuer den Parameter", (kontext) => {
  for (const fremderName of ["xcard", "discard", "_card", "$card", "äcard", "𝒞card", "a\u200dcard", "a\u200ccard", String.raw`\u0061card`, String.raw`\u{61}card`]) {
    const fremderZweig = `    if (${fremderName} === RETURN_OK) return "Karte gespeichert";`;
    const result = runInMiniRoot(kontext, { [SHELL_FILE]: shellSource([fremderZweig, SUB_BRANCH]) });
    assert.equal(result.status, EXIT_FINDING, `${fremderName}: ${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /KARTE_GESPEICHERT: kein Zweig "card === RETURN_OK"/, fremderName);
  }
});

function verschachtelteShell(imFunktionsrumpf, nachDerFunktion) {
  return [
    "<script>",
    '  const RETURN_PARAM_CARD = "card";',
    '  const RETURN_PARAM_SUB = "sub";',
    '  const RETURN_OK = "ok";',
    '  const RETURN_FAILED = "failed";',
    "  function zeigeRueckkehr() {",
    "    function returnMessageText(card, sub) {",
    CARD_BRANCH,
    ...imFunktionsrumpf,
    '      return "";',
    "    }",
    "    const params = new URLSearchParams(window.location.search);",
    "    returnMessageText(params.get(RETURN_PARAM_CARD), params.get(RETURN_PARAM_SUB));",
    ...nachDerFunktion,
    "  }",
    "  zeigeRueckkehr();",
    "</script>",
  ].join("\n");
}

const VERGLEICH_NACH_DER_FUNKTION = "    if (sub === RETURN_FAILED) track();";

test("ein Vergleich nach dem Ende einer tiefer eingerueckten Funktion ist kein Zweig der Funktion", (kontext) => {
  const result = runInMiniRoot(kontext, {
    [SHELL_FILE]: verschachtelteShell([], [VERGLEICH_NACH_DER_FUNKTION]),
  });
  assert.equal(result.status, EXIT_FINDING, result.stdout + result.stderr);
  assert.match(result.stdout, /ABO_GESCHEITERT: kein Zweig "sub === RETURN_FAILED"/);
  assert.doesNotMatch(result.stdout, /KARTE_GESPEICHERT/);
});

test("ein Zweig hinter einem inneren Block einer Funktion in Spalte 0 zaehlt als Zweig der Funktion", (kontext) => {
  const rumpf = ["    if (card === RETURN_OK) {", '      return "Karte gespeichert";', "    }", SUB_BRANCH];
  const shell = shellSource(rumpf).replaceAll("\n  ", "\n");
  const result = runInMiniRoot(kontext, { [SHELL_FILE]: shell });
  assert.equal(result.stdout, "");
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("Klammern in Zeichenketten und Kommentaren verschieben das Funktionsende nicht", (kontext) => {
  const stoerer = [
    'return "{";',
    "return '{';",
    "return `{`;",
    String.raw`return "\"{";`,
    "return `$ {`;",
    "return `\\`{`;",
    "return `\\${`;",
    "// {",
    "/* { */",
  ];
  for (const zeile of stoerer) {
    const shell = verschachtelteShell([`      ${zeile}`], [VERGLEICH_NACH_DER_FUNKTION]);
    const result = runInMiniRoot(kontext, { [SHELL_FILE]: shell });
    assert.equal(result.status, EXIT_FINDING, `${zeile}: ${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /ABO_GESCHEITERT: kein Zweig "sub === RETURN_FAILED"/, zeile);
  }
});

function befundMitRumpfzeile(kontext, zeile) {
  const result = runInMiniRoot(kontext, { [SHELL_FILE]: verschachtelteShell([`      ${zeile}`], [VERGLEICH_NACH_DER_FUNKTION]) });
  assert.equal(result.status, EXIT_FINDING, `${zeile}: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

test("Code im Funktionsrumpf, den nur ein Textleser missverstuende, liest die Pruefung aus dem Syntaxbaum", (kontext) => {
  const gueltig = ['if (/\\{/.test(wert)) return "";', "return wert / 2;", "return `${`{`}`;", "return `${wert}`;"];
  for (const zeile of gueltig) {
    const befund = befundMitRumpfzeile(kontext, zeile);
    assert.match(befund, /ABO_GESCHEITERT: kein Zweig "sub === RETURN_FAILED"/, zeile);
    assert.doesNotMatch(befund, /KARTE_GESPEICHERT/, zeile);
  }
  for (const zeile of ['return "{;', "return '{;"]) {
    const befund = befundMitRumpfzeile(kontext, zeile);
    assert.match(befund, /BillingIsland\.astro:\d+ ein script-Block der Shell laesst sich nicht als JavaScript lesen/, zeile);
  }
});

test("ein Zweig, dessen Argument oder Konstante neu gebunden oder anders verwendet wird, zaehlt nicht", (kontext) => {
  const ueberdeckt = {
    "Konstante im Rumpf": ['    const RETURN_FAILED = "anders";', SUB_BRANCH],
    "Konstante als Parameter einer inneren Funktion": ["    const pruefe = (RETURN_FAILED) => RETURN_FAILED;", SUB_BRANCH],
    "Argument neu zugewiesen": ["    sub = null;", SUB_BRANCH],
    "Argument mit var ueberdeckt": ["    var sub = null;", SUB_BRANCH],
    "mit vertauschten Seiten": ['    if (RETURN_FAILED === sub) return "Abo gescheitert";'],
    "mit ==": ['    if (sub == RETURN_FAILED) return "Abo gescheitert";'],
  };
  for (const [fall, rumpf] of Object.entries(ueberdeckt)) {
    const result = meldeJedenFall(kontext, shellSource([CARD_BRANCH, ...rumpf]), [
      [fall, /ABO_GESCHEITERT: sub oder RETURN_FAILED steht ausserhalb eines Vergleichs "sub === RETURN_FAILED" und kann ueberdeckt sein/],
    ]);
    assert.doesNotMatch(result.stdout, /KARTE_GESPEICHERT/, fall);
  }
  const zugewiesen = shellSource([CARD_BRANCH, SUB_BRANCH]).replace("  const params", '  RETURN_FAILED = "anders";\n  const params');
  meldeJedenFall(kontext, zugewiesen, [
    ["Konstante zugewiesen", /ABO_GESCHEITERT: sub oder RETURN_FAILED steht ausserhalb eines Vergleichs/],
  ]);
});

test("eine Parameter-Konstante ausserhalb von params.get oder eine Konstante, die erst nach dem Aufruf entsteht, wird gemeldet", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const parameter = '  const RETURN_PARAM_SUB = "sub";';
  const wert = '  const RETURN_FAILED = "failed";';
  const ausserhalb = /ABO_GESCHEITERT: RETURN_PARAM_SUB steht ausserhalb von params\.get\(RETURN_PARAM_SUB\) und kann ueberdeckt sein/;
  const faelle = [
    ["im Block ueberdeckt", clean.replace(CALL_LINE, `  {\n    const RETURN_PARAM_SUB = "card";\n  ${CALL_TEXT}\n  }`), ausserhalb],
    ["anders verwendet", clean.replace(CALL_LINE, `${CALL_LINE}\n  const kopie = RETURN_PARAM_SUB;`), ausserhalb],
    ["Wert nach dem Aufruf", clean.replace(wert, "").replace(CALL_LINE, `${CALL_LINE}\n${wert}`), /ABO_GESCHEITERT: RETURN_FAILED ist beim Aufruf von returnMessageText noch nicht deklariert/],
    ["Parameter nach dem Aufruf", clean.replace(parameter, "").replace(CALL_LINE, `${CALL_LINE}\n${parameter}`), /ABO_GESCHEITERT: RETURN_PARAM_SUB ist beim Aufruf von returnMessageText noch nicht deklariert/],
  ];
  for (const [fall, shell, muster] of faelle) {
    const result = meldeJedenFall(kontext, shell, [[fall, muster]]);
    assert.doesNotMatch(result.stdout, /KARTE_GESPEICHERT/, fall);
  }
});

test("eine Funktion returnMessageText, die am Ort des Aufrufs nicht sichtbar ist, wird gemeldet", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const kopf = "  function returnMessageText(card, sub) {";
  const ende = '    return "";\n  }';
  const huellen = { "nie aufgerufene Funktion": "  function versteckt() {", Block: "  {" };
  for (const [fall, huelle] of Object.entries(huellen)) {
    meldeJedenFall(kontext, clean.replace(kopf, `${huelle}\n${kopf}`).replace(ende, `${ende}\n  }`), [
      [fall, /KARTE_GESPEICHERT: returnMessageText ist am Ort eines Aufrufs nicht sichtbar/],
      [fall, /ABO_GESCHEITERT: returnMessageText ist am Ort eines Aufrufs nicht sichtbar/],
    ]);
  }
});

test("ein Zweig, dessen Vergleichswert in einem laengeren Bezeichner endet, zaehlt nicht als Zweig", (kontext) => {
  for (const fremderWert of ["RETURN_OKä", "RETURN_OK𝒞", "RETURN_OK1", "RETURN_OK$", "RETURN_OK\u200c", "RETURN_OK\u200d", String.raw`RETURN_OK\u0041`, String.raw`RETURN_OK\u{41}`]) {
    const fremderZweig = `    if (card === ${fremderWert}) return "Karte gespeichert";`;
    const result = runInMiniRoot(kontext, { [SHELL_FILE]: shellSource([fremderZweig, SUB_BRANCH]) });
    assert.equal(result.status, EXIT_FINDING, `${fremderWert}: ${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /KARTE_GESPEICHERT: kein Zweig "card === RETURN_OK"/, fremderWert);
  }
});

test("fehlt die Funktion returnMessageText ganz, meldet das Skript genau das", (kontext) => {
  const shell = [
    "<script>",
    '  const RETURN_PARAM_CARD = "card";',
    '  const RETURN_PARAM_SUB = "sub";',
    '  const RETURN_OK = "ok";',
    '  const RETURN_FAILED = "failed";',
    "</script>",
  ].join("\n");
  const result = runInMiniRoot(kontext, { [SHELL_FILE]: shell });
  assert.equal(result.status, EXIT_FINDING, result.stderr);
  assert.match(result.stdout, /KARTE_GESPEICHERT: die Shell hat keine Funktion returnMessageText\(\)/);
  assert.doesNotMatch(result.stdout, /mehr als eine Funktion returnMessageText/);
});

test("ein auskommentierter Funktionskopf vor der echten Funktion verschiebt deren Ende nicht", (kontext) => {
  const kopf = "    function returnMessageText(card, sub) {";
  const alterKopf = "    // alt: function returnMessageText(card, sub) {";
  const shell = verschachtelteShell([], [VERGLEICH_NACH_DER_FUNKTION]).replace(kopf, `${alterKopf}\n${kopf}`);
  const result = runInMiniRoot(kontext, { [SHELL_FILE]: shell });
  assert.equal(result.status, EXIT_FINDING, result.stdout + result.stderr);
  assert.match(result.stdout, /ABO_GESCHEITERT: kein Zweig "sub === RETURN_FAILED"/);
});

test("zwei Funktionen returnMessageText machen die Shell unlesbar", (kontext) => {
  const einmal = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const result = runInMiniRoot(kontext, { [SHELL_FILE]: `${einmal}\n${einmal}` });
  assert.equal(result.status, EXIT_FINDING, result.stdout + result.stderr);
  assert.match(result.stdout, /es gibt mehr als eine Funktion returnMessageText\(\)/);
});

const PARAMS_LINE = "  const params = new URLSearchParams(window.location.search);";
const CALL_LINE = "  returnMessageText(params.get(RETURN_PARAM_CARD), params.get(RETURN_PARAM_SUB));";
const CALL_TEXT = CALL_LINE.trim();
const SWAPPED_CALL_LINE = "  returnMessageText(params.get(RETURN_PARAM_SUB), params.get(RETURN_PARAM_CARD));";
const OTHER_CALL_LINE = "  zeigeAn(params.get(RETURN_PARAM_SUB), params.get(RETURN_PARAM_CARD));";
const UNCLEAR_CALL = "returnMessageText wird anders als mit params\\.get\\(\\.\\.\\.\\) als Argumenten aufgerufen oder weitergereicht";
const NOT_FROM_LOCATION = "params ist beim Aufruf nicht aus new URLSearchParams\\(window\\.location\\.search\\) gesetzt";

function meldeJedenFall(kontext, shell, muster) {
  const result = runInMiniRoot(kontext, { [SHELL_FILE]: shell });
  assert.equal(result.status, EXIT_FINDING, result.stdout + result.stderr);
  for (const [fall, regel] of muster) assert.match(result.stdout, regel, fall);
  return result;
}

test("ein Aufruf von returnMessageText, der nur in einem Kommentar, einer Zeichenkette oder ausserhalb des Skripts steht, zaehlt nicht", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const faelle = {
    zeilenkommentar: clean.replace(CALL_LINE, `  // ${CALL_TEXT}`),
    blockkommentar: clean.replace(CALL_LINE, `  /*\n  ${CALL_TEXT}\n  */`),
    zeichenkette: clean.replace(CALL_LINE, `  const aufruf = "${CALL_TEXT}";`),
    markup: `${clean.replace(CALL_LINE, "")}\n<p>${CALL_TEXT}</p>`,
    "ohne Namen": clean.replace(CALL_LINE, "  returnMessageText(params.get(), params.get());"),
    berechnet: clean.replace(CALL_LINE, "  const get = 'get';\n  returnMessageText(params[get](RETURN_PARAM_CARD), params[get](RETURN_PARAM_SUB));"),
  };
  for (const [fall, shell] of Object.entries(faelle)) {
    meldeJedenFall(kontext, shell, [
      [fall, /KARTE_GESPEICHERT: die Shell gibt RETURN_PARAM_CARD nicht an returnMessageText weiter/],
      [fall, /ABO_GESCHEITERT: die Shell gibt RETURN_PARAM_SUB nicht an returnMessageText weiter/],
    ]);
  }
});

test("eine Konstante, die nur in einem Kommentar oder ausserhalb des Skripts steht, kennt die Shell nicht", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const wert = '  const RETURN_FAILED = "failed";';
  const parameter = '  const RETURN_PARAM_SUB = "sub";';
  meldeJedenFall(kontext, clean.replace(wert, `  // ${wert.trim()}`), [
    ["Wert im Kommentar", /ABO_GESCHEITERT: die Shell kennt den Wert "failed" nicht/],
  ]);
  meldeJedenFall(kontext, clean.replace(wert, "") + `\n<p>${wert.trim()}</p>`, [
    ["Wert im Markup", /ABO_GESCHEITERT: die Shell kennt den Wert "failed" nicht/],
  ]);
  meldeJedenFall(kontext, clean.replace(parameter, `  /* ${parameter.trim()} */`), [
    ["Parameter im Kommentar", /ABO_GESCHEITERT: die Shell kennt den Parameter "sub" nicht/],
  ]);
});

test("ein Zweig oder eine Funktion returnMessageText, die nur in einem Kommentar steht, zaehlt nicht", (kontext) => {
  const kommentarZweig = '    // if (sub === RETURN_FAILED) return "Abo gescheitert";';
  const blockZweig = '    /* if (sub === RETURN_FAILED) return "Abo gescheitert"; */';
  for (const zweig of [kommentarZweig, blockZweig]) {
    meldeJedenFall(kontext, shellSource([CARD_BRANCH, zweig]), [
      [zweig, /ABO_GESCHEITERT: kein Zweig "sub === RETURN_FAILED"/],
    ]);
  }
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const ausgeklammert = clean
    .replace("  function returnMessageText(card, sub) {", "  /*\n  function returnMessageText(card, sub) {")
    .replace('    return "";\n  }', '    return "";\n  }\n  */');
  meldeJedenFall(kontext, ausgeklammert, [
    ["Funktion im Kommentar", /KARTE_GESPEICHERT: die Shell hat keine Funktion returnMessageText\(\)/],
  ]);
});

test("params, das nicht aus der Adresse der Seite entsteht, wird gemeldet", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const fremd = {
    "eine Map": "  const params = new Map(window.location.search);",
    "ein anderer Name": "  const suche = new URLSearchParams(window.location.search);",
    "der Cookie": "  const params = new URLSearchParams(document.cookie);",
    "ein fester Text": '  const params = new URLSearchParams("card=ok&sub=ok");',
    "der Hash": "  const params = new URLSearchParams(window.location.hash);",
    "eine Destrukturierung": "  const { params } = window;",
    "nur ein Kommentar": `  // ${PARAMS_LINE.trim()}`,
    "spaeter ueberschrieben": `${PARAMS_LINE.replace("const", "let")}\n  params = new Map();`,
    "ein Funktionsparameter": `  function fremd(params) {\n    return params;\n  }\n${PARAMS_LINE}`,
    "eine andere Funktion": `  function liesAdresse() {\n  ${PARAMS_LINE.trim()}\n  }`,
    "ohne new": "  const params = URLSearchParams(window.location.search);",
    "eigenes location": `  const location = { search: "?card=ok" };\n  const params = new URLSearchParams(location.search);`,
    "eigenes window": `  const window = {};\n${PARAMS_LINE}`,
    "eigene Klasse": `  class URLSearchParams {\n    get() {\n      return null;\n    }\n  }\n${PARAMS_LINE}`,
    "ohne Adresse": "  const params = new URLSearchParams();",
    "weitergegeben": `${PARAMS_LINE}\n  aendere(params);`,
    "als Schluessel": `${PARAMS_LINE}\n  const treffer = lookup[params];`,
    "ein Eintrag geloescht": `${PARAMS_LINE}\n  params.delete(RETURN_PARAM_CARD);`,
    "get ersetzt": `${PARAMS_LINE}\n  params.get = () => null;`,
    "als Argument von get": `${PARAMS_LINE}\n  params.get(params + 1);`,
    "in einer anderen Funktion ueberdeckt": `${PARAMS_LINE}\n  function anders() {\n    const params = new Map();\n  }`,
  };
  for (const [fall, zeile] of Object.entries(fremd)) {
    meldeJedenFall(kontext, clean.replace(PARAMS_LINE, zeile), [
      [fall, new RegExp(`KARTE_GESPEICHERT: ${NOT_FROM_LOCATION}`)],
      [fall, new RegExp(`ABO_GESCHEITERT: ${NOT_FROM_LOCATION}`)],
    ]);
  }
});

test("params aus der Adresse der Seite bleibt in jeder ueblichen Form ohne Befund", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const imBlock = clean.replace(PARAMS_LINE, `  function zeige() {\n${PARAMS_LINE}`).replace(CALL_LINE, `${CALL_LINE}\n  }\n  zeige();`);
  const formen = {
    "location.search": clean.replace("window.location.search", "location.search"),
    let: clean.replace("const params", "let params"),
    "im Block der Funktion": imBlock,
    "ein HTML-Kommentar vor dem Skript": `<!-- Rueckkehr -->\n${clean}`,
    "ein <!-- in einer Zeichenkette": clean.replace('  const RETURN_OK = "ok";', '  const RETURN_OK = "ok";\n  const marker = "<!--";'),
    "ein Feld namens params": `${clean}\n<script>\n  const treffer = history.params;\n</script>`,
    "zwei gleiche Aufrufe": clean.replace(CALL_LINE, `${CALL_LINE}\n${CALL_LINE}`),
    "ein anderer Aufruf mit anderer Reihenfolge": clean.replace(CALL_LINE, `${CALL_LINE}\n${OTHER_CALL_LINE}`),
  };
  for (const [fall, shell] of Object.entries(formen)) {
    const result = runInMiniRoot(kontext, { [SHELL_FILE]: shell });
    assert.equal(result.stdout, "", fall);
    assert.equal(result.status, EXIT_OK, `${fall}: ${result.stderr}`);
  }
});

test("ein zweiter Aufruf von returnMessageText mit vertauschten Argumenten oder ohne params in Reichweite wird gemeldet", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const vertauscht = clean.replace(CALL_LINE, `${CALL_LINE}\n${SWAPPED_CALL_LINE}`);
  meldeJedenFall(kontext, vertauscht, [
    ["vertauscht Karte", /KARTE_GESPEICHERT: die Shell gibt RETURN_PARAM_CARD nicht an returnMessageText weiter/],
    ["vertauscht Abo", /ABO_GESCHEITERT: die Shell gibt RETURN_PARAM_SUB nicht an returnMessageText weiter/],
  ]);
  const imBlock = clean.replace(PARAMS_LINE, `  function zeige() {\n${PARAMS_LINE}`).replace(CALL_LINE, `${CALL_LINE}\n  }\n${CALL_LINE}`);
  meldeJedenFall(kontext, imBlock, [
    ["ausserhalb Karte", new RegExp(`KARTE_GESPEICHERT: ${NOT_FROM_LOCATION}`)],
    ["ausserhalb Abo", new RegExp(`ABO_GESCHEITERT: ${NOT_FROM_LOCATION}`)],
  ]);
});

test("params, das erst nach dem Aufruf von returnMessageText deklariert wird, ist beim Aufruf noch nicht da", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const faelle = {
    "im selben Block": clean.replace(PARAMS_LINE, "").replace(CALL_LINE, `${CALL_LINE}\n${PARAMS_LINE}`),
    "verdeckt die aeussere Deklaration": clean.replace(CALL_LINE, `  {\n  ${CALL_TEXT}\n  ${PARAMS_LINE.trim()}\n  }`),
  };
  for (const [fall, shell] of Object.entries(faelle)) {
    meldeJedenFall(kontext, shell, [
      [fall, new RegExp(`KARTE_GESPEICHERT: ${NOT_FROM_LOCATION}`)],
      [fall, new RegExp(`ABO_GESCHEITERT: ${NOT_FROM_LOCATION}`)],
    ]);
  }
});

test("ein Aufruf in einer Funktion zaehlt nur, wenn die Funktion nachweislich nach der Deklaration von params laeuft", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const zeige = `  function zeige() {\n  ${CALL_TEXT}\n  }`;
  const ohneAufruf = clean.replace(PARAMS_LINE, "").replace(CALL_LINE, `${PARAMS_LINE}\n${zeige}`);
  const zeigeMitParams = `  function zeige() {\n${PARAMS_LINE}\n  ${CALL_TEXT}\n  }`;
  const mitParams = clean.replace(PARAMS_LINE, "").replace(CALL_LINE, zeigeMitParams);
  const rot = {
    "oben, benutzt in der Funktion": clean.replace(CALL_LINE, `  function zeige() {\n  ${CALL_TEXT}\n  }\n  zeige();`),
    "params im selben Rumpf, die Funktion aber auch als Wert weitergegeben": mitParams.replace(zeigeMitParams, `${zeigeMitParams}\n  zeige();\n  const auchZeige = zeige;`),
    "params im Rumpf einer Funktion ohne Namen": clean.replace(PARAMS_LINE, `  export default function () {\n${PARAMS_LINE}`).replace(CALL_LINE, `${CALL_LINE}\n  }`),
    "vor der Deklaration aufgerufen": ohneAufruf.replace(PARAMS_LINE, `  zeige();\n${PARAMS_LINE}`),
    "ueber eine zweite Funktion vor der Deklaration": ohneAufruf.replace(PARAMS_LINE, `  vorher();\n${PARAMS_LINE}\n  function vorher() {\n    zeige();\n  }`),
    "nie aufgerufen": mitParams,
    "nur von sich selbst aufgerufen": mitParams.replace(`${CALL_TEXT}\n  }`, `${CALL_TEXT}\n    zeige();\n  }`),
    "als Rueckruf weitergereicht": mitParams.replace(zeigeMitParams, `${zeigeMitParams}\n  setTimeout(zeige);`),
    "als Generator": mitParams.replace(zeigeMitParams, `${zeigeMitParams.replace("function zeige", "function* zeige")}\n  zeige();`),
    "als async-Funktion": mitParams.replace(zeigeMitParams, `${zeigeMitParams.replace("function zeige", "async function zeige")}\n  zeige();`),
    "in einer Pfeilfunktion": clean.replace(CALL_LINE, `  const zeige = () => {\n  ${CALL_TEXT}\n  };\n  zeige();`),
    "in einem Funktionsausdruck": clean.replace(CALL_LINE, `  const zeige = function () {\n  ${CALL_TEXT}\n  };\n  zeige();`),
    "in einem Klassenfeld": clean.replace(CALL_LINE, `  class Anzeige {\n    feld = ${CALL_TEXT}\n  }\n  new Anzeige();`),
    "in einem static-Block": clean.replace(CALL_LINE, `  class Anzeige {\n    static {\n  ${CALL_TEXT}\n    }\n  }`),
    "params im Rumpf einer Funktion, die nur ein anderer Skript-Block aufruft": `${clean.replace(PARAMS_LINE, `  function nie() {\n${PARAMS_LINE}`).replace(CALL_LINE, `${CALL_LINE}\n  }`)}\n<script>\n  nie();\n</script>`,
    "params im Rumpf einer nie aufgerufenen Funktion": clean.replace(PARAMS_LINE, `  function nie() {\n${PARAMS_LINE}`).replace(CALL_LINE, `${CALL_LINE}\n  }`),
    "in einer nie aufgerufenen inneren Funktion": clean.replace(CALL_LINE, `  function aussen() {\n    function innen() {\n  ${CALL_TEXT}\n    }\n  }\n  aussen();`),
    "in einer Pfeilfunktion einer aufgerufenen Funktion": clean.replace(CALL_LINE, `  function aussen() {\n    const innen = () => {\n  ${CALL_TEXT}\n    };\n  }\n  aussen();`),
    "nur in einem anderen Skript-Block aufgerufen": `${mitParams}\n<script>\n  zeige();\n</script>`,
  };
  for (const [fall, shell] of Object.entries(rot)) {
    meldeJedenFall(kontext, shell, [
      [fall, new RegExp(`KARTE_GESPEICHERT: ${NOT_FROM_LOCATION}`)],
      [fall, new RegExp(`ABO_GESCHEITERT: ${NOT_FROM_LOCATION}`)],
    ]);
  }
  const spaeter = mitParams.replace(zeigeMitParams, `${zeigeMitParams}\n  function spaeter() {\n    function innen() {\n      zeige();\n    }\n    innen();\n  }\n  spaeter();`);
  const result = runInMiniRoot(kontext, { [SHELL_FILE]: spaeter });
  assert.equal(result.stdout, "");
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("Konstanten, Funktion und Zweig zaehlen nur als Code im Syntaxbaum, nicht als Text in Zeichenketten", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const wert = '  const RETURN_FAILED = "failed";';
  const kopf = "  function returnMessageText(card, sub) {";
  const ohneWert = clean.replace(wert, "");
  const wertUnbekannt = /ABO_GESCHEITERT: die Shell kennt den Wert "failed" nicht/;
  const kopfzeile = clean.split("\n").indexOf(kopf) + 1;
  meldeJedenFall(kontext, clean.replace(wert, `  const hinweis = '${wert.trim()}';`), [["Wert in Zeichenkette", wertUnbekannt]]);
  meldeJedenFall(kontext, clean.replace(wert, `  const hinweis = \`${wert.trim()}\`;`), [["Wert in Template", wertUnbekannt]]);
  meldeJedenFall(kontext, clean.replace(wert, wert.replace("const", "let")), [["Wert mit let", wertUnbekannt]]);
  meldeJedenFall(kontext, ohneWert.replace(kopf, `${kopf}\n${wert}`), [["Wert im Funktionsrumpf", wertUnbekannt]]);
  meldeJedenFall(kontext, `${ohneWert}\n<script>\n${wert}\n</script>`, [["Wert in anderem Skript-Block", wertUnbekannt]]);
  const imTemplate = clean.replace(kopf, `  const vorlage = \`\n${kopf}`).replace('    return "";\n  }', '    return "";\n  }\n  `;');
  meldeJedenFall(kontext, imTemplate, [
    ["Funktion in Template", /KARTE_GESPEICHERT: die Shell hat keine Funktion returnMessageText\(\)/],
  ]);
  const zweige = {
    "in einer Zeichenkette": '    const hinweis = "if (sub === RETURN_FAILED) return x";',
    "in einer Pfeilfunktion": "    const pruefe = () => sub === RETURN_FAILED;",
    "in einem inneren if": '    if (Date.now() > 0) {\n      if (sub === RETURN_FAILED) return "Abo gescheitert";\n    }',
  };
  for (const [fall, zweig] of Object.entries(zweige)) {
    const result = meldeJedenFall(kontext, shellSource([CARD_BRANCH, zweig]), [
      [fall, new RegExp(`BillingIsland\\.astro:${kopfzeile} ABO_GESCHEITERT: kein Zweig "sub === RETURN_FAILED"`)],
    ]);
    assert.doesNotMatch(result.stdout, /KARTE_GESPEICHERT/, fall);
  }
  const result = runInMiniRoot(kontext, { [SHELL_FILE]: `${clean}\n<script>\n  export default function () {}\n</script>` });
  assert.equal(result.stdout, "");
  assert.equal(result.status, EXIT_OK, result.stderr);
});

const nachDemAufruf = (clean) => (zeile) => clean.replace(CALL_LINE, `${CALL_LINE}\n${zeile}`);

function meldeJedeZusatzzeile(kontext, clean, zeilen) {
  meldeJedeEingefuegteZeile(kontext, zeilen, nachDemAufruf(clean));
}

function meldeJedeEingefuegteZeile(kontext, zeilen, einfuegen) {
  for (const [fall, zeile] of Object.entries(zeilen)) {
    meldeJedenFall(kontext, einfuegen(zeile), [
      [fall, new RegExp(`KARTE_GESPEICHERT: ${NOT_FROM_LOCATION}`)],
      [fall, new RegExp(`ABO_GESCHEITERT: ${NOT_FROM_LOCATION}`)],
    ]);
  }
}

test("jede Zuweisung an URLSearchParams, location oder ihre Eigenschaften wird gemeldet, auch ueber window, globalThis und self", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const ersatz = "class {\n    get() {\n      return null;\n    }\n  }";
  const zuweisungen = {
    "Prototyp von get": "  URLSearchParams.prototype.get = () => null;",
    "ueber window": `  window.URLSearchParams = ${ersatz};`,
    "ueber globalThis": `  globalThis.URLSearchParams = ${ersatz};`,
    "ueber self": `  self.URLSearchParams = ${ersatz};`,
    "per Schluessel an window": `  window["URLSearchParams"] = ${ersatz};`,
    "per Schluessel an einem anderen Objekt": `  document.defaultView["URLSearchParams"] = ${ersatz};`,
    "per Template-Schluessel": `  document.defaultView[\`URLSearchParams\`] = ${ersatz};`,
    "per berechnetem Schluessel": `  const name = "URLSearch" + "Params";\n  document.defaultView[name] = ${ersatz};`,
    "Name als Argument von defineProperty": '  Object.defineProperty(document.defaultView, "URLSearchParams", { value: null });',
    "Name als Template in defineProperty": "  Object.defineProperty(document.defaultView, `URLSearchParams`, { value: null });",
    "Prototyp ueber eine zweite Instanz": '  Object.getPrototypeOf(new URLSearchParams("")).get = () => null;',
    "im Kopf einer for-Schleife": "  for (new URLSearchParams(location.search); ; ) break;",
    "ueber defineProperty": '  Object.defineProperty(URLSearchParams.prototype, "get", { value: () => null });',
    "globalThis als Alias": "  const global = globalThis;",
    "self als Alias": "  const fenster = self;",
    "location.search": '  location.search = "?card=ok";',
    "window.location": '  window.location = "/app?card=ok";',
    "document.location per Schluessel": '  document["location"] = "/app?card=ok";',
    "location per Schluessel gelesen": '  const suche = location["search"];',
    "location als Schluessel": "  const treffer = lookup[location];",
    "zusammengesetzte Zuweisung": '  window.location.search += "&card=ok";',
    "hochgezaehlt": "  location.port++;",
    "geloescht": "  delete location.search;",
    "Destrukturierung in ein Objekt": '  ({ search: location.search } = { search: "?card=ok" });',
    "Destrukturierung mit Vorgabe": '  ({ search: location.search = "?card=ok" } = {});',
    "Destrukturierung in eine Liste": '  [location.hash] = ["#karte"];',
    "Rest einer Liste": '  [...location.hash] = "#karte";',
    "for-in": "  for (location.hash in { karte: 1 });",
    "for-of": '  for (location.hash of ["#karte"]);',
  };
  meldeJedeZusatzzeile(kontext, clean, zuweisungen);
  const lesend = [
    "  let ziel;",
    "  const erster = [ziel][0];",
    "  ziel = location.hash;",
    "  const kopie = { hash: location.hash, pfad: window.location.pathname };",
    '  window.location.assign("/app");',
    "  self.addEventListener(\"pageshow\", () => ziel);",
  ];
  const result = runInMiniRoot(kontext, { [SHELL_FILE]: clean.replace(CALL_LINE, `${CALL_LINE}\n${lesend.join("\n")}`) });
  assert.equal(result.stdout, "");
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("Werkzeuge der Metaprogrammierung, mit denen sich URLSearchParams auf Umwegen ersetzen liesse, werden gemeldet", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const umwege = {
    "Prototyp einer Instanz aus URL": "  Object.getPrototypeOf(new URL(location.href).searchParams).get = () => null;",
    "zusammengesetzter Name": '  const name = "URLSearch" + "Params";\n  Object.defineProperty(top, name, { value: null });',
    Object: "  const schluessel = Object.keys({});",
    Reflect: "  Reflect.ownKeys({});",
    Proxy: "  const huelle = new Proxy({}, {});",
    eval: '  eval("1");',
    Function: '  const rechne = new Function("return 1");',
    URL: '  const adresse = new URL("https://example.com");',
    prototype: "  const art = Array.prototype;",
    __proto__: "  const art = [].__proto__;",
    constructor: "  const art = [].constructor;",
    searchParams: "  const suche = anker.searchParams;",
    defaultView: "  const fenster = document.defaultView;",
    "Name als Text": '  const name = "constructor";',
    "Name als Template": "  const name = `prototype`;",
    "dynamischer Import": '  import("./fremd.js");',
    "berechneter Schluessel in einem Muster": '  const schluessel = "UR" + "LSearchParams";\n  const { [schluessel]: Klasse } = anker;',
    "berechneter Schluessel in einem Objekt": '  const schluessel = "UR" + "LSearchParams";\n  const objekt = { [schluessel]: null };',
    "__defineGetter__": '  window.__defineGetter__("UR" + "LSearchParams", () => null);',
    "__ als Schluesseltext": '  anker["__defineSetter__"]("wert", () => null);',
    top: "  const fenster = top;",
    parent: "  const fenster = parent;",
    frames: "  const fenster = frames;",
    opener: "  const fenster = opener;",
  };
  meldeJedeZusatzzeile(kontext, clean, umwege);
});

test("Wege, die die Adresse ohne Zuweisung aendern, werden gemeldet, wenn sie die Abfrage vor dem Aufruf von returnMessageText verlieren koennen", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const paramsZeile = "  const params = new URLSearchParams(window.location.search);";
  const davor = (zeile) => clean.replace(paramsZeile, `${zeile}\n${paramsZeile}`);
  const vorDemAufruf = {
    replaceState: '  history.replaceState(null, "", "/app");',
    "replaceState nur mit dem Pfad": '  history.replaceState(null, "", location.pathname);',
    "Abfrage nicht hinter dem Pfad": '  history.replaceState(null, "", "/app?" + location.search);',
    "replaceState ueber window": '  window.history.replaceState(null, "", location.pathname + location.search);',
    pushState: '  history.pushState(null, "", "/app");',
    "ein anderer Aufruf an history": "  history.go(0);",
    navigation: '  navigation.navigate("/app");',
    "history als Alias": "  const verlauf = history;",
    "replaceState als Alias": "  const ersetze = history.replaceState;",
    "Name als Text": '  const name = "replaceState";',
  };
  meldeJedeEingefuegteZeile(kontext, vorDemAufruf, davor);
  meldeJedeZusatzzeile(kontext, clean, {
    "nach dem Aufruf unter einer Bedingung": '  if (document.hidden) history.replaceState(null, "", "/app");',
    "nach dem Aufruf in einer Funktion": '  function leeren() {\n    history.replaceState(null, "", "/app");\n  }',
    "zwischen zwei Aufrufen": `  history.replaceState(null, "", "/app");\n${CALL_LINE}`,
  });
  const erlaubt = [
    davor('  history.replaceState(null, "", location.pathname + location.search);'),
    nachDemAufruf(clean)('  history.replaceState(null, "", location.pathname);'),
  ];
  for (const shell of erlaubt) {
    const result = runInMiniRoot(kontext, { [SHELL_FILE]: shell });
    assert.equal(result.stdout, "");
    assert.equal(result.status, EXIT_OK, result.stderr);
  }
});

test("ein Rueckkehrziel mit mehreren Parametern wird je Parameter geprueft", (kontext) => {
  const shell = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const mitFremdem = runInMiniRoot(kontext, {
    "src/portal-paths.js": PORTAL_PATHS.replace("/app?card=ok", "/app?card=ok&x=1"),
    [SHELL_FILE]: shell,
  });
  assert.equal(mitFremdem.status, EXIT_FINDING, mitFremdem.stderr);
  assert.match(mitFremdem.stdout, /KARTE_GESPEICHERT: die Shell kennt den Parameter "x" nicht/);
  assert.doesNotMatch(mitFremdem.stdout, /kennt den Wert/);
  const beideBekannt = runInMiniRoot(kontext, {
    "src/portal-paths.js": PORTAL_PATHS.replace("/app?card=ok", "/app?card=ok&sub=failed"),
    [SHELL_FILE]: shell,
  });
  assert.equal(beideBekannt.stdout, "");
  assert.equal(beideBekannt.status, EXIT_OK, beideBekannt.stderr);
});

test("ein Rueckkehrziel ohne Abfrage wird gemeldet", (kontext) => {
  const result = runInMiniRoot(kontext, {
    "src/portal-paths.js": PORTAL_PATHS.replace("/app?card=ok", "/app"),
    [SHELL_FILE]: shellSource([CARD_BRANCH, SUB_BRANCH]),
  });
  assert.equal(result.status, EXIT_FINDING, result.stderr);
  assert.match(result.stdout, /KARTE_GESPEICHERT: die Shell kennt den Parameter "" nicht/);
  assert.doesNotMatch(result.stdout, /ABO_GESCHEITERT/);
});

test("Wege, Text als Code auszufuehren, werden gemeldet", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const html = '"<b></b>"';
  const wege = {
    "Code als Text": '  const code = "URLSearchParams.prototype.get = () => null;";',
    "javascript-Adresse": '  window.location.assign("javascript:void 0");',
    "setTimeout mit Text": '  setTimeout("void 0");',
    "setTimeout mit Variable": '  const code = "void 0";\n  setTimeout(code);',
    "setInterval mit Text": '  setInterval("void 0");',
    "setTimeout ueber window": "  window.setTimeout(() => null);",
    "setTimeout ohne Argument": "  setTimeout();",
    "setTimeout mit neu zugewiesener Funktion": '  function spaeter() {}\n  spaeter = "void 0";\n  setTimeout(spaeter);',
    "setTimeout mit ueberdeckter Funktion": '  function spaeter() {}\n  {\n    const spaeter = "void 0";\n    setTimeout(spaeter);\n  }',
    "setTimeout mit Funktion als Parameter ueberdeckt": "  function spaeter() {}\n  function plane(spaeter) {\n    setTimeout(spaeter);\n  }",
    "setTimeout mit Funktion aus einem inneren Block": "  {\n    function spaeter() {}\n  }\n  setTimeout(spaeter);",
    "setTimeout mit zweimal deklarierter Funktion": "  function spaeter() {}\n  {\n    function spaeter() {}\n  }\n  setTimeout(spaeter);",
    createElement: '  const knoten = document.createElement("div");',
    createAttribute: '  const merkmal = document.createAttribute("data-x");',
    setAttribute: '  anker.setAttribute("onclick", "void 0");',
    setAttributeNS: '  anker.setAttributeNS(null, "onclick", "void 0");',
    innerHTML: `  anker.innerHTML = ${html};`,
    outerHTML: `  anker.outerHTML = ${html};`,
    insertAdjacentHTML: `  anker.insertAdjacentHTML("beforeend", ${html});`,
    srcdoc: `  rahmen.srcdoc = ${html};`,
    write: `  document.write(${html});`,
    writeln: `  document.writeln(${html});`,
    createContextualFragment: `  document.createRange().createContextualFragment(${html});`,
    setHTMLUnsafe: `  anker.setHTMLUnsafe(${html});`,
    parseHTMLUnsafe: `  Document.parseHTMLUnsafe(${html});`,
  };
  meldeJedeZusatzzeile(kontext, clean, wege);
  const erlaubt = ["  setTimeout(() => null);", "  function spaeter() {}", "  setInterval(spaeter);", '  const hinweis = "Abo gebucht";', "  const zahl = 1;"];
  const result = runInMiniRoot(kontext, { [SHELL_FILE]: clean.replace(CALL_LINE, `${CALL_LINE}\n${erlaubt.join("\n")}`) });
  assert.equal(result.stdout, "");
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("ein script-Tag in anderer Schreibweise wird gelesen, und ausfuehrbares Markup ausserhalb eines script-Blocks wird gemeldet", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  meldeJedenFall(kontext, `${clean}\n<SCRIPT>\n  URLSearchParams.prototype.get = () => null;\n</SCRIPT>`, [
    ["Grossbuchstaben Karte", new RegExp(`KARTE_GESPEICHERT: ${NOT_FROM_LOCATION}`)],
    ["Grossbuchstaben Abo", new RegExp(`ABO_GESCHEITERT: ${NOT_FROM_LOCATION}`)],
  ]);
  const mitLeerzeichen = runInMiniRoot(kontext, { [SHELL_FILE]: clean.replace("</script>", "</script >") });
  assert.equal(mitLeerzeichen.stdout, "");
  assert.equal(mitLeerzeichen.status, EXIT_OK, mitLeerzeichen.stderr);
  const zeile = clean.split("\n").length + 1;
  const markup = {
    "on-Attribut": '<img src="x" onerror="void 0">',
    "javascript-Adresse": '<a href="javascript:void 0">x</a>',
    "set:html": "<div set:html={inhalt}></div>",
    srcdoc: '<iframe srcdoc="x"></iframe>',
    "offener script-Block": "<script>",
  };
  for (const [fall, teil] of Object.entries(markup)) {
    meldeJedenFall(kontext, `${clean}\n${teil}`, [[fall, new RegExp(`BillingIsland\\.astro:${zeile} \\S+ ist ausfuehrbares Markup ausserhalb eines lesbaren script-Blocks`)]]);
  }
});

test("ein Datumsformat in einem script-Block jeder Schreibweise wird gemeldet, auch in einem HTML-Kommentar", (kontext) => {
  const seite = ["---", "---", "<p></p>", "<SCRIPT>", "  new Date().toLocaleDateString();", "</SCRIPT >", "<!--", "<script>", "  new Intl.DateTimeFormat();", "</script>", "-->"];
  const result = runInMiniRoot(kontext, { [DATE_PAGE]: seite.join("\n"), [SHELL_FILE]: shellSource([CARD_BRANCH, SUB_BRANCH]) });
  const zeilen = result.stdout.trim().split("\n");
  const befunde = zeilen.map((zeile) => zeile.split(" ", 2).join(" "));
  assert.deepEqual(befunde, [`${DATE_PAGE}:5 toLocale`, `${DATE_PAGE}:9 Intl`]);
  assert.equal(result.status, EXIT_FINDING, result.stderr);
});

test("ein Skript-Block in einem HTML-Kommentar wird nicht ausgefuehrt und zaehlt nicht", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  for (const [fall, shell] of Object.entries({ geschlossen: `<!--\n${clean}\n-->`, offen: `<!--\n${clean}` })) {
    meldeJedenFall(kontext, shell, [[fall, /KARTE_GESPEICHERT: die Shell kennt den Parameter "card" nicht/]]);
  }
});

test("ein Aufruf von returnMessageText, der nicht nur params.get uebergibt oder die Funktion weiterreicht, wird gemeldet", (kontext) => {
  const clean = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const zusaetze = {
    "ohne Argumente": "  returnMessageText();",
    "vertauscht mit Zusatz": "  returnMessageText(params.get(RETURN_PARAM_SUB), params.get(RETURN_PARAM_CARD) ?? null);",
    "mit einer Variablen": "  returnMessageText(params.get(RETURN_PARAM_CARD), RETURN_OK);",
    "mit einem Template": "  returnMessageText(`${params.get(RETURN_PARAM_CARD)}`, params.get(RETURN_PARAM_SUB));",
    "als Wert weitergereicht": "  const weiter = returnMessageText;",
    "ueber call": "  returnMessageText.call(null, params.get(RETURN_PARAM_CARD), params.get(RETURN_PARAM_SUB));",
  };
  for (const [fall, zeile] of Object.entries(zusaetze)) {
    meldeJedenFall(kontext, clean.replace(CALL_LINE, `${CALL_LINE}\n${zeile}`), [
      [fall, new RegExp(`KARTE_GESPEICHERT: ${UNCLEAR_CALL}`)],
      [fall, new RegExp(`ABO_GESCHEITERT: ${UNCLEAR_CALL}`)],
    ]);
  }
});

test("ein script-Block, der kein gueltiges JavaScript ist, macht die Shell unlesbar und wird mit seiner Zeile gemeldet", (kontext) => {
  const einmal = shellSource([CARD_BRANCH, SUB_BRANCH]);
  const zeilen = einmal.split("\n").length;
  const result = meldeJedenFall(kontext, `${einmal}\n<script>\n  const kaputt = ;\n</script>`, [
    ["Zeile", new RegExp(`BillingIsland\\.astro:${zeilen + 2} ein script-Block der Shell laesst sich nicht als JavaScript lesen`)],
  ]);
  assert.doesNotMatch(result.stdout, /KARTE_GESPEICHERT|ABO_GESCHEITERT/);
});
