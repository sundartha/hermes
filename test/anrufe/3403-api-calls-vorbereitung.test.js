import { before, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  schalteNebenkanaeleAb,
  startServer,
  seedState,
  seedCall,
  tempDataDir,
} from "../helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannDiAttrappe, vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;
const HTTP_SERVER_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const MANDANT = "owner";
const PEER = "+4915112345678";
const ANDERER_PEER = "+4915198765432";

const ENV = {
  ALLOWED_COUNTRY_CODES: "+49",
  ...vorspannMandantenUmgebung([MANDANT]),
  PRECALL_BRIEFING_ENABLED: "false",
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
};

const mitKonsult = (calls = []) =>
  seedState({ calls, profiles: { [MANDANT]: { allowConsult: true } } });

const post = (srv, pfad, { body, kopfzeilen = {} } = {}) =>
  abrufMitFrist(`${srv.localUrl}${pfad}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...kopfzeilen },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function mitServer(seed, run) {
  const srv = await startServer({ env: ENV, seed });
  try {
    return await run(srv);
  } finally {
    await srv.stop();
  }
}

const speicherAnruf = (srv, id) => srv.readStore().calls.find((call) => call.id === id);

test("3403-A1: objective gilt vor goal, ein leeres objective faellt auf goal zurueck", async () => {
  await mitServer(seedState(), async (srv) => {
    const beide = await (
      await post(srv, "/api/calls", { body: { to: PEER, objective: "Ziel A", goal: "Ziel B" } })
    ).json();
    assert.equal(speicherAnruf(srv, beide.callId).goal, "Ziel A");
    const leer = await post(srv, "/api/calls", {
      body: { to: ANDERER_PEER, objective: "", goal: "Ziel C" },
    });
    assert.equal(leer.status, HTTP_OK);
    assert.equal(speicherAnruf(srv, (await leer.json()).callId).goal, "Ziel C");
  });
});

test("3403-A2: Rueckfrage eroeffnen, abholen, vorlaeufig und endgueltig beantworten schreibt je ein Audit mit Zaehlern", async () => {
  await mitServer(mitKonsult(), async (srv) => {
    const angelegt = await post(srv, "/api/calls", {
      body: {
        to: PEER,
        objective: "Termin",
        context: { open_questions: ["Welcher Tag?", "Welche Uhrzeit?"] },
      },
    });
    assert.equal(angelegt.status, HTTP_OK, JSON.stringify(await angelegt.clone().json()));
    const callId = (await angelegt.json()).callId;
    assert.match(
      srv.stdout,
      new RegExp(`\\[audit\\] consult_emitted ip=\\S+ call=${callId} fragen=2\\n`),
    );

    const ereignis = await (
      await abrufMitFrist(`${srv.localUrl}/api/calls/${callId}/consult`)
    ).json();
    const antwortPfad = `/api/calls/${callId}/consult/answer`;
    const vorlaeufig = await post(srv, antwortPfad, {
      body: { event_id: ereignis.eventId, status: "working" },
    });
    assert.equal(vorlaeufig.status, HTTP_OK);
    assert.match(
      srv.stdout,
      new RegExp(
        `\\[audit\\] consult_acked ip=\\S+ call=${callId} event=${ereignis.eventId} ergebnis=accepted\\n`,
      ),
    );

    const fertig = await post(srv, antwortPfad, {
      body: { event_id: ereignis.eventId, answers: ["Montag", "10 Uhr"] },
    });
    assert.equal(fertig.status, HTTP_OK);
    assert.deepEqual(await fertig.json(), { accepted: true, merged_facts: 2 });
    assert.match(
      srv.stdout,
      new RegExp(
        `\\[audit\\] consult_answered ip=\\S+ call=${callId} event=${ereignis.eventId} ergebnis=accepted fakten=2\\n`,
      ),
    );
  });
});

test("3403-A3: Endgueltige Antwort mit ungueltigen answers nennt den Pruefgrund, leere answers die Pflicht", async () => {
  await mitServer(mitKonsult([seedCall({ id: "call_k" })]), async (srv) => {
    const faelle = [
      [{ event_id: "c0", answers: [123] }, "context.key_facts darf nur Texte enthalten"],
      [{ event_id: "c0", answers: "kein-array" }, "context.key_facts muss eine Liste sein"],
      [{ event_id: "c0", answers: [] }, "answers ist Pflicht"],
      [{ event_id: "c0" }, "answers ist Pflicht"],
    ];
    for (const [body, fehler] of faelle) {
      const res = await post(srv, "/api/calls/call_k/consult/answer", { body });
      assert.equal(res.status, HTTP_BAD_REQUEST, JSON.stringify(body));
      assert.deepEqual(await res.json(), { error: fehler }, JSON.stringify(body));
    }
  });
});

test("3403-A4: Anrufe eines anderen Mandanten sind bei Abfrage, Antwort und Abbruch nicht zu finden", async () => {
  const fremd = seedCall({ id: "call_fremd", tenantId: "anderer-mandant", status: "active" });
  await mitServer(mitKonsult([fremd]), async (srv) => {
    const nichtGefunden = { error: "not found" };
    const abfrage = await abrufMitFrist(`${srv.localUrl}/api/calls/call_fremd/consult`);
    assert.equal(abfrage.status, HTTP_NOT_FOUND);
    assert.deepEqual(await abfrage.json(), nichtGefunden);
    const antwort = await post(srv, "/api/calls/call_fremd/consult/answer", {
      body: { event_id: "c0", answers: ["a"] },
    });
    assert.equal(antwort.status, HTTP_NOT_FOUND);
    assert.deepEqual(await antwort.json(), nichtGefunden);
    const abbruch = await post(srv, "/api/calls/call_fremd/cancel");
    assert.equal(abbruch.status, HTTP_NOT_FOUND);
    assert.deepEqual(await abbruch.json(), nichtGefunden);
    assert.equal(speicherAnruf(srv, "call_fremd").status, "active");
  });
});

test("3403-A5: Anlegen, doppelter Aufruf und Abbruch schreiben Audit-Zeilen mit Anruf, Mandant und Auftraggeber", async () => {
  await mitServer(
    seedState({
      calls: [
        seedCall({
          id: "call_aktiv",
          status: "active",
          twilioSid: "CA_3403_aktiv",
          to: ANDERER_PEER,
        }),
      ],
    }),
    async (srv) => {
      const erst = await (
        await post(srv, "/api/calls", { body: { to: PEER, objective: "Tisch" } })
      ).json();
      assert.match(
        srv.stdout,
        new RegExp(
          `\\[audit\\] place_call ip=\\S+ to=\\S+ call=${erst.callId} provider=telnyx requestedBy=owner\\n`,
        ),
      );
      const zweit = await (
        await post(srv, "/api/calls", { body: { to: PEER, objective: "Tisch" } })
      ).json();
      assert.equal(zweit.deduplicated, true);
      assert.match(
        srv.stdout,
        new RegExp(
          `\\[audit\\] place_call_dedup ip=\\S+ to=\\S+ call=${erst.callId} tenant=${MANDANT}\\n`,
        ),
      );

      await post(srv, "/api/calls/call_aktiv/cancel");
      assert.match(srv.stdout, /\[audit\] cancel_call ip=\S+ call=call_aktiv requestedBy=owner\n/);
    },
  );
});

test("3403-A6: Abbruch mit interner Identitaet nennt diese im Audit statt des Betreibers", async () => {
  const seed = seedState({
    calls: [
      seedCall({
        id: "call_aktiv",
        status: "active",
        twilioSid: "CA_3403_aktiv",
        to: ANDERER_PEER,
      }),
    ],
  });
  await mitServer(seed, async (srv) => {
    const abbruch = await post(srv, "/api/calls/call_aktiv/cancel", {
      kopfzeilen: { "x-internal-identity": "alice", "x-internal-tenant": MANDANT },
    });
    assert.equal(abbruch.status, HTTP_OK);
    assert.match(srv.stdout, /\[audit\] cancel_call ip=\S+ call=call_aktiv requestedBy=alice\n/);
  });
});

const TENANT = "T";
const RESERVE_CENTS = 60;

let makeCallRoutes;
let speicher;

before(async () => {
  schalteNebenkanaeleAb();
  process.env.DATA_DIR = tempDataDir(seedState({}));
  speicher = await import("../../src/store.js");
  ({ makeCallRoutes } = await import("../../src/routes/api-calls.ts"));
});

const innereConfig = (zusatz = {}) =>
  withConfigNamespaces({
    outboundFrozen: false,
    assistantContextEnabled: false,
    paymentEnabled: false,
    multiTenant: false,
    diagnosticRetentionDays: 0,
    ownerSelfCallEnabled: false,
    ownerSelfCallTenantIds: [],
    telnyxElevenLabs: {},
    telnyxAssistant: { enabled: false },
    voiceEngine: "budget",
    publicUrl: "http://127.0.0.1:1",
    ...zusatz,
  });

const configMitFreiemWeg = () =>
  innereConfig({
    telnyxCallControlAppId: "cc_app_3403",
    elevenLabsInbound: {
      scope: "allowlist",
      tenantIds: [TENANT],
      sipUser: "sip-user-3403",
      sipPassword: "p".repeat(40),
      initWebhookToken: "t".repeat(40),
    },
  });

const speicherMitStartFehler = (fehler) => ({
  ...speicher,
  numberRecordByE164: () => ({ providerAgentPhoneNumberId: "phnum_3403" }),
  recordCostProfile: async () => {
    throw fehler;
  },
});

const freieGates = [
  {
    name: "freie-fahrt",
    run: (ctx) => {
      Object.assign(ctx, {
        tenantId: TENANT,
        context: {},
        outboundProvider: "telnyx",
        fromNumber: "+491700000000",
        requestedBy: "test",
        maxDur: 60,
        reserveCents: RESERVE_CENTS,
      });
      return null;
    },
  },
];

const NUMMERN_BEREICH = 10_000_000;
let nummernZaehler = Date.now() % NUMMERN_BEREICH;
const naechsteNummer = () =>
  `+4915${String((nummernZaehler += 1) % NUMMERN_BEREICH).padStart(7, "0")}`;

async function mitRoute({ store = speicher, gates = freieGates, abhaengigkeiten = {} }, run) {
  const audits = [];
  const fehlerzeilen = [];
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      ...vorspannDiAttrappe(),
      store,
      leitungsplaetze: speicher.makeLeitungsplaetze(),
      config: innereConfig(),
      audit: (aktion, _req, detail) => audits.push([aktion, detail]),
      outboundGates: gates,
      callQuotaDenial: async () => null,
      voiceControl: () => ({ originateCall: async () => ({ sid: "CA_3403" }) }),
      originateElevenLabsCall: async () => {},
      terminateAndBillCall: async () => {},
      hangUpAction: () => null,
      billThunk: () => () => {},
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      tenant: {
        requestTenant: () => TENANT,
        requireTenant: () => TENANT,
        tenantOwnsCall: () => true,
      },
      consultDelivery: { waitForEvent: async () => ({}) },
      internalIdentity: () => null,
      OWNER_ID: "owner",
      ...abhaengigkeiten,
    }),
  );
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  const original = console.error;
  console.error = (...teile) => fehlerzeilen.push(teile);
  const basis = { localUrl: `http://127.0.0.1:${server.address().port}` };
  try {
    return await run({
      audits,
      fehlerzeilen,
      anlegen: () =>
        post(basis, "/api/calls", {
          body: { to: naechsteNummer(), objective: "Termin vereinbaren" },
        }),
      abbrechen: (callId) => post(basis, `/api/calls/${callId}/cancel`),
      senden: (pfad, optionen) => post(basis, pfad, optionen),
    });
  } finally {
    console.error = original;
    await new Promise((resolve) => server.close(resolve));
  }
}

const zeileMit = (fehlerzeilen, anfang) =>
  fehlerzeilen.find((teile) => String(teile[0]).startsWith(anfang));

test("3403-B1: Wirft die Konsult-Pruefung nach dem Anlegen, antwortet POST /api/calls mit 500 statt gar nicht", async () => {
  const store = {
    ...speicher,
    resolveProfile: () => {
      throw new Error("profil-kaputt");
    },
  };
  await mitRoute({ store }, async ({ anlegen }) => {
    const res = await anlegen();
    assert.equal(res.status, HTTP_SERVER_ERROR);
  });
});

const GELEHNT = "Provider hat den Anruf abgelehnt";
const PRUEFEN = "Account-/Nummern-Konfiguration pruefen.";
const NICHT_GESTARTET = "Anruf konnte nicht gestartet werden.";
const mitStatus = (providerStatus) => Object.assign(new Error("abgelehnt"), { providerStatus });

const ORIGINATE_FEHLER = [
  [
    "Zahl als Anbieter-Status",
    mitStatus(401),
    HTTP_BAD_GATEWAY,
    `${GELEHNT} (HTTP 401). ${PRUEFEN}`,
  ],
  [
    "Text als Anbieter-Status",
    mitStatus("429"),
    HTTP_BAD_GATEWAY,
    `${GELEHNT} (HTTP 429). ${PRUEFEN}`,
  ],
  ["Null als Anbieter-Status", mitStatus(0), HTTP_SERVER_ERROR, NICHT_GESTARTET],
  ["Wahrheitswert als Anbieter-Status", mitStatus(true), HTTP_SERVER_ERROR, NICHT_GESTARTET],
  ["Fehler ohne Anbieter-Status", new Error("abgelehnt"), HTTP_SERVER_ERROR, NICHT_GESTARTET],
  ["geworfener Text", "nur-text", HTTP_SERVER_ERROR, NICHT_GESTARTET],
  ["geworfenes null", null, HTTP_SERVER_ERROR, NICHT_GESTARTET],
];

test("3403-B2: Anrufstart scheitert - Status und Text folgen dem Anbieter-Status", async () => {
  for (const [name, fehler, status, text] of ORIGINATE_FEHLER) {
    const abhaengigkeiten = { config: configMitFreiemWeg() };
    await mitRoute({ store: speicherMitStartFehler(fehler), abhaengigkeiten }, async ({ anlegen }) => {
      const res = await anlegen();
      assert.equal(res.status, status, name);
      assert.deepEqual(await res.json(), { error: text }, name);
    });
  }
});

const LOG_ZEILE_START = "[place_call] originate fehlgeschlagen call=call_";

test("3403-B3: Fehlerzeile des Anrufstarts nennt die Nachricht, bei leerer Nachricht oder Nicht-Fehler den Text des Werts", async () => {
  const faelle = [
    [new Error("boom"), "boom"],
    [Object.assign(new Error("x"), { message: "" }), "Error"],
    ["nur-text", "nur-text"],
    [null, "null"],
  ];
  for (const [fehler, erwartet] of faelle) {
    const abhaengigkeiten = { config: configMitFreiemWeg() };
    await mitRoute({ store: speicherMitStartFehler(fehler), abhaengigkeiten }, async ({ anlegen, fehlerzeilen }) => {
      await anlegen();
      const teile = zeileMit(fehlerzeilen, LOG_ZEILE_START);
      assert.ok(teile, String(erwartet));
      assert.equal(teile[1], erwartet);
    });
  }
});

test("3403-B4: Scheitert das Anlegen, nennen die Fehlerzeilen Mandant und Nachricht, auch wenn die Reserve nicht freigebbar ist", async () => {
  const faelle = [
    [new Error("anlage-kaputt"), "anlage-kaputt"],
    [null, undefined],
  ];
  for (const [angelegtFehler, erwartet] of faelle) {
    const store = {
      ...speicher,
      createCall: () => {
        throw angelegtFehler;
      },
      releaseOutboundReserveCents: () => {
        throw new Error("reserve-kaputt");
      },
    };
    await mitRoute({ store }, async ({ anlegen, fehlerzeilen }) => {
      const res = await anlegen();
      assert.equal(res.status, HTTP_SERVICE_UNAVAILABLE);
      assert.deepEqual(zeileMit(fehlerzeilen, "[place_call] Anlegen fehlgeschlagen"), [
        `[place_call] Anlegen fehlgeschlagen tenant=${TENANT}:`,
        erwartet,
      ]);
      assert.deepEqual(zeileMit(fehlerzeilen, "[place_call] Reserve nicht freigebbar"), [
        "[place_call] Reserve nicht freigebbar:",
        "reserve-kaputt",
      ]);
    });
  }
});

test("3403-B5: Laesst sich eine Ablehnung nicht protokollieren, antwortet die Route trotzdem mit der Ablehnung und nennt die Nachricht", async () => {
  const sperre = {
    name: "sperre",
    run: () => ({
      status: HTTP_FORBIDDEN,
      body: { error: "gesperrt" },
      audit: { event: "anruf_abgelehnt", grund: "test_grund", detail: "d" },
    }),
  };
  const abhaengigkeiten = {
    audit: () => {
      throw new Error("audit-kaputt");
    },
  };
  await mitRoute({ gates: [sperre], abhaengigkeiten }, async ({ anlegen, fehlerzeilen }) => {
    const res = await anlegen();
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.deepEqual(await res.json(), { error: "gesperrt", reason: "test_grund" });
    assert.deepEqual(zeileMit(fehlerzeilen, "[place_call] Ablehnung"), [
      "[place_call] Ablehnung nicht protokollierbar:",
      "audit-kaputt",
    ]);
  });
});

test("3403-B6: Scheitert das Auflegen beim Abbruch, nennt die Fehlerzeile die Nachricht und der Platz bleibt belegt", async () => {
  const aktiv = {
    id: "call_3403_b6",
    tenantId: TENANT,
    status: "active",
    direction: "outbound",
    twilioSid: "CA_3403_b6",
  };
  const freigegeben = [];
  const leitungsplaetze = { freigeben: (callId) => freigegeben.push(callId) };
  const store = { ...speicher, leseCall: async () => aktiv };
  const abhaengigkeiten = {
    leitungsplaetze,
    hangUpAction: () => async () => {},
    terminateAndBillCall: async ({ onHangUpError }) => onHangUpError(new Error("auflegen-kaputt")),
  };
  await mitRoute({ store, abhaengigkeiten }, async ({ abbrechen, fehlerzeilen }) => {
    const res = await abbrechen(aktiv.id);
    assert.deepEqual(await res.json(), { status: "cancelled" });
    assert.deepEqual(zeileMit(fehlerzeilen, "[cancel]"), ["[cancel]", "auflegen-kaputt"]);
    assert.deepEqual(freigegeben, []);
  });
});

test("3403-A7: Antwort auf eine Rueckfrage ohne Mandanten-Zuordnung wird mit 403 abgewiesen", async () => {
  await mitServer(mitKonsult([seedCall({ id: "call_k" })]), async (srv) => {
    const res = await post(srv, "/api/calls/call_k/consult/answer", {
      body: { event_id: "c0", answers: ["a"] },
      kopfzeilen: { "x-internal-identity": "unbekannt" },
    });
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.deepEqual(await res.json(), { error: "Keine Tenant-Zuordnung fuer diese Identitaet." });
  });
});

test("3403-B7: Ohne Mandanten-Zuordnung liest die Antwort-Route keinen Anruf mehr", async () => {
  const gelesen = [];
  const store = {
    ...speicher,
    getCall: (callId) => {
      gelesen.push(callId);
      return null;
    },
  };
  const abhaengigkeiten = {
    tenant: {
      requestTenant: () => TENANT,
      requireTenant: (_req, res) => {
        res.status(HTTP_FORBIDDEN).json({ error: "keine Zuordnung" });
        return null;
      },
      tenantOwnsCall: () => true,
    },
  };
  await mitRoute({ store, abhaengigkeiten }, async ({ senden }) => {
    const res = await senden("/api/calls/call_x/consult/answer", {
      body: { event_id: "c0", answers: ["a"] },
    });
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.deepEqual(await res.json(), { error: "keine Zuordnung" });
    assert.deepEqual(gelesen, []);
  });
});
