import assert from "node:assert/strict";
import { test } from "node:test";

import { deckelAus } from "../../tools/auftrag/planung/deckel.mjs";
import { issueAus } from "../../tools/auftrag/planung/issue.mjs";

const FREIGABE_FORM = "Planung freigegeben: <Zahl> Token";
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
const FREIGABE_IM_PITCH = imKopf("Planung freigegeben: 20000000 Token");
const ISSUE_IM_PITCH = imKopf("Issue: 12");

function freigabeFehler(zeile) {
  return { fehler: `pitch.md: die Zeile „${zeile}“ braucht die Form „${FREIGABE_FORM}“ mit einer ganzen Zahl über 0` };
}

function issueFehler(zeile) {
  return { fehler: `pitch.md: die Zeile „${zeile}“ braucht die Form „${ISSUE_FORM}“ mit einer ganzen Zahl über 0` };
}

function deckelAngabeFehler(angabe) {
  return { fehler: `--deckel braucht eine ganze Zahl Token über 0, nicht ${angabe}` };
}

function issueAngabeFehler(angabe) {
  return { fehler: `--issue braucht die Nummer eines Issues als ganze Zahl über 0, nicht ${angabe}` };
}

test("deckelAus ohne --deckel: genau ein Leerzeichen nach dem Doppelpunkt gilt", () => {
  assert.deepEqual(deckelAus(undefined, imKopf("Planung freigegeben: 20000000 Token")), { deckel: 20000000 });
});

test("deckelAus ohne --deckel: zwei Leerzeichen nach dem Doppelpunkt sind ein Fehler", () => {
  assert.deepEqual(deckelAus(undefined, imKopf("Planung freigegeben:  20000000 Token")), freigabeFehler("Planung freigegeben:  20000000 Token"));
});

test("deckelAus ohne --deckel: kein Leerzeichen nach dem Doppelpunkt ist ein Fehler", () => {
  assert.deepEqual(deckelAus(undefined, imKopf("Planung freigegeben:20000000 Token")), freigabeFehler("Planung freigegeben:20000000 Token"));
});

test("deckelAus ohne --deckel: Leerraum am Zeilenende ist erlaubt", () => {
  assert.deepEqual(deckelAus(undefined, imKopf("Planung freigegeben: 20000000 Token \t")), { deckel: 20000000 });
});

test("deckelAus ohne --deckel: Tausenderpunkte sind ein Fehler", () => {
  assert.deepEqual(deckelAus(undefined, imKopf("Planung freigegeben: 20.000.000 Token")), freigabeFehler("Planung freigegeben: 20.000.000 Token"));
});

test("deckelAus ohne --deckel: Text statt Zahl ist ein Fehler", () => {
  assert.deepEqual(deckelAus(undefined, imKopf("Planung freigegeben: abc Token")), freigabeFehler("Planung freigegeben: abc Token"));
});

test("deckelAus ohne --deckel: 0 ist ein Fehler", () => {
  assert.deepEqual(deckelAus(undefined, imKopf("Planung freigegeben: 0 Token")), freigabeFehler("Planung freigegeben: 0 Token"));
});

test("deckelAus ohne --deckel: ohne die Einheit Token ist es ein Fehler", () => {
  assert.deepEqual(deckelAus(undefined, imKopf("Planung freigegeben: 20000000")), freigabeFehler("Planung freigegeben: 20000000"));
});

test("deckelAus ohne --deckel: bei mehreren Zeilen gilt die erste, auch wenn sie ungültig ist und eine gültige folgt", () => {
  assert.deepEqual(deckelAus(undefined, imKopf("Planung freigegeben: abc Token", "Planung freigegeben: 5 Token")), freigabeFehler("Planung freigegeben: abc Token"));
});

test("deckelAus ohne --deckel: bei mehreren Zeilen gilt die erste, auch wenn danach eine ungültige folgt", () => {
  assert.deepEqual(deckelAus(undefined, imKopf("Planung freigegeben: 5 Token", "Planung freigegeben: abc Token")), { deckel: 5 });
});

test("deckelAus ohne --deckel: eine Zeile hinter dem ersten Abschnitt gilt", () => {
  assert.deepEqual(deckelAus(undefined, hinterAbschnitt("Planung freigegeben: 20000000 Token")), { deckel: 20000000 });
});

test("deckelAus ohne --deckel: mit Windows-Zeilenenden gilt eine gültige Zahl", () => {
  assert.deepEqual(deckelAus(undefined, mitWindowsZeilenenden("Planung freigegeben: 20000000 Token")), { deckel: 20000000 });
});

test("deckelAus ohne --deckel: mit Windows-Zeilenenden nennt die Meldung die Zeile ohne Zeilenende", () => {
  assert.deepEqual(deckelAus(undefined, mitWindowsZeilenenden("Planung freigegeben: abc Token")), freigabeFehler("Planung freigegeben: abc Token"));
});

test("deckelAus ohne --deckel: ohne Zeile im Pitch ist es ein Fehler, der die Zeile nennt", () => {
  assert.deepEqual(deckelAus(undefined, OHNE_ZEILE), { fehler: `pitch.md hat keine Zeile „${FREIGABE_FORM}“ und --deckel fehlt; ohne freigegebene Token-Menge plant plane nicht` });
});

test("deckelAus: --deckel geht vor die gültige Zeile im Pitch", () => {
  assert.deepEqual(deckelAus("7", FREIGABE_IM_PITCH), { deckel: 7 });
});

test("deckelAus: --deckel gilt auch ohne Zeile im Pitch", () => {
  assert.deepEqual(deckelAus("7", OHNE_ZEILE), { deckel: 7 });
});

test("deckelAus: --deckel gilt auch bei ungültiger Zeile im Pitch", () => {
  assert.deepEqual(deckelAus("7", imKopf("Planung freigegeben: abc Token")), { deckel: 7 });
});

test("deckelAus: --deckel mit Tausenderpunkten ist ein Fehler", () => {
  assert.deepEqual(deckelAus("20.000", FREIGABE_IM_PITCH), deckelAngabeFehler("20.000"));
});

test("deckelAus: --deckel 0 ist ein Fehler, auch bei gültiger Zeile im Pitch", () => {
  assert.deepEqual(deckelAus("0", FREIGABE_IM_PITCH), deckelAngabeFehler("0"));
});

test("deckelAus: --deckel abc ist ein Fehler, auch bei gültiger Zeile im Pitch", () => {
  assert.deepEqual(deckelAus("abc", FREIGABE_IM_PITCH), deckelAngabeFehler("abc"));
});

test("deckelAus: --deckel 07 mit führender Null ist ein Fehler", () => {
  assert.deepEqual(deckelAus("07", FREIGABE_IM_PITCH), deckelAngabeFehler("07"));
});

test("deckelAus: --deckel -5 ist ein Fehler", () => {
  assert.deepEqual(deckelAus("-5", FREIGABE_IM_PITCH), deckelAngabeFehler("-5"));
});

test("deckelAus: --deckel mit Leerzeichen am Ende ist ein Fehler", () => {
  assert.deepEqual(deckelAus("1 ", FREIGABE_IM_PITCH), deckelAngabeFehler("1 "));
});

test("deckelAus: --deckel leer ist ein Fehler", () => {
  assert.deepEqual(deckelAus("", FREIGABE_IM_PITCH), deckelAngabeFehler(""));
});

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
