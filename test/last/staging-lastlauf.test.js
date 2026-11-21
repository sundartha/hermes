import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { baueErgebnis, ROUTEN_BUDGET_MS, waehleSzenarien } from "../../scripts/last/ergebnis.js";
import { fuehreStagingLastlaufAus } from "../../scripts/last/staging.mjs";
import { baueWebhooks, signerAusPem } from "../../scripts/last/webhooks.mjs";
import { STAGING_ADRESSE } from "../../scripts/last/ziel.mjs";

const STAGING = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const STATUS_TOKEN = "status-token-nur-im-test-0123456789abcdef";
const TEST_TOKEN = "test-token-nur-im-test";
const SCHLUESSEL = crypto.generateKeyPairSync("ed25519");
const PEM = SCHLUESSEL.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const UMGEBUNG = Object.freeze({
  STAGING_STATUS_TOKEN: STATUS_TOKEN,
  STAGING_TEST_TOKEN: TEST_TOKEN,
  STAGING_TELNYX_PRIVATE_KEY: PEM,
  GITHUB_SHA: COMMIT,
});
const GRUEN = {
  fehlerquoteProzent: 0.1,
  verloreneAnrufe: 0,
  wartezeitSekunden: 3,
  routen: [{ name: "route_place_call", budgetMs: 1000, istMs: 200 }],
};

function job(name) {
  const treffer = STAGING.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z]+:\\n|(?![\\s\\S]))`, "m"));
  assert.ok(treffer, `Job ${name} fehlt in staging.yml`);
  return treffer[1];
}

function aufbau({ commit = COMMIT, anrufe = "attrappe", statusHttp = HTTP_OK, ergebnis = GRUEN } = {}) {
  const stand = { urls: [], kopfe: [], k6: [] };
  const antworten = {
    "/healthz": () => new Response(JSON.stringify({ ok: true, commit }), { status: HTTP_OK }),
    "/intern/status": (anfrage) => {
      const kopf = anrufe === null || anfrage.headers.authorization !== `Bearer ${STATUS_TOKEN}` ? {} : { "x-hermes-anrufe": anrufe };
      return new Response("{}", { status: statusHttp, headers: kopf });
    },
  };
  const abfrage = async (url, anfrage) => {
    stand.urls.push(url);
    stand.kopfe.push(anfrage);
    return antworten[new URL(url).pathname](anfrage);
  };
  const fuehreAus = async (befehl, konfiguration) => {
    stand.k6.push({ befehl, konfiguration });
    return ergebnis;
  };
  return { stand, optionen: { umgebung: UMGEBUNG, abfrage, fuehreAus, k6Befehl: ["k6"] } };
}

test("H3 Workflow: der Lastlauf startet nachts und per Eingabe ohne Adresse, die Deploy-Pruefung bleibt bei push und ohne Lastlauf-Eingabe", () => {
  assert.match(STAGING, /^ {2}schedule:\n {4}- cron: "\d+ \d+ \* \* \*"$/m);
  assert.match(STAGING, /^ {6}lastlauf:\n {8}description: .+\n {8}type: boolean\n {8}default: false$/m);
  assert.ok(!/inputs\.(url|adresse|ziel)/i.test(STAGING));
  assert.match(job("lastlauf"), /^ {4}if: github\.event_name == 'workflow_dispatch' && inputs\.lastlauf && !inputs\.alarmprobe$/m);
  assert.match(job("staging"), /^ {4}if: github\.event_name == 'push' \|\| github\.event_name == 'schedule' \|\| \(github\.event_name == 'workflow_dispatch' && \(!inputs\.lastlauf \|\| inputs\.alarmprobe\)\)$/m);
});

test("H3 Workflow: der Lastlauf teilt die Concurrency-Gruppe des Deploy-Prueffjobs, liest nur die drei Staging-Geheimnisse und nennt keine Adresse", () => {
  const text = job("lastlauf");
  assert.match(text, /^ {4}concurrency:\n {6}group: staging-push\n {6}cancel-in-progress: false$/m);
  assert.deepEqual([...text.matchAll(/secrets\.(\w+)/g)].map((treffer) => treffer[1]).sort(), ["STAGING_METRIK_TOKEN", "STAGING_METRIK_URL", "STAGING_STATUS_TOKEN", "STAGING_TELNYX_PRIVATE_KEY", "STAGING_TEST_TOKEN"]);
  assert.match(text, /run: node scripts\/last\/staging\.mjs k6$/m);
  assert.ok(!/https?:\/\//.test(text));
  assert.ok(!/SKIP_TWILIO_SIGNATURE_CHECK|OUTBOUND_FROZEN|DEV_LOGIN/.test(text));
  assert.match(STAGING, /^ {2}group: staging-\$\{\{ github\.event_name \}\}$/m);
});

test("H3 Lauf: Staging gleicher Stand und ohne echte Telefonie, der Lauf geht gegen die feste Staging-Adresse und wird mit den Schwellen bewertet", async () => {
  const { stand, optionen } = aufbau();
  const ergebnis = await fuehreStagingLastlaufAus(optionen);
  assert.deepEqual(ergebnis, { ergebnis: GRUEN, urteil: { gruen: true, gruende: [] } });
  assert.deepEqual(stand.urls, [`${STAGING_ADRESSE}/healthz`, `${STAGING_ADRESSE}/intern/status`]);
  const [healthz, status] = stand.kopfe;
  assert.equal(status.headers.authorization, `Bearer ${STATUS_TOKEN}`);
  assert.equal(healthz.redirect, "error");
  assert.equal(stand.k6.length, 1);
  const [{ konfiguration }] = stand.k6;
  assert.deepEqual(konfiguration.ziele, [STAGING_ADRESSE]);
  assert.deepEqual(konfiguration.tokens, [TEST_TOKEN]);
  assert.deepEqual(konfiguration.szenarien, ["mcp_anmeldung", "anruf", "webhooks"]);
  assert.deepEqual(konfiguration.ausgelassen, ["route_webhook_elevenlabs", "route_app_login"]);
  assert.equal(konfiguration.werkzeugToken, "");
});

test("H3 Lauf: die Schwellen gelten wie im CI, eine Fehlerquote von 0,5 Prozent macht den Staging-Lauf rot", async () => {
  const { optionen } = aufbau({ ergebnis: { ...GRUEN, fehlerquoteProzent: 0.5 } });
  const { urteil } = await fuehreStagingLastlaufAus(optionen);
  assert.deepEqual(urteil, { gruen: false, gruende: ["fehlerquote"] });
});

test("H3 Lauf: die Webhooks tragen Signaturen des Staging-Testschluessels, die falsch signierten nicht", async () => {
  const { stand, optionen } = aufbau();
  await fuehreStagingLastlaufAus(optionen);
  const [{ konfiguration }] = stand.k6;
  const { gueltig, ungueltig } = konfiguration.webhooks;
  const pruefe = ({ koerper, kopf }) =>
    crypto.verify(null, Buffer.from(`${kopf["telnyx-timestamp"]}|${koerper}`), SCHLUESSEL.publicKey, Buffer.from(kopf["telnyx-signature-ed25519"], "base64"));
  assert.ok(gueltig.length > 0 && gueltig.every(pruefe));
  assert.ok(ungueltig.length > 0 && ungueltig.every((webhook) => !pruefe(webhook)));
  assert.equal(gueltig.length, ungueltig.length);
});

test("H3 Webhooks: signerAusPem signiert wie Telnyx, Zeitstempel und Rumpf getrennt durch einen senkrechten Strich", () => {
  const [webhook] = baueWebhooks(signerAusPem(PEM), 1, 1700000000);
  assert.equal(webhook.kopf["telnyx-timestamp"], "1700000000");
  assert.ok(
    crypto.verify(null, Buffer.from(`1700000000|${webhook.koerper}`), SCHLUESSEL.publicKey, Buffer.from(webhook.kopf["telnyx-signature-ed25519"], "base64")),
  );
});

const ABBRUECHE = [
  ["Staging meldet einen anderen Stand", { commit: "f".repeat(40) }, /stand_unerwartet/, ["/healthz"]],
  ["Staging meldet echte Telefonie", { anrufe: "echt" }, /anrufe_nicht_belegt_ohne_echte_telefonie/, ["/healthz", "/intern/status"]],
  ["Staging meldet gesperrte Anrufe, die sich nicht messen lassen", { anrufe: "gesperrt" }, /anrufe_nicht_belegt_ohne_echte_telefonie/, ["/healthz", "/intern/status"]],
  ["Staging meldet die Anruflage gar nicht", { anrufe: null }, /anrufe_nicht_belegt_ohne_echte_telefonie/, ["/healthz", "/intern/status"]],
];

for (const [name, abweichung, grund, pfade] of ABBRUECHE) {
  test(`SG-30 Staging-Lastlauf bricht vor dem ersten Request des Laufs ab: ${name}`, async () => {
    const { stand, optionen } = aufbau(abweichung);
    await assert.rejects(fuehreStagingLastlaufAus(optionen), grund);
    assert.deepEqual(stand.urls.map((url) => new URL(url).pathname), pfade);
    assert.deepEqual(stand.k6, []);
  });
}

test("H3 Abbruch: ein fehlendes Geheimnis stoppt den Lauf, bevor Staging angefragt wird", async () => {
  for (const name of Object.keys(UMGEBUNG)) {
    const { stand, optionen } = aufbau();
    const umgebung = { ...UMGEBUNG, [name]: "  " };
    await assert.rejects(fuehreStagingLastlaufAus({ ...optionen, umgebung }), new RegExp(`${name}_fehlt`));
    assert.deepEqual(stand.urls, []);
    assert.deepEqual(stand.k6, []);
  }
});

test("H3 Abbruch: ist Staging nicht erreichbar oder lehnt den Statusschluessel ab, laeuft kein k6", async () => {
  const { stand, optionen } = aufbau();
  const unerreichbar = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(fuehreStagingLastlaufAus({ ...optionen, abfrage: unerreichbar }), /staging_nicht_erreichbar/);
  const abgelehnt = aufbau({ statusHttp: HTTP_UNAUTHORIZED, anrufe: null });
  await assert.rejects(fuehreStagingLastlaufAus(abgelehnt.optionen), /anrufe_nicht_belegt_ohne_echte_telefonie/);
  assert.deepEqual([stand.k6, abgelehnt.stand.k6], [[], []]);
});

test("H3 Ergebnis: ausgelassene Routen gehen nicht in die Bewertung ein, alle anderen bleiben, auch ohne Messwert", () => {
  const alle = Object.keys(ROUTEN_BUDGET_MS);
  assert.deepEqual(baueErgebnis({}).routen.map((route) => route.name), alle);
  const ohne = baueErgebnis({}, ["route_app_login", "route_webhook_elevenlabs"]).routen.map((route) => route.name);
  assert.deepEqual(ohne, alle.filter((name) => name !== "route_app_login" && name !== "route_webhook_elevenlabs"));
});

test("H3 Ergebnis: Szenarien werden nach Namen gewaehlt, ohne Angabe laufen alle", () => {
  const alle = { a: 1, b: 2, c: 3 };
  assert.equal(waehleSzenarien(alle, undefined), alle);
  assert.deepEqual(waehleSzenarien(alle, ["a", "c"]), { a: 1, c: 3 });
  assert.deepEqual(waehleSzenarien(alle, []), {});
});
