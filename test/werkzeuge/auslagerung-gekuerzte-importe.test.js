import { test } from "node:test";

import { auslagerung, datei, istKeineReineAuslagerung, istReineAuslagerung, weitergereicht } from "./auslagerung-hilfen.js";

const MASSE = {
  "src/masse.js": 'export const GRENZE = 0;\nexport const STUFE = "aus";\nexport const EXTRA = 1;\nexport function runde(wert) {\n  return Math.round(wert);\n}\n',
  "src/anders.js": 'export const GRENZE = 1;\nexport const STUFE = "an";\nexport function runde(wert) {\n  return wert;\n}\n',
  "src/tot.js": "export const TOT = 1;\n",
};
const KOPF = 'import { einordnen } from "./zahl.js";';
const ALLE_NAMEN = 'import { GRENZE, STUFE, runde } from "./masse.js";';
const OHNE_STUFE = 'import { GRENZE, runde } from "./masse.js";';
const NUR_STUFE = 'import { STUFE } from "./masse.js";';
const OBERHALB = "export function oberhalb(wert) {\n  return wert > GRENZE;\n}";
const GERUNDET = "export function gerundet(wert) {\n  return runde(wert);\n}";
const STUFE_LESEN = "export function stufe() {\n  return STUFE;\n}";
const MIT_STUFE = 'export function pruefen(wert) {\n  return einordnen(wert) === "negativ" ? STUFE : "an";\n}';
const MIT_GRENZE_UND_STUFE = 'export function pruefen(wert) {\n  return einordnen(wert) === "negativ" ? STUFE : GRENZE;\n}';
const OHNE_NAMEN = 'export function pruefen(wert) {\n  return einordnen(wert) === "negativ" ? "aus" : "an";\n}';

function kuerzung(context, { alt = ALLE_NAMEN, nachher = NUR_STUFE, neuKopf = OHNE_STUFE, rest = MIT_STUFE, verschoben = [OBERHALB, GERUNDET] }) {
  const namen = verschoben.map((anweisung) => anweisung.match(/function (\w+)/)[1]).join(", ");
  return auslagerung(context, {
    basisDazu: MASSE,
    vorher: datei(KOPF, alt, ...verschoben, rest),
    nachher: datei(...[KOPF, nachher, weitergereicht(namen), rest].filter(Boolean)),
    neu: datei(neuKopf, ...verschoben),
  });
}

test("Auslagerung mit gekürzten Importen: streicht die alte Datei Namen, die nur der verschobene Code las, und importiert die neue Datei sie mit derselben Bindung und liest sie, ist das eine reine Auslagerung", (context) => {
  istReineAuslagerung(context, kuerzung(context, {}));
});

test("Auslagerung mit gekürzten Importen: fällt eine ganze Importanweisung weg, weil alle ihre Namen nur der verschobene Code las, bleibt es eine reine Auslagerung", (context) => {
  istReineAuslagerung(context, kuerzung(context, { alt: OHNE_STUFE, nachher: "", rest: OHNE_NAMEN }));
});

test("Auslagerung mit gekürzten Importen: liest die alte Datei den gestrichenen Namen noch, ist es keine reine Auslagerung", (context) => {
  istKeineReineAuslagerung(context, kuerzung(context, { rest: MIT_GRENZE_UND_STUFE }));
});

test("Auslagerung mit gekürzten Importen: importiert die neue Datei einen gestrichenen Namen nicht, den ihr Code liest, ist es keine reine Auslagerung", (context) => {
  istKeineReineAuslagerung(context, kuerzung(context, { neuKopf: 'import { runde } from "./masse.js";' }));
});

test("Auslagerung mit gekürzten Importen: streicht die alte Datei einen Namen, den kein verschobener Code las und die neue Datei nicht importiert, ist es keine reine Auslagerung", (context) => {
  const alt = 'import { GRENZE, runde, EXTRA } from "./masse.js";';
  istKeineReineAuslagerung(context, kuerzung(context, { alt, nachher: "", rest: OHNE_NAMEN }));
});

test("Auslagerung mit gekürzten Importen: importiert die neue Datei einen gestrichenen Namen, den ihr Code nicht liest, ist es keine reine Auslagerung", (context) => {
  const alt = 'import { GRENZE, runde, EXTRA } from "./masse.js";';
  const neuKopf = 'import { GRENZE, runde, EXTRA } from "./masse.js";';
  istKeineReineAuslagerung(context, kuerzung(context, { alt, nachher: "", neuKopf, rest: OHNE_NAMEN }));
});

test("Auslagerung mit gekürzten Importen: importiert die neue Datei einen gestrichenen Namen unter anderem Namen zusätzlich, ist es keine reine Auslagerung", (context) => {
  const neuKopf = 'import { GRENZE, GRENZE as OBERGRENZE, runde } from "./masse.js";';
  istKeineReineAuslagerung(context, kuerzung(context, { alt: OHNE_STUFE, nachher: "", neuKopf, rest: OHNE_NAMEN }));
});

test("Auslagerung mit gekürzten Importen: importiert die neue Datei einen gestrichenen Namen aus anderer Quelle, ist es keine reine Auslagerung", (context) => {
  const neuKopf = 'import { GRENZE, runde } from "./anders.js";';
  istKeineReineAuslagerung(context, kuerzung(context, { alt: OHNE_STUFE, nachher: "", neuKopf, rest: OHNE_NAMEN }));
});

test("Auslagerung mit gekürzten Importen: wird nach dem Streichen eine Datei nirgends mehr geladen, ist es keine reine Auslagerung", (context) => {
  const alt = `${OHNE_STUFE}\nimport { TOT } from "./tot.js";`;
  istKeineReineAuslagerung(context, kuerzung(context, { alt, nachher: "", rest: OHNE_NAMEN }));
});

test("Auslagerung mit gekürzten Importen: fällt ein Import ohne Namen weg, den nur die alte Datei lud, ist es keine reine Auslagerung", (context) => {
  const alt = `${OHNE_STUFE}\nimport "./tot.js";`;
  istKeineReineAuslagerung(context, kuerzung(context, { alt, nachher: "", rest: OHNE_NAMEN }));
});

test("Auslagerung mit gekürzten Importen: kommt zur gekürzten Importanweisung ein Name hinzu, ist es keine reine Auslagerung", (context) => {
  istKeineReineAuslagerung(context, kuerzung(context, { nachher: 'import { STUFE, EXTRA } from "./masse.js";' }));
});

test("Auslagerung mit gekürzten Importen: benennt die alte Datei einen verbleibenden Importnamen um, ist es keine reine Auslagerung", (context) => {
  const nachher = 'import { GRENZE as OBERGRENZE } from "./masse.js";';
  istKeineReineAuslagerung(context, kuerzung(context, { alt: OHNE_STUFE, nachher, rest: OHNE_NAMEN }));
});

test("Auslagerung mit gekürzten Importen: wechselt die gekürzte Importanweisung die Quelle, ist es keine reine Auslagerung, auch wenn die neue Datei den Namen aus der alten Quelle holt", (context) => {
  const verschoben = [OBERHALB, GERUNDET, STUFE_LESEN];
  istKeineReineAuslagerung(context, kuerzung(context, { nachher: 'import { STUFE } from "./anders.js";', neuKopf: ALLE_NAMEN, verschoben }));
});

test("Auslagerung mit gekürzten Importen: stellt die alte Datei die verbleibenden Namen einer Importanweisung um, ist es keine reine Auslagerung", (context) => {
  const alt = 'import { GRENZE, STUFE, runde } from "./masse.js";';
  const umgestellt = 'import { STUFE, GRENZE } from "./masse.js";';
  const rest = 'export function pruefen(wert) {\n  return einordnen(wert) === "negativ" ? STUFE : GRENZE;\n}';
  const neuKopf = 'import { GRENZE, STUFE, runde } from "./masse.js";';
  istKeineReineAuslagerung(context, kuerzung(context, { alt, nachher: umgestellt, neuKopf, rest }));
});

test("Auslagerung mit gekürzten Importen: teilt die alte Datei eine Importanweisung in zwei, ist es keine reine Auslagerung, auch wenn kein Name verloren geht", (context) => {
  const alt = 'import { GRENZE, STUFE, runde } from "./masse.js";';
  const geteilt = 'import { GRENZE } from "./masse.js";\nimport { STUFE } from "./masse.js";';
  const rest = 'export function pruefen(wert) {\n  return einordnen(wert) === "negativ" ? STUFE : GRENZE;\n}';
  istKeineReineAuslagerung(context, kuerzung(context, { alt, nachher: geteilt, neuKopf: 'import { runde } from "./masse.js";', rest, verschoben: [GERUNDET] }));
});

test("Auslagerung mit gekürzten Importen: streicht die alte Datei einen Namen, den sie unter Alias importierte, ist es keine reine Auslagerung, auch wenn die neue Datei denselben Alias importiert", (context) => {
  const alias = 'import { GRENZE as OBERGRENZE, runde } from "./masse.js";';
  const oberhalb = "export function oberhalb(wert) {\n  return wert > OBERGRENZE;\n}";
  istKeineReineAuslagerung(context, kuerzung(context, { alt: alias, nachher: "", neuKopf: alias, rest: OHNE_NAMEN, verschoben: [oberhalb, GERUNDET] }));
});
