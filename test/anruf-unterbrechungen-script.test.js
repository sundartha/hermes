// P6 (PLAN-ANRUFDEFEKTE.md): Test des read-only Messwerkzeugs
// scripts/anruf-unterbrechungen.mjs. Offline, ohne .env, ohne Netz (P12) - die
// reinen Funktionen werden direkt gegen die committete Positiv-Kontrolle
// (test/fixtures/anruf-unterbrechungen.js, E-4: wird HIER NICHT angepasst)
// geprueft, der IO-Teil per Kindprozess-Spawn (Muster
// test/check-outbound-drift-script.test.js) unter NODE_ENV=test (dotenv aus -
// Lehre BASE_ENV-Drift, garantiert kein Netz auch auf einer Maschine mit .env).
//
// Neues Verhalten braucht einen Test (P11/T-Serie): es gibt vor dieser Datei
// keine Zeile Code fuer diese Kennzahl - die Fixture allein ist Datum, kein
// Urteil.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

import { ROOT } from "./helpers.js";
import { UNTERBRECHUNGS_FIXTURES } from "./fixtures/anruf-unterbrechungen.js";
import {
  agentenTurns,
  alsProzent,
  alsSekunden,
  analysiereGespraech,
  ausgelieferterAnteil,
  fasseZusammen,
  istGueltigeKennung,
  istRecapText,
  messeAnrufe,
  recapImFolgeTurn,
} from "../scripts/anruf-unterbrechungen.mjs";

const SPAWN_TIMEOUT_MS = 8000;
const EXIT_AUFRUFFEHLER = 2;

// Die Soll-Zahlen der drei Fixtures (Kopfkommentar test/fixtures/anruf-unterbrechungen.js,
// unabhaengig vom Lead nachgerechnet) - als Konstanten statt nackter Zahlenliterale in den
// Assertions (Konvention s. test/kv2-10-tarifpaar.test.js).
const LAUT_AGENTEN_TURNS = 7;
const LAUT_MIT_TEXT = 7;
const LAUT_UNTERBROCHEN = 6;
const KONTROLLE_AGENTEN_TURNS = 6;
const KONTROLLE_MIT_TEXT = 4;
const KONTROLLE_UNTERBROCHEN = 1;
const REFERENZ_AGENTEN_TURNS = 7;
const REFERENZ_MIT_TEXT = 5;
const REFERENZ_UNTERBROCHEN = 2;
const FIXTURES_ANZAHL = Object.keys(UNTERBRECHUNGS_FIXTURES).length;

function unterbrocheneProzente(analyse) {
  return analyse.unterbrochene.map((eintrag) => alsProzent(eintrag.anteil));
}

// Abnahme 1: die Soll-Zahlen der drei Fixtures reproduzieren exakt.
test("P6-1 laut_12_44 reproduziert Turns, Anteile und Dauer", () => {
  const analyse = analysiereGespraech(UNTERBRECHUNGS_FIXTURES.laut_12_44);
  assert.equal(analyse.agentenTurns, LAUT_AGENTEN_TURNS);
  assert.equal(analyse.mitText, LAUT_MIT_TEXT);
  assert.equal(analyse.unterbrochen, LAUT_UNTERBROCHEN);
  assert.deepEqual(
    unterbrocheneProzente(analyse),
    ["56.7", "65.7", "86.3", "35.5", "21.4", "85.4"],
  );
  assert.equal(alsSekunden(analyse.dauerSekunden), "87.0");
  assert.equal(alsProzent(analyse.anteilAlleTurns), "85.7");
});

test("P6-2 kontrolle_10_26 reproduziert Turns, Anteil und Dauer", () => {
  const analyse = analysiereGespraech(UNTERBRECHUNGS_FIXTURES.kontrolle_10_26);
  assert.equal(analyse.agentenTurns, KONTROLLE_AGENTEN_TURNS);
  assert.equal(analyse.mitText, KONTROLLE_MIT_TEXT);
  assert.equal(analyse.unterbrochen, KONTROLLE_UNTERBROCHEN);
  assert.deepEqual(unterbrocheneProzente(analyse), ["98.7"]);
  assert.equal(alsSekunden(analyse.dauerSekunden), "101.0");
});

test("P6-3 referenz_03_09 reproduziert Turns, Anteile und Dauer", () => {
  const analyse = analysiereGespraech(UNTERBRECHUNGS_FIXTURES.referenz_03_09);
  assert.equal(analyse.agentenTurns, REFERENZ_AGENTEN_TURNS);
  assert.equal(analyse.mitText, REFERENZ_MIT_TEXT);
  assert.equal(analyse.unterbrochen, REFERENZ_UNTERBROCHEN);
  assert.deepEqual(unterbrocheneProzente(analyse), ["52.5", "96.7"]);
  assert.equal(alsSekunden(analyse.dauerSekunden), "55.0");
});

// E-1: die Hauptkennzahl (Nenner alle Agenten-Turns) und die Vergleichszahl
// (Nenner nur Turns mit Text) sind an kontrolle_10_26 belegt verschieden.
test("P6-4 zwei Nenner sind unterschiedlich (E-1)", () => {
  const analyse = analysiereGespraech(UNTERBRECHUNGS_FIXTURES.kontrolle_10_26);
  assert.equal(alsProzent(analyse.anteilAlleTurns), "16.7");
  assert.equal(alsProzent(analyse.anteilTextTurns), "25.0");
});

// E-2: die Zusammenfassung traegt Anteil UND Dauer, Mittel ueber Anrufe.
test("P6-5 fasseZusammen mittelt ueber Anrufe (E-2)", () => {
  const analysen = Object.values(UNTERBRECHUNGS_FIXTURES).map(analysiereGespraech);
  const zusammenfassung = fasseZusammen(analysen);
  assert.equal(zusammenfassung.anzahl, FIXTURES_ANZAHL);
  assert.equal(alsProzent(zusammenfassung.mittlererUnterbrechungsanteil), "43.7");
  assert.equal(alsSekunden(zusammenfassung.mittlereDauerSekunden), "81.0");
});

// E-3: die Recap-Heuristik an einem AUSGEDACHTEN Fall (die Fixture-Platzhalter
// koennen sie nicht pruefen, s. P6-7). Erfunden fuer diesen Test, kein
// Anbieter-Datum.
test("P6-6 Recap-Heuristik erkennt Marker im naechsten Text-Turn (erfundener Fall)", () => {
  const turns = [
    { role: "agent", time_in_call_secs: 0, interrupted: true, message: "abc", original_message: "abcdef" },
    { role: "agent", time_in_call_secs: 2, interrupted: false, message: null, original_message: null },
    {
      role: "agent",
      time_in_call_secs: 4,
      interrupted: false,
      message: "Entschuldige, die Verbindung war kurz schlecht.",
      original_message: null,
    },
  ];
  assert.equal(recapImFolgeTurn(turns, 0), true);

  const turnsOhneRecap = [
    { role: "agent", time_in_call_secs: 0, interrupted: true, message: "abc", original_message: "abcdef" },
    { role: "agent", time_in_call_secs: 4, interrupted: false, message: "Ein neutraler Satz.", original_message: null },
  ];
  assert.equal(recapImFolgeTurn(turnsOhneRecap, 0), false);

  assert.equal(istRecapText("désolé, encore une fois"), true);
});

// E-4-Falle festnageln: an den ECHTEN Fixtures ist recapErholungen === 0, weil
// der Sprechtext durch laengengleiche Platzhalterketten ersetzt ist (die Datei
// ist die Positiv-Kontrolle, s. ihr Kopfkommentar). Der Referenzanruf hatte
// REAL einen Recap - das ist kein Werkzeugfehler und darf nicht "gefixt"
// werden, indem die Fixture angepasst wird.
test("P6-7 recapErholungen ist 0 an den Platzhalter-Fixtures (E-4, keine Werkzeug-Reparatur)", () => {
  for (const gespraech of Object.values(UNTERBRECHUNGS_FIXTURES)) {
    const analyse = analysiereGespraech(gespraech);
    assert.equal(analyse.recapErholungen, 0);
  }
});

test("P6-8 ausgelieferterAnteil liefert null ohne original_message (keine erfundene 100%)", () => {
  assert.equal(ausgelieferterAnteil({ message: "abc", original_message: null }), null);
  assert.equal(ausgelieferterAnteil({ message: "abc", original_message: "" }), null);
  assert.equal(ausgelieferterAnteil({ message: "abc", original_message: undefined }), null);
});

test("P6-9 istGueltigeKennung prueft das Format streng", () => {
  assert.equal(istGueltigeKennung("conv_0501m1vbz70bfpctff3th2h2htrc"), true);
  assert.equal(istGueltigeKennung(""), false);
  assert.equal(istGueltigeKennung("nicht-eine-kennung"), false);
  assert.equal(istGueltigeKennung("conv_"), false);
  assert.equal(istGueltigeKennung("conv_x/../y"), false);
  assert.equal(istGueltigeKennung("CONV_x"), false);
});

test("P6-10 messeAnrufe ruft den Abruf bei leerer Liste NICHT auf", async () => {
  let aufrufe = 0;
  const spion = async () => {
    aufrufe += 1;
    return {};
  };
  const ergebnis = await messeAnrufe([], { holeGespraech: spion });
  assert.equal(aufrufe, 0);
  assert.deepEqual(ergebnis, { analysen: [], fehler: [] });
});

test("P6-11 messeAnrufe sammelt einen gescheiterten Abruf in fehler[], kein stiller Erfolg", async () => {
  const abruf = async (kennung) => {
    if (kennung === "conv_b") throw new Error("HTTP 404");
    return UNTERBRECHUNGS_FIXTURES.referenz_03_09;
  };
  const ergebnis = await messeAnrufe(["conv_a", "conv_b"], { holeGespraech: abruf });
  assert.equal(ergebnis.analysen.length, 1);
  assert.equal(ergebnis.fehler.length, 1);
  assert.equal(ergebnis.fehler[0].kennung, "conv_b");
  assert.match(ergebnis.fehler[0].grund, /404/);
});

test("P6-12 Read-only-Quelltext-Gate: kein fs, kein method:, keine Schreibfunktion (I-1/I-2)", async () => {
  const fs = await import("node:fs/promises");
  const quelltext = await fs.readFile(`${ROOT}/scripts/anruf-unterbrechungen.mjs`, "utf8");
  const kommentarfrei = quelltext.replace(/\/\/.*$/gm, "");

  assert.doesNotMatch(kommentarfrei, /method\s*:/);
  assert.doesNotMatch(kommentarfrei, /from\s+["']node:fs["']/);
  assert.doesNotMatch(kommentarfrei, /writeFile|appendFile|createWriteStream/);

  // Positiv-Kontrolle (Lehre pruefkommando-ohne-positiv-kontrolle): dieselben
  // Regexe MUESSEN auf einen synthetischen Schnipsel treffen, der die Muster
  // enthaelt - sonst wuerde "nichts gefunden" aussehen wie "sucht nichts".
  const schreibenderSchnipsel = 'import { writeFile } from "node:fs";\nfetch(url, { method: "POST" });\n';
  assert.match(schreibenderSchnipsel, /method\s*:/);
  assert.match(schreibenderSchnipsel, /from\s+["']node:fs["']/);
  assert.match(schreibenderSchnipsel, /writeFile|appendFile|createWriteStream/);
});

function runAnrufUnterbrechungen(argv, env) {
  const child = spawn(process.execPath, ["scripts/anruf-unterbrechungen.mjs", ...argv], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: "test", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`anruf-unterbrechungen.mjs ist nicht rechtzeitig beendet. stdout: ${stdout} stderr: ${stderr}`));
    }, SPAWN_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test("P6-13 ohne Argumente: Exit 2, USAGE auf stderr, kein Abruf (Abnahme 2)", async () => {
  const { code, stdout, stderr } = await runAnrufUnterbrechungen([], {});
  assert.equal(code, EXIT_AUFRUFFEHLER);
  assert.match(stderr, /Aufruf: node scripts\/anruf-unterbrechungen\.mjs/);
  assert.equal(stdout, "");
});

test("P6-14 ungueltige Kennung: Exit 2 mit Formatmeldung; fehlender Schluessel: Exit 1 (Abnahme 3)", async () => {
  const ungueltig = await runAnrufUnterbrechungen(["nicht-eine-kennung"], {});
  assert.equal(ungueltig.code, EXIT_AUFRUFFEHLER);
  assert.match(ungueltig.stderr, /erwartetes Format/);

  const ohneSchluessel = await runAnrufUnterbrechungen(["conv_ZzTestOhneSchluessel"], { ELEVENLABS_API_KEY: "" });
  assert.equal(ohneSchluessel.code, 1);
  assert.match(ohneSchluessel.stderr, /ELEVENLABS_API_KEY/);
});

test("P6-15 agentenTurns liefert nur role=agent in Reihenfolge", () => {
  const ZWEITER_AGENT_TURN_SEKUNDE = 2;
  const gespraech = {
    transcript: [
      { role: "agent", time_in_call_secs: 0, message: "a" },
      { role: "user", time_in_call_secs: 1, message: "b" },
      { role: "agent", time_in_call_secs: ZWEITER_AGENT_TURN_SEKUNDE, message: "c" },
    ],
  };
  assert.deepEqual(
    agentenTurns(gespraech).map((turn) => turn.time_in_call_secs),
    [0, ZWEITER_AGENT_TURN_SEKUNDE],
  );
});
