// Regressionstest zu GAP-08 (s. test/fx-single-source.test.js). Der Gate-Test dort liest
// den QUELLTEXT von src/config.js per Regex: er verlangt ein Zahlen-Literal an der
// Konstanten EXCHANGE_RATE_DEFAULTS.usdToEur und eines am numEnv-Fallback von
// PROVIDER_TO_BUCKET_RATE_MICRO und vergleicht die beiden. Was er NICHT sieht: welche
// Umgebungsvariable die KI-Achse am Ende tatsaechlich liest und welchen Wert sie gebaut
// annimmt. Genau daran haengt aber die Zusage der Phase - EIN Kurs mit EINER
// Stellschraube.
//
// Dieser Test schliesst die Luecke, ohne den Gate-Test selbst anzufassen: er startet
// einen Kindprozess mit kontrollierter Umgebung (BASE_ENV, Lehre test-base-env-drift)
// und liest die ECHTEN, gebauten config-Werte - nicht den Quelltext. Das ist immun gegen
// jede dekorative Kopie im Quelltext.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { BASE_ENV, ROOT } from "./helpers.js";

const MICRO_PER_UNIT = 1_000_000;

// Liest config.llm.usdToEur und config.billing.providerToBucketRateMicro aus einem
// frisch importierten src/config.js - im Kindprozess, damit die lokale .env dieses
// Arbeitsplatzes (Lehre test-base-env-drift) den Wert nicht verfaelscht. NODE_ENV=test
// ist dabei Pflicht und nicht bloss Kosmetik: ohne sie laedt config.js dotenv, und ein
// lokales .env koennte genau die Variable setzen, die dieser Test gerade WEGLAESST.
//
// overrides: Zusatzvariablen ueber BASE_ENV. Der Wert `undefined` ENTFERNT die Variable
// aus der Umgebung des Kindprozesses - so wird der Code-Fallback selbst pruefbar.
function readBuiltRates(overrides = {}) {
  const env = { PATH: process.env.PATH, ...BASE_ENV, ...overrides, NODE_ENV: "test" };
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete env[name];
  }
  const script =
    "import(\"./src/config.js\").then(({ config }) => " +
    "process.stdout.write(JSON.stringify({ " +
    "usdToEur: config.llm.usdToEur, " +
    "providerToBucketRateMicro: config.billing.providerToBucketRateMicro })));";
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  });
  return JSON.parse(out);
}

test("der GEBAUTE Fallback beider Kosten-Achsen (ohne gesetzte Kurs-Variable) meint denselben Kurs", () => {
  const { usdToEur, providerToBucketRateMicro } = readBuiltRates({
    PROVIDER_TO_BUCKET_RATE_MICRO: undefined,
  });
  assert.equal(
    usdToEur,
    providerToBucketRateMicro / MICRO_PER_UNIT,
    "config.llm.usdToEur weicht vom gebauten Provider-Kurs " +
      "(config.billing.providerToBucketRateMicro) ab - dieselben USD ergeben je " +
      "Kostenpfad einen anderen EUR-Betrag",
  );
});

test("eine Kurskorrektur ueber PROVIDER_TO_BUCKET_RATE_MICRO bewegt BEIDE Achsen (kein Deploy noetig)", () => {
  const { usdToEur, providerToBucketRateMicro } = readBuiltRates({
    PROVIDER_TO_BUCKET_RATE_MICRO: "500000",
  });
  assert.equal(providerToBucketRateMicro, 500000, "Provider-Achse ignoriert die Umgebung");
  assert.equal(
    usdToEur,
    0.5,
    "die KI-Achse haengt nicht an derselben Variablen - damit gaebe es wieder zwei " +
      "Stellschrauben fuer einen Kurs, und eine einseitige Korrektur liesse die Achsen " +
      "auseinanderlaufen",
  );
});
