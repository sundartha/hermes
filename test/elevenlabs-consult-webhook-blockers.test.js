// Vier BELEGTE Blocker des ElevenLabs-Rueckfrage-Webhooks (POST /webhooks/elevenlabs/consult),
// je als Test festgenagelt. ABSICHTLICH ROT: jeder Fall beschreibt den SOLL-Zustand, den der
// Reparatur-Schritt herstellt - gegen den heutigen Code misst er den belegten Ist-Zustand als
// Verstoss. Wird einer gruen, ohne dass repariert wurde, misst er den Blocker nicht.
//
// BL-1 TOTER ENDPUNKT: call.elevenlabsConversationId wird in ganz src/ NIRGENDS geschrieben -
//   kein Call-Default (store/json.js), keine pg-Spalte, kein rowToCall-Eintrag, kein Mutator.
//   Der Webhook bindet aber AUSSCHLIESSLICH ueber dieses Feld (routes/webhooks-elevenlabs.js:77).
//   Im Produktivbetrieb findet er deshalb nie einen Anruf und antwortet nach dem Token-Check
//   immer 404; nur ein von Hand geseedeter Fixture-Zustand trifft den Gutfall. BL-1a/BL-1b
//   messen deshalb den REGULAEREN Schreibweg (Muster telnyxConversationId /
//   recordTelnyxConversationId, AL-P1) statt eines Seeds - ein Seed kann einen fehlenden
//   Schreibweg nicht sehen.
// BL-2 KOSTEN-RIEGEL FEHLT: consultAllowed (routes/webhooks-elevenlabs.js:87) baut die
//   Faehigkeitspruefung neben consultAvailableFor (consult/in-call.js:94) NEU und laesst dabei
//   MAX_IN_CALL_CONSULTS_PER_CALL weg. Das Laufwerk kann beliebig viele Rueckfragen stellen,
//   und jede haelt das kostende Gespraech bis CONSULT_OPEN_MS offen.
// BL-3 RICHTUNGS-GATE FEHLT: derselben Neuzusammensetzung fehlt call.direction === "outbound",
//   das consult/in-call.js:86 ausdruecklich als Sicherheitskern fuehrt - fremde Inbound-Rede
//   darf NIE als Rueckfrage in den Tenant-Kontext exportiert werden.
// BL-4 KEINE SLOT-OBERGRENZE: gemessen wurden 8 gleichzeitige gueltige Aufrufe am SELBEN Anruf,
//   alle bis zur Frist gehalten, jeder legte einen Consult an. MAX_OPEN_POLLS_PER_CALL /
//   MAX_OPEN_POLLS_PER_TENANT (consult/delivery.js) werden auf diesem Pfad nie angefasst.
//
// NAMENS-VERTRAG DES SCHREIBWEGS (BL-1): Feldname elevenlabsConversationId ist durch den
// bestehenden Leser in routes/webhooks-elevenlabs.js gepinnt; der Mutator heisst danach
// recordElevenlabsConversationId - Fassade (store.js), json- und pg-Backend, Wrapper-Paritaet
// wie bei recordTelnyxConversationId. Diese Datei pinnt den Namen VOR dem Bau, wie
// test/elevenlabs-consult-webhook-guards.test.js Route, Header und Codes vor dem Bau gepinnt hat.
//
// AUFBAU: BL-1a/BL-1b laufen IN-PROCESS gegen die Store-Backends (Muster
// test/al-p1-store-fields.test.js: DATA_DIR binden, DANACH dynamisch importieren; pglite fuer
// pg). BL-2/BL-3/BL-4 laufen spawn-basiert ueber die ECHTE HTTP-Route (Muster
// test/elevenlabs-consult-webhook-guards.test.js) - ein Gate, das nur in einer Funktion sitzt,
// aber nicht in der Route haengt, wuerde sonst gruen messen.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { MAX_OPEN_POLLS_PER_CALL } from "../src/consult/delivery.js";

// Statuscodes benannt statt nackt (G25). Die Ablehnungscodes sind die des Bestandsvertrags
// (test/elevenlabs-consult-webhook-guards.test.js): 404 fuer jede Faehigkeits-Ablehnung, weil
// die Existenz des Kanals selbst eine Information ist.
const HTTP_NOT_FOUND = 404;

const CONSULT_PATH = "/webhooks/elevenlabs/consult";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const TOOL_TOKEN = "el-tool-token-testgeheim";

const OUTBOUND_CALL_ID = "call_el_outbound";
const OUTBOUND_CONVERSATION_ID = "conv_el_outbound_1";
const INBOUND_CALL_ID = "call_el_inbound";
const INBOUND_CONVERSATION_ID = "conv_el_inbound_1";

const QUESTION = "Darf ich den Termin am Donnerstag zusagen?";

// Feature-Schnittmenge des Consult-Kanals, in ALLEN Faellen an: ein Gate, das nur misst,
// solange die Faehigkeit ohnehin aus ist, misst nichts (Bestandsbegruendung der Guards-Datei).
const CONSULT_ON_ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
});

// Kurze Fristen: der Webhook HAELT eine angenommene Rueckfrage offen (blockierendes Werkzeug).
// Ohne diese Werte haengt jeder Fall, der eine Annahme misst, an CONSULT_OPEN_MS (47 s). Der
// gemessene Sachverhalt haengt an keiner der beiden Zahlen.
const SHORT_CONSULT_ENV = Object.freeze({ CONSULT_WAIT_MS: "200", CONSULT_OPEN_MS: "1500" });

const WEBHOOK_ENV = Object.freeze({
  ...CONSULT_ON_ENV,
  ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
  ...SHORT_CONSULT_ENV,
});

// Grosszuegige Restlaufzeit, damit der Boot-Re-Arm (rearmActiveCallTimers) das Leg nicht als
// Zombie terminalisiert, bevor der Request ankommt - Muster der Guards-Datei.
const MAX_DURATION_S = 300;
// Das Abnehmen liegt in der VERGANGENHEIT: isInCallConsult (store/state-ops.js:843) zaehlt nur
// Rueckfragen mit askedAt >= answeredAt. Ohne gesetztes answeredAt waere inCallConsults() immer
// leer und das Kontingent aus BL-2 koennte strukturell nie greifen - der Test wuerde dann eine
// Reparatur messen, die nichts bewirkt.
const ANSWERED_AGO_MS = 5000;
// Gemessene Angriffsbreite aus der Mutationsprobe: 8 gleichzeitige gueltige Aufrufe.
const PARALLELE_AUFRUFE = 8;

const post = (srv, body, headers = {}) =>
  fetch(`${srv.localUrl}${CONSULT_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

// FLACHE Nutzlast-Form des Anbieters (gemessen am Datensatz tool_details.body eines echten
// Anrufs vom 18.08.2026) - question UND conversation_id liegen auf oberster Ebene, es gibt
// keinen "parameters"-Umschlag. Gepinnt in
// test/elevenlabs-consult-webhook-envelope.test.js; hier reicht fuer die BL-Faelle
// irgendeine ANGENOMMENE Nutzlast.
const withToken = (srv, conversationId) =>
  post(
    srv,
    { conversation_id: conversationId, question: QUESTION },
    { [TOOL_TOKEN_HEADER]: TOOL_TOKEN },
  );

const callOf = (srv, id) => srv.readStore().calls.find((call) => call.id === id);
const consultCount = (call) => (Array.isArray(call.consults) ? call.consults.length : 0);

// Ein laufender, BEREITS ABGENOMMENER Anruf mit ElevenLabs-Kennung - der Zustand, in dem das
// Laufwerk das Werkzeug ueberhaupt erst aufrufen kann.
const laufenderAnruf = (overrides) =>
  seedCall({
    status: "active",
    maxDurationS: MAX_DURATION_S,
    answeredAt: new Date(Date.now() - ANSWERED_AGO_MS).toISOString(),
    ...overrides,
  });

const outboundSeed = () =>
  seedState({
    calls: [
      laufenderAnruf({
        id: OUTBOUND_CALL_ID,
        direction: "outbound",
        elevenlabsConversationId: OUTBOUND_CONVERSATION_ID,
      }),
    ],
  });

// ---- BL-1: der Schreibweg der Bindungs-Kennung ---------------------------------------
// In-Process gegen beide Backends. dataDir wird VOR den dynamischen Imports gebunden, sonst
// haengt json.js an data/store.json des Arbeitsverzeichnisses (FILE wird beim Import gebunden).
let makePgStore, PGlite, jsonStore, maxConsultsPerCall, dataDir;
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-el-consult-"));
  process.env.DATA_DIR = dataDir;
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
  jsonStore = await import("../src/store/json.js");
  // Der Kosten-Riegel, den BL-2 einfordert - aus seiner EINEN Quelle gelesen statt im Test
  // kopiert (G5): eine kopierte Zahl kann von der Produktionsregel abdriften.
  ({ MAX_IN_CALL_CONSULTS_PER_CALL: maxConsultsPerCall } = await import(
    "../src/consult/in-call.js"
  ));
});

async function makePgTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (sql, params) => db.query(sql, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner };
}

const newCall = (over = {}) => ({
  direction: "outbound",
  from: "+49",
  to: "+49",
  tenantId: BOOTSTRAP_TENANT_ID,
  ...over,
});

test("EL-CONSULT BL-1a: die ElevenLabs-Kennung wird ueber den regulaeren Schreibweg hinterlegt und ist danach im json-Store auffindbar", () => {
  const created = jsonStore.createCall(newCall());
  assert.equal(
    created.elevenlabsConversationId,
    null,
    "Call-Default: null, nie undefined (json<->pg-Parity, Muster telnyxConversationId)",
  );

  jsonStore.recordElevenlabsConversationId(created.id, "conv_el_erste");
  jsonStore.recordElevenlabsConversationId(created.id, "conv_el_zweite");
  assert.equal(
    jsonStore.getCall(created.id).elevenlabsConversationId,
    "conv_el_erste",
    "zweiter Aufruf mit anderer Kennung aendert nichts (set-once, Muster recordTelnyxConversationId)",
  );

  // Genau der Zugriff, den die Route macht (webhooks-elevenlabs.js: activeCallByConversationId):
  // ueber die Kennung zurueck zum Anruf - und zwar von PLATTE, nicht aus einem Fixture.
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  const gefunden = onDisk.calls.find((call) => call.elevenlabsConversationId === "conv_el_erste");
  assert.equal(gefunden?.id, created.id, "Kennung ueberlebt JSON.stringify/parse und bindet den Anruf");
});

test("EL-CONSULT BL-1b: die ElevenLabs-Kennung ueberlebt Schreiben und Wiederlesen im pg-Store (Spalte + Flush + rowToCall)", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  assert.equal(created.elevenlabsConversationId, null, "pg-Call-Default: null, nie undefined");

  store.recordElevenlabsConversationId(created.id, "conv_el_pg");
  await store.save();

  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(
    reopened.getCall(created.id).elevenlabsConversationId,
    "conv_el_pg",
    "Kennung ueberlebt den Reopen - ohne Spalte + ON CONFLICT DO UPDATE SET + rowToCall ginge sie beim Restart verloren UND der naechste Flush schriebe NULL zurueck",
  );
});

// ---- BL-2: Kosten-Riegel (Rueckfragen je Anruf) ---------------------------------------
test("EL-CONSULT BL-2: ist der Deckel fuer Rueckfragen je Anruf erreicht, lehnt der Webhook ab, statt eine weitere anzulegen", async (ctx) => {
  const srv = await startServer({ env: WEBHOOK_ENV, seed: outboundSeed() });
  try {
    // Positiv-Kontrolle IM Test: das Kontingent muss vorher aufgebraucht werden koennen -
    // sonst besteht auch ein Endpunkt, der alles ablehnt, diesen Fall.
    await ctx.test("das Kontingent laesst sich regulaer aufbrauchen", async () => {
      for (let i = 0; i < maxConsultsPerCall; i++) {
        const res = await withToken(srv, OUTBOUND_CONVERSATION_ID);
        assert.ok(res.ok, `Rueckfrage ${i + 1} muss angenommen werden, war ${res.status}`);
      }
      assert.equal(consultCount(callOf(srv, OUTBOUND_CALL_ID)), maxConsultsPerCall);
    });

    await ctx.test("die Rueckfrage ueber dem Deckel wird abgelehnt", async () => {
      const res = await withToken(srv, OUTBOUND_CONVERSATION_ID);
      assert.equal(
        res.status,
        HTTP_NOT_FOUND,
        "MAX_IN_CALL_CONSULTS_PER_CALL ist erreicht - der Kanal ist fuer diesen Anruf zu",
      );
    });

    await ctx.test("es ist KEIN zusaetzlicher Consult entstanden", () => {
      assert.equal(
        consultCount(callOf(srv, OUTBOUND_CALL_ID)),
        maxConsultsPerCall,
        "jede weitere Rueckfrage haelt das kostende Gespraech bis CONSULT_OPEN_MS offen",
      );
    });
  } finally {
    await srv.stop();
  }
});

// ---- BL-3: Richtungs-Gate --------------------------------------------------------------
test("EL-CONSULT BL-3: ein INBOUND-Anruf wird abgelehnt, auch bei gueltigem Token und laufendem Gespraech", async (ctx) => {
  const srv = await startServer({
    env: WEBHOOK_ENV,
    seed: seedState({
      calls: [
        laufenderAnruf({
          id: INBOUND_CALL_ID,
          direction: "inbound",
          elevenlabsConversationId: INBOUND_CONVERSATION_ID,
        }),
        laufenderAnruf({
          id: OUTBOUND_CALL_ID,
          direction: "outbound",
          elevenlabsConversationId: OUTBOUND_CONVERSATION_ID,
        }),
      ],
    }),
  });
  try {
    await ctx.test("Inbound -> abgelehnt, fremde Rede erreicht den Tenant-Kontext nicht", async () => {
      const res = await withToken(srv, INBOUND_CONVERSATION_ID);
      assert.equal(
        res.status,
        HTTP_NOT_FOUND,
        "call.direction === 'outbound' ist der Sicherheitskern (consult/in-call.js)",
      );
      assert.equal(consultCount(callOf(srv, INBOUND_CALL_ID)), 0, "kein Consult am Inbound-Anruf");
    });

    // Gegenprobe auf DEMSELBEN Server: ein Endpunkt, der alles ablehnt, bestuende den Fall oben.
    await ctx.test("Gegenprobe: derselbe Server nimmt den gleichwertigen OUTBOUND-Anruf an", async () => {
      const res = await withToken(srv, OUTBOUND_CONVERSATION_ID);
      assert.ok(res.ok, `2xx erwartet, war ${res.status} - dann misst die Ablehnung oben nichts`);
      assert.equal(consultCount(callOf(srv, OUTBOUND_CALL_ID)), 1);
    });
  } finally {
    await srv.stop();
  }
});

// ---- BL-4: Obergrenze gleichzeitig offener Warter ---------------------------------------
test("EL-CONSULT BL-4: mehr gleichzeitige Rueckfragen am selben Anruf als erlaubt -> die ueberzaehligen werden abgelehnt statt gehalten", async (ctx) => {
  const srv = await startServer({ env: WEBHOOK_ENV, seed: outboundSeed() });
  try {
    const antworten = await Promise.all(
      Array.from({ length: PARALLELE_AUFRUFE }, () => withToken(srv, OUTBOUND_CONVERSATION_ID)),
    );
    const angenommen = antworten.filter((res) => res.ok).length;

    await ctx.test("hoechstens MAX_OPEN_POLLS_PER_CALL Aufrufe werden gehalten", () => {
      assert.ok(
        angenommen <= MAX_OPEN_POLLS_PER_CALL,
        `hoechstens ${MAX_OPEN_POLLS_PER_CALL} angenommen erwartet, waren ${angenommen} von ${PARALLELE_AUFRUFE}`,
      );
    });

    await ctx.test("Positiv-Kontrolle: mindestens ein Aufruf wird angenommen", () => {
      assert.ok(angenommen >= 1, "ein Endpunkt, der alles ablehnt, misst die Obergrenze nicht");
    });

    await ctx.test("kein Consult ueber der Obergrenze angelegt", () => {
      const angelegt = consultCount(callOf(srv, OUTBOUND_CALL_ID));
      assert.ok(
        angelegt <= MAX_OPEN_POLLS_PER_CALL,
        `hoechstens ${MAX_OPEN_POLLS_PER_CALL} Consults erwartet, waren ${angelegt}`,
      );
    });
  } finally {
    await srv.stop();
  }
});
