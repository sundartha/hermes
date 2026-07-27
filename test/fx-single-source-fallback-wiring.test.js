// Regressionstest zu GAP-08 (s. test/fx-single-source.test.js). Review-Befund an
// Phase P2 (tasks/gates-fix-chain.md): der Gate-Test dort liest den USD/EUR-Kurs per
// readLiteral("usdToEur") - eine Regex, die den ERSTEN Treffer des Bezeichners
// "usdToEur:" im Quelltext nimmt. Das trifft die dekorative Kopie in
// EXCHANGE_RATE_DEFAULTS, NICHT zwingend die numEnv-Fallback-Stelle, die tatsaechlich
// verwendet wird (die Fallback-Stelle referenziert die Konstante, ist selbst also kein
// Zahlen-Literal). Aendert jemand kuenftig NUR die Fallback-Stelle (z.B. auf einen
// abweichenden Wert statt der Referenz), bleibt der Gate-Test bei genau diesem Szenario
// gruen - er hat die Aenderung nie gesehen.
//
// Dieser Test schliesst die Luecke, ohne den Gate-Test selbst anzufassen: er startet
// einen Kindprozess mit kontrollierter Umgebung (BASE_ENV, Lehre test-base-env-drift)
// und liest den ECHTEN, gebauten config-Wert - nicht den Quelltext per Regex. Das ist
// immun gegen jede dekorative Kopie und findet eine Entkopplung unabhaengig davon, ob
// die Fallback-Stelle am Ende ein Literal oder eine Referenz ist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { BASE_ENV, ROOT } from "./helpers.js";

const MICRO_PER_UNIT = 1_000_000;

// Liest config.llm.usdToEur und config.billing.providerToBucketRateMicro aus einem
// frisch importierten src/config.js - im Kindprozess, damit die lokale .env dieses
// Arbeitsplatzes (Lehre test-base-env-drift) den Wert nicht verfaelscht.
function readBuiltRates(env) {
  const script =
    "import(\"./src/config.js\").then(({ config }) => " +
    "process.stdout.write(JSON.stringify({ " +
    "usdToEur: config.llm.usdToEur, " +
    "providerToBucketRateMicro: config.billing.providerToBucketRateMicro })));";
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...BASE_ENV, ...env },
    encoding: "utf8",
  });
  return JSON.parse(out);
}

// BASE_ENV pinnt USD_TO_EUR explizit (Lehre test-base-env-drift) - fuer den FALLBACK-Wert
// (was ohne gesetzte Umgebungsvariable gebaut wird) muss die Variable hier gezielt
// entfernt werden, sonst prueft der erste Test nur den env-gesetzten Wert, nie den
// Code-Fallback selbst. NODE_ENV=test bleibt trotzdem gesetzt (config.js laedt sonst
// dotenv und ein lokales .env dieses Arbeitsplatzes koennte USD_TO_EUR selbst setzen -
// dieselbe Lehre test-base-env-drift, nur am Fehlen statt am Vorhandensein der Variable).
function readBuiltRatesWithoutUsdToEurEnv() {
  const { USD_TO_EUR: _unused, ...envWithoutUsdToEur } = BASE_ENV;
  const script =
    "import(\"./src/config.js\").then(({ config }) => " +
    "process.stdout.write(JSON.stringify({ " +
    "usdToEur: config.llm.usdToEur, " +
    "providerToBucketRateMicro: config.billing.providerToBucketRateMicro })));";
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...envWithoutUsdToEur, NODE_ENV: "test" },
    encoding: "utf8",
  });
  return JSON.parse(out);
}

test("der GEBAUTE Fallback-Wert von usdToEur (ohne gesetztes USD_TO_EUR) stimmt mit der Provider-Achse ueberein", () => {
  const { usdToEur, providerToBucketRateMicro } = readBuiltRatesWithoutUsdToEurEnv();
  assert.equal(
    usdToEur,
    providerToBucketRateMicro / MICRO_PER_UNIT,
    "config.llm.usdToEur weicht vom tatsaechlich gebauten Provider-Kurs " +
      "(config.billing.providerToBucketRateMicro) ab - dieselben USD ergeben je " +
      "Kostenpfad einen anderen EUR-Betrag",
  );
});

test("USD_TO_EUR ist am gebauten config-Wert env-korrigierbar (kein Deploy noetig)", () => {
  const { usdToEur } = readBuiltRates({ USD_TO_EUR: "0.5" });
  assert.equal(
    usdToEur,
    0.5,
    "config.llm.usdToEur ignoriert USD_TO_EUR aus der Umgebung - waere das der Fall, " +
      "braeuchte eine Kurskorrektur wieder einen Deploy",
  );
});
