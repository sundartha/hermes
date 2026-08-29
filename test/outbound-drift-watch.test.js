// OUTBOUND-E4 Review-Blocker (P11/T1 + BLOCKER 2): outbound-drift-watch.js (Takt,
// Single-Flight/Mindestfrist, VOLL/NOTIZ-Dispatch, Marker-Schliessung) hatte KEINEN
// einzigen Verhaltenstest - der reine Kern (outbound-config-drift.js) ist in
// test/outbound-drift-kern.test.js gedeckt, aber der Aufrufer drumherum nicht. Alle
// Faelle hier laufen ueber makeDriftWatch(...).runDriftSweep()/runBootProbe() mit
// injizierten telnyxRead/elRead-Attrappen (NUR-LESEND, kein Netz, Muster K-14).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDriftWatch, befundBucket } from "../src/telephony/outbound-drift-watch.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const AGENT_ID = "agent_test";
const PLATFORM_ANI = "+15739090177";
const ALERT_SENDER = "+15005550006";
const FQDN_CONNECTION_ID = "conn_1";
const OVP_ID = "ovp_1";

function fakeConfig(overrides = {}) {
  return withConfigNamespaces({
    elevenLabsOutbound: { agentId: AGENT_ID, agentPhoneNumberId: "phnum_test" },
    platformAniE164: PLATFORM_ANI,
    telnyxFqdnConnectionId: FQDN_CONNECTION_ID,
    telnyxOutboundVoiceProfileId: OVP_ID,
    allowedCountryCodes: ["+49"],
    outboundDriftMinIntervalMs: 3600000,
    outboundDriftStaleMs: 21600000,
    outboundDriftBalanceMinHours: 72,
    platformAlertMailTo: "",
    platformAlertSmsTo: "",
    // Blocker 3 (Entprellung VOR dem Alarm-Versand): Produktions-Defaults (6h/15min,
    // s. src/config.js#OUTAGE_ALERT_DEBOUNCE_HOURS_DEFAULT), damit "zwei Laeufe direkt
    // hintereinander" in W-6 deterministisch entprellt wird.
    outageAlertDebounceMs: 21600000,
    outageAlertRetryMs: 900000,
    ...overrides,
  });
}

// "Gesunde" Antworten fuer alle sechs Telnyx-GETs + den EL-GET (Muster
// outbound-drift-kern.test.js#messungGesund) - findPhoneNumber beantwortet standardmaessig
// JEDE angefragte E.164 als kontoeigen (ANI-Pruefung UND Alarm-Absender-Pruefung teilen
// sich diese eine Methode).
function fakeTelnyxRead(overrides = {}) {
  return {
    findPhoneNumber: async (e164) => ({ treffer: [{ e164, status: "active" }] }),
    listVerifiedNumbers: async () => ({ e164s: [] }),
    getFqdnConnection: async () => ({ active: true, aniOverride: PLATFORM_ANI }),
    listFqdns: async () => ({ connectionIds: [FQDN_CONNECTION_ID] }),
    getOutboundVoiceProfile: async () => ({ enabled: true, whitelistedDestinations: ["DE"] }),
    getBalance: async () => ({ availableCreditMicroCents: 100_000_000_000 }),
    ...overrides,
  };
}

function fakeElRead(overrides = {}) {
  return {
    fetchPhoneNumber: async () => ({
      phone_number: PLATFORM_ANI,
      assigned_agent: { agent_id: AGENT_ID },
      supports_outbound: true,
    }),
    ...overrides,
  };
}

function fakeStore({ alerts = [], calls = [] } = {}) {
  const state = {
    outageAlerts: [...alerts],
    calls,
    platformNumberUse: [{ e164: ALERT_SENDER, purpose: "alert_sms_sender", releasedAt: null }],
  };
  return {
    load: () => state,
    save: () => {},
    withStoreLock: (fn) => fn(),
  };
}

// EINE Positiv-Anrufzeile innerhalb der letzten 24h, damit Pruefung 8 ein Urteil faellen
// kann (verbrauch24hMicroCents > 0) - ohne echten Verkehr ist Pruefung 8 strukturell
// unbekannt (Regelfall, s. K-12), das wuerde JEDEN Testfall hier mit unknown>0 fluten.
function gesunderVerkehr() {
  return [{ endedAt: new Date().toISOString(), actualCostMicroCents: 1_000_000 }];
}

// Kleine Lese-/Schreibhelfer (G36, Gesetz von Demeter): kein vierfach verkettetes
// store.load().outageAlerts.find(...).feld quer durch die Tests.
function findAlert(store, code) {
  return store.load().outageAlerts.find((alert) => alert.code === code);
}

function setzeLaufMarkerAlt(store) {
  const laufMarker = findAlert(store, "drift:lauf");
  laufMarker.lastSeenAt = new Date(0).toISOString();
}

// ladeAusnahmen (BLOCKER 3): default HIER bewusst () => [] (leer), NICHT der echte
// Produktions-Default aus makeDriftWatch - sonst wuerden die deklarierten Ausnahmen der
// ECHTEN outbound-drift-ausnahmen.json (u.a. unbekannt:pruefung8) JEDEN Bestandstest
// hier stillschweigend mitpraegen. W-5 unten prueft GERADE deshalb separat und OHNE
// diese Attrappe, dass der Produktions-Default tatsaechlich greift.
function fakeDeps({ store, config, telnyxRead, elRead, audit, ladeAusnahmen } = {}) {
  return {
    store: store || fakeStore({ calls: gesunderVerkehr() }),
    config: config || fakeConfig(),
    audit: audit || (() => {}),
    messaging: () => ({ sendSms: async () => {} }),
    mailer: { sendMail: async () => {} },
    telnyxRead: telnyxRead || fakeTelnyxRead(),
    elRead: elRead || fakeElRead(),
    ladeAusnahmen: ladeAusnahmen || (() => []),
  };
}

// W-0: Positiv-Kontrolle - der Baustein selbst meldet bei einem WIRKLICH gesunden
// Zustand GAR NICHTS (Blocker-Vermeidungsliste 2: ein Waechter, der alles meldet, besteht
// jeden Negativ-Test und ist trotzdem kaputt).
test("E4-Waechter: W-0 Positiv-Kontrolle - vollstaendig gesunder Zustand meldet KEINEN Befund", async () => {
  const auditEvents = [];
  const driftWatch = makeDriftWatch(fakeDeps({ audit: (event) => auditEvents.push(event) }));
  await driftWatch.runBootProbe();
  assert.deepEqual(
    auditEvents.filter((event) => event.startsWith("drift_")),
    [],
    "ein gesunder Lauf darf keine einzige drift_*-Audit-Zeile erzeugen",
  );
});

// W-1: Single-Flight/Mindestfrist (PM-26) --------------------------------------------
test("E4-Waechter: W-1 zweiter Lauf INNERHALB der Mindestfrist -> kein zweiter Anbieter-Zugriff (Single-Flight)", async () => {
  let aufrufe = 0;
  const telnyxRead = fakeTelnyxRead({
    findPhoneNumber: async (e164) => {
      aufrufe += 1;
      return { treffer: [{ e164, status: "active" }] };
    },
  });
  const driftWatch = makeDriftWatch(fakeDeps({ telnyxRead }));
  await driftWatch.runBootProbe();
  const aufrufeNachLauf1 = aufrufe;
  assert.ok(aufrufeNachLauf1 > 0, "der erste Lauf muss den Anbieter befragen");
  await driftWatch.runDriftSweep();
  assert.equal(
    aufrufe,
    aufrufeNachLauf1,
    "der zweite Lauf innerhalb der Mindestfrist darf den Anbieter NICHT erneut befragen (Single-Flight)",
  );
});

test("E4-Waechter: W-1b outboundDriftMinIntervalMs<=0 haelt den Waechter komplett aus (Rollback-Hebel)", async () => {
  let aufrufe = 0;
  const telnyxRead = fakeTelnyxRead({
    findPhoneNumber: async (e164) => {
      aufrufe += 1;
      return { treffer: [{ e164, status: "active" }] };
    },
  });
  const config = fakeConfig({ outboundDriftMinIntervalMs: 0 });
  const driftWatch = makeDriftWatch(fakeDeps({ config, telnyxRead }));
  await driftWatch.runBootProbe();
  assert.equal(aufrufe, 0, "minIntervalMs<=0 darf keinen einzigen Anbieter-Zugriff ausloesen");
});

// W-2: Dispatch - ownership -> VOLLER Meldeweg (Audit + Marker) ---------------------
test("E4-Waechter: W-2 ownership_lost -> voller Meldeweg (Audit-Event drift_ownership_lost, Marker offen)", async () => {
  const store = fakeStore({ calls: gesunderVerkehr() });
  const auditEvents = [];
  const telnyxRead = fakeTelnyxRead({
    findPhoneNumber: async (e164) => (e164 === PLATFORM_ANI ? { treffer: [] } : { treffer: [{ e164, status: "active" }] }),
  });
  const driftWatch = makeDriftWatch(fakeDeps({ store, telnyxRead, audit: (event) => auditEvents.push(event) }));
  await driftWatch.runBootProbe();
  assert.ok(auditEvents.includes("drift_ownership_lost"), "ownership ist eine VOLL_KLASSE - muss ueber meldeBetreiberAlarm gehen");
  const marker = findAlert(store, befundBucket("ownership_lost"));
  assert.ok(marker && marker.closedAt === null, "der Marker muss offen bleiben, solange der Befund besteht");
});

// W-2b: Dispatch - unknown -> NUR Notiz (kein voller Meldeweg), aber NIE stumm ------
test("E4-Waechter: W-2b ein unknown-Befund meldet als NOTIZ (Audit-Event drift_unbekannt:pruefung8), kein Stille", async () => {
  const store = fakeStore({ calls: [] }); // kein Verkehr -> Pruefung 8 unknown (Regelfall)
  const auditEvents = [];
  const driftWatch = makeDriftWatch(fakeDeps({ store, audit: (event) => auditEvents.push(event) }));
  await driftWatch.runBootProbe();
  assert.ok(
    auditEvents.includes("drift_unbekannt:pruefung8"),
    "ein Anbieterfehler/fehlender Verkehr MUSS einen gezaehlten, gemeldeten unknown-Befund erzeugen (PM-16), nie Stille",
  );
});

// W-3 (BLOCKER 2, REGRESSIONSFANG): keine falsche Entwarnung, wenn ein Anbieterfehler
// einen vorher OFFENEN Befund durch einen unknown ERSETZT statt ihn zu loesen. -------
test("E4-Waechter: W-3 Lauf 1 meldet ownership_lost, Lauf 2 (Anbieter 429 auf ALLES) SCHLIESST den Marker NICHT (keine falsche Entwarnung)", async () => {
  const store = fakeStore({ calls: gesunderVerkehr() });
  const auditEvents = [];
  const audit = (event) => auditEvents.push(event);

  // Lauf 1: echter ownership_lost-Befund (ANI ohne Kontotreffer, Alarm-Absender bleibt gesund).
  const telnyxReadDefekt = fakeTelnyxRead({
    findPhoneNumber: async (e164) => (e164 === PLATFORM_ANI ? { treffer: [] } : { treffer: [{ e164, status: "active" }] }),
  });
  const driftWatch1 = makeDriftWatch(fakeDeps({ store, telnyxRead: telnyxReadDefekt, audit }));
  await driftWatch1.runBootProbe();
  const markerNachLauf1 = findAlert(store, befundBucket("ownership_lost"));
  assert.ok(markerNachLauf1 && markerNachLauf1.closedAt === null, "Lauf 1 muss den Marker oeffnen");

  // Lauf 2, NACH Ablauf der Mindestfrist (hier direkt am Marker simuliert statt echt zu
  // warten): Anbieter antwortet auf ALLES mit 429 (Rate-Limit) - die Pruefung, die
  // ownership_lost gefunden hatte, kann diesmal KEIN Urteil faellen.
  const providerFehler = () => Promise.reject(Object.assign(new Error("429"), { providerStatus: 429 }));
  const telnyxReadAusgefallen = {
    findPhoneNumber: providerFehler,
    listVerifiedNumbers: providerFehler,
    getFqdnConnection: providerFehler,
    listFqdns: providerFehler,
    getOutboundVoiceProfile: providerFehler,
    getBalance: providerFehler,
  };
  setzeLaufMarkerAlt(store);
  const configOhneWartezeit = fakeConfig({ outboundDriftMinIntervalMs: 1 });
  const driftWatch2 = makeDriftWatch(fakeDeps({ store, config: configOhneWartezeit, telnyxRead: telnyxReadAusgefallen, audit }));
  await driftWatch2.runDriftSweep();

  const markerNachLauf2 = findAlert(store, befundBucket("ownership_lost"));
  assert.ok(markerNachLauf2, "der Marker darf nicht verschwinden");
  assert.equal(markerNachLauf2.closedAt, null, "BLOCKER 2: ein Anbieterfehler darf den offenen ownership_lost-Marker NIE schliessen");
  assert.ok(
    !auditEvents.some((event) => event === "drift_recovered"),
    "kein drift_recovered waehrend eines Laufs, der nicht urteilen konnte (zaehler.unknown > 0)",
  );
});

// W-3b Positiv-Kontrolle: ein WIRKLICH gesunder Folgelauf SCHLIESST den Marker -------
test("E4-Waechter: W-3b Positiv-Kontrolle - ein Folgelauf OHNE unknown und OHNE den Befund schliesst den Marker (drift_recovered)", async () => {
  const store = fakeStore({ calls: gesunderVerkehr() });
  const auditEvents = [];
  const audit = (event) => auditEvents.push(event);

  const telnyxReadDefekt = fakeTelnyxRead({
    findPhoneNumber: async (e164) => (e164 === PLATFORM_ANI ? { treffer: [] } : { treffer: [{ e164, status: "active" }] }),
  });
  const driftWatch1 = makeDriftWatch(fakeDeps({ store, telnyxRead: telnyxReadDefekt, audit }));
  await driftWatch1.runBootProbe();
  assert.ok(findAlert(store, befundBucket("ownership_lost")));

  setzeLaufMarkerAlt(store);
  const configOhneWartezeit = fakeConfig({ outboundDriftMinIntervalMs: 1 });
  const driftWatch2 = makeDriftWatch(fakeDeps({ store, config: configOhneWartezeit, telnyxRead: fakeTelnyxRead(), audit }));
  await driftWatch2.runDriftSweep();

  const marker = findAlert(store, befundBucket("ownership_lost"));
  assert.ok(marker.closedAt !== null, "ein WIRKLICH gesunder Lauf muss den Marker schliessen");
  assert.ok(auditEvents.includes("drift_recovered"), "die Erholung muss eine Audit-Zeile hinterlassen");
});

// W-4: Pruefung 8 (24h-Verbrauch) - Fensterfilter ------------------------------------
test("E4-Waechter: W-4 verbrauch24hMicroCents zaehlt NUR Anrufe innerhalb der letzten 24h, negative/nicht-ganzzahlige Kosten NIE", async () => {
  const EINE_STUNDE_MS = 3600000;
  const STUNDEN_PRO_TAG = 24;
  const ZWEI_TAGE = 2;
  const nowIso = new Date().toISOString();
  const vorZweiTagenIso = new Date(Date.now() - ZWEI_TAGE * STUNDEN_PRO_TAG * EINE_STUNDE_MS).toISOString();
  const store = fakeStore({
    calls: [
      { endedAt: nowIso, actualCostMicroCents: 1_000_000 }, // innerhalb 24h -> zaehlt
      { endedAt: vorZweiTagenIso, actualCostMicroCents: 9_999_999_999 }, // ausserhalb -> NICHT zaehlen
      { endedAt: nowIso, actualCostMicroCents: -500 }, // negativ -> NICHT zaehlen
      { endedAt: nowIso, actualCostMicroCents: 1.5 }, // nicht ganzzahlig -> NICHT zaehlen
    ],
  });
  const auditEvents = [];
  const driftWatch = makeDriftWatch(fakeDeps({ store, audit: (event) => auditEvents.push(event) }));
  await driftWatch.runBootProbe();
  // Mit NUR dem 24h-Anruf gezaehlt (1.000.000 Mikro-Cent) und riesigem Guthaben ist die
  // Reichweite extrem hoch -> kein balance_low. Wuerden die ausgeschlossenen Zeilen
  // mitgezaehlt, waere der Verbrauch riesig und die Reichweite kollabierte.
  assert.ok(!auditEvents.some((event) => event.startsWith("drift_balance_low")), "nur der 24h-Anruf darf in den Verbrauch einfliessen");
  assert.ok(!auditEvents.some((event) => event.startsWith("drift_unbekannt:pruefung8")), "1.000.000 Mikro-Cent gilt als echter Verbrauch");
});

// W-5 (BLOCKER 3, zweite Haelfte): OHNE injizierte ladeAusnahmen muss der Produktions-
// Default die ECHTE outbound-drift-ausnahmen.json laden - vorher bekam der In-Prozess-
// Waechter NIE eine Ausnahme, egal was in der Datei stand (befund.ausgenommen blieb
// strukturell immer false).
test("E4-Waechter: W-5 OHNE injizierte ladeAusnahmen laedt der Waechter die ECHTE outbound-drift-ausnahmen.json", async () => {
  const store = fakeStore({ calls: [] }); // kein Verkehr -> unbekannt:pruefung8 (Regelfall)
  const auditEvents = [];
  const driftWatch = makeDriftWatch({
    store,
    config: fakeConfig(),
    audit: (event) => auditEvents.push(event),
    messaging: () => ({ sendSms: async () => {} }),
    mailer: { sendMail: async () => {} },
    telnyxRead: fakeTelnyxRead(),
    elRead: fakeElRead(),
    // ladeAusnahmen ABSICHTLICH NICHT injiziert - der Produktions-Default muss greifen.
  });
  await driftWatch.runBootProbe();
  assert.ok(
    !auditEvents.includes("drift_unbekannt:pruefung8"),
    "die reale outbound-drift-ausnahmen.json nimmt unbekannt:pruefung8 aus - ohne den Fix waere ausgenommen strukturell immer false",
  );
});

// W-6 (BLOCKER 3, erste Haelfte): Entprellung VOR dem Alarm-Versand -----------------
test("E4-Waechter: W-6 zwei aufeinanderfolgende Laeufe bei UNVERAENDERTEM Befund -> GENAU EIN Versand", async () => {
  const store = fakeStore({ calls: gesunderVerkehr() });
  let mailVersand = 0;
  const mailer = { sendMail: async () => { mailVersand += 1; } };
  const telnyxReadDefekt = fakeTelnyxRead({
    findPhoneNumber: async (e164) => (e164 === PLATFORM_ANI ? { treffer: [] } : { treffer: [{ e164, status: "active" }] }),
  });
  const config = fakeConfig({ platformAlertMailTo: "owner@example.com" });

  const deps1 = fakeDeps({ store, config, telnyxRead: telnyxReadDefekt, audit: () => {} });
  deps1.mailer = mailer;
  await makeDriftWatch(deps1).runBootProbe();
  assert.equal(mailVersand, 1, "Lauf 1 muss den vollen Meldeweg (Mail) ausloesen");

  // Lauf 2 DIREKT danach, derselbe Befund unveraendert - nur die Single-Flight-
  // Mindestfrist wird umgangen (ein ANDERER Marker als die Entprellung selbst).
  setzeLaufMarkerAlt(store);
  const configOhneWartezeit = fakeConfig({ outboundDriftMinIntervalMs: 1, platformAlertMailTo: "owner@example.com" });
  const deps2 = fakeDeps({ store, config: configOhneWartezeit, telnyxRead: telnyxReadDefekt, audit: () => {} });
  deps2.mailer = mailer;
  await makeDriftWatch(deps2).runDriftSweep();
  assert.equal(mailVersand, 1, "Lauf 2 (derselbe Befund, direkt danach) darf NICHT erneut senden - Entprellung");
});

// W-6b (Review Runde 2, NEUER Blocker eingefuehrt durch den W-6/Blocker-3-Fix): die
// Entprellung des VERSANDS darf die FRISCHE des Markers nicht einfrieren. Der ANI-Riegel
// (outbound-gates.js#frischGenug) liest marker.lastSeenAt mit einem VIEL kuerzeren Fenster
// (OUTBOUND_ANI_GATE_MAX_AGE_MS, Default 15 min) als die Mail/SMS-Entprellung (Default 6h)
// laeuft - ohne diesen Test haette ein entprellter Lauf lastSeenAt gar nicht mehr
// angefasst, und der Riegel waere waehrend eines laufenden Ausfalls fast immer inert
// gewesen (genau die eigene Messung des Reviews: 8 stuendliche Laeufe, Marker-Alter
// waechst bis 300 min statt bei 0 zu bleiben).
test("E4-Waechter: W-6b entprellter Lauf haelt den Marker trotzdem FRISCH (lastSeenAt), sendet aber nicht erneut", async () => {
  const EINE_STUNDE_MS = 3600000;
  const store = fakeStore({ calls: gesunderVerkehr() });
  const auditEvents = [];
  const audit = (event) => auditEvents.push(event);
  let mailVersand = 0;
  const mailer = { sendMail: async () => { mailVersand += 1; } };
  const telnyxReadDefekt = fakeTelnyxRead({
    findPhoneNumber: async (e164) => (e164 === PLATFORM_ANI ? { treffer: [] } : { treffer: [{ e164, status: "active" }] }),
  });
  const config = fakeConfig({ platformAlertMailTo: "owner@example.com" });
  const deps = fakeDeps({ store, config, telnyxRead: telnyxReadDefekt, audit });
  deps.mailer = mailer;
  const driftWatch = makeDriftWatch(deps);

  const echteUhr = Date.now;
  let uhrMs = Date.parse("2026-08-29T00:00:00.000Z");
  Date.now = () => uhrMs;
  try {
    await driftWatch.runBootProbe(); // Stunde 0: erster Fund, voller Meldeweg
    assert.equal(mailVersand, 1, "Lauf 1 muss senden");
    const markerNachLauf1 = findAlert(store, befundBucket("ownership_lost"));
    assert.equal(markerNachLauf1.lastSeenAt, new Date(uhrMs).toISOString(), "Lauf 1 muss lastSeenAt setzen");

    uhrMs += EINE_STUNDE_MS; // Stunde 1: derselbe Befund, Entprellung greift (1h < 6h-debounceMs)
    await driftWatch.runDriftSweep();
  } finally {
    Date.now = echteUhr;
  }

  assert.equal(mailVersand, 1, "Stunde 1 ist entprellt - KEIN zweiter Versand");
  assert.ok(
    auditEvents.includes("drift_ownership_lost_entprellt"),
    "ein entprellter Lauf darf nicht stumm bleiben - er muss eine eigene, unterscheidbare Audit-Zeile hinterlassen",
  );
  const markerNachLauf2 = findAlert(store, befundBucket("ownership_lost"));
  assert.equal(
    markerNachLauf2.lastSeenAt,
    new Date(uhrMs).toISOString(),
    "REVIEW-BLOCKER: die Marker-Frische (lastSeenAt) darf NICHT am Alarm-Versand haengen - " +
      "der ANI-Riegel (frischGenug) liest genau dieses Feld mit einem kuerzeren Fenster als die Entprellung",
  );
});

// W-7 (BLOCKER 4, S1-1): PRODUKTIONSNAHE Antwortform - zwei STRUKTURELLE, gueltig
// ausgenommene unknowns (EL ohne supports_outbound-Feld, KEIN Verkehr in 24h) duerfen die
// Selbstheilung NICHT mehr blockieren. Ausdruecklich OHNE die leere-ladeAusnahmen-Attrappe
// (fakeDeps' Default) - dieser Test laedt die ECHTE outbound-drift-ausnahmen.json, weil
// GENAU deren zwei Eintraege die Gegenprobe bilden (Muster des Reviewer-Befunds: "gemessen
// 7 von 9 unbekannt=2" -> ohne Fix bleiben Schliessung UND messung-ok false).
test("E4-Waechter: W-7 zwei ausgenommene unknowns (produktionsnah) -> messung-ok wird geschrieben, ein verschwundener Befund wird geschlossen", async () => {
  const store = fakeStore({
    alerts: [
      {
        id: "otg_alt",
        code: befundBucket("ownership_lost"),
        firstSeenAt: "2026-08-20T00:00:00.000Z",
        lastSeenAt: "2026-08-20T00:00:00.000Z",
        lastAttemptAt: null,
        reportedAt: null,
        deliveredChannels: null,
        closedAt: null,
      },
    ],
    calls: [], // KEIN Verkehr -> unbekannt:pruefung8 (Regelfall, in der Ausnahme-Datei ausgenommen)
  });
  const auditEvents = [];
  const driftWatch = makeDriftWatch({
    store,
    config: fakeConfig(),
    audit: (event) => auditEvents.push(event),
    messaging: () => ({ sendSms: async () => {} }),
    mailer: { sendMail: async () => {} },
    telnyxRead: fakeTelnyxRead(),
    elRead: fakeElRead({
      // KEIN supports_outbound-Feld -> unbekannt:pruefung1_supports_outbound (K-15, in
      // der Ausnahme-Datei ausgenommen)
      fetchPhoneNumber: async () => ({ phone_number: PLATFORM_ANI, assigned_agent: { agent_id: AGENT_ID } }),
    }),
    // ladeAusnahmen ABSICHTLICH NICHT injiziert - der Produktions-Default muss beide
    // strukturellen unknowns als ausgenommen erkennen.
  });
  await driftWatch.runBootProbe();

  const messungOk = findAlert(store, "drift:messung-ok");
  assert.ok(messungOk && messungOk.lastSeenAt, "BLOCKER 4: messung-ok muss geschrieben werden, obwohl zwei (ausgenommene) unknowns vorliegen");
  const alterMarker = findAlert(store, befundBucket("ownership_lost"));
  assert.ok(
    alterMarker && alterMarker.closedAt !== null,
    "BLOCKER 4: ein verschwundener Befund muss trotz ausgenommener unknowns geschlossen werden",
  );
  assert.ok(auditEvents.includes("drift_recovered"), "die Schliessung muss eine Audit-Zeile hinterlassen");
});

// W-8 (LIVE-LAGE-BEWEIS, der wichtigste Test dieser Nachbesserung): der Deploy-Stand vom
// 28.08.2026 haelt DAUERHAFT einen echten, NIE exemptierten config-Befund
// (config_ani_mismatch: EL-Registrierung +15739090177 != ani_override +18643028341 ==
// PLATFORM_ANI_E164, Weg 1 der Wiederherstellung, bewusst) - dieser Befund ist bei JEDEM
// stuendlichen Lauf (Boot, Sweep, externer Actions-Takt) IDENTISCH vorhanden, unbegrenzt.
// OHNE Blocker 3 waere das 24 Mails/24h. Simuliert werden 24 Laeufe im STUENDLICHEN Takt
// (die reale Kadenz aus boot.js#runSweepTick + dem GitHub-Actions-Cron) ueber eine
// gestellte Uhr (kein echtes Warten). Erwartung: NICHT 24 Versaende, sondern hoechstens
// alle debounceMs (Produktions-Default 6h) einer - hier exakt 4 (Stunde 0/6/12/18).
test("E4-Waechter: W-8 LIVE-LAGE-Beweis - EL-Nummer != ani_override (bewusst, Weg 1) fuehrt NICHT zu stuendlichem Mail+SMS", async () => {
  const EL_LIVE = "+15739090177"; // EL-Registrierung, unveraendert (gehoert dem Konto nicht mehr - separater Sachverhalt)
  const ANI_OVERRIDE_LIVE = "+18643028341"; // kontoeigene DID == PLATFORM_ANI_E164
  const EINE_STUNDE_MS = 3600000;
  const STUNDEN_PRO_TAG = 24;
  const ERWARTETE_VERSAENDE = 4; // 24h / 6h-Entprellung = Stunde 0, 6, 12, 18

  const store = fakeStore({ calls: gesunderVerkehr() });
  let mailVersand = 0;
  const mailer = { sendMail: async () => { mailVersand += 1; } };
  const telnyxRead = fakeTelnyxRead({
    getFqdnConnection: async () => ({ active: true, aniOverride: ANI_OVERRIDE_LIVE }),
  });
  const elRead = fakeElRead({
    fetchPhoneNumber: async () => ({
      phone_number: EL_LIVE,
      assigned_agent: { agent_id: AGENT_ID },
      supports_outbound: true, // alles AUSSER der bewussten Weg-1-Abweichung bleibt gesund
    }),
  });
  const config = fakeConfig({ platformAniE164: ANI_OVERRIDE_LIVE, platformAlertMailTo: "owner@example.com" });
  const deps = fakeDeps({ store, config, telnyxRead, elRead, audit: () => {} });
  deps.mailer = mailer;
  const driftWatch = makeDriftWatch(deps);

  const echteUhr = Date.now;
  let uhrMs = Date.parse("2026-08-29T00:00:00.000Z");
  Date.now = () => uhrMs;
  try {
    await driftWatch.runBootProbe(); // Stunde 0
    // Bewusst sequenziell (kein Promise.all): jeder Lauf muss den durablen Marker-Stand
    // des VORHERIGEN Laufs sehen (Entprellung/Single-Flight lesen den Store) - genau die
    // reale Reihenfolge stuendlicher Cron-Ticks.
    for (let stunde = 1; stunde < STUNDEN_PRO_TAG; stunde += 1) {
      uhrMs += EINE_STUNDE_MS;
      await driftWatch.runDriftSweep();
    }
  } finally {
    Date.now = echteUhr;
  }

  assert.ok(mailVersand < STUNDEN_PRO_TAG, `${mailVersand} Mails an 24 stuendlichen Laeufen waere weiterhin stuendlich`);
  assert.equal(
    mailVersand,
    ERWARTETE_VERSAENDE,
    "die 6h-Entprellung (config.billing.outageAlertDebounceMs) muss auf 4 Versaende pro Tag reduzieren",
  );
});

// Gegenprobe zu W-3 (Blocker-Vermeidungsliste 2): die ALTE Bedingung ("Befund fehlt in
// diesem Lauf -> schliessen", ohne das zaehler.unknown-Gate) haette den Marker in W-3
// SEHR WOHL geschlossen - das belegt, dass W-3 tatsaechlich das Blocker-2-Verhalten prueft
// und nicht zufaellig gruen ist.
test("E4-Waechter: W-3c Gegenprobe - OHNE das zaehler-Gate haette Lauf 2 aus W-3 den Marker geschlossen", () => {
  const alteBedingung = (befundeDiesesLaufs, code) => !befundeDiesesLaufs.some((befundCode) => befundCode === code);
  const befundeAusfall = ["unbekannt:pruefung3", "unbekannt:pruefung8"]; // ownership_lost fehlt, weil unknown statt Urteil
  assert.equal(
    alteBedingung(befundeAusfall, "ownership_lost"),
    true,
    "die ALTE Bedingung haette faelschlich 'verschwunden -> schliessen' gemeldet",
  );
});
