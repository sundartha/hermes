import assert from "node:assert/strict";
import { test } from "node:test";

import { ABSCHALTUNG_VERSTOSS } from "../../tools/auftrag/gleichwertig.mjs";
import { nurSchutzRot } from "../../tools/auftrag/schutzkennung.mjs";
import { schutzansprueche, schutzDesUrteils } from "../../tools/mutationspruefung/schutzmessung.mjs";

const TEST_DATEI = "test/gemeinsam/anfrage-kennung-im-server.test.js";
const NIE1 = "[NIE1] mit Schalter bleibt eine Nummer in einer Logzeile waehrend der Anfrage maskiert";
const NIE2 = "[NIE2] ohne Schalter bleibt die Zeile unveraendert";
const NIE3 = "[NIE3] mit Schalter weist der Webhook einen unsignierten Anruf weiter ab und legt keinen Anruf an";
const GUARDS = { datei: "src/process-guards.js", bereiche: [[20, 40]] };
const KENNUNG = { datei: "src/utils/anfrage-kennung.js", bereiche: [[1, 30]] };
const FAELLE = [NIE1, NIE2, NIE3].map((name) => ({ name, pfad: TEST_DATEI }));

const B3A_COMMIT_NACHRICHT = `Prozess-Guards setzen die Anfrage-Kennung vor stdout und stderr

Warum: Auftrag a1 der Phase E-2498-anfrage-kennung-process-guards; tools/auftrag.mjs hat ihn gebaut und geprüft.
Hinweis: Schutz im alten Code belegt (src/routes/voice.js:324): ${NIE3}
Alter Schutz: [NIE3] src/routes/voice.js:324, weil \`if (!ok)\` den unsignierten Webhook mit 403 abweist. Mit dem Mutanten \`if (false)\` käme er durch und würde einen Anruf anlegen; der Fall verlangt Status 403 und null Anrufe im Speicher.
Alter Schutz nicht geprüft: [NIE9] src/routes/voice.js:12, weil es den Satz nicht gibt
schutzwirkung: Exit 1
`;
const B3A_ROTE_ZEILEN = [`Verstoß: Schutztest wirkungslos: ${NIE1}`, `Verstoß: Schutztest wirkungslos: ${NIE3}`, "rot: 3 Schutztests, 2 ohne nachgewiesene Wirkung."];

function messung(datei, fall, { getoetet = false, erreicht = false }) {
  return { datei, pfad: TEST_DATEI, fall, getoetet, erreicht };
}

function bericht(messungen, faelle = FAELLE) {
  return { schutz: { faelle, messungen } };
}

const KEIN_LIVELAUF = () => assert.fail("ohne Anspruch auf alten Schutz startet das Urteil keinen Stryker");

test("B3a L2: erreichen [NIE1] und [NIE3] neue Zeilen und töten dort keinen Mutanten, [NIE2] aber einen, nennt das Urteil genau diese beiden", async () => {
  const berichte = [
    bericht([messung(GUARDS.datei, NIE1, { erreicht: true }), messung(GUARDS.datei, NIE2, { getoetet: true }), messung(GUARDS.datei, NIE3, { erreicht: true })]),
    bericht([messung(KENNUNG.datei, NIE1, {}), messung(KENNUNG.datei, NIE2, { erreicht: true }), messung(KENNUNG.datei, NIE3, {})]),
  ];
  const urteil = await schutzDesUrteils({ berichte, einheiten: [GUARDS, KENNUNG], angaben: [] }, KEIN_LIVELAUF);
  assert.deepEqual(urteil.zeilen, [B3A_ROTE_ZEILEN[0], `Schutztest wirksam: ${NIE2}`, B3A_ROTE_ZEILEN[1]]);
  assert.equal(`rot: ${urteil.anzahl} Schutztests, ${urteil.verstoesse} ohne nachgewiesene Wirkung.`, B3A_ROTE_ZEILEN[2]);
});

const FAELLE_TABELLE = [
  { name: "in irgendeiner Einheit einen Mutanten tötet", messungen: [[GUARDS, { erreicht: true }], [KENNUNG, { getoetet: true }]], erwartet: "Schutztest wirksam: " },
  { name: "nichts tötet, aber eine neue Zeile erreicht", messungen: [[GUARDS, { erreicht: true }], [KENNUNG, {}]], erwartet: "Verstoß: Schutztest wirkungslos: " },
  { name: "keine neue Zeile erreicht", messungen: [[GUARDS, {}], [KENNUNG, {}]], erwartet: "Hinweis: Schutztest erreicht keine neue Zeile, Wirkung nicht prüfbar: " },
  { name: "in einer Einheit tötet und in einer anderen überlebt", messungen: [[GUARDS, { erreicht: true, getoetet: true }], [KENNUNG, { erreicht: true }]], erwartet: "Schutztest wirksam: " },
];

for (const { name, messungen, erwartet } of FAELLE_TABELLE) {
  test(`ein Schutztest, der ${name}, ergibt „${erwartet.split(":")[0]}“`, async () => {
    const berichte = [bericht(messungen.map(([einheit, wert]) => messung(einheit.datei, NIE1, wert)), [FAELLE[0]])];
    const urteil = await schutzDesUrteils({ berichte, einheiten: [GUARDS, KENNUNG], angaben: [] }, KEIN_LIVELAUF);
    assert.deepEqual(urteil.zeilen, [`${erwartet}${NIE1}`]);
    assert.equal(urteil.verstoesse, erwartet.startsWith("Verstoß") ? 1 : 0);
  });
}

test("ohne Schutzmessung in den Teilergebnissen (kein [NIE]-Fall im Pull Request) bleibt das Urteil unverändert", async () => {
  assert.equal(await schutzDesUrteils({ berichte: [{}, { messungen: [] }], einheiten: [GUARDS], angaben: [] }, KEIN_LIVELAUF), null);
  assert.equal(await schutzDesUrteils({ berichte: [bericht([], [])], einheiten: [GUARDS], angaben: [] }, KEIN_LIVELAUF), null);
});

test("fehlt die Schutzmessung zu einer neuen Zeile, bricht das Urteil ab, statt den Schutztest zu übergehen", async () => {
  const berichte = [bericht([messung(GUARDS.datei, NIE1, { getoetet: true })], [FAELLE[0]])];
  await assert.rejects(schutzDesUrteils({ berichte, einheiten: [GUARDS, KENNUNG], angaben: [] }, KEIN_LIVELAUF), /Schutzmessung fehlt: \[NIE1\] .* in src\/utils\/anfrage-kennung\.js/);
});

test("ohne neue Zeile unter src/ ist die Wirkung nicht prüfbar und kein Verstoß", async () => {
  const urteil = await schutzDesUrteils({ berichte: [bericht([], [FAELLE[0]])], einheiten: [], angaben: [] }, KEIN_LIVELAUF);
  assert.deepEqual(urteil.zeilen, ["Hinweis: Wirkung der Schutztests nicht prüfbar, keine neue oder geänderte Zeile unter src/."]);
  assert.equal(urteil.verstoesse, 0);
});

test("die Commit-Nachricht des echten B3a-Falls nennt genau einen Anspruch auf alten Schutz, Hinweise und ungeprüfte Zeilen gelten nicht", () => {
  assert.deepEqual(schutzansprueche([B3A_COMMIT_NACHRICHT, "Ohne Anspruch\n\nPaket: B3a\n"]), ["[NIE3] src/routes/voice.js:324"]);
  assert.deepEqual(schutzansprueche([B3A_COMMIT_NACHRICHT, B3A_COMMIT_NACHRICHT]), ["[NIE3] src/routes/voice.js:324"], "dieselbe Angabe aus mehreren Commits zählt einmal");
});

test("ein Anspruch auf alten Schutz in falscher Form oder ohne Begründung wird nicht gelesen", () => {
  const nachrichten = ["Alter Schutz: [NIE1] src/a.js:3\n", "Alter Schutz: irgendwo, weil darum\n", "Alter Schutz: [NIE1] test/a.js:3, weil falscher Ort\n", "Alter Schutz: [NIE1] src/a.js:0, weil Zeile null\n"];
  assert.deepEqual(schutzansprueche(nachrichten), []);
});

const B3A_URTEIL_AUSGABE = ["grün: 40 Mutanten in den neuen Zeilen unter src/, keiner überlebt.", ...B3A_ROTE_ZEILEN, "Wozu: Ein Schutztest hält seinen Satz fest."].join("\n");

test("nur die Schutzwirkung rot: der echte B3a-Befund gilt als reiner Schutzbefund, jeder andere Befund daneben nicht", () => {
  assert.equal(nurSchutzRot(B3A_URTEIL_AUSGABE), true);
  const mitMutant = `Verstoß: Mutant überlebt: src/a.js:1:1 Regex → /x/\nrot: 1 von 3 Mutanten überleben in den neuen Zeilen unter src/; kein Test verlangt diese Zeilen.\n${B3A_URTEIL_AUSGABE}`;
  assert.equal(nurSchutzRot(mitMutant), false);
  assert.equal(nurSchutzRot("grün: 40 Mutanten in den neuen Zeilen unter src/, keiner überlebt."), false);
  const abgeschaltet = `${ABSCHALTUNG_VERSTOSS}: src/a.js:3 Kommentar „Stryker disable“\n${B3A_URTEIL_AUSGABE}`;
  assert.equal(nurSchutzRot(abgeschaltet), false);
});
