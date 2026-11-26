import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { meldeBetreiberAlarm, meldeVollBefund, reportSystematicOutage, runOutageRecoverySweep } from "../../src/telephony/outage-report.js";
import { PLATFORM_NUMBER_PURPOSE } from "../../src/begriffe/nummern-vergabe.ts";

const FENSTER_MS = 3600000;
const EINGANG_URL = "https://eingang.example.test/geheimer-eingang-q7x9";
const echtesFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = echtesFetch;
});
const CONFIG = Object.freeze({
  billing: {
    outageAlertWindowMs: FENSTER_MS,
    outageAlertMinFailures: 3,
    outageAlertMinAttempts: 20,
    outageAlertFailSharePercent: 20,
    outageAlertDebounceMs: 21600000,
    outageAlertRetryMs: 900000,
    platformAlertSmsTo: "+12025550143",
    betterstackAlertUrl: EINGANG_URL,
  },
  mail: { platformAlertMailTo: "ops@example.test" },
});
const CONFIG_KEIN_KANAL = Object.freeze({
  billing: { ...CONFIG.billing, platformAlertSmsTo: "", betterstackAlertUrl: "" },
  mail: { platformAlertMailTo: "" },
});
const CONFIG_KEIN_EINGANG = Object.freeze({
  billing: { ...CONFIG.billing, betterstackAlertUrl: "" },
  mail: CONFIG.mail,
});
const SENDER_E164 = "+15005550006";
const BUCKET = "not-placed:invite-403";
const NOW_ISO = "2026-08-27T16:45:00Z";

function makeStore({ calls = [], outageAlerts = [], platformNumberUse = [] } = {}) {
  const state = { calls, outageAlerts, platformNumberUse };
  return {
    load: () => state,
    save: () => {},
    withStoreLock: (fn) => Promise.resolve().then(fn),
  };
}

function boundSender() {
  return [{
    id: "pnu_1", e164: SENDER_E164, purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER,
    provider: "telnyx", tenantId: null, providerNumberId: null,
    boundAt: NOW_ISO, releasedAt: null, note: null,
  }];
}

function callRow({ id, tenantId, endedAt, failureReason = `${BUCKET}-D51`, answeredAt = null }) {
  return {
    id, tenantId, direction: "outbound", endedAt, answeredAt, failureReason,
    to: "+12025550199",
  };
}

function alarmCalls() {
  return [
    callRow({ id: "call_a", tenantId: "t_user_01ABC", endedAt: "2026-08-27T16:43:00Z" }),
    callRow({ id: "call_b", tenantId: "t_user_01ABC", endedAt: "2026-08-27T16:44:00Z" }),
    callRow({ id: "call_c", tenantId: "t_user_01ABC", endedAt: "2026-08-27T16:45:00Z" }),
  ];
}

function withOpenMarker(alerts = []) {
  return [{
    id: "otg_1", code: BUCKET, firstSeenAt: "2026-08-27T16:00:00Z", lastSeenAt: "2026-08-27T16:00:00Z",
    lastAttemptAt: null, reportedAt: null, deliveredChannels: null, closedAt: null,
  }, ...alerts];
}

function captureLog() {
  const lines = [];
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = (...args) => lines.push(args.map(String).join(" "));
  console.error = (...args) => lines.push(args.map(String).join(" "));
  return {
    lines,
    restore: () => {
      console.warn = origWarn;
      console.error = origError;
    },
  };
}

function makeSpies({ eingang = "annehmen" } = {}) {
  const order = [];
  const vorfaelle = [];
  const mailCalls = [];
  const smsCalls = [];
  const auditCalls = [];
  const audit = (action, req, detail) => { order.push("audit"); auditCalls.push({ action, detail }); };
  const mailer = { async sendMail(args) { mailCalls.push(args); } };
  const messaging = () => ({ async sendSms(args) { smsCalls.push(args); } });
  globalThis.fetch = async (adresse, anfrage) => {
    order.push("vorfall");
    if (eingang === "wirft") throw new TypeError("fetch failed");
    const koerper = JSON.parse(anfrage.body);
    vorfaelle.push({ adresse, id: koerper.incident.id, status: koerper.incident.status, text: koerper.text });
    return new Response(null, { status: eingang === "lehnt-ab" ? 500 : 200 });
  };
  return { order, vorfaelle, mailCalls, smsCalls, auditCalls, audit, mailer, messaging };
}

test("M1: Reihenfolge fixiert - warn, audit, genau ein Vorfall, weder Mail noch SMS", async () => {
  const log = captureLog();
  const spies = makeSpies();
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await reportSystematicOutage({ store, config: CONFIG, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer });
  log.restore();
  assert.ok(log.lines.some((zeile) => zeile.includes("outage_alert")), "WARN-Zeile vorhanden");
  assert.deepEqual(spies.order, ["audit", "vorfall"]);
  assert.equal(spies.mailCalls.length, 0);
  assert.equal(spies.smsCalls.length, 0);
  assert.equal(spies.vorfaelle[0].adresse, EINGANG_URL);
  assert.equal(spies.vorfaelle[0].id, BUCKET);
  assert.equal(spies.vorfaelle[0].status, "alert");
  const [marker] = store.load().outageAlerts;
  assert.equal(marker.deliveredChannels, "better-stack");
});

test("M2: Eingang lehnt ab (500) - audit lief, kein Wurf, reportedAt bleibt null", async () => {
  const log = captureLog();
  const spies = makeSpies({ eingang: "lehnt-ab" });
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await assert.doesNotReject(() =>
    reportSystematicOutage({ store, config: CONFIG, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer }),
  );
  log.restore();
  assert.equal(spies.auditCalls.length, 1);
  assert.ok(
    log.lines.includes(`[outage] Better-Stack-Meldung ${BUCKET} nicht zugestellt: HTTP 500`),
    "Grund in der WARN-Zeile",
  );
  const [marker] = store.load().outageAlerts;
  assert.equal(marker.reportedAt, null, "kein reportedAt bei abgelehnter Meldung");
  assert.ok(marker.lastAttemptAt, "lastAttemptAt ist gesetzt (S3-1)");
});

test("M3a: der Eingang ist nicht erreichbar (Abruf wirft) - kein Wurf, Marker ohne reportedAt", async () => {
  const log = captureLog();
  const spies = makeSpies({ eingang: "wirft" });
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await assert.doesNotReject(() =>
    reportSystematicOutage({ store, config: CONFIG, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer }),
  );
  log.restore();
  assert.ok(log.lines.some((zeile) => zeile.includes("nicht zugestellt: TypeError")));
  const [marker] = store.load().outageAlerts;
  assert.equal(marker.reportedAt, null);
});

test("M3b: auch bei werfender Mail-Attrappe und SMS-Attrappe bleibt es bei einem Vorfall", async () => {
  const spies = makeSpies();
  spies.mailer.sendMail = async () => { throw new Error("mail-boom"); };
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await assert.doesNotReject(() =>
    reportSystematicOutage({ store, config: CONFIG, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(spies.vorfaelle.length, 1);
  assert.equal(spies.mailCalls.length, 0);
  assert.equal(spies.smsCalls.length, 0);
});

test("M4: Kein Eingang konfiguriert - kein POST, reportedAt bleibt leer, damit die Meldung wiederholt wird", async () => {
  const spies = makeSpies();
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await reportSystematicOutage({ store, config: CONFIG_KEIN_EINGANG, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer });
  assert.equal(spies.vorfaelle.length, 0);
  assert.equal(spies.mailCalls.length, 0);
  const [marker] = store.load().outageAlerts;
  assert.equal(marker.reportedAt, null, "nichts zugestellt -> nichts als gemeldet gebucht");
});

test("M5: Kein Kanal konfiguriert - WARN+Audit laufen, kein Versand, kein Wurf", async () => {
  const log = captureLog();
  const spies = makeSpies();
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await assert.doesNotReject(() =>
    reportSystematicOutage({ store, config: CONFIG_KEIN_KANAL, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer }),
  );
  log.restore();
  assert.equal(spies.vorfaelle.length, 0);
  assert.equal(spies.smsCalls.length, 0);
  assert.equal(spies.auditCalls.length, 1);
  assert.ok(log.lines.length > 0, "WARN-Zeile trotzdem vorhanden");
});

test("M6: Ziel wird NIE geloggt (weder Mailadresse noch SMS-Nummer)", async () => {
  const log = captureLog();
  const spies = makeSpies();
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await reportSystematicOutage({ store, config: CONFIG, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer });
  log.restore();
  const gesamt = log.lines.join("\n") + JSON.stringify(spies.auditCalls);
  assert.ok(!gesamt.includes(CONFIG.mail.platformAlertMailTo));
  assert.ok(!gesamt.includes(CONFIG.billing.platformAlertSmsTo));
  assert.ok(!gesamt.includes(new URL(EINGANG_URL).host));
  assert.ok(!gesamt.includes("geheimer-eingang-q7x9"));
});

test("M7: PII-Regex (Regel 10) - der Alarm-Body traegt keine Rufnummer/Tenant-ID/Call-ID/Carrier-Rohtext", async () => {
  const spies = makeSpies();
  const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await reportSystematicOutage({ store, config: CONFIG, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer });
  const body = spies.vorfaelle[0].text;
  assert.ok(!/\+?\d{7,}/.test(body), `keine Rufnummer im Body: ${body}`);
  assert.ok(!/t_user_/.test(body), `keine Tenant-ID im Body: ${body}`);
  assert.ok(!/call_/.test(body), `keine Call-ID im Body: ${body}`);
  assert.ok(!/D51/.test(body), `kein Carrier-Rohtext im Body: ${body}`);
  assert.ok(body.includes("klasse="), body);
  assert.ok(body.includes("fehler="), body);
  assert.ok(body.includes("versuche="), body);
  assert.ok(body.includes("tenants="), body);
  assert.ok(body.includes("fenster_min="), body);
});

test("M8: K0 sendet nicht - erstbefund -> 0 Vorfaelle, genau 1 Audit", async () => {
  const spies = makeSpies();
  const einzelnerCall = callRow({ id: "call_first", tenantId: "t_user_01ABC", endedAt: NOW_ISO });
  const store = makeStore({ calls: [einzelnerCall], outageAlerts: [] });
  await reportSystematicOutage({ store, config: CONFIG, call: einzelnerCall, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer });
  assert.equal(spies.vorfaelle.length, 0);
  assert.equal(spies.smsCalls.length, 0);
  assert.equal(spies.auditCalls.length, 1);
  assert.equal(spies.auditCalls[0].action, "outage_detected");
});

test("M9: Erholung sendet nicht - genau eine Audit-Zeile, 0 Sends (Sweep-Pfad, D9)", async () => {
  const spies = makeSpies();
  const erfolgreicherCall = callRow({
    id: "call_ok", tenantId: "t_user_01ABC", endedAt: "2026-08-27T16:44:00Z",
    answeredAt: "2026-08-27T16:43:50Z", failureReason: null,
  });
  const store = makeStore({ calls: [erfolgreicherCall], outageAlerts: withOpenMarker() });
  await runOutageRecoverySweep({ store, config: CONFIG, audit: spies.audit, nowMs: Date.parse(NOW_ISO) });
  assert.equal(spies.vorfaelle.length, 0);
  assert.equal(spies.smsCalls.length, 0);
  assert.equal(spies.auditCalls.length, 1);
  assert.equal(spies.auditCalls[0].action, "outage_recovered");
  const [marker] = store.load().outageAlerts;
  assert.ok(marker.closedAt, "der Marker ist geschlossen");
});

test("M9b (E3B-02): windowMs=0 (Rollback-Hebel OFF) - der Sweep schliesst NICHTS", async () => {
  const spies = makeSpies();
  const erfolgreicherCall = callRow({
    id: "call_ok2", tenantId: "t_user_01ABC", endedAt: "2026-08-27T16:44:00Z",
    answeredAt: "2026-08-27T16:43:50Z", failureReason: null,
  });
  const store = makeStore({ calls: [erfolgreicherCall], outageAlerts: withOpenMarker() });
  const configOff = { ...CONFIG, billing: { ...CONFIG.billing, outageAlertWindowMs: 0 } };
  await runOutageRecoverySweep({ store, config: configOff, audit: spies.audit, nowMs: Date.parse(NOW_ISO) });
  assert.equal(spies.auditCalls.length, 0, "OFF darf keine Audit-Zeile erzeugen");
  const [marker] = store.load().outageAlerts;
  assert.equal(marker.closedAt, null, "der Marker bleibt offen - OFF schliesst nichts");
});

test("M9c (PFLICHT-TEST, Blocker falsche Entwarnung bei Null-Verkehr): offener Marker + LEERES Fenster -> KEINE Audit-Zeile, Marker bleibt offen", async () => {
  const spies = makeSpies();
  const store = makeStore({ calls: [], outageAlerts: withOpenMarker() });
  await runOutageRecoverySweep({ store, config: CONFIG, audit: spies.audit, nowMs: Date.parse(NOW_ISO) });
  assert.equal(spies.vorfaelle.length, 0);
  assert.equal(spies.smsCalls.length, 0);
  assert.equal(spies.auditCalls.length, 0, "kein Verkehr -> keine Audit-Zeile (weder Alarm noch Erholung)");
  const [marker] = store.load().outageAlerts;
  assert.equal(marker.closedAt, null, "der Marker bleibt offen - kein Beleg fuer Erholung");
});

test("M10: die Absender-Bindung spielt keine Rolle mehr - mit und ohne Bindung genau ein Vorfall, nie eine SMS", async () => {
  for (const platformNumberUse of [[], boundSender()]) {
    const spies = makeSpies();
    const store = makeStore({ calls: alarmCalls(), outageAlerts: withOpenMarker(), platformNumberUse });
    await reportSystematicOutage({ store, config: CONFIG, call: alarmCalls()[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer });
    assert.equal(spies.vorfaelle.length, 1);
    assert.equal(spies.smsCalls.length, 0);
  }
});

test("M11: Nicht-not-placed loest nichts aus (unreachable)", async () => {
  const spies = makeSpies();
  const call = callRow({ id: "call_ur", tenantId: "t_user_01ABC", endedAt: NOW_ISO, failureReason: "unreachable:invite-404-D11" });
  const store = makeStore({ calls: [call], outageAlerts: [] });
  await reportSystematicOutage({ store, config: CONFIG, call, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer });
  assert.equal(spies.auditCalls.length, 0);
  assert.equal(spies.vorfaelle.length, 0);
  assert.equal(spies.smsCalls.length, 0);
});

test("M12 (G26, Review-Blocker Runde 2): zwei GLEICHZEITIG endende not-placed-Anrufe schicken GENAU EINEN Alarm - der Sendeplatz ist VOR dem Versand reserviert", async () => {
  const spies = makeSpies();
  const calls = alarmCalls();
  const store = makeStore({ calls, outageAlerts: withOpenMarker(), platformNumberUse: boundSender() });
  await Promise.all([
    reportSystematicOutage({ store, config: CONFIG, call: calls[1], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer }),
    reportSystematicOutage({ store, config: CONFIG, call: calls[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer }),
  ]);
  assert.equal(spies.vorfaelle.length, 1, "genau EIN Vorfall trotz zweier gleichzeitig endender Anrufe");
  assert.equal(spies.smsCalls.length, 0, "keine SMS");
  const [marker] = store.load().outageAlerts;
  assert.ok(marker.lastAttemptAt, "lastAttemptAt gesetzt (Reservierung)");
});

const VOLL_BEFUND = Object.freeze({
  bucket: "price-drift:test",
  aktion: "price_drift",
  zeile: "Hermes Betriebsmeldung\nKatalogpreis weicht ab",
});
const VOLL_BEFUND_JETZT_MS = Date.parse(NOW_ISO);

function meldeVoll({ store, spies }) {
  return meldeVollBefund({
    store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer,
    ...VOLL_BEFUND, nowMs: VOLL_BEFUND_JETZT_MS,
  });
}

function bekannterMarker({ code = VOLL_BEFUND.bucket, lastAttemptAt, reportedAt = null }) {
  return {
    id: `otg_${code}`, code, firstSeenAt: "2026-08-27T01:00:00Z", lastSeenAt: lastAttemptAt,
    lastAttemptAt, reportedAt, deliveredChannels: reportedAt ? "mail" : null, closedAt: null,
  };
}

test("M13 (#546): zwei GLEICHZEITIGE Voll-Befunde zum selben Bucket schicken GENAU EINEN Alarm", async () => {
  const spies = makeSpies();
  const store = makeStore({ platformNumberUse: boundSender() });
  await Promise.all([meldeVoll({ store, spies }), meldeVoll({ store, spies })]);
  assert.equal(spies.vorfaelle.length, 1, "genau EIN Vorfall");
  assert.equal(spies.smsCalls.length, 0, "keine SMS");
  assert.deepEqual(
    spies.auditCalls.map((eintrag) => eintrag.action).sort(),
    [VOLL_BEFUND.aktion, `${VOLL_BEFUND.aktion}_entprellt`],
    "der zweite Befund wird als Notiz entprellt",
  );
  const [marker] = store.load().outageAlerts;
  assert.ok(marker.reportedAt, "zugestellt und im Marker vermerkt");
});

test("M13b (#546): auch nach abgelaufener Entprellung schickt ein zweiter gleichzeitiger Befund keinen zweiten Alarm", async () => {
  const spies = makeSpies();
  const alt = "2026-08-27T08:00:00Z";
  const store = makeStore({
    platformNumberUse: boundSender(),
    outageAlerts: [bekannterMarker({ lastAttemptAt: alt, reportedAt: alt })],
  });
  await Promise.all([meldeVoll({ store, spies }), meldeVoll({ store, spies })]);
  assert.equal(spies.vorfaelle.length, 1, "genau EIN Vorfall");
  assert.equal(spies.smsCalls.length, 0, "keine SMS");
});

test("M13c (#546): ein Voll-Befund innerhalb der Entprellung bleibt eine Notiz ohne Versand", async () => {
  const spies = makeSpies();
  const gemeldet = "2026-08-27T15:00:00Z";
  const store = makeStore({
    platformNumberUse: boundSender(),
    outageAlerts: [bekannterMarker({ lastAttemptAt: gemeldet, reportedAt: gemeldet })],
  });
  await meldeVoll({ store, spies });
  assert.equal(spies.vorfaelle.length, 0, "kein Vorfall");
  assert.equal(spies.smsCalls.length, 0, "keine SMS");
  assert.deepEqual(spies.auditCalls.map((eintrag) => eintrag.action), [`${VOLL_BEFUND.aktion}_entprellt`]);
});

test("M13d (#546): ohne reservierten Sendeplatz wirft der Alarm und sendet nichts", async () => {
  const spies = makeSpies();
  const store = makeStore({ platformNumberUse: boundSender() });
  await assert.rejects(
    meldeBetreiberAlarm({
      store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer,
      ...VOLL_BEFUND, nowMs: VOLL_BEFUND_JETZT_MS,
    }),
    /nicht reserviert/,
  );
  assert.equal(spies.vorfaelle.length, 0, "kein Vorfall");
  assert.equal(spies.smsCalls.length, 0, "keine SMS");
  assert.deepEqual(spies.auditCalls, [], "kein Audit");
});

test("M13e (#546): als reserviert zählt nur der Versuch dieses Buckets zu genau diesem Zeitpunkt", async () => {
  const jetzt = new Date(VOLL_BEFUND_JETZT_MS).toISOString();
  const faelle = {
    "Versuch eines anderen Buckets zur selben Zeit": [bekannterMarker({ code: "price-drift:anderer", lastAttemptAt: jetzt })],
    "älterer Versuch im selben Bucket": [bekannterMarker({ lastAttemptAt: "2026-08-27T16:00:00.000Z" })],
  };
  for (const [name, outageAlerts] of Object.entries(faelle)) {
    const spies = makeSpies();
    const store = makeStore({ platformNumberUse: boundSender(), outageAlerts });
    await assert.rejects(
      meldeBetreiberAlarm({
        store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer,
        ...VOLL_BEFUND, nowMs: VOLL_BEFUND_JETZT_MS,
      }),
      /nicht reserviert/,
      name,
    );
    assert.equal(spies.vorfaelle.length, 0, `${name}: kein Vorfall`);
  }
});

test("M13f (#546): ein Versuch genau outageAlertRetryMs her gibt den Sendeplatz frei, eine Millisekunde jünger sperrt ihn", async () => {
  const retryMs = CONFIG.billing.outageAlertRetryMs;
  const gemeldet = "2026-08-27T08:00:00Z";
  for (const [vorMs, erwarteteMails] of [[retryMs, 1], [retryMs - 1, 0]]) {
    const spies = makeSpies();
    const lastAttemptAt = new Date(VOLL_BEFUND_JETZT_MS - vorMs).toISOString();
    const store = makeStore({
      platformNumberUse: boundSender(),
      outageAlerts: [bekannterMarker({ lastAttemptAt, reportedAt: gemeldet })],
    });
    await meldeVoll({ store, spies });
    assert.equal(spies.vorfaelle.length, erwarteteMails, `Versuch ${vorMs} ms her`);
  }
});

test("M13g (#546): schlägt die Zustellung fehl, bleibt der Sendeplatz belegt, aber nichts gilt als gemeldet", async () => {
  const spies = makeSpies({ eingang: "lehnt-ab" });
  const store = makeStore({ platformNumberUse: boundSender() });
  const log = captureLog();
  try {
    await meldeVoll({ store, spies });
    await meldeVoll({ store, spies });
  } finally {
    log.restore();
  }
  const [marker] = store.load().outageAlerts;
  assert.equal(marker.reportedAt, null, "nicht als gemeldet vermerkt");
  assert.ok(marker.lastAttemptAt, "Versuch vermerkt");
  assert.equal(
    spies.order.filter((schritt) => schritt === "vorfall").length,
    1,
    "der zweite Befund wiederholt nicht sofort",
  );
});

test("M13h (#546): der Sendeplatz ist gespeichert, bevor die erste Mail rausgeht", async () => {
  const spies = makeSpies();
  const store = makeStore({ platformNumberUse: boundSender() });
  const speicherungen = [];
  store.save = () => {
    const { outageAlerts } = store.load();
    speicherungen.push({
      mailsDavor: spies.order.filter((schritt) => schritt === "vorfall").length,
      reserviert: Boolean(outageAlerts[0]?.lastAttemptAt),
    });
  };
  await meldeVoll({ store, spies });
  assert.deepEqual(speicherungen[0], { mailsDavor: 0, reserviert: true });
});

const KAPAZITAET = "at-capacity:invite-403";

function kapazitaetsAnrufe() {
  return alarmCalls().map((anruf) => ({ ...anruf, failureReason: `${KAPAZITAET}-D51` }));
}

function kapazitaetsMarker() {
  const [marker] = withOpenMarker();
  return { ...marker, code: KAPAZITAET };
}

test("M10: drei at-capacity-Anrufe im Eimer loesen denselben Alarm aus wie not-placed", async () => {
  const spies = makeSpies();
  const calls = kapazitaetsAnrufe();
  const store = makeStore({ calls, outageAlerts: [kapazitaetsMarker()], platformNumberUse: boundSender() });
  await reportSystematicOutage({ store, config: CONFIG, call: calls[2], audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer });
  assert.equal(spies.vorfaelle.length, 1);
  assert.equal(spies.vorfaelle[0].id, KAPAZITAET);
  const [marker] = store.load().outageAlerts;
  assert.ok(marker.reportedAt);
});

test("M11: Erholung schliesst einen offenen at-capacity-Marker", async () => {
  const spies = makeSpies();
  const erfolg = callRow({
    id: "call_ok", tenantId: "t_user_01ABC", endedAt: "2026-08-27T16:44:00Z",
    answeredAt: "2026-08-27T16:43:50Z", failureReason: null,
  });
  const store = makeStore({ calls: [erfolg], outageAlerts: [kapazitaetsMarker()] });
  await runOutageRecoverySweep({ store, config: CONFIG, audit: spies.audit, nowMs: Date.parse(NOW_ISO) });
  const [marker] = store.load().outageAlerts;
  assert.ok(marker.closedAt);
  assert.equal(spies.auditCalls[0].action, "outage_recovered");
});
