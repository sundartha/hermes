import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "./server-mit-testdatenbank.js";
import { echtWarten } from "../echt-warten.js";

const SWEEP_TAKT_MS = 60_000;
const POLL_TAKT_MS = 20;
const ABGLEICH_ZEILE = "[cost-cross-check] monat=";
const MELDUNG = "Abgleich fragt nicht den Vormonat ab";

process.env.COST_TRUING_SWEEP_INTERVAL_MS = String(SWEEP_TAKT_MS);
const sweepTakte = [];
const fabrikIntervall = mock.method(globalThis, "setInterval", (aufruf, takt) => {
  if (takt === SWEEP_TAKT_MS) sweepTakte.push(aufruf);
  return { unref() {} };
});
const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "postfach@abgleich.invalid", anrufstartAbgelehnt: true });
fabrikIntervall.mock.restore();
const abgleichZeilen = [];
const echtesLog = console.log;
mock.method(console, "log", (...teile) => {
  const zeile = teile.join(" ");
  if (zeile.startsWith(ABGLEICH_ZEILE)) abgleichZeilen.push(zeile);
  else echtesLog(...teile);
});
mock.timers.enable({ apis: ["Date"], now: Date.now() });
const store = await import("../../src/store.js");

function abgleichIstDurchgelaufen() {
  return new Promise((fertig) => setImmediate(fertig));
}

async function sweepAm(jetztIso, bisherGeprueft) {
  laufendesHermes();
  abgleichZeilen.length = 0;
  store.load().costCrossCheck.lastCheckedMonthKey = bisherGeprueft;
  store.save();
  await store.drainFlushes();
  mock.timers.setTime(Date.parse(jetztIso));
  for (const lauf of sweepTakte) lauf();
  await abgleichIstDurchgelaufen();
  await store.drainFlushes();
  return store.load().costCrossCheck.lastCheckedMonthKey;
}

function keinAbgleichGelaufen() {
  assert.deepEqual(abgleichZeilen, [], MELDUNG);
}

test("Kostenabgleich im Sweep-Takt, 01.06.2026 mit geprüftem April: Mai", async () => {
  assert.equal(await sweepAm("2026-06-01T12:00:00.000Z", "2026-04"), "2026-05", MELDUNG);
});

test("Kostenabgleich im Sweep-Takt, 31.05.2026 mit geprüftem März: April, nie der Mai", async () => {
  assert.equal(await sweepAm("2026-05-31T12:00:00.000Z", "2026-03"), "2026-04", MELDUNG);
});

test("Kostenabgleich im Sweep-Takt, 15.08.2026: Juli", async () => {
  assert.equal(await sweepAm("2026-08-15T12:00:00.000Z", "2026-06"), "2026-07", MELDUNG);
});

test("Kostenabgleich im Sweep-Takt, 01.01.2027: Dezember 2026", async () => {
  assert.equal(await sweepAm("2027-01-01T12:00:00.000Z", "2026-11"), "2026-12", MELDUNG);
});

test("Kostenabgleich im Sweep-Takt, 31.03.2026: Februar, nie der März", async () => {
  assert.equal(await sweepAm("2026-03-31T12:00:00.000Z", "2026-01"), "2026-02", MELDUNG);
});

test("Kostenabgleich im Sweep-Takt, 30.03.2028 (Schaltjahr): Februar", async () => {
  assert.equal(await sweepAm("2028-03-30T12:00:00.000Z", "2028-01"), "2028-02", MELDUNG);
});

test("Kostenabgleich im Sweep-Takt, 29.03.2028 (Schaltjahr): Februar", async () => {
  assert.equal(await sweepAm("2028-03-29T12:00:00.000Z", "2028-01"), "2028-02", MELDUNG);
});

test("Kostenabgleich im Sweep-Takt, 31.05.2026 mit geprüftem April: nichts fällig", async () => {
  assert.equal(await sweepAm("2026-05-31T12:00:00.000Z", "2026-04"), "2026-04", MELDUNG);
  keinAbgleichGelaufen();
});

test("Kostenabgleich im Sweep-Takt, 29.03.2026 mit geprüftem Februar: nichts fällig", async () => {
  assert.equal(await sweepAm("2026-03-29T12:00:00.000Z", "2026-02"), "2026-02", MELDUNG);
  keinAbgleichGelaufen();
});

test("Kostenabgleich im Sweep-Takt, 15.08.2026 mit geprüftem Juli (kein zweites Mal): nichts fällig", async () => {
  assert.equal(await sweepAm("2026-08-15T12:00:00.000Z", "2026-07"), "2026-07", MELDUNG);
  keinAbgleichGelaufen();
});

const { after } = await import("node:test");
const { default: http } = await import("node:http");
const { startServer, seedState, PLAN_PRICE_BOOT_ENV } = await import("../helpers.js");
const { config } = await import("../../src/config.js");

const SECHS_STUNDEN_MS = 21_600_000;
const TAG_MS = 86_400_000;
const MS_JE_SEKUNDE = 1000;
const AUFBEWAHRUNG_TAGE = 30;
const KIND_SWEEP_TAKT_MS = 61_000;
const KIND_KURZER_TAKT_MS = 50;
const AUSGABE_FRIST_MS = 15_000;
const KIND_FRIST = { timeout: 45_000 };
const ALTER_ANRUF_ID = "call_aufbewahrung_alt";
const LOESCHZEILE = "[retention] geloescht: 1 Calls";
const BOOT_BANNER = "Hermes Gateway laeuft auf";
const HTTP_NICHT_GEFUNDEN = 404;
const ZEILEN_DER_SIEBEN_WAECHTER = [
  "[cost-truing] sweep trigger=interval",
  "[number-month] faellig=",
  "[cost-cross-check] monat=",
  "[outage] alert_channel_self_test",
  "[paid-no-number] kandidaten=",
  "[provision-retry-sweep] geprueft=",
  "[price-drift] anlass=sweep",
];
const TAKT_SONDE = [
  "const sweepTakt = Number(process.env.COST_TRUING_SWEEP_INTERVAL_MS);",
  "const echtesSetInterval = globalThis.setInterval;",
  "let laufendeNummer = 0;",
  "globalThis.setInterval = (aufruf, abstand, ...rest) => {",
  "  laufendeNummer += 1;",
  "  const nummer = laufendeNummer;",
  "  process.stdout.write(`[takt-sonde] takt nr=${nummer} sekunden=${abstand / 1000}\\n`);",
  `  const zeitgeber = echtesSetInterval(aufruf, abstand === sweepTakt ? ${KIND_KURZER_TAKT_MS} : abstand, ...rest);`,
  "  const echtesUnref = zeitgeber.unref.bind(zeitgeber);",
  "  zeitgeber.unref = () => {",
  "    process.stdout.write(`[takt-sonde] unref nr=${nummer}\\n`);",
  "    return echtesUnref();",
  "  };",
  "  return zeitgeber;",
  "};",
].join("\n");

const anrufVorlage = structuredClone(store.load().calls[0]);
let kindHermes = null;

after(async () => {
  const kind = await kindHermes?.catch(() => null);
  await kind?.srv.stop();
  kind?.stripe.close();
});

function echteJetztMs() {
  return performance.timeOrigin + performance.now();
}

async function stripeOhnePreise() {
  const stripe = http.createServer((_anfrage, antwort) => {
    antwort.writeHead(HTTP_NICHT_GEFUNDEN, { "content-type": "application/json" });
    antwort.end("{}");
  });
  await new Promise((fertig) => stripe.listen(0, "127.0.0.1", fertig));
  return stripe;
}

async function starteKindprozess() {
  const stripe = await stripeOhnePreise();
  const endeVorFrist = new Date(echteJetztMs() - (AUFBEWAHRUNG_TAGE + 1) * TAG_MS).toISOString();
  const seed = seedState({ calls: [{ id: ALTER_ANRUF_ID, direction: "inbound", status: "completed", endedAt: endeVorFrist }] });
  const srv = await startServer({
    seed,
    env: {
      RETENTION_DAYS: String(AUFBEWAHRUNG_TAGE),
      COST_TRUING_SWEEP_INTERVAL_MS: String(KIND_SWEEP_TAKT_MS),
      OUTAGE_ALERT_SELF_TEST_INTERVAL_MS: String(TAG_MS),
      PAID_WITHOUT_NUMBER_GRACE_MS: String(TAG_MS),
      PROVISIONING_RETRY_MIN_INTERVAL_MS: String(TAG_MS),
      PAYMENT_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_takt",
      STRIPE_WEBHOOK_SECRET: "whsec_test_takt",
      STRIPE_API_BASE: `http://127.0.0.1:${stripe.address().port}`,
      NUMBER_SETUP_FEE_CENTS: "500",
      PRICE_DRIFT_MIN_INTERVAL_MS: "1",
      ...PLAN_PRICE_BOOT_ENV,
      NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(TAKT_SONDE)}`,
    },
  });
  return { srv, stripe };
}

function hermesImKindprozess() {
  kindHermes ??= starteKindprozess();
  return kindHermes;
}

async function warteAufAusgabe(srv, zeile) {
  for (let gewartet = 0; gewartet < AUSGABE_FRIST_MS && !srv.stdout.includes(zeile); gewartet += POLL_TAKT_MS) {
    await echtWarten(POLL_TAKT_MS);
  }
  return srv.stdout.includes(zeile);
}

function takteMitAbstand(ausgabe, abstand) {
  const geloest = new Set([...ausgabe.matchAll(/\[takt-sonde\] unref nr=(\d+)/g)].map(([, nummer]) => nummer));
  return [...ausgabe.matchAll(/\[takt-sonde\] takt nr=(\d+) sekunden=([\d.]+)/g)]
    .filter(([, , sekunden]) => Number(sekunden) * MS_JE_SEKUNDE === abstand)
    .map(([, nummer]) => ({ nummer, unref: geloest.has(nummer) }));
}

function anrufGespeichert(anrufId) {
  return store.load().calls.some((anruf) => anruf.id === anrufId);
}

async function beendeterAnrufUndUhrUeberFrist(anrufId, endeIso) {
  laufendesHermes();
  store.load().calls.push({ ...anrufVorlage, id: anrufId, status: "completed", endedAt: endeIso });
  store.save();
  await store.drainFlushes();
  mock.timers.setTime(Date.parse(endeIso) + (config.privacy.retentionDays + 1) * TAG_MS);
}

async function sechsStundenTakteAufrufen() {
  let aufgerufen = 0;
  for (const { arguments: [takt, abstand] } of fabrikIntervall.mock.calls) {
    if (abstand !== SECHS_STUNDEN_MS) continue;
    takt();
    aufgerufen += 1;
  }
  await store.drainFlushes();
  return aufgerufen;
}

test("[NIE1] Start mit RETENTION_DAYS 30: Anruf von vor 31 Tagen ist gelöscht, Löschzeile steht vor dem Boot-Banner", KIND_FRIST, async () => {
  const { srv } = await hermesImKindprozess();
  const loeschStelle = srv.stdout.indexOf(LOESCHZEILE);
  assert.notEqual(loeschStelle, -1, `keine Löschzeile beim Start:\n${srv.stdout}`);
  assert.ok(loeschStelle < srv.stdout.indexOf(BOOT_BANNER), `Löschzeile erst nach dem Boot-Banner:\n${srv.stdout}`);
  assert.equal(srv.readStore().calls.some((anruf) => anruf.id === ALTER_ANRUF_ID), false);
});

test("[NIE1] nach dem Start löscht der 6-Stunden-Takt bei jedem Lauf erneut abgelaufene Anrufe", async () => {
  assert.ok(config.privacy.retentionDays > 0, "Testaufbau: Aufbewahrung im Testprozess abgeschaltet");
  await beendeterAnrufUndUhrUeberFrist("call_aufbewahrung_lauf1", "2027-04-01T12:00:00.000Z");
  await sechsStundenTakteAufrufen();
  assert.equal(anrufGespeichert("call_aufbewahrung_lauf1"), false, "erster Lauf nach dem Start löscht nicht");
  await beendeterAnrufUndUhrUeberFrist("call_aufbewahrung_lauf2", "2027-06-01T12:00:00.000Z");
  await sechsStundenTakteAufrufen();
  assert.equal(anrufGespeichert("call_aufbewahrung_lauf2"), false, "zweiter Lauf nach dem Start löscht nicht");
});

test("[NIE2] der Sweep-Takt im Abstand COST_TRUING_SWEEP_INTERVAL_MS weckt alle sieben Wächter", KIND_FRIST, async () => {
  const { srv } = await hermesImKindprozess();
  for (const zeile of ZEILEN_DER_SIEBEN_WAECHTER) {
    assert.ok(await warteAufAusgabe(srv, zeile), `kein Lauf "${zeile}" im Sweep-Takt:\n${srv.stdout}`);
  }
});

test("[NIE3] Aufbewahrungs- und Sweep-Takt halten den Prozess nicht am Leben", KIND_FRIST, async () => {
  const { srv } = await hermesImKindprozess();
  assert.ok(await warteAufAusgabe(srv, ZEILEN_DER_SIEBEN_WAECHTER[0]), `Sweep-Takt läuft nicht:\n${srv.stdout}`);
  for (const abstand of [SECHS_STUNDEN_MS, KIND_SWEEP_TAKT_MS]) {
    const takte = takteMitAbstand(srv.stdout, abstand);
    assert.ok(takte.length > 0, `kein Takt mit ${abstand} ms:\n${srv.stdout}`);
    assert.deepEqual(takte.filter((takt) => !takt.unref), [], `Takt mit ${abstand} ms hält den Prozess am Leben`);
  }
});

test("[NIE4] alle Takte mit 21 600 000 ms, je einmal aufgerufen, löschen den abgelaufenen Anruf", async () => {
  await beendeterAnrufUndUhrUeberFrist("call_aufbewahrung_takt", "2027-09-01T12:00:00.000Z");
  assert.equal(anrufGespeichert("call_aufbewahrung_takt"), true, "Testaufbau: Anruf schon vor dem Takt gelöscht");
  assert.ok((await sechsStundenTakteAufrufen()) > 0, "kein Takt mit 21 600 000 ms");
  assert.equal(anrufGespeichert("call_aufbewahrung_takt"), false, "kein Takt mit 21 600 000 ms löscht den Anruf");
});
