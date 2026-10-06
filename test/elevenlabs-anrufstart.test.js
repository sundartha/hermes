import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import test from "node:test";

import { providerOpeningFor } from "../src/elevenlabs/call-locale.js";
import { timezoneForCountry } from "../src/geo/resolve.js";
import { LOCALES } from "../src/i18n/locales.js";
import { BOOTSTRAP_TENANT_ID, DEFAULT_TIMEZONE, countryForE164 } from "../src/store/defaults.js";
import {
  OWNER_TEST_FIRST_NAME,
  OWNER_TEST_LAST_NAME,
  TELNYX_TEST_OWNER_NUMBER,
  TELNYX_TEST_PEER_NUMBER,
  mcpPost,
  readToolResult,
  seedState,
  startServer,
  toolCall,
  waitForStoreState,
} from "./helpers.js";
import {
  CONVERSATION_DONE_WITH_ANALYSIS,
  ERROR_ENVELOPES,
} from "./fixtures/elevenlabs-conversations.js";

const HTTP_OK = 200;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const HTTP_SERVER_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;

const START_PATH = "/v1/convai/sip-trunk/outbound-call";
const CONVERSATION_PATH = "/v1/convai/conversations/";
const API_KEY_HEADER = "xi-api-key";

const AGENT_ID = "agent_el_test_1";
const AGENT_PHONE_NUMBER_ID = "phnum_el_test_1";
const API_KEY = "el-api-key-testgeheim";
const OBJECTIVE = "Termin am Donnerstag vereinbaren (EL-START)";
const OWNER_NAME = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;
const TENANT_A = "tenant-a";
const SUBJECT_A = "sub-a";
const NUMBER_A = "+4915005559002";

const CONVERSATION_ID = CONVERSATION_DONE_WITH_ANALYSIS.conversation_id;
const PROVIDER_SUMMARY = CONVERSATION_DONE_WITH_ANALYSIS.analysis.transcript_summary;
const TRANSCRIPT_LINE = CONVERSATION_DONE_WITH_ANALYSIS.transcript.find(
  (zeile) => zeile.role === "user",
).message;

const PROVIDER_ERROR_ENVELOPE = ERROR_ENVELOPES.unauthorizedBadKey;
const PROVIDER_ERROR_MARKER = PROVIDER_ERROR_ENVELOPE.body.detail.message;

const RESULT_POLL_MS = "150";
const RESULT_WAIT_MS = 8000;
const DOMESTIC_TARIFF_CENTS = "20";
const STARTS_NACH_ERHOLUNG = 2;

const EL_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: AGENT_ID,
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: AGENT_PHONE_NUMBER_ID,
  ELEVENLABS_API_KEY: API_KEY,
  ELEVENLABS_RESULT_POLL_MS: RESULT_POLL_MS,
});

function endJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

const dynamicVariables = (anfrage) =>
  anfrage.body.conversation_initiation_client_data?.dynamic_variables ?? {};

const OVERRIDE_ALLOWED_LEAF_PATHS = new Set(["agent.language", "tts.voice_id"]);
function overrideLeafPaths(wert, prefix = []) {
  const istObjekt = wert !== null && typeof wert === "object" && !Array.isArray(wert);
  if (!istObjekt) return prefix.length ? [prefix.join(".")] : [];
  return Object.entries(wert).flatMap(([schluessel, kind]) =>
    overrideLeafPaths(kind, [...prefix, schluessel]),
  );
}

async function startElevenLabsMock() {
  const startRequests = [];
  const resultRequests = [];
  const mode = { startStatus: HTTP_OK, abbruch: false };

  const handleStart = (req, res, raw) => {
    startRequests.push({ headers: req.headers, raw, body: JSON.parse(raw || "{}") });
    if (mode.abbruch) return res.socket.destroy();
    if (mode.startStatus !== HTTP_OK)
      return endJson(res, mode.startStatus, PROVIDER_ERROR_ENVELOPE.body);
    return endJson(res, HTTP_OK, {
      success: true,
      conversation_id: CONVERSATION_ID,
      sip_call_id: "sip_el_test_1",
    });
  };

  const handleResult = (req, res) => {
    resultRequests.push({ url: req.url });
    return endJson(res, HTTP_OK, CONVERSATION_DONE_WITH_ANALYSIS);
  };

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (req.url.startsWith(START_PATH)) return handleStart(req, res, raw);
      if (req.url.startsWith(CONVERSATION_PATH)) return handleResult(req, res);
      return endJson(res, ERROR_ENVELOPES.notFound.httpStatus, ERROR_ENVELOPES.notFound.body);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    startRequests,
    resultRequests,
    breakStart: (status) => {
      mode.startStatus = status;
    },
    abortStart: () => {
      mode.abbruch = true;
    },
    healStart: () => {
      mode.startStatus = HTTP_OK;
      mode.abbruch = false;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function seedOwner(tenantOverrides = {}) {
  return seedState({
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ...tenantOverrides }],
  });
}

function seedTenantA({
  kycLevel = "card",
  ownerName = "Alice A",
  status = "active",
  defaultLanguage,
} = {}) {
  return seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      {
        id: TENANT_A,
        status,
        idpSubject: SUBJECT_A,
        ...(ownerName ? { ownerName } : {}),
        ...(kycLevel ? { kycLevel } : {}),
        ...(defaultLanguage ? { defaultLanguage } : {}),
      },
    ],
    numbers: [
      {
        id: "num_a",
        e164: NUMBER_A,
        tenantId: TENANT_A,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
    profiles: { [TENANT_A]: { maxCallsPerHour: null } },
  });
}

const usageBucket = (costEur) => ({
  inputTokens: 0,
  outputTokens: 0,
  costEur,
  calls: costEur ? 1 : 0,
});

const SPEND_OVER_CAP_EUR = 99;
const SPEND_NONE_EUR = 0;

function seedTenantAWithSpend(costEur) {
  const seed = seedTenantA();
  seed.usage = { [BOOTSTRAP_TENANT_ID]: usageBucket(0), [TENANT_A]: usageBucket(costEur) };
  return seed;
}

async function withElevenLabs(options, run) {
  const mock = await startElevenLabsMock();
  const srv = await startServer({
    env: { ...EL_ENV, ELEVENLABS_API_BASE: mock.url, ...options.env },
    seed: options.seed,
    ownerNumber: options.ownerNumber,
  });
  try {
    return await run({ srv, mock });
  } finally {
    await srv.stop();
    await mock.close();
  }
}

function placeCall(srv, identity, auftrag = {}) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(identity ? { "X-Internal-Identity": identity } : {}),
    },
    body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective: OBJECTIVE, ...auftrag }),
  });
}

const ownCalls = (srv) => srv.readStore().calls.filter((call) => call.goal === OBJECTIVE);

const MULTI = { MULTI_TENANT: "true" };

const GATE_FAELLE = [
  {
    id: "OUTBOUND_FROZEN",
    was: "globaler Notaus",
    status: HTTP_FORBIDDEN,
    fehler: /gesperrt|OUTBOUND_FROZEN/,
    scharf: { env: { OUTBOUND_FROZEN: "true" }, seed: seedOwner() },
    entschaerft: { env: { OUTBOUND_FROZEN: "false" }, seed: seedOwner() },
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  },
  {
    id: "KYC",
    was: "Verifikation als Outbound-Permit (KYC-Stufe)",
    status: HTTP_FORBIDDEN,
    fehler: /KYC/i,
    scharf: { seed: seedOwner({ kycLevel: "otp" }) },
    entschaerft: { seed: seedOwner({ kycLevel: "card" }) },
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  },
  {
    id: "ABO",
    was: "Verifikation als Outbound-Permit (Abo/Tenant-Status)",
    status: HTTP_FORBIDDEN,
    fehler: /Subscription inactive|blocked/i,
    scharf: { env: MULTI, seed: seedTenantA({ status: "suspended" }), identity: SUBJECT_A },
    entschaerft: { env: MULTI, seed: seedTenantA({ status: "active" }), identity: SUBJECT_A },
  },
  {
    id: "KOSTENDECKE",
    was: "pro-Tenant-Kostendecke",
    status: HTTP_PAYMENT_REQUIRED,
    fehler: /budget limit/,
    scharf: { env: MULTI, seed: seedTenantAWithSpend(SPEND_OVER_CAP_EUR), identity: SUBJECT_A },
    entschaerft: { env: MULTI, seed: seedTenantAWithSpend(SPEND_NONE_EUR), identity: SUBJECT_A },
  },
];

const OWNER_NAME_FALL = {
  id: "AUFTRAGGEBER-NAME",
  was: "registrierter Auftraggeber-Name (Traeger der Offenlegung)",
  status: HTTP_FORBIDDEN,
  fehler: /Auftraggeber-Name/,
  scharf: { env: MULTI, seed: seedTenantA({ ownerName: null }), identity: SUBJECT_A },
  entschaerft: { env: MULTI, seed: seedTenantA({ ownerName: "Alice A" }), identity: SUBJECT_A },
};

const laufOptionen = (fall, variante) => ({ ...fall[variante], ownerNumber: fall.ownerNumber });

async function assertGateBlockiert(fall) {
  await withElevenLabs(laufOptionen(fall, "scharf"), async ({ srv, mock }) => {
    const res = await placeCall(srv, fall.scharf.identity);
    assert.equal(res.status, fall.status, `Gate ${fall.id} muss ablehnen`);
    assert.match((await res.json()).error, fall.fehler, `Ablehnung aus dem Gate ${fall.id}`);
    assert.equal(
      mock.startRequests.length,
      0,
      `Gate ${fall.id}: der ElevenLabs-Anrufstart darf NIE erreicht werden`,
    );
    assert.equal(ownCalls(srv).length, 0, `Gate ${fall.id}: kein Call-Datensatz`);
  });
}

async function assertAnbieterErreicht(fall) {
  await withElevenLabs(laufOptionen(fall, "entschaerft"), async ({ srv, mock }) => {
    const res = await placeCall(srv, fall.entschaerft.identity);
    assert.equal(
      res.status,
      HTTP_OK,
      `Positiv-Kontrolle ${fall.id}: derselbe Seed OHNE die gesenkte Achse muss durchgehen`,
    );
    assert.equal(
      mock.startRequests.length,
      1,
      `Positiv-Kontrolle ${fall.id}: genau EIN Anrufstart am Anbieter`,
    );
  });
}

test("EL-START T1: der ElevenLabs-Anrufstart wird gerufen und seine conversation_id landet am Call", async (ctx) => {
  await withElevenLabs(
    { seed: seedOwner(), ownerNumber: TELNYX_TEST_OWNER_NUMBER },
    async ({ srv, mock }) => {
      const res = await placeCall(srv);
      const antwort = await res.json();

      await ctx.test("200 mit callId", () => {
        assert.equal(res.status, HTTP_OK, JSON.stringify(antwort));
        assert.ok(antwort.callId, "callId fehlt in der Antwort");
      });

      await ctx.test("genau EIN POST auf /v1/convai/sip-trunk/outbound-call", () => {
        assert.equal(mock.startRequests.length, 1);
      });

      const anfrage = mock.startRequests[0] || { body: {}, headers: {} };

      await ctx.test("Pflichtfelder agent_id / agent_phone_number_id / to_number", () => {
        assert.equal(anfrage.body.agent_id, AGENT_ID);
        assert.equal(anfrage.body.agent_phone_number_id, AGENT_PHONE_NUMBER_ID);
        assert.equal(
          anfrage.body.to_number,
          TELNYX_TEST_PEER_NUMBER,
          "das serverseitig normalisierte Ziel, unveraendert (geprueft == gewaehlt)",
        );
      });

      await ctx.test("Auftrag als dynamische Variable, nicht als Prompt-Uebersteuerung", () => {
        assert.equal(dynamicVariables(anfrage).objective, OBJECTIVE);
      });

      await ctx.test("callee benennt dasselbe normalisierte Ziel, das gewaehlt wurde", () => {
        assert.equal(
          dynamicVariables(anfrage).callee,
          TELNYX_TEST_PEER_NUMBER,
          "{{callee}} bleibt sonst unaufgeloest oder nennt eine andere Nummer als die gewaehlte",
        );
      });

      await ctx.test("xi-api-key traegt den Schluessel", () => {
        assert.equal(anfrage.headers[API_KEY_HEADER], API_KEY);
      });

      await ctx.test("conversation_id steht ueber recordElevenlabsConversationId am Call", () => {
        const call = ownCalls(srv)[0];
        assert.ok(call, "kein Call-Datensatz angelegt");
        assert.equal(
          call.elevenlabsConversationId,
          CONVERSATION_ID,
          "das Feld ist das einzige Produkt des Mutators - ohne es bindet der Consult-Webhook nie",
        );
      });
    },
  );
});

test("EL-START ROTPROBE-1: FAKE_ORIGINATE_ELEVENLABS=true erreicht den Anbieter NIE, legt aber einen Call-Datensatz mit fake_el_-Kennung an", async (ctx) => {
  await withElevenLabs(
    {
      env: { FAKE_ORIGINATE_ELEVENLABS: "true" },
      seed: seedOwner(),
      ownerNumber: TELNYX_TEST_OWNER_NUMBER,
    },
    async ({ srv, mock }) => {
      const res = await placeCall(srv);
      const antwort = await res.json();

      await ctx.test("200 mit callId - der Anruf-Datensatz entsteht trotzdem", () => {
        assert.equal(res.status, HTTP_OK, JSON.stringify(antwort));
        assert.ok(antwort.callId, "callId fehlt in der Antwort");
      });

      await ctx.test(
        "KEIN Netzzugriff gegen den Anbieter (POST /v1/convai/sip-trunk/outbound-call)",
        () => {
          assert.equal(
            mock.startRequests.length,
            0,
            "der Anrufstart darf den Anbieter mit gesetztem Schalter NIE erreichen",
          );
        },
      );

      await ctx.test(
        "die Kennung traegt die Anbieter-Form (SIPTrunkOutboundCallResponse), erfundene Werte klar markiert",
        () => {
          const call = ownCalls(srv)[0];
          assert.ok(call, "kein Call-Datensatz angelegt");
          assert.match(
            call.elevenlabsConversationId,
            /^fake_el_[0-9a-f]{16}$/,
            `fake_el_-Praefix fehlt: ${call.elevenlabsConversationId}`,
          );
        },
      );
    },
  );
});

for (const fall of GATE_FAELLE) {
  test(`EL-START T2 (${fall.id}): ${fall.was} sperrt auch den ElevenLabs-Zweig`, async (ctx) => {
    await ctx.test("scharf -> Ablehnung, kein Anrufstart am Anbieter, kein Call-Datensatz", () =>
      assertGateBlockiert(fall),
    );
    await ctx.test("entschaerft -> 200 und genau EIN Anrufstart (Positiv-Kontrolle)", () =>
      assertAnbieterErreicht(fall),
    );
  });
}

test("EL-START T3: beendetes Anbieter-Gespraech -> Transkript und Zusammenfassung so im Store, dass get_call_result sie liefert", async (ctx) => {
  await withElevenLabs(
    {
      env: { VOICE_TARIFF_DOMESTIC_CENTS: DOMESTIC_TARIFF_CENTS },
      seed: seedOwner(),
      ownerNumber: TELNYX_TEST_OWNER_NUMBER,
    },
    async ({ srv, mock }) => {
      const res = await placeCall(srv);
      assert.equal(res.status, HTTP_OK, "Vorbedingung: der Anruf muss ueberhaupt starten");
      const { callId } = await res.json();

      const stand = await waitForStoreState(
        srv,
        (state) => state.calls.some((call) => call.id === callId && call.status !== "active"),
        RESULT_WAIT_MS,
      );
      const call = stand.calls.find((eintrag) => eintrag.id === callId);

      await ctx.test("der Anbieter wurde nach dem Ergebnis gefragt", () => {
        assert.ok(
          mock.resultRequests.some((anfrage) => anfrage.url.includes(CONVERSATION_ID)),
          "kein GET auf /v1/convai/conversations/{id}",
        );
      });

      await ctx.test("Bedingung 1: der Call verlaesst 'active'", () => {
        assert.notEqual(call.status, "active");
      });
      await ctx.test("Bedingung 2: transcript ist ein Array", () => {
        assert.ok(Array.isArray(call.transcript), `transcript=${JSON.stringify(call.transcript)}`);
      });
      await ctx.test("die Zusammenfassung des Anbieters steht am Call", () => {
        assert.equal(call.summary, PROVIDER_SUMMARY);
      });

      await ctx.test("get_call_result liefert sie - und NICHT das Roh-Transkript", async () => {
        const antwort = await mcpPost(
          `${srv.localUrl}/mcp`,
          null,
          toolCall("get_call_result", { call_id: callId }),
        );
        const ergebnis = await readToolResult(antwort);
        const text = ergebnis.content[0].text;
        assert.equal(
          JSON.parse(text).result_summary,
          PROVIDER_SUMMARY,
          `Zusammenfassung fehlt in get_call_result: ${text}`,
        );
        assert.ok(
          !text.includes(TRANSCRIPT_LINE),
          "das Roh-Transkript darf NIE nach aussen (Datensparsamkeit)",
        );
      });

      const nachBuchung = await waitForStoreState(
        srv,
        (state) => state.calls.some((eintrag) => eintrag.id === callId && eintrag.billedAt),
        RESULT_WAIT_MS,
      );

      await ctx.test(
        "Positiv-Kontrolle: die Buchungskette ist gelaufen, und dieses Leg ist bepreist",
        () => {
          const abgerechnet = nachBuchung.calls.find((eintrag) => eintrag.id === callId);
          assert.ok(
            abgerechnet.billedAt,
            "der Erfolgspfad erreicht den EINEN Beender (terminateAndBillCall) gar nicht erst",
          );
          assert.ok(
            abgerechnet.reserveCents > 0,
            `Wache: der Minutensatz dieses Legs ist 0 (reserveCents=${JSON.stringify(abgerechnet.reserveCents)}) - dann bucht auch ein heiler Weg 0, und der Fall unten maesse die Test-Umgebung statt des Zweigs`,
          );
        },
      );

      await ctx.test("der Erfolgspfad bucht auf die Kosten-/Verbrauchsachse des Tenants", () => {
        const abgerechnet = nachBuchung.calls.find((eintrag) => eintrag.id === callId);
        const gebucht = nachBuchung.usage?.[BOOTSTRAP_TENANT_ID]?.costCents;
        assert.ok(
          gebucht > 0,
          `ein gelungener ElevenLabs-Anruf legt NICHTS auf die Achse, die die pro-Tenant-Kostendecke liest (usage[${BOOTSTRAP_TENANT_ID}].costCents=${JSON.stringify(gebucht)}, Satz VOICE_TARIFF_DOMESTIC_CENTS=${DOMESTIC_TARIFF_CENTS}) - er kostet real (Carrier-Minuten der DID plus das Gespraech beim Anbieter), aber das Gate sieht davon nichts und deckelt diesen Weg nie. Am Record nachgemessen: answeredAt=${JSON.stringify(abgerechnet.answeredAt)}, endedAt=${JSON.stringify(abgerechnet.endedAt)}, estimatedCostCents=${JSON.stringify(abgerechnet.estimatedCostCents)} - die Minuten-Quelle beider Buchungen (voiceMinutesOf, billing/metering.js) liefert ohne answeredAt 0, und markAnswered ruft auf diesem Weg niemand: der Anruf laeuft ueber den SIP-Trunk des Anbieters, es kommt kein /voice-Webhook, der ihn setzen wuerde`,
        );
      });
    },
  );
});

test("EL-START T4 (a): Anbieter antwortet mit Fehler -> sauberes Ende, Reserve frei, Tenant nicht blockiert", async (ctx) => {
  await withElevenLabs(
    {
      env: { VOICE_TARIFF_DOMESTIC_CENTS: DOMESTIC_TARIFF_CENTS },
      seed: seedOwner(),
      ownerNumber: TELNYX_TEST_OWNER_NUMBER,
    },
    async ({ srv, mock }) => {
      mock.breakStart(PROVIDER_ERROR_ENVELOPE.httpStatus);
      const res = await placeCall(srv);
      const antwort = await res.json();

      await ctx.test("502 und KEINE rohe Anbieter-Meldung an den Aufrufer", () => {
        assert.equal(
          res.status,
          HTTP_BAD_GATEWAY,
          "eine echte HTTP-Ablehnung des Anbieters traegt providerStatus -> 502 (Muster Telnyx-Adapter)",
        );
        const roh = JSON.stringify(antwort);
        assert.ok(!roh.includes(PROVIDER_ERROR_MARKER), `Anbieter-Rumpf durchgereicht: ${roh}`);
        assert.ok(!roh.includes(API_KEY), "Schluessel in der Antwort");
      });

      const stand = await waitForStoreState(
        srv,
        (state) => state.calls.some((call) => call.reserveReleased === true),
        RESULT_WAIT_MS,
      );

      await ctx.test("genau EIN Call-Datensatz, Status failed, Reserve freigegeben", () => {
        const eigene = stand.calls.filter((call) => call.goal === OBJECTIVE);
        assert.equal(eigene.length, 1, "kein Retry/Doppel-Anlegen");
        assert.equal(eigene[0].status, "failed");
        assert.equal(eigene[0].reserveReleased, true);
        assert.equal(eigene[0].elevenlabsConversationId ?? null, null, "keine halbe Kennung");
      });

      await ctx.test("danach geht ein neuer Anruf desselben Tenants sofort wieder", async () => {
        mock.healStart();
        const zweiter = await placeCall(srv);
        assert.equal(zweiter.status, HTTP_OK, await zweiter.text());
        assert.equal(
          mock.startRequests.length,
          STARTS_NACH_ERHOLUNG,
          "der zweite Anrufstart erreicht den Anbieter",
        );
      });
    },
  );
});

test("EL-START T4 (b): Anbieter bricht die Verbindung ab -> 500, Call failed, keine Kennung am Call", async (ctx) => {
  await withElevenLabs(
    {
      env: { VOICE_TARIFF_DOMESTIC_CENTS: DOMESTIC_TARIFF_CENTS },
      seed: seedOwner(),
      ownerNumber: TELNYX_TEST_OWNER_NUMBER,
    },
    async ({ srv, mock }) => {
      mock.abortStart();
      const res = await placeCall(srv);

      await ctx.test("der Anrufstart hat den Anbieter erreicht (Positiv-Kontrolle)", () => {
        assert.equal(mock.startRequests.length, 1);
      });

      await ctx.test("500 (ein Transportfehler traegt keinen providerStatus)", async () => {
        assert.equal(res.status, HTTP_SERVER_ERROR, await res.text());
      });

      const stand = await waitForStoreState(
        srv,
        (state) => state.calls.some((call) => call.reserveReleased === true),
        RESULT_WAIT_MS,
      );

      await ctx.test("Call failed, Reserve freigegeben, keine conversation_id", () => {
        const eigene = stand.calls.filter((call) => call.goal === OBJECTIVE);
        assert.equal(eigene.length, 1);
        assert.equal(eigene[0].status, "failed");
        assert.equal(eigene[0].reserveReleased, true);
        assert.equal(eigene[0].elevenlabsConversationId ?? null, null);
      });
    },
  );
});

test("EL-START T5 (a): der Anrufstart uebergibt owner_name und uebersteuert first_message NICHT", async (ctx) => {
  await withElevenLabs(
    { seed: seedOwner({ defaultLanguage: "de" }), ownerNumber: TELNYX_TEST_OWNER_NUMBER },
    async ({ srv, mock }) => {
      const res = await placeCall(srv);
      assert.equal(res.status, HTTP_OK, "Vorbedingung: der Anruf muss ueberhaupt starten");
      const anfrage = mock.startRequests[0];

      await ctx.test("owner_name traegt den vollen Auftraggeber-Namen", () => {
        assert.equal(
          dynamicVariables(anfrage).owner_name,
          OWNER_NAME,
          "ohne diesen Wert bliebe {{owner_name}} in first_message unaufgeloest",
        );
      });

      await ctx.test(
        "first_message wird nicht uebersteuert, conversation_config_override setzt hoechstens die Weisse Liste",
        () => {
          const overridePfade = overrideLeafPaths(
            anfrage.body.conversation_initiation_client_data?.conversation_config_override,
          );
          assert.ok(
            overridePfade.every((pfad) => OVERRIDE_ALLOWED_LEAF_PATHS.has(pfad)),
            `conversation_config_override darf ausschliesslich ${[...OVERRIDE_ALLOWED_LEAF_PATHS].join(", ")} setzen (agent.language/tts.voice_id) - gefunden: ${overridePfade.join(", ") || "(keine)"}. Eine Uebersteuerung wird bei falscher Konfiguration STILL ignoriert, der Satz duerfte nie daran haengen, und jeder dritte Pfad baut den Agenten pro Anruf unbemerkt um.`,
          );
          assert.ok(
            !anfrage.raw.includes("first_message"),
            "der Offenlegungssatz ist Agenten-Konfiguration, kein Anruf-Parameter (Absolute Regel 2)",
          );
        },
      );
    },
  );
});

test("EL-START T5 (b): ohne registrierten Auftraggeber-Namen wird gar nicht erst gewaehlt", async (ctx) => {
  await ctx.test("scharf -> 403, kein Anrufstart am Anbieter", () =>
    assertGateBlockiert(OWNER_NAME_FALL),
  );
  await ctx.test("entschaerft -> 200 und genau EIN Anrufstart (Positiv-Kontrolle)", () =>
    assertAnbieterErreicht(OWNER_NAME_FALL),
  );
});

const TEMPLATE_PATH = "elevenlabs/agent_configs/outbound-agent.template.json";
const OWNER_NAME_VARIABLE = "{{owner_name}}";
const OPENING_LINE_VARIABLE = "{{opening_line}}";

test("EL-START T5 (c, Mechanismus, gruen): first_message der Agenten-Vorlage ist byte-identisch die Eroeffnung aus dem Code, und sie BEGINNT mit dem Offenlegungssatz", () => {
  const vorlage = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const agent = vorlage.agent.conversation_config.agent;
  assert.equal(
    agent.first_message,
    providerOpeningFor("en"),
    "first_message muss die aus LOCALES.en zusammengesetzte Eroeffnung sein (Offenlegung + Grund-Zeile), nur ${ownerName} -> {{owner_name}}",
  );
  assert.ok(
    agent.first_message.startsWith(LOCALES.en.disclosure(OWNER_NAME_VARIABLE)),
    "Absolute Regel 2 / Artikel 50 EU AI Act: der Offenlegungssatz ist der ANFANG der Eroeffnung, nicht irgendwo darin",
  );
  assert.equal(
    agent.language,
    "en",
    "Sprache des Agenten und Sprache des Satzes gehoeren zusammen",
  );
});

test("EL-START T5 (e, Mechanismus, gruen): jede Sprache mit kuratiertem Offenlegungssatz hat ein Preset mit GENAU diesem Satz - und keine andere hat einen", () => {
  const vorlage = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const conversationConfig = vorlage.agent.conversation_config;
  const presets = conversationConfig.language_presets;
  const basisSprache = conversationConfig.agent.language;

  const ersterSatzVon = (preset) => preset?.overrides?.agent?.first_message ?? null;

  for (const [sprache, bundle] of Object.entries(LOCALES)) {
    if (sprache === basisSprache) continue;
    assert.ok(
      presets[sprache],
      `LOCALES fuehrt einen Offenlegungssatz fuer "${sprache}", die Vorlage aber kein language_preset - ein Angerufener dieser Sprache hoert dann den ${basisSprache}-Satz`,
    );
    assert.equal(
      ersterSatzVon(presets[sprache]),
      providerOpeningFor(sprache),
      `das Preset "${sprache}" muss die aus LOCALES.${sprache} zusammengesetzte Eroeffnung sein, nur \${ownerName} -> {{owner_name}} - kein hier entstandener Wortlaut`,
    );
    assert.ok(
      ersterSatzVon(presets[sprache]).startsWith(bundle.disclosure(OWNER_NAME_VARIABLE)),
      `Absolute Regel 2 / Artikel 50 EU AI Act: im Preset "${sprache}" steht der Offenlegungssatz am ANFANG der Eroeffnung`,
    );
  }

  for (const [sprache, preset] of Object.entries(presets)) {
    if (LOCALES[sprache]) continue;
    assert.equal(
      ersterSatzVon(preset),
      null,
      `das Preset "${sprache}" traegt einen ersten Satz, den der Code nicht kennt - eine hier uebersetzte Offenlegung ist eine erfundene Rechtsaussage`,
    );
  }
});

test("GQ-E1-05: der statische Rahmen endet mit der Variablen", () => {
  const vorlage = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const conversationConfig = vorlage.agent.conversation_config;

  assert.ok(
    conversationConfig.agent.first_message.endsWith(OPENING_LINE_VARIABLE),
    "first_message der Vorlage darf hinter {{opening_line}} keinen statischen Text mehr fuehren",
  );
  for (const [sprache, preset] of Object.entries(conversationConfig.language_presets)) {
    const satz = preset?.overrides?.agent?.first_message ?? null;
    if (satz === null) continue;
    assert.ok(
      satz.endsWith(OPENING_LINE_VARIABLE),
      `das Preset "${sprache}" fuehrt hinter {{opening_line}} statischen Text - dort kann die Komposition ihn nicht mehr weglassen`,
    );
  }
  for (const sprache of Object.keys(LOCALES)) {
    assert.ok(
      providerOpeningFor(sprache).endsWith(OPENING_LINE_VARIABLE),
      `providerOpeningFor("${sprache}") muss mit der Variablen enden - sie ist der Referenz-Wortlaut der Vorlage`,
    );
  }
});

const OWNER_NAME_BLANK = "   ";

const PLATZHALTER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const LEER = "";
const rendern = (satz, variablen) =>
  satz.replace(PLATZHALTER, (treffer, name) => String(variablen[name] ?? LEER));

function gesprochenerSatzFuer(sprache) {
  const conversationConfig = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8")).agent
    .conversation_config;
  const preset = conversationConfig.language_presets?.[sprache];
  return preset?.overrides?.agent?.first_message ?? conversationConfig.agent.first_message;
}

function spracheDesAnrufs(anfrage) {
  const clientData = anfrage.body.conversation_initiation_client_data;
  return clientData?.conversation_config_override?.agent?.language ?? null;
}

test("EL-START T5 (d): der Offenlegungssatz haengt an keiner Variablen ohne Default - blanker Auftraggeber-Name, Satz bleibt vollstaendig (Artikel 50 EU AI Act)", async (ctx) => {
  await withElevenLabs(
    { env: MULTI, seed: seedTenantA({ ownerName: OWNER_NAME_BLANK, defaultLanguage: "de" }) },
    async ({ srv, mock }) => {
      const res = await placeCall(srv, SUBJECT_A);
      assert.equal(res.status, HTTP_OK, `Vorbedingung: der Anruf startet: ${await res.text()}`);
      assert.equal(
        mock.startRequests.length,
        1,
        "Positiv-Kontrolle: der blanke Name passiert das Identitaets-Gate und erreicht den Anbieter",
      );
      const variablen = dynamicVariables(mock.startRequests[0]);

      await ctx.test("owner_name geht als nicht-leerer String an den Anbieter", () => {
        assert.equal(typeof variablen.owner_name, "string", "owner_name fehlt ganz");
        assert.ok(
          variablen.owner_name.trim().length > 0,
          `owner_name=${JSON.stringify(variablen.owner_name)} - der Traeger der Offenlegung geht text-abgesichert raus und faellt bei blankem Namen auf DISCLOSURE_OWNER_FALLBACK_EN (dynamicVariables, src/elevenlabs/outbound.js)`,
        );
      });

      await ctx.test("der daraus gerenderte Offenlegungssatz steht vollstaendig am Anfang", () => {
        const sprache = spracheDesAnrufs(mock.startRequests[0]);
        assert.ok(LOCALES[sprache], `unbekannte Anruf-Sprache ${JSON.stringify(sprache)}`);
        const gerendert = rendern(gesprochenerSatzFuer(sprache), variablen);
        const pflichtsatz = LOCALES[sprache].disclosure(LOCALES[sprache].disclosureOwnerFallback);
        assert.ok(
          gerendert.startsWith(pflichtsatz),
          `was der Anbieter aus den uebergebenen Variablen spricht, beginnt nicht mit dem vollstaendigen Offenlegungssatz mit eingesetztem Default: "${gerendert}"`,
        );
      });
    },
  );
});

const OFFENLEGUNG_UNTERBRECHUNG = Object.freeze([
  Object.freeze({
    feld: "disable_first_message_interruptions",
    vorlagePfad: "agent.conversation_config.agent.disable_first_message_interruptions",
    livePfad: "conversation_config.agent.disable_first_message_interruptions",
    soll: true,
    zweck:
      "sperrt die Unterbrechung fuer den ERSTEN Satz und nur fuer ihn - ohne ihn bricht ein Huster auf der Leitung die Offenlegung ab, und Artikel 50 EU AI Act haengt an ihr",
  }),
  Object.freeze({
    feld: "transcribe_on_disabled_interruptions",
    vorlagePfad: "agent.conversation_config.turn.transcribe_on_disabled_interruptions",
    livePfad: "conversation_config.turn.transcribe_on_disabled_interruptions",
    soll: false,
    zweck:
      "verwirft, was waehrend des gesperrten Zuges erkannt wird - mit true kam ein Phantom-Zug der Anbieter-Erkennung als echter User-Zug beim Modell an und kippte den Anruf in eine fremde Sprache (2026-09-04, s. tasks/UEBERGABE-SPRACHDEFEKT.md)",
  }),
]);

const blattAnPfad = (wurzel, pfad) =>
  pfad.split(".").reduce((knoten, teil) => (knoten == null ? undefined : knoten[teil]), wurzel);

test("EL-START T5 (f, Mechanismus): die Offenlegung ist gegen Unterbrechung gesichert - SOLL in der Vorlage UND vom Drift-Waechter bewacht", () => {
  const vorlage = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const besitzFelder = vorlage._besitz?.felder ?? [];
  assert.ok(
    besitzFelder.length > 0,
    "die Besitz-Erklaerung der Vorlage ist leer - dann prueft die zweite Haelfte unten nichts",
  );

  for (const { feld, vorlagePfad, livePfad, soll, zweck } of OFFENLEGUNG_UNTERBRECHUNG) {
    assert.equal(
      blattAnPfad(vorlage, vorlagePfad),
      soll,
      `${TEMPLATE_PATH}: ${vorlagePfad} steht nicht auf ${soll}. Das Feld ${zweck}. Ohne SOLL-Wert in der Vorlage gibt es nichts, was ein Push an den Agenten bringen und der Drift-Waechter verteidigen koennte.`,
    );

    const eintrag = besitzFelder.find((kandidat) => kandidat.feld === feld);
    assert.ok(
      eintrag,
      `${TEMPLATE_PATH}: _besitz.felder fuehrt keinen Eintrag "${feld}". Der Wert steht dann zwar in der Vorlage, aber npm run elevenlabs:drift sieht am Live-Agenten nie hin - ein Zuruecksetzen im Dashboard bliebe unbemerkt.`,
    );
    assert.equal(
      eintrag.art,
      "wert",
      `${feld}: nur art "wert" vergleicht genau ein Blatt je Seite - jede andere Art wuerde hier etwas anderes messen als den Schalter selbst`,
    );
    assert.deepEqual(
      eintrag.vorlage,
      [vorlagePfad],
      `${feld}: der besessene VORLAGEN-Pfad zeigt woandershin als der Wert oben - der Waechter verteidigt dann eine Stelle, die niemand setzt`,
    );
    assert.deepEqual(
      eintrag.live,
      [livePfad],
      `${feld}: der besessene LIVE-Pfad weicht vom Anbieter-Schema ab (s. Schema-Beleg im Kopf dieses Falls) - ein Waechter, der ins Nichts sieht, wird nie rot`,
    );
    assert.equal(
      eintrag.ausgenommen,
      undefined,
      `${feld} traegt eine Ausnahme. Eine Ausnahme sagt dem Push "nicht von selbst geradebiegen" - bei einem Feld, an dem Artikel 50 EU AI Act haengt, ist das keine Entscheidung, die still in der Besitz-Liste stehen darf.`,
    );
  }
});

const VERBOT_ZEIT = "nicht vor 10 Uhr";
const VERBOT_PREIS = "hoechstens 40 Euro";
const VERBOT_ANZAHLUNG = "keine Anzahlung zusagen";
const VERBOTE = Object.freeze([VERBOT_ZEIT, VERBOT_PREIS, VERBOT_ANZAHLUNG]);
const CONSTRAINTS = `${VERBOT_ZEIT}, ${VERBOT_PREIS}, ${VERBOT_ANZAHLUNG}`;

const KONTEXT_BEZIEHUNG = "Stammkunde seit drei Jahren, Duzen ist ueblich";
const KONTEXT_ERGEBNIS = "ein fest zugesagter Termin am Donnerstagvormittag";
const KONTEXT = Object.freeze({
  summary: "Der Auftraggeber braucht einen Herrenhaarschnitt vor seiner Reise am Freitag.",
  recipient_relationship: KONTEXT_BEZIEHUNG,
  desired_outcome: KONTEXT_ERGEBNIS,
});

function stringBlaetter(wert) {
  if (typeof wert === "string") return [wert];
  if (!wert || typeof wert !== "object") return [];
  return Object.values(wert).flatMap(stringBlaetter);
}

function agentMaterial(anfrage) {
  const daten = anfrage.body.conversation_initiation_client_data ?? {};
  return stringBlaetter([
    daten.dynamic_variables,
    daten.conversation_config_override,
    anfrage.body.conversation_config_override,
  ]).join("\n");
}

const enthaelt = (material, wortlaut) => material.toLowerCase().includes(wortlaut.toLowerCase());

test("EL-START T6: die harten Verbote und der Kontext des Auftrags erreichen den Agenten des Anbieters", async (ctx) => {
  await withElevenLabs(
    {
      env: { ASSISTANT_CONTEXT_ENABLED: "true" },
      seed: seedOwner(),
      ownerNumber: TELNYX_TEST_OWNER_NUMBER,
    },
    async ({ srv, mock }) => {
      const res = await placeCall(srv, null, { constraints: CONSTRAINTS, context: KONTEXT });
      const antwort = await res.text();
      assert.equal(
        res.status,
        HTTP_OK,
        `Vorbedingung: der Anruf muss ueberhaupt starten: ${antwort}`,
      );
      assert.equal(mock.startRequests.length, 1, "Vorbedingung: genau EIN Anrufstart am Anbieter");
      const anfrage = mock.startRequests[0];
      const material = agentMaterial(anfrage);

      await ctx.test("Vorbedingung: Verbote und Kontext stehen am Call-Datensatz", () => {
        const call = ownCalls(srv)[0];
        assert.ok(call, "kein Call-Datensatz angelegt");
        assert.equal(call.constraints, CONSTRAINTS, "die Verbote kommen nicht einmal am Record an");
        assert.equal(call.context?.desired_outcome, KONTEXT_ERGEBNIS);
        assert.equal(call.context?.recipient_relationship, KONTEXT_BEZIEHUNG);
      });

      await ctx.test(
        "Positiv-Kontrolle: das Anliegen findet der Sucher im Agenten-Material",
        () => {
          assert.ok(
            enthaelt(material, OBJECTIVE),
            `der Sucher findet nicht einmal das Anliegen - Material: ${material}`,
          );
        },
      );

      await ctx.test("jedes harte Verbot erreicht den Agenten im Wortlaut", () => {
        for (const verbot of VERBOTE)
          assert.ok(
            enthaelt(material, verbot),
            `Verbot "${verbot}" erreicht den Agenten NICHT - weder als dynamische Variable noch als Prompt-Uebersteuerung. Material: ${material}`,
          );
      });

      await ctx.test(
        "das Wunschergebnis und die Beziehung zur Gegenstelle erreichen den Agenten",
        () => {
          assert.ok(
            enthaelt(material, KONTEXT_ERGEBNIS),
            `desired_outcome erreicht den Agenten NICHT - er verhandelt ohne Ziel. Material: ${material}`,
          );
          assert.ok(
            enthaelt(material, KONTEXT_BEZIEHUNG),
            `recipient_relationship erreicht den Agenten NICHT - er spricht einen Stammkunden an wie einen Fremden. Material: ${material}`,
          );
        },
      );
    },
  );
});

const EN_PROMPT = LOCALES.en.prompt;
const VORRANG_SATZ = EN_PROMPT.mandate.constraintsPrecedence.trim();

function vorlagenPrompt() {
  const vorlage = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const agent = vorlage.agent.conversation_config.agent;
  return agent.prompt.prompt;
}

const materialMitVorlage = (anfrage) =>
  [agentMaterial(anfrage), rendern(vorlagenPrompt(), dynamicVariables(anfrage))].join("\n");

async function vorrangLauf(auftrag) {
  return withElevenLabs(
    { seed: seedOwner(), ownerNumber: TELNYX_TEST_OWNER_NUMBER },
    async ({ srv, mock }) => {
      const res = await placeCall(srv, null, auftrag);
      assert.equal(
        res.status,
        HTTP_OK,
        `Vorbedingung: der Anruf muss starten: ${await res.text()}`,
      );
      assert.equal(mock.startRequests.length, 1, "Vorbedingung: genau EIN Anrufstart am Anbieter");
      const anfrage = mock.startRequests[0];
      return { variablen: dynamicVariables(anfrage), material: materialMitVorlage(anfrage) };
    },
  );
}

test("EL-START T6 (Vorrang): der Vorrang-Satz erreicht den Agenten nur zusammen mit den Verboten", async (ctx) => {
  await ctx.test("ohne Verbote: kein Vorrang-Satz im Material, constraints leer", async () => {
    const { variablen, material } = await vorrangLauf({});
    assert.equal(
      variablen.constraints,
      LEER,
      `ohne Verbote traegt {{constraints}} den leeren String - nicht Text, nicht undefined (eine vom Prompt referenzierte, aber nicht gelieferte Variable bricht das Gespraech stumm ab): ${JSON.stringify(variablen.constraints)}`,
    );
    assert.ok(
      !enthaelt(material, VORRANG_SATZ),
      `der Agent bekommt den Vorrang von Verboten zugesagt, die dieser Auftrag nicht hat - er kann sich daraufhin Grenzen ausdenken oder sein Mandat abschwaechen. Material: ${material}`,
    );
  });

  await ctx.test("mit Verboten: derselbe Sucher findet ihn (Positiv-Kontrolle)", async () => {
    const { material } = await vorrangLauf({ constraints: CONSTRAINTS });
    assert.ok(
      enthaelt(material, VORRANG_SATZ),
      `die Verbote reisen ohne ihren Vorrang - aus "entscheide frei, aber hoechstens 40 Euro" wird am Anbieter wieder "entscheide frei". Material: ${material}`,
    );
  });
});

const MANDAT_SPIELRAUM = "Termin an jedem Werktag zwischen 9 und 12 Uhr, bis 60 Euro";
const MANDAT_REIHENFOLGE = "zuerst Donnerstagvormittag, sonst Freitag, sonst naechste Woche";
const MANDAT = Object.freeze({
  decide_freely: MANDAT_SPIELRAUM,
  fallback_order: MANDAT_REIHENFOLGE,
});

test("EL-START T6 (Mandat): die Ermaechtigung und die Ausweich-Reihenfolge erreichen den Agenten des Anbieters", async (ctx) => {
  await withElevenLabs(
    { seed: seedOwner(), ownerNumber: TELNYX_TEST_OWNER_NUMBER },
    async ({ srv, mock }) => {
      const res = await placeCall(srv, null, { mandate: MANDAT });
      const antwort = await res.text();
      assert.equal(res.status, HTTP_OK, `Vorbedingung: der Anruf muss starten: ${antwort}`);
      assert.equal(mock.startRequests.length, 1, "Vorbedingung: genau EIN Anrufstart am Anbieter");
      const material = agentMaterial(mock.startRequests[0]);

      await ctx.test("Vorbedingung: das Mandat steht am Call-Datensatz", () => {
        const call = ownCalls(srv)[0];
        assert.ok(call, "kein Call-Datensatz angelegt");
        assert.equal(call.mandate?.decide_freely, MANDAT_SPIELRAUM);
        assert.equal(call.mandate?.fallback_order, MANDAT_REIHENFOLGE);
      });

      await ctx.test(
        "Positiv-Kontrolle: das Anliegen findet der Sucher im Agenten-Material",
        () => {
          assert.ok(
            enthaelt(material, OBJECTIVE),
            `der Sucher findet nicht einmal das Anliegen - Material: ${material}`,
          );
        },
      );

      await ctx.test("die Ermaechtigung erreicht den Agenten im Wortlaut", () => {
        assert.ok(
          enthaelt(material, MANDAT_SPIELRAUM),
          `der Spielraum ("${MANDAT_SPIELRAUM}") erreicht den Agenten NICHT - der Vorlagen-Prompt liest ein leeres {{mandate}} als "KEIN Mandat", der Agent sagt nichts zu und nimmt nur eine Nachricht auf. Material: ${material}`,
        );
      });

      await ctx.test("die Ausweich-Reihenfolge erreicht den Agenten im Wortlaut", () => {
        assert.ok(
          enthaelt(material, MANDAT_REIHENFOLGE),
          `die Ausweich-Reihenfolge ("${MANDAT_REIHENFOLGE}") erreicht den Agenten NICHT - er probiert von sich aus keine Alternative und bricht beim ersten Nein ab. Material: ${material}`,
        );
      });
    },
  );
});

const OWNER_TZ = "Asia/Tokyo";
const CALLEE_NUMBER = "+33612345678";
const CALLEE_TZ = timezoneForCountry(countryForE164(CALLEE_NUMBER));

const DATUMS_SCHREIBWEISEN = Object.freeze([
  ["en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }],
  ["en-US", { year: "numeric", month: "numeric", day: "numeric" }],
  ["en-US", { year: "numeric", month: "long", day: "numeric" }],
  ["en-GB", { year: "numeric", month: "long", day: "numeric" }],
  ["de-DE", { year: "numeric", month: "2-digit", day: "2-digit" }],
]);

const heuteIn = (zone) =>
  DATUMS_SCHREIBWEISEN.map(([locale, form]) =>
    new Intl.DateTimeFormat(locale, { ...form, timeZone: zone }).format(new Date()),
  );

const tenantAusStore = (srv, tenantId) =>
  (srv.readStore().tenants || []).find((tenant) => tenant.id === tenantId);

test("EL-START T7: die Zeitzone des Auftraggebers, die des Angerufenen und das heutige Datum reisen pro Anruf mit", async (ctx) => {
  await withElevenLabs(
    { seed: seedOwner({ timezone: OWNER_TZ }), ownerNumber: TELNYX_TEST_OWNER_NUMBER },
    async ({ srv, mock }) => {
      const res = await placeCall(srv, null, { to: CALLEE_NUMBER });
      const antwort = await res.text();
      assert.equal(
        res.status,
        HTTP_OK,
        `Vorbedingung: der Anruf muss ueberhaupt starten: ${antwort}`,
      );
      assert.equal(mock.startRequests.length, 1, "Vorbedingung: genau EIN Anrufstart am Anbieter");
      const anfrage = mock.startRequests[0];
      const material = agentMaterial(anfrage);

      await ctx.test(
        "Vorbedingung: die Zeitzone des Auftraggebers steht am Tenant, gewaehlt wurde die Auslandsnummer",
        () => {
          assert.equal(tenantAusStore(srv, BOOTSTRAP_TENANT_ID)?.timezone, OWNER_TZ);
          assert.equal(anfrage.body.to_number, CALLEE_NUMBER);
        },
      );

      await ctx.test(
        "Positiv-Kontrolle: das Anliegen findet der Sucher im Agenten-Material",
        () => {
          assert.ok(
            enthaelt(material, OBJECTIVE),
            `der Sucher findet nicht einmal das Anliegen - Material: ${material}`,
          );
        },
      );

      await ctx.test("die Zeitzone des Auftraggebers erreicht den Agenten", () => {
        assert.notEqual(
          OWNER_TZ,
          DEFAULT_TIMEZONE,
          "Wache: waere die Zone des Auftraggebers der Festwert, bewiese ihr Fund nichts",
        );
        assert.ok(
          enthaelt(material, OWNER_TZ),
          `die Zeitzone des Auftraggebers (${OWNER_TZ}, am Tenant gesetzt) erreicht den Agenten NICHT - er terminiert nach dem Festwert der Agenten-Konfiguration (Europe/Berlin), egal wo der Auftraggeber sitzt. Material: ${material}`,
        );
      });

      await ctx.test(
        "die Zeitzone des Angerufenen erreicht den Agenten und ist von der des Auftraggebers unterscheidbar",
        () => {
          assert.notEqual(
            CALLEE_TZ,
            OWNER_TZ,
            "Wache: mit zwei gleichen Zonen misst dieser Fall nichts - er kann dann nicht zeigen, dass BEIDE mitreisen",
          );
          assert.notEqual(
            CALLEE_TZ,
            DEFAULT_TIMEZONE,
            `Wache: die Zone der Gegenstelle ist der Festwert - fuer ${CALLEE_NUMBER} laesst sich kein Land ableiten (countryForE164 -> null, z.B. jede +1-Nummer), timezoneForCountry faellt auf den Default zurueck und der Fund bewiese nichts`,
          );
          assert.ok(
            enthaelt(material, CALLEE_TZ),
            `die Zeitzone des Angerufenen (${CALLEE_TZ}, aus dem Land der gewaehlten Nummer ${CALLEE_NUMBER}) erreicht den Agenten NICHT - er kann eine genannte Uhrzeit nicht in die Zeit des Auftraggebers umrechnen und sagt einen Termin zu, den beide Seiten verschieden verstehen. Material: ${material}`,
          );
        },
      );

      await ctx.test("das heutige Datum erreicht den Agenten", () => {
        const kandidaten = [...heuteIn(OWNER_TZ), ...heuteIn(CALLEE_TZ)];
        assert.ok(
          kandidaten.some((datum) => enthaelt(material, datum)),
          `kein heutiges Datum im Agenten-Material - der Agent verhandelt Termine ohne zu wissen, welcher Tag ist, und kann "naechsten Donnerstag" nicht aufloesen. Gesucht (eine Schreibweise genuegt): ${kandidaten.join(" | ")}. Material: ${material}`,
        );
      });
    },
  );
});

const HYPOTHESE_NUMMER = "+12125550147";
const HYPOTHESE_ZONE = "America/New_York";
const OHNE_ZONE_NUMMER = "+15555550147";

const ANNAHME_MARKER = Object.freeze([
  "assum",
  "likely",
  "probabl",
  "guess",
  "may be wrong",
  "might be wrong",
  "not confirmed",
  "unconfirmed",
  "hypothes",
  "area code",
  "suggest",
]);
const BESTAETIGUNG_MARKER = Object.freeze([
  "confirm",
  "is that right",
  "is that correct",
  "double-check",
  "verify",
  "check that with them",
]);
const VORHER_MARKER = Object.freeze([
  "before you name",
  "before naming",
  "before you give",
  "before you state",
  "before you say",
  "before you agree",
  "before you mention",
  "before you propose",
  "before any",
  "first confirm",
]);
const ZEIT_WORT = Object.freeze(["absolute time", "specific time", "exact time", "clock time"]);
const VERBOT_WORT = Object.freeze(["do not", "don't", "never", "avoid"]);
const GEGENSEITE_MARKER = Object.freeze([
  "let them name",
  "let them say",
  "let them suggest",
  "let them propose",
  "let them tell you",
  "let the other party name",
  "let the other party say",
  "let the other person name",
  "let the other person say",
  "ask them to name",
  "ask them what time",
  "ask them which time",
  "have them name",
  "have them propose",
]);

const FENSTER_ZEICHEN = 500;

function umfelder(material, anker) {
  const heu = material.toLowerCase();
  const nadel = anker.toLowerCase();
  const treffer = [];
  for (let i = heu.indexOf(nadel); i !== -1; i = heu.indexOf(nadel, i + nadel.length))
    treffer.push(
      material.slice(Math.max(0, i - FENSTER_ZEICHEN), i + nadel.length + FENSTER_ZEICHEN),
    );
  return treffer;
}

const enthaeltEines = (text, marker) => marker.some((wort) => enthaelt(text, wort));
const hypotheseUmfelder = (material) => umfelder(material, HYPOTHESE_ZONE);

async function usLauf(nummer) {
  return withElevenLabs(
    { seed: seedOwner({ timezone: OWNER_TZ }), ownerNumber: TELNYX_TEST_OWNER_NUMBER },
    async ({ srv, mock }) => {
      const res = await placeCall(srv, null, { to: nummer });
      const antwort = await res.text();
      assert.equal(res.status, HTTP_OK, `Vorbedingung: der Anruf muss starten: ${antwort}`);
      assert.equal(mock.startRequests.length, 1, "Vorbedingung: genau EIN Anrufstart am Anbieter");
      const anfrage = mock.startRequests[0];
      assert.equal(anfrage.body.to_number, nummer, "Vorbedingung: gewaehlt wurde die US-Nummer");
      return materialMitVorlage(anfrage);
    },
  );
}

test("EL-START T8: die aus der Vorwahl abgeleitete Zone des Angerufenen reist als bestaetigungspflichtige Hypothese", async (ctx) => {
  const material = await usLauf(HYPOTHESE_NUMMER);

  await ctx.test("Positiv-Kontrolle: das Anliegen findet der Sucher im Agenten-Material", () => {
    assert.ok(
      enthaelt(material, OBJECTIVE),
      `der Sucher findet nicht einmal das Anliegen - Material: ${material}`,
    );
  });

  await ctx.test("Wache: ein Fund der Hypothese kann nur aus der Vorwahl stammen", () => {
    assert.notEqual(
      HYPOTHESE_ZONE,
      DEFAULT_TIMEZONE,
      "Wache: waere die Hypothese der Festwert, bewiese ihr Fund nichts",
    );
    assert.notEqual(
      HYPOTHESE_ZONE,
      OWNER_TZ,
      "Wache: waere die Hypothese die Zone des Auftraggebers, koennte der Fund aus owner_timezone stammen",
    );
    assert.equal(
      countryForE164(HYPOTHESE_NUMMER),
      null,
      `Wache: fuer ${HYPOTHESE_NUMMER} liefert die Land-Ableitung bewusst nichts (+1, Owner-Entscheidung E2) - die Zone kann nur ueber die Vorwahl entstehen, nicht ueber den Weg, den T7 pinnt`,
    );
  });

  await ctx.test("die Hypothese erreicht den Agenten", () => {
    assert.ok(
      hypotheseUmfelder(material).length > 0,
      `die aus der Vorwahl 212 abgeleitete Zone (${HYPOTHESE_ZONE}) erreicht den Agenten NICHT - er verhandelt mit einem Anrufer in New York, ohne dessen Zone auch nur zu vermuten, und der Auftraggeber erfaehrt die Verwechslung erst, wenn er vor verschlossener Tuer steht. Material: ${material}`,
    );
  });

  await ctx.test("sie ist sprachlich als ANNAHME gefuehrt, nicht als feststehende Zone", () => {
    assert.ok(
      hypotheseUmfelder(material).some((umfeld) => enthaeltEines(umfeld, ANNAHME_MARKER)),
      `${HYPOTHESE_ZONE} steht als Tatsache im Material - eine Vorwahl-Tabelle stimmt meistens, aber nicht immer (Staaten ueber Zonengrenzen, Arizona ohne Sommerzeit), und "meistens richtig" heisst bei Terminen: still falsche Uhrzeiten. Erwartet wird ein Wort, das den Wert als Annahme kennzeichnet - eines von: ${ANNAHME_MARKER.join(" | ")}. Material: ${material}`,
    );
  });

  await ctx.test(
    "der Agent soll sie in EINEM Satz bestaetigen, BEVOR er eine absolute Uhrzeit nennt",
    () => {
      const umfelderMitZone = hypotheseUmfelder(material);
      assert.ok(
        umfelderMitZone.some((umfeld) => enthaeltEines(umfeld, BESTAETIGUNG_MARKER)),
        `neben der Hypothese steht keine Aufforderung, sie im Gespraech zu bestaetigen - der Angerufene weiss seine Zone, das ist die verlaesslichste Quelle, die es gibt, und es kostet eine Sekunde. Erwartet: eines von ${BESTAETIGUNG_MARKER.join(" | ")}. Material: ${material}`,
      );
      assert.ok(
        umfelderMitZone.some((umfeld) => enthaeltEines(umfeld, VORHER_MARKER)),
        `die Bestaetigung ist nicht VOR die erste absolute Uhrzeit gestellt - bestaetigt der Agent erst hinterher, hat er den Termin bereits in der geratenen Zone zugesagt. Erwartet: eines von ${VORHER_MARKER.join(" | ")}. Material: ${material}`,
      );
    },
  );
});

test("EL-START T8 (Fallback): steht keine Zone fest, nennt der Agent gar keine absolute Uhrzeit", async (ctx) => {
  const material = await usLauf(OHNE_ZONE_NUMMER);

  await ctx.test("Positiv-Kontrolle: das Anliegen findet der Sucher im Agenten-Material", () => {
    assert.ok(
      enthaelt(material, OBJECTIVE),
      `der Sucher findet nicht einmal das Anliegen - Material: ${material}`,
    );
  });

  await ctx.test(
    "Wache: fuer diese Nummer steht keine Zone fest - und es wird auch keine behauptet",
    () => {
      assert.equal(
        countryForE164(OHNE_ZONE_NUMMER),
        null,
        `Wache: ${OHNE_ZONE_NUMMER} muss unableitbar bleiben, sonst misst dieser Fall den Fallback nicht`,
      );
      assert.equal(
        hypotheseUmfelder(material).length,
        0,
        `fuer eine Nummer ohne feststellbare Zone steht ${HYPOTHESE_ZONE} im Material - entweder ist der Bezeichner statisch in die Vorlage getippt (dann ist die Hypothese oben keine), oder es wurde eine Zone erfunden. Material: ${material}`,
      );
    },
  );

  await ctx.test("das Material verbietet die absolute Uhrzeit", () => {
    const umfelderAmZeitwort = ZEIT_WORT.flatMap((wort) => umfelder(material, wort));
    assert.ok(
      umfelderAmZeitwort.some((umfeld) => enthaeltEines(umfeld, VERBOT_WORT)),
      `ohne feststehende Zone fehlt dem Agenten das Verbot, eine absolute Uhrzeit zu nennen - der statische Satz der Vorlage verbietet nur das STILLE Umrechnen und laesst ihm die Uhrzeit. Erwartet: eines von ${ZEIT_WORT.join(" | ")} zusammen mit einem von ${VERBOT_WORT.join(" | ")}. Material: ${material}`,
    );
  });

  await ctx.test("stattdessen nennt die Gegenseite die Uhrzeit", () => {
    assert.ok(
      enthaeltEines(material, GEGENSEITE_MARKER),
      `dem Agenten fehlt die Anweisung, unbestimmt zu sprechen ("tomorrow morning") und die Gegenseite die Uhrzeit nennen zu lassen - ein Verbot ohne Ersatz laesst ihn im Gespraech steckenbleiben, statt lieber unbestimmt als falsch zu sein. Erwartet: eines von ${GEGENSEITE_MARKER.join(" | ")}. Material: ${material}`,
    );
  });
});

const BRIEFING_KERN =
  "Petra schneidet ihm seit Jahren die Haare, bezahlt wird immer bar, und er kommt lieber vormittags.";
const BRIEFING = `Aus dem bisherigen Chat: ${BRIEFING_KERN}`;

test("EL-START T9: das Briefing des Auftraggebers erreicht den Agenten des Anbieters", async (ctx) => {
  await withElevenLabs(
    { seed: seedOwner(), ownerNumber: TELNYX_TEST_OWNER_NUMBER },
    async ({ srv, mock }) => {
      const res = await placeCall(srv, null, { briefing: BRIEFING });
      const antwort = await res.text();
      assert.equal(res.status, HTTP_OK, `Vorbedingung: der Anruf muss starten: ${antwort}`);
      assert.equal(mock.startRequests.length, 1, "Vorbedingung: genau EIN Anrufstart am Anbieter");
      const material = materialMitVorlage(mock.startRequests[0]);

      await ctx.test("Vorbedingung: das Briefing steht am Call-Datensatz", () => {
        const call = ownCalls(srv)[0];
        assert.ok(call, "kein Call-Datensatz angelegt");
        assert.equal(call.briefing, BRIEFING, "das Briefing kommt nicht einmal am Record an");
      });

      await ctx.test(
        "Positiv-Kontrolle: das Anliegen findet der Sucher im Agenten-Material",
        () => {
          assert.ok(
            enthaelt(material, OBJECTIVE),
            `der Sucher findet nicht einmal das Anliegen - Material: ${material}`,
          );
        },
      );

      await ctx.test("der Wortlaut des Briefings erreicht den Agenten", () => {
        assert.ok(
          enthaelt(material, BRIEFING_KERN),
          `das Briefing ("${BRIEFING_KERN}") erreicht den Agenten NICHT - weder als dynamische Variable noch ueber den gerenderten Vorlagen-Prompt. Es steht am Call-Datensatz und wird von diesem Weg nie gelesen: der Agent fuehrt das Gespraech ohne den Hintergrund, den der Auftraggeber ihm ausdruecklich mitgegeben hat. Material: ${material}`,
        );
      });
    },
  );
});

const LISTENSTRICH = /^-\s+/;
const buchungsgrenze = (baustein) => baustein.replace(LISTENSTRICH, "");
const BUCHUNG_OHNE_MANDAT = buchungsgrenze(EN_PROMPT.boundaries.noBooking);
const BUCHUNG_MIT_MANDAT = buchungsgrenze(EN_PROMPT.boundaries.noBookingWithMandate);
const WEICHE_SPIELRAUM = "Termin an jedem Werktag zwischen 14 und 17 Uhr, bis 80 Euro";

test("EL-START T10: die Buchungs-Grenze des Agenten folgt dem Mandat DIESES Anrufs", async (ctx) => {
  await ctx.test("Wache: die beiden Bausteine sind gegeneinander unterscheidbar", () => {
    assert.notEqual(
      BUCHUNG_MIT_MANDAT,
      BUCHUNG_OHNE_MANDAT,
      "Wache: der Bestand fuehrt zwei verschiedene Buchungs-Grenzen (src/claude.js:210) - sind sie gleich geworden, gibt es keine Weiche mehr zu stellen",
    );
    assert.ok(
      !enthaelt(BUCHUNG_MIT_MANDAT, BUCHUNG_OHNE_MANDAT) &&
        !enthaelt(BUCHUNG_OHNE_MANDAT, BUCHUNG_MIT_MANDAT),
      "Wache: keiner der beiden Saetze darf den anderen enthalten, sonst bestuende ein einziger statischer Text beide Laeufe",
    );
  });

  await ctx.test(
    "ohne Mandat: die OHNE-Mandat-Grenze erreicht den Agenten, die MIT-Variante nicht",
    async () => {
      const { material } = await vorrangLauf({});
      assert.ok(
        enthaelt(material, OBJECTIVE),
        `Positiv-Kontrolle: der Sucher findet nicht einmal das Anliegen - Material: ${material}`,
      );
      assert.ok(
        enthaelt(material, BUCHUNG_OHNE_MANDAT),
        `ohne Mandat fehlt dem Agenten die Buchungs-Grenze des Bestands ("${BUCHUNG_OHNE_MANDAT}") - was er stattdessen liest, ist ein statischer Vorlagen-Satz, der pro Anruf nicht wechseln kann. Material: ${material}`,
      );
      assert.ok(
        !enthaelt(material, BUCHUNG_MIT_MANDAT),
        `der Agent bekommt ohne jedes Mandat die MIT-Mandat-Grenze zugesagt ("was dein Spielraum deckt, sagst du selbst zu") - er sagt dann etwas verbindlich zu, wozu ihn niemand ermaechtigt hat. Material: ${material}`,
      );
    },
  );

  await ctx.test(
    "mit decide_freely: die MIT-Mandat-Grenze erreicht den Agenten, die OHNE-Variante nicht",
    async () => {
      const { variablen, material } = await vorrangLauf({
        mandate: { decide_freely: WEICHE_SPIELRAUM },
      });
      assert.ok(
        enthaelt(variablen.mandate, WEICHE_SPIELRAUM),
        `Vorbedingung: der Spielraum reist nicht einmal als Wert mit - {{mandate}}=${JSON.stringify(variablen.mandate)}`,
      );
      assert.ok(
        enthaelt(material, BUCHUNG_MIT_MANDAT),
        `der Auftraggeber hat den Agenten ausdruecklich entscheiden lassen ("${WEICHE_SPIELRAUM}"), aber die Buchungs-Grenze wechselt nicht mit ("${BUCHUNG_MIT_MANDAT}") - der Agent liest sein Mandat und daneben die Anweisung, trotzdem nur eine Nachricht aufzunehmen. Material: ${material}`,
      );
      assert.ok(
        !enthaelt(material, BUCHUNG_OHNE_MANDAT),
        `neben dem Mandat steht weiterhin die OHNE-Mandat-Grenze - zwei Saetze, die einander widersprechen, und welcher gewinnt, entscheidet der Anruf. Material: ${material}`,
      );
    },
  );
});


const SHA256_HEX_LAENGE = 64;

test("EL-START T11 (Thema A): opening_line reist geprueft an den Anbieter UND liegt mit Annahme-Hash am Datensatz", async () => {
  await withElevenLabs(
    { env: MULTI, seed: seedTenantA({ defaultLanguage: "de" }) },
    async ({ srv, mock }) => {
      const res = await placeCall(srv, SUBJECT_A);
      assert.equal(res.status, HTTP_OK, `Vorbedingung: der Anruf startet: ${await res.text()}`);
      assert.equal(mock.startRequests.length, 1, "genau ein Anrufstart");

      const erwartet = `Es geht um Folgendes: ${OBJECTIVE}. ${LOCALES.de.openingQuestion}`;
      const variablen = dynamicVariables(mock.startRequests[0]);
      assert.equal(variablen.opening_line, erwartet);

      const call = ownCalls(srv)[0];
      assert.ok(call, "der Call-Datensatz existiert");
      assert.equal(call.openingLine, erwartet);
      assert.ok(
        call.openingLine.endsWith("?"),
        "komponiert wird VOR dem Hashen (R6): der gespeicherte Wert traegt die Frage bereits",
      );
      assert.equal(typeof call.openingLineSha256, "string");
      assert.equal(call.openingLineSha256.length, SHA256_HEX_LAENGE);
    },
  );
});

