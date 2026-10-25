import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUPPEN, HINWEIS, KENNUNG, LAUF_FRIST_MS, ORDNER, ROUTE, alsJson, aufrufe, bericht, exit, planOrdner, planeIn } from "./planung-probe.js";
import { AUFTRAG, EXIT_ABBRUCH, EXIT_GETEILT, EXIT_GRUEN, mitIssue, planeAntworten, planungsBericht, teilEintrag, werkzeug } from "./planung-plane-probe.js";

const EXIT_DECKEL = 5;
const PLANER = 100_000;
const ERKUNDER = 1_000_000;
const WEGPRUEFER = 340_000;
const MINDESTVORSCHAU = PLANER + ERKUNDER + WEGPRUEFER;
const TEIL_DECKEL = 3_000_000;
const PRUEFER_PLANUNG = 1_200_000;
const TEIL_ISSUE = 77;
const ANDERE_PHASE = "P-009-andere";
const TOKEN = { planer: PLANER, erkunder: ERKUNDER, "pruefer-planung": WEGPRUEFER, entwurf: PLANER };
const EIGENE_MESSUNG = "eigene Messung";
const ZWEI_NUMMERN = ["S1", "B1"];
const WEGGELASSEN = /^#### Szenario S[2-7]:[\s\S]*?(?=^#{2,4} )/gmu;
const EINE_GRUPPE = { "planer|## Gliederung": [alsJson({ gruppen: [{ ...GRUPPEN[0], nummern: ZWEI_NUMMERN }] })], "erkunder|## Erkundung|S1": [bericht(ZWEI_NUMMERN)] };
const TEIL = "plaene/P-001-t1-hinterlegen";
const NEUNTES_SZENARIO = "\n### Szenario B2: Anruf ohne eigene Nummer\nGegeben ein Kunde ohne hinterlegte eigene Nummer\nWenn sein Agent mit `place_call` eine Nummer anruft\nDann ist der erste Satz der Text aus `LOCALES.de.disclosure`\n";
const TEILE = alsJson({
  teile: [
    teilEintrag("t1", "hinterlegen", { nummern: ["S1", "S2", "S3", "S6", "S7"], tWege: ["T1", "T2"], dateien: [ROUTE] }),
    teilEintrag("t2", "hinweis", { nummern: ["S4", "S5", "B1", "B2"], dateien: [HINWEIS], abhaengigVon: ["t1"] }),
  ],
});
const ZWEI_IM_TEIL = alsJson({
  teile: [
    teilEintrag("t1", "hinterlegen", { nummern: ["S1", "S7"], dateien: [ROUTE] }),
    teilEintrag("t2", "hinweis", { nummern: ["S2", "S3", "S4", "S5", "S6", "B1", "B2"], tWege: ["T1", "T2"], dateien: [HINWEIS], abhaengigVon: ["t1"] }),
  ],
});

function einLauf(token) {
  return { laeufe: 1, token };
}

function schreibeMessung(wurzel, phase, kostenJeLauf) {
  mkdirSync(join(wurzel, ".fortschritt", phase), { recursive: true });
  writeFileSync(join(wurzel, ".fortschritt", phase, "planung.json"), JSON.stringify({ kostenJeLauf, kostenGebucht: "je Rolle" }));
}

function aendere(wurzel, name, aenderung) {
  const datei = join(wurzel, ORDNER, name);
  writeFileSync(datei, aenderung(readFileSync(datei, "utf8")));
}

function mitZweiNummern(context) {
  const wurzel = planOrdner(context);
  aendere(wurzel, "pitch.md", (text) => text.replace(WEGGELASSEN, ""));
  aendere(wurzel, "sicherheit.md", (text) => text.replaceAll("Ausgang: verhindern", "Ausgang: hinnehmen"));
  return wurzel;
}

function mitVorigemLauf(context, wurzel = mitZweiNummern(context)) {
  schreibeMessung(wurzel, KENNUNG, { planer: einLauf(PLANER), erkunder: einLauf(ERKUNDER), wegpruefer: einLauf(WEGPRUEFER) });
  return wurzel;
}

function planeMitDeckel(context, deckel, { ueberschrieben = EINE_GRUPPE, wurzel = mitVorigemLauf(context) } = {}) {
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben, argumente: ["plane", ORDNER, "--deckel", String(deckel)], token: TOKEN });
}

function keinAgent(lauf) {
  for (const rolle of ["planer", "erkunder", "pruefer-planung", "entwurf"]) assert.deepEqual(aufrufe(lauf, rolle), [], rolle);
}

function geteilt(context, teile) {
  const wurzel = planOrdner(context);
  aendere(wurzel, "pitch.md", (text) => text.replace("Status: fertig", "Status: freigegeben") + NEUNTES_SZENARIO);
  const teilung = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: { "planer|## Teilung": [teile] }, argumente: ["plane", ORDNER], token: { planer: PLANER } });
  exit(teilung, EXIT_GETEILT);
  return wurzel;
}

function teilMitTeuremErkunder(context) {
  const wurzel = geteilt(context, TEILE);
  mitIssue(wurzel, TEIL, TEIL_ISSUE);
  schreibeMessung(wurzel, ANDERE_PHASE, { erkunder: einLauf(TEIL_DECKEL) });
  return wurzel;
}

test("plane: liegt schon der kürzeste Weg über dem Deckel, hält plane vor dem Planer mit Exit 5 und 0 Token an", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitDeckel(context, MINDESTVORSCHAU - 1);

  exit(lauf, EXIT_DECKEL);
  keinAgent(lauf);
  assert.deepEqual(planungsBericht(lauf).deckel, { deckel: MINDESTVORSCHAU - 1, gemessen: 0, vorschau: MINDESTVORSCHAU });
});

test("plane: die Meldung nennt Mindestvorschau, Rollen und Deckel", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitDeckel(context, MINDESTVORSCHAU - 1);

  exit(lauf, EXIT_DECKEL);
  const { grund } = planungsBericht(lauf);
  for (const teil of [`Deckel ${MINDESTVORSCHAU - 1} Token`, `Mindestvorschau ${MINDESTVORSCHAU}`, `planer ${PLANER}`, `erkunder ${ERKUNDER}`, `wegpruefer ${WEGPRUEFER}`, "umfang"]) assert.ok(grund.includes(teil), `${teil} fehlt in: ${grund}`);
  assert.ok(lauf.stdout.includes(grund), lauf.stdout);
});

test("plane: liegt der kürzeste Weg genau auf dem Deckel, startet der Planer wie bisher", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitDeckel(context, MINDESTVORSCHAU);

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "planer", "## Gliederung").length, 1);
  assert.equal(aufrufe(lauf, "erkunder", "## Erkundung").length, 1);
});

test("plane: kann die Gliederung zur Teilung führen, zählt die Erkundung nicht zur Mindestvorschau", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMitDeckel(context, MINDESTVORSCHAU - 1, { ueberschrieben: {}, wurzel: mitVorigemLauf(context, planOrdner(context)) });

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "planer", "## Gliederung").length, 1);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
});

test("plane: in einem Teil mit genug Nummern für eine weitere Teilung startet der Planer trotz knappem Teil-Deckel", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = teilMitTeuremErkunder(context);

  const lauf = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: {}, ueberschrieben: {}, argumente: ["plane", TEIL], token: { planer: PLANER } });

  exit(lauf, EXIT_ABBRUCH);
  assert.equal(aufrufe(lauf, "planer", "## Gliederung").length, 1, lauf.stderr);
  assert.equal(planungsBericht({ wurzel }, TEIL).deckel.deckel, TEIL_DECKEL);
});

test("umfang: zeigt den Mindestdeckel, den plane für diese Phase verlangt", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = mitVorigemLauf(context);

  const lauf = werkzeug({ wurzel }, AUFTRAG, "umfang", ORDNER);

  exit(lauf, EXIT_GRUEN);
  const rollen = [
    { rolle: "planer", token: PLANER, herkunft: EIGENE_MESSUNG },
    { rolle: "erkunder", token: ERKUNDER, herkunft: EIGENE_MESSUNG },
    { rolle: "wegpruefer", token: WEGPRUEFER, herkunft: EIGENE_MESSUNG },
  ];
  assert.deepEqual(JSON.parse(lauf.stdout).mindestdeckel, { token: MINDESTVORSCHAU, rollen });
  assert.ok(lauf.stderr.includes(`Mindestdeckel für plane: ${MINDESTVORSCHAU} Token`), lauf.stderr);
});

test("umfang: nennt als Herkunft die fremde Phase und für den Wegprüfer ohne eigenen Wert den Ersatz", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = mitZweiNummern(context);
  schreibeMessung(wurzel, ANDERE_PHASE, { planer: einLauf(PLANER), erkunder: einLauf(ERKUNDER), "pruefer-planung": einLauf(PRUEFER_PLANUNG) });

  const lauf = werkzeug({ wurzel }, AUFTRAG, "umfang", ORDNER);

  exit(lauf, EXIT_GRUEN);
  const rollen = [
    { rolle: "planer", token: PLANER, herkunft: "fremde Phase" },
    { rolle: "erkunder", token: ERKUNDER, herkunft: "fremde Phase" },
    { rolle: "wegpruefer", token: PRUEFER_PLANUNG, herkunft: "Ersatz wie pruefer-planung, fremde Phase" },
  ];
  assert.deepEqual(JSON.parse(lauf.stdout).mindestdeckel, { token: PLANER + ERKUNDER + PRUEFER_PLANUNG, rollen });
});

test("umfang: zählt in einem Teil mit zwei Nummern wie plane nur den Planer", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = geteilt(context, ZWEI_IM_TEIL);
  schreibeMessung(wurzel, ANDERE_PHASE, { planer: einLauf(PLANER), erkunder: einLauf(ERKUNDER), wegpruefer: einLauf(WEGPRUEFER) });

  const lauf = werkzeug({ wurzel }, AUFTRAG, "umfang", TEIL);

  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(JSON.parse(lauf.stdout).mindestdeckel, { token: PLANER, rollen: [{ rolle: "planer", token: PLANER, herkunft: "fremde Phase" }] });
});
