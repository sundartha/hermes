import assert from "node:assert/strict";
import { test } from "node:test";

import { vergleicheVorbereitung } from "../../tools/vorbereitung-pruefen.mjs";

const PFAD = "src/probe.js";
const ZERLEGEN = "hilfe-zerlegen";
const BEFUND = /^src\/probe\.js:\d+: Änderung, die keine Umformung aus tools\/vorbereitung\/katalog\.json ist$/;

function quelle(...zeilen) {
  return `${zeilen.join("\n")}\n`;
}

async function vergleich(vorher, nachher) {
  return vergleicheVorbereitung({ pfad: PFAD, vorher, nachher });
}

const KOPF = ['import { llm, store } from "./dienste.js";', 'import { baue, normalisiere } from "./baustein.js";'];

const ALT = quelle(
  ...KOPF,
  "export async function fasse(call) {",
  "  const ctx = store.kontext(call.id);",
  "  if (!ctx.erlaubt) return null;",
  '  const gespraech = call.protokoll.map((zeile) => `${zeile.rolle}: ${zeile.text}`).join("\\n");',
  "  const antwort = await llm.frage({ gespraech });",
  '  let gelesen = { summe: "", punkte: [] };',
  "  try {",
  "    gelesen = JSON.parse(antwort.text);",
  "  } catch {",
  "    gelesen.summe = antwort.text;",
  "  }",
  "  call.summe = gelesen.summe || null;",
  "  call.ergebnis = normalisiere(gelesen);",
  "  store.sichere();",
  "  for (const punkt of gelesen.punkte || []) store.merke(call.id, punkt);",
  "  return gelesen;",
  "}",
);

const NEU = quelle(
  ...KOPF,
  "function gespraechVon(call) {",
  '  return call.protokoll.map((zeile) => `${zeile.rolle}: ${zeile.text}`).join("\\n");',
  "}",
  "function lies(antwort) {",
  '  let gelesen = { summe: "", punkte: [] };',
  "  try {",
  "    gelesen = JSON.parse(antwort.text);",
  "  } catch {",
  "    gelesen.summe = antwort.text;",
  "  }",
  "  return gelesen;",
  "}",
  "function halteFest(call, gelesen) {",
  "  call.summe = gelesen.summe || null;",
  "  call.ergebnis = normalisiere(gelesen);",
  "  store.sichere();",
  "  for (const punkt of gelesen.punkte || []) store.merke(call.id, punkt);",
  "}",
  "export async function fasse(call) {",
  "  const ctx = store.kontext(call.id);",
  "  if (!ctx.erlaubt) return null;",
  "  const gespraech = gespraechVon(call);",
  "  const antwort = await llm.frage({ gespraech });",
  "  const gelesen = lies(antwort);",
  "  halteFest(call, gelesen);",
  "  return gelesen;",
  "}",
);

test("hilfe-zerlegen: eine wortgleich in Hilfsfunktionen zerlegte Funktion ist gleichwertig", async () => {
  assert.deepEqual(await vergleich(ALT, NEU), { gleich: true, genutzt: [ZERLEGEN] });
});

test("hilfe-zerlegen: dieselbe Zerlegung mit geändertem Rumpf bleibt rot", async () => {
  const geaendert = NEU.replace("call.summe = gelesen.summe || null;", "call.summe = gelesen.summe ?? null;");
  const ergebnis = await vergleich(ALT, geaendert);
  assert.equal(ergebnis.gleich, false);
  assert.match(ergebnis.befund, BEFUND);
});

const IMPORT = 'import { log, o, xs, z, store } from "./d.js";';

function modul(...zeilen) {
  return quelle(IMPORT, ...zeilen);
}

const GRUEN = [
  [
    "F1: Anweisungen ohne Wert",
    modul("export function g(c) {", "  log(c.a);", "  log(c.b);", "}"),
    modul("function h(q) {", "  log(q.a);", "  log(q.b);", "}", "export function g(c) {", "  h(c);", "}"),
  ],
  [
    "F2: Wert mit lokalem Namen und anderem Parameternamen",
    modul("export function g(c) {", "  const t = c.a + 1;", "  const s = t * 2;", "  return s;", "}"),
    modul("function h(q) {", "  const t = q.a + 1;", "  return t * 2;", "}", "export function g(c) {", "  const s = h(c);", "  return s;", "}"),
  ],
  [
    "F3: Zuweisung an einen Namen von G",
    modul("export function g(c) {", "  let s = 0;", "  s = c.a * 2;", "  return s;", "}"),
    modul("function h(q) {", "  return q.a * 2;", "}", "export function g(c) {", "  let s = 0;", "  s = h(c);", "  return s;", "}"),
  ],
  [
    "F4: return des Aufrufs",
    modul("export function g(c) {", "  return c.a + c.b;", "}"),
    modul("function h(q) {", "  return q.a + q.b;", "}", "export function g(c) {", "  return h(c);", "}"),
  ],
  [
    "Rückgabename: const am Aufruf, let in der Hilfe",
    modul("export function g(c) {", "  let v = { n: 0 };", "  v.n = c.a;", "  return v;", "}"),
    modul("function h(q) {", "  let v = { n: 0 };", "  v.n = q.a;", "  return v;", "}", "export function g(c) {", "  const v = h(c);", "  return v;", "}"),
  ],
  [
    "Rückgabename: let am Aufruf, let in der Hilfe",
    modul("export function g(c) {", "  let v = { n: 0 };", "  v.n = c.a;", "  return v;", "}"),
    modul("function h(q) {", "  let v = { n: 0 };", "  v.n = q.a;", "  return v;", "}", "export function g(c) {", "  let v = h(c);", "  return v;", "}"),
  ],
  [
    "Rückgabename: const am Aufruf, const in der Hilfe",
    modul("export function g(c) {", "  const v = { n: c.a };", "  return v;", "}"),
    modul("function h(q) {", "  const v = { n: q.a };", "  return v;", "}", "export function g(c) {", "  const v = h(c);", "  return v;", "}"),
  ],
  [
    "Zuweisung an einen Parameter wird zum Rückgabewert",
    modul("export function g(c) {", "  let t = c.a;", "  t = t + c.b;", "  return t;", "}"),
    modul("function h(w, q) {", "  w = w + q.b;", "  return w;", "}", "export function g(c) {", "  let t = c.a;", "  t = h(t, c);", "  return t;", "}"),
  ],
  [
    "vertauschte Argumente werden gleichzeitig eingesetzt",
    modul("export function g(a, b) {", '  const k = b + "-" + a;', "  return k;", "}"),
    modul("function h(a, b) {", '  return a + "-" + b;', "}", "export function g(a, b) {", "  const k = h(b, a);", "  return k;", "}"),
  ],
  [
    "Kurzschreibweise bei anderem Namen",
    modul("export function g(c) {", "  const e = { q: c };", "  return e;", "}"),
    modul("function h(q) {", "  return { q };", "}", "export function g(c) {", "  const e = h(c);", "  return e;", "}"),
  ],
  [
    "Eigenschaftsname bleibt stehen",
    modul("export function g(c) {", "  const e = o.q + c;", "  return e;", "}"),
    modul("function h(q) {", "  return o.q + q;", "}", "export function g(c) {", "  const e = h(c);", "  return e;", "}"),
  ],
  [
    "Argument ist Parameter einer umschließenden Funktion",
    modul("export function fabrik(speicher) {", "  return function g(c) {", "    const s = speicher.hole(c.id);", "    return s;", "  };", "}"),
    modul("function h(st, q) {", "  return st.hole(q.id);", "}", "export function fabrik(speicher) {", "  return function g(c) {", "    const s = h(speicher, c);", "    return s;", "  };", "}"),
  ],
  [
    "Argument aus einem umschließenden Block von G",
    modul("export function g(c) {", "  const w = c.x;", "  if (c.y) {", "    const s = w + 1;", "    log(s);", "  }", "}"),
    modul("function h(q) {", "  return q + 1;", "}", "export function g(c) {", "  const w = c.x;", "  if (c.y) {", "    const s = h(w);", "    log(s);", "  }", "}"),
  ],
  [
    "async-Aufrufer, Hilfe nach dem Aufrufer deklariert",
    modul("export async function g(c) {", "  const s = c.a + 1;", "  await z(s);", "}"),
    modul("export async function g(c) {", "  const s = h(c);", "  await z(s);", "}", "function h(q) {", "  return q.a + 1;", "}"),
  ],
  [
    "Aufrufer ist eine Methode mit this",
    modul("export class K {", "  m(c) {", "    const s = c.a + 1;", "    return this.f(s);", "  }", "}"),
    modul("function h(q) {", "  return q.a + 1;", "}", "export class K {", "  m(c) {", "    const s = h(c);", "    return this.f(s);", "  }", "}"),
  ],
  [
    "Aufruf in einem try ohne Zuweisung an einen Parameter",
    modul("export function g(c) {", "  try {", "    const s = c.a + 1;", "    log(s);", "  } catch {", "    log(0);", "  }", "}"),
    modul("function h(q) {", "  return q.a + 1;", "}", "export function g(c) {", "  try {", "    const s = h(c);", "    log(s);", "  } catch {", "    log(0);", "  }", "}"),
  ],
  [
    "reine Hilfe mit einem Aufruf: hilfe-zerlegen hat Vorrang vor hilfe-einsetzen",
    modul("export function g(u) {", '  const r = typeof u === "string" && u !== "";', "  return r;", "}"),
    modul("function ist(w) {", '  return typeof w === "string" && w !== "";', "}", "export function g(u) {", "  const r = ist(u);", "  return r;", "}"),
  ],
  [
    "Hilfe liest einen Import und einen globalen Namen",
    modul("export function g(c) {", "  const s = JSON.stringify(store.x) + c.a;", "  return s;", "}"),
    modul("function h(q) {", "  return JSON.stringify(store.x) + q.a;", "}", "export function g(c) {", "  const s = h(c);", "  return s;", "}"),
  ],
];

test("hilfe-zerlegen: jede Form und jeder Sonderfall ist gleichwertig und nennt die Regel", async () => {
  for (const [fall, vorher, nachher] of GRUEN) {
    const ergebnis = await vergleich(vorher, nachher);
    assert.equal(ergebnis.gleich, true, `${fall}: ${ergebnis.befund}`);
    assert.ok(ergebnis.genutzt.includes(ZERLEGEN), fall);
  }
});

function ersatz(wort, ...zeilen) {
  return modul(...zeilen).replaceAll("HH", wort);
}

const AUFRUFER = ["export function g(c) {", "  const s = HH(c);", "  return s;", "}"];
const INLINE = ["export function g(c) {", "  const s = c.a + 1;", "  return s;", "}"];
const HILFE_PLUS = ["function h(q) {", "  return q.a + 1;", "}"];

const ROT = [
  [
    "B1 exportierte Hilfe",
    modul(...INLINE),
    ersatz("h", "export function h(q) {", "  return q.a + 1;", "}", ...AUFRUFER),
  ],
  ["B1 async-Hilfe", modul(...INLINE), ersatz("h", "async function h(q) {", "  return q.a + 1;", "}", ...AUFRUFER)],
  ["B1 Generator-Hilfe", modul(...INLINE), ersatz("h", "function* h(q) {", "  return q.a + 1;", "}", ...AUFRUFER)],
  [
    "B1 Standardwert im Parameter",
    modul("export function g(c, d) {", "  const s = c.a + r;", "  return s;", "}"),
    modul("function h(q, r = 1) {", "  return q.a + r;", "}", "export function g(c, d) {", "  const s = h(c, d);", "  return s;", "}"),
  ],
  [
    "B1 Destrukturierung im Parameter",
    modul("export function g(c) {", "  const s = a;", "  return s;", "}"),
    modul("function h({ a }) {", "  return a;", "}", "export function g(c) {", "  const s = h(c);", "  return s;", "}"),
  ],
  [
    "B1 Rest-Parameter",
    modul("export function g(c) {", "  const s = q;", "  return s;", "}"),
    modul("function h(...q) {", "  return q;", "}", "export function g(c) {", "  const s = h(c);", "  return s;", "}"),
  ],
  [
    "B2 zwei Aufrufe",
    modul("export function g(c, d) {", "  const e = c.a + 1;", "  const f = d.a + 1;", "  return [e, f];", "}"),
    modul(...HILFE_PLUS, "export function g(c, d) {", "  const e = h(c);", "  const f = h(d);", "  return [e, f];", "}"),
  ],
  [
    "B2 die Hilfe wird auch als Wert weitergereicht",
    modul("export function g(c) {", "  const s = c.a + 1;", "  return xs.map(h);", "}"),
    modul(...HILFE_PLUS, "export function g(c) {", "  const s = h(c);", "  return xs.map(h);", "}"),
  ],
  [
    "B2 die Hilfe wird anderswo zugewiesen",
    modul("export function s() {", "  h = z;", "}", ...INLINE),
    modul(...HILFE_PLUS, "export function s() {", "  h = z;", "}", ...AUFRUFER.map((zeile) => zeile.replace("HH", "h"))),
  ],
  [
    "B2 die Hilfe ruft sich selbst auf",
    modul("export function g(c) {", "  const s = c > 0 ? h(c - 1) : 0;", "  return s;", "}"),
    modul("function h(q) {", "  return q > 0 ? h(q - 1) : 0;", "}", ...AUFRUFER.map((zeile) => zeile.replace("HH", "h"))),
  ],
  [
    "B2 der Aufruf steht im Rumpf einer anderen Hilfe",
    modul("export function g(c) {", "  const s = c.a + 1;", "  const r = s;", "  return r;", "}"),
    modul("function h2(q) {", "  return q.a + 1;", "}", "function h1(c) {", "  const s = h2(c);", "  return s;", "}", "export function g(c) {", "  const r = h1(c);", "  return r;", "}"),
  ],
  [
    "B3 this in der Hilfe",
    modul("export class K {", "  m(c) {", "    const s = this === undefined;", "    return s;", "  }", "}"),
    modul("function h(q) {", "  return this === undefined;", "}", "export class K {", "  m(c) {", "    const s = h(c);", "    return s;", "  }", "}"),
  ],
  [
    "B3 var in der Hilfe",
    modul("export function g(c) {", "  var t = c.a;", "  const s = t;", "  return s;", "}"),
    modul("function h(q) {", "  var t = q.a;", "  return t;", "}", ...AUFRUFER.map((zeile) => zeile.replace("HH", "h"))),
  ],
  [
    "B3 Marke in der Hilfe",
    modul("export function g(c) {", "  outer: for (const e of c) {", "    break outer;", "  }", "  const s = c;", "  return s;", "}"),
    modul("function h(q) {", "  outer: for (const e of q) {", "    break outer;", "  }", "  return q;", "}", ...AUFRUFER.map((zeile) => zeile.replace("HH", "h"))),
  ],
  [
    "B3 Direktive in der Hilfe",
    modul("export function g(c) {", '  "use strict";', "  const s = c.a;", "  return s;", "}"),
    modul("function h(q) {", '  "use strict";', "  return q.a;", "}", ...AUFRUFER.map((zeile) => zeile.replace("HH", "h"))),
  ],
  [
    "B3 Funktionsdeklaration auf oberster Ebene der Hilfe",
    modul("export function g(c) {", "  function inner() {", "    return c;", "  }", "  const s = inner();", "  return s;", "}"),
    modul("function h(q) {", "  function inner() {", "    return q;", "  }", "  return inner();", "}", ...AUFRUFER.map((zeile) => zeile.replace("HH", "h"))),
  ],
  [
    "B3 new.target in der Hilfe",
    modul("export function g(c) {", "  const s = new.target;", "  return s;", "}"),
    modul("function h(q) {", "  return new.target;", "}", ...AUFRUFER.map((zeile) => zeile.replace("HH", "h"))),
  ],
  [
    "B4 await am Aufruf",
    modul("export async function g(c) {", "  const s = c.a + 1;", "  return s;", "}"),
    modul(...HILFE_PLUS, "export async function g(c) {", "  const s = await h(c);", "  return s;", "}"),
  ],
  [
    "B4 Aufruf mitten in einem Ausdruck",
    modul("export function g(c) {", "  const s = z() + (c.a + 1);", "  return s;", "}"),
    modul(...HILFE_PLUS, "export function g(c) {", "  const s = z() + h(c);", "  return s;", "}"),
  ],
  [
    "B4 optionaler Aufruf",
    modul(...INLINE),
    modul(...HILFE_PLUS, "export function g(c) {", "  const s = h?.(c);", "  return s;", "}"),
  ],
  [
    "B4 Aufruf in einem case",
    modul("export function g(c) {", "  let s = 0;", "  switch (c.k) {", "    case 1:", "      s = c.a + 1;", "      break;", "  }", "  return s;", "}"),
    modul(...HILFE_PLUS, "export function g(c) {", "  let s = 0;", "  switch (c.k) {", "    case 1:", "      s = h(c);", "      break;", "  }", "  return s;", "}"),
  ],
  [
    "B4 Aufruf als Rumpf eines if ohne Klammern",
    modul("export function g(c) {", "  let s = 0;", "  if (c.y) s = c.a + 1;", "  return s;", "}"),
    modul(...HILFE_PLUS, "export function g(c) {", "  let s = 0;", "  if (c.y) s = h(c);", "  return s;", "}"),
  ],
  [
    "B4 Aufruf auf oberster Ebene des Moduls",
    modul("const w = 1;", "export const r = w + 1;"),
    modul("const w = 1;", "function h(q) {", "  return q + 1;", "}", "export const r = h(w);"),
  ],
  [
    "B5 mehr Argumente als Parameter",
    modul("export function g(c, d) {", "  const s = c.a;", "  return s;", "}"),
    modul("function h(q) {", "  return q.a;", "}", "export function g(c, d) {", "  const s = h(c, d);", "  return s;", "}"),
  ],
  [
    "B5 weniger Argumente als Parameter",
    modul("export function g(c) {", "  const s = c.a + undefined;", "  return s;", "}"),
    modul("function h(q, r) {", "  return q.a + r;", "}", "export function g(c) {", "  const s = h(c);", "  return s;", "}"),
  ],
  [
    "B3 super in einer Methode innerhalb der Hilfe",
    modul("export class K {", "  m(c) {", "    const s = { f() { return super.x; } };", "    return s;", "  }", "}"),
    modul("function h(q) {", "  return { f() { return super.x; } };", "}", "export class K {", "  m(c) {", "    const s = h(c);", "    return s;", "  }", "}"),
  ],
  [
    "B3 Klassendeklaration auf oberster Ebene der Hilfe",
    modul("export function g(c) {", "  class C {}", "  const s = new C(c);", "  return s;", "}"),
    modul("function h(q) {", "  class C {}", "  return new C(q);", "}", ...AUFRUFER.map((zeile) => zeile.replace("HH", "h"))),
  ],
  [
    "B4 Aufruf in einem Block auf oberster Ebene des Moduls",
    modul("const w = 1;", "{", "  const r = w + 1;", "  log(r);", "}"),
    modul("const w = 1;", "function h(q) {", "  return q + 1;", "}", "{", "  const r = h(w);", "  log(r);", "}"),
  ],
  [
    "B4 Aufruf in einem static-Block",
    modul("export class K {", "  static {", "    {", "      const w = 1;", "      const r = w + 1;", "      log(r);", "    }", "  }", "}"),
    modul("function h(q) {", "  return q + 1;", "}", "export class K {", "  static {", "    {", "      const w = 1;", "      const r = h(w);", "      log(r);", "    }", "  }", "}"),
  ],
  [
    "B4 zusammengesetzte Zuweisung liest das Ziel vor der Hilfe",
    modul("let summe = 0;", "export function g(c) {", "  summe = 10;", "  summe += 1;", "}"),
    modul("let summe = 0;", "function h(q) {", "  summe = 10;", "  return 1;", "}", "export function g(c) {", "  summe += h(c);", "}"),
  ],
  [
    "B4 Zuweisung an eine Eigenschaft liest das Ziel vor der Hilfe",
    modul("export function g(c) {", "  const t = c.a;", "  o.p = t + 1;", "}"),
    modul("function h(q) {", "  const t = q.a;", "  return t + 1;", "}", "export function g(c) {", "  o.p = h(c);", "}"),
  ],
  [
    "B4 Empfänger ist ein Muster",
    modul("export function g(c) {", "  const { a } = c.o;", "  return a;", "}"),
    modul("function h(q) {", "  return q.o;", "}", "export function g(c) {", "  const { a } = h(c);", "  return a;", "}"),
  ],
  [
    "B4 Anweisung mit mehreren Declaratoren",
    modul("export function g(c) {", "  const s = c.a + 1;", "  return s + u;", "}"),
    modul(...HILFE_PLUS, "export function g(c) {", "  const s = h(c), u = 1;", "  return s + u;", "}"),
  ],
  [
    "B4 Empfänger ist eine var",
    modul("export function g(c) {", "  var s = c.a + 1;", "  return s;", "}"),
    modul(...HILFE_PLUS, "export function g(c) {", "  var s = h(c);", "  return s;", "}"),
  ],
  [
    "B5 weniger Argumente als Parameter, der freie Name bleibt stehen",
    modul("export function g(c) {", "  const s = c.a + r;", "  return s;", "}"),
    modul("function h(q, r) {", "  return q.a + r;", "}", "export function g(c) {", "  const s = h(c);", "  return s;", "}"),
  ],
  [
    "B5 Ausdruck als Argument",
    modul("export function g(c) {", "  const s = c.a + 1;", "  return s;", "}"),
    modul("function h(q) {", "  return q + 1;", "}", "export function g(c) {", "  const s = h(c.a);", "  return s;", "}"),
  ],
  [
    "B5 Spread als Argument",
    modul("export function g(c) {", "  const s = c[0] + 1;", "  return s;", "}"),
    modul("function h(q) {", "  return q + 1;", "}", "export function g(c) {", "  const s = h(...c);", "  return s;", "}"),
  ],
  [
    "B5 Argument ist ein Name des Moduls",
    modul("const modulWert = z();", "export function g() {", "  const s = modulWert + 1;", "  return s;", "}"),
    modul("const modulWert = z();", "function h(q) {", "  return q + 1;", "}", "export function g() {", "  const s = h(modulWert);", "  return s;", "}"),
  ],
  [
    "B5 Argument wird erst nach dem Aufruf deklariert",
    modul("export function g(c) {", "  const s = w + 1;", "  const w = c.a;", "  return s;", "}"),
    modul("function h(q) {", "  return q + 1;", "}", "export function g(c) {", "  const s = h(w);", "  const w = c.a;", "  return s;", "}"),
  ],
  [
    "B5 Argument wird zugewiesen und die Hilfe ruft einen Rückruf",
    modul("export function g() {", "  let n = 0;", "  const zaehle = () => {", "    n++;", "  };", "  zaehle();", "  const r = n;", "  return r;", "}"),
    modul("function h(p, f) {", "  f();", "  return p;", "}", "export function g() {", "  let n = 0;", "  const zaehle = () => {", "    n++;", "  };", "  const r = h(n, zaehle);", "  return r;", "}"),
  ],
  [
    "B5 Argument einer Funktion, in deren Parameterliste der Aufruf steht",
    modul("export function fabrik(speicher, g = (c) => {", "  const s = speicher.hole(c.id);", "  return s;", "}) {", "  return g;", "}"),
    modul("function h(st, q) {", "  return st.hole(q.id);", "}", "export function fabrik(speicher, g = (c) => {", "  const s = h(speicher, c);", "  return s;", "}) {", "  return g;", "}"),
  ],
  [
    "B6 Argumentname wird im Rumpf der Hilfe nochmals gebunden",
    modul("export function g(a) {", "  const r = xs.map((a) => a + a);", "  return r;", "}"),
    modul("function h(q) {", "  return xs.map((a) => a + q);", "}", "export function g(a) {", "  const r = h(a);", "  return r;", "}"),
  ],
  [
    "B6 Parametername wird im Rumpf der Hilfe nochmals gebunden",
    modul("export function g(c) {", "  const r = xs.map((c) => c + 1);", "  return r;", "}"),
    modul("function h(q) {", "  return xs.map((q) => q + 1);", "}", "export function g(c) {", "  const r = h(c);", "  return r;", "}"),
  ],
  [
    "B6 Argumente in der falschen Reihenfolge",
    modul("export function g(a, b) {", '  const k = b + "-" + a;', "  return k;", "}"),
    modul("function h(a, b) {", '  return a + "-" + b;', "}", "export function g(a, b) {", "  const k = h(a, b);", "  return k;", "}"),
  ],
  [
    "B6 Eigenschaftsname wird mit ersetzt",
    modul("export function g(c) {", "  const e = o.c + c;", "  return e;", "}"),
    modul("function h(q) {", "  return o.q + q;", "}", "export function g(c) {", "  const e = h(c);", "  return e;", "}"),
  ],
  [
    "B7 freier Name der Hilfe ist in G anders gebunden",
    modul("export function g(store, c) {", "  const r = store.x + c;", "  return r;", "}"),
    modul("function h(q) {", "  return store.x + q;", "}", "export function g(store, c) {", "  const r = h(c);", "  return r;", "}"),
  ],
  [
    "B7 freier Name der Hilfe ist in der umschließenden Fabrik anders gebunden",
    modul("export function fabrik(store) {", "  return function g(c) {", "    const r = store.x + c;", "    return r;", "  };", "}"),
    modul("function h(q) {", "  return store.x + q;", "}", "export function fabrik(store) {", "  return function g(c) {", "    const r = h(c);", "    return r;", "  };", "}"),
  ],
  [
    "B8 lokaler Name der Hilfe kommt in G sonst vor",
    modul("const grenze = 3;", "export function g(c) {", "  log(grenze);", "  const grenze = c * 2;", "  const r = grenze + 1;", "  return r;", "}"),
    modul("const grenze = 3;", "function h(q) {", "  const grenze = q * 2;", "  return grenze + 1;", "}", "export function g(c) {", "  log(grenze);", "  const r = h(c);", "  return r;", "}"),
  ],
  [
    "B9 ein Rückruf in G liest den zugewiesenen Namen",
    modul("export function g() {", "  let x = 1;", "  const f = () => x;", "  x = 2;", "  f();", "  return x;", "}"),
    modul("function h(p, f) {", "  p = 2;", "  f();", "  return p;", "}", "export function g() {", "  let x = 1;", "  const f = () => x;", "  x = h(x, f);", "  return x;", "}"),
  ],
  [
    "B9 ein try um den Aufruf liest den Namen nach einer Ausnahme",
    modul("export function g() {", "  let x = 1;", "  try {", "    x = 2;", "    z();", "  } catch {", "    log(x);", "  }", "  return x;", "}"),
    modul("function h(p) {", "  p = 2;", "  z();", "  return p;", "}", "export function g() {", "  let x = 1;", "  try {", "    x = h(x);", "  } catch {", "    log(x);", "  }", "  return x;", "}"),
  ],
  [
    "B9 derselbe Name steht in zwei Argumenten",
    modul("export function g() {", "  let x = 1;", "  x = 5;", "  log(x);", "  return x;", "}"),
    modul("function h(p, q) {", "  p = 5;", "  log(q);", "  return p;", "}", "export function g() {", "  let x = 1;", "  x = h(x, x);", "  return x;", "}"),
  ],
  [
    "B9 der Empfänger ist ein anderer Name als das zugewiesene Argument",
    modul("export function g() {", "  let x = 1;", "  let y = 0;", "  x = x + 1;", "  y = x;", "  return [x, y];", "}"),
    modul("function h(p) {", "  p = p + 1;", "  return p;", "}", "export function g() {", "  let x = 1;", "  let y = 0;", "  y = h(x);", "  return [x, y];", "}"),
  ],
  [
    "B9 eine Closure der Hilfe hält den Parameter fest",
    modul("export function g() {", "  let x = 1;", "  x = x + 1;", "  z(() => x);", "  return x;", "}"),
    modul("function h(p) {", "  p = p + 1;", "  z(() => p);", "  return p;", "}", "export function g() {", "  let x = 1;", "  x = h(x);", "  return x;", "}"),
  ],
  [
    "B9 der zugewiesene Name ist const",
    modul("export function g(c) {", "  const x = c.a;", "  x = x + 1;", "  return x;", "}"),
    modul("function h(p) {", "  p = p + 1;", "  return p;", "}", "export function g(c) {", "  const x = c.a;", "  x = h(x);", "  return x;", "}"),
  ],
  [
    "B10 Frühausstieg in der Hilfe",
    modul("export function g(c) {", "  if (!c) return 1;", "  const r = 2;", "  return r;", "}"),
    modul("function h(q) {", "  if (!q) return 1;", "  return 2;", "}", "export function g(c) {", "  const r = h(c);", "  return r;", "}"),
  ],
  [
    "B10 return ohne Wert in der Hilfe",
    modul("export function g(c) {", "  log(c);", "}"),
    modul("function h(q) {", "  log(q);", "  return;", "}", "export function g(c) {", "  h(c);", "}"),
  ],
  [
    "B10 Hilfe mit Wert, der Aufruf wirft ihn weg",
    modul("export function g(c) {", "  log(c);", "}"),
    modul("function h(q) {", "  log(q);", "  return q;", "}", "export function g(c) {", "  h(c);", "}"),
  ],
  [
    "B11 const am Aufruf, der Name wird in G später zugewiesen",
    modul("export function g(c) {", "  let v = { n: c.a };", "  v = null;", "  return v;", "}"),
    modul("function h(q) {", "  let v = { n: q.a };", "  return v;", "}", "export function g(c) {", "  const v = h(c);", "  v = null;", "  return v;", "}"),
  ],
  [
    "B11 let am Aufruf, const in der Hilfe",
    modul("export function g(c) {", "  const v = { n: c.a };", "  return v;", "}"),
    modul("function h(q) {", "  const v = { n: q.a };", "  return v;", "}", "export function g(c) {", "  let v = h(c);", "  return v;", "}"),
  ],
  [
    "B9 das Ziel steht an einer anderen Stelle als der zugewiesene Parameter",
    modul("export function g() {", "  let x = 1;", "  let y = 2;", "  y = x + 1;", "  return [x, y];", "}"),
    modul("function h(p, q) {", "  p = q + 1;", "  return p;", "}", "export function g() {", "  let x = 1;", "  let y = 2;", "  x = h(y, x);", "  return [x, y];", "}"),
  ],
  [
    "B5 Name des Arguments ist mehrfach deklariert, eine Deklaration folgt dem Aufruf",
    modul("export function g(c) {", "  const s = c.a + 1;", "  var c;", "  return s;", "}"),
    modul(...HILFE_PLUS, "export function g(c) {", "  const s = h(c);", "  var c;", "  return s;", "}"),
  ],
  [
    "B9 zwei Parameter werden zugewiesen",
    modul("export function g() {", "  let x = 1;", "  let y = 2;", "  x = 1;", "  y = 2;", "  return [x, y];", "}"),
    modul("function h(p, q) {", "  p = 1;", "  q = 2;", "  return p;", "}", "export function g() {", "  let x = 1;", "  let y = 2;", "  x = h(x, y);", "  return [x, y];", "}"),
  ],
  [
    "B9 die Rückgabe ist nicht der zugewiesene Parameter",
    modul("export function g() {", "  let x = 1;", "  x = 1;", "  return x;", "}"),
    modul("function h(p) {", "  p = 1;", "  return 2;", "}", "export function g() {", "  let x = 1;", "  x = h(x);", "  return x;", "}"),
  ],
  [
    "B9 zugewiesener Parameter bei Aufruf mit Empfänger-Deklaration",
    modul("export function g(c) {", "  let x = c.a;", "  x = x + 1;", "  const y = x;", "  return y;", "}"),
    modul("function h(p) {", "  p = p + 1;", "  return p;", "}", "export function g(c) {", "  let x = c.a;", "  const y = h(x);", "  return y;", "}"),
  ],
  [
    "B9 zugewiesener Parameter bei return des Aufrufs",
    modul("export function g(c) {", "  let x = c.a;", "  x = x + 1;", "  return x;", "}"),
    modul("function h(p) {", "  p = p + 1;", "  return p;", "}", "export function g(c) {", "  let x = c.a;", "  return h(x);", "}"),
  ],
  [
    "B9 der zugewiesene Name gehört einer umschließenden Funktion",
    modul("export function fabrik(x) {", "  return function g() {", "    x = x + 1;", "    return x;", "  };", "}"),
    modul("function h(p) {", "  p = p + 1;", "  return p;", "}", "export function fabrik(x) {", "  return function g() {", "    x = h(x);", "    return x;", "  };", "}"),
  ],
  [
    "B10 nur ein verschachteltes return in der Hilfe",
    modul("export function g(c) {", "  if (c.a) {", "    return 1;", "  }", "  const s = 1;", "  return s;", "}"),
    modul("function h(q) {", "  if (q.a) {", "    return 1;", "  }", '  throw new Error("x");', "}", ...AUFRUFER.map((zeile) => zeile.replace("HH", "h"))),
  ],
  [
    "B10 return ohne Wert, Aufruf als return",
    modul("export function g(c) {", "  log(c);", "  return;", "}"),
    modul("function h(q) {", "  log(q);", "  return;", "}", "export function g(c) {", "  return h(c);", "}"),
  ],
  [
    "B11 der Name des Rückgabewerts ist in G noch an anderer Stelle gebunden",
    modul("export function g(c) {", "  {", "    const w = 1;", "    log(w);", "  }", "  let w = { n: c.a };", "  return w;", "}"),
    modul("function h(q) {", "  let w = { n: q.a };", "  return w;", "}", "export function g(c) {", "  {", "    const w = 1;", "    log(w);", "  }", "  const w = h(c);", "  return w;", "}"),
  ],
  [
    "B11 der Empfänger ist ein lokaler Name der Hilfe",
    modul("let t = 0;", "export function g(c) {", "  let t = c.a;", "  t = t + 1;", "}"),
    modul("let t = 0;", "function h(q) {", "  let t = q.a;", "  return t + 1;", "}", "export function g(c) {", "  t = h(c);", "}"),
  ],
  [
    "B11 der Empfänger wird in der Hilfe in einem inneren Bereich gebunden",
    modul("export function g(c) {", "  const t = [1].map((t) => t);", "  return t;", "}"),
    modul("function h(q) {", "  return [1].map((t) => t);", "}", "export function g(c) {", "  const t = h(c);", "  return t;", "}"),
  ],
  [
    "B14 eval in der Datei",
    modul("export function g(c) {", "  const s = c.a + 1;", "  return eval(s);", "}"),
    modul(...HILFE_PLUS, "export function g(c) {", "  const s = h(c);", "  return eval(s);", "}"),
  ],
  [
    "Reihenfolge der Anweisungen geändert",
    modul("export function g() {", "  log(1);", "  log(2);", "}"),
    modul("function h() {", "  log(2);", "}", "export function g() {", "  h();", "  log(1);", "}"),
  ],
];

test("hilfe-zerlegen: jede Verletzung einer Bedingung bleibt rot und nennt die Zeile", async () => {
  for (const [fall, vorher, nachher] of ROT) {
    const ergebnis = await vergleich(vorher, nachher);
    assert.equal(ergebnis.gleich, false, fall);
    assert.match(ergebnis.befund, BEFUND, fall);
  }
});

test("hilfe-zerlegen: eine reine Hilfe mit Aufruf in einem case bleibt Sache von hilfe-einsetzen", async () => {
  const hilfe = ["function ist(w) {", '  return typeof w === "string" && w !== "";', "}"];
  const rumpf = (ausdruck) => ["export function g(u) {", "  let r = false;", "  switch (u) {", "    case 1:", `      r = ${ausdruck};`, "      break;", "  }", "  return r;", "}"];
  const vorher = modul(...hilfe, ...rumpf('typeof u === "string" && u !== ""'));
  const nachher = modul(...hilfe, ...rumpf("ist(u)"));
  assert.deepEqual(await vergleich(vorher, nachher), { gleich: true, genutzt: ["hilfe-einsetzen"] });
});
