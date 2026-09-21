// Aufraeum-Gate (scripts/check-staged-suppressions.js). Prueft die reine
// Auswahl-Logik auf einer Attrappe, nie auf der echten eslint-suppressions.json
// (die ist gross und aendert sich mit jedem Aufraeumen). Beide Richtungen:
// eine vorgemerkte Datei mit Eintraegen wird gemeldet, eine ohne wird nicht.
//
// STUFE 2 (sechster und siebter Block): eine gemeldete Datei wird trotzdem
// durchgelassen, wenn ihre UNGEFILTERTEN Lint-Befunde vor und nach der
// Aenderung identisch sind - dann ist belegt, dass die Aenderung mechanisch
// war. Der sechste Block prueft die Entscheidung an der Attrappe, der siebte
// die Befundmenge an echten eslint-Meldungen (Zeilenverschiebung vs. neuer
// Verstoss vs. nicht lintbar).
//
// ALTLAST-LISTE: der zweite describe-Block prueft den Ausweg aus dem Gate.
// Hintergrund: das Gate hatte einen Fall ohne Ausweg (src/store/state-ops.js,
// src/store/pg.js tragen Schuld, deren Aufraeumen ein eigenes Refactoring
// waere). Der Eigentuemer hat entschieden: der Ausweg ist eine ausdrueckliche
// Altlast-Liste, nicht "git commit --no-verify".
//
// Der Vertrag, den dieser Block pinnt, ist die NAHT, nicht der Speicherort:
//   findSuppressedStagedFiles({ stagedFiles, suppressions, legacyExceptions })
// legacyExceptions ist eine Abbildung Dateipfad -> { reason, date }:
//   reason: nicht-leerer Text, warum die Datei noch nicht geraeumt ist
//   date:   Kalenderdatum im Format YYYY-MM-DD, wann die Ausnahme entstand
// Ein Eintrag, dem eines von beidem fehlt oder der es nur leer/unlesbar
// fuehrt, ist UNGUELTIG und entschuldigt nichts - die Liste ist eine bewusste
// Ausnahme, kein Abstellgleis. WO die Liste liegt, laesst der Auswahl-Block
// bewusst offen; das Einlesen prueft der dritte Block getrennt davon, der
// vierte den Bericht, den ein Blockierter zu sehen bekommt.
//
// RATSCHE (fuenfter Block): der Inhalt der ECHTEN Liste ist gepinnt. Waechst
// sie, schrumpft sie oder aendert sich ein Eintrag, wird der Lauf rot - dann
// muss der aendernde Agent diesen Test anfassen, und die Aenderung steht im
// Diff statt still im Bestand. Muster: ROUTE_FINGERPRINT in
// test/route-auth-inventory.test.js.
//
// WAS EIN MENSCH PRUEFEN MUSS - die Ratsche kann es nicht (Eigentuemer-
// Entscheidung 2026-08-13, .fortschritt.md D11):
//   1. Die FREIGABE selbst. Der Test sieht, DASS jemand die Liste nachgezogen
//      hat, nie ob Antonio den Eintrag erlaubt hat. Ein Bau-Agent setzt
//      keinen Eintrag - blockiert ihn der Hook, raeumt er auf oder meldet sich.
//   2. Ob der Grund WAHR ist: dass das Aufraeumen wirklich gefaehrlich waere
//      und nicht bloss laestig. Die Maschine misst Substanz (Laenge,
//      Wortbestand jenseits von Floskeln), nie Wahrheit oder Gefahr.
//   3. Ob die Unterdrueckungen der Datei ECHTE Schuld sind oder ein
//      Fehlschnitt der Regel (D9/D10). Beim Fehlschnitt wird die REGEL
//      korrigiert - der Eintrag gehoert dann gar nicht erst auf die Liste.
//      Anlass: von 45 Verstoessen der beiden gelisteten Dateien waren 37
//      reine Umbenennungen.
import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  findChangedFindings,
  findPinMismatches,
  findSuppressedStagedFiles,
  findingTally,
  loadLegacyExceptions,
  makeUnfilteredLinter,
  tallyDifferences,
} from "../scripts/check-staged-suppressions.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_EXCEPTIONS_REL = "eslint-legacy-exceptions.json";
const SUPPRESSIONS_REL = "eslint-suppressions.json";
const SCRIPT_PATH = resolve(REPO_ROOT, "scripts/check-staged-suppressions.js");

function readRepoFile(relativePath) {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

const DUMMY_SUPPRESSIONS = {
  "src/dummy/schmutzig.js": {
    "no-magic-numbers": { count: 3 },
    "id-length": { count: 1 },
  },
  "src/dummy/leer.js": {},
  "apps/dummy/andere-datei.js": {
    "no-magic-numbers": { count: 2 },
  },
};

describe("findSuppressedStagedFiles (Attrappe)", () => {
  it("meldet eine vorgemerkte Datei mit Eintraegen samt Regeln+Anzahl", () => {
    const offenders = findSuppressedStagedFiles({
      stagedFiles: ["src/dummy/schmutzig.js"],
      suppressions: DUMMY_SUPPRESSIONS,
    });
    assert.equal(offenders.length, 1);
    assert.equal(offenders[0].file, "src/dummy/schmutzig.js");
    assert.deepEqual(offenders[0].ruleCounts, [
      { rule: "no-magic-numbers", count: 3 },
      { rule: "id-length", count: 1 },
    ]);
  });

  it("laesst eine vorgemerkte Datei ohne Eintraege durch", () => {
    const offenders = findSuppressedStagedFiles({
      stagedFiles: ["src/dummy/sauber.js"],
      suppressions: DUMMY_SUPPRESSIONS,
    });
    assert.deepEqual(offenders, []);
  });

  it("behandelt eine Datei mit leerem Regel-Objekt wie keinen Eintrag", () => {
    const offenders = findSuppressedStagedFiles({
      stagedFiles: ["src/dummy/leer.js"],
      suppressions: DUMMY_SUPPRESSIONS,
    });
    assert.deepEqual(offenders, []);
  });

  it("meldet nur die betroffenen unter mehreren vorgemerkten Dateien", () => {
    const offenders = findSuppressedStagedFiles({
      stagedFiles: [
        "src/dummy/sauber.js",
        "src/dummy/schmutzig.js",
        "apps/dummy/andere-datei.js",
        "src/dummy/leer.js",
      ],
      suppressions: DUMMY_SUPPRESSIONS,
    });
    assert.deepEqual(
      offenders.map((offender) => offender.file),
      ["src/dummy/schmutzig.js", "apps/dummy/andere-datei.js"],
    );
  });

  it("liefert eine leere Liste ohne vorgemerkte Dateien", () => {
    const offenders = findSuppressedStagedFiles({
      stagedFiles: [],
      suppressions: DUMMY_SUPPRESSIONS,
    });
    assert.deepEqual(offenders, []);
  });
});

// Eigene Attrappe fuer die Altlast-Faelle, damit die Bestandsfaelle oben
// unveraendert bleiben. "geraeumt.js" fehlt hier absichtlich: sie steht auf
// der Liste, traegt aber keine Unterdrueckungen mehr.
const LEGACY_SUPPRESSIONS = {
  "src/dummy/altlast.js": { "id-length": { count: 3 }, "max-params": { count: 2 } },
  "src/dummy/ohne-grund.js": { "id-length": { count: 1 } },
  "src/dummy/ohne-datum.js": { "id-length": { count: 1 } },
  "src/dummy/leere-felder.js": { "id-length": { count: 1 } },
  "src/dummy/krummes-datum.js": { "id-length": { count: 1 } },
  "src/dummy/ohne-findings.js": { "id-length": { count: 1 } },
  "src/dummy/nicht-gelistet.js": { "no-magic-numbers": { count: 2 } },
};

// Der Pin von altlast.js - eigene Konstante, weil er in Stufe-3-Tests weiter
// unten als "gleicher" Pin wiederverwendet wird.
const ALTLAST_PIN = { "id-length :: Identifier name 'q' is too short (< 2).": 3 };

// Genau ein Eintrag ist gueltig (altlast.js). Er steht in jedem Fall mit im
// Spiel, damit jeder Test die Entschuldigung UND die Positiv-Kontrolle
// zugleich prueft: ein Gate, das alles durchlaesst, faellt hier auf.
const LEGACY_EXCEPTIONS = {
  "src/dummy/altlast.js": {
    reason: "Aufraeumen waere ein eigenes Refactoring des Zustandsmoduls",
    date: "2026-08-13",
    findings: ALTLAST_PIN,
  },
  "src/dummy/ohne-grund.js": { date: "2026-08-13", findings: ALTLAST_PIN },
  "src/dummy/ohne-datum.js": { reason: "steht noch aus", findings: ALTLAST_PIN },
  "src/dummy/leere-felder.js": { reason: "   ", date: "   ", findings: ALTLAST_PIN },
  "src/dummy/krummes-datum.js": { reason: "steht noch aus", date: "bald", findings: ALTLAST_PIN },
  "src/dummy/ohne-findings.js": { reason: "steht noch aus", date: "2026-08-13" },
  "src/dummy/geraeumt.js": {
    reason: "war Altlast, ist inzwischen geraeumt",
    date: "2026-08-13",
    findings: ALTLAST_PIN,
  },
};

// Prueft die Auswahl gegen die Altlast-Attrappe und liefert nur die Pfade der
// Treffer - die Regel-Anzahlen decken die Bestandsfaelle oben bereits ab.
function offendingFiles(stagedFiles) {
  const offenders = findSuppressedStagedFiles({
    stagedFiles,
    suppressions: LEGACY_SUPPRESSIONS,
    legacyExceptions: LEGACY_EXCEPTIONS,
  });
  return offenders.map((offender) => offender.file);
}

describe("Altlast-Liste im Aufraeum-Gate (Attrappe)", () => {
  it("entschuldigt eine gelistete Datei, meldet die ungelistete weiterhin", () => {
    assert.deepEqual(offendingFiles(["src/dummy/altlast.js", "src/dummy/nicht-gelistet.js"]), [
      "src/dummy/nicht-gelistet.js",
    ]);
  });

  it("entschuldigt nicht, wenn dem Eintrag der Grund fehlt", () => {
    assert.deepEqual(offendingFiles(["src/dummy/altlast.js", "src/dummy/ohne-grund.js"]), [
      "src/dummy/ohne-grund.js",
    ]);
  });

  it("entschuldigt nicht, wenn dem Eintrag das Datum fehlt", () => {
    assert.deepEqual(offendingFiles(["src/dummy/altlast.js", "src/dummy/ohne-datum.js"]), [
      "src/dummy/ohne-datum.js",
    ]);
  });

  it("entschuldigt nicht, wenn Grund und Datum nur aus Leerzeichen bestehen", () => {
    assert.deepEqual(offendingFiles(["src/dummy/altlast.js", "src/dummy/leere-felder.js"]), [
      "src/dummy/leere-felder.js",
    ]);
  });

  it("entschuldigt nicht, wenn das Datum kein Kalenderdatum ist", () => {
    assert.deepEqual(offendingFiles(["src/dummy/altlast.js", "src/dummy/krummes-datum.js"]), [
      "src/dummy/krummes-datum.js",
    ]);
  });

  it("entschuldigt nicht, wenn dem Eintrag der Pin (findings) fehlt", () => {
    assert.deepEqual(offendingFiles(["src/dummy/altlast.js", "src/dummy/ohne-findings.js"]), [
      "src/dummy/ohne-findings.js",
    ]);
  });

  it("laesst eine gelistete, inzwischen geraeumte Datei unauffaellig", () => {
    assert.deepEqual(
      offendingFiles([
        "src/dummy/geraeumt.js",
        "src/dummy/altlast.js",
        "src/dummy/nicht-gelistet.js",
      ]),
      ["src/dummy/nicht-gelistet.js"],
    );
  });
});

// Das Einlesen der Liste. Die Lesefunktion ist injizierbar, deshalb braucht
// dieser Pfad kein Dateisystem. Geprueft wird beides: der Erfolgsfall UND dass
// eine fehlende oder kaputte Liste abbricht statt still ohne Liste
// weiterzulaufen. Der stille Weiterlauf waere der gefaehrliche Ausgang: eine
// leere Liste entschuldigt niemanden, das Gate saehe aus wie funktionierend
// und wuerde jede gelistete Datei trotzdem ablehnen - Anlass genug, wieder zum
// verbotenen "--no-verify" zu greifen.
describe("loadLegacyExceptions (injizierter Leser)", () => {
  it("liest eine gueltige Liste ueber die injizierte Lesefunktion ein", () => {
    const angefragtePfade = [];
    const geladen = loadLegacyExceptions((relativePath) => {
      angefragtePfade.push(relativePath);
      return JSON.stringify(LEGACY_EXCEPTIONS);
    });
    assert.deepEqual(geladen, LEGACY_EXCEPTIONS);
    assert.deepEqual(angefragtePfade, [LEGACY_EXCEPTIONS_REL]);
  });

  it("bricht ab, wenn die Liste fehlt oder unlesbar ist", () => {
    assert.throws(
      () =>
        loadLegacyExceptions(() => {
          throw new Error("ENOENT: no such file or directory");
        }),
      /ENOENT/,
    );
  });

  it("bricht ab, wenn die Liste syntaktisch kaputt ist", () => {
    assert.throws(() => loadLegacyExceptions(() => '{ "src/dummy/altlast.js": '), SyntaxError);
  });
});

// Der Bericht, den ein Blockierter zu sehen bekommt. Wer abgelehnt wird, liest
// diesen Text - nicht den Quelltext des Skripts. Steht der Ausweg nur im
// Kopfkommentar, greift der Blockierte zum naechstliegenden Mittel, und das ist
// "git commit --no-verify". Genau so ist am 2026-08-13 ein Commit still an der
// Ratsche vorbeigelaufen. Geprueft wird darum am Berichtstext eines echten
// CLI-Laufs, nicht an einer Innerei der Ausgabe-Funktion.
//
// Die abgelehnte Datei wird aus dem Bestand gewaehlt statt fest verdrahtet: ein
// einzelner Bestandspfad verschwindet mit dem naechsten Aufraeumen, die Frage
// "gibt es ueberhaupt eine abgelehnte Datei" ist die Positiv-Kontrolle.
function firstGatedFile() {
  const suppressions = JSON.parse(readRepoFile(SUPPRESSIONS_REL));
  const legacyExceptions = JSON.parse(readRepoFile(LEGACY_EXCEPTIONS_REL));
  return Object.keys(suppressions).find(
    (file) => !legacyExceptions[file] && Object.keys(suppressions[file]).length > 0,
  );
}

// Seit Stufe 2 lehnt das Gate eine Datei nur noch ab, wenn sich ihre Befunde
// zwischen HEAD und Index bewegen - ein CLI-Lauf ohne vorgemerkte Aenderung
// laeuft durch. Fuer einen echten Ablehnungs-Lauf braucht der Test also einen
// Index. Der entsteht NEBEN dem echten (GIT_INDEX_FILE): Arbeitsbaum und der
// Index des Entwicklers bleiben unberuehrt, und der Test haengt nicht daran,
// was gerade vorgemerkt ist. Vorgemerkt wird der Blob einer ANDEREN,
// lint-sauberen Bestandsdatei - so bewegt sich die Befundmenge garantiert,
// ohne dass der Test ein neues Objekt in die Objektdatenbank schreiben muss.
const GIT_BLOB_MODE = "100644";
const CLEAN_BLOB_SOURCE = "scripts/check-staged-suppressions.js";

function git(args, env = process.env) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env,
  }).trim();
}

// Ein Index neben dem echten, gefuellt aus HEAD: Index == HEAD, also keine
// Aenderung an irgendeiner Datei.
function tempIndexEnv() {
  const indexFile = join(mkdtempSync(join(tmpdir(), "aufraeum-gate-")), "index");
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  git(["read-tree", "HEAD"], env);
  return env;
}

function stageForeignContent(file) {
  const env = tempIndexEnv();
  const blob = git(["rev-parse", `HEAD:${CLEAN_BLOB_SOURCE}`]);
  git(["update-index", "--add", "--cacheinfo", `${GIT_BLOB_MODE},${blob},${file}`], env);
  return env;
}

function runGate(file, env) {
  const run = spawnSync(process.execPath, [SCRIPT_PATH, file], {
    encoding: "utf8",
    env,
  });
  return { status: run.status, report: `${run.stdout}${run.stderr}` };
}

function gatedFile() {
  const file = firstGatedFile();
  assert.ok(
    file,
    `Positiv-Kontrolle fehlgeschlagen: keine Datei in ${SUPPRESSIONS_REL}, die das Gate pruefen wuerde`,
  );
  return file;
}

// Ein echter Ablehnungs-Lauf. Beide Berichts-Faelle teilen ihn sich: der Lauf
// ist ihre Vorbedingung, nicht ihre Aussage.
function rejectionReport() {
  const rejectedFile = gatedFile();
  const { status, report } = runGate(rejectedFile, stageForeignContent(rejectedFile));
  assert.equal(status, 1, `Gate hat nicht abgelehnt: ${report}`);
  return { rejectedFile, report };
}

// Der Ausweg darf nicht nach Selbstbedienung klingen. Diese zwei Wendungen
// tragen die Eigentuemer-Entscheidung in den Text, den ein Blockierter
// tatsaechlich liest: WER den Eintrag erlaubt (Freigabe) und WORAN sich der
// Grund messen lassen muss (Gefahr, nicht Arbeit).
const APPROVAL_TERMS = ["Freigabe des Eigentuemers", "gefaehrlich"];

describe("Ablehnungs-Bericht des Aufraeum-Gates", () => {
  it("nennt die Altlast-Liste als Ausweg", () => {
    const { rejectedFile, report } = rejectionReport();
    assert.ok(report.includes(rejectedFile), `Bericht nennt die abgelehnte Datei nicht: ${report}`);
    assert.ok(
      report.includes(LEGACY_EXCEPTIONS_REL),
      `Bericht nennt den Ausweg (${LEGACY_EXCEPTIONS_REL}) nicht: ${report}`,
    );
  });

  it("nennt die Freigabe des Eigentuemers als Bedingung fuer einen Eintrag", () => {
    const { report } = rejectionReport();
    for (const term of APPROVAL_TERMS) {
      assert.ok(
        report.includes(term),
        `Bericht nennt "${term}" nicht - dann liest der Blockierte den Ausweg als ` +
          `Selbstbedienung und traegt sich im Vorbeigehen ein: ${report}`,
      );
    }
  });
});

// ---- Ratsche auf die Altlast-Liste ------------------------------------------
// Anders als die Bloecke oben laeuft dieser gegen die ECHTE Liste - und genau
// das ist sein Zweck: sie ist klein, sie soll klein bleiben, und jede
// Bewegung darin gehoert in den Diff. Gelesen wird ueber loadLegacyExceptions,
// also ueber dieselbe Naht, an der auch der Hook haengt.
const REAL_LEGACY_EXCEPTIONS = loadLegacyExceptions();
const LISTED_FILES = Object.keys(REAL_LEGACY_EXCEPTIONS);

// Gepinnter Inhalt (Muster ROUTE_FINGERPRINT, test/route-auth-inventory.test.js):
// ein Eintrag mehr, einer weniger oder ein geaenderter Grund/Pin erzwingt eine
// bewusste Aktualisierung DIESER Stelle. Buchhaltung dazu:
//   2026-08-13  src/store/state-ops.js, src/store/pg.js aufgenommen (D11).
//   2026-08-13  src/conversation-watchdog.js, src/boot-guard.js wieder
//               entfernt: im Vorbeigehen gesetzt, vom Eigentuemer abgelehnt,
//               danach aufgeraeumt statt gelistet.
//   2026-08-15  src/routes/api-calls.js, src/telephony/call-finish.js
//               aufgenommen (Eigentuemer-Entscheidung, D11): ihr Aufraeumen ist
//               je ein Umbau im Gate- bzw. Abrechnungs-Kernpfad, kein Format.
//   2026-08-15  test/i9-self-service.test.js, test/store-pg.test.js,
//               test/store-pg-multitenant.test.js,
//               test/tenant-settings-calendar-map.test.js aufgenommen
//               (Eigentuemer-Entscheidung): gemessen, nicht vermutet - der Hook
//               blockiert sie wirklich. Vorbestehendes Fixture-Rauschen in
//               Testdaten; eigenes Aufraeum-Paket vermerkt.
//   2026-08-15  dieselben vier wieder ENTFERNT (Eigentuemer-Entscheidung):
//               Stufe 2 laesst eine Aenderung mit unveraenderter Befundmenge
//               selbst durch, die Eintraege haben keinen Zweck mehr. Am echten
//               Hook gemessen: mechanische Aenderung an
//               test/i9-self-service.test.js ohne Eintrag -> Ausgang 0,
//               dieselbe Datei mit einem neuen Befund -> Ausgang 1.
//   2026-08-15  jeder bestehende Eintrag bekommt einen findings-Pin (Stufe 3,
//               Eigentuemer-Auflage "jede weitere Zeile bricht wieder"),
//               gemessen mit "npx eslint --suppressions-location
//               eslint-suppressions.empty.json -f json <datei>". src/mcp-tools.js
//               neu aufgenommen: der registerTools-Split ist ein eigenes Paket.
//   2026-08-15  Pin nachgezogen (Owner-Auftrag, EL-Beende-Versuch/cancel_call darf
//               nicht luegen): src/routes/api-calls.js makeCallRoutes 213->222
//               (ehrliche cancel_call-Antwort), src/mcp-tools.js registerTools
//               433->430 (cancel_call-Handler vereinfacht). Stufe-3-Korrektur,
//               keine neue Verstoss-ART, am echten Hook gemessen (Exit 0).
//   2026-08-15  Pin nachgezogen (Buchungsanker, Commit 08fc253): src/store/pg.js
//               makePgStore 462->472 Zeilen, rowToCall 21->22, flushCalls 22->23.
//               Ursache ist das neue persistierte Feld answeredUnclearReason - es MUSS
//               durch Zeilen-Mapper und Flush, beide Teil derselben Riesenfunktion.
//               Unvermeidbar, solange deren Split ausgesetzt ist; der Grund steht am
//               Eintrag selbst. Das Gate hat die Verschlechterung gemeldet, sie ist
//               geprueft und bewusst uebernommen - nicht stillschweigend.
//   2026-08-15  Pin nachgezogen (S1-Nacharbeit der unabhaengigen Durchsicht):
//               src/routes/api-calls.js makeCallRoutes 222->225 Zeilen. Ursache sind die
//               ehrliche cancel_call-Antwort (Feld hangup_attempted) und ihre Begruendung.
//               ANMERKUNG: max-lines-per-function zaehlt hier Kommentarzeilen mit - in einem
//               Repo, das ausfuehrliche Begruendungen VERLANGT, hebt gutes Kommentieren den
//               Pin. Das ist die zweite Anhebung binnen eines Tages; die Durchsicht hat genau
//               davor gewarnt. Wer das dauerhaft loesen will, entscheidet ueber skipComments
//               in der Regel - das ist eine eigene Entscheidung, kein Nebeneffekt hier.
//   2026-08-16  Pin nachgezogen (ABNAHME-D1, sieben persistierte Felder): src/store/pg.js
//               flushCalls 23->30, rowToCall 22->29, makePgStore 472->482. DRITTE Anhebung.
//               Die Wachstumsrate ist damit GEMESSEN: je persistiertem Anruf-Feld +1
//               Komplexitaet in zwei Funktionen, linear und ohne Obergrenze. Begruendung
//               und die zwei Auswege stehen am Eintrag selbst.
//   2026-08-17  Pin nachgezogen (sipCallId, Join-Schluessel zum Telnyx-Beleg): rowToCall
//               29->30, makePgStore 482->487. VIERTE Anhebung - und die erste, die die
//               oben GEMESSENE Kurve bestaetigt statt sie zu erweitern (+1 Komplexitaet je
//               persistiertem Feld, wie vorhergesagt).
//               DRITTE BEWEGUNG, neu in ihrer Art: flushCalls (30) ist WEG, callRowValues
//               (30) ist da. Die Funktion stand exakt auf der 100-Zeilen-Grenze; die
//               50er-Werteliste wurde herausgezogen (reiner Move, maschinell als
//               byte-identisch verifiziert). Der Split hat die ZEILEN-Grenze gerettet, nicht
//               die Verzweigung reduziert - die Komplexitaet ist verschoben, nicht weg.
//               Vier Befunde vorher, vier nachher, keine neue Regel-Kategorie.
//   2026-08-19  Pins nachgezogen (EL-Cutover-Merge upstream/master <-> EL-Kette, Richtung B):
//               pg.js (F2-Mail-Feld summary_mail_sent_at als $54: callRowValues 33->34,
//               rowToCall 33->34, flushTenants 24->33, rowToTenant neu 32 - upstream-Wachstum,
//               nicht EL), state-ops.js (Merge beider Ketten: createCall 14, 's' 162->180),
//               call-finish.js (finishCall 21->32, makeCallFinish 118 - F2-Mail-Zweig).
//               Bloecke wortgleich vom Hook uebernommen; KEIN neuer Eintrag, nur Anhebung
//               bestehender Pins durch den Merge zweier je fuer sich gruener Ketten.
//   2026-08-21  src/call-result.js aufgenommen (INBOX-P2): Ziel des resultCardView-Umzugs,
//               Pin von src/mcp-tools.js UMGEHAENGT (dort entfernt), Bestandssumme unveraendert.
//   2026-08-21  Pin nachgezogen (INBOX-P2, vom Hook selbst gemeldet): src/store/pg.js
//               makePgStore 557->562 Zeilen durch den takeInboxEntries-Wrapper (R-3,
//               Wrapper-Parity zu json.js). Keine neue Regel-Kategorie.
//   2026-08-21  Runde 2 (S1-A-Fix, Review-Blocker): der Eintrag "resultCardView complexity
//               11" fuer src/call-result.js ENTFERNT statt beibehalten - die Funktion ist
//               vermeidbar auf komplexitaetsarm umgebaut (ein "?? {}" am Anfang statt fuenf
//               einzelnen "?."), gemessen mit dem echten eslint-Aufruf: 3 Befunde vorher,
//               2 (vorbestehende) nachher. Kein neuer Bau-Agenten-Eintrag auf der
//               Altlast-Liste, wie der Dateikopf es verlangt.
//   2026-08-28  Pin nachgezogen (OUTBOUND-E2, Regressionsfang Outbound-Ausfall 27.08.2026):
//               src/routes/api-calls.js complexity 23 -> 22, max-lines-per-function
//               UNVERAENDERT (243/136). Der neue Anbieter-Fehlergrund-Aufruf im catch
//               (recordStartRejectionReason) sitzt als ausgelagerte Modul-Funktion OBERHALB
//               der Riesenfunktion - der bisherige `err?.providerStatus`-Zugriff wandert mit
//               hinein, die Riesenfunktion verliert dadurch einen Verzweigungspunkt
//               (Komplexitaet sinkt) und gewinnt netto KEINE Zeile (der Helfer-Aufruf ersetzt
//               1:1 die bisherige `const providerStatus = err?.providerStatus;`-Zeile).
//               Gemessen mit dem echten eslint-Aufruf (--suppressions-location
//               eslint-suppressions.empty.json). Keine neue Verstoss-Art.
//   2026-08-28  Pin nachgezogen (OUTBOUND-E3a, E-3-Mail): src/telephony/call-finish.js
//               id-length 12 -> 10 ('t'-Anteil 7 -> 5, 'a'/'e' unveraendert bei 2/3). Der
//               neue vierte Aufrufer der Mail-Versandschleife (sendNotPlacedMail, die EINE
//               Nutzer-Mail bei not-placed) haette die Shorthand-Weitergabe {..., t} an
//               JEDER Aufrufstelle als eigenen id-length-Fund gezaehlt; stattdessen ist der
//               Bundle-Parameter von sendMailToTargets (und von sendNotPlacedMail selbst)
//               auf texts umbenannt - reine Umbenennung, sendSummaryMails behaelt ihren
//               eigenen, unveraenderten Parameter t. Ergebnis: WENIGER Befunde trotz eines
//               vierten Aufrufers. Gemessen mit dem echten eslint-Aufruf
//               (--suppressions-location eslint-suppressions.empty.json). complexity/
//               no-magic-numbers/no-param-reassign unveraendert (die neue Anweisung in
//               finishCall ist unbedingt, kein neuer Zweig).
//   2026-08-29  src/worker/provisioning-orchestrator.js NEU aufgenommen (Owner-Auftrag,
//               OUTBOUND-E5 Rest, Blocker 4+5): der Orchestrator ruft jetzt
//               sipRegistrarWennAktiv(config) statt das Dreifach-Gate ein zweites Mal
//               inline zu bauen - die vier Gate-Tests in
//               test/e5-01-sipregistrar-produktionspfad.test.js decken damit erstmals den
//               tatsaechlichen Produktionspfad ab. makeProvisioningOrchestrator sinkt
//               180 -> 171 Zeilen (Verbesserung), bleibt aber ueber der 100-Zeilen-Grenze -
//               der geaenderte Meldungstext zwingt trotzdem einen Eintrag (Begruendung am
//               Eintrag selbst). id-length/no-negated-condition unveraendert.
//   2026-08-31  Pins nachgezogen (KV2-2, Kostenprofil an der Engine-Weiche): src/store/pg.js
//               rowToCall 36->37, callRowValues 36->37 (je ein neues ??-Fallback fuer
//               cost_profile), makePgStore 563->568 (neuer Mutator recordCostProfile).
//               src/routes/api-calls.js makeCallRoutes 243->246, Async-Arrow 136->139 (je
//               eine store.recordCostProfile(...)-Zeile in den drei Outbound-Weichen-
//               Zweigen). src/store/state-ops.js GEPRUEFT, KEINE Anhebung (costProfile:
//               null, ist eine reine Zuweisung, Muster sipCallId). Alle drei gemessen mit
//               dem echten eslint-Aufruf (--suppressions-location
//               eslint-suppressions.empty.json). Keine neue Verstoss-Art.
//   2026-08-31  src/routes/voice.js NEU aufgenommen (KV2-2): makeVoiceRoutes 267 -> 269
//               Zeilen durch je eine store.recordCostProfile(...)-Zeile in den beiden
//               Inbound-Engine-Weichen-Zweigen (budget/realtime) - dieselbe Klasse wie
//               api-calls.js (Safety-Gate-/Offenlegungs-Kernpfad, G30-Split ausgesetzt).
//               complexity/no-magic-numbers unveraendert. Gemessen mit dem echten
//               eslint-Aufruf (--suppressions-location eslint-suppressions.empty.json).
//   2026-08-31  Pins nachgezogen (KV2-3, das Kosten-Buch): src/store/state-ops.js
//               id-length 's' 180->183 (die drei neuen Store-Operationen des Kosten-
//               Buchs nennen ihren Zustands-Parameter 's', Bestandskonvention). src/store/
//               pg.js hydrateTenantInto 102->103 (ein Push in den callCostEvidence-
//               Spiegel), makePgStore 568->576 (zwei neue Wrapper-Methoden, Muster
//               recordCostProfile). Das neue Blatt-Modul src/store/cost-evidence.js
//               traegt 0 Befunde. Alle gemessen mit dem echten eslint-Aufruf
//               (--suppressions-location eslint-suppressions.empty.json). Keine neue
//               Verstoss-Art.
//   2026-09-07  src/telnyx-llm-shim.js NEU aufgenommen (FW2) und src/routes/voice.js
//               nachgezogen: makeVoiceRoutes 269->270 (eine Zeile im /voice/turn-Catch
//               ruft den gemeinsamen Guthaben-Alarm). Der neue shim-Eintrag deckt eine
//               VORBESTEHENDE complexity 50 von handleChatCompletion ab; FW2 senkt sie
//               auf 49 (Doppel-Klassifikation durch EINEN Aufruf ersetzt), erhoeht also
//               nichts. Eigentuemer-Freigabe erteilt.
//   2026-09-08  src/billing/webhook.js NEU aufgenommen (FW1) und src/store/pg.js
//               nachgezogen: makePgStore 591->592 (die eine tenantExists-Wrapper-Zeile,
//               Backend-Paritaet zu json.js). Der webhook.js-Eintrag entsteht aus einer
//               VERBESSERUNG: applyStripeWebhook faellt durch die Helfer-Extraktion von
//               complexity 32 auf 29 - das Gate meldet jede Bewegung der Befundmenge,
//               auch die nach unten, damit kein zu hoch stehender Pin Spielraum fuer
//               kuenftige Verstoesse laesst. Eigentuemer-Freigabe erteilt. Alle gemessen
//               mit dem echten eslint-Aufruf (--suppressions-location
//               eslint-suppressions.empty.json). Keine neue Verstoss-Art.
//   2026-09-09  Pin NACHGEZOGEN (SEC-P6, Antwort statt Haenger): src/routes/api-calls.js
//               sinkt in allen drei bewegten Werten - Async-Arrow 145 -> 140 Zeilen und
//               Komplexitaet 28 -> 26, makeCallRoutes 243 -> 234 Zeilen. Die Gate-Schleife
//               faehrt jetzt in runOutboundGates (telephony/outbound-gates.js), die
//               Ablehnungs-Senke und denialDimensions sitzen auf der Modul-Ebene der
//               Datei. KEIN neuer Eintrag, keine neue Verstoss-Art - nur kleinere Zahlen.
//               Gemessen mit `node scripts/check-staged-suppressions.js
//               src/routes/api-calls.js` gegen die vorgemerkte Fassung.
//   2026-09-10  MERGE der SEC-Kette mit FW1/FW2. Beide Ketten hatten dieselben zwei
//               Funktionen von derselben Basis aus nachgezogen und trugen zufaellig
//               DIESELBE Zahl ein - git fuehrte die identische Zeile stillschweigend
//               zusammen, die Pins waren dadurch zu niedrig. Neu GEMESSEN statt addiert:
//               makePgStore 597 (591 + SEC 5 + FW 1), makeVoiceRoutes 274 (269 + 4 + 1).
//               Keine neue Verstoss-Art, kein neuer Eintrag.
//   2026-09-11  GP-P2 (Eignungs-Gate der Zahlungsmethode) bewegt zwei Eintraege in
//               BEIDE Richtungen. src/billing/webhook.js SENKT: applyStripeWebhook
//               29 -> 25 Komplexitaet - der Karten-Bindezweig des Race-Fixes ist als
//               eigene Funktion bindPaymentMethodFromEventIfMissing herausgezogen -
//               ihre drei Bedingungen zaehlen nicht mehr in der Orchestrierungs-
//               Funktion. src/store/pg.js HEBT AN: flushTenants 33 -> 34 und
//               rowToTenant 32 -> 33 - die neue additive Spalte
//               stripe_payment_method_type MUSS durch Mapper UND Flush, dieselbe
//               seit 2026-08-15 gemessene lineare Kurve wie jede vorige Anhebung.
//               Beide Bewegungen sind im reason-Feld der Datei selbst begruendet.
//               Gemessen mit dem echten eslint-Aufruf (--suppressions-location
//               eslint-suppressions.empty.json). Keine neue Verstoss-Art.
//   2026-09-13  IE7 (Inbound wartet nur noch auf das erste Audio-Paket) bewegt
//               src/routes/voice.js in BEIDE Richtungen. HEBT AN: makeVoiceRoutes
//               274 -> 279 Zeilen - der GET /voice/tts/:token-Handler ist async
//               geworden (der Token wird vergeben, BEVOR die Synthese fertig ist)
//               und sein Rumpf liegt deshalb in try/catch (Express 4 faengt
//               abgelehnte Versprechen aus async-Handlern nicht ab). SENKT:
//               no-magic-numbers 3 -> 2 - das 404 dieses Handlers heisst jetzt
//               HTTP_NOT_FOUND. complexity unveraendert, keine neue Verstoss-Art,
//               kein neuer Eintrag. Gemessen mit dem echten eslint-Aufruf
//               (--suppressions-location eslint-suppressions.empty.json).
//   2026-09-14  IE6-S1 (Telnyx-AI-Assistant ersatzlos entfernt) SENKT vier
//               Altlast-Pins (state-ops.js, pg.js, api-calls.js, voice.js -
//               die Assistant-/Shim-Zweige und ihre Store-Schreibwege sind
//               entfernt) und fuegt ELF NEUE Eintraege hinzu (runner.mjs,
//               registry.js, util.js sowie sieben Testdateien, deren
//               Assistant-/Shim-Testfaelle geloescht sind): eine reine
//               Loeschung verschiebt den exakten Meldungstext bulk-
//               unterdrueckter Bestandsbefunde (Zeilenzahlen, verschobene
//               Identifier-Zaehlungen), ohne selbst neue Verstoesse zu
//               erzeugen. Gemessen mit dem echten eslint-Aufruf
//               (--suppressions-location eslint-suppressions.empty.json).
//   2026-09-14  IE6-S2 (OpenAI-Realtime-Bridge ersatzlos entfernt) SENKT ZWEI
//               Altlast-Pins (api-calls.js: complexity 24 -> 23, der TeXML-
//               Zweig verzweigt nicht mehr auf VOICE_ENGINE; voice.js:
//               makeVoiceRoutes 237 -> 227 Zeilen, der komplette Realtime-
//               Zweig in /voice/incoming und /voice/outbound ist entfernt)
//               und fuegt VIER NEUE Eintraege hinzu (check-setup.js,
//               al-p10b-lookup.test.js, boot-failclosed.test.js,
//               media-token.test.js): dieselbe reine-Loeschung-verschiebt-
//               Meldungstext-Begruendung wie bei IE6-S1, keine neue Schuld.
//               Gemessen mit dem echten eslint-Aufruf (--suppressions-location
//               eslint-suppressions.empty.json).
//   2026-09-14  Pin nachgezogen (IEL-B4a, persistierter Brueckenzustand des
//               EL-Inbound-Wegs): src/store/pg.js makePgStore 584 -> 585
//               Zeilen - GENAU EINE Spread-Zeile (brueckenZustandMutatoren,
//               Wrapper-Paritaet zu json.js). rowToCall/callRowValues
//               UNVERAENDERT (38/39) - die drei neuen Spalten gehen ueber
//               Modul-Ebene-Spread-Helfer. Gemessen mit dem echten
//               eslint-Aufruf (--suppressions-location
//               eslint-suppressions.empty.json --format json).
//   2026-09-15  Pin nachgezogen (IEL-B5, Status-Callback und Beenden fuer
//               ueberbrueckte Inbound-Beine): src/routes/voice.js makeVoiceRoutes
//               227 -> 229 Zeilen, /voice/status-Handler complexity 12 -> 13
//               (GEBUNDEN-Weiche -> startInboundNachlauf); src/routes/api-calls.js
//               makeCallRoutes 221 -> 224 Zeilen (cancel_call ueber
//               endeSchreiberFuer + hangUpForCall). Keine neue Regel-Kategorie.
//               Gemessen mit dem echten eslint-Aufruf (--suppressions-location
//               eslint-suppressions.empty.json --format json).
//   2026-09-15  Pin gesenkt (IEL-B8, Rueckfall-Routen und Inbound-Weiche):
//               src/routes/voice.js makeVoiceRoutes 229 -> 228 Zeilen,
//               /voice/status-Handler complexity 13 -> 12 (ANGENOMMEN_STATUS),
//               no-magic-numbers 200 entfaellt (HTTP_OK). Neue Logik auf
//               Modul-Ebene bzw. in src/elevenlabs/inbound-rueckfall.js, keine
//               neue Regel-Kategorie. Gemessen mit dem echten eslint-Aufruf
//               (--suppressions-location eslint-suppressions.empty.json --format json).
//   2026-09-15  Pin angehoben (IEX-A2, Fehlersatz statt Budget-Rueckfall):
//               src/telephony/call-finish.js finishCall complexity 21 -> 22 -
//               GENAU EIN neuer Zweig (uebergabeGescheitert -> Logzeile, return),
//               im Umsetzungsplan IEX-A2 (2.10) vorgesehen. Keine neue
//               Regel-Kategorie. Gemessen mit dem echten eslint-Aufruf
//               (--suppressions-location eslint-suppressions.empty.json --format json).
//   2026-09-15  Pin angehoben (IEX-A8, Registrierungs-Beleg am Nummern-Datensatz):
//               src/store/pg.js makePgStore 585 -> 586 Zeilen - GENAU EINE
//               Spread-Zeile (inboundTrunkBelegMutatoren, Wrapper-Paritaet zu
//               json.js), im Umsetzungsplan IEX-A8 (2.5) vorgesehen. rowToNumber/
//               flushNumbers ohne neue Verzweigung, hydrateTenantInto UNVERAENDERT
//               (103). Keine neue Regel-Kategorie. Gemessen mit dem echten
//               eslint-Aufruf (--suppressions-location eslint-suppressions.empty.json --format json).
//   2026-09-15  Pin angehoben (IEX-A10, Inbound-Trunk fuer neue Nummern im Onboarding):
//               src/worker/provisioning-orchestrator.js makeProvisioningOrchestrator
//               171 -> 172 Zeilen - GENAU EINE Zeile, die Injektion des
//               Inbound-Trunk-Schreibers neben dem Registrar (EIN Gate je Schreibweg,
//               kein Inline-Nachbau), im Umsetzungsplan IEX-A10 (2.5) vorgesehen.
//               id-length/no-negated-condition UNVERAENDERT, keine neue Regel-Kategorie.
//               Gemessen mit dem echten eslint-Aufruf (--suppressions-location
//               eslint-suppressions.empty.json --format json).
//   2026-09-20  Pin bewegt (P2, Registrierweg vereinheitlicht: T-18/T-22): src/mcp-tools.js
//               verliert seinen EINZIGEN max-params-Befund (die 4-Parameter-Arrow des
//               entfernten tool()-Helfers) ersatzlos, registerTools waechst 506 -> 509
//               Zeilen (die zwei migrierten Werkzeuge cancel_call/list_action_items tragen
//               als uiTool()-Aufruf je ein Klammer-/description-Feld mehr). Keine neue
//               Regel-Kategorie, kein neuer Eintrag. Gemessen mit dem echten eslint-Aufruf
//               (--suppressions-location eslint-suppressions.empty.json --format json).
//   2026-09-21  Pin gesenkt (P5a, O-13 Teil 1, Datenminimierung im Output): src/mcp-tools.js
//               verliert voiceEngine/model aus dem get_agent_status-Textblock (zwei Zeilen
//               zu einer verschmolzen), registerTools schrumpft 509 -> 508 Zeilen. Keine
//               neue Regel-Kategorie, kein neuer Eintrag. Gemessen mit dem echten
//               eslint-Aufruf (--suppressions-location eslint-suppressions.empty.json
//               --format json).
const LEGACY_FINGERPRINT = {
  "src/store/state-ops.js": {
    "reason": "Echte Schuld, kein Fehlschnitt der Regel. Das Aufraeumen ist ein eigenes Refactoring des Zustandsmoduls und nicht Teil der ElevenLabs-Migration. PIN ANGEHOBEN 2026-08-19 (Thema A): createCall 12 -> 14 Komplexitaet (openingLine-Feld + Hash-Bedingung). Geprueft und bewusst uebernommen; das Aufraeumen bleibt das eigene Refactoring des Zustandsmoduls (s.o.). KV2-2 GEPRUEFT, KEINE Anhebung: costProfile: null, ist eine reine Zuweisung ohne Operator (Muster sipCallId) - createCall bleibt bei Komplexitaet 14. Gemessen mit `npx eslint src/store/state-ops.js --suppressions-location eslint-suppressions.empty.json`. PIN ANGEHOBEN 2026-08-31 (KV2-3): id-length 's' 180 -> 183 - die drei neuen Store-Operationen des Kosten-Buchs (findCostEvidence/recordCallCostEvidence/callCostEvidence) nennen ihren Zustands-Parameter 's', dieselbe Konvention wie jede bestehende state-ops-Funktion in dieser Datei. Keine weitere Kategorie bewegt sich (kein neues no-param-reassign: die Reifung mutiert 'vorhanden', eine lokale Variable aus .find(), keinen Funktionsparameter). Gemessen mit `npx eslint src/store/state-ops.js --suppressions-location eslint-suppressions.empty.json`. PIN ANGEHOBEN 2026-09-06 (P2, gestaffelter EL-Rueckfrage-Halt): id-length 'c' 15 -> 17 und 's' 183 -> 187 (die drei neuen Operationen markConsultAskDelivered/ackConsult/timeOutStagedConsult sowie der extrahierte reine Leser openConsultFor nennen Call/Zustand nach derselben Konvention 'c'/'s'); id-length 'o' 0 -> 1 (der verkuerzte Reject-Parameter 'o' in answerConsult's lokaler reject-Funktion, s. openConsultFor-Refactor). Keine neue Regel-Kategorie. Gemessen mit `npx eslint src/store/state-ops.js --suppressions-location eslint-suppressions.empty.json`. PIN GESENKT 2026-09-14 (IE6-S1): id-length 'c' 17 -> 16, 's' 187 -> 185, no-restricted-syntax (G36) 12 -> 11 - getCallByControlId und dropLastAgentTranscript (beide Assistant-Shim-Schreibwege) sind entfernt. Gemessen mit `npx eslint src/store/state-ops.js --suppressions-location eslint-suppressions.empty.json`. ZAHL KORRIGIERT 2026-09-18 (E3, Anruf-Idempotenz): id-length 's' 185 -> 186, no-param-reassign 's' 17 -> 18 - die neue Funktion releaseOutboundReserveCents (zweiter Freigabeweg fuer den Fall OHNE Anruf-Datensatz, Dedup/Fehlerklammer vor createCall) nennt ihren Zustands-Parameter 's' nach derselben Konvention wie jede bestehende state-ops-Funktion und mutiert s.reservations wie tryReserveOutboundBudget/releaseOutboundReserve. Keine weitere Kategorie bewegt sich. Gemessen mit `node scripts/check-staged-suppressions.js src/store/state-ops.js` gegen die vorgemerkte Fassung.",
    "date": "2026-08-13",
    "findings": {
      "complexity :: Function 'createCall' has a complexity of 14. Maximum allowed is 10.": 1,
      "complexity :: Function 'setTenantSubscription' has a complexity of 14. Maximum allowed is 10.": 1,
      "complexity :: Function 'tenantSubscription' has a complexity of 17. Maximum allowed is 10.": 1,
      "id-length :: Identifier name 'a' is too short (< 2).": 8,
      "id-length :: Identifier name 'b' is too short (< 2).": 3,
      "id-length :: Identifier name 'c' is too short (< 2).": 16,
      "id-length :: Identifier name 'e' is too short (< 2).": 10,
      "id-length :: Identifier name 'n' is too short (< 2).": 11,
      "id-length :: Identifier name 'o' is too short (< 2).": 1,
      "id-length :: Identifier name 'q' is too short (< 2).": 1,
      "id-length :: Identifier name 'r' is too short (< 2).": 4,
      "id-length :: Identifier name 's' is too short (< 2).": 186,
      "id-length :: Identifier name 't' is too short (< 2).": 9,
      "max-params :: Function 'addActionItem' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'addNotification' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'addResearchFeeCostCents' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'addTranscript' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'addVoiceUsageCostCents' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'applyCostCorrectionCents' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'bootstrapTenant' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'budgetExceeded' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'bumpPlatformTtsQuota' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'findConflict' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'gateUsageCents' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'liveBudgetExceeded' has too many parameters (5). Maximum allowed is 3.": 1,
      "max-params :: Function 'markProvisioningJob' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'recordTtsCharacters' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'reserveExceedsBudget' has too many parameters (5). Maximum allowed is 3.": 1,
      "max-params :: Function 'seedBootstrapNumber' has too many parameters (6). Maximum allowed is 3.": 1,
      "max-params :: Function 'seedBootstrapNumberFromConfig' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'setCallEndedAt' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'tenantBudgetSnapshot' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'tenantSpendOrDeny' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'tenantUsageAxes' has too many parameters (4). Maximum allowed is 3.": 1,
      "max-params :: Function 'trackUsage' has too many parameters (5). Maximum allowed is 3.": 1,
      "max-params :: Function 'tryReserveOutboundBudget' has too many parameters (5). Maximum allowed is 3.": 1,
      "no-magic-numbers :: No magic number: 1000.": 1,
      "no-magic-numbers :: No magic number: 16.": 1,
      "no-magic-numbers :: No magic number: 2.": 2,
      "no-magic-numbers :: No magic number: 24.": 1,
      "no-magic-numbers :: No magic number: 36.": 2,
      "no-magic-numbers :: No magic number: 6.": 1,
      "no-magic-numbers :: No magic number: 60.": 2,
      "no-negated-condition :: Unexpected negated condition.": 1,
      "no-param-reassign :: Assignment to property of function parameter 'call'.": 3,
      "no-param-reassign :: Assignment to property of function parameter 's'.": 18,
      "no-param-reassign :: Assignment to property of function parameter 'tenant'.": 6,
      "no-param-reassign :: Assignment to property of function parameter 'usage'.": 6,
      "no-restricted-syntax :: Aufrufkette zu tief (mehr als 4 verkettete Zugriffe) - Gesetz von Demeter (G36)": 11
    }
  },
  "src/billing/webhook.js": {
    "reason": "NEUER Eintrag 2026-09-08 (FW1), Eigentuemer-Freigabe erteilt. Anlass ist eine VERBESSERUNG, keine Verschlechterung: applyStripeWebhook faellt von complexity 32 auf 29, weil FW1 zwei Verzweigungsblocks aus der Riesenfunktion herausgezogen hat (resolveExistingTenant + unresolvedTenantDetail, die gemeinsame Tenant-Aufloesung samt Existenz-Gate fuer beide Webhook-Zweige). Das Gate blockt trotzdem, und zwar zu Recht: es meldet JEDE Bewegung der Befundmenge, auch die nach unten - ein zu hoch stehender Pin waere genau der Spielraum, in dem spaeter ein neuer Verstoss unbemerkt Platz faende (dieselbe Begruendung wie im pg.js-Eintrag). Warum die Datei liegen bleibt statt aufgeraeumt zu werden: applyStripeWebhook ist der Stripe-GELD-Pfad (Aktivierung, Suspend, Kuendigungsvormerk, Geld-Ereignisse). Ein G30-Split dieser Funktion ist ein eigener Umbau mit eigenem Review im Geld-Pfad und deutlich groesser als FW1 selbst; ihn als Nebeneffekt eines Webhook-Haertungs-Commits mitzunehmen waere genau die Sorte Scope-Drift, die dieses Repo verbietet. interpretStripeEvent (21) und die drei id-length-Befunde sind unveraendert vorbestehend - FW1 hat sie weder erzeugt noch bewegt. Gemessen mit `npx eslint src/billing/webhook.js --suppressions-location eslint-suppressions.empty.json --format json`. Geprueft und bewusst uebernommen statt stillschweigend. PIN GESENKT 2026-09-11 (GP-P2): applyStripeWebhook 29 -> 25 Komplexitaet. Der Karten-Bindezweig des Race-Fixes ist als eigene Funktion herausgezogen (bindPaymentMethodFromEventIfMissing) - seine drei Bedingungen zaehlen nicht mehr in der Orchestrierungs-Funktion. Gesenkt, nicht stehen gelassen: ein zu hoch stehender Pin ist der Spielraum, in dem spaeter ein neuer Verstoss unbemerkt Platz faende.",
    "date": "2026-09-08",
    "findings": {
      "complexity :: Async function 'applyStripeWebhook' has a complexity of 25. Maximum allowed is 10.": 1,
      "complexity :: Function 'interpretStripeEvent' has a complexity of 21. Maximum allowed is 10.": 1,
      "id-length :: Identifier name 'a' is too short (< 2).": 1,
      "id-length :: Identifier name 'b' is too short (< 2).": 1,
      "id-length :: Identifier name 'e' is too short (< 2).": 1
    }
  },
  "src/store/pg.js": {
    "reason": "Echte Schuld, kein Fehlschnitt der Regel. makePgStore mit 448 Zeilen ist ein eigener Umbau und nicht Teil der ElevenLabs-Migration. PIN ANGEHOBEN 2026-08-15 (answeredUnclearReason): makePgStore 462 -> 472 Zeilen, rowToCall 21 -> 22, flushCalls 22 -> 23. Unvermeidbar, solange der Split ausgesetzt ist - ein neues persistiertes Feld MUSS durch Zeilen-Mapper und Flush, und beide sind Teil derselben Riesenfunktion. Genau deshalb waechst diese Datei mit jedem Feld weiter; erst der Split stoppt das. Angehoben, nicht stillschweigend: der Pin hat die Verschlechterung gemeldet, sie ist geprueft und bewusst uebernommen. DRITTE ANHEBUNG 2026-08-15/16 (sieben Felder aus ABNAHME-D1): flushCalls 23 -> 30, rowToCall 22 -> 29, makePgStore 472 -> 482. DAMIT IST DIE WACHSTUMSRATE GEMESSEN: jedes persistierte Anruf-Feld kostet +1 Komplexitaet in flushCalls UND in rowToCall sowie rund 1,4 Zeilen in makePgStore - linear, ohne Obergrenze. Die Anhebungen sind einzeln begruendet und keine Nachlaessigkeit (ein Feld MUSS durch Mapper und Flush), aber die Kurve ist jetzt belegt statt behauptet. Wer das stoppen will, hat zwei Wege: den Split von makePgStore (bisher ausgesetzt) oder die Ablage der eingesammelten Ergebnis-Angaben als EINE strukturierte Spalte statt N Einzelspalten - letzteres entspraeche auch der Form des Anbieters (data_collection_results ist eine Karte) und machte kuenftige Felder kostenlos. Beides ist eine Eigentuemer-Entscheidung, kein Nebeneffekt eines Commits. VIERTE ANHEBUNG 2026-08-17 (sipCallId, der Join-Schluessel zum Telnyx-Beleg): rowToCall 29 -> 30 und makePgStore 482 -> 487 Zeilen - beides genau die Kurve, die der Eintrag darueber VORHERGESAGT hat (+1 Komplexitaet je persistiertem Feld), also eine Bestaetigung der Messung und keine neue Ueberraschung. NEU ist die dritte Bewegung: flushCalls (Komplexitaet 30) ist WEG, dafuer ist callRowValues (30) da. Die Funktion stand exakt auf der 100-Zeilen-Grenze; jede weitere Spalte haette sie gerissen, also wurde die 50er-Werteliste als eigene Funktion herausgezogen (reiner Move, die 49 Altwerte maschinell als byte-identisch und gleich geordnet verifiziert). EHRLICH BENANNT: der Split hat die ZEILEN-Grenze gerettet, nicht die Verzweigung reduziert - die Komplexitaet ist verschoben, nicht verschwunden. Vier Befunde vorher, vier nachher, keine neue Regel-Kategorie. Die zwei Auswege oben gelten unveraendert und werden mit jeder Anhebung dringender. FUENFTE ANHEBUNG 2026-08-19 (Thema A+B: opening_line, opening_line_sha256, lookup_log): callRowValues 30 -> 32, rowToCall 30 -> 32 - exakt die gemessene Kurve (+1 je persistiertem Feld, s.o.). Geprueft und bewusst uebernommen; die zwei Auswege oben gelten unveraendert. SECHSTE ANHEBUNG 2026-08-19 (Thema B, lookup_log): callRowValues 32 -> 33, rowToCall 32 -> 33, makePgStore 487 -> 497 - dieselbe gemessene Kurve (+1 je persistiertem Feld). Geprueft und bewusst uebernommen; die zwei Auswege oben gelten unveraendert. PIN ANGEHOBEN 2026-08-19 (EL-Cutover-Merge upstream/master <-> EL-Kette): Block wortgleich vom Hook uebernommen. PIN ANGEHOBEN 2026-08-21 (INBOX-P2): makePgStore 557 -> 562 Zeilen durch den takeInboxEntries-Wrapper (Wrapper-Parity zu json.js, R-3) - dieselbe Riesenfunktion, solange der Split aussteht (s.o.). Vom Hook selbst gemeldet und uebernommen, keine neue Regel-Kategorie. PIN GESENKT 2026-08-29 (OUTBOUND-E5, F3): hydrateTenantInto 117 -> 102 Zeilen. Der Number-Hydrierungs-Block (18 Zeilen Inline-Map) ist als eigene Modul-Funktion rowToNumber herausgeloest (Konvention wie rowToTenant/rowToCall/rowToNotification/rowToCalendarEvent - der Inline-Map der Nummern war der einzige Ausreisser). Der Schnitt senkt die Zeilengrenze, reisst sie aber NICHT: 102 bleibt ueber 100, weil derselbe Umbau zugleich die neue Spalte provider_agent_phone_number_id einfuehrt (+1 SELECT-Feld, +1 Kommentarzeile, +4 Zeilen rowToNumber-Aufruf/Kommentar in hydrateTenantInto selbst) - netto -15 statt der urspruenglich erwarteten -17. Gemessen mit `npx eslint --suppressions-location eslint-suppressions.empty.json --format json src/store/pg.js`, kein Wert an DIESER Funktion angehoben, nur gesenkt (makePgStores minimale Anhebung steht separat unten, ehrlich benannt statt verschwiegen). rowToCall/callRowValues/rowToTenant/flushTenants UNVERAENDERT (36/36/32/33) - die drei neuen Absender-Wahrheits-SPALTEN gehen ueber Modul-Ebene-Spread-Helfer (absenderWahrheitFelder/absenderWahrheitWerte) rein, nicht ueber zusaetzliche Verzweigungen in den gepinnten Funktionen selbst. makePgStore 562 -> 563 (EINE Zeile, PIN ANGEHOBEN, ehrlich gemessen statt verschwiegen): die zwei neuen Store-METHODEN (recordFromRegistrationSource/recordActualSender) sind aus demselben Grund als Modul-Ebene-Spread-Fabrik (absenderWahrheitMutatoren) statt zweier ausgeschriebener Methoden gebaut - ohne den Spread waeren es netto ca. 8 Zeilen mehr gewesen, mit ihm bleibt genau die eine Spread-Zeile, die sich nicht wegkuerzen laesst. Dieselbe seit 2026-08-15 gemessene, dokumentierte Kurve wie jede vorige Anhebung oben (jedes neue persistierte Feld/jede neue Methode kostet makePgStore ein paar Zeilen) - keine neue Ueberraschung, kein Nebeneffekt eines Commits, sondern dieselbe lineare Wachstumsrate, hier auf ein Minimum gedrueckt. Gemessen mit `npx eslint --suppressions-location eslint-suppressions.empty.json --format json src/store/pg.js`. id-length 'r' 23 -> 24 (der neue Parameter der ausgelagerten rowToNumber-Funktion). PIN ANGEHOBEN 2026-08-31 (KV2-2): rowToCall 36 -> 37 und callRowValues 36 -> 37 Komplexitaet (je ein zusaetzliches ??-Fallback fuer die neue Spalte cost_profile), makePgStore 563 -> 568 Zeilen (der neue Mutator recordCostProfile, Wrapper-Paritaet zu json.js). Dieselbe seit 2026-08-15 gemessene, dokumentierte Kurve wie jede vorige Anhebung oben (jedes neue persistierte Feld kostet makePgStore/rowToCall/callRowValues ein paar Zeilen bzw. einen Verzweigungspunkt) - keine neue Ueberraschung. Gemessen mit `npx eslint src/store/pg.js --suppressions-location eslint-suppressions.empty.json --format json`. Geprueft und bewusst uebernommen statt stillschweigend. PIN ANGEHOBEN 2026-08-31 (KV2-3): hydrateTenantInto 102 -> 103 Zeilen (EINE Zeile, der Push in den callCostEvidence-Spiegel), makePgStore 568 -> 576 Zeilen (zwei neue Store-METHODEN, recordCallCostEvidence/callCostEvidence, Wrapper-Paritaet zu json.js, Muster recordCostProfile). Dieselbe seit 2026-08-15 gemessene, dokumentierte Kurve wie jede vorige Anhebung oben - keine neue Ueberraschung. Die neue Hilfsfunktion hydrateCallCostEvidence und der neue Flush flushCallCostEvidence liegen JEWEILS unter der Zeilengrenze und tragen selbst keinen Befund. Gemessen mit `npx eslint src/store/pg.js --suppressions-location eslint-suppressions.empty.json --format json`. PIN ANGEHOBEN 2026-09-06 (P2, gestaffelter EL-Rueckfrage-Halt): makePgStore 576 -> 591 Zeilen (drei neue Store-METHODEN, markConsultAskDelivered/ackConsult/timeOutStagedConsult, Wrapper-Paritaet zu json.js, Muster recordCostProfile). Dieselbe seit 2026-08-15 gemessene, dokumentierte Kurve wie jede vorige Anhebung oben. hydrateTenantInto UNVERAENDERT (103) - die neuen Methoden liegen nicht in der Hydrierung. Gemessen mit `npx eslint src/store/pg.js --suppressions-location eslint-suppressions.empty.json --format json`. PIN ANGEHOBEN 2026-09-08 (SEC-P1): rowToCall 37 -> 38 und callRowValues 37 -> 39 Komplexitaet, makePgStore 591 -> 596 Zeilen - die neue Spalte webhook_anchors (Ereignis-Anker des Wiederholungs-Riegels) MUSS durch Zeilen-Mapper, Werteliste UND Flush, und der Wrapper recordWebhookAnchors (Wrapper-Paritaet zu json.js, Muster markBilled) liegt in derselben Riesenfunktion. callRowValues bewegt sich um ZWEI statt einen Punkt, weil der Wert zwei Verzweigungen traegt (Optional-Chaining auf die Liste plus der Leer-Zweig, der NULL statt einer leeren Liste schreibt). Dieselbe seit 2026-08-15 gemessene, dokumentierte Kurve wie jede vorige Anhebung oben - keine neue Regel-Kategorie, kein neuer Verstosstyp. Gemessen mit `node scripts/check-staged-suppressions.js` gegen die vorgemerkte Fassung. Geprueft und bewusst uebernommen statt stillschweigend. FW1, Eigentuemer-Freigabe erteilt): makePgStore 591 -> 592 Zeilen - GENAU EINE Wrapper-Zeile fuer die neue Store-Methode tenantExists (Backend-Paritaet zu json.js, Muster recordCostProfile). Das Existenz-Praedikat gehoert auf die Fassade, weil der Stripe-Webhook einen metadata.tenant_ref pruefen muss, den es in dieser Datenbank nicht (mehr) gibt; ohne Fassaden-Methode waere die Alternative ein direkter state-ops-Zugriff am Store vorbei - schlechtere Trennung fuer denselben Zeilengewinn. Dieselbe seit 2026-08-15 gemessene, dokumentierte Kurve wie jede vorige Anhebung oben (jede neue Store-Methode kostet makePgStore ein paar Zeilen); die zwei Auswege (Split von makePgStore, strukturierte Spalte) gelten unveraendert. rowToCall/callRowValues/rowToTenant/flushTenants/hydrateTenantInto UNVERAENDERT - tenantExists ist eine reine Query ohne Mapper- oder Flush-Anteil. Gemessen mit `npx eslint src/store/pg.js --suppressions-location eslint-suppressions.empty.json --format json`. PIN ANGEHOBEN 2026-09-11 (GP-P2, stripe_payment_method_type): flushTenants 33 -> 34 und rowToTenant 32 -> 33. Genau die seit 2026-08-15 gemessene und oben vorhergesagte Kurve (+1 Komplexitaet je persistiertem Feld in Mapper UND Flush) - eine additive Spalte MUSS durch beide, sonst loescht der naechste Flush sie (I8-Lehre). Kein neuer Regel-Typ, keine neue Funktion ueber eine Grenze; callRowValues/rowToCall/hydrateTenantInto/makePgStore UNVERAENDERT (das neue Feld ist ein Tenant-Feld, kein Anruf-Feld). Die zwei Auswege (Split von makePgStore, strukturierte Spalte) gelten unveraendert. PIN GESENKT 2026-09-14 (IE6-S1): makePgStore 597 -> 584 Zeilen - getCallByControlId, attachActiveCallByControlId, dropLastAgentTranscript (Wrapper) und recordTelnyxConversationId (Wrapper) sind entfernt (Assistant-Shim-Schreibwege). rowToCall/callRowValues/rowToTenant/flushTenants/hydrateTenantInto UNVERAENDERT. Gemessen mit `npx eslint src/store/pg.js --suppressions-location eslint-suppressions.empty.json --format json`. PIN ANGEHOBEN 2026-09-14 (IEL-B4a): makePgStore 584 -> 585 Zeilen - GENAU EINE Spread-Zeile (brueckenZustandMutatoren, Wrapper-Paritaet zu json.js fuer bindInboundElConversation/markInboundElFallback/markInboundElNachlaufStarted). rowToCall/callRowValues UNVERAENDERT (38/39): die drei neuen Spalten el_bound_at/el_fallback_at/el_nachlauf_started_at gehen ueber Modul-Ebene-Spread-Helfer (brueckenZustandFelder/-Werte). Gemessen mit `npx eslint src/store/pg.js --suppressions-location eslint-suppressions.empty.json --format json`. PIN ANGEHOBEN 2026-09-15 (IEX-A8): makePgStore 585 -> 586 Zeilen - GENAU EINE Spread-Zeile (inboundTrunkBelegMutatoren, Wrapper-Paritaet zu json.js). rowToNumber/flushNumbers ohne neue Verzweigung (Spread-Helfer inboundTrunkBelegFelder/-Werte), hydrateTenantInto UNVERAENDERT (103, SELECT in derselben Zeile). Die Save-Closure ist als mitSpeichernBeiAenderung extrahiert (G5), keine neue Befundkategorie. Gemessen mit npx eslint src/store/pg.js --suppressions-location eslint-suppressions.empty.json --format json. ZAHL KORRIGIERT 2026-09-18 (E3, Anruf-Idempotenz): makePgStore 586 -> 588 Zeilen - GENAU ZWEI Wrapper-Zeilen (releaseOutboundReserveCents, Wrapper-Paritaet zu json.js fuer den zweiten Reserve-Freigabeweg ohne Anruf-Datensatz, Muster releaseOutboundReserve). rowToCall/callRowValues/rowToTenant/flushTenants/hydrateTenantInto UNVERAENDERT - die neue Methode ist eine reine Ledger-Mutation ohne Mapper- oder Flush-Anteil (reservations ist strukturell ephemer). Dieselbe seit 2026-08-15 gemessene, dokumentierte Kurve wie jede vorige Anhebung oben. Gemessen mit `node scripts/check-staged-suppressions.js src/store/pg.js` gegen die vorgemerkte Fassung.",
    "date": "2026-08-13",
    "findings": {
      "complexity :: Async function 'flushTenants' has a complexity of 34. Maximum allowed is 10.": 1,
      "complexity :: Function 'callRowValues' has a complexity of 39. Maximum allowed is 10.": 1,
      "complexity :: Function 'rowToCall' has a complexity of 38. Maximum allowed is 10.": 1,
      "complexity :: Function 'rowToTenant' has a complexity of 33. Maximum allowed is 10.": 1,
      "id-length :: Identifier name 'a' is too short (< 2).": 1,
      "id-length :: Identifier name 'b' is too short (< 2).": 2,
      "id-length :: Identifier name 'c' is too short (< 2).": 3,
      "id-length :: Identifier name 'e' is too short (< 2).": 4,
      "id-length :: Identifier name 'n' is too short (< 2).": 5,
      "id-length :: Identifier name 'r' is too short (< 2).": 24,
      "id-length :: Identifier name 's' is too short (< 2).": 1,
      "id-length :: Identifier name 't' is too short (< 2).": 2,
      "max-params :: Async function 'deleteMissing' has too many parameters (4). Maximum allowed is 3.": 1,
      "no-param-reassign :: Assignment to property of function parameter 'state'.": 3,
      "max-lines-per-function :: Async function 'hydrateTenantInto' has too many lines (103). Maximum allowed is 100.": 1,
      "max-lines-per-function :: Function 'makePgStore' has too many lines (588). Maximum allowed is 100.": 1
    }
  },
  "src/routes/api-calls.js": {
    "reason": "Eigentuemer-Entscheidung 2026-08-15. Echte Schuld, kein Fehlschnitt der Regel - aber das Aufraeumen ist der G30-Split der Outbound-Route und damit ein Umbau im Gate-Kernpfad: diese Datei traegt die Safety-Gate-Kette (Permit, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, OUTBOUND_FROZEN). Ein Entzerren verschiebt genau die Reihenfolge, in der diese Gates greifen; faellt dabei eine Pruefung durch, ruft der Dienst jemanden ungewollt an oder ueberzieht die Kostendecke. Das braucht ein eigenes Paket mit eigener Absicherung (Gate-Tests vor dem Schnitt), nicht einen Nebeneffekt dieses Commits. PIN ANGEHOBEN 2026-08-15 (S1-Nachbesserung cancel_call/S1-4, S1-5, S1-2b): makeCallRoutes 222 -> 225 Zeilen - der cancel_call-Handler traegt seither die Begruendung, warum die EL-Form (nicht die Kennung) die ehrliche Antwort entscheidet, plus das zusaetzliche hangup_attempted-Feld. Unvermeidbar, solange der G30-Split aussteht (s. reason oben) - jede Verhaltenskorrektur in diesem Handler MUSS durch dieselbe Riesenfunktion. Das Gate hat die Verschlechterung gemeldet, sie ist geprueft und bewusst uebernommen statt stillschweigend. PIN ANGEHOBEN 2026-08-19 (Thema A, Eroeffnungszeile): der Route-Arrow 22 -> 23 Komplexitaet und 118 -> 136 Zeilen, makeCallRoutes 225 -> 243 - der Erzeugungs-Block (fetchOpeningLine hinter dem EL-Schalter, vor createCall) MUSS wie Briefing/Diagnose durch dieselbe Riesenfunktion, solange der G30-Split aussteht (s.o.). Geprueft und bewusst uebernommen statt stillschweigend; der Split-Bedarf waechst damit weiter. PIN NACHGEZOGEN 2026-08-28 (OUTBOUND-E2, Regressionsfang Outbound-Ausfall 27.08.2026): complexity 23 -> 22, max-lines-per-function UNVERAENDERT (243/136). Der Anbieter-Fehlergrund wird ueber EINE ausgelagerte Modul-Funktion (recordStartRejectionReason, oberhalb dieser Riesenfunktion) persistiert statt ueber zwei Anweisungen inline - der bisherige `err?.providerStatus`-Zugriff wandert mit in den Helfer und verlaesst damit den Verzweigungs-/Zeilenzaehler von makeCallRoutes. Ergebnis: EIN neuer Aufruf im catch, aber netto keine neue Zeile (der Helfer ersetzt die bisherige `const providerStatus = err?.providerStatus;`-Zeile 1:1) und ein Optional-Chaining-Zugriff weniger in der Riesenfunktion selbst (Komplexitaet sinkt statt zu steigen). id-length/no-magic-numbers unveraendert. Gemessen mit `npx eslint src/routes/api-calls.js --suppressions-location eslint-suppressions.empty.json`. Geprueft und bewusst uebernommen statt stillschweigend. PIN ANGEHOBEN 2026-08-31 (KV2-2): makeCallRoutes 243 -> 246 Zeilen, die Async-Arrow (Outbound-Origination-Handler) 136 -> 139 Zeilen - je eine Kommentar+Aufruf-Zeile store.recordCostProfile(...) in jedem der drei Engine-Weichen-Zweige (EL, Telnyx-Assistant, TeXML). complexity/id-length/no-magic-numbers UNVERAENDERT (22/2+1/4+1+4+1+1+1). Unvermeidbar, solange der G30-Split aussteht (s. reason oben) - jede Weichen-Aenderung MUSS durch dieselbe Riesenfunktion. Gemessen mit `npx eslint src/routes/api-calls.js --suppressions-location eslint-suppressions.empty.json`. Geprueft und bewusst uebernommen statt stillschweigend. PIN ANGEHOBEN 2026-09-06 (P2, gestaffelter EL-Rueckfrage-Halt), NOCH AM SELBEN TAG WIEDER ZURUECKGENOMMEN (Review-Fix Runde 1): der urspruengliche Versuch hob den Pin auf 260 Zeilen/Komplexitaet 15 an, weil status='working' inline in der Antwort-Route behandelt wurde. Review-Blocker (CLAUDE.md verbietet neue abgeschaltete Sicherungen; das webhooks-elevenlabs.js-Vorbild consultResponseBody blieb pin-frei) - stattdessen ausgelagert: invalidConsultAnswerStatus (reine Formpruefung), ackWorkingConsult (status=WORKING) und answerConsultFinal (status=FINAL/Bestand) sind jetzt MODUL-EBENE Funktionen (wie resolveCallPrivacyFlags oben), die Route selbst ruft nur noch durch. Ergebnis: kein Komplexitaets-Befund fuer die Antwort-Route mehr (Pin-Eintrag entfaellt komplett), makeCallRoutes sinkt 260 -> 237 Zeilen (unter den vorherigen Stand von vor P2, weil auch der P2-Zuwachs mit ausgelagert wurde). no-magic-numbers 400/409 bleiben bei den durch P2 tatsaechlich hinzugekommenen Werten (5/2 - die Zahlen selbst sind unveraendert richtig, nur jetzt in ausgelagerten Funktionen statt inline). Gemessen mit `npx eslint src/routes/api-calls.js --suppressions-location eslint-suppressions.empty.json`. Geprueft und bewusst uebernommen statt stillschweigend. PIN ANGEHOBEN 2026-09-07 (P4a, Sprachparameter): complexity 22 -> 28, max-lines-per-function (Async-Arrow) 139 -> 145, makeCallRoutes 237 -> 243, no-magic-numbers:400 5 -> 7 - der Sprachwunsch-Zweig (requestedLanguage, zwei 400er-Ablehnungen unsupported_language/language_unavailable) sitzt VOR der Gate-Kette in derselben Riesenfunktion, solange der G30-Split aussteht (s. reason oben). Geprueft und bewusst uebernommen statt stillschweigend. PIN ANGEHOBEN 2026-09-08 (SEC-P1): makeVoiceRoutes 269 -> 273 Zeilen - der Wiederholungs-Riegel der zwei ungeschuetzten Webhooks wird EINMAL je Server verdrahtet (makeWebhookIdempotenz mit store + keepAliveXml, INV-7) und muss dafuer in dieselbe Riesenfunktion, solange der G30-Split aussteht (s. reason oben). complexity und no-magic-numbers UNVERAENDERT: die beiden Routen bekommen nur eine vorgeschaltete Middleware, keinen neuen Zweig im Handler - kein Gate wird beruehrt. Gemessen mit `node scripts/check-staged-suppressions.js` gegen die vorgemerkte Fassung. Geprueft und bewusst uebernommen statt stillschweigend. PIN NACHGEZOGEN 2026-09-09 (SEC-P6, Antwort statt Haenger): alle drei bewegten Werte sinken. Die Gate-Schleife wandert nach runOutboundGates (telephony/outbound-gates.js), die Ablehnungs-Senke und denialDimensions wandern auf die MODUL-EBENE dieser Datei (beobachteAblehnung/denialDimensions, Praezedenz resolveCallPrivacyFlags) - der Async-Arrow 145 -> 140 Zeilen und Komplexitaet 28 -> 26 (die for-Schleife samt verschachteltem if (denial.audit) entfaellt), makeCallRoutes 243 -> 234 Zeilen. Keine neue Regel-Kategorie, kein neuer Verstoss, id-length/no-magic-numbers unveraendert. Gemessen mit `node scripts/check-staged-suppressions.js src/routes/api-calls.js` gegen die vorgemerkte Fassung. PIN GESENKT 2026-09-14 (IE6-S1): complexity 26 -> 24, Async-Arrow 140 -> 128 Zeilen, makeCallRoutes 234 -> 221 Zeilen - der Telnyx-Assistant-Zweig (originateAiAssistantCall, KOSTENPROFIL.TELNYX_ASSISTANT) ist aus dem Engine-Weichen-Handler entfernt. id-length/no-magic-numbers UNVERAENDERT. Gemessen mit `npx eslint src/routes/api-calls.js --suppressions-location eslint-suppressions.empty.json --format json`. PIN GESENKT 2026-09-14 (IE6-S2): complexity 24 -> 23 - der TeXML-Outbound-Zweig verzweigt nicht mehr auf VOICE_ENGINE (armMaxDurationTimer wird jetzt unbedingt aufgerufen, die Realtime-Bridge ist entfernt). id-length/no-magic-numbers/max-lines-per-function UNVERAENDERT. Gemessen mit `npx eslint src/routes/api-calls.js --suppressions-location eslint-suppressions.empty.json --format json`. PIN ANGEHOBEN 2026-09-15 (IEL-B5): makeCallRoutes 221 -> 224 Zeilen - der cancel_call-Handler waehlt Terminal-Schreiber (endeSchreiberFuer mit nachlaufPolitikFuer: Carrier-Ende fuer Inbound-EL, sonst unveraendert endCallRecord) und Beende-Thunk (hangUpForCall: GEBUNDEN -> Traeger auflegen + Ergebnis sichern) ueber die EINEN geteilten Helfer, dazu der injizierte Parameter awaitAndPersistInboundElResult. Unvermeidbar, solange der G30-Split aussteht (s. reason oben). Keine neue Regel-Kategorie; complexity/Async-Arrow-Zeilen/id-length/no-magic-numbers UNVERAENDERT. Gemessen mit `npx eslint src/routes/api-calls.js --suppressions-location eslint-suppressions.empty.json --format json`. ZAHL KORRIGIERT 2026-09-18 (E3, Anruf-Idempotenz): complexity 23 -> 25, Async-Arrow 128 -> 138 Zeilen, makeCallRoutes 224 -> 234 Zeilen - Klammer und Claim (findDuplicateOutboundCall/store.createCall unter EINEM synchronen Lock-Abschnitt, die Dedup-Antwort samt zweitem Reserve-Freigabeweg, die neue Fehlerklammer mit gibReserveZurueckUndMelde) MUESSEN durch dieselbe Riesenfunktion, solange der G30-Split aussteht (s. reason oben). id-length/no-magic-numbers UNVERAENDERT (503 als benannte Konstante HTTP_SERVICE_UNAVAILABLE, kein neuer Magic-Number-Fund). Gemessen mit `node scripts/check-staged-suppressions.js src/routes/api-calls.js` gegen die vorgemerkte Fassung.",
    "date": "2026-08-15",
    "findings": {
      "complexity :: Async arrow function has a complexity of 25. Maximum allowed is 10.": 1,
      "id-length :: Identifier name 'b' is too short (< 2).": 2,
      "id-length :: Identifier name 'e' is too short (< 2).": 1,
      "max-lines-per-function :: Async arrow function has too many lines (138). Maximum allowed is 100.": 1,
      "max-lines-per-function :: Function 'makeCallRoutes' has too many lines (234). Maximum allowed is 100.": 1,
      "no-magic-numbers :: No magic number: 400.": 7,
      "no-magic-numbers :: No magic number: 403.": 1,
      "no-magic-numbers :: No magic number: 404.": 4,
      "no-magic-numbers :: No magic number: 409.": 2,
      "no-magic-numbers :: No magic number: 500.": 1,
      "no-magic-numbers :: No magic number: 502.": 1
    }
  },
  "src/telephony/call-finish.js": {
    "reason": "Eigentuemer-Entscheidung 2026-08-15. Echte Schuld, kein Fehlschnitt der Regel - aber finishCall zu entzerren beruehrt den Abrechnungs- und Zusammenfassungs-Pfad: hier wird gebucht und die Gespraechs-Zusammenfassung erzeugt. `call._finished` ist der dokumentierte Idempotenz-Marker; ihn zu ersetzen traegt Verhaltensrisiko (Doppelbuchung oder verlorene Zusammenfassung bei doppelt zugestelltem Provider-Webhook). Eigenes Paket, eigene Absicherung. PIN ANGEHOBEN 2026-08-19 (EL-Cutover-Merge upstream/master <-> EL-Kette): Block wortgleich vom Hook uebernommen. ZAHLEN KORRIGIERT 2026-08-21 (INBOX-P1 Review-Fix): finishCall riss durch die vier neuen Zeilen (INBOX-P1) ueber die max-lines-Grenze - behoben durch Auslagern des F2-Mailblocks in eigene Funktionen (sendSummaryMails/buildMailBody/sendMailToTargets/mailTimestampLabel), reine Verschiebung. Kein max-lines-Befund mehr in dieser Datei; complexity/id-length/no-magic-numbers/no-param-reassign sind dieselben BEREITS gepinnten Regeln, nur mit den durch die Verschiebung neu gemessenen Zahlen (keine neue Regel, keine neue Ausnahme). ZAHL KORRIGIERT 2026-08-28 (OUTBOUND-E3a, E-3-Mail): sendNotPlacedMail kommt als vierter Aufrufer von sendMailToTargets hinzu (Betreiber-Auftrag: EINE Nutzer-Mail bei not-placed, dieselbe Versandschleife wie die Summary-Mail). Ohne Gegenmassnahme haette JEDE zusaetzliche Aufrufstelle der Schleife den bereits gepinnten id-length-Fund fuer den kurzen Bundle-Parameter um eins weiter angehoben (Shorthand {..., t} an der Aufrufstelle zaehlt selbst als Fund). Stattdessen ist der Parameter von sendMailToTargets (und von sendNotPlacedMail selbst) auf texts umbenannt - eine reine Umbenennung, kein Verhaltenswechsel (sendSummaryMails behaelt weiterhin den eigenen, bereits gepinnten Parameter t unveraendert). Effekt: id-length 12 -> 10 (t-Anteil 7 -> 5, a und e unveraendert bei 2 bzw. 3) - WENIGER Befunde durch die Umbenennung, TROTZ eines vierten Aufrufers. Gemessen mit 'npx eslint --suppressions-location eslint-suppressions.empty.json src/telephony/call-finish.js'. complexity/no-magic-numbers/no-param-reassign unveraendert (die neue Anweisung in finishCall ist unbedingt, kein neuer Zweig). PIN ANGEHOBEN 2026-09-15 (IEX-A2): finishCall 21 -> 22. Genau EIN neuer Zweig (`uebergabeGescheitert` -> Logzeile, return) vor dem Nicht-completed-Zweig. Unvermeidbar: jede Rueckkehr aus finishCall ist ein Zweig. Logzeile und Zustandsabbildung liegen auf Modulebene. Die neue Zeile haette makeCallFinish ueber die max-lines-Grenze gehoben (100 -> 101) - ausgeglichen durch reines Formatting des sendSummaryMails-Aufrufs (Objekt-Literal auf einer Zeile statt einer Eigenschaft je Zeile), kein max-lines-Befund, keine neue Regel. id-length, no-magic-numbers und no-param-reassign bleiben unveraendert. Gemessen mit `npx eslint src/telephony/call-finish.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-08-15",
    "findings": {
      "complexity :: Async function 'finishCall' has a complexity of 22. Maximum allowed is 10.": 1,
      "id-length :: Identifier name 'a' is too short (< 2).": 2,
      "id-length :: Identifier name 'e' is too short (< 2).": 3,
      "id-length :: Identifier name 't' is too short (< 2).": 5,
      "no-magic-numbers :: No magic number: 2.": 1,
      "no-param-reassign :: Assignment to property of function parameter 'call'.": 1
    }
  },
  "src/call-result.js": {
    "reason": "ZIEL DES UMZUGS 2026-08-21 (INBOX-P2, S2-1): resultCardView kommt aus src/mcp-tools.js hierher, wo die Ergebnis-Karte definiert wird - vorher war sie modul-privat und von der REST-/Store-Seite nicht erreichbar, was zwangslaeufig eine zweite Feldliste derselben Karte ergeben haette (G5). KORRIGIERT 2026-08-21 (Runde 2, S1-A-Fix): resultCardView selbst braucht keinen Legacy-Eintrag - die Funktion liest jetzt einmal 'const card = result ?? {}' und greift danach nur noch auf card.*, damit faellt die Komplexitaet von 11 auf unter 10 (gemessen: 'npx eslint --suppressions-location eslint-suppressions.empty.json src/call-result.js' zeigt keinen resultCardView-Befund mehr). Der Umzug bringt also NUR die zwei vorbestehenden Befunde der Quelldatei mit (normalizeCallResult complexity 17, no-param-reassign) - kein neuer Eintrag fuer die Zieldatei fuer resultCardView selbst.",
    "date": "2026-08-21",
    "findings": {
      "complexity :: Function 'normalizeCallResult' has a complexity of 17. Maximum allowed is 10.": 1,
      "no-param-reassign :: Assignment to property of function parameter 'call'.": 1
    }
  },
  "src/mcp-tools.js": {
    "reason": "Eigentuemer-Entscheidung 2026-08-15. Der registerTools-Split ist ein eigenes Paket und ausdruecklich nicht Teil dieser Sitzung. PIN KORRIGIERT 2026-08-21 (INBOX-P2): resultCardView ist nach src/call-result.js umgezogen (S2-1, die Ergebnis-Karten-Whitelist gehoert zu dem Modul, das die Karte definiert). Kein Befund weniger im Bestand - derselbe Befund steht jetzt unter der Zieldatei. Keine neue Regel, keine neue Ausnahme. ZAHL KORRIGIERT 2026-08-21 (INBOX-P3): registerTools registriert mit check_inbox ein Werkzeug mehr und waechst um 20 Code-Zeilen (430 -> 450, gemessen mit 'npx eslint --suppressions-location eslint-suppressions.empty.json src/mcp-tools.js', nicht geschaetzt). Dieselbe bereits gepinnte Regel mit neu gemessener Zahl - kein neuer Eintrag, keine neue Regel, keine neue Ausnahme; alle uebrigen Befunde der Datei sind unveraendert (id-length 28, max-params 1, no-magic-numbers 7, no-restricted-syntax 18). ZAHL KORRIGIERT 2026-09-06 (P2, gestaffelter EL-Rueckfrage-Halt): registerTools waechst um 20 Zeilen (450 -> 470) - answer_consult bekommt den leichten Quittungs-Modus (status='working'/'final', Schema-Erweiterung + der working-Fruehzweig im Handler). Dieselbe bereits gepinnte Regel mit neu gemessener Zahl - kein neuer Eintrag, keine neue Regel, keine neue Ausnahme; alle uebrigen Befunde unveraendert. ZAHL KORRIGIERT 2026-09-07 (P4a, Sprachparameter): registerTools waechst um 10 Zeilen (470 -> 480) - das neue place_call.language-Feld (LANG-15 aufgehoben, F-2) bringt Schema-Eintrag samt Beschreibung. Dieselbe bereits gepinnte Regel mit neu gemessener Zahl - kein neuer Eintrag, keine neue Regel, keine neue Ausnahme; alle uebrigen Befunde unveraendert. ZAHL KORRIGIERT 2026-09-18 (E2, Tool-Metadaten): registerTools waechst um 17 Zeilen (480 -> 497) - je ein annotations-Schluessel an allen 12 Tool-Deskriptoren (P0-1); die Werte selbst liegen als Modul-Tabelle TOOL_ANNOTATIONS ausserhalb der Funktion. Dieselbe bereits gepinnte Regel mit neu gemessener Zahl - kein neuer Eintrag, keine neue Regel, keine neue Ausnahme; id-length/no-magic-numbers/no-restricted-syntax/max-params unveraendert. ZAHL KORRIGIERT 2026-09-18 (E3, Anruf-Idempotenz): registerTools waechst um 15 Zeilen (497 -> 512) - der neue benannte Zugang placeCallHop (Muster pollConsult, eigener Aufruf statt eines vierten Positions-Arguments an call()) sitzt auf Modul-Ebene NEBEN registerTools und zieht dessen Zeilenzahl trotzdem hoch, weil er innerhalb der Funktion definiert wird; dazu die drei neuen Zeilen im place_call-Handler (deduplicated-Feld, Dedup-Hinweis-Array). Dieselbe bereits gepinnte Regel mit neu gemessener Zahl - kein neuer Eintrag, keine neue Regel, keine neue Ausnahme; id-length/no-magic-numbers/no-restricted-syntax/max-params unveraendert. ZAHL KORRIGIERT 2026-09-20 (P1, N-11): die await_call_event-Beschreibung ist als Modulkonstante ausgelagert (Muster PLACE_CALL_DESCRIPTION), registerTools schrumpft von 512 auf 506 Zeilen. Dieselbe bereits gepinnte Regel mit neu gemessener Zahl - kein neuer Eintrag, keine neue Regel, keine neue Ausnahme. ZAHL KORRIGIERT 2026-09-20 (P2, Registrierweg vereinheitlicht): der Legacy-Registrierweg tool()/server.tool() ist entfernt (T-18/T-22), cancel_call und list_action_items laufen jetzt ueber uiTool()/registerTool() wie alle uebrigen zehn Werkzeuge. Damit entfaellt der EINZIGE max-params-Befund der Datei (die 4-Parameter-Arrow des tool()-Helfers) ersatzlos - kein neuer Eintrag an anderer Stelle. registerTools waechst um 3 Zeilen (506 -> 509): die zwei migrierten Werkzeuge tragen als uiTool()-Aufruf je ein Klammer-/description-Feld mehr als der kompaktere tool()-Aufruf. id-length/no-magic-numbers/no-restricted-syntax unveraendert. Gemessen mit 'npx eslint --suppressions-location eslint-suppressions.empty.json src/mcp-tools.js --format json', nicht geschaetzt. ZAHL KORRIGIERT 2026-09-21 (P5a, O-13 Teil 1): voiceEngine/model verschwinden aus dem get_agent_status-Textblock (zwei Zeilen zu einer verschmolzen), registerTools schrumpft von 509 auf 508 Zeilen. Dieselbe bereits gepinnte Regel mit neu gemessener Zahl - kein neuer Eintrag, keine neue Regel, keine neue Ausnahme; id-length/no-magic-numbers/no-restricted-syntax unveraendert.",
    "date": "2026-08-15",
    "findings": {
      "id-length :: Identifier name 'A' is too short (< 2).": 1,
      "id-length :: Identifier name 'a' is too short (< 2).": 2,
      "id-length :: Identifier name 'c' is too short (< 2).": 8,
      "id-length :: Identifier name 'e' is too short (< 2).": 4,
      "id-length :: Identifier name 'r' is too short (< 2).": 2,
      "id-length :: Identifier name 's' is too short (< 2).": 9,
      "id-length :: Identifier name 't' is too short (< 2).": 1,
      "id-length :: Identifier name 'v' is too short (< 2).": 1,
      "no-magic-numbers :: No magic number: 1000.": 1,
      "no-magic-numbers :: No magic number: 2.": 6,
      "no-restricted-syntax :: Aufrufkette zu tief (mehr als 4 verkettete Zugriffe) - Gesetz von Demeter (G36)": 18,
      "max-lines-per-function :: Function 'registerTools' has too many lines (508). Maximum allowed is 100.": 1
    }
  },
  "src/worker/provisioning-orchestrator.js": {
    "reason": "Owner-Auftrag 2026-08-29 (OUTBOUND-E5 Rest, Blocker 4+5): der Provisioning-Orchestrator baute das Dreifach-Gate um den EINZIGEN kostenpflichtigen Anbieter-Schreibzugriff dieser Etappe (die ElevenLabs-SIP-Registrierung) inline noch einmal nach, statt die bereits vorhandene sipRegistrarWennAktiv(config) aus elevenlabs/nummern-registrierung.js zu rufen - die vier Gate-Tests in test/e5-01-sipregistrar-produktionspfad.test.js pruefen seither eine Funktion, die der Produktionspfad gar nicht aufrief. FIX: Inline-Gate und den makeElSipRegistrar-Import geloescht, runProvisioningDrain ruft jetzt sipRegistrarWennAktiv(config) - EIN Bauplatz statt zweier, wie der Kommentar der Funktion es schon behauptete. NEBENWIRKUNG AUF DEN LINT-BEFUND: makeProvisioningOrchestrator sinkt 180 -> 171 Zeilen (die geloeschten 14 Inline-Zeilen minus die eine neue Aufrufzeile plus laengerer Kommentar) - eine ECHTE Verbesserung, bleibt aber ueber der 100-Zeilen-Grenze. Diese Datei war vorher NICHT auf der Altlast-Liste (nur ueber eslint-suppressions.json grob-suppressed, das dort NUR pro Regel zaehlt, nicht pro Meldungstext) - der geaenderte Meldungstext (180 -> 171) zaehlt fuer scripts/check-staged-suppressions.js trotzdem als Bewegung und braucht deshalb jetzt diesen Eintrag, obwohl kein neuer Verstoss entstanden ist. Ein tieferer Umbau (die Fabrik unter 100 Zeilen bringen, Aufteilung in mehrere Module) ist ein eigener, hier bewusst NICHT gezogener Schnitt - dieser Fix loest nur die gemeldeten drei Punkte. id-length (s/e/r) und no-negated-condition sind unveraendert (10 Vorkommen vorher als EIN Regel-Zaehler in eslint-suppressions.json, hier jetzt nach Meldungstext aufgeschluesselt: 4x 's', 4x 'e', 2x 'r' - macht zusammen 10 - plus 1x no-negated-condition, alles unveraendert gegenueber vor dem Fix, keine neue Regel-Kategorie). Gemessen mit 'npx eslint src/worker/provisioning-orchestrator.js --suppressions-location eslint-suppressions.empty.json --format json'. PIN ANGEHOBEN 2026-09-15 (IEX-A10): makeProvisioningOrchestrator 171 -> 172 - GENAU EINE Zeile, die Injektion des Inbound-Trunk-Schreibers neben dem Registrar (EIN Gate je Schreibweg, kein Inline-Nachbau). id-length/no-negated-condition unveraendert. Gemessen mit 'npx eslint src/worker/provisioning-orchestrator.js --suppressions-location eslint-suppressions.empty.json --format json'.",
    "date": "2026-08-29",
    "findings": {
      "id-length :: Identifier name 'e' is too short (< 2).": 4,
      "id-length :: Identifier name 'r' is too short (< 2).": 2,
      "id-length :: Identifier name 's' is too short (< 2).": 4,
      "max-lines-per-function :: Function 'makeProvisioningOrchestrator' has too many lines (172). Maximum allowed is 100.": 1,
      "no-negated-condition :: Unexpected negated condition.": 1
    }
  },
  "src/routes/voice.js": {
    "reason": "Echte Schuld, kein Fehlschnitt der Regel - dieselbe Klasse wie api-calls.js: diese Datei traegt die Provider-Signaturpruefung (Regel 3) und die Offenlegungs-Textpfade (Regel 2, Modulkopf nennt sie ausdruecklich das HOECHSTE EINZEL-RISIKO der server.js-Decomposition). Ein Entzerren von makeVoiceRoutes ist ein eigener G30-Split im Safety-Gate-Kernpfad, kein Nebeneffekt eines Commits. PIN ANGEHOBEN 2026-08-31 (KV2-2): makeVoiceRoutes 267 -> 269 Zeilen - je eine store.recordCostProfile(...)-Zeile in den beiden Inbound-Engine-Weichen-Zweigen (budget/realtime, Kriterium (c) aus tasks/kostenv2/spec-kv2-2.md). Unvermeidbar, solange der G30-Split aussteht: jede Weichen-Aenderung MUSS durch dieselbe Riesenfunktion. complexity/no-magic-numbers UNVERAENDERT. Gemessen mit `npx eslint src/routes/voice.js --suppressions-location eslint-suppressions.empty.json --format json`. Geprueft und bewusst uebernommen statt stillschweigend. PIN ANGEHOBEN 2026-09-07 (FW2): makeVoiceRoutes 269 -> 270 Zeilen - eine Zeile im /voice/turn-Catch ruft noteLlmBillingOutage (Guthaben-Alarm+Latch, EINE Quelle mit dem Assistant-Weg, s. src/llm-billing-outage.js) auf, VOR der unveraenderten Degradation. Unvermeidbar aus demselben Grund wie oben: die Aenderung MUSS durch dieselbe Riesenfunktion, solange der G30-Split aussteht. complexity/no-magic-numbers UNVERAENDERT. Gemessen mit demselben Befehl. Geprueft und bewusst uebernommen statt stillschweigend. PIN ANGEHOBEN 2026-09-13 (IE7): makeVoiceRoutes 274 -> 279 Zeilen - der GET /voice/tts/:token-Handler ist async geworden (der Token wird vergeben, BEVOR die Synthese fertig ist) und sein Rumpf liegt deshalb in try/catch; Express 4 faengt abgelehnte Versprechen aus async-Handlern NICHT ab, ein haengender Abruf duerfte aber nie einen Anruf toeten. Das sind die fuenf Zeilen (skipComments:true - Kommentare zaehlen nicht). Unvermeidbar aus demselben Grund wie oben: die Aenderung MUSS durch dieselbe Riesenfunktion, solange der G30-Split aussteht. complexity UNVERAENDERT; no-magic-numbers SINKT von 3 auf 2 - das 404 dieses Handlers heisst jetzt HTTP_NOT_FOUND. Gemessen mit demselben Befehl. PIN GESENKT 2026-09-14 (IE6-S1): makeVoiceRoutes 279 -> 237 Zeilen - der komplette Call-Control-Handoff (inboundAssistantHandoffXml, makeCallControlIngest-Mount) ist entfernt und durch die eine Inbound-Pfad-Sonde ersetzt. Eine der drei Async-Arrow-complexity-Funde (die 11er) entfaellt mit dem Handoff-Zweig. no-magic-numbers UNVERAENDERT. Gemessen mit `npx eslint src/routes/voice.js --suppressions-location eslint-suppressions.empty.json --format json`. PIN GESENKT 2026-09-14 (IE6-S2): makeVoiceRoutes 237 -> 227 Zeilen - der komplette Realtime-Zweig in /voice/incoming und /voice/outbound (Stream-Direktive, TELNYX_INBOUND_REALTIME-Profil) ist entfernt. complexity/no-magic-numbers UNVERAENDERT. Gemessen mit `npx eslint src/routes/voice.js --suppressions-location eslint-suppressions.empty.json --format json`. PIN ANGEHOBEN 2026-09-15 (IEL-B5): makeVoiceRoutes 227 -> 229 Zeilen und die Async-Arrow des /voice/status-Handlers complexity 12 -> 13 - die GEBUNDEN-Weiche (bridgeStateOf(call) === BRIDGE_STATE.GEBUNDEN -> startInboundNachlauf) schliesst einen ueberbrueckten Inbound-Call NICHT ueber finishCall ab, sondern setzt nur das Carrier-Ende und startet den Nachlauf-Poll; dazu der injizierte Parameter startInboundNachlauf. Unvermeidbar aus demselben Grund wie oben: die Weiche MUSS in denselben Handler, solange der G30-Split aussteht. Keine neue Regel-Kategorie, no-magic-numbers UNVERAENDERT. Gemessen mit `npx eslint src/routes/voice.js --suppressions-location eslint-suppressions.empty.json --format json`. PIN GESENKT 2026-09-15 (IEL-B8): makeVoiceRoutes 229 -> 228 Zeilen, die Async-Arrow des /voice/status-Handlers complexity 13 -> 12 (ANGENOMMEN_STATUS.includes statt zweier ||-Vergleiche) und no-magic-numbers 200 entfaellt (HTTP_OK). Die neue Logik (Sprechpfad-Weiche, EL-Uebergabe, Rueckfall-Route /voice/el-rueckfall, SIP-Bein-Callback /voice/el-bein) liegt auf Modul-Ebene bzw. in src/elevenlabs/inbound-rueckfall.js, nicht in makeVoiceRoutes; keine neue Regel-Kategorie. Gemessen mit `npx eslint src/routes/voice.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-13",
    "findings": {
      "complexity :: Async arrow function has a complexity of 12. Maximum allowed is 10.": 1,
      "complexity :: Async arrow function has a complexity of 15. Maximum allowed is 10.": 1,
      "max-lines-per-function :: Function 'makeVoiceRoutes' has too many lines (228). Maximum allowed is 100.": 1,
      "no-magic-numbers :: No magic number: 403.": 1
    }
  },
  "scripts/convo-bench/runner.mjs": {
    "reason": "NEUER Eintrag 2026-09-14 (IE6-S1): das Entfernen der shim_gates-Zeile (Assistant-Pfad-Diagnose, s. transport.diagnostics().shim_gate_reasons) verschiebt runScenarioRepeat von 165 auf 164 Zeilen und die Komplexitaet von 31 auf 30 - eine reine Loeschung, keine neue Verzweigung. Die Datei war vorher nur ueber eslint-suppressions.json grob-suppressed (rule-level Zaehler); der geaenderte Meldungstext (exakte Zeilenzahl im Text) zaehlt fuer scripts/check-staged-suppressions.js als Bewegung, obwohl kein neuer Verstoss entstanden ist. Ein G30-Split von runScenarioRepeat ist ein eigener Umbau, kein Nebeneffekt dieser Phase. Gemessen mit `npx eslint scripts/convo-bench/runner.mjs --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-14",
    "findings": {
      "complexity :: Async function 'runScenarioRepeat' has a complexity of 30. Maximum allowed is 10.": 1,
      "complexity :: Function 'extractStoreSnapshot' has a complexity of 11. Maximum allowed is 10.": 1,
      "id-length :: Identifier name 'a' is too short (< 2).": 1,
      "id-length :: Identifier name 'c' is too short (< 2).": 2,
      "id-length :: Identifier name 'm' is too short (< 2).": 6,
      "id-length :: Identifier name 'n' is too short (< 2).": 1,
      "id-length :: Identifier name 'r' is too short (< 2).": 1,
      "id-length :: Identifier name 'u' is too short (< 2).": 1,
      "max-lines-per-function :: Async function 'runScenarioRepeat' has too many lines (164). Maximum allowed is 100.": 1,
      "no-magic-numbers :: No magic number: 1e4.": 2,
      "no-magic-numbers :: No magic number: 1e6.": 2,
      "no-unsafe-finally :: Unsafe usage of ThrowStatement.": 1,
      "no-useless-assignment :: The value assigned to 'callId' is not used in subsequent statements.": 1,
      "no-useless-assignment :: The value assigned to 'endedVia' is not used in subsequent statements.": 1
    }
  },
  "src/telephony/registry.js": {
    "reason": "NEUER Eintrag 2026-09-14 (IE6-S1): CAPABILITY verliert AI_ASSISTANT (nur noch PLAY_AUDIO_TTS), fakeVoice verliert originateViaCallControl/startAssistant/speak - die verbleibende no-magic-numbers-Zeile (der eine Cache-TTL-Wert) verschiebt sich dadurch im Modul, ihr Meldungstext (dieselbe Zahl 8) bleibt inhaltlich unveraendert, zaehlt aber als Bewegung, weil die Regel vorher zwei Vorkommen der Zahl 8 traf (eines davon in der geloeschten Fake-Methode) und jetzt nur noch eines. Reine Loeschung, kein neuer Verstoss. Gemessen mit `npx eslint src/telephony/registry.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-14",
    "findings": {
      "id-length :: Identifier name 'd' is too short (< 2).": 1,
      "id-length :: Identifier name 'h' is too short (< 2).": 1,
      "no-magic-numbers :: No magic number: 8.": 1
    }
  },
  "src/util.js": {
    "reason": "NEUER Eintrag 2026-09-14 (IE6-S1): hashText/TEXT_HASH_LEN sind entfernt (nur vom geloeschten Telnyx-Shim/Turn-Probe genutzt) - id-length 's' sinkt von 3 auf 2 Vorkommen (eines davon war der s-Parameter von hashText). Reine Loeschung, kein neuer Verstoss. Gemessen mit `npx eslint src/util.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-14",
    "findings": {
      "id-length :: Identifier name 'a' is too short (< 2).": 1,
      "id-length :: Identifier name 'b' is too short (< 2).": 1,
      "id-length :: Identifier name 's' is too short (< 2).": 2
    }
  },
  "test/al-p6-engine-reactions.test.js": {
    "reason": "NEUER Eintrag 2026-09-14 (IE6-S1): Teil A (Shim-Turns, AL-P6-7/AL-P6-9) samt Shim-Harness-Import und Hilfsfunktionen ist entfernt - nur Teil B (Budget-Engine, echte HTTP-Route) bleibt. Die verbleibenden Befunde sind unveraendert vorbestehende Teil-B-Fixture-Werte (Anthropic-Token-Preis-Konstanten), nur ohne die zuvor davorstehenden Teil-A-Zeilen. Gemessen mit `npx eslint test/al-p6-engine-reactions.test.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-14",
    "findings": {
      "id-length :: Identifier name 'r' is too short (< 2).": 2,
      "no-magic-numbers :: No magic number: 12.": 1,
      "no-magic-numbers :: No magic number: 200.": 1
    }
  },
  "test/config-shape.test.js": {
    "reason": "NEUER Eintrag 2026-09-14 (IE6-S1): die telnyxAssistant-Testbloecke (Proxy-Guard/Duck-Typing/die 18-Keys-/10-Flach-Pfade-Tests) sind entfernt, ersetzt durch schlankere telnyxElevenLabs-Aequivalente (nur noch voiceId). Weniger Testcode, dieselbe Restmenge an id-length/no-magic-numbers/no-restricted-syntax-Vorkommen in den verbleibenden Tests verschiebt sich nur in der Zeile. Gemessen mit `npx eslint test/config-shape.test.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-14",
    "findings": {
      "id-length :: Identifier name 'c' is too short (< 2).": 6,
      "no-magic-numbers :: No magic number: 86400000.": 1,
      "no-restricted-syntax :: Aufrufkette zu tief (mehr als 4 verkettete Zugriffe) - Gesetz von Demeter (G36)": 1
    }
  },
  "test/gq-p2-consult-deadline.test.js": {
    "reason": "NEUER Eintrag 2026-09-14 (IE6-S1): der Test 'GQ-P2-6 consultPollAgeMs trennt nie gepollt von zu alt' (Punkt 6 der Testliste) ist entfernt - consultPollAgeMs/CONSULT_POLL_NEVER waren ausschliesslich vom geloeschten Telnyx-Shim genutzt. Die verbleibenden fuenf Abnahmen (Punkte 1-5) sind unveraendert, nur ohne den sechsten Block. Gemessen mit `npx eslint test/gq-p2-consult-deadline.test.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-14",
    "findings": {
      "id-length :: Identifier name 'd' is too short (< 2).": 1,
      "id-length :: Identifier name 'r' is too short (< 2).": 2,
      "no-magic-numbers :: No magic number: 1000.": 1,
      "no-magic-numbers :: No magic number: 10_000.": 1,
      "no-magic-numbers :: No magic number: 2.": 1,
      "no-magic-numbers :: No magic number: 30.": 1,
      "no-magic-numbers :: No magic number: 3_600_000.": 1,
      "no-magic-numbers :: No magic number: 600_000.": 1,
      "no-param-reassign :: Assignment to property of function parameter 'call'.": 1,
      "no-restricted-syntax :: Aufrufkette zu tief (mehr als 4 verkettete Zugriffe) - Gesetz von Demeter (G36)": 16,
      "no-unused-vars :: 'ops' is assigned a value but never used. Allowed unused vars must match /^_/u.": 1
    }
  },
  "test/ks-p2-live-carrier-spend.test.js": {
    "reason": "NEUER Eintrag 2026-09-14 (IE6-S1): KS-P2-12 (Shim - Live-Verbrauch loest killCallForBudget aus) samt telnyx-shim-harness.js-Import ist entfernt - nur die Budget-Engine-Faelle (KS-P2-1..11) bleiben. Gemessen mit `npx eslint test/ks-p2-live-carrier-spend.test.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-14",
    "findings": {
      "id-length :: Identifier name 'a' is too short (< 2).": 1,
      "id-length :: Identifier name 's' is too short (< 2).": 11,
      "no-magic-numbers :: No magic number: 10.": 1,
      "no-magic-numbers :: No magic number: 2.": 2,
      "no-magic-numbers :: No magic number: 60.": 1
    }
  },
  "test/l0-metrics.test.js": {
    "reason": "NEUER Eintrag 2026-09-14 (IE6-S1): T-L0-6 (logShimTurn ist PII-frei) ist entfernt und der logShimTurn-Aufruf in T-L0-2 (Master-Schalter-aus-Test) gestrichen - metrics.js#logShimTurn existiert nicht mehr. Die verbleibenden fuenf Metrik-Funktionen sind unveraendert getestet. Gemessen mit `npx eslint test/l0-metrics.test.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-14",
    "findings": {
      "id-length :: Identifier name 'm' is too short (< 2).": 10,
      "id-length :: Identifier name 't' is too short (< 2).": 1,
      "no-magic-numbers :: No magic number: 10.": 1,
      "no-magic-numbers :: No magic number: 100.": 2,
      "no-magic-numbers :: No magic number: 1000.": 1,
      "no-magic-numbers :: No magic number: 1700.": 1,
      "no-magic-numbers :: No magic number: 20.": 3,
      "no-magic-numbers :: No magic number: 30.": 1,
      "no-magic-numbers :: No magic number: 40.": 1,
      "no-magic-numbers :: No magic number: 42.": 1,
      "no-magic-numbers :: No magic number: 5.": 1,
      "no-magic-numbers :: No magic number: 7.": 1,
      "no-restricted-syntax :: Aufrufkette zu tief (mehr als 4 verkettete Zugriffe) - Gesetz von Demeter (G36)": 1
    }
  },
  "test/machine-detection.test.js": {
    "reason": "NEUER Eintrag 2026-09-14 (IE6-S1): die Call-Control-Subtests (originateViaCallControl traegt answering_machine_detection) sind entfernt - nur der TeXML-Pfad (originateCall) bleibt getestet. Gemessen mit `npx eslint test/machine-detection.test.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-14",
    "findings": {
      "no-magic-numbers :: No magic number: 200.": 1
    }
  },
  "test/telnyx-call-control.test.js": {
    "reason": "NEUER Eintrag 2026-09-14 (IE6-S1): originateViaCallControl/startAssistant/speak-Tests sind entfernt (Assistant-Pfad-Adapter-Methoden geloescht) - nur originateCall (TeXML) und endCallViaCallControl (Hangup-Altbestand) bleiben getestet. Gemessen mit `npx eslint test/telnyx-call-control.test.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-14",
    "findings": {
      "id-length :: Identifier name 'l' is too short (< 2).": 2,
      "id-length :: Identifier name 'v' is too short (< 2).": 1,
      "no-magic-numbers :: No magic number: 200.": 1,
      "no-restricted-syntax :: Aufrufkette zu tief (mehr als 4 verkettete Zugriffe) - Gesetz von Demeter (G36)": 1
    }
  },
  "test/turn-budget.test.js": {
    "reason": "NEUER Eintrag 2026-09-14 (IE6-S1): enforcedTurnWorstCaseMs/deadAirOverrun (Dead-Air-Watchdog des entfernten Assistant-Pfads) samt ihrer Tests und der Boot-Dead-Air-WARN-Testgruppe sind entfernt - nur die reinen Turn-Budget-Formeltests und der Turn-Budget-Boot-Waechter (warnTurnBudgetOverrun) bleiben. Gemessen mit `npx eslint test/turn-budget.test.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-14",
    "findings": {
      "id-length :: Identifier name 't' is too short (< 2).": 1,
      "no-magic-numbers :: No magic number: 11250.": 2,
      "no-magic-numbers :: No magic number: 11500.": 1,
      "no-magic-numbers :: No magic number: 14750.": 1,
      "no-magic-numbers :: No magic number: 2000.": 2,
      "no-magic-numbers :: No magic number: 20000.": 1,
      "no-magic-numbers :: No magic number: 2100.": 1,
      "no-magic-numbers :: No magic number: 3500.": 1,
      "no-magic-numbers :: No magic number: 4.": 1,
      "no-magic-numbers :: No magic number: 4700.": 1,
      "no-magic-numbers :: No magic number: 9000.": 1
    }
  },
  "scripts/check-setup.js": {
    "reason": "NEUER Eintrag 2026-09-14 (IE6-S2). Reine Loeschung verschiebt Meldungstext, keine neue Schuld (Praezedenz IE6-S1): der komplette OpenAI-Realtime-Check-Abschnitt (Abschnitt 3) ist entfernt, seine id-length/no-restricted-syntax/no-magic-numbers-Fundstellen verschwinden mit ihm. Die verbleibenden Verstoesse sind Bestand, unveraendert durch diese Phase. Gemessen mit `npx eslint scripts/check-setup.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-14",
    "findings": {
      "id-length :: Identifier name 'e' is too short (< 2).": 3,
      "id-length :: Identifier name 'h' is too short (< 2).": 1,
      "id-length :: Identifier name 'm' is too short (< 2).": 5,
      "id-length :: Identifier name 'p' is too short (< 2).": 1,
      "id-length :: Identifier name 'r' is too short (< 2).": 5,
      "id-length :: Identifier name 't' is too short (< 2).": 1,
      "max-depth :: Blocks are nested too deeply (5). Maximum allowed is 4.": 1,
      "max-depth :: Blocks are nested too deeply (6). Maximum allowed is 4.": 1,
      "no-magic-numbers :: No magic number: 401.": 1,
      "no-negated-condition :: Unexpected negated condition.": 1,
      "no-restricted-syntax :: Aufrufkette zu tief (mehr als 4 verkettete Zugriffe) - Gesetz von Demeter (G36)": 2
    }
  },
  "test/al-p10b-lookup.test.js": {
    "reason": "NEUER Eintrag 2026-09-14 (IE6-S2). Reine Loeschung verschiebt Meldungstext, keine neue Schuld (Praezedenz IE6-S1): der Realtime-Abschnitt G (AL-P10b-15) samt bridge.js-Import/VOICE_ENGINE-Import ist entfernt, seine id-length-Fundstellen verschwinden mit ihm. Die verbleibenden Verstoesse sind Bestand, unveraendert durch diese Phase. Gemessen mit `npx eslint test/al-p10b-lookup.test.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-14",
    "findings": {
      "id-length :: Identifier name 'a' is too short (< 2).": 2,
      "id-length :: Identifier name 'd' is too short (< 2).": 2,
      "id-length :: Identifier name 'l' is too short (< 2).": 2,
      "id-length :: Identifier name 'r' is too short (< 2).": 4,
      "id-length :: Identifier name 't' is too short (< 2).": 2,
      "no-magic-numbers :: No magic number: 0.9.": 1,
      "no-magic-numbers :: No magic number: 2.": 2,
      "no-magic-numbers :: No magic number: 22.": 1,
      "no-restricted-syntax :: Aufrufkette zu tief (mehr als 4 verkettete Zugriffe) - Gesetz von Demeter (G36)": 13
    }
  },
  "test/boot-failclosed.test.js": {
    "reason": "NEUER Eintrag 2026-09-14 (IE6-S2). Reine Loeschung verschiebt Meldungstext, keine neue Schuld (Praezedenz IE6-S1): B4A-BOOT-4 (REALTIME_MODEL-Boot-Test) ist entfernt (abgedeckt durch IE6-S2-1), sein no-magic-numbers-Fund (200) verschwindet mit ihm. Die verbleibenden Verstoesse sind Bestand, unveraendert durch diese Phase. Gemessen mit `npx eslint test/boot-failclosed.test.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-14",
    "findings": {
      "id-length :: Identifier name 'l' is too short (< 2).": 1,
      "no-magic-numbers :: No magic number: 200.": 9
    }
  },
  "test/media-token.test.js": {
    "reason": "NEUER Eintrag 2026-09-14 (IE6-S2). Reine Loeschung verschiebt Meldungstext, keine neue Schuld (Praezedenz IE6-S1): die WebSocket-Subtests (falsches/fehlendes/korrektes Token, TwiML der Realtime-Engine) sind entfernt (kein /media-Endpunkt mehr) - nur der Top-Level-Leck-Test fuer streamToken bleibt. Die verbleibenden Verstoesse sind Bestand, unveraendert durch diese Phase. Gemessen mit `npx eslint test/media-token.test.js --suppressions-location eslint-suppressions.empty.json --format json`.",
    "date": "2026-09-14",
    "findings": {
      "no-magic-numbers :: No magic number: 200.": 1,
      "no-magic-numbers :: No magic number: 32.": 1
    }
  }
};

// Erfundene Unterdrueckung, mit der jede gelistete Datei gegen die Auswahl
// gehalten wird: entschuldigt ihr Eintrag nicht, taucht sie als Treffer auf.
const PROBE_RULE_COUNTS = { "id-length": { count: 1 } };

// Strenges Kalenderdatum: Form YYYY-MM-DD UND ein Tag, den es wirklich gibt.
// Bewusst nicht ueber die Naht des Gates geprueft, sondern hier nachgerechnet:
// dessen Date.parse nimmt "2026-02-31" an (V8 rollt still auf den 3. Maerz).
// Der Hook ist damit nachsichtiger als sein eigener Kommentar behauptet - die
// Ratsche ist der Ort, an dem die Liste trotzdem sauber bleibt.
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isStrictCalendarDate(value) {
  if (typeof value !== "string") return false;
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
  );
}

// Wendungen, die fuer sich genommen nichts erklaeren - sie nennen Aufwand,
// Zeit oder Vorsatz, nicht die Gefahr. Ihr Vorkommen ist nicht verboten;
// verboten ist eine Begruendung, die NUR daraus besteht.
const FILLER_PHRASES = [
  "keine zeit",
  "zu viel arbeit",
  "viel aufwand",
  "zu aufwendig",
  "aufwendig",
  "aufwand",
  "spaeter",
  "irgendwann",
  "erstmal",
  "vorerst",
  "nicht jetzt",
  "wird noch",
  "muss noch",
  "todo",
  "tbd",
];

// Zwei Masse, weil jedes allein zu leicht zu erfuellen waere: die Laenge
// faengt das blosse "Altlast", der Wortbestand jenseits der Floskeln faengt
// den langen Satz, der nur Aufwand aufzaehlt.
const MIN_REASON_LENGTH = 40;
const MIN_SUBSTANCE_WORDS = 5;
const MIN_WORD_LENGTH = 4;
const SUBSTANCE_WORD_PATTERN = new RegExp(`[\\p{L}\\p{N}]{${MIN_WORD_LENGTH},}`, "gu");

function withoutFiller(reason) {
  return FILLER_PHRASES.reduce(
    (text, phrase) => text.split(phrase).join(" "),
    reason.toLowerCase(),
  );
}

// Wie viele verschiedene tragende Woerter bleiben uebrig, wenn man die
// Floskeln streicht? Kurze Fuellwoerter ("der", "ist", "und") zaehlen nicht mit.
function substanceWordCount(reason) {
  const words = withoutFiller(reason).match(SUBSTANCE_WORD_PATTERN) || [];
  return new Set(words).size;
}

// Ist der Grund substanziell - oder eine Floskel in Satzform? Was der Grund
// BEHAUPTET, prueft kein Test; das steht im Dateikopf als menschliche Pflicht.
function isSubstantialReason(reason) {
  if (typeof reason !== "string") return false;
  return (
    reason.trim().length >= MIN_REASON_LENGTH && substanceWordCount(reason) >= MIN_SUBSTANCE_WORDS
  );
}

describe("Altlast-Ratsche (echte Liste)", () => {
  it("der Inhalt der Altlast-Liste ist unveraendert", () => {
    assert.deepEqual(
      REAL_LEGACY_EXCEPTIONS,
      LEGACY_FINGERPRINT,
      `${LEGACY_EXCEPTIONS_REL} hat sich geaendert. Ein Eintrag WENIGER ist der Normalfall ` +
        "(aufgeraeumt) und wird hier einfach nachgezogen. Ein Eintrag MEHR oder ein " +
        "geaenderter Grund braucht die Freigabe des Eigentuemers - kein Bau-Agent setzt " +
        "einen Eintrag, um nicht blockiert zu sein.",
    );
  });

  it("jeder Eintrag entschuldigt seine Datei am Gate selbst", () => {
    assert.ok(
      LISTED_FILES.length > 0,
      `Positiv-Kontrolle fehlgeschlagen: ${LEGACY_EXCEPTIONS_REL} ist leer, hier wird nichts geprueft`,
    );
    const offenders = findSuppressedStagedFiles({
      stagedFiles: LISTED_FILES,
      suppressions: Object.fromEntries(LISTED_FILES.map((file) => [file, PROBE_RULE_COUNTS])),
      legacyExceptions: REAL_LEGACY_EXCEPTIONS,
    });
    assert.deepEqual(
      offenders.map((offender) => offender.file),
      [],
      "Diese Eintraege entschuldigen nichts: Grund fehlt/ist leer oder das Datum ist kein " +
        "Kalenderdatum. Ein halb gefuehrter Eintrag ist ein Abstellgleis - das Gate lehnt " +
        "die Datei trotz Eintrag ab, der Eintrag taeuscht nur Deckung vor.",
    );
  });

  it("jedes Datum ist ein Tag, den es wirklich gibt", () => {
    for (const [file, entry] of Object.entries(REAL_LEGACY_EXCEPTIONS)) {
      assert.ok(
        isStrictCalendarDate(entry.date),
        `${file}: "${entry.date}" ist kein Kalenderdatum. Das Datum sagt, wie lange die ` +
          "Ausnahme schon steht - ein krummer Wert macht daraus eine unbefristete.",
      );
    }
  });

  it("weist ein Datum ab, das es im Kalender nicht gibt", () => {
    assert.equal(isStrictCalendarDate("2026-02-31"), false);
    assert.equal(isStrictCalendarDate("bald"), false);
  });

  it("jeder Grund ist substanziell und nicht bloss eine Floskel", () => {
    for (const [file, entry] of Object.entries(REAL_LEGACY_EXCEPTIONS)) {
      assert.ok(
        isSubstantialReason(entry.reason),
        `${file}: der Grund ist zu duenn. Er muss sagen, WARUM das Aufraeumen gefaehrlich ` +
          "waere - nicht, dass es Arbeit ist.",
      );
    }
  });

  it("weist einen Grund ab, der nur Aufwand und Zeit nennt", () => {
    assert.equal(
      isSubstantialReason("Zu viel Arbeit, keine Zeit, das raeumen wir irgendwann spaeter auf."),
      false,
    );
  });

  it("weist einen zu kurzen Grund ab", () => {
    assert.equal(isSubstantialReason("Altlast, kommt weg."), false);
  });
});

// ---- Stufe 2: mechanische Aenderungen (Attrappe) ----------------------------
// Der Vertrag: findChangedFindings({ candidates, readFindings }) laesst einen
// Kandidaten der Stufe 1 nur dann fallen, wenn seine ungefilterte Befundmenge
// vor und nach der Aenderung IDENTISCH ist. readFindings ist die Naht
// (Datei -> { before, after } als eslint-Meldungen); wer sie fuellt - git und
// eslint oder diese Attrappe - bleibt hier offen.
//
// Warum es die Stufe gibt (Eigentuemer-Entscheidung 2026-08-15): Stufe 1 allein
// lehnt auch eine Umbenennung ab, die nichts verschlimmert, und macht das
// Aufraeumen fremder Schuld zum Preis jeder Beruehrung - genau daraus
// entstehen neue Altlast-Eintraege. Was die Stufe NICHT lockert: neue, mehr,
// weniger oder getauschte Befunde fuehren unveraendert zur Ablehnung.
const KANDIDATEN = [
  { file: "src/dummy/altlast.js", ruleCounts: [{ rule: "id-length", count: 3 }] },
];

// Zwei verschiedene Zeilen: der Vergleich muss sie ignorieren, sonst waere
// jede eingefuegte Zeile eine "Verschlechterung".
const ZEILE_VORHER = 1;
const ZEILE_NACHHER = 47;

function meldung(ruleId, message, line) {
  return { ruleId, message, line, column: line };
}

const KURZER_NAME = meldung("id-length", "Identifier name 'q' is too short (< 2).", ZEILE_VORHER);
const KURZER_NAME_VERSCHOBEN = meldung(
  "id-length",
  "Identifier name 'q' is too short (< 2).",
  ZEILE_NACHHER,
);
const ANDERER_KURZER_NAME = meldung(
  "id-length",
  "Identifier name 'x' is too short (< 2).",
  ZEILE_VORHER,
);
const MAGISCHE_ZAHL = meldung("no-magic-numbers", "No magic number: 7.", ZEILE_NACHHER);

async function abgelehnt(before, after) {
  return findChangedFindings({
    candidates: KANDIDATEN,
    readFindings: () => Promise.resolve({ before, after }),
  });
}

function begruendung(offenders) {
  return offenders.flatMap((offender) => offender.reasons).join(" | ");
}

describe("findChangedFindings (Attrappe)", () => {
  it("laesst eine Aenderung durch, deren Befunde nur verschoben sind", async () => {
    const offenders = await abgelehnt([KURZER_NAME], [KURZER_NAME_VERSCHOBEN]);
    assert.deepEqual(offenders, []);
  });

  it("laesst eine Datei ganz ohne Befunde durch", async () => {
    assert.deepEqual(await abgelehnt([], []), []);
  });

  it("lehnt ab, sobald ein Befund dazukommt", async () => {
    const offenders = await abgelehnt([KURZER_NAME], [KURZER_NAME, MAGISCHE_ZAHL]);
    assert.deepEqual(
      offenders.map((offender) => offender.file),
      ["src/dummy/altlast.js"],
    );
    assert.match(begruendung(offenders), /No magic number: 7\./);
  });

  it("lehnt ab, wenn ein Befund wegfaellt", async () => {
    const offenders = await abgelehnt([KURZER_NAME, MAGISCHE_ZAHL], [KURZER_NAME]);
    assert.equal(offenders.length, KANDIDATEN.length);
  });

  it("lehnt ab, wenn ein Befund gegen einen anderen getauscht wird", async () => {
    // Der Fall, den die eingefrorene ANZAHL nicht faengt: eine Fundstelle
    // behoben, an anderer Stelle eine neue eingebaut - Zahl gleich, Menge nicht.
    const offenders = await abgelehnt([KURZER_NAME], [ANDERER_KURZER_NAME]);
    assert.equal(offenders.length, KANDIDATEN.length);
    assert.match(begruendung(offenders), /'x' is too short/);
  });

  it("vergleicht als Multimenge, nicht als Menge", async () => {
    const offenders = await abgelehnt([KURZER_NAME, KURZER_NAME_VERSCHOBEN], [KURZER_NAME]);
    assert.equal(offenders.length, KANDIDATEN.length);
  });

  it("lehnt fail-closed ab, wenn die Befunde nicht lesbar sind", async () => {
    const offenders = await findChangedFindings({
      candidates: KANDIDATEN,
      readFindings: () => Promise.reject(new Error("kein Stand in HEAD")),
    });
    assert.equal(offenders.length, KANDIDATEN.length);
    assert.match(begruendung(offenders), /nicht pruefbar.*kein Stand in HEAD/);
  });
});

// ---- Stufe 3: gilt der Pin noch? (Attrappe) ---------------------------------
// Der Vertrag: findPinMismatches({ stagedFiles, legacyExceptions, readStagedFindings })
// laesst eine entschuldigte Datei nur durch, wenn ihre TATSAECHLICHE, ungefilterte
// Befundmenge (readStagedFindings) genau dem Pin (findings im Altlast-Eintrag der
// vorgemerkten Fassung) gleicht - Multimengen-Vergleich, BEIDE Richtungen brechen.
// Geprueft wird gegen src/dummy/altlast.js aus LEGACY_EXCEPTIONS oben: ihr Pin
// (ALTLAST_PIN) ist 3x derselbe id-length-Befund.
// Zwei weitere Fundstellen-Zeilen; die Zahl selbst ist beliebig, sie muss nur von
// den beiden oberen verschieden sein (die Meldung traegt die Identitaet, nicht die Zeile).
const ZEILE_DRITTE = 99;
const ZEILE_VIERTE = 100;
const PIN_BASISZEILEN = [ZEILE_VORHER, ZEILE_NACHHER, ZEILE_DRITTE];
function kurzeNamen(zeilen) {
  return zeilen.map((line) =>
    meldung("id-length", "Identifier name 'q' is too short (< 2).", line),
  );
}
const PIN_QUELLE = "id-length :: Identifier name 'q' is too short (< 2).";

describe("findPinMismatches (Attrappe)", () => {
  it("laesst eine Datei mit deckungsgleichem Pin durch und prueft nur gueltige Eintraege", async () => {
    let calls = 0;
    const offenders = await findPinMismatches({
      stagedFiles: ["src/dummy/altlast.js", "src/dummy/nicht-gelistet.js"],
      legacyExceptions: LEGACY_EXCEPTIONS,
      readStagedFindings: async () => {
        calls += 1;
        return kurzeNamen(PIN_BASISZEILEN);
      },
    });
    assert.deepEqual(offenders, []);
    assert.equal(calls, 1, "nur die Datei mit gueltigem Eintrag darf gelintet werden");
  });

  it("lehnt ab, wenn mehr Befunde da sind als der Pin sagt", async () => {
    const offenders = await findPinMismatches({
      stagedFiles: ["src/dummy/altlast.js"],
      legacyExceptions: LEGACY_EXCEPTIONS,
      readStagedFindings: async () => kurzeNamen([...PIN_BASISZEILEN, ZEILE_VIERTE]),
    });
    assert.equal(offenders.length, 1);
    assert.equal(offenders[0].file, "src/dummy/altlast.js");
    assert.deepEqual(offenders[0].correctedFindings, { [PIN_QUELLE]: 4 });
    assert.match(begruendung(offenders), /3 -> 4/);
  });

  it("lehnt ab, wenn weniger Befunde da sind als der Pin sagt", async () => {
    const offenders = await findPinMismatches({
      stagedFiles: ["src/dummy/altlast.js"],
      legacyExceptions: LEGACY_EXCEPTIONS,
      readStagedFindings: async () => kurzeNamen(PIN_BASISZEILEN.slice(1)),
    });
    assert.equal(offenders.length, 1);
    assert.deepEqual(offenders[0].correctedFindings, { [PIN_QUELLE]: 2 });
    assert.match(begruendung(offenders), /3 -> 2/);
  });

  it("lehnt fail-closed ab, wenn die Befunde nicht lesbar sind", async () => {
    const offenders = await findPinMismatches({
      stagedFiles: ["src/dummy/altlast.js"],
      legacyExceptions: LEGACY_EXCEPTIONS,
      readStagedFindings: () => Promise.reject(new Error("kein Stand im Index")),
    });
    assert.equal(offenders.length, 1);
    assert.match(begruendung(offenders), /nicht pruefbar.*kein Stand im Index/);
  });
});

// ---- Die Befundmenge an echten eslint-Meldungen -----------------------------
// Die Attrappe oben prueft die Entscheidung, dieser Block das Material: was
// eslint fuer denselben Inhalt vor und nach einer Aenderung wirklich meldet.
// Ohne ihn stuende nur die Behauptung da, dass eine Zeilenverschiebung nichts
// bewegt und ein neuer Verstoss doch.
const PROBE_PFAD = "test/dummy-probe.test.js";
const PROBE_CODE = "export function probe(q) {\n  return q;\n}\n";
const PROBE_CODE_VERSCHOBEN = `// Kommentar, der nur Zeilen verschiebt.\n${PROBE_CODE}`;
const PROBE_CODE_SCHLECHTER = `${PROBE_CODE}export function zweite(x) {\n  return x;\n}\n`;
const IGNORIERTER_PFAD = "data/dummy-probe.js";
const KAPUTTER_CODE = "export function probe(((;\n";

describe("Ungefilterte Befunde (echtes eslint)", () => {
  it("sieht die Befunde, die eslint-suppressions.json einfriert", async () => {
    // Die Positiv-Kontrolle des ganzen Vergleichs: liefe der Linter mit der
    // echten Unterdrueckungsdatei, waere die Menge einer Bestandsdatei leer -
    // dann saehe JEDE Aenderung mechanisch aus und das Gate liesse alles durch.
    const lintContent = await makeUnfilteredLinter();
    const file = gatedFile();
    const messages = await lintContent(readRepoFile(file), file);
    assert.ok(
      findingTally(messages).size > 0,
      `${file} traegt Unterdrueckungen, der ungefilterte Lauf meldet aber nichts`,
    );
  });

  it("bewertet eine reine Zeilenverschiebung als identisch", async () => {
    const lintContent = await makeUnfilteredLinter();
    const vorher = findingTally(await lintContent(PROBE_CODE, PROBE_PFAD));
    const nachher = findingTally(await lintContent(PROBE_CODE_VERSCHOBEN, PROBE_PFAD));
    assert.ok(vorher.size > 0, "Probe ohne Befund prueft nichts");
    assert.deepEqual(tallyDifferences(vorher, nachher), []);
  });

  it("sieht einen neu eingebauten Verstoss", async () => {
    const lintContent = await makeUnfilteredLinter();
    const vorher = findingTally(await lintContent(PROBE_CODE, PROBE_PFAD));
    const nachher = findingTally(await lintContent(PROBE_CODE_SCHLECHTER, PROBE_PFAD));
    const differences = tallyDifferences(vorher, nachher);
    assert.equal(differences.length, 1);
    assert.match(differences[0].key, /id-length.*'x' is too short/);
  });

  it("bricht fail-closed ab, wenn der Inhalt nicht parsebar ist", async () => {
    const lintContent = await makeUnfilteredLinter();
    await assert.rejects(lintContent(KAPUTTER_CODE, PROBE_PFAD), /kann .* nicht lesen/);
  });

  it("bricht fail-closed ab, wenn eslint den Pfad gar nicht lintet", async () => {
    const lintContent = await makeUnfilteredLinter();
    await assert.rejects(lintContent(PROBE_CODE, IGNORIERTER_PFAD), /nicht gelintet/);
  });
});

// ---- Der Freifahrtschein am echten CLI --------------------------------------
// Die Gegenprobe zum Ablehnungs-Bericht oben, gefahren ueber dieselbe Naht
// (Skript als Kindprozess, Index neben dem echten): dieselbe Datei, die mit
// bewegter Befundmenge abgelehnt wird, laeuft ohne Bewegung durch. Ein Gate,
// das alles ablehnt, besteht jeden Negativ-Test - erst dieses Paar zeigt, dass
// es unterscheidet.
describe("Aufraeum-Gate am echten CLI", () => {
  it("laesst eine vorgemerkte Datei ohne Bewegung der Befunde durch", () => {
    const file = gatedFile();
    const { status, report } = runGate(file, tempIndexEnv());
    assert.equal(status, 0, `Gate hat eine unveraenderte Datei abgelehnt: ${report}`);
  });
});
