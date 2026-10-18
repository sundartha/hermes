import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { Linter } from "eslint";

import hermes from "../../tools/eslint-rules/index.js";
import { probeDirectory } from "./probe-repo.js";

const RULE = "hermes/speicher-fassade";
const FASSADE = "src/store.js";
const PG = "src/store/pg.js";
const JSON_SPEICHER = "src/store/json.js";
const EINSTELLUNG = {
  fassade: FASSADE,
  speicher: [{ datei: PG, fabrik: "makePgStore" }, { datei: JSON_SPEICHER }],
};
const FASSADE_ZEILEN = [
  'import * as backend from "./store/json.js";',
  "async function aufbauen(store) {",
  "  await store.init();",
  "  return store;",
  "}",
  "export const { load = () => {}, getCall } = backend;",
  "export function anrufpauseAktiv() {}",
  'export { classifyCallTime } from "./store/state-ops.js";',
];
const PG_ZEILEN = [
  "function hilfsMutatoren() {",
  "  return { getCall: () => 1 };",
  "}",
  "export function makePgStore(runner) {",
  "  const init = () => {",
  "    return runner;",
  "  };",
  "  return { init, load: () => runner, ...hilfsMutatoren() };",
  "}",
];
const JSON_ZEILEN = [
  "export function load() {}",
  "export const getCall = () => {};",
  "export async function anrufpauseAktiv() {}",
  'export { classifyCallTime } from "./state-ops.js";',
];

function speicherOrdner(context, ersatz = {}) {
  const dateien = {
    [FASSADE]: FASSADE_ZEILEN.join("\n"),
    [PG]: PG_ZEILEN.join("\n"),
    [JSON_SPEICHER]: JSON_ZEILEN.join("\n"),
    ...ersatz,
  };
  return probeDirectory(
    context,
    Object.fromEntries(Object.entries(dateien).filter(([, text]) => text !== undefined)),
  );
}

function meldungen(directory, datei, zeilen) {
  const linter = new Linter({ cwd: directory });
  const config = { plugins: { hermes }, rules: { [RULE]: ["error", EINSTELLUNG] } };
  const messages = linter.verify(zeilen.join("\n"), config, { filename: join(directory, datei) });
  return messages.filter(({ ruleId }) => ruleId === RULE);
}

function gemeldet(directory, datei, zeilen) {
  return meldungen(directory, datei, zeilen).map(({ line, message }) => [
    zeilen[line - 1].trim(),
    message.split(" ")[0],
  ]);
}

function abgleich(directory, zeilen = FASSADE_ZEILEN) {
  return meldungen(directory, FASSADE, zeilen).map(({ message }) => message.split(" ")[0]);
}

test("speicher-fassade: store.<name> ohne Export der Fassade wird gemeldet, ein Export nicht", (context) => {
  const directory = speicherOrdner(context);
  const zeilen = [
    "store.getCall(1);",
    "store.load();",
    "store.anrufpauseAktiv();",
    "store.classifyCallTime();",
    "store.fehltProbe(1);",
    'store["auchFehlend"]();',
    "const { load, nochFehlend } = store;",
    "andererSpeicher.fehltProbe();",
    "store[name]();",
    "const ganz = store;",
    "const { nichtGemeint } = andererSpeicher;",
  ];
  assert.deepEqual(gemeldet(directory, "src/routes/probe.js", zeilen), [
    ["store.fehltProbe(1);", "fehltProbe"],
    ['store["auchFehlend"]();', "auchFehlend"],
    ["const { load, nochFehlend } = store;", "nochFehlend"],
  ]);
});

test("speicher-fassade: in der Fassade ist nur der Aufruf beim Aufbau frei, nicht die Erwähnung", (context) => {
  const directory = speicherOrdner(context);
  const zeilen = [
    ...FASSADE_ZEILEN,
    "await store.probeMethode();",
    "void store.nurErwaehnt;",
    "pruefe(store.alsArgument);",
    "new store.alsKonstruktor();",
    "const { nurEntpackt } = store;",
  ];
  assert.deepEqual(gemeldet(directory, FASSADE, zeilen), [
    ["void store.nurErwaehnt;", "nurErwaehnt"],
    ["pruefe(store.alsArgument);", "alsArgument"],
    ["new store.alsKonstruktor();", "alsKonstruktor"],
    ["const { nurEntpackt } = store;", "nurEntpackt"],
  ]);
  assert.deepEqual(gemeldet(directory, "src/server.js", ["await store.init();"]), [
    ["await store.init();", "init"],
  ]);
});

test("speicher-fassade: jede Methode von PG- und JSON-Speicher steht in der Exportliste", (context) => {
  assert.deepEqual(abgleich(speicherOrdner(context)), []);
  const neuImPg = PG_ZEILEN.with(
    7,
    "  return { init, load: () => runner, neuImPg() {}, ...hilfsMutatoren() };",
  );
  assert.deepEqual(abgleich(speicherOrdner(context, { [PG]: neuImPg.join("\n") })), ["neuImPg"]);
  const anderswo = speicherOrdner(context, { [PG]: neuImPg.join("\n") });
  assert.deepEqual(gemeldet(anderswo, "src/routes/probe.js", ["store.load();"]), []);
  const neuInHilfe = PG_ZEILEN.with(1, '  return { getCall: () => 1, "neuInHilfe": () => 2 };');
  assert.deepEqual(abgleich(speicherOrdner(context, { [PG]: neuInHilfe.join("\n") })), [
    "neuInHilfe",
  ]);
  const neuImJson = [...JSON_ZEILEN, "export function neuImJson() {}"];
  assert.deepEqual(abgleich(speicherOrdner(context, { [JSON_SPEICHER]: neuImJson.join("\n") })), [
    "neuImJson",
  ]);
});

test("speicher-fassade: init ist nur ausgenommen, solange die Fassade es beim Aufbau aufruft", (context) => {
  const directory = speicherOrdner(context);
  const ohneAufruf = FASSADE_ZEILEN.with(2, "  void store.init;");
  assert.deepEqual(abgleich(directory, ohneAufruf), ["init", "init"]);
  const nurExportiert = FASSADE_ZEILEN.with(2, "  return backend;");
  assert.deepEqual(abgleich(directory, nurExportiert), ["init"]);
});

test("speicher-fassade: was sich nicht auswerten lässt, ist ein Fehler", (context) => {
  const pgMit = (zeile) => PG_ZEILEN.with(7, zeile).join("\n");
  const faelle = [
    [{ [PG]: pgMit("  return { init, ...andere };") }, PG, /Spread/],
    [{ [PG]: pgMit("  return { init, ...andere() };") }, PG, /Spread/],
    [{ [PG]: pgMit("  return { init, [schluessel]: 1 };") }, PG, /berechneter/],
    [{ [PG]: pgMit("  if (runner) return {}; return { init };") }, PG, /genau ein Objekt/],
    [{ [PG]: pgMit("  return init;") }, PG, /genau ein Objekt/],
    [{ [PG]: "export function andereFabrik() { return {}; }" }, PG, /makePgStore fehlt/],
    [{ [PG]: "export class makePgStore {}" }, PG, /makePgStore fehlt/],
    [
      {
        [PG]: "function a() { return { ...b() }; }\nfunction b() { return { ...a() }; }\nexport function makePgStore() { return { ...a() }; }",
      },
      PG,
      /Spread/,
    ],
    [{ [PG]: undefined }, PG, /Datei fehlt/],
    [{ [PG]: "export function makePgStore( {" }, PG, /Syntaxfehler/],
    [{ [JSON_SPEICHER]: 'export * from "./state-ops.js";' }, JSON_SPEICHER, /export \*/],
  ];
  for (const [ersatz, datei, grund] of faelle) {
    const [meldung, ...rest] = meldungen(speicherOrdner(context, ersatz), FASSADE, FASSADE_ZEILEN);
    assert.deepEqual(rest, [], JSON.stringify(ersatz));
    assert.ok(meldung.message.startsWith(`${datei} lässt sich nicht auswerten`), meldung.message);
    assert.match(meldung.message, grund);
  }
});

test("speicher-fassade: ohne auswertbare Exportliste meldet die Regel jede Datei", (context) => {
  const faelle = [
    [undefined, /Datei fehlt/],
    ['export * from "./store/json.js";', /export \*/],
    ["export const {", /Syntaxfehler/],
    ["export const { load, ...rest } = backend;", /Rest/],
    ["export const { load: { tief } } = backend;", /verschachteltes/],
    ["export const [erstes] = backend;", /verschachteltes/],
    ["export const { [schluessel]: wert } = backend;", /berechneter/],
  ];
  for (const [text, grund] of faelle) {
    const [meldung, ...rest] = meldungen(
      speicherOrdner(context, { [FASSADE]: text }),
      "src/probe.js",
      ["store.load();"],
    );
    assert.deepEqual(rest, []);
    assert.ok(meldung.message.startsWith(`${FASSADE} lässt sich nicht auswerten`), meldung.message);
    assert.match(meldung.message, grund);
  }
});
