import { env } from "node:process";
import { pathToFileURL } from "node:url";

import { laufeMitDateien } from "./lauf.mjs";
import { bewerteLauf } from "./schwellen.mjs";
import { baueWebhooks, fremderSigner, signerAusPem, WEBHOOKS_JE_LAUF } from "./webhooks.mjs";
import { fuehreAusWennErlaubt, STAGING_ADRESSE } from "./ziel.mjs";

const UMGEBUNG_STAGING = "staging";
const ANRUFE_KOPF = "x-hermes-anrufe";
const OHNE_ECHTE_TELEFONIE = "attrappe";
const ABFRAGE_FRIST_MS = 10_000;
const HTTP_OK = 200;
const EXIT_ROT = 1;
const ARGUMENTE_AB = 2;
const MS_JE_SEKUNDE = 1000;
const SZENARIEN = Object.freeze(["mcp_anmeldung", "anruf", "webhooks"]);
const AUSGELASSEN = Object.freeze(["route_webhook_elevenlabs", "route_app_login"]);
const GEHEIMNISSE = Object.freeze({
  statusToken: "STAGING_STATUS_TOKEN",
  testToken: "STAGING_TEST_TOKEN",
  telnyxSchluessel: "STAGING_TELNYX_PRIVATE_KEY",
  commit: "GITHUB_SHA",
});

function abbruch(grund) {
  throw new Error(`Staging-Lastlauf abgebrochen: ${grund}`);
}

function leseGeheimnisse(umgebung) {
  return Object.fromEntries(
    Object.entries(GEHEIMNISSE).map(([schluessel, name]) => {
      const wert = (umgebung[name] ?? "").trim();
      if (wert === "") abbruch(`${name}_fehlt`);
      return [schluessel, wert];
    }),
  );
}

async function hole(abfrage, url, kopf) {
  try {
    return await abfrage(url, { headers: kopf, redirect: "error", signal: AbortSignal.timeout(ABFRAGE_FRIST_MS) });
  } catch {
    return abbruch("staging_nicht_erreichbar");
  }
}

async function pruefeStand({ abfrage, basis, commit }) {
  const antwort = await hole(abfrage, `${basis}/healthz`, {});
  const koerper = antwort.status === HTTP_OK ? await antwort.json().catch(() => ({})) : {};
  if (koerper.commit !== commit) abbruch("stand_unerwartet");
}

async function pruefeTelefonie({ abfrage, basis, statusToken }) {
  const antwort = await hole(abfrage, `${basis}/intern/status`, { authorization: `Bearer ${statusToken}` });
  if (antwort.headers.get(ANRUFE_KOPF) !== OHNE_ECHTE_TELEFONIE) abbruch("anrufe_nicht_belegt_ohne_echte_telefonie");
}

function baueKonfiguration({ basis, werte, zeitpunktS }) {
  return {
    ziele: [basis],
    tokens: [werte.testToken],
    werkzeugToken: "",
    szenarien: SZENARIEN,
    ausgelassen: AUSGELASSEN,
    webhooks: {
      gueltig: baueWebhooks(signerAusPem(werte.telnyxSchluessel), WEBHOOKS_JE_LAUF, zeitpunktS),
      ungueltig: baueWebhooks(fremderSigner(), WEBHOOKS_JE_LAUF, zeitpunktS),
    },
  };
}

export async function fuehreStagingLastlaufAus({
  umgebung = env,
  abfrage = fetch,
  k6Befehl = ["k6"],
  fuehreAus = laufeMitDateien,
  jetztMs = Date.now,
} = {}) {
  const werte = leseGeheimnisse(umgebung);
  return fuehreAusWennErlaubt(STAGING_ADRESSE, UMGEBUNG_STAGING, async (basis) => {
    await pruefeStand({ abfrage, basis, commit: werte.commit });
    await pruefeTelefonie({ abfrage, basis, statusToken: werte.statusToken });
    const zeitpunktS = Math.floor(jetztMs() / MS_JE_SEKUNDE);
    const ergebnis = await fuehreAus(k6Befehl, baueKonfiguration({ basis, werte, zeitpunktS }));
    return { ergebnis, urteil: bewerteLauf(ergebnis) };
  });
}

async function main(argumente) {
  const { ergebnis, urteil } = await fuehreStagingLastlaufAus({ k6Befehl: argumente.length > 0 ? argumente : ["k6"] });
  console.log(JSON.stringify({ ergebnis, urteil }));
  return urteil.gruen ? 0 : EXIT_ROT;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(ARGUMENTE_AB)).then(
    (code) => process.exit(code),
    (fehler) => {
      console.error(fehler.message);
      process.exit(EXIT_ROT);
    },
  );
}
