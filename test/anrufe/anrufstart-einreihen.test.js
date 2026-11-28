import { ANBIETER, AUSGEHEND_JE_KUNDE, LEITUNGSPLATZ_ENTSCHEIDUNG } from "../../src/store.js";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { schalteNebenkanaeleAb, tempDataDir, seedState, EL_OUTBOUND_CONFIG } from "../helpers.js";
import { WARTEFRIST_REASON } from "../../src/telephony/failure-reason.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makePgTestStore } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitSperreGelesen } from "../gemeinsam/sperre-gelesen-attrappe.js";
import { vorspannDiAttrappe, vorspannKonfig, vorspannSeedNummer } from "../gemeinsam/vorspann-fahrzeug.js";

const TENANT = "T";
const VALID_TO = "+491711234567";
const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_TOO_MANY = 429;
const UHR_TOLERANZ_MS = 5000;

let makeCallRoutes;

before(async () => {
  schalteNebenkanaeleAb();
  process.env.DATA_DIR = tempDataDir(seedState({}));
  ({ makeCallRoutes } = await import("../../src/routes/api-calls.ts"));
});

async function baueStore(protokoll) {
  const { store: echt } = await makePgTestStore();
  const basis = {
    tenantLanguage: () => "de",
    countOutboundCallsSince: () => 0,
    tenantPrivateNumber: () => null,
    tenantGeo: () => ({ country: "DE", defaultLanguage: "de" }),
    load: () => ({
      numbers: [vorspannSeedNummer({ tenantId: TENANT, nummer: "+491700000000", registrierung: "phnum_einr" })],
    }),
    numberRecordByE164: (e164) => ({ e164, tenantId: TENANT, providerAgentPhoneNumberId: "phnum_einr" }),
    kycReached: () => true,
    tenantContext: () => ({ ownerName: "Alice", settings: { allowResearch: false } }),
    resolveProfile: () => ({
      unrestricted: true,
      allowedCountryCodes: null,
      maxCallsPerHour: null,
      allowedNumbers: [],
      allowConsult: false,
      allowLookup: false,
    }),
    tenantInactive: () => false,
    billingHoldActive: () => null,
    tenantActiveSubscriber: () => true,
    tenantSubscription: () => ({}),
    planMinutesExceeded: () => false,
    budgetExceeded: () => false,
    tryReserveOutboundBudget: () => true,
    tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 350, remainingCents: 650 }),
    reserveExceedsBudget: () => true,
    claimPlatformSpendWarning: () => null,
    activeCallsFor: () => [],
    activeCallsForSql: async () => [],
    releaseOutboundReserveCents: () => true,
    persistCall: async () => {},
    createCall: (felder) => {
      const angelegt = { ...felder };
      protokoll.angelegt.push(angelegt);
      return angelegt;
    },
    recordCostProfile: () => {},
    leseCall: async (callId) => protokoll.angelegt.find((call) => call.id === callId) ?? null,
    getCall: (callId) => protokoll.angelegt.find((call) => call.id === callId) ?? null,
    anrufpauseAktiv: () => protokoll.pause,
    recordFailureReason: (callId, grund) => protokoll.gruende.push([callId, grund]),
    endCallRecord: (callId, status) => protokoll.enden.push([callId, status]),
    save: () => protokoll.gespeichert.push(true),
  };
  return mitSperreGelesen(Object.assign(echt, basis));
}

function konfig() {
  return withConfigNamespaces({
    outboundFrozen: false,
    assistantContextEnabled: false,
    paymentEnabled: false,
    platformSpendCapCents: 800,
    allowedCountryCodes: ["+49"],
    maxCallsPerHour: 100,
    perTargetWindowMs: 3600000,
    perTargetCallCap: 100,
    multiTenant: false,
    diagnosticRetentionDays: 0,
    ownerSelfCallEnabled: false,
    ownerSelfCallTenantIds: [],
    ...vorspannKonfig([TENANT], EL_OUTBOUND_CONFIG),
    telnyxAssistant: { enabled: false },
    telnyxElevenLabs: {},
    voiceEngine: "budget",
    publicUrl: "http://127.0.0.1:1",
  });
}

const KONTEXT = Object.freeze({
  tenantId: TENANT,
  requestedBy: "owner",
  fromNumber: "+491700000000",
  outboundProvider: "telnyx",
  numberRecord: { e164: "+491700000000", tenantId: TENANT, providerAgentPhoneNumberId: "phnum_einr" },
  maxDur: 300,
  reserveCents: 100,
  context: null,
});

const leitungsplaetzeMit = (entscheidung, aufrufe, belegenEntscheidung = entscheidung) => ({
  pruefenAusgehend: async (anfrage) => {
    aufrufe.pruefen.push(anfrage);
    return entscheidung;
  },
  belegenAusgehend: async (anfrage) => {
    aufrufe.belegen.push(anfrage);
    return { entscheidung: belegenEntscheidung };
  },
  belegenWartend: async () => LEITUNGSPLATZ_ENTSCHEIDUNG.FREI,
  freigeben: () => {},
});

async function postBeiVollerPlattform({
  anrufstart,
  vorbereitung = () => {},
  entscheidung = LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL,
  belegenEntscheidung = entscheidung,
  gates = [],
  attrappe = vorspannDiAttrappe(),
  arm = { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
}) {
  const aufrufe = { pruefen: [], belegen: [] };
  const protokoll = { angelegt: [], gruende: [], enden: [], abgerechnet: [], pause: false, gespeichert: [], aufrufe };
  const store = await baueStore(protokoll);
  const config = konfig();
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      ...attrappe,
      store,
      leitungsplaetze: leitungsplaetzeMit(entscheidung, aufrufe, belegenEntscheidung),
      config,
      audit: () => {},
      outboundGates: [{ name: "kontext", run: (ctx) => Object.assign(ctx, KONTEXT) && null }, ...gates],
      callQuotaDenial: async () => null,
      voiceControl: () => ({}),
      terminateAndBillCall: async ({ persistEnd, bill }) => {
        await persistEnd();
        await bill();
      },
      hangUpAction: () => null,
      billThunk: (_finish, _store, callId) => () => protokoll.abgerechnet.push(callId),
      finishCall: () => {},
      arm,
      anrufstart,
      tenant: { requestTenant: () => TENANT, requireTenant: () => TENANT, tenantOwnsCall: () => true },
      consultDelivery: { waitForEvent: async () => ({}) },
      internalIdentity: () => null,
      OWNER_ID: "owner",
    }),
  );
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  try {
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: VALID_TO, objective: "Termin vereinbaren" }),
    });
    const ergebnis = { status: res.status, body: await res.json(), wahlversuche: attrappe.gewaehlt.length, gewaehlt: attrappe.gewaehlt, protokoll, config };
    await vorbereitung(ergebnis);
    return ergebnis;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const FEHLSCHLAEGE = [
  { name: "keine Verdrahtung", anrufstart: undefined, log: /Der Anrufstart-Auftrag ist nicht verdrahtet \(deps\.anrufstart fehlt\)/ },
  { name: "einreihen liefert false", anrufstart: { einreihen: async () => false }, log: /Auftrag nicht eingereiht/ },
  {
    name: "einreihen wirft",
    anrufstart: {
      einreihen: async () => {
        throw new Error("Warteschlange kaputt");
      },
    },
    log: /Warteschlange kaputt/,
  },
];

for (const fall of FEHLSCHLAEGE)
  test(`Wartender Anruf: ${fall.name}, der Anruf endet mit 503, ohne Wahl, mit freier Reserve und Grund not-placed:warteschlange`, async (t) => {
    const fehlerlog = t.mock.method(console, "error", () => {});
    const ergebnis = await postBeiVollerPlattform({ anrufstart: fall.anrufstart });
    const [angelegt] = ergebnis.protokoll.angelegt;
    const anrufId = angelegt.id;
    assert.equal(ergebnis.status, HTTP_SERVICE_UNAVAILABLE);
    assert.match(ergebnis.body.error, /Es wurde nicht gewaehlt, es entstehen keine Kosten/);
    assert.equal(ergebnis.wahlversuche, 0);
    assert.deepEqual(ergebnis.protokoll.gruende, [[anrufId, "not-placed:warteschlange"]]);
    assert.deepEqual(ergebnis.protokoll.enden, [[anrufId, "failed"]]);
    assert.deepEqual(ergebnis.protokoll.abgerechnet, [anrufId]);
    assert.ok(
      fehlerlog.mock.calls.some(
        (aufruf) =>
          String(aufruf.arguments[0]) === `[place_call] Warteschlange nicht erreichbar call=${anrufId}:` &&
          fall.log.test(String(aufruf.arguments[1])),
      ),
      "die Warteschlangen-Stoerung steht im Betriebslog",
    );
  });

test("Wartender Anruf: bricht der Start ab (keine Call-Control-App), endet er mit not-placed:<Grund>, ohne Wahl, und der Auftrag meldet den Abbruch", async (t) => {
  t.mock.method(console, "log", () => {});
  let auftrag;
  const ergebnis = await postBeiVollerPlattform({
    anrufstart: {
      einreihen: async () => true,
      macheAuftrag: (abhaengigkeiten) => abhaengigkeiten,
      verdrahtung: { setzeHandler: (abhaengigkeiten) => (auftrag = abhaengigkeiten) },
    },
    vorbereitung: async ({ config }) => Object.assign(config.telephony, { telnyxCallControlAppId: "" }),
  });
  assert.equal(ergebnis.status, HTTP_OK);
  assert.equal(ergebnis.body.status, "dialing");
  const [angelegt] = ergebnis.protokoll.angelegt;
  const anrufId = angelegt.id;
  await assert.rejects(auftrag.starte(ergebnis.protokoll.angelegt[0]), new RegExp(`\\[anrufstart\\] nicht gewaehlt \\(call=${anrufId}\\)`));
  assert.equal(ergebnis.wahlversuche, 0);
  assert.deepEqual(ergebnis.protokoll.gruende, [[anrufId, "not-placed:keine_call_control_app"]]);
});

test("Volle Plattform: der Anruf wird eingereiht und antwortet sofort dialing, ohne Wahl und ohne belegten Platz", async () => {
  const eingereiht = [];
  const ergebnis = await postBeiVollerPlattform({
    anrufstart: {
      einreihen: async (anrufId) => {
        eingereiht.push(anrufId);
        return true;
      },
    },
  });
  const [angelegt] = ergebnis.protokoll.angelegt;
  assert.equal(ergebnis.status, HTTP_OK);
  assert.equal(ergebnis.body.status, "dialing");
  assert.equal(ergebnis.body.callId, angelegt.id);
  assert.equal(ergebnis.body.deduplicated, false);
  assert.deepEqual(eingereiht, [angelegt.id]);
  assert.equal(ergebnis.wahlversuche, 0);
  assert.deepEqual(ergebnis.protokoll.aufrufe.belegen, []);
  assert.deepEqual(ergebnis.protokoll.aufrufe.pruefen, [
    { tenantId: TENANT, weg: ANBIETER.ELEVENLABS, hoechstzahlKunde: AUSGEHEND_JE_KUNDE },
  ]);
  assert.deepEqual(ergebnis.protokoll.gruende, []);
  assert.deepEqual(ergebnis.protokoll.enden, []);
});

test("Platz im Rennen verloren: war die Vorpruefung frei und ist die Plattform beim Belegen voll, wird der Anruf eingereiht statt mit 503 abgelehnt", async () => {
  const eingereiht = [];
  const ergebnis = await postBeiVollerPlattform({
    anrufstart: {
      einreihen: async (anrufId) => {
        eingereiht.push(anrufId);
        return true;
      },
    },
    entscheidung: LEITUNGSPLATZ_ENTSCHEIDUNG.FREI,
    belegenEntscheidung: LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL,
  });
  const [angelegt] = ergebnis.protokoll.angelegt;
  assert.equal(ergebnis.status, HTTP_OK);
  assert.equal(ergebnis.body.status, "dialing");
  assert.deepEqual(eingereiht, [angelegt.id]);
  assert.equal(ergebnis.wahlversuche, 0);
  assert.deepEqual(ergebnis.protokoll.gruende, []);
});

test("Platz im Rennen verloren: ist der Kunde beim Belegen voll, bleibt es bei 429 ohne Anlegen und Einreihen", async () => {
  let eingereiht = 0;
  const ergebnis = await postBeiVollerPlattform({
    anrufstart: { einreihen: async () => ++eingereiht > 0 },
    entscheidung: LEITUNGSPLATZ_ENTSCHEIDUNG.FREI,
    belegenEntscheidung: LEITUNGSPLATZ_ENTSCHEIDUNG.KUNDE_VOLL,
  });
  assert.equal(ergebnis.status, HTTP_TOO_MANY);
  assert.equal(eingereiht, 0);
  assert.deepEqual(ergebnis.protokoll.angelegt, []);
});

test("Kunde voll: bleibt die sofortige Ablehnung 429, nichts wird angelegt oder eingereiht", async () => {
  let eingereiht = 0;
  const ergebnis = await postBeiVollerPlattform({
    anrufstart: { einreihen: async () => ++eingereiht > 0 },
    entscheidung: LEITUNGSPLATZ_ENTSCHEIDUNG.KUNDE_VOLL,
  });
  assert.equal(ergebnis.status, HTTP_TOO_MANY);
  assert.equal(eingereiht, 0);
  assert.deepEqual(ergebnis.protokoll.angelegt, []);
  assert.equal(ergebnis.wahlversuche, 0);
});

test("Volle Plattform: ein Gate der Route lehnt weiter vor dem Anlegen und Einreihen ab", async () => {
  let eingereiht = 0;
  const ergebnis = await postBeiVollerPlattform({
    anrufstart: { einreihen: async () => ++eingereiht > 0 },
    gates: [{ name: "sperre", run: () => ({ status: 403, body: { error: "gesperrt" }, audit: null }) }],
  });
  assert.equal(ergebnis.status, 403);
  assert.equal(ergebnis.body.error, "gesperrt");
  assert.equal(eingereiht, 0);
  assert.deepEqual(ergebnis.protokoll.angelegt, []);
});

async function wartenderAuftrag(optionen = {}) {
  const verbindungen = [];
  const arm = { gestellt: [], armMaxDurationTimer: (...args) => arm.gestellt.push(["max", ...args]), armReserveReleaseTimer: (...args) => arm.gestellt.push(["reserve", ...args]) };
  const ergebnis = await postBeiVollerPlattform({
    anrufstart: {
      einreihen: async () => true,
      macheAuftrag: (verbindung) => verbindung,
      verdrahtung: { setzeHandler: (verbindung) => verbindungen.push(verbindung) },
      ...optionen.anrufstart,
    },
    arm,
    attrappe: optionen.attrappe,
    entscheidung: optionen.entscheidung,
  });
  return { ergebnis, arm, verbindung: verbindungen[0], anruf: ergebnis.protokoll.angelegt[0] };
}

test("Wartender Anruf: die Route verdrahtet genau einen Auftrag", async () => {
  const verbindungen = [];
  await postBeiVollerPlattform({
    anrufstart: {
      einreihen: async () => true,
      macheAuftrag: (verbindung) => verbindung,
      verdrahtung: { setzeHandler: (verbindung) => verbindungen.push(verbindung) },
    },
  });
  assert.equal(verbindungen.length, 1);
});

test("Wartender Anruf: der Auftrag waehlt ueber die Wahlfolge der Route genau einmal und haelt die Call-Control-ID fest", async (t) => {
  t.mock.method(console, "log", () => {});
  const { ergebnis, verbindung, anruf } = await wartenderAuftrag();
  assert.deepEqual(ergebnis.gewaehlt, []);
  const gespeichertVorher = ergebnis.protokoll.gespeichert.length;
  await verbindung.starte(anruf);
  assert.equal(ergebnis.protokoll.gespeichert.length, gespeichertVorher + 1);
  assert.deepEqual(ergebnis.gewaehlt, [anruf.id]);
  assert.equal(anruf.callControlId, `cc_callee_${anruf.id}`);
  assert.deepEqual(ergebnis.protokoll.gruende, []);
});

test("Wartender Anruf: ist der Anruf nach der Wahl nicht mehr gespeichert, endet der Auftrag ohne Fehler", async (t) => {
  t.mock.method(console, "log", () => {});
  const { ergebnis, verbindung, anruf } = await wartenderAuftrag();
  ergebnis.protokoll.angelegt.splice(0);
  await verbindung.starte(anruf);
  assert.deepEqual(ergebnis.gewaehlt, [anruf.id]);
  assert.equal(anruf.callControlId, undefined);
});

test("Wartender Anruf: ein Wahlfehler beendet den Anruf als gescheitert, rechnet ab und wird weitergereicht", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
  const attrappe = vorspannDiAttrappe();
  attrappe.vorspannAblauf.waehle = async () => {
    throw new Error("Wahl kaputt");
  };
  const { ergebnis, verbindung, anruf } = await wartenderAuftrag({ attrappe });
  await assert.rejects(verbindung.starte(anruf), /Wahl kaputt/);
  assert.deepEqual(ergebnis.protokoll.enden, [[anruf.id, "failed"]]);
  assert.deepEqual(ergebnis.protokoll.abgerechnet, [anruf.id]);
  assert.equal(anruf.callControlId, undefined);
});

test("Wartender Anruf: sperrt die Vorwahl-Pruefung, endet er ohne Grund-Eintrag und der Auftrag meldet den Abbruch", async (t) => {
  t.mock.method(console, "log", () => {});
  const attrappe = vorspannDiAttrappe();
  attrappe.vorspannAblauf.pruefe = async () => ({ grund: "gesperrt" });
  const { ergebnis, verbindung, anruf } = await wartenderAuftrag({ attrappe });
  await assert.rejects(verbindung.starte(anruf), new RegExp(`\\[anrufstart\\] nicht gewaehlt \\(call=${anruf.id}\\)`));
  assert.equal(ergebnis.wahlversuche, 0);
  assert.deepEqual(ergebnis.protokoll.gruende, []);
});

test("Wartender Anruf: die Sperren des Auftrags lesen Einfrieren, Anrufpause und Abbruch", async () => {
  const { ergebnis, verbindung, anruf } = await wartenderAuftrag();
  const { sperren } = verbindung;
  assert.equal(sperren.eingefroren(), false);
  ergebnis.config.safety.outboundFrozen = true;
  assert.equal(sperren.eingefroren(), true);
  assert.equal(await sperren.pausiert(anruf), false);
  ergebnis.protokoll.pause = true;
  assert.equal(await sperren.pausiert(anruf), true);
  assert.equal(sperren.abgebrochen({ status: "active" }), false);
  assert.equal(sperren.abgebrochen({ status: "cancelled" }), true);
});

test("Wartender Anruf: Ende ohne Wahl und nach der Wartefrist tragen die Gruende ein, rechnen ab und geben frei", async () => {
  const { ergebnis, verbindung, anruf } = await wartenderAuftrag();
  await verbindung.beendeOhneWahl(anruf.id, "anrufpause");
  assert.deepEqual(ergebnis.protokoll.gruende, [[anruf.id, "not-placed:anrufpause"]]);
  await verbindung.platz.beendeNachWartefrist(anruf.id);
  assert.deepEqual(ergebnis.protokoll.gruende, [
    [anruf.id, "not-placed:anrufpause"],
    [anruf.id, WARTEFRIST_REASON],
  ]);
  assert.deepEqual(ergebnis.protokoll.enden, [
    [anruf.id, "failed"],
    [anruf.id, "failed"],
  ]);
  assert.deepEqual(ergebnis.protokoll.abgerechnet, [anruf.id, anruf.id]);
});

test("Wartender Anruf: der Platz wird erst im Auftrag belegt, mit Dauer des Anrufs, und nur FREI zaehlt", async () => {
  const { ergebnis, verbindung, anruf } = await wartenderAuftrag();
  anruf.maxDurationS = 321;
  assert.equal(await verbindung.platz.belege(anruf), false);
  assert.deepEqual(ergebnis.protokoll.aufrufe.belegen, [
    { tenantId: TENANT, weg: ANBIETER.ELEVENLABS, hoechstzahlKunde: AUSGEHEND_JE_KUNDE, callId: anruf.id, maxDauerS: 321 },
  ]);
});

test("Wartender Anruf: ist der Platz frei, belegt der Auftrag ihn", async () => {
  const { verbindung, anruf } = await wartenderAuftrag({ entscheidung: LEITUNGSPLATZ_ENTSCHEIDUNG.FREI });
  assert.equal(await verbindung.platz.belege(anruf), true);
});

test("Wartender Anruf: die Timer werden ab der Wahl mit Anruf und Sitzungs-ID gestellt", async () => {
  const { arm, verbindung, anruf } = await wartenderAuftrag();
  anruf.twilioSid = "sid_wartend";
  verbindung.armeTimer(anruf);
  assert.deepEqual(arm.gestellt, [
    ["max", anruf, "sid_wartend"],
    ["reserve", anruf],
  ]);
});

test("Wartender Anruf: ohne eigene Uhr laufen Zeit und Warten ueber die Systemuhr", async () => {
  const { verbindung } = await wartenderAuftrag();
  assert.ok(Math.abs(verbindung.jetztMs() - Date.now()) < UHR_TOLERANZ_MS);
  assert.equal(await verbindung.platz.warte(0), undefined);
});

test("Wartender Anruf: eine uebergebene Uhr wird benutzt", async () => {
  const gewartet = [];
  const { verbindung } = await wartenderAuftrag({
    anrufstart: { uhr: { jetztMs: () => 4242, warte: async (ms) => gewartet.push(ms) } },
  });
  assert.equal(verbindung.jetztMs(), 4242);
  await verbindung.platz.warte(1000);
  assert.deepEqual(gewartet, [1000]);
});

const VERDRAHTUNGS_FAELLE = [
  { name: "nur der Auftragsbauer", auftragGebaut: 0, handlerGesetzt: 0, nurAuftrag: true },
  { name: "nur die Verdrahtung", auftragGebaut: 0, handlerGesetzt: 0, nurAuftrag: false },
];

for (const fall of VERDRAHTUNGS_FAELLE)
  test(`Anrufstart-Verdrahtung: ${fall.name} gesetzt, die Routen entstehen ohne Absturz und kein Handler wird gesetzt`, async (t) => {
    t.mock.method(console, "error", () => {});
    const gezaehlt = { gebaut: 0, handler: 0 };
    const macheAuftrag = () => {
      gezaehlt.gebaut += 1;
      return {};
    };
    const verdrahtung = {
      setzeHandler: () => {
        gezaehlt.handler += 1;
      },
    };
    const anrufstart = fall.nurAuftrag ? { macheAuftrag } : { verdrahtung };
    await assert.doesNotReject(postBeiVollerPlattform({ anrufstart }));
    assert.equal(gezaehlt.gebaut, fall.auftragGebaut);
    assert.equal(gezaehlt.handler, fall.handlerGesetzt);
  });

const NICHT_GEWAEHLT = (anruf) => new RegExp(`\\[anrufstart\\] nicht gewaehlt \\(call=${anruf.id}\\)`);

test("Wartender Anruf: ist das Einfrieren beim Entnehmen aktiv, wird nicht gewaehlt und der Anruf endet mit dem Grund", async (t) => {
  t.mock.method(console, "log", () => {});
  const { ergebnis, verbindung, anruf } = await wartenderAuftrag();
  ergebnis.config.safety.outboundFrozen = true;
  await assert.rejects(verbindung.starte(anruf), NICHT_GEWAEHLT(anruf));
  assert.equal(ergebnis.wahlversuche, 0);
  assert.deepEqual(ergebnis.gewaehlt, []);
  assert.deepEqual(ergebnis.protokoll.gruende, [[anruf.id, "not-placed:outbound-frozen"]]);
  assert.deepEqual(ergebnis.protokoll.enden, [[anruf.id, "failed"]]);
});

test("Wartender Anruf: ist die Anrufpause beim Entnehmen aktiv, wird nicht gewaehlt und der Anruf endet mit dem Grund", async (t) => {
  t.mock.method(console, "log", () => {});
  const { ergebnis, verbindung, anruf } = await wartenderAuftrag();
  ergebnis.protokoll.pause = true;
  await assert.rejects(verbindung.starte(anruf), NICHT_GEWAEHLT(anruf));
  assert.equal(ergebnis.wahlversuche, 0);
  assert.deepEqual(ergebnis.protokoll.gruende, [[anruf.id, "not-placed:anrufpause"]]);
  assert.deepEqual(ergebnis.protokoll.enden, [[anruf.id, "failed"]]);
});

test("Wartender Anruf: Einfrieren geht der Anrufpause vor", async (t) => {
  t.mock.method(console, "log", () => {});
  const { ergebnis, verbindung, anruf } = await wartenderAuftrag();
  ergebnis.config.safety.outboundFrozen = true;
  ergebnis.protokoll.pause = true;
  await assert.rejects(verbindung.starte(anruf), NICHT_GEWAEHLT(anruf));
  assert.deepEqual(ergebnis.protokoll.gruende, [[anruf.id, "not-placed:outbound-frozen"]]);
});

test("Wartender Anruf: scheitert das Lesen einer Sperre, wird nicht gewaehlt und der Anruf endet mit tor-fehler", async (t) => {
  t.mock.method(console, "log", () => {});
  const { ergebnis, verbindung, anruf } = await wartenderAuftrag();
  Object.defineProperty(ergebnis.protokoll, "pause", {
    get: () => {
      throw new Error("Pause nicht lesbar");
    },
  });
  await assert.rejects(verbindung.starte(anruf), NICHT_GEWAEHLT(anruf));
  assert.deepEqual(ergebnis.gewaehlt, []);
  assert.deepEqual(ergebnis.protokoll.gruende, [[anruf.id, "not-placed:tor-fehler"]]);
});

test("Wartender Anruf: scheitert das Lesen der Pause, nennt das Betriebsprotokoll das Tor pausiert und den Anruf", async (t) => {
  t.mock.method(console, "log", () => {});
  const fehlerZeilen = [];
  t.mock.method(console, "error", (...teile) => fehlerZeilen.push(teile.join(" ")));
  const { ergebnis, verbindung, anruf } = await wartenderAuftrag();
  Object.defineProperty(ergebnis.protokoll, "pause", {
    get: () => {
      throw new Error("Pause nicht lesbar");
    },
  });
  await assert.rejects(verbindung.starte(anruf), NICHT_GEWAEHLT(anruf));
  assert.deepEqual(fehlerZeilen, [`[anrufstart] Tor pausiert nicht lesbar call=${anruf.id}: Pause nicht lesbar`]);
});

test("Wartender Anruf: scheitert das Lesen des Einfrierens, nennt das Betriebsprotokoll das Tor eingefroren und den Anruf", async (t) => {
  t.mock.method(console, "log", () => {});
  const fehlerZeilen = [];
  t.mock.method(console, "error", (...teile) => fehlerZeilen.push(teile.join(" ")));
  const { ergebnis, verbindung, anruf } = await wartenderAuftrag();
  Object.defineProperty(ergebnis.config, "outboundFrozen", {
    get: () => {
      throw new Error("Einfrieren nicht lesbar");
    },
  });
  await assert.rejects(verbindung.starte(anruf), NICHT_GEWAEHLT(anruf));
  assert.deepEqual(ergebnis.protokoll.gruende, [[anruf.id, "not-placed:tor-fehler"]]);
  assert.deepEqual(fehlerZeilen, [`[anrufstart] Tor eingefroren nicht lesbar call=${anruf.id}: Einfrieren nicht lesbar`]);
});
