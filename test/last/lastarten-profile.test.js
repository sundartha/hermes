import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { szenarienFuerArt } from "../../scripts/last/arten.mjs";
import { fuehreStagingLastlaufAus } from "../../scripts/last/staging.mjs";
import { STAGING_ADRESSE } from "../../scripts/last/ziel.mjs";

const STAGING = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const HTTP_OK = 200;
const SCHLUESSEL = crypto.generateKeyPairSync("ed25519");
const PEM = SCHLUESSEL.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const UMGEBUNG = Object.freeze({
  STAGING_STATUS_TOKEN: "status-token-nur-im-test-0123456789abcdef",
  STAGING_TEST_TOKEN: "test-token-nur-im-test",
  STAGING_TELNYX_PRIVATE_KEY: PEM,
  GITHUB_SHA: COMMIT,
});
const GRUEN = {
  fehlerquoteProzent: 0.1,
  verloreneAnrufe: 0,
  wartezeitSekunden: 3,
  routen: [{ name: "route_place_call", budgetMs: 1000, istMs: 200 }],
};
const BASIS = Object.freeze({
  mcp_anmeldung: { executor: "constant-vus", vus: 2, duration: "10s", exec: "mcpAnmeldung" },
  anruf: { executor: "per-vu-iterations", vus: 3, iterations: 3, maxDuration: "120s", exec: "anruf" },
  webhooks: { executor: "constant-arrival-rate", rate: 10, exec: "webhooks" },
});
const PRODUKTION = ["https://hermes.sundartha.com", "https://vodafone-agent.onrender.com", "http://127.0.0.1:3999"];

function aufbau(art) {
  const stand = { urls: [], k6: [] };
  const abfrage = async (url) => {
    stand.urls.push(url);
    const pfad = new URL(url).pathname;
    if (pfad === "/healthz") return new Response(JSON.stringify({ ok: true, commit: COMMIT }), { status: HTTP_OK });
    return new Response("{}", { status: HTTP_OK, headers: { "x-hermes-anrufe": "attrappe" } });
  };
  const fuehreAus = async (befehl, konfiguration) => {
    stand.k6.push(konfiguration);
    return GRUEN;
  };
  const umgebung = art === undefined ? UMGEBUNG : { ...UMGEBUNG, ART: art };
  return { stand, optionen: { umgebung, abfrage, fuehreAus, k6Befehl: ["k6"] } };
}

function job(name) {
  const treffer = STAGING.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z]+:\\n|(?![\\s\\S]))`, "m"));
  assert.ok(treffer, `Job ${name} fehlt in staging.yml`);
  return treffer[1];
}

const PROFILE = [
  ["last", { executor: "constant-vus", vus: 20, duration: "10m", gracefulStop: "120s", exec: "anruf" }],
  [
    "spitze",
    {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 40 },
        { duration: "2m", target: 40 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "120s",
      gracefulStop: "120s",
      exec: "anruf",
    },
  ],
  ["dauer", { executor: "constant-vus", vus: 20, duration: "60m", gracefulStop: "120s", exec: "anruf" }],
];

for (const [art, profil] of PROFILE) {
  test(`A2-A4 Profil: Art ${art} ersetzt nur den Anruf-Ablauf durch das feste Profil`, () => {
    assert.deepEqual(szenarienFuerArt(BASIS, art), { ...BASIS, anruf: profil });
  });
}

test("A2-A4 Profil: ohne Art oder mit kurz bleibt der Kurzlauf unveraendert", () => {
  assert.deepEqual(szenarienFuerArt(BASIS, "kurz"), BASIS);
  assert.deepEqual(szenarienFuerArt(BASIS, undefined), BASIS);
});

for (const [art] of PROFILE) {
  test(`A2-A4 Lauf: Art ${art} gibt der Staging-Konfiguration die Art mit, Schwellen und Ziel bleiben`, async () => {
    const { stand, optionen } = aufbau(art);
    const ergebnis = await fuehreStagingLastlaufAus(optionen);
    assert.deepEqual(ergebnis.urteil, { gruen: true, gruende: [] });
    assert.equal(stand.k6.length, 1);
    assert.equal(stand.k6[0].art, art);
    assert.deepEqual(stand.k6[0].ziele, [STAGING_ADRESSE]);
  });
}

for (const [name, art] of [["fehlt", undefined], ["leer", ""], ["kurz", "kurz"]]) {
  test(`A2-A4 Lauf: Art ${name} laeuft als Kurzlauf wie bisher`, async () => {
    const { stand, optionen } = aufbau(art);
    await fuehreStagingLastlaufAus(optionen);
    assert.equal(stand.k6[0].art, "kurz");
  });
}

for (const art of ["Stress", "Last", "last ", "__proto__", "constructor", "alle"]) {
  test(`A2-A4 Abbruch: unbekannte Art ${JSON.stringify(art)} bricht vor dem ersten Request ab`, async () => {
    const { stand, optionen } = aufbau(art);
    await assert.rejects(fuehreStagingLastlaufAus(optionen), /Staging-Lastlauf abgebrochen: art_unbekannt/);
    assert.deepEqual(stand.urls, []);
    assert.deepEqual(stand.k6, []);
  });
}

for (const art of ["kurz", "last", "spitze", "dauer"]) {
  for (const adresse of PRODUKTION) {
    test(`SG-30 A8 Art ${art} bricht gegen ${adresse} vor dem ersten Request ab`, async () => {
      const { stand, optionen } = aufbau(art);
      await assert.rejects(fuehreStagingLastlaufAus({ ...optionen, adresse }), /Lastlauf abgebrochen: ziel_nicht_erlaubt/);
      assert.deepEqual(stand.urls, []);
      assert.deepEqual(stand.k6, []);
    });
  }
}

test("A2-A4 Workflow: die Eingabe art kennt kurz, last, spitze, dauer und stress und hat keine Adresse", () => {
  assert.match(STAGING, /^ {6}art:\n {8}description: .+\n {8}type: choice\n {8}default: kurz\n {8}options:\n {10}- kurz\n {10}- last\n {10}- spitze\n {10}- dauer\n {10}- stress\n/m);
});

test("A2-A4 Workflow: der Lastlauf reicht die Art als Umgebungswert weiter, dauer bekommt mehr Zeit, Gruppe und Geheimnisse bleiben", () => {
  const text = job("lastlauf");
  assert.match(text, /^ {10}ART: \$\{\{ inputs\.art \}\}$/m);
  assert.match(text, /^ {4}timeout-minutes: \$\{\{ inputs\.art == 'dauer' && 80 \|\| inputs\.art == 'stress' && 60 \|\| inputs\.art == 'last' && 25 \|\| 15 \}\}$/m);
  assert.match(text, /^ {6}group: staging-push$/m);
  assert.match(text, /run: node scripts\/last\/staging\.mjs k6$/m);
  assert.deepEqual([...text.matchAll(/secrets\.(\w+)/g)].length, 5);
});

test("A2 Workflow: art last bekommt 25 Minuten Frist, dauer 80, stress 60, die uebrigen Arten 15", () => {
  const frist = job("lastlauf").match(/^ {4}timeout-minutes: \$\{\{ (.+) \}\}$/m)[1];
  const fristFuer = (art) => {
    const zweige = [...frist.matchAll(/inputs\.art == '(\w+)' && (\d+)/g)];
    const treffer = zweige.find((z) => z[1] === art);
    return treffer ? Number(treffer[2]) : Number(frist.match(/\|\| (\d+)$/)[1]);
  };
  assert.equal(fristFuer("last"), 25);
  assert.equal(fristFuer("dauer"), 80);
  assert.equal(fristFuer("stress"), 60);
  for (const art of ["kurz", "spitze", "leer"]) {
    assert.equal(fristFuer(art), 15);
  }
  const profil = szenarienFuerArt({}, "last").anruf;
  const sekunden = (wert) => Number(wert.slice(0, -1)) * { s: 1, m: 60 }[wert.slice(-1)];
  const anrufFristSekunden = Number(readFileSync("scripts/last/ablaeufe.js", "utf8").match(/^const ANRUF_FRIST_MS = (\d+);$/m)[1]) / 1000;
  const bedarfMinuten = (sekunden(profil.duration) + sekunden(profil.gracefulStop) + anrufFristSekunden) / 60;
  assert.ok(fristFuer("last") > bedarfMinuten);
});
