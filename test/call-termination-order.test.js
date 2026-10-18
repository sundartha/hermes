import { test, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { terminateAndBillCall, billThunk, hangUpAction } from "../src/telephony/call-termination.js";
import {
  callAttrappenBesitztJedenAnruf,
  schalteNebenkanaeleAb,
  seedCall,
  seedState,
  tempDataDir,
  voiceAttrappenOhneSignatur,
  waitUntil,
} from "./helpers.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";

test("hangUp wird VOLLSTAENDIG abgewartet, BEVOR bill (Buchung/Summary/SMS) angestossen wird", async () => {
  const order = [];
  await terminateAndBillCall({
    persistEnd: () => order.push("persistEnd"),
    hangUp: async () => {
      order.push("hangUp-start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("hangUp-end");
    },
    bill: () => order.push("bill-start"),
  });
  assert.deepEqual(
    order,
    ["persistEnd", "hangUp-start", "hangUp-end", "bill-start"],
    "bill darf erst NACH dem vollstaendig abgewarteten hangUp starten - nie davor/parallel",
  );
});

test("bill wird NICHT awaited (fire-and-forget): terminateAndBillCall loest auf, ohne auf das Ende von bill zu warten", async () => {
  const order = [];
  let billResolved = false;
  await terminateAndBillCall({
    persistEnd: () => {},
    hangUp: async () => order.push("hangUp"),
    bill: async () => {
      order.push("bill-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      billResolved = true;
      order.push("bill-end");
    },
  });
  assert.equal(billResolved, false, "bill laeuft nach der Rueckkehr von terminateAndBillCall noch weiter");
  assert.deepEqual(order, ["hangUp", "bill-start"]);
});

test("bill-Rejection wird abgefangen (kein Crash) und secret-frei mit callId-Kontext geloggt", async () => {
  const order = [];
  const logs = [];
  const origError = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  try {
    await terminateAndBillCall({
      persistEnd: () => order.push("persistEnd"),
      hangUp: async () => order.push("hangUp"),
      bill: async () => {
        throw new Error("store.markBilled fehlgeschlagen (PG-IO-Fehler)");
      },
      callId: "call-obs-1",
    });
    assert.deepEqual(order, ["persistEnd", "hangUp"]);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = origError;
  }
  assert.equal(logs.length, 1, "Settlement-Fehler wird genau einmal geloggt (kein Doppel-Log)");
  assert.match(logs[0], /\[terminateAndBillCall\]/, "stabiles, greifbares Log-Praefix statt nur des generischen Guards");
  assert.match(logs[0], /call-obs-1/, "callId-Korrelation bleibt erhalten");
  assert.match(logs[0], /store\.markBilled fehlgeschlagen \(PG-IO-Fehler\)/, "e.message wird geloggt");
  assert.doesNotMatch(logs[0], /Error:\s*Error/, "kein rohes Error-Objekt/Stack im Log (secret-frei)");
});

test("hangUp-Fehler wird geschluckt (onHangUpError statt Exception) - bill laeuft trotzdem", async () => {
  const order = [];
  const errors = [];
  await terminateAndBillCall({
    persistEnd: () => order.push("persistEnd"),
    hangUp: async () => {
      throw new Error("provider-timeout");
    },
    bill: () => order.push("bill"),
    onHangUpError: (e) => errors.push(e.message),
  });
  assert.deepEqual(order, ["persistEnd", "bill"], "bill laeuft trotz gescheitertem Hangup (best-effort)");
  assert.deepEqual(errors, ["provider-timeout"]);
});

test("ohne hangUp-Thunk (z.B. fehlender providerCallSid) wird nur persistiert+gebucht, kein Crash", async () => {
  const order = [];
  await terminateAndBillCall({
    persistEnd: () => order.push("persistEnd"),
    hangUp: null,
    bill: () => order.push("bill"),
  });
  assert.deepEqual(order, ["persistEnd", "bill"]);
});

test("terminateAndBillCall wirft TypeError VOR jedem Seiteneffekt, wenn bill fehlt oder kein Function ist", async () => {
  for (const badBill of [undefined, null, "not-a-function", 42]) {
    const order = [];
    await assert.rejects(
      () =>
        terminateAndBillCall({
          persistEnd: () => order.push("persistEnd"),
          hangUp: null,
          bill: badBill,
        }),
      TypeError,
    );
    assert.deepEqual(order, [], "persistEnd darf VOR dem Guard-Throw nicht laufen (fail-fast)");
  }
});

test("doppelte Terminierung ueber terminateAndBillCall ist idempotent (kein Doppel-Billing, Reserve genau einmal frei)", async () => {
  const call = { status: "active", billedAt: null, reserveReleased: false };
  let billCount = 0;
  let reserveReleaseCount = 0;
  const persistEnd = () => {
    if (call.status === "active") call.status = "completed";
  };
  const bill = () => {
    if (!call.billedAt) {
      billCount += 1;
      call.billedAt = new Date().toISOString();
    }
    if (!call.reserveReleased) {
      reserveReleaseCount += 1;
      call.reserveReleased = true;
    }
  };
  await terminateAndBillCall({ persistEnd, hangUp: null, bill });
  await terminateAndBillCall({ persistEnd, hangUp: null, bill });
  assert.equal(billCount, 1, "bill-Wirkung (Buchung) laeuft trotz zweimaligem Gateway-Aufruf nur einmal");
  assert.equal(reserveReleaseCount, 1, "Reserve wird genau einmal freigegeben");
});

test("billThunk liefert einen Thunk, der finishCall mit dem frisch aus dem Store gelesenen Call aufruft", async () => {
  const calls = { "call-1": { id: "call-1", status: "active" } };
  const store = { getCall: (callId) => calls[callId] };
  const finishCallArgs = [];
  const finishCall = (call) => finishCallArgs.push(call);

  const thunk = billThunk(finishCall, store, "call-1");
  thunk();

  assert.equal(finishCallArgs.length, 1, "finishCall laeuft genau einmal");
  assert.equal(finishCallArgs[0], calls["call-1"], "finishCall bekommt den frisch aus dem Store gelesenen Call");
});

test("billThunk liest den Call bei JEDEM Aufruf des Thunks frisch (nicht einmalig beim Erzeugen)", () => {
  const calls = { "call-1": { id: "call-1", status: "active" } };
  const store = { getCall: (callId) => calls[callId] };
  const finishCallArgs = [];
  const thunk = billThunk((call) => finishCallArgs.push(call), store, "call-1");
  calls["call-1"] = { id: "call-1", status: "completed", billedAt: "2026-07-15T00:00:00.000Z" };
  thunk();
  assert.equal(
    finishCallArgs[0],
    calls["call-1"],
    "der Thunk kapselt store.getCall(callId), nicht einen bereits gelesenen Call-Snapshot",
  );
});

const AKTIV_STATUS = "aktiv_status";
const AKTIV_STATUS_ABGEHEND = "aktiv_status_abgehend";
const AKTIV_ABBRUCH = "aktiv_abbruch";
const TRAEGER_SID = "CA_abbruch";
const ABRECHNUNG_SCHEITERT = "abrechnung-attrappe-scheitert";
const HOECHSTDAUER_S = 60;
const KEINE_RESERVE_CENT = 0;
const CARRIER_ABLEHNUNG_STATUS = 403;
const HTTP_OK = 200;
const HTTP_BAD_GATEWAY = 502;
const MANDANT = seedCall().tenantId;
let store;
let makeCallRoutes;
let makeVoiceRoutes;
let webhookEvents;
let withConfigNamespaces;

before(async () => {
  schalteNebenkanaeleAb();
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [
        seedCall({ id: AKTIV_STATUS, twilioSid: "CA_status", provider: "telnyx" }),
        seedCall({ id: AKTIV_STATUS_ABGEHEND, twilioSid: "CA_status_abgehend", provider: "telnyx" }),
        seedCall({ id: AKTIV_ABBRUCH, twilioSid: TRAEGER_SID, provider: "telnyx" }),
      ],
    }),
  );
  ({ withConfigNamespaces } = await import("./config-namespaces-helper.js"));
  store = await import("../src/store.js");
  ({ makeCallRoutes } = await import("../src/routes/api-calls.js"));
  ({ makeVoiceRoutes } = await import("../src/routes/voice.js"));
  ({ webhookEvents } = await import("../src/telephony/registry.js"));
});

function endpfadBank() {
  const ablauf = [];
  const abrechnungen = [];
  const gewaehlt = [];
  const finishCall = (call) => {
    abrechnungen.push({ call, status: call?.status, gelesen: store.getCall(call?.id) });
    ablauf.push(`abrechnen:${call?.id}`);
    return Promise.reject(new Error(ABRECHNUNG_SCHEITERT));
  };
  const config = withConfigNamespaces({
    multiTenant: false,
    elevenLabsOutbound: { enabled: false },
    skipTwilioSignatureCheck: true,
    allowedCountryCodes: ["+49"],
    publicUrl: "http://127.0.0.1:1",
  });
  const voiceControl = () => ({
    originateCall: async ({ url }) => {
      ablauf.push("waehlen");
      gewaehlt.push(new URL(url).searchParams.get("callId"));
      store.createCall({ direction: "outbound", tenantId: MANDANT, to: "+4915100000001", goal: "gleichzeitiger Anruf", maxDurationS: HOECHSTDAUER_S });
      throw Object.assign(new Error("carrier lehnt ab"), { providerStatus: CARRIER_ABLEHNUNG_STATUS });
    },
    endCall: async (sid) => {
      await new Promise((resolve) => setImmediate(resolve));
      ablauf.push(`auflegen:${sid}`);
    },
    endCallViaCallControl: async () => {},
  });
  const gatewayMitAuflegeprotokoll = (args) => {
    if (args.hangUp) ablauf.push(`auflegen-angefordert:${args.callId}`);
    return terminateAndBillCall(args);
  };
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(
    makeVoiceRoutes({
      ...voiceAttrappenOhneSignatur(),
      store,
      config,
      lifecycle: { reattachActiveCall: async () => ({ call: null }) },
      finishCall,
      webhookEvents,
      terminateAndBillCall: gatewayMitAuflegeprotokoll,
      billThunk,
      startInboundNachlauf: () => {},
    }),
  );
  app.use(
    makeCallRoutes({
      ...callAttrappenBesitztJedenAnruf(MANDANT),
      store,
      config,
      outboundGates: [
        {
          name: "fester-kontext",
          run: (ctx) => {
            Object.assign(ctx, {
              requestedBy: "owner",
              tenantId: MANDANT,
              mandate: null,
              context: null,
              fromNumber: "+4930123456",
              outboundProvider: "telnyx",
              numberRecord: null,
              reserveCents: KEINE_RESERVE_CENT,
              maxDur: HOECHSTDAUER_S,
            });
            return null;
          },
        },
      ],
      callQuotaDenial: () => null,
      voiceControl,
      terminateAndBillCall,
      hangUpAction,
      billThunk,
      finishCall,
    }),
  );
  return { app, ablauf, abrechnungen, gewaehlt };
}

async function mitEndpfadBank(run) {
  const bank = endpfadBank();
  const server = await new Promise((resolve) => {
    const srv = bank.app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  const fehlerZeilen = [];
  const originalError = console.error;
  console.error = (...teile) => fehlerZeilen.push(teile.map(String).join(" "));
  try {
    await run({ ...bank, url: `http://127.0.0.1:${server.address().port}`, fehlerLog: () => fehlerZeilen.join("\n") });
  } finally {
    console.error = originalError;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function pruefeEineAbrechnungUeberDasGateway({ abrechnungen, fehlerLog }, callId) {
  const eigene = abrechnungen.filter((eintrag) => eintrag.call?.id === callId);
  assert.equal(eigene.length, 1, `genau eine Abrechnung fuer ${callId} - abgerechnet: ${abrechnungen.map((e) => e.call?.id)}`);
  const [{ call, status, gelesen }] = eigene;
  assert.equal(call, gelesen, "abgerechnet wird der Call aus dem Store");
  assert.notEqual(status, "active", "das Ende ist geschrieben, bevor abgerechnet wird");
  assert.match(
    fehlerLog(),
    new RegExp(`Settlement fehlgeschlagen \\(call=${callId}\\): ${ABRECHNUNG_SCHEITERT}`),
    "ein Fehler der Abrechnung wird vom gemeinsamen Gateway gefangen und mit der Call-ID gemeldet",
  );
}

test("Status-Callback beendet den Call und rechnet genau einmal ueber das Gateway ab, mit CallSid wie mit callId", async () => {
  await mitEndpfadBank(async (bank) => {
    const meldungen = [
      ["", { CallSid: "CA_status", CallStatus: "completed" }],
      [`?callId=${AKTIV_STATUS_ABGEHEND}`, { CallStatus: "completed" }],
    ];
    for (const [abfrage, felder] of meldungen) {
      const antwort = await abrufMitFrist(`${bank.url}/voice/status${abfrage}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(felder).toString(),
      });
      assert.equal(antwort.status, HTTP_OK);
      await antwort.text();
    }
    await waitUntil(() => bank.abrechnungen.length >= meldungen.length && bank.fehlerLog().split("Settlement").length > meldungen.length);
    for (const callId of [AKTIV_STATUS, AKTIV_STATUS_ABGEHEND]) {
      pruefeEineAbrechnungUeberDasGateway(bank, callId);
      assert.equal(store.getCall(callId).status, "completed");
    }
    assert.equal(bank.abrechnungen.length, meldungen.length, "keine weitere Abrechnung");
    assert.deepEqual(
      [...bank.ablauf].sort(),
      [`abrechnen:${AKTIV_STATUS}`, `abrechnen:${AKTIV_STATUS_ABGEHEND}`],
      "der Status-Callback legt nicht selbst auf",
    );
  });
});

test("Fehlschlag beim Waehlen (place_call) beendet den Call als failed und rechnet genau einmal ueber das Gateway ab", async () => {
  await mitEndpfadBank(async (bank) => {
    const antwort = await abrufMitFrist(`${bank.url}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "+4915199990000", objective: "Termin vereinbaren" }),
    });
    assert.equal(antwort.status, HTTP_BAD_GATEWAY, "die Ablehnung des Carriers wird als 502 gemeldet");
    await antwort.json();
    await waitUntil(() => bank.abrechnungen.length > 0 && /Settlement/.test(bank.fehlerLog()));
    const [callId] = bank.gewaehlt;
    assert.deepEqual(bank.ablauf, ["waehlen", `abrechnen:${callId}`], "der Waehlfehler legt nicht selbst auf");
    pruefeEineAbrechnungUeberDasGateway(bank, callId);
    assert.equal(bank.abrechnungen.length, 1, "der gleichzeitige Anruf wird nicht abgerechnet");
    assert.equal(store.getCall(callId).status, "failed");
  });
});

test("cancel_call legt zuerst vollstaendig auf und rechnet danach genau einmal ueber das Gateway ab", async () => {
  await mitEndpfadBank(async (bank) => {
    const antwort = await abrufMitFrist(`${bank.url}/api/calls/${AKTIV_ABBRUCH}/cancel`, { method: "POST" });
    assert.deepEqual(await antwort.json(), { status: "cancelled" });
    await waitUntil(() => bank.abrechnungen.length > 0 && /Settlement/.test(bank.fehlerLog()));
    assert.deepEqual(bank.ablauf, [`auflegen:${TRAEGER_SID}`, `abrechnen:${AKTIV_ABBRUCH}`]);
    pruefeEineAbrechnungUeberDasGateway(bank, AKTIV_ABBRUCH);
  });
});
