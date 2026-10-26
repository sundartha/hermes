import assert from "node:assert/strict";
import { test } from "node:test";

import { issueAus } from "../../tools/auftrag/planung/issue.mjs";

const ISSUE_FORM = "Issue: <Nummer>";

function imKopf(...zeilen) {
  return `# Pitch\nStatus: Entwurf\n${zeilen.join("\n")}\n\n## Abschnitt\nText\n`;
}

function hinterAbschnitt(zeile) {
  return `# Pitch\nStatus: Entwurf\n\n## Abschnitt\n${zeile}\n`;
}

function mitWindowsZeilenenden(zeile) {
  return imKopf(zeile).replaceAll("\n", "\r\n");
}

const OHNE_ZEILE = hinterAbschnitt("Text");
const ISSUE_IM_PITCH = imKopf("Issue: 12");

function issueFehler(zeile) {
  return { fehler: `pitch.md: die Zeile „${zeile}“ braucht die Form „${ISSUE_FORM}“ mit einer ganzen Zahl über 0` };
}

function issueAngabeFehler(angabe) {
  return { fehler: `--issue braucht die Nummer eines Issues als ganze Zahl über 0, nicht ${angabe}` };
}

test("issueAus ohne --issue: genau ein Leerzeichen nach dem Doppelpunkt gilt", () => {
  assert.deepEqual(issueAus(undefined, imKopf("Issue: 12")), { issue: 12 });
});

test("issueAus ohne --issue: zwei Leerzeichen nach dem Doppelpunkt sind ein Fehler", () => {
  assert.deepEqual(issueAus(undefined, imKopf("Issue:  12")), issueFehler("Issue:  12"));
});

test("issueAus ohne --issue: kein Leerzeichen nach dem Doppelpunkt ist ein Fehler", () => {
  assert.deepEqual(issueAus(undefined, imKopf("Issue:12")), issueFehler("Issue:12"));
});

test("issueAus ohne --issue: Leerraum am Zeilenende ist erlaubt", () => {
  assert.deepEqual(issueAus(undefined, imKopf("Issue: 12 \t")), { issue: 12 });
});

test("issueAus ohne --issue: Tausenderpunkte sind ein Fehler", () => {
  assert.deepEqual(issueAus(undefined, imKopf("Issue: 1.234")), issueFehler("Issue: 1.234"));
});

test("issueAus ohne --issue: Text statt Zahl ist ein Fehler", () => {
  assert.deepEqual(issueAus(undefined, imKopf("Issue: abc")), issueFehler("Issue: abc"));
});

test("issueAus ohne --issue: 0 ist ein Fehler", () => {
  assert.deepEqual(issueAus(undefined, imKopf("Issue: 0")), issueFehler("Issue: 0"));
});

test("issueAus ohne --issue: eine Einheit hinter der Zahl ist ein Fehler", () => {
  assert.deepEqual(issueAus(undefined, imKopf("Issue: 12 Token")), issueFehler("Issue: 12 Token"));
});

test("issueAus ohne --issue: bei mehreren Zeilen gilt die erste, auch wenn sie ungültig ist und eine gültige folgt", () => {
  assert.deepEqual(issueAus(undefined, imKopf("Issue: abc", "Issue: 5")), issueFehler("Issue: abc"));
});

test("issueAus ohne --issue: bei mehreren Zeilen gilt die erste, auch wenn danach eine ungültige folgt", () => {
  assert.deepEqual(issueAus(undefined, imKopf("Issue: 5", "Issue: abc")), { issue: 5 });
});

test("issueAus ohne --issue: eine gültige Zeile hinter dem ersten Abschnitt wird nicht gelesen", () => {
  assert.deepEqual(issueAus(undefined, hinterAbschnitt("Issue: 5")), {});
});

test("issueAus ohne --issue: eine ungültige Zeile hinter dem ersten Abschnitt wird nicht gelesen", () => {
  assert.deepEqual(issueAus(undefined, hinterAbschnitt("Issue: abc")), {});
});

test("issueAus ohne --issue: ohne Abschnitt ist der ganze Pitch der Kopf", () => {
  assert.deepEqual(issueAus(undefined, "# Pitch\nStatus: Entwurf\nIssue: 9\n"), { issue: 9 });
});

test("issueAus ohne --issue: mit Windows-Zeilenenden gilt eine gültige Nummer", () => {
  assert.deepEqual(issueAus(undefined, mitWindowsZeilenenden("Issue: 12")), { issue: 12 });
});

test("issueAus ohne --issue: mit Windows-Zeilenenden nennt die Meldung die Zeile ohne Zeilenende", () => {
  assert.deepEqual(issueAus(undefined, mitWindowsZeilenenden("Issue: abc")), issueFehler("Issue: abc"));
});

test("issueAus ohne --issue: ohne Zeile im Pitch ist es in Ordnung und liefert keine Nummer", () => {
  assert.deepEqual(issueAus(undefined, OHNE_ZEILE), {});
});

test("issueAus: --issue geht vor die gültige Zeile im Pitch", () => {
  assert.deepEqual(issueAus("7", ISSUE_IM_PITCH), { issue: 7 });
});

test("issueAus: --issue gilt auch ohne Zeile im Pitch", () => {
  assert.deepEqual(issueAus("7", OHNE_ZEILE), { issue: 7 });
});

test("issueAus: --issue gilt auch bei ungültiger Zeile im Pitch", () => {
  assert.deepEqual(issueAus("7", imKopf("Issue: abc")), { issue: 7 });
});

test("issueAus: --issue mit Tausenderpunkt ist ein Fehler", () => {
  assert.deepEqual(issueAus("1.234", ISSUE_IM_PITCH), issueAngabeFehler("1.234"));
});

test("issueAus: --issue 0 ist ein Fehler, auch bei gültiger Zeile im Pitch", () => {
  assert.deepEqual(issueAus("0", ISSUE_IM_PITCH), issueAngabeFehler("0"));
});

test("issueAus: --issue abc ist ein Fehler, auch bei gültiger Zeile im Pitch", () => {
  assert.deepEqual(issueAus("abc", ISSUE_IM_PITCH), issueAngabeFehler("abc"));
});

test("issueAus: --issue 07 mit führender Null ist ein Fehler", () => {
  assert.deepEqual(issueAus("07", ISSUE_IM_PITCH), issueAngabeFehler("07"));
});

test("issueAus: --issue -5 ist ein Fehler", () => {
  assert.deepEqual(issueAus("-5", ISSUE_IM_PITCH), issueAngabeFehler("-5"));
});

test("issueAus: --issue mit Leerzeichen am Ende ist ein Fehler", () => {
  assert.deepEqual(issueAus("1 ", ISSUE_IM_PITCH), issueAngabeFehler("1 "));
});

test("issueAus: --issue leer ist ein Fehler", () => {
  assert.deepEqual(issueAus("", ISSUE_IM_PITCH), issueAngabeFehler(""));
});
