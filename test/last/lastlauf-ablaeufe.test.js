import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { baueErgebnis, ROUTEN_BUDGET_MS } from "../../scripts/last/ergebnis.js";
import { fuehreLastlaufAus } from "../../scripts/last/lauf.mjs";
import { bewerteLauf } from "../../scripts/last/schwellen.mjs";
import { STAGING_ADRESSE } from "../../scripts/last/ziel.mjs";
import { baueWebhooks } from "../../scripts/last/umgebung.mjs";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { postgresVorhanden } from "../anrufe/hermes-mit-postgres.js";
import { makeTelnyxSigner, nowSeconds, startServer } from "../helpers.js";

const ZEITGRENZE_MS = 180_000;
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const K6_ATTRAPPE = fileURLToPath(new URL("./k6-attrappe.mjs", import.meta.url));
const MS_JE_SEKUNDE = 1000;

const metrik = (werte) => ({ values: werte });
const routenMetriken = (istMs) =>
  Object.fromEntries(Object.keys(ROUTEN_BUDGET_MS).map((name) => [name, metrik({ "p(95)": istMs(name) })]));
const daten = ({ anfragen = 1000, fehlgeschlagen = 0, ablaufFehler = 0, gestartet = 9, beendet = 9, wartezeitMs = 150, routen = (name) => ROUTEN_BUDGET_MS[name] } = {}) => ({
  metrics: {
    http_reqs: metrik({ count: anfragen }),
    http_req_failed: metrik({ passes: fehlgeschlagen }),
    ablauf_fehler: metrik({ count: ablaufFehler }),
    anrufe_gestartet: metrik({ count: gestartet }),
    anrufe_beendet: metrik({ count: beendet }),
    anruf_wartezeit: metrik({ max: wartezeitMs }),
    ...routenMetriken(routen),
  },
});

const ERGEBNIS_FAELLE = [
  ["alles im Rahmen", daten(), true, []],
  ["4 von 1000 Anfragen fehlgeschlagen", daten({ fehlgeschlagen: 4 }), true, []],
  ["5 von 1000 Anfragen fehlgeschlagen", daten({ fehlgeschlagen: 5 }), false, ["fehlerquote"]],
  ["Ablauffehler zaehlen zur Fehlerquote", daten({ fehlgeschlagen: 2, ablaufFehler: 3 }), false, ["fehlerquote"]],
  ["ein Anruf gestartet und nicht beendet", daten({ beendet: 8 }), false, ["verlorene_anrufe"]],
  ["Wartezeit genau 120 s", daten({ wartezeitMs: 120 * MS_JE_SEKUNDE }), true, []],
  ["Wartezeit 121 s", daten({ wartezeitMs: 121 * MS_JE_SEKUNDE }), false, ["wartezeit"]],
  [
    "Webhook-Route ueber Budget",
    daten({ routen: (name) => ROUTEN_BUDGET_MS[name] + (name === "route_webhook_telnyx" ? 1 : 0) }),
    false,
    ["route_ueber_budget:route_webhook_telnyx"],
  ],
  ["kein Anruf gestartet", daten({ gestartet: 0, beendet: 0 }), false, ["messwert_fehlt:verlorene_anrufe"]],
  ["keine Anfrage gezaehlt", daten({ anfragen: 0 }), false, ["messwert_fehlt:fehlerquote"]],
  ["Messwerte fehlen ganz", {}, false, ["messwert_fehlt:fehlerquote", "messwert_fehlt:verlorene_anrufe", "messwert_fehlt:wartezeit"]],
];

for (const [name, eingabe, gruen, gruende] of ERGEBNIS_FAELLE) {
  test(`H2a Auswertung: ${name}`, () => {
    const urteil = bewerteLauf(baueErgebnis(eingabe));
    assert.equal(urteil.gruen, gruen);
    assert.deepEqual(urteil.gruende.filter((grund) => !grund.startsWith("messwert_fehlt:route_")), gruende);
  });
}

test("H2a Auswertung: Wartezeit in Sekunden, Anrufverlust als Differenz, Routen mit Budget", () => {
  const ergebnis = baueErgebnis(daten({ gestartet: 9, beendet: 7, wartezeitMs: 2500, fehlgeschlagen: 5, ablaufFehler: 5 }));
  assert.equal(ergebnis.wartezeitSekunden, 2.5);
  assert.equal(ergebnis.verloreneAnrufe, 2);
  assert.equal(ergebnis.fehlerquoteProzent, 1);
  assert.deepEqual(ergebnis.routen[0], { name: "route_mcp_anmeldung", budgetMs: 500, istMs: 500 });
  assert.equal(ergebnis.routen.length, Object.keys(ROUTEN_BUDGET_MS).length);
});

test("H2a Webhooks: gueltig signierter Telnyx-Webhook wird angenommen, falsch signierter mit 403 abgewiesen", { timeout: ZEITGRENZE_MS }, async () => {
  const signer = makeTelnyxSigner();
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64 },
  });
  try {
    const sende = (webhook) =>
      abrufMitFrist(`${srv.localUrl}/voice/status`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...webhook.kopf },
        body: webhook.koerper,
      });
    const jetzt = nowSeconds();
    const [gueltig] = baueWebhooks(signer, 1, jetzt);
    const [fremd] = baueWebhooks(makeTelnyxSigner(), 1, jetzt);
    const [abgelaufen] = baueWebhooks(signer, 1, jetzt - 3600);
    assert.equal((await sende(gueltig)).status, HTTP_OK);
    assert.equal((await sende(fremd)).status, HTTP_FORBIDDEN);
    assert.equal((await sende(abgelaufen)).status, HTTP_FORBIDDEN);
    assert.equal((await sende({ koerper: gueltig.koerper, kopf: {} })).status, HTTP_FORBIDDEN);
    const webhooks = baueWebhooks(signer, 3, jetzt);
    assert.equal(new Set(webhooks.map((eintrag) => eintrag.koerper)).size, 3);
  } finally {
    await srv.stop();
  }
});

const ergebnisDatei = (werte) => ({ fehlerquoteProzent: 0, verloreneAnrufe: 0, wartezeitSekunden: 1, routen: [{ name: "r", istMs: 1, budgetMs: 2 }], ...werte });

function umgebungMit(ziele, konfiguration) {
  const stand = { geschlossen: 0 };
  return { stand, starte: async () => ({ ziele, konfiguration, schliessen: async () => void (stand.geschlossen += 1) }) };
}

const k6Befehl = [process.execPath, K6_ATTRAPPE];
const LOKAL = ["http://localhost:3999", "http://127.0.0.1:3998"];

test("H2a Treiber: k6 bekommt die Konfiguration, das Ergebnis geht durch die Schwellen und die Umgebung wird geschlossen", async () => {
  const gruen = umgebungMit(LOKAL, { ergebnis: ergebnisDatei({}) });
  const urteil = await fuehreLastlaufAus({ k6Befehl, starte: gruen.starte });
  assert.equal(urteil.urteil.gruen, true);
  assert.equal(urteil.ergebnis.wartezeitSekunden, 1);
  assert.equal(gruen.stand.geschlossen, 1);
  const rot = umgebungMit(LOKAL, { ergebnis: ergebnisDatei({ fehlerquoteProzent: 0.5 }) });
  const schlecht = await fuehreLastlaufAus({ k6Befehl, starte: rot.starte });
  assert.deepEqual(schlecht.urteil, { gruen: false, gruende: ["fehlerquote"] });
  assert.equal(rot.stand.geschlossen, 1);
});

test("H2a Treiber: endet k6 mit Fehler, bricht der Lauf ab und schliesst die Umgebung", async () => {
  const umgebung = umgebungMit(LOKAL, { k6Exit: 3 });
  await assert.rejects(fuehreLastlaufAus({ k6Befehl, starte: umgebung.starte }), /k6 endete mit 3/);
  assert.equal(umgebung.stand.geschlossen, 1);
});

const FREMDE_ZIELE = [
  ["https://hermes.sundartha.com", "Produktion"],
  ["https://vodafone-agent.onrender.com", "Produktion (alter Name)"],
  [STAGING_ADRESSE, "Staging im CI-Lauf"],
  ["https://fremd.example.com", "fremde Adresse"],
  ["", "leere Adresse"],
];

for (const [fremd, name] of FREMDE_ZIELE) {
  test(`H2a Treiber: Ziel ${name} bricht vor dem ersten Request ab, auch wenn nur eines von zweien fremd ist`, async () => {
    const umgebung = umgebungMit([LOKAL[0], fremd], { k6Exit: 9, ergebnis: ergebnisDatei({}) });
    await assert.rejects(
      fuehreLastlaufAus({ k6Befehl: [process.execPath, "--eval", "process.exit(7)"], starte: umgebung.starte }),
      /Lastlauf abgebrochen: (ziel_nicht_erlaubt|adresse_unlesbar)/,
    );
    assert.equal(umgebung.stand.geschlossen, 1);
  });
}

test("H2a Lauf: fuenf Ablaeufe gegen zwei Prozesse mit Postgres und Attrappen enden gruen (mit k6 aus K6_BEFEHL)", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!process.env.K6_BEFEHL) return t.skip("kein k6 (K6_BEFEHL fehlt)");
  if (!postgresVorhanden()) return;
  const lauf = await fuehreLastlaufAus({ k6Befehl: process.env.K6_BEFEHL.split(" ") });
  assert.deepEqual(lauf.urteil, { gruen: true, gruende: [] });
  assert.equal(lauf.ergebnis.verloreneAnrufe, 0);
  assert.equal(lauf.ergebnis.fehlerquoteProzent, 0);
});
