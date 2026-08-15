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
const LEGACY_FINGERPRINT = {
  "src/store/state-ops.js": {
    reason:
      "Echte Schuld, kein Fehlschnitt der Regel. Das Aufraeumen ist ein eigenes Refactoring des Zustandsmoduls und nicht Teil der ElevenLabs-Migration.",
    date: "2026-08-13",
    findings: {
      "complexity :: Function 'createCall' has a complexity of 12. Maximum allowed is 10.": 1,
      "complexity :: Function 'setTenantSubscription' has a complexity of 13. Maximum allowed is 10.": 1,
      "complexity :: Function 'tenantSubscription' has a complexity of 15. Maximum allowed is 10.": 1,
      "id-length :: Identifier name 'a' is too short (< 2).": 8,
      "id-length :: Identifier name 'b' is too short (< 2).": 3,
      "id-length :: Identifier name 'c' is too short (< 2).": 15,
      "id-length :: Identifier name 'e' is too short (< 2).": 10,
      "id-length :: Identifier name 'n' is too short (< 2).": 11,
      "id-length :: Identifier name 'q' is too short (< 2).": 1,
      "id-length :: Identifier name 's' is too short (< 2).": 162,
      "id-length :: Identifier name 't' is too short (< 2).": 4,
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
      "no-param-reassign :: Assignment to property of function parameter 's'.": 17,
      "no-param-reassign :: Assignment to property of function parameter 'tenant'.": 6,
      "no-param-reassign :: Assignment to property of function parameter 'usage'.": 6,
      "no-restricted-syntax :: Aufrufkette zu tief (mehr als 4 verkettete Zugriffe) - Gesetz von Demeter (G36)": 12,
    },
  },
  "src/store/pg.js": {
    reason:
      "Echte Schuld, kein Fehlschnitt der Regel. makePgStore mit 448 Zeilen ist ein eigener Umbau und nicht Teil der ElevenLabs-Migration. PIN ANGEHOBEN 2026-08-15 (answeredUnclearReason): makePgStore 462 -> 472 Zeilen, rowToCall 21 -> 22, flushCalls 22 -> 23. Unvermeidbar, solange der Split ausgesetzt ist - ein neues persistiertes Feld MUSS durch Zeilen-Mapper und Flush, und beide sind Teil derselben Riesenfunktion. Genau deshalb waechst diese Datei mit jedem Feld weiter; erst der Split stoppt das. Angehoben, nicht stillschweigend: der Pin hat die Verschlechterung gemeldet, sie ist geprueft und bewusst uebernommen.",
    date: "2026-08-13",
    findings: {
      "complexity :: Async function 'flushCalls' has a complexity of 23. Maximum allowed is 10.": 1,
      "complexity :: Async function 'flushTenants' has a complexity of 24. Maximum allowed is 10.": 1,
      "complexity :: Function 'rowToCall' has a complexity of 22. Maximum allowed is 10.": 1,
      "complexity :: Function 'rowToTenant' has a complexity of 23. Maximum allowed is 10.": 1,
      "id-length :: Identifier name 'a' is too short (< 2).": 1,
      "id-length :: Identifier name 'b' is too short (< 2).": 2,
      "id-length :: Identifier name 'c' is too short (< 2).": 3,
      "id-length :: Identifier name 'e' is too short (< 2).": 4,
      "id-length :: Identifier name 'n' is too short (< 2).": 5,
      "id-length :: Identifier name 'r' is too short (< 2).": 23,
      "id-length :: Identifier name 's' is too short (< 2).": 1,
      "id-length :: Identifier name 't' is too short (< 2).": 2,
      "max-lines-per-function :: Async function 'hydrateTenantInto' has too many lines (117). Maximum allowed is 100.": 1,
      "max-lines-per-function :: Function 'makePgStore' has too many lines (472). Maximum allowed is 100.": 1,
      "max-params :: Async function 'deleteMissing' has too many parameters (4). Maximum allowed is 3.": 1,
      "no-param-reassign :: Assignment to property of function parameter 'state'.": 3,
    },
  },
  "src/routes/api-calls.js": {
    reason:
      "Eigentuemer-Entscheidung 2026-08-15. Echte Schuld, kein Fehlschnitt der Regel - aber das Aufraeumen ist der G30-Split der Outbound-Route und damit ein Umbau im Gate-Kernpfad: diese Datei traegt die Safety-Gate-Kette (Permit, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, OUTBOUND_FROZEN). Ein Entzerren verschiebt genau die Reihenfolge, in der diese Gates greifen; faellt dabei eine Pruefung durch, ruft der Dienst jemanden ungewollt an oder ueberzieht die Kostendecke. Das braucht ein eigenes Paket mit eigener Absicherung (Gate-Tests vor dem Schnitt), nicht einen Nebeneffekt dieses Commits. PIN ANGEHOBEN 2026-08-15 (S1-Nachbesserung cancel_call/S1-4, S1-5, S1-2b): makeCallRoutes 222 -> 225 Zeilen - der cancel_call-Handler traegt seither die Begruendung, warum die EL-Form (nicht die Kennung) die ehrliche Antwort entscheidet, plus das zusaetzliche hangup_attempted-Feld. Unvermeidbar, solange der G30-Split aussteht (s. reason oben) - jede Verhaltenskorrektur in diesem Handler MUSS durch dieselbe Riesenfunktion. Das Gate hat die Verschlechterung gemeldet, sie ist geprueft und bewusst uebernommen statt stillschweigend.",
    date: "2026-08-15",
    findings: {
      "complexity :: Async arrow function has a complexity of 22. Maximum allowed is 10.": 1,
      "id-length :: Identifier name 'b' is too short (< 2).": 2,
      "id-length :: Identifier name 'e' is too short (< 2).": 1,
      "max-lines-per-function :: Async arrow function has too many lines (118). Maximum allowed is 100.": 1,
      "max-lines-per-function :: Function 'makeCallRoutes' has too many lines (225). Maximum allowed is 100.": 1,
      "no-magic-numbers :: No magic number: 400.": 4,
      "no-magic-numbers :: No magic number: 403.": 1,
      "no-magic-numbers :: No magic number: 404.": 4,
      "no-magic-numbers :: No magic number: 409.": 1,
      "no-magic-numbers :: No magic number: 500.": 1,
      "no-magic-numbers :: No magic number: 502.": 1,
    },
  },
  "src/telephony/call-finish.js": {
    reason:
      "Eigentuemer-Entscheidung 2026-08-15. Echte Schuld, kein Fehlschnitt der Regel - aber finishCall zu entzerren beruehrt den Abrechnungs- und Zusammenfassungs-Pfad: hier wird gebucht und die Gespraechs-Zusammenfassung erzeugt. `call._finished` ist der dokumentierte Idempotenz-Marker; ihn zu ersetzen traegt Verhaltensrisiko (Doppelbuchung oder verlorene Zusammenfassung bei doppelt zugestelltem Provider-Webhook). Eigenes Paket, eigene Absicherung.",
    date: "2026-08-15",
    findings: {
      "complexity :: Async function 'finishCall' has a complexity of 21. Maximum allowed is 10.": 1,
      "id-length :: Identifier name 'a' is too short (< 2).": 1,
      "id-length :: Identifier name 'e' is too short (< 2).": 2,
      "id-length :: Identifier name 't' is too short (< 2).": 1,
      "no-param-reassign :: Assignment to property of function parameter 'call'.": 1,
    },
  },
  "src/mcp-tools.js": {
    reason:
      "Eigentuemer-Entscheidung 2026-08-15. Der registerTools-Split ist ein eigenes Paket und ausdruecklich nicht Teil dieser Sitzung.",
    date: "2026-08-15",
    findings: {
      "complexity :: Function 'resultCardView' has a complexity of 11. Maximum allowed is 10.": 1,
      "id-length :: Identifier name 'A' is too short (< 2).": 1,
      "id-length :: Identifier name 'a' is too short (< 2).": 2,
      "id-length :: Identifier name 'c' is too short (< 2).": 8,
      "id-length :: Identifier name 'e' is too short (< 2).": 4,
      "id-length :: Identifier name 'r' is too short (< 2).": 2,
      "id-length :: Identifier name 's' is too short (< 2).": 9,
      "id-length :: Identifier name 't' is too short (< 2).": 1,
      "id-length :: Identifier name 'v' is too short (< 2).": 1,
      "max-lines-per-function :: Function 'registerTools' has too many lines (430). Maximum allowed is 100.": 1,
      "max-params :: Arrow function has too many parameters (4). Maximum allowed is 3.": 1,
      "no-magic-numbers :: No magic number: 1000.": 1,
      "no-magic-numbers :: No magic number: 2.": 6,
      "no-restricted-syntax :: Aufrufkette zu tief (mehr als 4 verkettete Zugriffe) - Gesetz von Demeter (G36)": 18,
    },
  },
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
