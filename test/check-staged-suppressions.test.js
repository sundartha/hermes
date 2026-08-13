// Aufraeum-Gate (scripts/check-staged-suppressions.js). Prueft die reine
// Auswahl-Logik auf einer Attrappe, nie auf der echten eslint-suppressions.json
// (die ist gross und aendert sich mit jedem Aufraeumen). Beide Richtungen:
// eine vorgemerkte Datei mit Eintraegen wird gemeldet, eine ohne wird nicht.
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
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  findSuppressedStagedFiles,
  loadLegacyExceptions,
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
  "src/dummy/nicht-gelistet.js": { "no-magic-numbers": { count: 2 } },
};

// Genau ein Eintrag ist gueltig (altlast.js). Er steht in jedem Fall mit im
// Spiel, damit jeder Test die Entschuldigung UND die Positiv-Kontrolle
// zugleich prueft: ein Gate, das alles durchlaesst, faellt hier auf.
const LEGACY_EXCEPTIONS = {
  "src/dummy/altlast.js": {
    reason: "Aufraeumen waere ein eigenes Refactoring des Zustandsmoduls",
    date: "2026-08-13",
  },
  "src/dummy/ohne-grund.js": { date: "2026-08-13" },
  "src/dummy/ohne-datum.js": { reason: "steht noch aus" },
  "src/dummy/leere-felder.js": { reason: "   ", date: "   " },
  "src/dummy/krummes-datum.js": { reason: "steht noch aus", date: "bald" },
  "src/dummy/geraeumt.js": {
    reason: "war Altlast, ist inzwischen geraeumt",
    date: "2026-08-13",
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
    assert.deepEqual(
      offendingFiles(["src/dummy/altlast.js", "src/dummy/nicht-gelistet.js"]),
      ["src/dummy/nicht-gelistet.js"],
    );
  });

  it("entschuldigt nicht, wenn dem Eintrag der Grund fehlt", () => {
    assert.deepEqual(
      offendingFiles(["src/dummy/altlast.js", "src/dummy/ohne-grund.js"]),
      ["src/dummy/ohne-grund.js"],
    );
  });

  it("entschuldigt nicht, wenn dem Eintrag das Datum fehlt", () => {
    assert.deepEqual(
      offendingFiles(["src/dummy/altlast.js", "src/dummy/ohne-datum.js"]),
      ["src/dummy/ohne-datum.js"],
    );
  });

  it("entschuldigt nicht, wenn Grund und Datum nur aus Leerzeichen bestehen", () => {
    assert.deepEqual(
      offendingFiles(["src/dummy/altlast.js", "src/dummy/leere-felder.js"]),
      ["src/dummy/leere-felder.js"],
    );
  });

  it("entschuldigt nicht, wenn das Datum kein Kalenderdatum ist", () => {
    assert.deepEqual(
      offendingFiles(["src/dummy/altlast.js", "src/dummy/krummes-datum.js"]),
      ["src/dummy/krummes-datum.js"],
    );
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
    assert.throws(
      () => loadLegacyExceptions(() => '{ "src/dummy/altlast.js": '),
      SyntaxError,
    );
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
function firstRejectedFile() {
  const suppressions = JSON.parse(readRepoFile(SUPPRESSIONS_REL));
  const legacyExceptions = JSON.parse(readRepoFile(LEGACY_EXCEPTIONS_REL));
  return Object.keys(suppressions).find(
    (file) =>
      !legacyExceptions[file] && Object.keys(suppressions[file]).length > 0,
  );
}

// Ein echter Ablehnungs-Lauf. Beide Berichts-Faelle teilen ihn sich: der Lauf
// ist ihre Vorbedingung, nicht ihre Aussage.
function rejectionReport() {
  const rejectedFile = firstRejectedFile();
  assert.ok(
    rejectedFile,
    `Positiv-Kontrolle fehlgeschlagen: keine Datei in ${SUPPRESSIONS_REL}, die das Gate ablehnen wuerde`,
  );
  const run = spawnSync(process.execPath, [SCRIPT_PATH, rejectedFile], {
    encoding: "utf8",
  });
  const report = `${run.stdout}${run.stderr}`;
  assert.equal(run.status, 1, `Gate hat nicht abgelehnt: ${report}`);
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
    assert.ok(
      report.includes(rejectedFile),
      `Bericht nennt die abgelehnte Datei nicht: ${report}`,
    );
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
// ein Eintrag mehr, einer weniger oder ein geaenderter Grund erzwingt eine
// bewusste Aktualisierung DIESER Stelle. Buchhaltung dazu:
//   2026-08-13  src/store/state-ops.js, src/store/pg.js aufgenommen (D11).
//   2026-08-13  src/conversation-watchdog.js, src/boot-guard.js wieder
//               entfernt: im Vorbeigehen gesetzt, vom Eigentuemer abgelehnt,
//               danach aufgeraeumt statt gelistet.
const LEGACY_FINGERPRINT = {
  "src/store/state-ops.js": {
    reason:
      "Echte Schuld, kein Fehlschnitt der Regel. Das Aufraeumen ist ein eigenes Refactoring des Zustandsmoduls und nicht Teil der ElevenLabs-Migration.",
    date: "2026-08-13",
  },
  "src/store/pg.js": {
    reason:
      "Echte Schuld, kein Fehlschnitt der Regel. makePgStore mit 448 Zeilen ist ein eigener Umbau und nicht Teil der ElevenLabs-Migration.",
    date: "2026-08-13",
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
    reason.trim().length >= MIN_REASON_LENGTH &&
    substanceWordCount(reason) >= MIN_SUBSTANCE_WORDS
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
