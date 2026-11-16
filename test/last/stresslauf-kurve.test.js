import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { szenarienFuerArt } from "../../scripts/last/arten.mjs";
import { ersterEngpass, GRENZEN } from "../../scripts/last/engpass.mjs";
import { fuehreStagingLastlaufAus, meldeLauf } from "../../scripts/last/staging.mjs";
import { STAGING_ADRESSE } from "../../scripts/last/ziel.mjs";

const STAGING = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const HTTP_OK = 200;
const SCHLUESSEL = crypto.generateKeyPairSync("ed25519");
const PEM = SCHLUESSEL.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const UMGEBUNG = Object.freeze({
  ART: "stress",
  STAGING_STATUS_TOKEN: "status-token-nur-im-test-0123456789abcdef",
  STAGING_TEST_TOKEN: "test-token-nur-im-test",
  STAGING_TELNYX_PRIVATE_KEY: PEM,
  GITHUB_SHA: COMMIT,
  STAGING_METRIK_URL: "https://metriken.example.invalid",
  STAGING_METRIK_TOKEN: "metrik-token-nur-im-test",
});
const PUNKT = Object.freeze({
  anrufe: 20,
  fehlerquoteProzent: 0.1,
  httpP95Ms: 200,
  eventloopP99Ms: 20,
  dbPoolWartend: 0,
  warteschlangeAlterS: 1,
});
const punkt = (aenderung = {}) => ({ ...PUNKT, ...aenderung });

const ENGPASS_FAELLE = [
  ["Kurve leer", [], {}, undefined],
  ["keine Grenze gerissen", [punkt(), punkt({ anrufe: 30 })], {}, undefined],
  ["Fehlerquote genau 0,5 reisst", [punkt(), punkt({ anrufe: 30, fehlerquoteProzent: 0.5 })], {}, { stufe: 30, groesse: "fehlerquote", wert: 0.5, grenze: 0.5 }],
  ["Fehlerquote knapp darunter haelt", [punkt({ fehlerquoteProzent: 0.49 })], {}, undefined],
  ["http p95 genau 1000 haelt", [punkt({ httpP95Ms: 1000 })], {}, undefined],
  ["http p95 1001 reisst", [punkt(), punkt({ anrufe: 30, httpP95Ms: 1001 })], {}, { stufe: 30, groesse: "http_p95", wert: 1001, grenze: 1000 }],
  ["Eventloop p99 200 haelt", [punkt({ eventloopP99Ms: 200 })], {}, undefined],
  ["Eventloop p99 201 reisst", [punkt({ eventloopP99Ms: 201 })], {}, { stufe: 20, groesse: "eventloop_p99", wert: 201, grenze: 200 }],
  ["ein wartender Pool-Zugriff reisst", [punkt({ dbPoolWartend: 1 })], {}, { stufe: 20, groesse: "db_pool_wartend", wert: 1, grenze: 0 }],
  ["Warteschlangenalter 120 s haelt", [punkt({ warteschlangeAlterS: 120 })], {}, undefined],
  ["Warteschlangenalter 121 s reisst", [punkt({ warteschlangeAlterS: 121 })], {}, { stufe: 20, groesse: "warteschlangenalter", wert: 121, grenze: 120 }],
  [
    "zwei Groessen in derselben Stufe: feste Reihenfolge, die erste zaehlt",
    [punkt(), punkt({ anrufe: 30, dbPoolWartend: 2, eventloopP99Ms: 500 })],
    {},
    { stufe: 30, groesse: "eventloop_p99", wert: 500, grenze: 200 },
  ],
  [
    "fruehere Stufe gewinnt vor spaeterer Groesse",
    [punkt({ anrufe: 20, dbPoolWartend: 1 }), punkt({ anrufe: 30, fehlerquoteProzent: 2 })],
    {},
    { stufe: 20, groesse: "db_pool_wartend", wert: 1, grenze: 0 },
  ],
  ["fehlender Messwert reisst", [punkt({ eventloopP99Ms: null })], {}, { stufe: 20, groesse: "eventloop_p99", wert: null, grenze: 200 }],
  ["Messwert NaN reisst", [punkt({ httpP95Ms: Number.NaN })], {}, { stufe: 20, groesse: "http_p95", wert: null, grenze: 1000 }],
];

for (const [name, kurve, , erwartet] of ENGPASS_FAELLE) {
  test(`A7 ersterEngpass: ${name}`, () => {
    assert.deepEqual(ersterEngpass(kurve, GRENZEN), erwartet);
  });
}

test("A5 Profil: stress haelt die Stufe als gleichzeitige Anrufe 3 Minuten lang", () => {
  const basis = { mcp_anmeldung: { executor: "constant-vus" }, anruf: { executor: "per-vu-iterations" } };
  assert.deepEqual(szenarienFuerArt(basis, "stress", 50), {
    ...basis,
    anruf: { executor: "constant-vus", vus: 50, duration: "3m", gracefulStop: "120s", exec: "anruf" },
  });
});

function aufbau({ ergebnisJeStufe, metrik = (stufe) => ({ eventloop: 20, pool: 0, alter: 1, stufe }) }) {
  const stand = { urls: [], k6: [], metrikUrls: [] };
  const abfrage = async (url, optionen) => {
    const adresse = new URL(url);
    if (adresse.origin === UMGEBUNG.STAGING_METRIK_URL) {
      stand.metrikUrls.push({ adresse, kopf: optionen.headers, umleitung: optionen.redirect, frist: optionen.signal instanceof AbortSignal });
      const frage = adresse.searchParams.get("query");
      const stufe = stand.k6.at(-1).anrufe;
      const werte = metrik(stufe);
      const wert = frage.includes("eventloop") ? werte.eventloop : frage.includes("pool") ? werte.pool : werte.alter;
      return new Response(JSON.stringify({ status: "success", data: { result: [{ value: [0, String(wert)] }] } }), { status: HTTP_OK });
    }
    stand.urls.push(url);
    if (adresse.pathname === "/healthz") return new Response(JSON.stringify({ commit: COMMIT }), { status: HTTP_OK });
    return new Response("{}", { status: HTTP_OK, headers: { "x-hermes-anrufe": "attrappe" } });
  };
  const fuehreAus = async (befehl, konfiguration) => {
    stand.k6.push(konfiguration);
    return ergebnisJeStufe(konfiguration.anrufe);
  };
  return { stand, optionen: { umgebung: UMGEBUNG, abfrage, fuehreAus, k6Befehl: ["k6"] } };
}

const ergebnis = ({ fehler = 0.1, p95 = 200, wartezeit = 3 } = {}) => ({
  fehlerquoteProzent: fehler,
  verloreneAnrufe: 0,
  wartezeitSekunden: wartezeit,
  routen: [
    { name: "route_place_call", budgetMs: 1000, istMs: p95 },
    { name: "route_anruf_status", budgetMs: 500, istMs: 100 },
  ],
});

test("A5 Stufen: ohne Engpass steigt der Lauf von 20 in Zehnerschritten bis 100", async () => {
  const { stand, optionen } = aufbau({ ergebnisJeStufe: () => ergebnis() });
  const lauf = await fuehreStagingLastlaufAus(optionen);
  assert.deepEqual(stand.k6.map((konfig) => konfig.anrufe), [20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.ok(stand.k6.every((konfig) => konfig.art === "stress" && konfig.ziele[0] === STAGING_ADRESSE));
  assert.equal(lauf.kurve.length, 9);
  assert.equal(lauf.engpass, undefined);
  assert.deepEqual(lauf.urteil, { gruen: true, gruende: [] });
});

test("A5 Stufen: der Lauf endet in der Stufe, in der eine Grenze reisst", async () => {
  const { stand, optionen } = aufbau({ ergebnisJeStufe: (stufe) => ergebnis({ fehler: stufe >= 60 ? 0.7 : 0.1 }) });
  const lauf = await fuehreStagingLastlaufAus(optionen);
  assert.deepEqual(stand.k6.map((konfig) => konfig.anrufe), [20, 30, 40, 50, 60]);
  assert.deepEqual(lauf.engpass, { stufe: 60, groesse: "fehlerquote", wert: 0.7, grenze: 0.5 });
  assert.deepEqual(lauf.urteil, { gruen: true, gruende: [] });
});

test("A5 Stufen: eine gerissene Lauf-Schwelle ohne Kurvengroesse beendet den Lauf ebenfalls", async () => {
  const { stand, optionen } = aufbau({
    ergebnisJeStufe: (stufe) => ({ ...ergebnis(), verloreneAnrufe: stufe >= 40 ? 1 : 0 }),
  });
  const lauf = await fuehreStagingLastlaufAus(optionen);
  assert.deepEqual(stand.k6.map((konfig) => konfig.anrufe), [20, 30, 40]);
  assert.equal(lauf.engpass, undefined);
  assert.deepEqual(lauf.kurve.at(-1).schwellen, ["verlorene_anrufe"]);
  assert.deepEqual(lauf.kurve[0].schwellen, []);
});

test("A5 Urteil: reisst schon Stufe 20, ist der Lauf rot", async () => {
  const { stand, optionen } = aufbau({ ergebnisJeStufe: () => ergebnis({ fehler: 1 }) });
  const lauf = await fuehreStagingLastlaufAus(optionen);
  assert.equal(stand.k6.length, 1);
  assert.deepEqual(lauf.urteil, { gruen: false, gruende: ["fehlerquote"] });
});

test("A6 Kurve: je Stufe Anrufe, Fehlerquote, http p95, Eventloop p99, Pool wartend und Warteschlangenalter", async () => {
  const { optionen } = aufbau({
    ergebnisJeStufe: (stufe) => ergebnis({ fehler: stufe / 1000, p95: stufe * 5 }),
    metrik: (stufe) => ({ eventloop: stufe + 1, pool: 0, alter: stufe + 2 }),
  });
  const lauf = await fuehreStagingLastlaufAus(optionen);
  assert.deepEqual(lauf.kurve[1], {
    anrufe: 30,
    fehlerquoteProzent: 0.03,
    httpP95Ms: 150,
    eventloopP99Ms: 31,
    dbPoolWartend: 0,
    warteschlangeAlterS: 32,
    schwellen: [],
  });
});

test("A6 Metriken: je Stufe eine Abfrage je Groesse mit Token und dem Maximum ueber die 3 Minuten der Stufe", async () => {
  const { stand, optionen } = aufbau({ ergebnisJeStufe: () => ergebnis() });
  await fuehreStagingLastlaufAus({ ...optionen });
  assert.equal(stand.metrikUrls.length, 27);
  const [erste, zweite, dritte] = stand.metrikUrls;
  assert.equal(erste.umleitung, "error");
  assert.equal(erste.frist, true);
  assert.equal(erste.adresse.pathname, "/api/v1/query");
  assert.deepEqual(erste.kopf, { authorization: "Bearer metrik-token-nur-im-test" });
  assert.equal(erste.adresse.searchParams.get("query"), "max_over_time(max(hermes_eventloop_delay_p99)[3m:])");
  assert.equal(zweite.adresse.searchParams.get("query"), "max_over_time(max(hermes_db_pool_waiting)[3m:])");
  assert.equal(dritte.adresse.searchParams.get("query"), "max_over_time(max(hermes_queue_oldest_age)[3m:])");
});

test("A6 Ausgabe: Kurve als JSON-Artefakt, Engpass samt Stufe in der Zusammenfassung", () => {
  const dateien = {};
  const zeilen = [];
  const kurve = [punkt(), punkt({ anrufe: 30, dbPoolWartend: 3, schwellen: [] })];
  const engpass = { stufe: 30, groesse: "db_pool_wartend", wert: 3, grenze: 0 };
  const code = meldeLauf(
    { ergebnis: kurve[0], urteil: { gruen: true, gruende: [] }, kurve, engpass },
    { KURVE_DATEI: "kurve.json", GITHUB_STEP_SUMMARY: "zusammenfassung.md" },
    { schreibe: (pfad, text) => (dateien[pfad] = text), haengeAn: (pfad, text) => (dateien[pfad] = text), ausgabe: (text) => zeilen.push(text) },
  );
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(dateien["kurve.json"]), kurve);
  assert.match(dateien["zusammenfassung.md"], /Erster Engpass: db_pool_wartend bei 30 gleichzeitigen Anrufen \(Wert 3, Grenze 0\)/);
  assert.equal(zeilen.length, 1);
});

test("A6 Ausgabe: ohne Engpass nennt die Zusammenfassung die hoechste gehaltene Stufe, die Kurve liegt unter dem Standardnamen", () => {
  const dateien = {};
  const kurve = [punkt({ schwellen: [] }), punkt({ anrufe: 30, schwellen: [] })];
  const werkzeug = { schreibe: (pfad, text) => (dateien[pfad] = text), haengeAn: (pfad, text) => (dateien[pfad] = text), ausgabe: () => undefined };
  meldeLauf({ ergebnis: kurve[0], urteil: { gruen: true, gruende: [] }, kurve, engpass: undefined }, { GITHUB_STEP_SUMMARY: "z.md" }, werkzeug);
  assert.match(dateien["z.md"], /^## Kapazitätskurve\n\nKein Engpass bis 30 gleichzeitige Anrufe\n$/);
  assert.deepEqual(JSON.parse(dateien["kapazitaetskurve.json"]), kurve);
});

test("A6 Ausgabe: eine gerissene Lauf-Schwelle ohne Engpass steht mit Stufe in der Zusammenfassung", () => {
  const dateien = {};
  const kurve = [punkt({ schwellen: [] }), punkt({ anrufe: 30, schwellen: ["verlorene_anrufe", "wartezeit"] })];
  const werkzeug = { schreibe: () => undefined, haengeAn: (pfad, text) => (dateien[pfad] = text), ausgabe: () => undefined };
  meldeLauf({ ergebnis: kurve[0], urteil: { gruen: true, gruende: [] }, kurve, engpass: undefined }, { GITHUB_STEP_SUMMARY: "z.md" }, werkzeug);
  assert.match(dateien["z.md"], /Schwelle gerissen bei 30 gleichzeitigen Anrufen: verlorene_anrufe, wartezeit/);
});

test("A6 Ausgabe: ohne GITHUB_STEP_SUMMARY wird nur die Kurve geschrieben", () => {
  const aufrufe = [];
  const kurve = [punkt({ schwellen: [] })];
  const werkzeug = { schreibe: (pfad) => aufrufe.push(["schreibe", pfad]), haengeAn: (pfad) => aufrufe.push(["haengeAn", pfad]), ausgabe: () => undefined };
  meldeLauf({ ergebnis: kurve[0], urteil: { gruen: true, gruende: [] }, kurve }, {}, werkzeug);
  assert.deepEqual(aufrufe, [["schreibe", "kapazitaetskurve.json"]]);
});

test("A6 Ausgabe: rotes Urteil gibt Exit 1, ohne Kurve gibt es keine Datei", () => {
  const dateien = [];
  const werkzeug = { schreibe: (pfad) => dateien.push(pfad), haengeAn: (pfad) => dateien.push(pfad), ausgabe: () => undefined };
  const code = meldeLauf({ ergebnis: {}, urteil: { gruen: false, gruende: ["x"] } }, { KURVE_DATEI: "k.json", GITHUB_STEP_SUMMARY: "z.md" }, werkzeug);
  assert.equal(code, 1);
  assert.deepEqual(dateien, []);
});

test("A5 A6 Abbruch: ohne Metrik-Zugang bricht der Stresslauf vor dem ersten Request ab", async () => {
  for (const name of ["STAGING_METRIK_URL", "STAGING_METRIK_TOKEN"]) {
    const { stand, optionen } = aufbau({ ergebnisJeStufe: () => ergebnis() });
    const umgebung = { ...UMGEBUNG, [name]: " " };
    await assert.rejects(fuehreStagingLastlaufAus({ ...optionen, umgebung }), new RegExp(`Staging-Lastlauf abgebrochen: ${name}_fehlt`));
    assert.deepEqual(stand.urls, []);
    assert.deepEqual(stand.k6, []);
  }
});

test("A5 A6 Abbruch: eine unlesbare Metrik-Antwort bricht den Stresslauf ab statt zu raten", async () => {
  const { stand, optionen } = aufbau({ ergebnisJeStufe: () => ergebnis() });
  const abfrage = async (url, kopf) => (new URL(url).origin === UMGEBUNG.STAGING_METRIK_URL ? new Response("{}", { status: HTTP_OK }) : optionen.abfrage(url, kopf));
  await assert.rejects(fuehreStagingLastlaufAus({ ...optionen, abfrage }), /Staging-Lastlauf abgebrochen: metrik_unlesbar/);
  assert.equal(stand.k6.length, 1);
});

const METRIK_FEHLER = [
  ["Antwort 500 mit gueltigem Koerper", async () => new Response(JSON.stringify({ data: { result: [{ value: [0, "1"] }] } }), { status: 500 }), "metrik_unlesbar"],
  ["Antwort ohne Reihe", async () => new Response(JSON.stringify({ data: { result: [] } }), { status: HTTP_OK }), "metrik_unlesbar"],
  ["Antwort kein JSON", async () => new Response("kein json", { status: HTTP_OK }), "metrik_unlesbar"],
  ["Verbindung scheitert", async () => Promise.reject(new Error("netz")), "metrik_nicht_erreichbar"],
];

for (const [name, antwort, grund] of METRIK_FEHLER) {
  test(`A5 A6 Abbruch: Metrik ${name} bricht mit ${grund} ab`, async () => {
    const { optionen } = aufbau({ ergebnisJeStufe: () => ergebnis() });
    const abfrage = async (url, kopf) => (new URL(url).origin === UMGEBUNG.STAGING_METRIK_URL ? antwort() : optionen.abfrage(url, kopf));
    await assert.rejects(fuehreStagingLastlaufAus({ ...optionen, abfrage }), new RegExp(`Staging-Lastlauf abgebrochen: ${grund}`));
  });
}

for (const adresse of ["https://hermes.sundartha.com", "https://vodafone-agent.onrender.com", "http://127.0.0.1:3999"]) {
  test(`SG-30 A8 Art stress bricht gegen ${adresse} vor dem ersten Request ab`, async () => {
    const { stand, optionen } = aufbau({ ergebnisJeStufe: () => ergebnis() });
    await assert.rejects(fuehreStagingLastlaufAus({ ...optionen, adresse }), /Lastlauf abgebrochen: ziel_nicht_erlaubt/);
    assert.deepEqual(stand.urls, []);
    assert.deepEqual(stand.metrikUrls, []);
    assert.deepEqual(stand.k6, []);
  });
}

test("A5 Workflow: art kennt stress, der Lauf reicht den Metrik-Zugang weiter, laedt die Kurve hoch und hat 60 Minuten", () => {
  assert.match(STAGING, /^ {10}- dauer\n {10}- stress\n/m);
  assert.match(STAGING, /^ {4}timeout-minutes: \$\{\{ inputs\.art == 'dauer' && 80 \|\| inputs\.art == 'stress' && 60 \|\| inputs\.art == 'last' && 25 \|\| 15 \}\}$/m);
  assert.match(STAGING, /^ {10}STAGING_METRIK_URL: \$\{\{ secrets\.STAGING_METRIK_URL \}\}$/m);
  assert.match(STAGING, /^ {10}STAGING_METRIK_TOKEN: \$\{\{ secrets\.STAGING_METRIK_TOKEN \}\}$/m);
  assert.match(STAGING, /if: \$\{\{ always\(\) && inputs\.art == 'stress' \}\}\n {8}uses: actions\/upload-artifact@[0-9a-f]{40}\n {8}with:\n {10}name: kapazitaetskurve\n {10}path: kapazitaetskurve\.json\n {10}if-no-files-found: ignore/);
});
