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

import { DISCLOSURE_OWNER_FALLBACK_EN, LOCALES } from "../src/i18n/locales.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
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
const FINISHED_CONVERSATION = Object.freeze({
  status: "done",
  transcript: [
    { role: "agent", message: "Guten Tag, ich rufe wegen eines Termins an." },
    { role: "user", message: TRANSCRIPT_LINE },
  ],
  analysis: { transcript_summary: PROVIDER_SUMMARY, call_successful: "success" },
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
    { seed: seedOwner(), ownerNumber: TELNYX_TEST_OWNER_NUMBER },
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

// Ein Anrufstart, aus dem nur zaehlt, was beim Agenten ankommt. Beide Unterfaelle fahren
// denselben Seed und unterscheiden sich in GENAU EINER Achse: dem Feld constraints.
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
