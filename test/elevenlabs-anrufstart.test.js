// Der ElevenLabs-Anrufstart: Vertrag VOR dem Bau, gegen eine ATTRAPPE des Anbieters.
//
// ABSICHTLICH ROT. src/routes/api-calls.js kennt heute genau zwei Zweige (TeXML und
// Telnyx-Call-Control); einen ElevenLabs-Anrufstart gibt es nicht. Deshalb hat der
// Mutator recordElevenlabsConversationId (src/store/state-ops.js) bis heute KEINEN
// Aufrufer und der bereits gebaute Rueckfrage-Webhook POST /webhooks/elevenlabs/consult
// ist funktional tot (er bindet ueber call.elevenlabsConversationId, das nie gesetzt
// wird). Diese Datei schreibt den Vertrag fest, damit der Zweig nicht "erstmal ohne
// Sicherungen" entsteht. Der Bau-Agent baut gegen genau diese Faelle.
//
// KEIN NETZ, KEIN ECHTER ANRUF: der Anbieter ist ein lokaler http-Server (Attrappe), auf
// den ELEVENLABS_API_BASE zeigt. Spawn ueber die ECHTE HTTP-Route (Muster
// test/telnyx-p5-gate-proof.test.js) statt per Funktionsaufruf: ein Gate, das nur in der
// Funktion sitzt, aber nicht an der Route haengt, wuerde sonst gruen messen.
//
// DER VERTRAG, den diese Datei festnagelt
// ---------------------------------------
//   Zweig-Schalter  ELEVENLABS_OUTBOUND_ENABLED (Default AUS, fail-closed - Muster
//                   TELNYX_AI_ASSISTANT_ENABLED). Der Provider des Anrufs bleibt telnyx
//                   (die DID liegt bei Telnyx, ElevenLabs haengt per SIP-Trunk daran).
//   Anrufstart      POST {ELEVENLABS_API_BASE}/v1/convai/sip-trunk/outbound-call
//                   Header  xi-api-key: {ELEVENLABS_API_KEY}
//                   Rumpf   { agent_id, agent_phone_number_id, to_number,
//                             conversation_initiation_client_data: { dynamic_variables:
//                             { owner_name, objective, ... } } }
//                   Antwort { conversation_id } SYNCHRON
//                   Feldnamen und Variablen-Vokabular stammen NICHT aus diesem Test,
//                   sondern aus elevenlabs/agent_configs/outbound-agent.template.json
//                   (_spaeter_beim_place_call_umbau) und der Anbieter-Doku.
//   Kennung         die zurueckgegebene conversation_id wird ueber
//                   recordElevenlabsConversationId am Call persistiert
//                   (call.elevenlabsConversationId - dasselbe Feld, ueber das der
//                   Consult-Webhook bindet; es ist das einzige Produkt dieses Mutators).
//   Ergebnis        GET {ELEVENLABS_API_BASE}/v1/convai/conversations/{conversation_id}
//                   -> { status, transcript, analysis.transcript_summary }; Abholtakt
//                   ELEVENLABS_RESULT_POLL_MS. Ein zusaetzlicher Post-Call-Webhook
//                   widerspricht dem nicht - er muesste denselben Store-Zustand erzeugen.
//   Konfiguration   ELEVENLABS_AGENT_ID, ELEVENLABS_AGENT_PHONE_NUMBER_ID,
//                   ELEVENLABS_API_KEY, ELEVENLABS_API_BASE (die letzten beiden gibt es
//                   bereits - EIN Konto, EIN Schluessel, EINE Basis; kein zweiter Satz).
//
// WARUM JEDER GATE-FALL EINE POSITIV-KONTROLLE TRAEGT (T2)
// --------------------------------------------------------
// Ein Gate-Test gegen einen Zweig, den es nicht gibt, ist gruen - und sagt nichts
// ("ein Gate, das alles ablehnt, besteht jeden Negativ-Test", CLAUDE.md Regel 1,
// Lehre pruefkommando-ohne-positiv-kontrolle). Jeder T2-Fall faehrt deshalb ZWEI Laeufe
// mit demselben Seed, unterschieden durch GENAU EINE Achse: scharf -> Ablehnung UND die
// Attrappe sieht keinen einzigen Anrufstart; entschaerft -> 200 UND genau ein Anrufstart.
// Die zweite Haelfte ist heute rot und ist es, die die erste bindend macht.
//
// ENV: die fuenf neuen Variablen stehen NICHT in BASE_ENV (test/helpers.js) - dieselbe
// Lage wie bei ELEVENLABS_TOOL_TOKEN (test/elevenlabs-consult-webhook-guards.test.js:46):
// das Aufraeum-Gate des pre-commit-Hooks lehnt helpers.js ab, solange die Datei
// Eintraege in eslint-suppressions.json traegt, und dieser Umbau gehoert nicht in einen
// Test-Commit. Ersatzdeckung: JEDER startServer-Aufruf dieser Datei setzt alle fuenf
// explizit (dotenv fuellt nur UNgesetzte Variablen). OFFEN fuer den Bau-Schritt: die
// BASE_ENV-Zeilen nachziehen, sobald helpers.js aufgeraeumt ist - sonst leakt ein echter
// Schluessel in jeden anderen Spawn-Test (Lehre test-base-env-drift).
//
// Testnamen tragen bewusst KEINE Katalog-/Abnahme-Kennung am Namensanfang (package.json
// config.i18nCatalogPattern / config.abnahmePattern), sonst landen sie in der falschen
// Bank (Lehre catalog-id-prefix-misroutes-tests). Sie gehoeren in den Regressionslauf:
// ist der Zweig gebaut, ist jedes Rotwerden hier eine Regression.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import test from "node:test";

import { timezoneForCountry } from "../src/geo/resolve.js";
import { DISCLOSURE_OWNER_FALLBACK_EN, LOCALES } from "../src/i18n/locales.js";
import {
  BOOTSTRAP_TENANT_ID,
  DEFAULT_TIMEZONE,
  countryForE164,
} from "../src/store/defaults.js";
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

// ---- Statuscodes benannt statt nackt (Repo-Regel: keine Magic Numbers) --------------
const HTTP_OK = 200;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;

// ---- Anbieter-Oberflaeche (s. Vertrag oben) -----------------------------------------
const START_PATH = "/v1/convai/sip-trunk/outbound-call";
const CONVERSATION_PATH = "/v1/convai/conversations/";
const API_KEY_HEADER = "xi-api-key";

// ---- Testwerte -----------------------------------------------------------------------
const AGENT_ID = "agent_el_test_1";
const AGENT_PHONE_NUMBER_ID = "phnum_el_test_1";
const API_KEY = "el-api-key-testgeheim";
const CONVERSATION_ID = "conv_el_start_1";
const OBJECTIVE = "Termin am Donnerstag vereinbaren (EL-START)";
const OWNER_NAME = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;
const TENANT_A = "tenant-a";
const SUBJECT_A = "sub-a";
const NUMBER_A = "+4915005559002";

// Ergebnis-Rohstoff der Attrappe. Die Zusammenfassung kommt VOM ANBIETER - sie muss
// unveraendert bis in get_transcript durchkommen (T3). Die Transkript-Zeile ist der
// Gegen-Marker: sie darf NIE nach aussen (Datensparsamkeit, Absolute Regel 5).
const PROVIDER_SUMMARY = "Termin am Donnerstag um 10 Uhr wurde zugesagt.";
const TRANSCRIPT_LINE = "Donnerstag um zehn passt uns gut.";
// KS-EL1: die Ist-Dauer des Anbieters (metadata.call_duration_secs) - OHNE sie zieht
// finishFromConversation (elevenlabs/outbound.js) den Buchungsanker NICHT nach (der Wert
// gilt dann als fehlend/unbrauchbar), answeredAt faellt auf null, und T3s Buchungs-Achse
// unten misst 0 statt eines echten Anrufs.
const PROVIDER_CALL_DURATION_SECS = 65;
const FINISHED_CONVERSATION = Object.freeze({
  status: "done",
  transcript: [
    { role: "agent", message: "Guten Tag, ich rufe wegen eines Termins an." },
    { role: "user", message: TRANSCRIPT_LINE },
  ],
  analysis: { transcript_summary: PROVIDER_SUMMARY, call_successful: "success" },
  metadata: { call_duration_secs: PROVIDER_CALL_DURATION_SECS },
});

// Marker im Fehler-Rumpf der Attrappe: taucht er in der Antwort an den Aufrufer auf, ist
// eine rohe Anbieter-Meldung durchgereicht worden (Absolute Regel 4/5).
const PROVIDER_ERROR_MARKER = "detail-aus-dem-anbieter-rumpf";

// Abholtakt klein, damit T3 in Sekunden aufloest statt in einem Produktions-Takt.
const RESULT_POLL_MS = "150";
const RESULT_WAIT_MS = 8000;
// OUT-05: Reserve muss > 0 sein, sonst ist ihre Freigabe im Fehlerpfad ein No-op und der
// Fall T4 misst nichts (Muster test/telnyx-p5-origination.test.js).
const DOMESTIC_TARIFF_CENTS = "20";
// T4 (a): der gescheiterte Anrufstart plus der danach gelungene.
const STARTS_NACH_ERHOLUNG = 2;

// Die fuenf Variablen des neuen Zweigs. ELEVENLABS_API_BASE kommt pro Server dazu (es
// zeigt auf die jeweils frisch gestartete Attrappe).
const EL_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: AGENT_ID,
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: AGENT_PHONE_NUMBER_ID,
  ELEVENLABS_API_KEY: API_KEY,
  ELEVENLABS_RESULT_POLL_MS: RESULT_POLL_MS,
});

// ---- Attrappe des Anbieters ----------------------------------------------------------

function endJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

// Der Auftrag reist als dynamische Variable (Vorlage: dynamic_variables unter
// conversation_initiation_client_data). EIN Zugriffspfad fuer alle Faelle - und er haelt
// die Aufrufkette flach (G36).
const dynamicVariables = (anfrage) =>
  anfrage.body.conversation_initiation_client_data?.dynamic_variables ?? {};

// Ein http-Server, der GENAU die zwei Endpunkte des Vertrags bedient und jeden Aufruf
// mitschreibt. Das Verhalten des Anrufstarts ist zur Laufzeit umschaltbar (T4: erst
// Ausfall, dann heil - so laesst sich am SELBEN Server pruefen, dass der Fehlschlag den
// Tenant nicht blockiert). Alles andere antwortet 404, damit ein Aufruf am falschen Pfad
// auffaellt statt still zu gelingen.
async function startElevenLabsMock() {
  const startRequests = [];
  const resultRequests = [];
  const mode = { startStatus: HTTP_OK, abbruch: false };

  const handleStart = (req, res, raw) => {
    startRequests.push({ headers: req.headers, raw, body: JSON.parse(raw || "{}") });
    // Verbindungsabbruch OHNE jede HTTP-Antwort (Muster endPremature in
    // test/_outbound-harness.js): der Ausfall-Fall, den ein Aufruf trotzdem ERREICHT -
    // und genau deshalb beobachtbar macht.
    if (mode.abbruch) return res.socket.destroy();
    if (mode.startStatus !== HTTP_OK)
      return endJson(res, mode.startStatus, { detail: PROVIDER_ERROR_MARKER });
    return endJson(res, HTTP_OK, {
      success: true,
      conversation_id: CONVERSATION_ID,
      sip_call_id: "sip_el_test_1",
    });
  };

  const handleResult = (req, res) => {
    resultRequests.push({ url: req.url });
    return endJson(res, HTTP_OK, { conversation_id: CONVERSATION_ID, ...FINISHED_CONVERSATION });
  };

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (req.url.startsWith(START_PATH)) return handleStart(req, res, raw);
      if (req.url.startsWith(CONVERSATION_PATH)) return handleResult(req, res);
      return endJson(res, HTTP_NOT_FOUND, { detail: "unbekannter Pfad" });
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

// ---- Seeds ---------------------------------------------------------------------------
// Bewusst LOKAL statt aus test/telnyx-p5-gate-proof.test.js gezogen: die dortigen Bauer
// sind dateiprivat und an die Telnyx-Flag-Matrix gebunden. Sie dort herauszuloesen waere
// ein Umbau an einem gruenen Regressionstest - nicht die Aufgabe dieser roten Pruefung.
// Der Zuschnitt (Felder, Reihenfolge) folgt ihnen unveraendert.

function seedOwner(tenantOverrides = {}) {
  return seedState({
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ...tenantOverrides }],
  });
}

// Tenant A mit eigener aktiver Telnyx-Nummer. Per Default passiert er JEDES Gate (am
// laufenden Server nachgemessen); jeder Fall senkt genau eine Achse ab. Fehlende Werte
// werden WEGGELASSEN statt auf null gesetzt - die fail-closed-Praedikate lesen "fehlend".
function seedTenantA({ kycLevel = "card", ownerName = "Alice A", status = "active" } = {}) {
  return seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      {
        id: TENANT_A,
        status,
        idpSubject: SUBJECT_A,
        ...(ownerName ? { ownerName } : {}),
        ...(kycLevel ? { kycLevel } : {}),
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

// Verbrauch oberhalb der wirksamen Decke: MAX_BUDGET_EUR ist in Spawn-Tests 30 (BASE_ENV)
// und wirkt als pro-Tenant-Fallback (effectiveCapCents Stufe 3).
const SPEND_OVER_CAP_EUR = 99;
const SPEND_NONE_EUR = 0;

// Tenant A mit gesetzter Verbrauchs-Achse (Kostendecke-Faelle).
function seedTenantAWithSpend(costEur) {
  const seed = seedTenantA();
  seed.usage = { [BOOTSTRAP_TENANT_ID]: usageBucket(0), [TENANT_A]: usageBucket(costEur) };
  return seed;
}

// ---- Lauf-Harness --------------------------------------------------------------------

// Startet Attrappe + Server, fuehrt run({srv, mock}) und raeumt beides ab. Der env-Block
// des Aufrufers steht ZULETZT: so kann T4 (b) die Basis gezielt auf einen toten Port
// umlenken, ohne dass eine zweite Harness noetig waere.
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

// auftrag = die optionalen Auftrags-Felder von place_call (constraints, context, ...).
// Leer gelassen ist der Rumpf byte-identisch zu vorher - T1-T5 messen unveraendert.
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

// Nur die Datensaetze DIESES Requests (das Anliegen ist der Marker) - manche Seeds
// tragen bereits andere Calls.
const ownCalls = (srv) => srv.readStore().calls.filter((call) => call.goal === OBJECTIVE);

// ---- T2: die Gate-Faelle als Paare ---------------------------------------------------
// Jeder Fall nennt beide Laeufe vollstaendig (kein Boolean-Selektor, F3/G15) und
// unterscheidet sie in GENAU EINER Achse. Die Fehlertexte sind am laufenden Server
// abgelesen, nicht geraten.
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

// Der fuenfte Fall gehoert fachlich zu T5 (ohne Auftraggeber-Namen ist der
// Offenlegungssatz nicht vollstaendig sprechbar), laeuft aber ueber dieselben zwei
// Helfer - eine zweite Formulierung waere eine zweite, schwaechere Wahrheit.
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

// ---- T1: der Anrufstart selbst -------------------------------------------------------

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

      // Die zweite Variable, die den Auftrag ausmacht: WEN der Agent anruft. Im
      // Vorlagen-Prompt traegt sie den Satz "You are calling {{callee}} right now." -
      // faellt der Wert aus, sagt der Prompt dem Agenten nicht mehr, mit wem er spricht,
      // waehrend to_number davon unberuehrt weitergewaehlt wird: die Luecke bliebe still.
      // Gemessen wird gegen dasselbe normalisierte Ziel wie oben - benannt == gewaehlt.
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

// ---- ROTPROBE 1 (Owner-Auftrag 15.08.2026, Aufgabe 1): FAKE_ORIGINATE_ELEVENLABS ------
// Gegenstueck zu FAKE_ORIGINATE (telephony/registry.js) fuer den EL-Anrufstart. T1 oben ist
// bereits die Positiv-Kontrolle "ohne den Schalter erreicht der Anrufstart den Anbieter
// wirklich" (mock.startRequests.length === 1) - dieser Fall misst die andere Haelfte: MIT
// dem Schalter erreicht der Anrufstart den Anbieter NIE, es entsteht trotzdem ein
// vollstaendiger Call-Datensatz mit einer Kennung in der Anbieter-Form
// (SIPTrunkOutboundCallResponse), erfundene Werte am fake_el_-Praefix erkennbar.
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

      await ctx.test("KEIN Netzzugriff gegen den Anbieter (POST /v1/convai/sip-trunk/outbound-call)", () => {
        assert.equal(
          mock.startRequests.length,
          0,
          "der Anrufstart darf den Anbieter mit gesetztem Schalter NIE erreichen",
        );
      });

      await ctx.test("die Kennung traegt die Anbieter-Form (SIPTrunkOutboundCallResponse), erfundene Werte klar markiert", () => {
        const call = ownCalls(srv)[0];
        assert.ok(call, "kein Call-Datensatz angelegt");
        assert.match(
          call.elevenlabsConversationId,
          /^fake_el_[0-9a-f]{16}$/,
          `fake_el_-Praefix fehlt: ${call.elevenlabsConversationId}`,
        );
      });
    },
  );
});

// ---- T2: dieselben Gates wie der Telnyx-Zweig ---------------------------------------

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

// ---- T3: das Ergebnis wird geholt ----------------------------------------------------

test("EL-START T3: beendetes Anbieter-Gespraech -> Transkript und Zusammenfassung so im Store, dass get_transcript sie liefert", async (ctx) => {
  await withElevenLabs(
    {
      // Der Minutensatz steht hier EXPLIZIT, weil BASE_ENV (test/helpers.js) ihn fuer die
      // ganze Suite auf 0 setzt: ohne diese Zeile buchte auch ein vollstaendig heiler
      // Weg 0 Cent, und der Buchungs-Fall unten waere rot ohne Aussage - er maesse die
      // Test-Umgebung statt des Zweigs (Lehre gate-triage-red-test-is-a-claim). Derselbe
      // Satz und derselbe Grund wie in T4 (a/b).
      env: { VOICE_TARIFF_DOMESTIC_CENTS: DOMESTIC_TARIFF_CENTS },
      seed: seedOwner(),
      ownerNumber: TELNYX_TEST_OWNER_NUMBER,
    },
    async ({ srv, mock }) => {
      const res = await placeCall(srv);
      assert.equal(res.status, HTTP_OK, "Vorbedingung: der Anruf muss ueberhaupt starten");
      const { callId } = await res.json();

      // Das Ergebnis kommt NICHT synchron - gewartet wird auf den Store-Zustand, nicht
      // auf einen Takt (Muster waitForStoreState).
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

      // Die beiden Bedingungen, die get_transcript stellt (src/mcp-tools.js): Status
      // verlaesst "active", und der Datensatz traegt ein transcript-Array (requireFields).
      await ctx.test("Bedingung 1: der Call verlaesst 'active'", () => {
        assert.notEqual(call.status, "active");
      });
      await ctx.test("Bedingung 2: transcript ist ein Array", () => {
        assert.ok(Array.isArray(call.transcript), `transcript=${JSON.stringify(call.transcript)}`);
      });
      await ctx.test("die Zusammenfassung des Anbieters steht am Call", () => {
        assert.equal(call.summary, PROVIDER_SUMMARY);
      });

      await ctx.test("get_transcript liefert sie - und NICHT das Roh-Transkript", async () => {
        const antwort = await mcpPost(
          `${srv.localUrl}/mcp`,
          null,
          toolCall("get_transcript", { call_id: callId }),
        );
        const ergebnis = await readToolResult(antwort);
        const text = ergebnis.content[0].text;
        assert.ok(
          text.includes(PROVIDER_SUMMARY),
          `Zusammenfassung fehlt in get_transcript: ${text}`,
        );
        assert.ok(
          !text.includes(TRANSCRIPT_LINE),
          "das Roh-Transkript darf NIE nach aussen (Datensparsamkeit)",
        );
      });

      // ---- der ERFOLGSPFAD und die Kosten-/Verbrauchsachse ----------------------------
      // Gepinnt war die Buchung bisher nur im FEHLER-Fall (T4 a/b: die Reserve wird wieder
      // frei). Dass ein GELUNGENER Anruf ueberhaupt Geld auf die Achse legt, hielt kein
      // Fall fest - und genau diese Achse ist ein Gate: die pro-Tenant-Kostendecke
      // (Absolute Regel 1) liest usage[tenantId].costCents (budgetExceeded). Bucht dieser
      // Weg nicht, laeuft er an der Decke vorbei: beliebig viele Anrufe, und der Zaehler
      // steht still - der Ausfall ist unsichtbar, weil jeder einzelne Anruf gelingt.
      //
      // Gemessen wird die Achse, die der Bestand misst (test/kv-p2-inbound-budget.test.js:
      // usage[BOOTSTRAP_TENANT_ID].costCents aus dem Store), nicht ein Log oder ein
      // Zwischenwert. Gewartet wird auf den persistierten Abrechnungs-Marker und NICHT auf
      // den Status: die Buchungskette laeuft fire-and-forget NACH dem Ende
      // (terminateAndBillCall, bill wird nicht awaited), der Status ist also schon terminal,
      // waehrend die Buchung noch aussteht. markBilled sitzt im selben Block direkt HINTER
      // der Buchung (call-finish.js) - steht der Marker, ist gebucht oder es gab nichts.
      const nachBuchung = await waitForStoreState(
        srv,
        (state) => state.calls.some((eintrag) => eintrag.id === callId && eintrag.billedAt),
        RESULT_WAIT_MS,
      );

      // Ohne diese Haelfte waere ein roter Befund unten dreideutig: "nichts gebucht" saehe
      // genauso aus wie "die Buchungskette lief nie" und wie "dieses Leg ist mit 0 bepreist"
      // (Lehre pruefkommando-ohne-positiv-kontrolle). Beide Wachen trennen das ab - die
      // Reserve ist derselbe Minutensatz dieses Legs (tariffCentsPerMin(to, from) x
      // Vorlauffenster, outboundReserveCents), nur vor dem Waehlen statt danach.
      await ctx.test("Positiv-Kontrolle: die Buchungskette ist gelaufen, und dieses Leg ist bepreist", () => {
        const abgerechnet = nachBuchung.calls.find((eintrag) => eintrag.id === callId);
        assert.ok(
          abgerechnet.billedAt,
          "der Erfolgspfad erreicht den EINEN Beender (terminateAndBillCall) gar nicht erst",
        );
        assert.ok(
          abgerechnet.reserveCents > 0,
          `Wache: der Minutensatz dieses Legs ist 0 (reserveCents=${JSON.stringify(abgerechnet.reserveCents)}) - dann bucht auch ein heiler Weg 0, und der Fall unten maesse die Test-Umgebung statt des Zweigs`,
        );
      });

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

// ---- T4: der Anbieter faellt aus -----------------------------------------------------

test("EL-START T4 (a): Anbieter antwortet mit Fehler -> sauberes Ende, Reserve frei, Tenant nicht blockiert", async (ctx) => {
  await withElevenLabs(
    {
      env: { VOICE_TARIFF_DOMESTIC_CENTS: DOMESTIC_TARIFF_CENTS },
      seed: seedOwner(),
      ownerNumber: TELNYX_TEST_OWNER_NUMBER,
    },
    async ({ srv, mock }) => {
      mock.breakStart(HTTP_SERVER_ERROR);
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

      // Beides sind die Achsen, ueber die ein Fehlschlag einen Tenant blockieren WUERDE:
      // ein Zombie im Status "active" haelt Stunden-/Ziel-Fenster besetzt, eine nicht
      // freigegebene Reserve haelt sein Geld fest.
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

// Der zweite Ausfall-Fall ist bewusst der VERBINDUNGSABBRUCH und NICHT ein toter Port:
// ein unerreichbarer Host waere von dem Fehlschlag, den der heutige Telnyx-Zweig ohnehin
// produziert, nicht zu unterscheiden - der Fall waere gruen, ohne dass der neue Zweig
// existiert. Der Abbruch dagegen ERREICHT die Attrappe erst und bricht dann ab: der
// mitgeschriebene Aufruf ist die Positiv-Kontrolle dieses Falls.
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

// ---- T5: der Offenlegungssatz --------------------------------------------------------
// Auf diesem Pfad spricht der Satz NICHT unser Server, sondern der Agent des Anbieters
// (first_message der Agenten-Konfiguration). Unsere Seite kann ihn deshalb genau auf vier
// Weisen verlieren, und genau die vier werden hier gemessen:
//   (a) den Namen nicht mitschicken -> {{owner_name}} bliebe unaufgeloest, der Satz waere
//       unvollstaendig;
//   (a) ihn per Uebersteuerung ersetzen -> laut Anbieter-Doku wird eine nicht
//       unterstuetzte Uebersteuerung STILL ignoriert (kein Fehler), der Satz verschwaende
//       lautlos;
//   (b) ohne registrierten Auftraggeber-Namen ueberhaupt waehlen -> das Gate davor;
//   (c) der Satz in der Vorlage driftet vom Code weg (heute gruene Ratsche).
// Was unsere Seite NICHT leisten kann: das Sprechen selbst erzwingen. Deshalb liegt die
// letzte Zusage in der Agenten-Konfiguration - und deshalb wird genau die festgenagelt.

test("EL-START T5 (a): der Anrufstart uebergibt owner_name und uebersteuert first_message NICHT", async (ctx) => {
  await withElevenLabs(
    { seed: seedOwner(), ownerNumber: TELNYX_TEST_OWNER_NUMBER },
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

      await ctx.test("kein first_message-/Konfigurations-Override im Rumpf", () => {
        assert.ok(
          !anfrage.raw.includes("conversation_config_override"),
          "eine Uebersteuerung wird bei falscher Konfiguration STILL ignoriert - der Satz duerfte nie daran haengen",
        );
        assert.ok(
          !anfrage.raw.includes("first_message"),
          "der Offenlegungssatz ist Agenten-Konfiguration, kein Anruf-Parameter (Absolute Regel 2)",
        );
      });
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

// Heute GRUEN und bewusst so: die Ratsche haelt fest, was die Agenten-Vorlage bereits
// zusagt. Sie ist die andere Haelfte von (a) - dort wird der NAME uebergeben, hier steht
// der SATZ, in den er faellt. Faellt einer von beiden weg, ist Artikel 50 EU AI Act
// verletzt, ohne dass irgendetwas anderes rot wuerde. Geprueft wird die VORLAGE IM REPO
// gegen den Code, nie das Konto (dafuer gibt es npm run elevenlabs:drift).
const TEMPLATE_PATH = "elevenlabs/agent_configs/outbound-agent.template.json";
const OWNER_NAME_VARIABLE = "{{owner_name}}";

test("EL-START T5 (c, Mechanismus, gruen): first_message der Agenten-Vorlage ist byte-identisch der Offenlegungssatz aus dem Code", () => {
  const vorlage = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const agent = vorlage.agent.conversation_config.agent;
  assert.equal(
    agent.first_message,
    LOCALES.en.disclosure(OWNER_NAME_VARIABLE),
    "first_message muss LOCALES.en.disclosure sein, nur ${ownerName} -> {{owner_name}}",
  );
  assert.equal(
    agent.language,
    "en",
    "Sprache des Agenten und Sprache des Satzes gehoeren zusammen",
  );
});

// ---- T5 (d): der Satz darf an keiner Variablen OHNE DEFAULT haengen ------------------
// Die harte Regel: eine gesetzliche Pflicht haengt NIE an einer Template-Variablen.
// Entweder der Offenlegungssatz traegt gar keine Variable, oder jede darin hat einen
// Default, der FUER SICH ALLEIN rechtlich ausreicht. Genau das leistet der Bau heute:
// dynamicVariables (src/elevenlabs/outbound.js) schickt jeden Wert text-abgesichert raus,
// und owner_name ist der einzige mit INHALTLICHEM Default - faellt der Name aus, tritt
// DISCLOSURE_OWNER_FALLBACK_EN ein ("its owner"), und der Satz bleibt vollstaendig. Dieser
// Fall NAGELT diesen Default FEST; er beschreibt nicht dessen Fehlen.
//
// Warum das trotz T5 (b) erreichbar ist - und der Fall damit nicht dessen Wiederholung:
// das Identitaets-Gate (outbound-gates.js, Glied "owner_name") prueft den WAHRHEITSWERT
// des Namens, nicht seinen Inhalt. Ein Name aus lauter Leerzeichen passiert es. OHNE den
// Default hinterliesse er im Satz eine leere Einsetzstelle ("...on behalf of .") - genau
// die Lage, die auf der Gegenseite den Abbruch bzw. den halben Satz erzeugt: der
// Angerufene hoert dann keine Offenlegung, sondern Stille.
//
// Empirischer Anker dafuer, dass der Anbieter gesetzte Variablen wirklich einsetzt (und
// der gerenderte Vergleich unten also den echten Weg abbildet, nicht nur eine Annahme):
// Spike-2-Anruf 3 mass tts_zeichen=125 - exakt die Laenge des en-Offenlegungssatzes mit
// eingesetztem Namen ("Antonio").
const OWNER_NAME_BLANK = "   ";

// Einsetzen wie der Anbieter es zur Laufzeit tut: eine nicht gelieferte Variable wird zu
// "" (der Platzhalter verschwindet, der Satz bleibt stehen).
const PLATZHALTER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const LEER = "";
const rendern = (satz, variablen) =>
  satz.replace(PLATZHALTER, (treffer, name) => String(variablen[name] ?? LEER));

function firstMessageDerVorlage() {
  const vorlage = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const agent = vorlage.agent.conversation_config.agent;
  return agent.first_message;
}

test("EL-START T5 (d): der Offenlegungssatz haengt an keiner Variablen ohne Default - blanker Auftraggeber-Name, Satz bleibt vollstaendig (Artikel 50 EU AI Act)", async (ctx) => {
  await withElevenLabs(
    { env: MULTI, seed: seedTenantA({ ownerName: OWNER_NAME_BLANK }) },
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

      // Byte-Vergleich wie T5 (c), nicht "irgendwie gefuellt": ein inhaltsloser Fallback
      // ("x") bestuende jede schwaechere Pruefung, ohne die Offenlegung zu tragen.
      await ctx.test("der daraus gerenderte Offenlegungssatz steht fuer sich allein", () => {
        const gerendert = rendern(firstMessageDerVorlage(), variablen);
        assert.equal(
          gerendert,
          LOCALES.en.disclosure(DISCLOSURE_OWNER_FALLBACK_EN),
          `was der Anbieter aus den uebergebenen Variablen spricht, ist nicht der vollstaendige Offenlegungssatz mit eingesetztem Default: "${gerendert}"`,
        );
      });
    },
  );
});

// ---- T6: die harten Verbote und der Kontext des Auftrags -----------------------------
// ABSICHTLICH ROT. Auf dem BESTANDSWEG tragen beide Groessen den Systemprompt mit:
// constraints als eigener VERBOTE-Block samt Vorrang-Satz (src/claude.js), context als
// HINTERGRUND-Sektion mit summary/recipient_relationship/desired_outcome/key_facts. Auf
// diesem Weg spricht der Agent DES ANBIETERS - er weiss ausschliesslich, was der
// Anrufstart ihm mitgibt. src/elevenlabs/outbound.js uebergibt heute genau vier
// dynamische Variablen (owner_name, callee, objective, mandate), und die Agenten-Vorlage
// deklariert keinen Platzhalter fuer Verbote.
//
// Warum das ein GATE-Befund ist und kein Qualitaetsmangel: das MANDAT reist mit, seine
// OBERGRENZE nicht. Aus "vereinbare frei, aber hoechstens 40 Euro und keine Anzahlung"
// wird am Anbieter "vereinbare frei" - der Auftraggeber wird muendlich an genau das
// gebunden, was er ausdruecklich ausgeschlossen hat, und erfaehrt es erst aus dem
// Transkript. Ein Mandat ohne seine Verbote ist kein halbes Mandat, sondern ein
// weitergehendes.
//
// Gemessen wird der ZWECK, nicht die Existenz eines Schluessels: der WORTLAUT des Verbots
// muss in dem Material auftauchen, das den Agenten erreicht. Ein leerer, abgeschnittener
// oder generischer Wert traegt ihn nicht und besteht diesen Fall deshalb nicht. Welchen
// der beiden moeglichen Traeger der Bau waehlt, entscheidet dieser Fall NICHT mit - er
// akzeptiert beide; T5 (a) haelt daneben fest, dass eine Uebersteuerung bei nicht
// freigeschaltetem Feld STILL ignoriert wird.
const VERBOT_ZEIT = "nicht vor 10 Uhr";
const VERBOT_PREIS = "hoechstens 40 Euro";
const VERBOT_ANZAHLUNG = "keine Anzahlung zusagen";
const VERBOTE = Object.freeze([VERBOT_ZEIT, VERBOT_PREIS, VERBOT_ANZAHLUNG]);
const CONSTRAINTS = `${VERBOT_ZEIT}, ${VERBOT_PREIS}, ${VERBOT_ANZAHLUNG}`;

// Der Kontext des Auftrags. Geprueft werden die beiden Felder, die das Gespraech FUEHREN:
// woraufhin gearbeitet wird (desired_outcome) und in welchem Verhaeltnis der Angerufene
// zum Auftraggeber steht (recipient_relationship) - ohne sie verhandelt der Agent ins
// Blaue und spricht einen Stammkunden an wie einen Fremden.
const KONTEXT_BEZIEHUNG = "Stammkunde seit drei Jahren, Duzen ist ueblich";
const KONTEXT_ERGEBNIS = "ein fest zugesagter Termin am Donnerstagvormittag";
const KONTEXT = Object.freeze({
  summary: "Der Auftraggeber braucht einen Herrenhaarschnitt vor seiner Reise am Freitag.",
  recipient_relationship: KONTEXT_BEZIEHUNG,
  desired_outcome: KONTEXT_ERGEBNIS,
});

// Alles, was den Agenten des Anbieters erreichen KANN, als EIN Textblock: die dynamischen
// Variablen (der Weg, den der Anrufstart heute geht) und eine etwaige Prompt-
// Uebersteuerung - die beiden einzigen Traeger, die die Anbieter-Oberflaeche dafuer kennt.
// Rekursiv ueber die String-Blaetter, damit der Fall nicht an der genauen Verschachtelung
// einer kuenftigen Uebersteuerung haengt: WO der Wortlaut steht, ist die Wahl des Baus, DASS
// er ankommt, ist der Vertrag.
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

// Grosszuegig in der Schreibweise, streng im Inhalt: eine andere Gross-/Kleinschreibung ist
// kein verlorenes Verbot, ein fehlender Wortlaut schon.
const enthaelt = (material, wortlaut) =>
  material.toLowerCase().includes(wortlaut.toLowerCase());

test("EL-START T6: die harten Verbote und der Kontext des Auftrags erreichen den Agenten des Anbieters", async (ctx) => {
  await withElevenLabs(
    {
      // Der Kontext-Kanal ist in BASE_ENV abgeschaltet (test/helpers.js) - ohne diese Zeile
      // wuerde das assistant_context-Gate ctx.context auf null setzen und der Fall
      // wuerde eine Luecke messen, die er selbst erzeugt hat.
      env: { ASSISTANT_CONTEXT_ENABLED: "true" },
      seed: seedOwner(),
      ownerNumber: TELNYX_TEST_OWNER_NUMBER,
    },
    async ({ srv, mock }) => {
      const res = await placeCall(srv, null, { constraints: CONSTRAINTS, context: KONTEXT });
      const antwort = await res.text();
      assert.equal(res.status, HTTP_OK, `Vorbedingung: der Anruf muss ueberhaupt starten: ${antwort}`);
      assert.equal(mock.startRequests.length, 1, "Vorbedingung: genau EIN Anrufstart am Anbieter");
      const anfrage = mock.startRequests[0];
      const material = agentMaterial(anfrage);

      // Die Trennlinie des Falls: was unsere Seite ANGENOMMEN hat, steht am Record. Bleibt
      // dieser Teil gruen, waehrend die uebrigen rot sind, liegt der Verlust nachweislich
      // an der Uebergabe an den Anbieter - nicht an Eingabe, Validierung oder Persistenz.
      await ctx.test("Vorbedingung: Verbote und Kontext stehen am Call-Datensatz", () => {
        const call = ownCalls(srv)[0];
        assert.ok(call, "kein Call-Datensatz angelegt");
        assert.equal(call.constraints, CONSTRAINTS, "die Verbote kommen nicht einmal am Record an");
        assert.equal(call.context?.desired_outcome, KONTEXT_ERGEBNIS);
        assert.equal(call.context?.recipient_relationship, KONTEXT_BEZIEHUNG);
      });

      // Ohne diese Haelfte waere jeder rote Befund unten unbrauchbar: ein Sucher, der
      // NICHTS findet, meldet dasselbe wie ein Sucher, der nicht sucht (Lehre
      // pruefkommando-ohne-positiv-kontrolle). Das Anliegen reist heute nachweislich mit.
      await ctx.test("Positiv-Kontrolle: das Anliegen findet der Sucher im Agenten-Material", () => {
        assert.ok(
          enthaelt(material, OBJECTIVE),
          `der Sucher findet nicht einmal das Anliegen - Material: ${material}`,
        );
      });

      await ctx.test("jedes harte Verbot erreicht den Agenten im Wortlaut", () => {
        for (const verbot of VERBOTE)
          assert.ok(
            enthaelt(material, verbot),
            `Verbot "${verbot}" erreicht den Agenten NICHT - weder als dynamische Variable noch als Prompt-Uebersteuerung. Material: ${material}`,
          );
      });

      await ctx.test("das Wunschergebnis und die Beziehung zur Gegenstelle erreichen den Agenten", () => {
        assert.ok(
          enthaelt(material, KONTEXT_ERGEBNIS),
          `desired_outcome erreicht den Agenten NICHT - er verhandelt ohne Ziel. Material: ${material}`,
        );
        assert.ok(
          enthaelt(material, KONTEXT_BEZIEHUNG),
          `recipient_relationship erreicht den Agenten NICHT - er spricht einen Stammkunden an wie einen Fremden. Material: ${material}`,
        );
      });
    },
  );
});

// ---- T6 (Vorrang): der Vorrang der Verbote reist NUR mit den Verboten ----------------
// Die andere Haelfte des Falls oben: dort wird gemessen, dass die Verbote ANKOMMEN, hier,
// dass ihr VORRANG nicht OHNE sie ankommt. Der Satz stand statisch im MANDATE-Abschnitt der
// Agenten-Vorlage und ist in den WERT von {{constraints}} gewandert (src/elevenlabs/
// outbound.js, constraintsText). Warum das kein Schoenheitsfehler ist: ein Prompt, der den
// Vorrang von Verboten verspricht, die es in diesem Auftrag gar nicht gibt, laedt den
// Agenten ein, sich Grenzen auszudenken oder sein Mandat gegen einen leeren Text
// abzuschwaechen - er verhandelt dann enger oder weiter als beauftragt, und niemand merkt
// es, weil kein anderer Fall davon rot wird.
//
// Der Wortlaut wird NICHT abgetippt, sondern aus derselben Quelle gezogen, aus der ihn der
// Bau nimmt. Getrimmt: im Bestand haengt er als Anhaengsel an den Spielraum-Regeln und
// traegt darum ein fuehrendes Leerzeichen (src/claude.js), auf diesem Weg beginnt er eine
// eigene Zeile.
const EN_PROMPT = LOCALES.en.prompt;
const VORRANG_SATZ = EN_PROMPT.mandate.constraintsPrecedence.trim();

function vorlagenPrompt() {
  const vorlage = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const agent = vorlage.agent.conversation_config.agent;
  return agent.prompt.prompt;
}

// Gemessen wird an dem, was der Agent WIRKLICH sieht: das Material des Anrufstarts (derselbe
// Sucher wie oben) UND der Vorlagen-Prompt mit eingesetzten Variablen (rendern wie in
// T5 (d)). Erst diese Zusammensetzung faengt den Rueckdrift: stuende der Satz wieder
// statisch in der Vorlage, traegt ihn der gerenderte Prompt auch ohne Verbote.
const materialMitVorlage = (anfrage) =>
  [agentMaterial(anfrage), rendern(vorlagenPrompt(), dynamicVariables(anfrage))].join("\n");

// Ein Anrufstart, aus dem nur zaehlt, was beim Agenten ankommt. Alle Unterfaelle, die ihn
// fahren (T6 (Vorrang) ueber constraints, T10 ueber mandate.decide_freely), nutzen denselben
// Seed und unterscheiden sich in GENAU EINER Achse: dem Auftrags-Feld, das sie setzen.
async function vorrangLauf(auftrag) {
  return withElevenLabs(
    { seed: seedOwner(), ownerNumber: TELNYX_TEST_OWNER_NUMBER },
    async ({ srv, mock }) => {
      const res = await placeCall(srv, null, auftrag);
      assert.equal(res.status, HTTP_OK, `Vorbedingung: der Anruf muss starten: ${await res.text()}`);
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

  // Ohne diese Haelfte saehe "Satz nicht gefunden" genauso aus wie "der Sucher sucht
  // nichts" (Lehre pruefkommando-ohne-positiv-kontrolle): derselbe Sucher, dasselbe
  // Material, EINE geaenderte Achse - und er schlaegt an.
  await ctx.test("mit Verboten: derselbe Sucher findet ihn (Positiv-Kontrolle)", async () => {
    const { material } = await vorrangLauf({ constraints: CONSTRAINTS });
    assert.ok(
      enthaelt(material, VORRANG_SATZ),
      `die Verbote reisen ohne ihren Vorrang - aus "entscheide frei, aber hoechstens 40 Euro" wird am Anbieter wieder "entscheide frei". Material: ${material}`,
    );
  });
});

// ---- T6 (Mandat): der Spielraum des Auftrags erreicht den Agenten --------------------
// Die dritte Groesse desselben Auftrags - und die einzige, die den Agenten ueberhaupt
// ENTSCHEIDEN laesst, statt jede Frage als Nachricht zurueckzugeben: das Mandat
// (decide_freely = die Ermaechtigung, fallback_order = die Reihenfolge, die er allein
// durchgeht). Der Vorlagen-Prompt fuehrt dafuer einen eigenen Abschnitt ("Mandate for this
// call: {{mandate}}") und sagt ausdruecklich: ist das Feld leer, hat der Agent KEIN Mandat
// und sagt gar nichts zu.
//
// Warum das ein Befund waere und kein Qualitaetsmangel: kommt der Wert nicht an, ist der
// Anruf nicht halb so gut, sondern ergebnislos. Der Agent nimmt eine Nachricht auf, wo der
// Auftraggeber ihn ausdruecklich hat entscheiden lassen - und niemand sieht einen Fehler,
// weil der Anruf technisch gelingt. Es ist die Gegenrichtung zum Verbote-Fall oben: dort
// reist die OBERGRENZE nicht mit (der Agent verhandelt weiter als beauftragt), hier die
// ERMAECHTIGUNG (er verhandelt gar nicht).
//
// Gemessen wird wie in T6 der WORTLAUT im Material, das den Agenten erreicht - ein leerer,
// abgeschnittener oder generischer Wert traegt ihn nicht. NICHT gemessen wird die
// Enum-Achse on_out_of_scope: sie hat auf diesem Weg bewusst keinen Platz (die Vorlage
// kennt genau EINEN {{mandate}}-Slot, src/elevenlabs/outbound.js), und ein Fall darueber
// entschiede eine Vorlagen-Aenderung mit, die dieser Fall nicht mitentscheiden soll.
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

      // Trennlinie wie in T6: was unsere Seite ANGENOMMEN hat, steht am Record. Bleibt
      // dieser Teil gruen, waehrend die uebrigen rot sind, liegt der Verlust nachweislich
      // an der Uebergabe an den Anbieter - nicht an Eingabe, Validierung oder Persistenz.
      await ctx.test("Vorbedingung: das Mandat steht am Call-Datensatz", () => {
        const call = ownCalls(srv)[0];
        assert.ok(call, "kein Call-Datensatz angelegt");
        assert.equal(call.mandate?.decide_freely, MANDAT_SPIELRAUM);
        assert.equal(call.mandate?.fallback_order, MANDAT_REIHENFOLGE);
      });

      // Ohne diese Haelfte waere jeder rote Befund unten unbrauchbar: ein Sucher, der
      // NICHTS findet, meldet dasselbe wie ein Sucher, der nicht sucht (Lehre
      // pruefkommando-ohne-positiv-kontrolle). Das Anliegen reist heute nachweislich mit.
      await ctx.test("Positiv-Kontrolle: das Anliegen findet der Sucher im Agenten-Material", () => {
        assert.ok(
          enthaelt(material, OBJECTIVE),
          `der Sucher findet nicht einmal das Anliegen - Material: ${material}`,
        );
      });

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

// ---- T7: die zwei Zeitzonen und die aktuelle Zeit ------------------------------------
// GEBAUT UND GRUEN (Ratsche). Der Bestandsweg loest beides PRO ANRUF auf: src/claude.js liest die
// Zeitzone DES TENANTS (store.tenantTimezone -> resolveTimezone) und formatiert damit ein
// frisches `now` in den Systemprompt (claude.js:62/:99, P8/FMT-28 - der Agent nannte
// deutschen Anrufern zuvor eine um 1-2 h falsche Uhrzeit, weil der Serverprozess UTC
// faehrt). Auf diesem Weg spricht der Agent DES ANBIETERS: er weiss ausschliesslich, was
// der Anrufstart ihm mitgibt, und dynamicVariables (src/elevenlabs/outbound.js) uebergab
// sechs Variablen, von denen KEINE eine Zeitzone oder ein Datum trug. Was stattdessen
// wirkte, war ein FESTWERT am Agenten (conversation_config.agent.prompt.timezone =
// "Europe/Berlin") - ein Wert, den die Vorlage nicht einmal besass (er stand unter
// _nicht_besessen), den also kein Drift-Gate hielt; im Prompt selbst stand kein
// Datums-Slot, nur das feste Beispiel "Thursday at nine". Seit dem Bau reisen
// owner_timezone, callee_timezone und today pro Anruf mit (src/elevenlabs/time-context.js);
// dieser Fall haelt sie fest.
//
// Warum das ein Befund ist und kein Komfortmangel: fast jeder Auftrag verhandelt einen
// TERMIN. Ein Agent mit fester Zone und ohne Datum sagt einem Auftraggeber in Tokio einen
// Termin nach Berliner Zeit zu und rechnet "naechsten Donnerstag" gegen ein Datum, das er
// gar nicht kennt - beides faellt niemandem auf, bis der Auftraggeber vor verschlossener
// Tuer steht. Deshalb ZWEI Zonen, beide pro Anruf: die des AUFTRAGGEBERS (in seiner Zeit
// steht der Termin in seinem Kalender) und die des ANGERUFENEN (in seiner spricht die
// Gegenstelle) - der Agent rechnet um. Ein Fall, in dem beide gleich sind, beweist nichts;
// die Wache unten haelt sie auseinander.
//
// DATENQUELLEN: die Zone des AUFTRAGGEBERS steht am Tenant (tenant.timezone, beim
// Onboarding/Login ueber setTenantGeo gesetzt, Leser store.tenantTimezone) - sie ist da,
// sie reist nur nicht. Fuer den ANGERUFENEN gibt es KEIN Feld; der einzige Anhalt ohne neue
// Datenhaltung ist das Land der gewaehlten Nummer, und den kann der Bestand ableiten:
// countryForE164 (store/defaults.js) -> timezoneForCountry (geo/resolve.js), dieselbe
// Tabelle, aus der auch die Tenant-Zone stammt. Genau diese Kette pinnt der Fall.
//
// IHRE GRENZE, die der Bau kennen muss: countryForE164 liefert fuer +1 BEWUSST null (25
// NANP-Laender teilen die Vorwahl, Owner-Entscheidung E2 "nie raten") - und +1 ist das
// Marktgebiet, in dem dieses Produkt telefoniert. timezoneForCountry(null) faellt auf
// DEFAULT_TIMEZONE ("Europe/Berlin") zurueck: wer die Kette blind baut, liefert fuer JEDEN
// US-Anruf lautlos die Berliner Zone als die des Angerufenen. Fuer NANP braucht es eine
// eigene Quelle (Vorwahl-Tabelle oder ein Feld am Auftrag) - eine Entscheidung, die dieser
// Fall nicht vorwegnimmt. Deshalb waehlt er ein Ziel, dessen Land ableitbar IST, und die
// Wache unten schlaegt an, sobald jemand ein nicht ableitbares einsetzt.
//
// GEPINNT wird der IANA-Bezeichner, unveraendert wie ihn der Store haelt - nicht ein
// Zeitversatz ("UTC+02:00"). Ein Versatz veraltet mit der naechsten Sommerzeit-Umstellung,
// und "rechne um" braucht die Zone, nicht ihren heutigen Stand.

// Zwei Zonen, die weit auseinanderliegen, und KEINE davon ist der Festwert: faende der
// Sucher "Europe/Berlin", waere nicht zu unterscheiden, ob der Wert mitgereist ist oder
// nur der Default danebenstand (DEFAULT_TIMEZONE ist derselbe Bezeichner).
const OWNER_TZ = "Asia/Tokyo";
// Franzoesische Mobilnummer: +33 ist eindeutig FR (countryForE164), Europe/Paris ist weder
// die Zone des Auftraggebers noch der Festwert.
const CALLEE_NUMBER = "+33612345678";
const CALLEE_TZ = timezoneForCountry(countryForE164(CALLEE_NUMBER));

// Die Uhr wird ueber das DATUM gemessen, nicht ueber die Uhrzeit: eine Minute, die
// zwischen Anrufstart und Auswertung umspringt, waere ein Flackern ohne Aussage - und ein
// Agent, der nur die Uhrzeit kennt, kann "naechsten Donnerstag" ohnehin nicht ausrechnen.
// WELCHE Schreibweise der Bau waehlt, entscheidet dieser Fall NICHT mit; er akzeptiert die
// gaengigen und verlangt nur, dass eine davon ankommt. Beide Zonen liefern Kandidaten:
// zwischen Tokio und Paris kann ein Datumswechsel liegen, und in welcher der beiden Zonen
// der Bau das Datum ausdrueckt, ist seine Wahl (die Zonen selbst pinnen die Faelle darueber).
const DATUMS_SCHREIBWEISEN = Object.freeze([
  ["en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }], // 2026-08-15
  ["en-US", { year: "numeric", month: "numeric", day: "numeric" }], // 8/15/2026
  ["en-US", { year: "numeric", month: "long", day: "numeric" }], // August 15, 2026
  ["en-GB", { year: "numeric", month: "long", day: "numeric" }], // 15 August 2026
  ["de-DE", { year: "numeric", month: "2-digit", day: "2-digit" }], // 15.08.2026
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

      // Trennlinie wie in T6: was unsere Seite WEISS, steht im Store. Bleibt dieser Teil
      // gruen, waehrend die uebrigen rot sind, liegt der Verlust nachweislich an der
      // Uebergabe an den Anbieter - nicht an Seed, Store oder Wahl des Ziels.
      await ctx.test("Vorbedingung: die Zeitzone des Auftraggebers steht am Tenant, gewaehlt wurde die Auslandsnummer", () => {
        assert.equal(tenantAusStore(srv, BOOTSTRAP_TENANT_ID)?.timezone, OWNER_TZ);
        assert.equal(anfrage.body.to_number, CALLEE_NUMBER);
      });

      // Ohne diese Haelfte waere jeder rote Befund unten unbrauchbar: ein Sucher, der
      // NICHTS findet, meldet dasselbe wie ein Sucher, der nicht sucht (Lehre
      // pruefkommando-ohne-positiv-kontrolle). Das Anliegen reist heute nachweislich mit.
      await ctx.test("Positiv-Kontrolle: das Anliegen findet der Sucher im Agenten-Material", () => {
        assert.ok(
          enthaelt(material, OBJECTIVE),
          `der Sucher findet nicht einmal das Anliegen - Material: ${material}`,
        );
      });

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

      await ctx.test("die Zeitzone des Angerufenen erreicht den Agenten und ist von der des Auftraggebers unterscheidbar", () => {
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
      });

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

// ---- T8: die Zone des Angerufenen ist eine HYPOTHESE, keine Tatsache -----------------
// GEBAUT UND GRUEN (Ratsche). T7 haelt die Zone des Angerufenen fuer die Faelle fest, in denen
// sie sich aus dem LAND der Nummer ergibt (+33 -> FR -> Europe/Paris). Fuer +1 gibt es diesen
// Weg nicht: countryForE164 liefert dort BEWUSST null (25 NANP-Laender teilen die Vorwahl,
// Owner-Entscheidung E2), calleeTimezoneText lieferte deshalb "" - und +1 ist das Marktgebiet,
// in dem dieses Produkt telefoniert. Vor dem Bau reiste fuer JEDEN US-Anruf also KEINE Zone des
// Angerufenen; im Vorlagen-Prompt stand dafuer ein statischer Satz, der nur das STILLE
// Umrechnen verbot ("say which time zone you mean, or ask which one they are using") - er
// erlaubte weiterhin, eine absolute Uhrzeit zu nennen. Eine Vorwahl-Tabelle gab es im Repo
// nicht (grep: kein areaCode/AREA_CODE, TIMEZONE_FOR_COUNTRY kannte nur Laender). Seit dem Bau
// liefert src/elevenlabs/nanp-area-codes.js die HYPOTHESE, der statische Satz ist entfallen,
// und dieser Fall haelt beide Lagen fest.
//
// EIGENTUEMER-ENTSCHEIDUNG (15.08.2026), die dieser Fall festnagelt: eine Vorwahl-Tabelle
// ALLEIN ist falsch. Die Zuordnung Vorwahl -> Zone stimmt meistens, aber nicht immer
// (Bundesstaaten ueber Zonengrenzen, Arizona ohne Sommerzeit), und "meistens richtig" heisst
// bei Terminen: still falsche Uhrzeiten. Richtig ist die KOMBINATION - und sie ist zugleich
// das, was ein Mensch tut: die Tabelle liefert eine HYPOTHESE, kein Ergebnis; der Agent
// BESTAETIGT sie im Gespraech in EINEM Satz ("I have you down as Eastern time - is that
// right?"), bevor er eine absolute Uhrzeit nennt. Der Angerufene weiss seine Zone - die
// verlaesslichste Quelle, die es gibt, und sie kostet eine Sekunde. Steht KEINE Zone fest,
// nennt der Agent GAR KEINE absolute Uhrzeit: "tomorrow morning", und die Gegenseite nennt
// die Uhrzeit. Lieber unbestimmt als falsch.
//
// NICHT GEPINNT, OFFEN als eigenes Paket: dass der BESTAETIGTE Wert gespeichert wird (zweite
// Haelfte der Entscheidung). Das braucht eine Ergebnis-Rueckmeldung des Agenten an uns und
// ein Feld am Store - beides gibt es auf diesem Weg noch nicht, und ein Fall darueber wuerde
// hier eine Datenhaltung mitentscheiden, die dieser Fall nicht mitentscheiden soll.
//
// WARUM ZWEI LAEUFE, DIE ZUSAMMENGEHOEREN: der Hypothesen-Fall verlangt den IANA-Bezeichner
// im Material, der Fallback-Fall verlangt seine ABWESENHEIT bei einer Nummer, fuer die keine
// Zone feststeht. Erst das Paar beweist, dass die Zone PRO ANRUF aus der Vorwahl kommt: ein
// statisch in die Vorlage getippter Zonenname bestuende den ersten Fall und fiele im zweiten
// durch. Aus demselben Grund wird NUR der IANA-Bezeichner akzeptiert und nicht der
// gesprochene Name ("Eastern time") - den darf ein statisches Beispiel im Prompt tragen (der
// Satz, den der Agent SAGT), er beweist dann aber nichts ueber diesen Anruf. Es ist zugleich
// die Schreibweise, die T7 fuer die Gegenstelle bereits festhaelt.
const HYPOTHESE_NUMMER = "+12125550147"; // 212 = New York City: eine Zone, nie geteilt
const HYPOTHESE_ZONE = "America/New_York";
// 555 ist keine geografische NANP-Vorwahl (555-01xx ist ausdruecklich fuer fiktive Nummern
// reserviert) - keine Vorwahl-Tabelle kann ihr je eine Zone zuordnen. Damit bleibt der
// Fallback-Fall auch dann wahr, wenn die Tabelle spaeter waechst. Beide Nummern liegen im
// fiktiven 555-01xx-Block: kein echter Anschluss, und die Attrappe waehlt ohnehin nichts.
const OHNE_ZONE_NUMMER = "+15555550147";

// Gemessen wird der ZWECK, nicht ein Wortlaut: WIE der Bau die Anweisung formuliert, ist
// seine Wahl - DASS sie beim Agenten ankommt, ist der Vertrag. Deshalb je eine Liste
// zulaessiger Marker; einer genuegt, und der Fehlertext nennt die ganze Liste. Keiner davon
// steht heute im Vorlagen-Prompt (am gerenderten Prompt nachgemessen, sonst waere der Fall
// gruen, ohne dass irgendetwas gebaut waere).
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
// Der Fallback: KEINE absolute Uhrzeit (Verbot am Zeitwort) und die Gegenseite nennt sie.
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

// Die Anweisung muss NEBEN der Hypothese stehen, nicht irgendwo im Prompt: ein
// Bestaetigungs-Satz ohne Bezug zu dieser Zone bestaetigt sie nicht. 500 Zeichen sind gross
// genug fuer den tragenden Satz samt Anweisung daneben und klein genug, dass die entfernte
// Zeile "Ask instead of guessing" (Abschnitt IF SOMETHING IS UNCLEAR) nicht als
// Annahme-Marker durchschlaegt - am gerenderten Prompt nachgemessen.
const FENSTER_ZEICHEN = 500;

// Alle Textfenster um jedes Vorkommen des Ankers. Mehrere, weil der Zonenname sowohl im Wert
// als auch in einer Vorlagen-Zeile stehen kann und EIN passendes Umfeld genuegt.
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

// Ein Anrufstart auf eine US-Nummer; zurueck kommt NUR, was den Agenten erreicht. Gesucht
// wird im selben Material wie in T6 (Vorrang): Anrufstart PLUS gerenderter Vorlagen-Prompt -
// beide Traeger sind zulaessig, und der Fallback-Satz braucht gar keinen Wert (er gilt
// gerade dann, wenn keiner da ist), kann also nur statisch in der Vorlage stehen.
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

  // Ohne diese Haelfte waere jeder rote Befund unten unbrauchbar: ein Sucher, der NICHTS
  // findet, meldet dasselbe wie ein Sucher, der nicht sucht (Lehre
  // pruefkommando-ohne-positiv-kontrolle). Das Anliegen reist heute nachweislich mit.
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

  await ctx.test("der Agent soll sie in EINEM Satz bestaetigen, BEVOR er eine absolute Uhrzeit nennt", () => {
    const umfelderMitZone = hypotheseUmfelder(material);
    assert.ok(
      umfelderMitZone.some((umfeld) => enthaeltEines(umfeld, BESTAETIGUNG_MARKER)),
      `neben der Hypothese steht keine Aufforderung, sie im Gespraech zu bestaetigen - der Angerufene weiss seine Zone, das ist die verlaesslichste Quelle, die es gibt, und es kostet eine Sekunde. Erwartet: eines von ${BESTAETIGUNG_MARKER.join(" | ")}. Material: ${material}`,
    );
    assert.ok(
      umfelderMitZone.some((umfeld) => enthaeltEines(umfeld, VORHER_MARKER)),
      `die Bestaetigung ist nicht VOR die erste absolute Uhrzeit gestellt - bestaetigt der Agent erst hinterher, hat er den Termin bereits in der geratenen Zone zugesagt. Erwartet: eines von ${VORHER_MARKER.join(" | ")}. Material: ${material}`,
    );
  });
});

test("EL-START T8 (Fallback): steht keine Zone fest, nennt der Agent gar keine absolute Uhrzeit", async (ctx) => {
  const material = await usLauf(OHNE_ZONE_NUMMER);

  await ctx.test("Positiv-Kontrolle: das Anliegen findet der Sucher im Agenten-Material", () => {
    assert.ok(
      enthaelt(material, OBJECTIVE),
      `der Sucher findet nicht einmal das Anliegen - Material: ${material}`,
    );
  });

  // Die andere Haelfte des Paares (s. Kopfnotiz): fuer diese Nummer steht keine Zone fest,
  // also darf auch keine behauptet werden. Faende sich hier derselbe Bezeichner wie oben,
  // stuende er statisch in der Vorlage und der Fall darueber bewiese nichts ueber den Anruf.
  await ctx.test("Wache: fuer diese Nummer steht keine Zone fest - und es wird auch keine behauptet", () => {
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
  });

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

// ---- T9: das Briefing des Auftraggebers ----------------------------------------------
// ABSICHTLICH ROT. briefing ist das Feld, in das place_call den GANZEN Hintergrund aus dem
// bisherigen Chat legt (src/mcp-tools.js: "Relevant context from the chat so far that the
// agent needs for the call" - Namen, Vorlieben, Vorgeschichte, gewuenschtes Ergebnis und
// Ton). Auf dem BESTANDSWEG traegt es den Systemprompt mit; auf diesem Weg spricht der
// Agent DES ANBIETERS und weiss ausschliesslich, was der Anrufstart ihm mitgibt.
//
// Unsere Seite nimmt es an und behaelt es: place_call fuehrt es im Schema, /api/calls legt
// es als call.briefing an. Danach liest es auf diesem Weg NIEMAND mehr - dynamicVariables
// (src/elevenlabs/outbound.js) baut seine Variablen aus goal, constraints, context, mandate,
// Zeit und Auftraggeber-Namen, briefing ist in der ganzen Datei nicht erwaehnt. Von allen
// Groessen des Auftrags ist das der groesste Inhaltsverlust, und er ist still: der Anruf
// gelingt, der Agent klingt nur ahnungslos - er kennt weder Namen noch Vorgeschichte, die
// der Auftraggeber ihm ausdruecklich mitgegeben hat.
//
// Gemessen wird der ZWECK, nicht die Existenz eines Schluessels: der WORTLAUT des Briefings
// muss in dem Material auftauchen, das den Agenten erreicht. Ein leerer, abgeschnittener
// oder generischer Wert traegt ihn nicht und besteht diesen Fall deshalb nicht. WO er
// landet - eigene dynamische Variable oder ein Platz in einem der bestehenden Bloecke -,
// entscheidet dieser Fall NICHT mit; er akzeptiert jeden Traeger, den der Agent sieht.
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

      // Trennlinie wie in T6: was unsere Seite ANGENOMMEN hat, steht am Record. Bleibt
      // dieser Teil gruen, waehrend der letzte rot ist, liegt der Verlust nachweislich an
      // der Uebergabe an den Anbieter - nicht an Eingabe, Validierung oder Persistenz.
      await ctx.test("Vorbedingung: das Briefing steht am Call-Datensatz", () => {
        const call = ownCalls(srv)[0];
        assert.ok(call, "kein Call-Datensatz angelegt");
        assert.equal(call.briefing, BRIEFING, "das Briefing kommt nicht einmal am Record an");
      });

      // Ohne diese Haelfte waere der rote Befund unten unbrauchbar: ein Sucher, der NICHTS
      // findet, meldet dasselbe wie ein Sucher, der nicht sucht (Lehre
      // pruefkommando-ohne-positiv-kontrolle). Das Anliegen reist heute nachweislich mit.
      await ctx.test("Positiv-Kontrolle: das Anliegen findet der Sucher im Agenten-Material", () => {
        assert.ok(
          enthaelt(material, OBJECTIVE),
          `der Sucher findet nicht einmal das Anliegen - Material: ${material}`,
        );
      });

      await ctx.test("der Wortlaut des Briefings erreicht den Agenten", () => {
        assert.ok(
          enthaelt(material, BRIEFING_KERN),
          `das Briefing ("${BRIEFING_KERN}") erreicht den Agenten NICHT - weder als dynamische Variable noch ueber den gerenderten Vorlagen-Prompt. Es steht am Call-Datensatz und wird von diesem Weg nie gelesen: der Agent fuehrt das Gespraech ohne den Hintergrund, den der Auftraggeber ihm ausdruecklich mitgegeben hat. Material: ${material}`,
        );
      });
    },
  );
});

// ---- T10: die Mandats-Weiche in den Grenzen des Agenten ------------------------------
// ABSICHTLICH ROT - und die andere Haelfte von T6 (Mandat): dort wird gemessen, dass der
// WERT des Mandats ankommt, hier, dass er die WEICHE stellt, die er im Bestand stellt.
//
// Der Bestand kennt zwei Buchungs-Grenzen und tauscht sie pro Anruf (src/claude.js:210):
// ohne Spielraum boundaries.noBooking ("du buchst nichts fest, du nimmst den Terminwunsch
// als Nachricht auf"), mit Spielraum boundaries.noBookingWithMandate ("was dein SPIELRAUM
// deckt, sagst du selbst zu und gibst es NICHT zusaetzlich als Nachricht weiter") - genau
// dann, wenn call.mandate.decide_freely gesetzt ist (mandateScopeGiven, src/claude.js:97).
// Die Agenten-Vorlage traegt an dieser Stelle EINEN statischen Prosa-Satz im Abschnitt
// YOUR BOUNDARIES, der die OHNE-Mandat-Variante fuehrt; die Vorlage nennt das selbst
// (_bestandsabgleich_begruendung: "NICHT geaendert wurde die Buchungs-Zeile ... sie traegt
// weiter die OHNE-Mandat-Variante boundaries.noBooking").
//
// Warum das ein Befund ist und kein Schoenheitsfehler: das Mandat reist, seine WIRKUNG
// nicht. Der Agent liest im selben Prompt "Mandate for this call: <Spielraum>" UND "du
// buchst nichts fest, du nimmst es als Nachricht auf". Im Konflikt gewinnt mal das eine,
// mal das andere - der Auftraggeber, der ausdruecklich hat entscheiden lassen, bekommt
// stattdessen eine Nachricht zurueck, und niemand sieht einen Fehler, weil der Anruf
// technisch gelingt. Der Bestand hat genau diesen Selbstwiderspruch aufgeloest (WW-F1).
//
// GEPINNT werden BEIDE Lagen gegeneinander, jede als Muss UND als Darf-nicht: ein
// statischer Text kann nur eine von beiden fuehren und faellt deshalb in genau einem der
// zwei Laeufe durch. Der Wortlaut wird NICHT abgetippt, sondern aus derselben Quelle
// gezogen, aus der ihn der Bau nehmen muss (src/i18n/prompts/en.js ueber LOCALES - so
// haelt es src/elevenlabs/outbound.js bereits fuer Beschriftungen und Vorrang-Satz; ein
// hier neu getippter Satz waere eine zweite, schwaechere Wahrheit, G5). Der Listenstrich
// faellt weg: im Bestand stehen die Zeilen in einer Aufzaehlung, auf diesem Weg
// entscheidet der Bau ueber die Form, nicht ueber den Satz.
const LISTENSTRICH = /^-\s+/;
const buchungsgrenze = (baustein) => baustein.replace(LISTENSTRICH, "");
const BUCHUNG_OHNE_MANDAT = buchungsgrenze(EN_PROMPT.boundaries.noBooking);
const BUCHUNG_MIT_MANDAT = buchungsgrenze(EN_PROMPT.boundaries.noBookingWithMandate);
// Eigener Spielraum-Wortlaut (nicht der aus T6 (Mandat)): die beiden Faelle duerfen sich
// nicht ueber einen geteilten Wert bedingen.
const WEICHE_SPIELRAUM = "Termin an jedem Werktag zwischen 14 und 17 Uhr, bis 80 Euro";

test("EL-START T10: die Buchungs-Grenze des Agenten folgt dem Mandat DIESES Anrufs", async (ctx) => {
  // Ohne diese Wache misst der Fall nichts: waeren die beiden Bausteine gleich oder einer
  // im anderen enthalten, koennte EIN statischer Text beide Laeufe bestehen.
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

  await ctx.test("ohne Mandat: die OHNE-Mandat-Grenze erreicht den Agenten, die MIT-Variante nicht", async () => {
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
  });

  await ctx.test("mit decide_freely: die MIT-Mandat-Grenze erreicht den Agenten, die OHNE-Variante nicht", async () => {
    const { variablen, material } = await vorrangLauf({
      mandate: { decide_freely: WEICHE_SPIELRAUM },
    });
    // Trennt "das Mandat kam gar nicht an" von "die Weiche wurde nicht gestellt": diese
    // Haelfte ist heute gruen, die beiden darunter sind es nicht.
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
  });
});
