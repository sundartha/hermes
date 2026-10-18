import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { entscheiden } from "../../tools/auftrag/pruefer-befehle.mjs";
import { issueText } from "../../tools/auftrag/pruefer-issues.mjs";
import { ANTWORT_SCHEMA, KATEGORIEN, ZUSTAENDE, schluesselVon } from "../../tools/auftrag/pruefer-schema.mjs";
import { urteile, urteileMitZweck } from "../../tools/auftrag/pruefer-urteil.mjs";
import { KATALOG_PRAEFIX, PRUEFER_ZWECK, befundZweck, statusZweck } from "../../tools/auftrag/pruefer-zweck.mjs";
import { reparaturPhase } from "../../tools/auftrag/reparatur.mjs";
import { MELDUNG, kenntZweck, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";
import { ciLauf, scheinSha, setzeAusloeser, workflowAbfrage } from "./pruefer/hilfen.mjs";

const TEXTE = JSON.parse(readFileSync(join(REPO_ROOT, "tools/zweck/pruefer.json"), "utf8"));
const QUELLEN = ["tools/auftrag/pruefer-urteil.mjs", "tools/auftrag/pruefer-befehle.mjs"];
const ROTER_STATUS = /\bstate: (?:ROT|FEHLER)\b/g;
const ZWECK_FELD = /\bzweck: PRUEFER_ZWECK\.[A-Z_]+/g;
const ROT = new Set(["failure", "error"]);
const SHA = scheinSha("e");
const SCHLUESSEL = schluesselVon(SHA, 0);
const BEFUNDE = ANTWORT_SCHEMA.properties.befunde;
const MERKMALE = BEFUNDE.items.properties;
const KEINE_UMGEHUNG = "keine";
const REPRODUKTION = 'import { test } from "node:test";\ntest("rot", () => {});\n';

const katalogTexte = () => Object.keys(TEXTE).filter((id) => id.startsWith(KATALOG_PRAEFIX));
const abschnitte = () => katalogTexte().map((id) => id.slice(KATALOG_PRAEFIX.length));
const katalogIds = () => abschnitte().map((abschnitt) => `${abschnitt}1`);
const kreuz = (listen) => listen.reduce((teile, werte) => teile.flatMap((teil) => werte.map((wert) => [...teil, wert])), [[]]);
const blockText = (id) => zweckBlock(id).join("\n");

function befundAus([schwere, sicherheit, umgehung, id, beleg, belegt, reproduktion]) {
  if (sicherheit) return { sicherheit: true, schwere };
  const grundfelder = { schwere, id, datei: "src/zahl.js", zeile: 1, beleg, reproduktion, reparatur: "r", sicherheit };
  if (umgehung === KEINE_UMGEHUNG) return grundfelder;
  return { ...grundfelder, umgehung, vorhanden: "", neu: "", zitat: "", belegt, belegGrund: "" };
}

function befundarten() {
  const ids = ["", "SG-07", ...katalogIds()];
  return kreuz([MERKMALE.schwere.enum, [false, true], MERKMALE.umgehung.enum, ids, ["Absicht: fehlt", "b"], [false, true], ["", REPRODUKTION]]).map(befundAus);
}

function nachstellungen() {
  return [null, new Map(), ...kreuz([KATEGORIEN, KATEGORIEN]).map(([pr, basis]) => new Map([[SCHLUESSEL, { pr, basis }]]))];
}

function lagen() {
  const geprueft = befundarten().flatMap((befund) => nachstellungen().map((nachstellung) => ({ commits: [{ sha: SHA, zustand: "geprueft", befunde: [befund] }], nachstellung })));
  const offen = ZUSTAENDE.map((zustand) => ({ commits: [{ sha: SHA, zustand, grund: "g", befunde: [] }] }));
  return [...geprueft, ...offen, { commits: [] }, { probeBranch: true, commits: [] }];
}

function genutzteIds() {
  const genutzt = new Set();
  for (const lage of lagen()) {
    const urteil = urteileMitZweck(lage);
    for (const id of statusZweck(urteil)) genutzt.add(id);
    for (const { befund } of urteil.issues) for (const id of [PRUEFER_ZWECK.ISSUE, ...befundZweck(befund)]) genutzt.add(id);
    for (const befund of lage.commits.flatMap(({ befunde }) => befunde)) if (befund.reproduktion) for (const id of befundZweck(befund)) genutzt.add(id);
  }
  return genutzt;
}

test("jede Katalog-ID bekommt den Block ihres Abschnitts, eine ID ohne Abschnitt keinen", () => {
  assert.deepEqual(katalogIds().map((id) => befundZweck({ id, beleg: "b" })), katalogTexte().map((id) => [id]));
  assert.deepEqual(befundZweck({ id: "X1", beleg: "b" }), []);
});

test("jeder rote Status des Prüfers trägt eine Zweck-ID, auch ein neu hinzugekommener", () => {
  for (const quelle of QUELLEN) {
    const text = readFileSync(join(REPO_ROOT, quelle), "utf8");
    assert.equal(text.match(ZWECK_FELD)?.length ?? 0, text.match(ROTER_STATUS)?.length ?? 0, quelle);
  }
  for (const lage of lagen()) {
    const { zweck, ...urteil } = urteileMitZweck(lage);
    assert.deepEqual(urteil, urteile(lage));
    if (!ROT.has(urteil.state)) continue;
    assert.ok(kenntZweck(zweck), `${urteil.state} ${urteil.description}`);
  }
});

test("jede Umgehungsart des Antwortschemas und jede Schwere, die ein Issue erzeugt, ist in ihrem Zweck-Text genannt", () => {
  const umgehung = blockText(PRUEFER_ZWECK.UMGEHUNG).toLowerCase();
  for (const art of MERKMALE.umgehung.enum.filter((wert) => wert !== KEINE_UMGEHUNG)) assert.ok(umgehung.includes(art), art);
  const schweren = new Set(lagen().flatMap((lage) => urteile(lage).issues.map(({ befund }) => befund.schwere)));
  for (const schwere of schweren) assert.ok(blockText(PRUEFER_ZWECK.ISSUE).includes(schwere), schwere);
});

test("tools/zweck/pruefer.json hat genau die IDs, die Status, Issues, Reparatur und Katalog nutzen", () => {
  assert.deepEqual([...genutzteIds()].toSorted(), Object.keys(TEXTE).toSorted());
});

function scheinGithub() {
  const gesendet = [];
  const sende = async (methode, pfad, daten) => gesendet.push({ pfad, daten });
  return { gesendet, hole: workflowAbfrage, alle: async () => [], sende };
}

async function entscheideMit(context, commits) {
  setzeAusloeser(context, ciLauf());
  const ordner = probeDirectory(context, { "ergebnis.json": JSON.stringify({ format: 1, head: SHA, branch: "fix/zahl", commits }) });
  const github = scheinGithub();
  const log = [];
  context.mock.method(console, "log", (zeile) => log.push(zeile));
  await entscheiden({ ergebnis: commits ? ordner : join(ordner, "fehlt"), head: SHA }, ordner, { github });
  const [{ daten }] = github.gesendet;
  return { status: [daten.state, daten.description], nachStatus: log.slice(log.findIndex((zeile) => zeile.startsWith("Prüfer: ")) + 1) };
}

test("ein belegter Umgehungs-BLOCKER behält seinen Status, und das Log nennt danach Zweck und Ausweg", async (context) => {
  const befund = { ...befundAus(["BLOCKER", false, "nachbau", "", "b", true, ""]), datei: "src/neu.js" };
  const lauf = await entscheideMit(context, [{ sha: SHA, patchId: "", zustand: "geprueft", befunde: [befund] }]);
  assert.deepEqual(lauf.status, ["failure", "Umgehung belegt: src/neu.js"]);
  assert.deepEqual(lauf.nachStatus, [...zweckBlock(PRUEFER_ZWECK.STATUS), ...zweckBlock(PRUEFER_ZWECK.UMGEHUNG)]);
});

test("fehlt das Ergebnis, nennt das Log den Zweck von nicht gelaufen; ein grüner Status zeigt keinen Block", async (context) => {
  const fehlt = await entscheideMit(context, null);
  assert.deepEqual(fehlt.status, ["error", "Prüfer nicht gelaufen: kein Ergebnis"]);
  assert.deepEqual(fehlt.nachStatus, [...zweckBlock(PRUEFER_ZWECK.STATUS), ...zweckBlock(PRUEFER_ZWECK.NICHT_GELAUFEN)]);
  const gruen = await entscheideMit(context, [{ sha: SHA, patchId: "", zustand: "geprueft", befunde: [] }]);
  assert.deepEqual(gruen, { status: ["success", "1 Commits geprüft, 0 übernommen"], nachStatus: [] });
});

test("ein Prüfer-Issue nennt Zweck und Ausweg nach der Stelle und vor dem Beleg, mit dem Block seines Katalog-Abschnitts", () => {
  const befund = befundAus(["SOLLTE", false, KEINE_UMGEHUNG, "G5", "BELEG-G5", false, ""]);
  const text = issueText({ sha: SHA, befund, grund: "" });
  const stelle = text.indexOf("- Stelle: `src/zahl.js`, Zeile 1\n\n");
  const zweck = [...zweckBlock(PRUEFER_ZWECK.ISSUE), ...zweckBlock(`${KATALOG_PRAEFIX}G`)].map((zeile) => `${zeile}\n\n`).join("");
  assert.ok(stelle > 0 && text.indexOf(zweck) > stelle && text.indexOf(zweck) < text.indexOf("### Beleg"), text);
});

test("die Reparatur-Aufforderung nennt den Block des Katalog-Abschnitts vor dem Block der Reparatur", () => {
  const befund = { ...befundAus(["BLOCKER", false, KEINE_UMGEHUNG, "T1", "b", false, REPRODUKTION]), schluessel: SCHLUESSEL };
  const entwurf = reparaturPhase(befund, { pr: 1 }).entwurf["src/zahl.js"];
  const bloecke = [...zweckBlock(`${KATALOG_PRAEFIX}T`), ...zweckBlock(MELDUNG.REPARATUR)].join("\n");
  assert.ok(entwurf.endsWith(`\n${bloecke}`), entwurf);
});
