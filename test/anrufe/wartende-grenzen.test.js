import { test, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { schalteNebenkanaeleAb, tempDataDir, seedState, EL_OUTBOUND_CONFIG } from "../helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makePgTestStore } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitSperreGelesen } from "../gemeinsam/sperre-gelesen-attrappe.js";
import { vorspannDiAttrappe, vorspannKonfig, vorspannSeedNummer } from "../gemeinsam/vorspann-fahrzeug.js";
import * as speicher from "../../src/store.js";

const { ANBIETER, LEITUNGSPLATZ_ENTSCHEIDUNG } = speicher;
const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_TOO_MANY = 429;
const FREMD = "fremd";
const MAX_DAUER_S = 300;
const WARTE_ABLAUF_S = 150;
const MS_JE_S = 1000;

let makeCallRoutes;

before(async () => {
  schalteNebenkanaeleAb();
  process.env.DATA_DIR = tempDataDir(seedState({}));
  ({ makeCallRoutes } = await import("../../src/routes/api-calls.ts"));
});

const jeKunde = () => speicher.WARTENDE_JE_KUNDE;
const gesamt = () => speicher.WARTENDE_GESAMT;
const kunden = (anzahl) => Array.from({ length: anzahl }, (_, index) => `kunde_${index}`);
const platzAnfrage = (callId, tenantId) => ({ callId, tenantId, weg: ANBIETER.ELEVENLABS, maxDauerS: MAX_DAUER_S, hoechstzahlKunde: 2 });
const wartend = (callId, tenantId) => ({ callId, tenantId });

async function fuelleAnbieter(plaetze) {
  for (let index = 0; index < 6; index += 1)
    await plaetze.belegenEingehend({ callId: `${FREMD}_${index}`, tenantId: FREMD, weg: ANBIETER.ELEVENLABS, maxDauerS: MAX_DAUER_S });
}

async function leereAnbieter(plaetze) {
  for (let index = 0; index < 6; index += 1) await plaetze.freigeben(`${FREMD}_${index}`);
}

async function baueStore(protokoll) {
  const { store: echt } = await makePgTestStore();
  const basis = {
    tenantLanguage: () => "de",
    countOutboundCallsSince: () => 0,
    tenantPrivateNumber: () => null,
    tenantGeo: () => ({ country: "DE", defaultLanguage: "de" }),
    load: () => ({ numbers: [vorspannSeedNummer({ tenantId: "T", nummer: "+491700000000", registrierung: "phnum_w" })] }),
    numberRecordByE164: (e164) => ({ e164, tenantId: "T", providerAgentPhoneNumberId: "phnum_w" }),
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
    anrufpauseAktiv: () => false,
    recordFailureReason: () => {},
    endCallRecord: () => {},
    save: () => {},
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
    ...vorspannKonfig(["T"], EL_OUTBOUND_CONFIG),
    telnyxAssistant: { enabled: false },
    telnyxElevenLabs: {},
    voiceEngine: "budget",
    publicUrl: "http://127.0.0.1:1",
  });
}

async function mitRoute({ leitungsplaetze, lauf }) {
  const protokoll = { angelegt: [], eingereiht: [] };
  const attrappe = vorspannDiAttrappe();
  const store = await baueStore(protokoll);
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      ...attrappe,
      store,
      leitungsplaetze,
      config: konfig(),
      audit: () => {},
      outboundGates: [
        {
          name: "kontext",
          run: (ctx) =>
            Object.assign(ctx, {
              tenantId: ctx.req.headers["x-kunde"],
              requestedBy: "owner",
              fromNumber: "+491700000000",
              outboundProvider: "telnyx",
              numberRecord: { e164: "+491700000000", tenantId: "T", providerAgentPhoneNumberId: "phnum_w" },
              maxDur: MAX_DAUER_S,
              reserveCents: 100,
              context: null,
            }) && null,
        },
      ],
      callQuotaDenial: async () => null,
      voiceControl: () => ({}),
      terminateAndBillCall: async ({ persistEnd }) => persistEnd(),
      hangUpAction: () => null,
      billThunk: () => () => {},
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      anrufstart: {
        einreihen: async (callId) => {
          protokoll.eingereiht.push(callId);
          return true;
        },
      },
      tenant: { requestTenant: () => "T", requireTenant: () => "T", tenantOwnsCall: () => true },
      consultDelivery: { waitForEvent: async () => ({}) },
      internalIdentity: () => null,
      OWNER_ID: "owner",
    }),
  );
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  let nummer = 0;
  const rufe = async (kunde) => {
    nummer += 1;
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kunde": kunde },
      body: JSON.stringify({ to: `+4917112345${String(nummer).padStart(2, "0")}`, objective: "Termin vereinbaren" }),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    return await lauf({ rufe, protokoll, attrappe });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function vollePlattform() {
  const plaetze = speicher.makeLeitungsplaetze();
  await fuelleAnbieter(plaetze);
  return plaetze;
}

test("Die Grenzen der Wartenden sind Zahlen, je Kunde kleiner als gesamt", () => {
  assert.equal(typeof jeKunde(), "number");
  assert.equal(typeof gesamt(), "number");
  assert.ok(jeKunde() >= 1 && jeKunde() < gesamt());
});

test("Je Kunde: ab WARTENDE_JE_KUNDE Wartenden lehnt die Route den naechsten sofort mit 429 ab, ohne Anruf, Einreihen und Wahl", async () => {
  const plaetze = await vollePlattform();
  await mitRoute({
    leitungsplaetze: plaetze,
    lauf: async ({ rufe, protokoll, attrappe }) => {
      for (let index = 0; index < jeKunde(); index += 1) assert.equal((await rufe("kunde_a")).status, HTTP_OK);
      const abgelehnt = await rufe("kunde_a");
      assert.equal(abgelehnt.status, HTTP_TOO_MANY);
      assert.equal(abgelehnt.body.reason, "gleichzeitig_limit");
      assert.equal(protokoll.angelegt.length, jeKunde());
      assert.equal(protokoll.eingereiht.length, jeKunde());
      assert.deepEqual(attrappe.gewaehlt, []);
      assert.deepEqual([...(await plaetze.belegteAnrufe(protokoll.angelegt.map((call) => call.id)))], []);
    },
  });
});

test("Je Kunde: ein anderer Kunde wartet weiter, auch wenn der erste voll ist", async () => {
  const plaetze = await vollePlattform();
  await mitRoute({
    leitungsplaetze: plaetze,
    lauf: async ({ rufe, protokoll }) => {
      for (let index = 0; index < jeKunde(); index += 1) await rufe("kunde_a");
      const anderer = await rufe("kunde_b");
      assert.equal(anderer.status, HTTP_OK);
      assert.equal(protokoll.eingereiht.length, jeKunde() + 1);
    },
  });
});

test("Gesamt: sind WARTENDE_GESAMT Anrufe eingereiht, lehnt die Route den naechsten Kunden sofort mit 503 ab, ohne Anruf und Einreihen", async () => {
  const plaetze = await vollePlattform();
  await mitRoute({
    leitungsplaetze: plaetze,
    lauf: async ({ rufe, protokoll, attrappe }) => {
      const fuellung = kunden(Math.ceil(gesamt() / jeKunde()));
      let angenommen = 0;
      for (const kunde of fuellung)
        for (let index = 0; index < jeKunde() && angenommen < gesamt(); index += 1) {
          assert.equal((await rufe(kunde)).status, HTTP_OK);
          angenommen += 1;
        }
      assert.equal(angenommen, gesamt());
      const abgelehnt = await rufe("kunde_neu");
      assert.equal(abgelehnt.status, HTTP_SERVICE_UNAVAILABLE);
      assert.equal(abgelehnt.body.reason, "ausgelastet");
      assert.equal(protokoll.angelegt.length, gesamt());
      assert.equal(protokoll.eingereiht.length, gesamt());
      assert.deepEqual(attrappe.gewaehlt, []);
    },
  });
});

test("Ein beendeter Wartender gibt seinen Warteplatz frei, der naechste Anruf desselben Kunden wird wieder eingereiht", async () => {
  const plaetze = await vollePlattform();
  await mitRoute({
    leitungsplaetze: plaetze,
    lauf: async ({ rufe, protokoll }) => {
      for (let index = 0; index < jeKunde(); index += 1) await rufe("kunde_a");
      assert.equal((await rufe("kunde_a")).status, HTTP_TOO_MANY);
      await plaetze.freigeben(protokoll.angelegt[0].id);
      assert.equal((await rufe("kunde_a")).status, HTTP_OK);
    },
  });
});

test("Ein Wartender, der einen Platz bekommt, zaehlt nicht mehr als wartend", async () => {
  const plaetze = await vollePlattform();
  await mitRoute({
    leitungsplaetze: plaetze,
    lauf: async ({ rufe, protokoll }) => {
      for (let index = 0; index < jeKunde(); index += 1) await rufe("kunde_a");
      assert.equal((await rufe("kunde_a")).status, HTTP_TOO_MANY);
      await leereAnbieter(plaetze);
      const [erster] = protokoll.angelegt;
      const belegt = await plaetze.belegenAusgehend(platzAnfrage(erster.id, "kunde_a"));
      assert.equal(belegt.entscheidung, LEITUNGSPLATZ_ENTSCHEIDUNG.FREI);
      await fuelleAnbieter(plaetze);
      assert.equal((await rufe("kunde_a")).status, HTTP_OK);
    },
  });
});

const ZAEHLUNG_AUSFAELLE = [
  { name: "nicht lesbar", belegenWartend: async () => Promise.reject(new Error("Zaehlung nicht lesbar")), status: HTTP_SERVICE_UNAVAILABLE },
  { name: "beim Anbieter voll", belegenWartend: async () => LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL, status: HTTP_SERVICE_UNAVAILABLE },
  { name: "beim Kunden voll", belegenWartend: async () => LEITUNGSPLATZ_ENTSCHEIDUNG.KUNDE_VOLL, status: HTTP_TOO_MANY },
];

for (const fall of ZAEHLUNG_AUSFAELLE)
  test(`Warteplatz ${fall.name}: die Route legt keinen Anruf an, reiht nichts ein und waehlt nicht`, async (t) => {
    t.mock.method(console, "error", () => {});
    const plaetze = await vollePlattform();
    await mitRoute({
      leitungsplaetze: Object.assign(Object.create(plaetze), { belegenWartend: fall.belegenWartend }),
      lauf: async ({ rufe, protokoll, attrappe }) => {
        const antwort = await rufe("kunde_a");
        assert.equal(antwort.status, fall.status);
        assert.deepEqual(protokoll.angelegt, []);
        assert.deepEqual(protokoll.eingereiht, []);
        assert.deepEqual(attrappe.gewaehlt, []);
      },
    });
  });

test("Platz im Rennen verloren: ist beim Belegen die Plattform voll und der Kunde voll gewartet, lehnt die Route mit 429 ab", async () => {
  const plaetze = speicher.makeLeitungsplaetze();
  const rennen = {
    pruefenAusgehend: async () => LEITUNGSPLATZ_ENTSCHEIDUNG.FREI,
    belegenAusgehend: async () => ({ entscheidung: LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL }),
    belegenWartend: plaetze.belegenWartend,
    freigeben: plaetze.freigeben,
  };
  await mitRoute({
    leitungsplaetze: rennen,
    lauf: async ({ rufe, protokoll }) => {
      for (let index = 0; index < jeKunde(); index += 1) assert.equal((await rufe("kunde_a")).status, HTTP_OK);
      assert.equal((await rufe("kunde_a")).status, HTTP_TOO_MANY);
      assert.equal(protokoll.angelegt.length, jeKunde());
    },
  });
});

async function mitBeidenSpeichern(lauf) {
  const { runner } = await makePgTestStore();
  for (const [name, plaetze] of [
    ["Speicher", speicher.makeLeitungsplaetze()],
    ["Postgres", speicher.makePostgresLeitungsplaetze(runner)],
  ])
    await lauf(plaetze, name);
}

test("Warteplaetze: je Kunde WARTENDE_JE_KUNDE, gesamt WARTENDE_GESAMT, in Speicher und Postgres gleich", async () => {
  await mitBeidenSpeichern(async (plaetze, name) => {
    let nummer = 0;
    const naechste = (kunde) => plaetze.belegenWartend(wartend(`${name}_${(nummer += 1)}`, kunde));
    for (let index = 0; index < jeKunde(); index += 1)
      assert.equal(await naechste("kunde_a"), LEITUNGSPLATZ_ENTSCHEIDUNG.FREI, name);
    assert.equal(await naechste("kunde_a"), LEITUNGSPLATZ_ENTSCHEIDUNG.KUNDE_VOLL, name);
    let insgesamt = jeKunde();
    for (const kunde of kunden(gesamt()))
      for (let index = 0; index < jeKunde() && insgesamt < gesamt(); index += 1) {
        assert.equal(await naechste(kunde), LEITUNGSPLATZ_ENTSCHEIDUNG.FREI, name);
        insgesamt += 1;
      }
    assert.equal(await naechste("kunde_neu"), LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL, name);
    assert.equal(await naechste("kunde_a"), LEITUNGSPLATZ_ENTSCHEIDUNG.KUNDE_VOLL, name);
  });
});

test("Warteplaetze: Wartende halten keinen Leitungsplatz und zaehlen weder gegen die Anbieter noch gegen laufende Anrufe des Kunden", async () => {
  await mitBeidenSpeichern(async (plaetze, name) => {
    for (let index = 0; index < jeKunde(); index += 1) await plaetze.belegenWartend(wartend(`${name}_w${index}`, "kunde_a"));
    const gesucht = Array.from({ length: jeKunde() }, (_, index) => `${name}_w${index}`);
    assert.deepEqual([...(await plaetze.belegteAnrufe(gesucht))], [], name);
    assert.deepEqual(await plaetze.belegung(), [
      { anbieter: ANBIETER.TELNYX, belegt: 0, kapazitaet: 100 },
      { anbieter: ANBIETER.ELEVENLABS, belegt: 0, kapazitaet: 6 },
    ]);
    assert.equal(await plaetze.pruefenAusgehend({ tenantId: "kunde_a", weg: ANBIETER.ELEVENLABS, hoechstzahlKunde: 1 }), LEITUNGSPLATZ_ENTSCHEIDUNG.FREI, name);
  });
});

test("Warteplaetze: Belegen eines Platzes und Freigeben geben den Warteplatz zurueck", async () => {
  await mitBeidenSpeichern(async (plaetze, name) => {
    const ids = Array.from({ length: jeKunde() }, (_, index) => `${name}_w${index}`);
    for (const id of ids) await plaetze.belegenWartend(wartend(id, "kunde_a"));
    assert.equal(await plaetze.belegenWartend(wartend(`${name}_x`, "kunde_a")), LEITUNGSPLATZ_ENTSCHEIDUNG.KUNDE_VOLL, name);
    const belegt = await plaetze.belegenAusgehend(platzAnfrage(ids[0], "kunde_a"));
    assert.equal(belegt.entscheidung, LEITUNGSPLATZ_ENTSCHEIDUNG.FREI, name);
    assert.deepEqual([...(await plaetze.belegteAnrufe(ids))], [ids[0]], name);
    assert.equal(await plaetze.belegenWartend(wartend(`${name}_y`, "kunde_a")), LEITUNGSPLATZ_ENTSCHEIDUNG.FREI, name);
    assert.equal(await plaetze.belegenWartend(wartend(`${name}_z`, "kunde_a")), LEITUNGSPLATZ_ENTSCHEIDUNG.KUNDE_VOLL, name);
    await plaetze.freigeben(ids[1]);
    assert.equal(await plaetze.belegenWartend(wartend(`${name}_z`, "kunde_a")), LEITUNGSPLATZ_ENTSCHEIDUNG.FREI, name);
  });
});

test("Warteplaetze: ein abgelehntes Belegen (Anbieter voll) laesst den Warteplatz stehen", async () => {
  await mitBeidenSpeichern(async (plaetze, name) => {
    await plaetze.belegenWartend(wartend(`${name}_w`, "kunde_a"));
    await fuelleAnbieter(plaetze);
    const belegt = await plaetze.belegenAusgehend(platzAnfrage(`${name}_w`, "kunde_a"));
    assert.equal(belegt.entscheidung, LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL, name);
    for (let index = 1; index < jeKunde(); index += 1) await plaetze.belegenWartend(wartend(`${name}_w${index}`, "kunde_a"));
    assert.equal(await plaetze.belegenWartend(wartend(`${name}_x`, "kunde_a")), LEITUNGSPLATZ_ENTSCHEIDUNG.KUNDE_VOLL, name);
  });
});

test("Warteplaetze: ein vergessener Warteplatz laeuft nach WARTE_ABLAUF_S ab, vorher nicht", async () => {
  let jetztMs = 1_000_000;
  const plaetze = speicher.makeLeitungsplaetze({ jetztMs: () => jetztMs });
  for (let index = 0; index < jeKunde(); index += 1) await plaetze.belegenWartend(wartend(`w${index}`, "kunde_a"));
  jetztMs += (WARTE_ABLAUF_S - 1) * MS_JE_S;
  assert.equal(await plaetze.belegenWartend(wartend("x", "kunde_a")), LEITUNGSPLATZ_ENTSCHEIDUNG.KUNDE_VOLL);
  jetztMs += MS_JE_S;
  assert.equal(await plaetze.belegenWartend(wartend("x", "kunde_a")), LEITUNGSPLATZ_ENTSCHEIDUNG.FREI);
});

test("Warteplaetze in Postgres: eine nicht lesbare Tabelle gilt als voll, es wird nicht eingereiht", async (t) => {
  t.mock.method(console, "error", () => {});
  const kaputt = speicher.makePostgresLeitungsplaetze({
    withClient: async () => {
      throw new Error("Datenbank weg");
    },
  });
  assert.equal(await kaputt.belegenWartend(wartend("c", "kunde_a")), LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL);
});
