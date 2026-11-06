import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startServer, seedState, seedCall } from "../helpers.js";
import { starteJsonAttrappe } from "./attrappen-server.js";
import { starteAnbieterServer } from "../gemeinsam/anbieter-attrappe.mjs";
import { playTtsEnv, startSyntheseOrigin } from "../gemeinsam/play-tts-server.mjs";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import {
  starteBetterStackAttrappe,
  geheimerPfad,
  warteBis,
  warteAufMeldungen,
  konsoleMitschreiben,
} from "../gemeinsam/better-stack-attrappe.mjs";
import { starteHermesMitPglite, LOGIN_SUB } from "../abrechnung/server-mit-testdatenbank.js";

const HTTP_OK = 200;
const HTTP_ACCEPTED = 202;
const HTTP_GRENZE_2XX = 299;
const HTTP_ERSTER_NICHT_2XX = 300;
const HTTP_SERVER_FEHLER = 500;
const ALARM_SMS_ZIEL = "+491711234567";
const ALARM_POSTFACH = "alarm@b9.invalid";
const DRIFT_ANRUFE = 20;
const DRIFT_KOSTEN_MIKROCENT = 80_000_000;
const KEINE_NACHZUEGLER_MS = 400;
const SOFORT_ZURUECK_MS = 3000;
const BEWEISENDE_HERKUNFT = "telnyx_detail_records";
const DRIFT_PRAEFIX_TEXT = "[hermes] Tarif-Drift: ";
const TTS_ANTWORT = "Gut, ich habe alles notiert und melde mich morgen bei Ihnen.";
const TTS_ZAEHLER_VORHER = 700;
const MELDEZEILE_HOECHSTENS = 1000;
const LANGE_ZIFFERNFOLGE = "7".repeat(1100);
const LANGES_PRAEFIX = `+1${LANGE_ZIFFERNFOLGE}`;
const ZIFFERN_AUSSCHNITT = "7".repeat(40);

const betterStack = await starteBetterStackAttrappe();
const telnyx = await starteAnbieterServer(({ req, res, vermerke }) => {
  vermerke({ pfad: req.url });
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: { id: "msg_b9" } }));
});
after(() => Promise.all([betterStack.close(), telnyx.close()]));

Object.assign(process.env, {
  BETTERSTACK_ALERT_URL: betterStack.url,
  TELNYX_API_KEY: "KEYtest-b9",
  TELNYX_API_BASE: telnyx.url,
  COST_DRIFT_WARN_PERCENT: "50",
  COST_ALERT_DEBOUNCE_MS: "0",
  VOICE_TARIFF_DOMESTIC_CENTS: "20",
  VOICE_TARIFF_DOMESTIC_PREFIXES: "+49",
  PROVIDER_TO_BUCKET_RATE_MICRO: "1000000",
});
const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: ALARM_POSTFACH });
const { config } = await import("../../src/config.js");
const speicher = await import("../../src/store.js");
config.billing.platformAlertSmsTo = ALARM_SMS_ZIEL;
const nurTarifabweichungMeldet = { kostenHeartbeatFensterH: 0, costTruingMinCoveragePercent: 0 };
Object.assign(config.billing, nurTarifabweichungMeldet);

const { makeDueOutboundCall } = await import("../cost-truing-harness.js");

function driftAnruf(zustand, nummer, praefix = "+4930") {
  const nowMs = Date.now();
  const anruf = makeDueOutboundCall(zustand, { nowMs, endedMinutesAgo: nummer + 1, from: `${praefix}111222`, to: `${praefix}333444` });
  Object.assign(anruf, {
    costTruedSource: BEWEISENDE_HERKUNFT,
    costTruedAt: anruf.endedAt,
    actualCostMicroCents: DRIFT_KOSTEN_MIKROCENT,
  });
}

const zustand = speicher.load();
for (let nummer = 0; nummer < DRIFT_ANRUFE; nummer += 1) driftAnruf(zustand, nummer);
speicher.save();
await speicher.drainFlushes();

let sitzung = null;
async function betreiberSitzung(hermes) {
  if (sitzung) return sitzung;
  ({ sessionCookie: sitzung } = await hermes.anmelden());
  await hermes.db.query("UPDATE tenant SET status = 'active' WHERE id IN (SELECT tenant_id FROM account WHERE sub = $1)", [LOGIN_SUB]);
  return sitzung;
}

const smsAnfragen = () => telnyx.anfragen.filter((anfrage) => anfrage.pfad.includes("/messages"));

async function sweepAusloesen() {
  const hermes = laufendesHermes();
  const cookie = await betreiberSitzung(hermes);
  const vorher = { sms: smsAnfragen().length, mails: hermes.testPostfach.length };
  const beginn = Date.now();
  const antwort = await hermes.anfrage("/api/billing/cost-truing/sweep", { method: "POST", headers: { cookie } });
  const dauerMs = Date.now() - beginn;
  const text = await antwort.text();
  return {
    hermes,
    status: antwort.status,
    text,
    dauerMs,
    neueSms: () => smsAnfragen().length - vorher.sms,
    neueMails: () => hermes.testPostfach.length - vorher.mails,
  };
}

function mitAdresse(adresse) {
  config.billing.betterstackAlertUrl = adresse;
}

function zaehleUnbehandelte() {
  const gruende = [];
  const merken = (grund) => gruende.push(grund);
  process.on("unhandledRejection", merken);
  return { gruende, beenden: () => process.off("unhandledRejection", merken) };
}

const ohneNachzuegler = () => warteBis(() => false, KEINE_NACHZUEGLER_MS);
const zeilenMit = (zeilen, teil) => zeilen.filter((zeile) => zeile.includes(teil));

const angelegteAnrufPraefixe = ["+4930"];
async function sweepMitPraefixen(praefixe, erwarteteMeldungen = 1) {
  const neue = praefixe.filter((praefix) => !angelegteAnrufPraefixe.some((angelegt) => angelegt.startsWith(praefix)));
  if (neue.length > 0) {
    const zustandNeu = speicher.load();
    for (const praefix of neue) {
      for (let nummer = 0; nummer < DRIFT_ANRUFE; nummer += 1) driftAnruf(zustandNeu, nummer, praefix);
    }
    speicher.save();
    await speicher.drainFlushes();
    angelegteAnrufPraefixe.push(...neue);
  }
  const bisherigePraefixe = config.billing.voiceTariffDomesticPrefixes;
  config.billing.voiceTariffDomesticPrefixes = praefixe;
  try {
    const sweep = await sweepAusloesen();
    const meldungen = await warteAufMeldungen(betterStack, erwarteteMeldungen);
    await ohneNachzuegler();
    return { sweep, meldungen };
  } finally {
    config.billing.voiceTariffDomesticPrefixes = bisherigePraefixe;
  }
}

const sweepMitLangerMeldezeile = async () => (await sweepMitPraefixen([LANGES_PRAEFIX])).meldungen;

afterEach(() => {
  Object.assign(betterStack.verhalten, { status: HTTP_ACCEPTED, antwortetNicht: false, koerper: "" });
  betterStack.leeren();
  if ("betterstackAlertUrl" in config.billing) mitAdresse(betterStack.url);
});

test("S3 Tarifabweichung beim Kostenabgleich: genau ein Vorfall 'cost-truing:' an Better Stack, keine SMS, keine Mail", async () => {
  const sweep = await sweepAusloesen();
  assert.equal(sweep.status, HTTP_OK, "der Betreiber darf den Kostenabgleich auslösen");

  const meldungen = await warteAufMeldungen(betterStack);
  await ohneNachzuegler();
  assert.equal(betterStack.anfragen.length, 1, `${betterStack.anfragen.length} !== 1: genau ein POST an Better Stack`);
  assert.equal(betterStack.anfragen[0].methode, "POST");
  const [{ incident }] = meldungen;
  assert.equal(incident.status, "alert");
  assert.match(incident.id, /^cost-truing:/);
  assert.equal(sweep.neueSms(), 0, "keine SMS an die Telnyx-Attrappe");
  assert.equal(sweep.neueMails(), 0, "keine Mail an die Brevo-Attrappe");
});

test("S4 TTS-Kontingent überschreitet im Gesprächsschritt die Warnschwelle: genau ein Vorfall 'tts_quota_warning:', keine SMS", async () => {
  const sprachmodell = await starteJsonAttrappe({
    id: "msg_b9_tts",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text: TTS_ANTWORT }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 8, output_tokens: 6 },
  });
  const synthese = await startSyntheseOrigin((res) => res.end());
  const smsVorher = smsAnfragen().length;
  const mailsVorher = laufendesHermes().testPostfach.length;
  const jetzt = new Date();
  const zyklus = `${jetzt.getUTCFullYear()}-${String(jetzt.getUTCMonth() + 1).padStart(2, "0")}`;
  const seed = {
    ...seedState({ calls: [seedCall({ id: "call_b9tts", provider: "telnyx", status: "active", direction: "outbound" })] }),
    platformTtsUsage: { cycleKey: zyklus, characters: TTS_ZAEHLER_VORHER, warnedCycle: null },
  };
  const srv = await startServer({
    seed,
    env: {
      ...playTtsEnv(synthese.url),
      ANTHROPIC_BASE_URL: sprachmodell.url,
      TTS_CHARACTER_QUOTA: "1000",
      TTS_CHARACTER_QUOTA_WARN_PERCENT: "75",
      TTS_QUOTA_CYCLE_ANCHOR_DAY: "1",
      PLATFORM_ALERT_SMS_TO: ALARM_SMS_ZIEL,
      BETTERSTACK_ALERT_URL: betterStack.url,
      TELNYX_API_KEY: "KEYtest-b9",
      TELNYX_API_BASE: telnyx.url,
    },
  });
  try {
    const res = await abrufMitFrist(`http://127.0.0.1:${srv.port}/voice/turn?callId=call_b9tts`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Bitte notieren Sie meinen Wunsch." }),
    });
    assert.equal(res.status, HTTP_OK);
    await res.text();

    const meldungen = await warteAufMeldungen(betterStack);
    await ohneNachzuegler();
    assert.equal(betterStack.anfragen.length, 1, `${betterStack.anfragen.length} !== 1: genau ein POST an Better Stack`);
    const [{ incident }] = meldungen;
    assert.equal(incident.status, "alert");
    assert.match(incident.id, /^tts_quota_warning:/);
    assert.equal(smsAnfragen().length - smsVorher, 0, "keine SMS an die Telnyx-Attrappe");
    const { testPostfach } = laufendesHermes();
    assert.equal(testPostfach.length, mailsVorher, "keine Mail an die Brevo-Attrappe");
  } finally {
    await srv.stop();
    await Promise.all([sprachmodell.close(), synthese.close()]);
  }
});

async function beobachteSweep(pruefe) {
  const konsole = konsoleMitschreiben();
  const unbehandelt = zaehleUnbehandelte();
  try {
    const sweep = await sweepAusloesen();
    await warteAufMeldungen(betterStack);
    await ohneNachzuegler();
    assert.equal(sweep.status, HTTP_OK);
    await pruefe({ sweep, zeilen: konsole.zeilen });
    assert.deepEqual(unbehandelt.gruende, [], "kein verworfenes Versprechen");
  } finally {
    unbehandelt.beenden();
    konsole.beenden();
  }
}

test("[NIE1] Antwort 299 gilt als zugestellt: keine Fehlerzeile mit dem Status, kein Wurf zum Betreiber", async () => {
  betterStack.verhalten.status = HTTP_GRENZE_2XX;
  await beobachteSweep(({ zeilen }) => {
    assert.deepEqual(zeilenMit(zeilen, String(HTTP_GRENZE_2XX)), [], "2xx ist keine Fehlschlag-Zeile");
  });
});

test("[NIE1] Antwort 300 gilt als nicht zugestellt: eine Logzeile mit dem Status, der Betreiber bekommt trotzdem 200", async () => {
  betterStack.verhalten.status = HTTP_ERSTER_NICHT_2XX;
  const konsole = konsoleMitschreiben();
  const unbehandelt = zaehleUnbehandelte();
  try {
    const sweep = await sweepAusloesen();
    const geloggt = await warteBis(() => zeilenMit(konsole.zeilen, String(HTTP_ERSTER_NICHT_2XX)).length > 0);
    assert.equal(sweep.status, HTTP_OK);
    assert.ok(geloggt, "Fehlschlag mit HTTP-Status 300 steht im Log");
    assert.deepEqual(unbehandelt.gruende, [], "kein verworfenes Versprechen");
  } finally {
    unbehandelt.beenden();
    konsole.beenden();
  }
});

test("[NIE2] leere Adresse: nichts an Better Stack, keine SMS, Betreiber bekommt 200", async () => {
  mitAdresse("");
  const sweep = await sweepAusloesen();
  await ohneNachzuegler();
  assert.equal(sweep.status, HTTP_OK);
  assert.equal(betterStack.anfragen.length, 0, "ohne Adresse geht keine Anfrage hinaus");
  assert.equal(sweep.neueSms(), 0, "keine SMS als Ersatz");
});

async function sweepOhneVersuch(adresse) {
  mitAdresse(adresse);
  await beobachteSweep(({ sweep, zeilen }) => {
    assert.equal(betterStack.anfragen.length, 0, "ohne Adresse geht keine Anfrage hinaus");
    assert.deepEqual(zeilenMit(zeilen, "TypeError"), [], "ohne Adresse gibt es keinen Versuch und keine Fehlschlag-Zeile");
    assert.equal(sweep.neueSms(), 0, "keine SMS als Ersatz");
  });
}

async function adresseOhneVariable() {
  const gesichert = process.env.BETTERSTACK_ALERT_URL;
  delete process.env.BETTERSTACK_ALERT_URL;
  try {
    const frisch = await import("../../src/config.js?b9-ohne-betterstack-adresse");
    return frisch.config.billing.betterstackAlertUrl;
  } finally {
    process.env.BETTERSTACK_ALERT_URL = gesichert;
  }
}

test("[NIE2] leere Adresse: kein Versuch, also auch keine Fehlschlag-Zeile im Log", async () => {
  await sweepOhneVersuch("");
});

test("[NIE2] ohne gesetzte BETTERSTACK_ALERT_URL ist die Adresse leer: kein Versuch, keine Fehlschlag-Zeile", async () => {
  const adresse = await adresseOhneVariable();
  assert.equal(adresse, "", "ohne Variable liefert die Konfiguration eine leere Adresse");
  await sweepOhneVersuch(adresse);
});

test("[NIE3] Netzfehler: Logzeile mit Fehlername, ohne Fehlertext und ohne Adresse", async () => {
  const pfad = geheimerPfad();
  mitAdresse(`http://127.0.0.1:9${pfad}`);
  const konsole = konsoleMitschreiben();
  try {
    await sweepAusloesen();
    const geloggt = await warteBis(() => zeilenMit(konsole.zeilen, "TypeError").length > 0);
    assert.ok(geloggt, "der Fehlschlag steht mit dem Fehlernamen im Log");
    assert.deepEqual(zeilenMit(konsole.zeilen, pfad), [], "die Adresse steht nicht im Log");
    assert.deepEqual(zeilenMit(konsole.zeilen, "fetch failed"), [], "err.message steht nicht im Log");
    assert.deepEqual(zeilenMit(konsole.zeilen, "ECONNREFUSED"), [], "kein Fehlertext der Ursache im Log");
  } finally {
    konsole.beenden();
  }
});

test("[NIE4] POST mit JSON-Körper aus incident.id, incident.status und text an genau die Adresse", async () => {
  await sweepAusloesen();
  await warteAufMeldungen(betterStack);
  const [anfrage] = betterStack.anfragen;
  assert.ok(anfrage, "eine Anfrage kam an");
  assert.equal(anfrage.methode, "POST");
  assert.equal(anfrage.pfad, betterStack.pfad, "an genau die konfigurierte Adresse, ohne Anhang");
  assert.match(anfrage.art, /^application\/json/);
  assert.deepEqual(Object.keys(anfrage.koerper).sort(), ["incident", "text"]);
  assert.deepEqual(Object.keys(anfrage.koerper.incident).sort(), ["id", "status"]);
  assert.equal(typeof anfrage.koerper.incident.id, "string");
  assert.equal(typeof anfrage.koerper.text, "string");
});

test("[NIE5] die Aufrufer melden weiter Präfix und Detail als eine Meldezeile", async () => {
  await sweepAusloesen();
  const [meldung] = await warteAufMeldungen(betterStack);
  assert.ok(meldung, "die Tarifabweichung kam an");
  assert.ok(meldung.text.startsWith(DRIFT_PRAEFIX_TEXT), `Meldezeile beginnt mit dem Präfix (${meldung.text})`);
  assert.match(meldung.text, /praefix=\+49 stichproben=20 /);
});

test("[NIE6] nicht lesbare Adresse: gefangen, nur der Fehlername im Log, Betreiber bekommt 200", async () => {
  const pfad = geheimerPfad();
  mitAdresse(`http://[${pfad}`);
  const konsole = konsoleMitschreiben();
  const unbehandelt = zaehleUnbehandelte();
  try {
    const sweep = await sweepAusloesen();
    const geloggt = await warteBis(() => zeilenMit(konsole.zeilen, "TypeError").length > 0);
    assert.equal(sweep.status, HTTP_OK);
    assert.ok(geloggt, "der Fehler steht mit seinem Namen im Log");
    assert.deepEqual(zeilenMit(konsole.zeilen, pfad), [], "die Adresse steht nicht im Log");
    assert.deepEqual(zeilenMit(konsole.zeilen, "Failed to parse"), [], "err.message steht nicht im Log");
    assert.deepEqual(unbehandelt.gruende, [], "kein verworfenes Versprechen");
  } finally {
    unbehandelt.beenden();
    konsole.beenden();
  }
});

test("[NIE7] hängender Eingang: der Betreiber wartet nicht, höchstens ein Versuch, keine SMS", async () => {
  betterStack.verhalten.antwortetNicht = true;
  const sweep = await sweepAusloesen();
  await ohneNachzuegler();
  assert.equal(sweep.status, HTTP_OK);
  assert.ok(sweep.dauerMs < SOFORT_ZURUECK_MS, `der Kostenabgleich kehrt ohne Warten zurück (${sweep.dauerMs} ms)`);
  assert.ok(betterStack.anfragen.length <= 1, "höchstens ein Versuch");
  assert.equal(sweep.neueSms(), 0, "keine SMS");
});

test("[NIE7] Antwort 500: höchstens ein Versuch, keine Wiederholung, keine SMS", async () => {
  betterStack.verhalten.status = HTTP_SERVER_FEHLER;
  const sweep = await sweepAusloesen();
  await warteAufMeldungen(betterStack);
  await ohneNachzuegler();
  await ohneNachzuegler();
  assert.ok(betterStack.anfragen.length <= 1, "keine Wiederholung");
  assert.equal(sweep.neueSms(), 0, "keine SMS");
});

test("[NIE8] eine überlange Meldezeile kommt mit höchstens 1000 Zeichen an", async () => {
  const [meldung] = await sweepMitLangerMeldezeile();
  assert.ok(meldung, "die Tarifabweichung mit langem Präfix kam an");
  assert.ok(meldung.text.length <= MELDEZEILE_HOECHSTENS, `Meldezeile hat ${meldung.text.length} Zeichen`);
  assert.ok(meldung.text.startsWith(`${DRIFT_PRAEFIX_TEXT}praefix=+1${ZIFFERN_AUSSCHNITT}`), "der Anfang der Meldezeile bleibt erhalten");
});

test("[NIE9] die Meldezeile steht nur im Feld text, nie in Adresse oder Schlüssel", async () => {
  const [meldung] = await sweepMitLangerMeldezeile();
  assert.ok(meldung, "die Tarifabweichung mit langem Präfix kam an");
  const [anfrage] = betterStack.anfragen;
  assert.equal(anfrage.pfad, betterStack.pfad, "die Adresse bleibt die konfigurierte");
  assert.ok(!meldung.incident.id.includes(ZIFFERN_AUSSCHNITT), "der Schlüssel enthält keinen Teil der Meldezeile");
  assert.ok(meldung.text.includes(ZIFFERN_AUSSCHNITT), "die Meldezeile steht im Feld text");
  assert.ok(meldung.text.length <= MELDEZEILE_HOECHSTENS, "die Meldezeile ist begrenzt");
});

test("[NIE10] die Adresse steht weder im Log noch im Prüfprotokoll noch in der Antwort", async () => {
  betterStack.verhalten.status = HTTP_SERVER_FEHLER;
  await beobachteSweep(async ({ sweep, zeilen }) => {
    assert.ok(!sweep.text.includes(betterStack.pfad), "nicht in der Antwort");
    assert.deepEqual(zeilenMit(zeilen, betterStack.pfad), [], "nicht im Log");
    const { rows } = await sweep.hermes.db.query("SELECT detail FROM audit_log WHERE detail LIKE $1", [`%${betterStack.pfad}%`]);
    assert.deepEqual(rows, [], "nicht im Prüfprotokoll");
  });
});

test("[NIE11] Fehlschlag bei Better Stack: kein Rückfall per SMS oder Mail", async () => {
  betterStack.verhalten.status = HTTP_SERVER_FEHLER;
  const sweep = await sweepAusloesen();
  await warteAufMeldungen(betterStack);
  await ohneNachzuegler();
  assert.equal(sweep.neueSms(), 0, "keine SMS als Rückfall");
  assert.equal(sweep.neueMails(), 0, "keine Mail als Rückfall");
});

test("[NIE12] von der Antwort zählt nur der Status: 2xx mit unlesbarem Körper ist zugestellt, die Adresse bleibt verborgen", async () => {
  Object.assign(betterStack.verhalten, { status: HTTP_OK, koerper: "<<kein json" });
  await beobachteSweep(({ sweep, zeilen }) => {
    assert.deepEqual(zeilenMit(zeilen, "SyntaxError"), [], "der Körper wird nicht gelesen");
    assert.deepEqual(zeilenMit(zeilen, "kein json"), [], "der Körper landet nicht im Log");
    assert.ok(!sweep.text.includes(betterStack.pfad), "die Adresse steht nicht in der Antwort");
  });
});

const ERSTES_PRAEFIX = "+49";
const ZWEITES_PRAEFIX = "+43";
const KURZ_HASH_ZEICHEN = 8;
const VORFALL_SCHLUESSEL = /^cost-truing:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z):([0-9a-f]{8})$/;

const kurzHash = (zeile) => createHash("sha256").update(zeile).digest("hex").slice(0, KURZ_HASH_ZEICHEN);

test("S16 zwei Vorwahl-Präfixe weichen vom Tarif ab: zwei getrennte Vorfälle 'cost-truing:' mit verschiedenem Schlüssel", async () => {
  const { sweep, meldungen } = await sweepMitPraefixen([ERSTES_PRAEFIX, ZWEITES_PRAEFIX], 2);
  assert.equal(sweep.status, HTTP_OK, "der Betreiber darf den Kostenabgleich auslösen");
  assert.equal(betterStack.anfragen.length, 2, `${betterStack.anfragen.length} !== 2: genau zwei POST an Better Stack`);
  assert.deepEqual(
    betterStack.anfragen.map((anfrage) => anfrage.methode),
    ["POST", "POST"],
  );
  assert.deepEqual(
    meldungen.map(({ incident }) => incident.status),
    ["alert", "alert"],
  );
  const [ersteId, zweiteId] = meldungen.map(({ incident }) => incident.id);
  assert.match(ersteId, /^cost-truing:/);
  assert.match(zweiteId, /^cost-truing:/);
  assert.notStrictEqual(ersteId, zweiteId, "beide incident.id müssen strictly unequal sein: zwei Präfixe ergeben zwei Vorfälle");
});

test("[NIE1] die Tarifabweichung geht als alert mit Schlüssel aus Anlass, Zeitstempel und Kurz-Hash der Meldezeile, ohne SMS", async () => {
  const vorher = Date.now();
  const sweep = await sweepAusloesen();
  const [meldung] = await warteAufMeldungen(betterStack);
  await ohneNachzuegler();
  assert.ok(meldung, "die Tarifabweichung kam an");
  assert.equal(meldung.incident.status, "alert");
  assert.ok(meldung.text.startsWith(DRIFT_PRAEFIX_TEXT), "die Meldezeile ist Präfix plus Detail");
  const [, zeitstempel, hash] = meldung.incident.id.match(VORFALL_SCHLUESSEL) ?? [];
  assert.ok(zeitstempel, `Schlüssel hat die Form cost-truing:<ISO>:<Kurz-Hash> (${meldung.incident.id})`);
  const zeitpunkt = Date.parse(zeitstempel);
  assert.ok(zeitpunkt >= vorher && zeitpunkt <= Date.now(), "der Zeitstempel ist der Zeitpunkt der Meldung");
  assert.equal(new Date(zeitpunkt).toISOString(), zeitstempel, "der Zeitstempel ist ISO");
  assert.equal(hash, kurzHash(meldung.text), "der Kurz-Hash stammt aus der Meldezeile");
  assert.equal(sweep.neueSms(), 0, "messaging bleibt unbenutzt");
  assert.equal(sweep.neueMails(), 0, "keine Mail");
});

test("[NIE2] bei zwei Präfixen trägt jeder Schlüssel 'cost-truing:' und den Kurz-Hash seiner eigenen Meldezeile", async () => {
  const { meldungen } = await sweepMitPraefixen([ERSTES_PRAEFIX, ZWEITES_PRAEFIX], 2);
  assert.equal(meldungen.length, 2, "beide Tarifabweichungen kamen an");
  const texte = meldungen.map((meldung) => meldung.text);
  for (const praefix of [ERSTES_PRAEFIX, ZWEITES_PRAEFIX]) {
    assert.equal(zeilenMit(texte, `praefix=${praefix} `).length, 1, `je Präfix eine Meldezeile (${praefix})`);
  }
  for (const meldung of meldungen) {
    const [, , hash] = meldung.incident.id.match(VORFALL_SCHLUESSEL) ?? [];
    assert.equal(hash, kurzHash(meldung.text), `Kurz-Hash passt zur eigenen Meldezeile (${meldung.incident.id})`);
  }
  assert.equal(new Set(meldungen.map(({ incident }) => incident.id)).size, 2, "zwei Präfixe ergeben zwei Schlüssel");
});

test("[NIE3] eine überlange Meldezeile bleibt im Feld text; der Schlüssel besteht nur aus Anlass, Zeitstempel und Kurz-Hash", async () => {
  const [meldung] = await sweepMitLangerMeldezeile();
  assert.ok(meldung, "die Tarifabweichung mit langem Präfix kam an");
  assert.equal(betterStack.anfragen[0].pfad, betterStack.pfad, "die Adresse bleibt die konfigurierte");
  assert.match(meldung.incident.id, VORFALL_SCHLUESSEL, "der Schlüssel ist nur cost-truing:<ISO>:<Kurz-Hash>, ohne Teil der Meldezeile");
  assert.ok(meldung.text.length <= MELDEZEILE_HOECHSTENS, `Meldezeile hat ${meldung.text.length} Zeichen`);
  assert.ok(meldung.text.includes(ZIFFERN_AUSSCHNITT), "die Meldezeile steht im Feld text");
});
