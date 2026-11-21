import assert from "node:assert/strict";
import { before, test } from "node:test";

import express from "express";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { EL_OUTBOUND_CONFIG } from "../helpers.js";
import { legeMandantAn, makePgTestStore } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannDiAttrappe, vorspannKonfig, vorspannSeedNummer } from "../gemeinsam/vorspann-fahrzeug.js";

const TENANT = "T";
const VON = "+491700000000";
const HTTP_OK = 200;
const HTTP_TOO_MANY = 429;
const HTTP_SERVICE_UNAVAILABLE = 503;
const LIMIT_TEXT = "Stundenlimit erreicht";
const SCHEIBEN_BIS_FERTIG = 50;
const ziel = (nummer) => `+4917112340${String(nummer).padStart(2, "0")}`;

let makeCallRoutes;

before(async () => {
  ({ makeCallRoutes } = await import("../../src/routes/api-calls.ts"));
});

const BUDGET_ALT = {
  PRECALL_BRIEFING_ENABLED: "false",
  ASSISTANT_CONTEXT_ENABLED: "false",
  IN_CALL_CONSULT_ENABLED: "false",
  CONSULT_ENABLED: "false",
  METRICS_ENABLED: "false",
};

const config = () =>
  withConfigNamespaces({
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
    telnyxElevenLabs: {},
    telnyxAssistant: { enabled: false },
    voiceEngine: "budget",
    publicUrl: "http://127.0.0.1:1",
  });

const freieGates = [
  {
    name: "freie-fahrt",
    run: (ctx) => {
      Object.assign(ctx, {
        tenantId: TENANT,
        fromNumber: VON,
        outboundProvider: "telnyx",
        reserveCents: 60,
        maxDur: 60,
        requestedBy: "test",
      });
      return null;
    },
  },
];

function offenesTor() {
  const tor = {};
  tor.wartet = new Promise((oeffne) => {
    tor.oeffne = oeffne;
  });
  tor.begonnen = new Promise((beginne) => {
    tor.beginne = beginne;
  });
  return tor;
}

function platzAttrappe(belegen) {
  const log = { belegt: [], frei: [] };
  return {
    log,
    pruefenAusgehend: async () => "frei",
    belegenAusgehend: async (anfrage) => {
      log.belegt.push(anfrage.callId);
      return belegen(anfrage);
    },
    belegenWartend: async () => "frei",
    freigeben: (callId) => log.frei.push(callId),
  };
}

const sofortFrei = () => ({ entscheidung: "frei" });

async function mitRoute({ leitungsplaetze, mitAnrufSperre, createCall, callQuotaDenial }, lauf) {
  Object.assign(process.env, BUDGET_ALT);
  const { store: pg } = await makePgTestStore();
  await legeMandantAn(pg, TENANT);
  const store = {
    ...pg,
    numberRecordByE164: (e164) => ({ e164, tenantId: TENANT, providerAgentPhoneNumberId: "phnum_sperre" }),
    load: () => ({ ...pg.load(), numbers: [vorspannSeedNummer({ tenantId: TENANT, nummer: VON, registrierung: "phnum_sperre" })] }),
    ...(createCall ? { createCall } : {}),
  };
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      ...vorspannDiAttrappe(),
      store,
      mitAnrufSperre,
      leitungsplaetze,
      config: config(),
      audit: () => {},
      outboundGates: freieGates,
      callQuotaDenial: callQuotaDenial ?? (() => null),
      voiceControl: () => ({ originateCall: async () => ({ sid: "sid_sperre" }), endCall: async () => {} }),
      originateElevenLabsCall: async () => {},
      terminateAndBillCall: async () => {},
      hangUpAction: () => null,
      billThunk: () => () => {},
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
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
    return await lauf(
      (nummer) =>
        abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/calls`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to: ziel(nummer), objective: "Termin vereinbaren" }),
        }),
      store,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function andererVorgangFertigWaehrendWarten(store) {
  let fertig = false;
  const vorgang = store.withStoreLock(async () => {
    fertig = true;
  });
  for (let scheibe = 0; scheibe < SCHEIBEN_BIS_FERTIG && !fertig; scheibe += 1)
    await new Promise((weiter) => setImmediate(weiter));
  return { fertig, vorgang };
}

async function pruefeWartenBlockiertNichts({ nummer, wartetIn }) {
  const tor = offenesTor();
  const platz = platzAttrappe(async () => {
    if (wartetIn === "platz") {
      tor.beginne();
      await tor.wartet;
    }
    return sofortFrei();
  });
  const mitAnrufSperre = async (_tenantId, arbeit) => {
    if (wartetIn === "mandant") {
      tor.beginne();
      await tor.wartet;
    }
    return arbeit();
  };
  await mitRoute({ leitungsplaetze: platz, mitAnrufSperre }, async (rufeAn, store) => {
    const antwort = rufeAn(nummer);
    await tor.begonnen;
    let fertig;
    let vorgang;
    try {
      ({ fertig, vorgang } = await andererVorgangFertigWaehrendWarten(store));
    } finally {
      tor.oeffne();
    }
    assert.equal(fertig, true, "ein anderer Vorgang unter der Speicher-Sperre muss fertig werden, waehrend der Anruf wartet");
    await vorgang;
    const res = await antwort;
    assert.equal(res.status, HTTP_OK);
    assert.equal((await res.json()).deduplicated, false);
  });
}

test("Wartet das Belegen des Leitungsplatzes, wird ein anderer Vorgang unter der Speicher-Sperre sofort fertig", async () => {
  await pruefeWartenBlockiertNichts({ nummer: 1, wartetIn: "platz" });
});

test("Wartet die Mandanten-Sperre auf eine andere Instanz, wird ein anderer Vorgang unter der Speicher-Sperre sofort fertig", async () => {
  await pruefeWartenBlockiertNichts({ nummer: 2, wartetIn: "mandant" });
});

test("Zwei gleichzeitige Anrufe desselben Mandanten an dieselbe Nummer legen einen Anruf an, der zweite ist dedupliziert", async () => {
  const platz = platzAttrappe(sofortFrei);
  await mitRoute({ leitungsplaetze: platz }, async (rufeAn) => {
    const antworten = await Promise.all([rufeAn(3), rufeAn(3)]);
    const koerper = await Promise.all(antworten.map((antwort) => antwort.json()));
    assert.deepEqual(antworten.map((antwort) => antwort.status), [HTTP_OK, HTTP_OK]);
    assert.deepEqual(koerper.map((eintrag) => eintrag.deduplicated).sort(), [false, true]);
    assert.equal(koerper[0].callId, koerper[1].callId);
    assert.equal(platz.log.belegt.length, 1);
  });
});

test("Scheitert das Anlegen nach dem Belegen, ist der Leitungsplatz dieses Anrufs frei und die Antwort 503", async () => {
  const platz = platzAttrappe(sofortFrei);
  const createCall = () => {
    throw new Error("Anruf nicht anlegbar");
  };
  await mitRoute({ leitungsplaetze: platz, createCall }, async (rufeAn) => {
    assert.equal((await rufeAn(4)).status, HTTP_SERVICE_UNAVAILABLE);
    assert.equal(platz.log.belegt.length, 1);
    assert.deepEqual(platz.log.frei, platz.log.belegt);
  });
});

test("Lehnt die Kostendecke ab, wird kein Leitungsplatz belegt und die Ablehnung kommt unveraendert", async () => {
  const platz = platzAttrappe(sofortFrei);
  const callQuotaDenial = async () => ({ status: HTTP_TOO_MANY, body: { error: LIMIT_TEXT } });
  await mitRoute({ leitungsplaetze: platz, callQuotaDenial }, async (rufeAn) => {
    const res = await rufeAn(5);
    assert.equal(res.status, HTTP_TOO_MANY);
    assert.equal((await res.json()).error, LIMIT_TEXT);
    assert.deepEqual(platz.log.belegt, []);
  });
});

test("Bei bereits laufendem Anruf gilt die Dedup-Antwort vor Kostendecke und Leitungsplatz", async () => {
  const platz = platzAttrappe(sofortFrei);
  const decke = { fragen: 0, sperrt: false };
  const callQuotaDenial = async () => {
    decke.fragen += 1;
    return decke.sperrt ? { status: HTTP_TOO_MANY, body: { error: LIMIT_TEXT } } : null;
  };
  await mitRoute({ leitungsplaetze: platz, callQuotaDenial }, async (rufeAn) => {
    assert.equal((await rufeAn(6)).status, HTTP_OK);
    decke.sperrt = true;
    const fragenVorher = decke.fragen;
    const res = await rufeAn(6);
    assert.equal(res.status, HTTP_OK);
    assert.equal((await res.json()).deduplicated, true);
    assert.equal(decke.fragen, fragenVorher);
    assert.equal(platz.log.belegt.length, 1);
  });
});

test("Lehnt der Leitungsplatz ab, antwortet die Route mit dessen Ablehnung und legt keinen Anruf an", async () => {
  const platz = platzAttrappe(() => ({ entscheidung: "kunde_voll" }));
  await mitRoute({ leitungsplaetze: platz }, async (rufeAn, store) => {
    const res = await rufeAn(7);
    assert.notEqual(res.status, HTTP_OK);
    assert.equal(platz.log.belegt.length, 1);
    assert.deepEqual(platz.log.frei, []);
    assert.equal(store.load().calls.some((call) => call.to === ziel(7)), false);
  });
});
