import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { fortsetzungen } from "../../tools/auftrag/planung/messung.mjs";
import { ENTWURF_HINWEIS, GRUEN_PRUEFLISTE, GRUPPEN, HINWEIS, LAUF_FRIST_MS, ORDNER, ROUTE, alsJson, aufrufe, bericht, exit, planOrdner, planeIn, schnittliste } from "./planung-probe.js";
import { probeDirectory, runIn } from "./probe-repo.js";
import { ABSTURZ_EXIT, ABSTURZ_FEHLER, AUFTRAG, EXIT_ABBRUCH, EXIT_AUFRUF, EXIT_BEFUNDE, EXIT_GRUEN, gruppenPruefung, jePruefer, phaseDatei, plane, planeAntworten, planungsBericht } from "./planung-plane-probe.js";

test("plane: ein Entwurf ohne gemeinsamen Namen geht einmal an seinen Schreiber zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  const ohneNamen = alsJson({ entwurf: "Grundlage: design.md, Lösung\nliest den Status\nFehlerfälle: keine" });
  const lauf = plane(context, { [`entwurf|## Entwurf|${HINWEIS}`]: [ohneNamen], "entwurf|## Befunde": [ENTWURF_HINWEIS] });
  exit(lauf, EXIT_GRUEN);
  const rueckgaben = aufrufe(lauf, "entwurf", "## Befunde");
  assert.equal(rueckgaben.length, 1);
  assert.ok(rueckgaben[0].eingabe.includes("gemeinsamer Name bestaetigt fehlt wörtlich"));
});

test("plane: eine Antwort ohne JSON-Block zweimal endet mit Exit 1", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "planer|## Gliederung": ["Ich gliedere gleich."], "planer|## Befunde": ["Immer noch kein JSON."] });
  exit(lauf, EXIT_ABBRUCH);
  assert.ok(aufrufe(lauf, "planer", "## Befunde")[0].eingabe.includes("Antwort ohne JSON-Block"));
  assert.equal(planungsBericht(lauf).exit, EXIT_ABBRUCH);
  assert.equal(planungsBericht(lauf).grund, "planer hat zweimal ohne JSON-Block geantwortet");
});

test("plane: ein abgestürzter Agent endet mit Exit 1 und der Meldung Absturz, ohne Rücksendung an ihn", { timeout: LAUF_FRIST_MS }, (context) => {
  const absturz = { absturz: { exit: ABSTURZ_EXIT, fehler: `erste Zeile\n${ABSTURZ_FEHLER}\n` } };
  const lauf = plane(context, { "planer|## Gliederung": [absturz], "planer|## Befunde": [alsJson({ gruppen: GRUPPEN })] });
  exit(lauf, EXIT_ABBRUCH);
  const grund = planungsBericht(lauf).grund;
  assert.ok(grund.startsWith(`planer ist abgestürzt (Exit ${ABSTURZ_EXIT})`), grund);
  assert.ok(grund.includes(ABSTURZ_FEHLER), grund);
  assert.equal(aufrufe(lauf, "planer", "## Gliederung").length, 1);
  assert.equal(aufrufe(lauf, "planer", "## Befunde").length, 0);
});

test("plane: stürzt der Agent erst nach der Rücksendung ab, meldet die Planung den Absturz statt zweimal ohne JSON-Block", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "planer|## Gliederung": ["Ich gliedere gleich."], "planer|## Befunde": [{ absturz: { exit: ABSTURZ_EXIT, fehler: ABSTURZ_FEHLER } }] });
  exit(lauf, EXIT_ABBRUCH);
  assert.equal(planungsBericht(lauf).grund, `planer ist abgestürzt (Exit ${ABSTURZ_EXIT}):\n${ABSTURZ_FEHLER}`);
  assert.equal(aufrufe(lauf, "planer", "## Befunde").length, 1);
});

test("plane: ein Nutzungslimit setzt dieselbe Sitzung mit derselben Nachricht fort", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "planer|## Gliederung": [{ limit: true }, alsJson({ gruppen: GRUPPEN })] });
  exit(lauf, EXIT_GRUEN);
  const [erster, zweiter] = aufrufe(lauf, "planer", "## Gliederung");
  assert.equal(erster.resume, false);
  assert.equal(zweiter.resume, true);
  assert.equal(zweiter.sitzung, erster.sitzung);
  assert.equal(zweiter.eingabe, erster.eingabe);
});

test("plane: ein Agent, der eine Datei ändert, bricht mit Exit 1 ab", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "erkunder|## Erkundung|S2": [{ text: bericht(GRUPPEN[1].nummern), schreibe: ROUTE }] });
  exit(lauf, EXIT_ABBRUCH);
  assert.equal(planungsBericht(lauf).grund, `erkunder haben ${ROUTE} geändert`);
  assert.equal(aufrufe(lauf, "planer", "## Zuschnitt").length, 0);
});

test("plane: eine geänderte pitch.md bricht mit Exit 1 ab", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "planer|## Gliederung": [{ text: alsJson({ gruppen: GRUPPEN }), schreibe: `${ORDNER}/pitch.md` }] });
  exit(lauf, EXIT_ABBRUCH);
  assert.equal(planungsBericht(lauf).grund, `planer haben ${ORDNER}/pitch.md geändert`);
});

test("plane: ein vorhandener Ordner planung endet mit Exit 2 und ändert nichts", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = planOrdner(context);
  mkdirSync(join(wurzel, ORDNER, "planung"));
  const lauf = runIn(wurzel, process.execPath, [AUFTRAG, "plane", ORDNER]);
  assert.equal(lauf.status, EXIT_AUFRUF);
  assert.deepEqual(readdirSync(join(wurzel, ORDNER, "planung")), []);
  assert.equal(existsSync(join(wurzel, ".fortschritt")), false);
});

const GEWINNT_DAS_ANLEGEN = `import { createRequire, syncBuiltinESMExports } from "node:module";

const fs = createRequire(import.meta.url)("node:fs");
const anlegen = fs.mkdirSync;
fs.mkdirSync = (pfad, ...weitere) => {
  if (String(pfad).endsWith("/planung")) anlegen(pfad);
  return anlegen(pfad, ...weitere);
};
syncBuiltinESMExports();
`;

test("plane: entsteht planung erst nach der Vorprüfung, weil ein zweiter Lauf schneller anlegt, endet es mit Exit 2 ohne Agent und ohne neue Dateien", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = planOrdner(context);
  const vorlauf = join(probeDirectory(context, { "vorlauf.mjs": GEWINNT_DAS_ANLEGEN }), "vorlauf.mjs");
  const lauf = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: {}, argumente: ["plane", ORDNER], knotenArgumente: ["--import", vorlauf] });
  exit(lauf, EXIT_AUFRUF);
  assert.match(lauf.stderr, /planung gibt es schon; plane überschreibt nichts/u);
  assert.equal(existsSync(join(lauf.ersatz, "protokoll.jsonl")), false);
  assert.deepEqual(readdirSync(join(wurzel, ORDNER, "planung")), []);
  assert.equal(existsSync(phaseDatei(lauf)), false);
  assert.equal(existsSync(join(wurzel, ".fortschritt")), false);
});

test("plane: ein falscher Aufruf endet mit Exit 2", (context) => {
  const wurzel = planOrdner(context);
  assert.equal(runIn(wurzel, process.execPath, [AUFTRAG, "plane"]).status, EXIT_AUFRUF);
  assert.equal(runIn(wurzel, process.execPath, [AUFTRAG, "plane", ORDNER, "zwei"]).status, EXIT_AUFRUF);
  assert.equal(runIn(wurzel, process.execPath, [AUFTRAG, "plane", "plaene/gibt-es-nicht"]).status, EXIT_AUFRUF);
});

test("plane: eine Owner-Entscheidung im Bericht ohne Eintrag in ownerAufgaben endet mit Exit 4 und nennt den Befund", { timeout: LAUF_FRIST_MS }, (context) => {
  const mitOwner = bericht(GRUPPEN[0].nummern, { S1: { ownerEntscheidung: { text: "Der Owner entscheidet die Frist", fundstelle: "pitch.md, ## Problem" } } });
  const schnitt = alsJson({ schnitt: schnittliste(), antworten: [] });
  const lauf = plane(context, { "erkunder|## Erkundung|S1": [mitOwner], "planer|## Befunde": [schnitt] });
  exit(lauf, EXIT_BEFUNDE);
  assert.ok(planungsBericht(lauf).befunde.offen.some((befund) => befund.includes("ist laut Erkundung Sache eines Owners und fehlt in ownerAufgaben")));
  assert.equal(existsSync(phaseDatei(lauf)), false);
});

test("plane: „Pitch ändern“ geht einmal an den Planer zurück und endet danach mit Exit 4", { timeout: LAUF_FRIST_MS }, (context) => {
  const pitch = "Pitch ändern: Soll S3 entfallen? (pitch.md, ## Problem)\nEmpfehlung: nein";
  const lauf = plane(context, { "planer|## Gliederung": [pitch], "planer|## Befunde": [pitch] });
  exit(lauf, EXIT_BEFUNDE);
  assert.equal(aufrufe(lauf, "planer", "## Befunde").length, 1);
  assert.equal(existsSync(phaseDatei(lauf)), false);
});

test("plane: planung.json enthält Ausweg, falsche Angabe, zurückgewiesenen Befund mit beiden Texten und Altfunktion-Umbau je Datei", { timeout: LAUF_FRIST_MS }, (context) => {
  const ausweg = "nicht gefunden, weil kein Test diesen Weg prüft";
  const falsch = { nummer: "S1", datei: ROUTE, grund: "die Route speichert nichts selbst", fundstelle: `${ROUTE}:10` };
  const altfunktionen = [{ datei: HINWEIS, funktion: "setzeHinweis", von: 6, bis: 9 }];
  const prueferText = "a2 braucht den Code aus a1";
  const antwort = `trifft nicht zu, weil a2 nur die Bestätigung prüft (${ROUTE}:5)`;
  const lauf = plane(context, {
    "erkunder|## Erkundung|S4": [bericht(GRUPPEN[2].nummern, { S5: { tests: ausweg } })],
    "planer|## Zuschnitt": [alsJson({ schnitt: schnittliste({ umbau: { altfunktionen }, erster: { falscheAngaben: [falsch] } }) })],
    "pruefer-planung|## Prüfung": jePruefer({ ...GRUEN_PRUEFLISTE, befunde: { "allein-gruen:a2": prueferText } }),
    "planer|## Befunde": [alsJson({ schnitt: schnittliste({ umbau: { altfunktionen }, erster: { falscheAngaben: [falsch] } }), antworten: [{ schluessel: "allein-gruen:a2", antwort }] })],
  });
  exit(lauf, EXIT_GRUEN);
  const beleg = planungsBericht(lauf);
  assert.ok(beleg.annahmen.includes(`Annahme S5: ${ausweg}`));
  assert.ok(beleg.annahmen.some((annahme) => annahme.includes(`Widerspruch zur Erkundung S1 ${ROUTE}: ${falsch.grund}`)));
  assert.deepEqual(beleg.befunde.zurueckgewiesen, [{ schluessel: "allein-gruen:a2", befund: prueferText, antwort }]);
  assert.deepEqual(beleg.arten, { funktionen: 3, umbauten: 0, altfunktionUmbauten: 1, altfunktionUmbautenJeDatei: { [HINWEIS]: 1 } });
  assert.ok(gruppenPruefung(lauf, "S1").eingabe.includes("- falsche-angabe:a1:S1:src/routes/api-onboard.js"));
  assert.ok(gruppenPruefung(lauf, "S5").eingabe.includes("- ausweg:S5:tests"));
});

test("plane: die Fortsetzungen nennen Quote und Urteil aus einem festen Protokoll", (context) => {
  const zeilen = [
    { type: "user", timestamp: "2026-10-13T10:00:00.000Z", message: { content: "## Gliederung" } },
    { type: "assistant", timestamp: "2026-10-13T10:01:00.000Z", message: { id: "a", usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 990 } } },
    { type: "user", timestamp: "2026-10-13T10:05:00.000Z", message: { content: [{ type: "text", text: "## Zuschnitt" }] } },
    { type: "assistant", timestamp: "2026-10-13T10:06:00.000Z", message: { id: "b", usage: { input_tokens: 5, cache_read_input_tokens: 950, cache_creation_input_tokens: 2000, cache_creation: { ephemeral_1h_input_tokens: 2000, ephemeral_5m_input_tokens: 0 } } } },
    { type: "user", timestamp: "2026-10-13T10:06:30.000Z", message: { content: [{ type: "tool_result", tool_use_id: "w", content: "x" }] } },
    { type: "assistant", timestamp: "2026-10-13T10:07:00.000Z", message: { id: "c", usage: { input_tokens: 5, cache_read_input_tokens: 2955, cache_creation_input_tokens: 40 } } },
    { type: "user", timestamp: "2026-10-13T12:07:00.000Z", message: { content: "## Befunde" } },
    { type: "assistant", timestamp: "2026-10-13T12:08:00.000Z", message: { id: "d", usage: { input_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  ];
  const ort = probeDirectory(context, { "planer.jsonl": `${zeilen.map((zeile) => JSON.stringify(zeile)).join("\n")}\n` });
  assert.deepEqual(fortsetzungen(join(ort, "planer.jsonl")), [
    { pauseS: 300, kontextVorher: 1000, cacheRead: 950, cacheWrite: 2000, cacheWrite1h: 2000, cacheWrite5m: 0, input: 5, quote: 0.95, urteil: "wirkt" },
    { pauseS: 7260, kontextVorher: 3000, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, cacheWrite5m: 0, input: 3000, quote: 0, urteil: "wirkt nicht" },
  ]);
});
