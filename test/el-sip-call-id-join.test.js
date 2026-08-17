// ---- Der Join-Schluessel zwischen ElevenLabs-Kosten und Telefonie-Kosten -------------
// VORAUSSETZUNG fuer Fertig-Punkt 7 des Auftrags ("die Kosten sind gemessen: pro Anruf und
// pro Minute, aufgeschluesselt nach ElevenLabs, Sprachmodell und Telefonie"). Diese Datei
// baut KEINE Kostenzuordnung - sie nagelt nur fest, dass der Schluessel, ohne den es sie
// nie geben kann, bei uns ankommt und liegen bleibt.
//
// DER BELEG (17.08.2026, ein echter Anruf, s. .fortschritt.md): ein und derselbe Anruf
// hinterliess zwei Rechnungen, die sich heute nicht verbinden lassen -
//   Telnyx    GET /v2/detail_records (record_type sip-trunking):
//             sip_call_id = otb_8901m0856krnfsbvtab8zcy7r35v, cost 0,0401 USD
//   ElevenLabs  der Gespraechs-Datensatz traegt dieselbe "otb_"-Form unter
//             metadata.phone_call.call_id (GEMESSEN, s. test/fixtures/
//             elevenlabs-conversations.js)
// Die alte Kosten-Kette jointe ueber call_control_id + telnyx_session_id; BEIDES existiert
// auf der SIP-Trunk-Strecke nicht (call_control_id steht im Beleg leer,
// is_callcontrol: false). Aus der conversation_id ist der Wert NICHT berechenbar - beide
// teilen nur einen Zeitstempel-Anteil.
//
// UND ER IST FLUECHTIG: unser eigener Abbruch LOESCHT den Anbieter-Datensatz
// (convai.js#endConversation). Wer den Schluessel nicht VORHER hat, hat ihn nie wieder -
// deshalb pruefen die Faelle unten BEIDE Gelegenheiten, an denen er auftaucht.
//
// KEIN NETZ, KEIN ECHTER ANRUF: globalThis.fetch wird fuer die Dauer eines Aufrufs
// ersetzt (Muster test/el-vorlage-variablen-abgleich.test.js). Der Store ist der ECHTE
// json-Store auf einem Temp-DATA_DIR - eine Attrappe koennte einen fehlenden Schreibweg
// nicht sehen (Lehre aus EL-CONSULT BL-1).
//
// Testnamen tragen bewusst KEINE Katalog-/Abnahme-Kennung am Namensanfang (package.json
// config.i18nCatalogPattern / config.abnahmePattern), sonst landen sie in der falschen
// Bank (Lehre catalog-id-prefix-misroutes-tests).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import { publicCall } from "../src/store/views.js";
import { CONVERSATION_DONE_WITH_ANALYSIS } from "./fixtures/elevenlabs-conversations.js";

// GEMESSEN (Telnyx detail_records, Anruf vom 17.08.2026): genau dieser Wert steht auf der
// Telefonie-Rechnung. AUSGEDACHT ist allein, dass die ANTWORT DES ANRUFSTARTS ihn traegt -
// der Rumpf dieser einen Antwort wurde nie mitgeschrieben. Belegt ist dafuer das
// Anbieter-Schema (SIPTrunkOutboundCallResponse fuehrt success, message, conversation_id
// UND sip_call_id) und die Attrappe des Trockenlege-Wegs, die das Feld bereits nachbaut
// (src/elevenlabs/outbound.js#fakeSipTrunkOutboundCallResponse).
const SIP_CALL_ID_VOM_ANRUFSTART = "otb_8901m0856krnfsbvtab8zcy7r35v";

// GEMESSEN, kein erfundener Wert: derselbe Schluessel aus dem echten Gespraechs-Datensatz.
// Er ist der Beleg dafuer, dass die zweite Gelegenheit (Ergebnisabruf) denselben Wert
// fuehrt wie die erste.
const SIP_CALL_ID_AUS_DEM_GESPRAECH =
  CONVERSATION_DONE_WITH_ANALYSIS.metadata.phone_call.call_id;
const CONVERSATION_ID = CONVERSATION_DONE_WITH_ANALYSIS.conversation_id;

const START_PATH = "/v1/convai/sip-trunk/outbound-call";

// Klein, damit der Ergebnisabruf im Test in Millisekunden aufloest statt im
// Produktionstakt (Muster FAKE_RESULT_POLL_MS, el-vorlage-variablen-abgleich.test.js).
const POLL_MS = 5;
const WARTE_MS = 4000;
const WARTE_TAKT_MS = 10;

let jsonStore, makePgStore, PGlite, BOOTSTRAP, dataDir;

before(async () => {
  // DATA_DIR VOR den store-Imports binden: json.js bindet seinen Dateipfad beim Import
  // (Muster test/elevenlabs-consult-webhook-blockers.test.js).
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-el-sipcallid-"));
  process.env.DATA_DIR = dataDir;
  await import("../src/config.js");
  jsonStore = await import("../src/store/json.js");
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP } = await import("../src/store/defaults.js"));
});

function testConfig() {
  return {
    voice: {
      elevenLabsOutbound: {
        apiKey: "sipcallid-test-key",
        agentId: "sipcallid-agent",
        agentPhoneNumberId: "sipcallid-phnum",
        apiBase: "https://sipcallid-test.invalid",
        resultPollMs: POLL_MS,
      },
    },
    telnyx: { telnyxElevenLabs: { voiceId: "sipcallid-test-stimme" } },
    // MUSS false sein: der Trockenlege-Schalter ersetzt den Anrufstart durch eine
    // Attrappe - dann pruefte dieser Test die Attrappe statt den Weg (s. Modul-Kopf
    // outbound.js, OUT-05-EL).
    safety: { fakeOriginateElevenlabs: false },
  };
}

// Der EINE Terminierungspfad, auf das reduziert, was dieser Test braucht: er fuehrt
// persistEnd und bill aus, genau wie telephony/call-termination.js. Nichts an ihm
// beruehrt den Schluessel - er steht hier nur, damit der Ergebnisweg durchlaeuft.
function outboundFactory(store) {
  return makeElevenLabsOutbound({
    store,
    config: testConfig(),
    terminateAndBillCall: async ({ persistEnd, bill }) => {
      await persistEnd?.();
      await bill?.();
    },
    billThunk: () => async () => {},
    finishCall: async () => {},
  });
}

// Ersetzt globalThis.fetch fuer die Dauer EINES Aufrufs (KEIN echtes Netz, KEIN echter
// Anruf - Auftragsgrenze). startAntwort ist der Rumpf, mit dem der Anrufstart antwortet;
// jeder andere Pfad ist der Ergebnisabruf und bekommt den gemessenen Gespraechs-Datensatz.
async function mitAttrappe(startAntwort, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(url).includes(START_PATH) ? startAntwort : CONVERSATION_DONE_WITH_ANALYSIS,
  });
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const neuerAnruf = () =>
  jsonStore.createCall({
    direction: "outbound",
    from: "+4915005550001",
    to: "+4915005550002",
    goal: "Join-Schluessel sichern",
    tenantId: BOOTSTRAP,
  });

// Wartet, bis das Praedikat greift - der Ergebnisabruf laeuft als setTimeout-Takt, nicht
// synchron zum Aufruf.
async function warteBis(pruefung) {
  const grenze = Date.now() + WARTE_MS;
  while (Date.now() < grenze) {
    if (pruefung()) return true;
    await new Promise((weiter) => setTimeout(weiter, WARTE_TAKT_MS));
  }
  return false;
}

// Beendet den Anruf, damit der armierte Ergebnis-Takt sich beim naechsten Tick selbst
// stoppt (pollConversationResult steigt bei status !== "active" sofort aus). Ohne das
// liefe die Schleife nach dem Test gegen die abgeraeumte Attrappe weiter.
const anrufStillegen = (callId) => jsonStore.endCallRecord(callId, "completed");

// ---- ROTPROBE 1: der Anrufstart ------------------------------------------------------
test("der Anrufstart persistiert die sip_call_id am Anruf-Datensatz", async () => {
  const call = neuerAnruf();
  assert.equal(call.sipCallId, null, "Call-Default: null, nie undefined (json<->pg-Parity)");

  const { originateCall } = outboundFactory(jsonStore);
  await mitAttrappe(
    { success: true, conversation_id: CONVERSATION_ID, sip_call_id: SIP_CALL_ID_VOM_ANRUFSTART },
    () => originateCall(jsonStore.getCall(call.id)),
  );
  anrufStillegen(call.id);

  assert.equal(
    jsonStore.getCall(call.id).sipCallId,
    SIP_CALL_ID_VOM_ANRUFSTART,
    "ohne diesen Wert am Datensatz laesst sich der Telnyx-Beleg dem Anruf nie mehr zuordnen - der Anbieter-Datensatz, der ihn sonst noch traegt, wird von unserem eigenen Abbruch geloescht",
  );
  // Positiv-Kontrolle: der Weg ist wirklich gelaufen, der Fall misst nicht bloss einen
  // unveraenderten Default (ein Weg, der gar nichts schreibt, bestuende sonst jede
  // Abwesenheits-Pruefung).
  assert.equal(
    jsonStore.getCall(call.id).elevenlabsConversationId,
    CONVERSATION_ID,
    "der Anrufstart muss gelaufen sein - sonst misst der Fall darueber nichts",
  );
});

// ---- ROTPROBE 1b: die zweite Gelegenheit, VOR jedem Loeschen --------------------------
test("liefert der Anrufstart keine sip_call_id, holt der Ergebnisabruf sie aus dem Gespraechs-Datensatz nach", async () => {
  const call = neuerAnruf();

  const { originateCall } = outboundFactory(jsonStore);
  const gefunden = await mitAttrappe(
    // KEIN sip_call_id im Anrufstart - genau die Lage, in der die erste Gelegenheit
    // ausfaellt. Der Anruf darf daran NICHT scheitern (er laeuft zu diesem Zeitpunkt
    // bereits), der Schluessel muss aber trotzdem ankommen.
    { success: true, conversation_id: CONVERSATION_ID },
    async () => {
      await originateCall(jsonStore.getCall(call.id));
      return warteBis(() => Boolean(jsonStore.getCall(call.id)?.sipCallId));
    },
  );
  anrufStillegen(call.id);

  assert.ok(gefunden, "der Ergebnisabruf hat den Schluessel nicht nachgeholt");
  assert.equal(
    jsonStore.getCall(call.id).sipCallId,
    SIP_CALL_ID_AUS_DEM_GESPRAECH,
    "metadata.phone_call.call_id ist derselbe 'otb_'-Schluessel - er wird gelesen, BEVOR der Loeschversuch den Anbieter-Datensatz mitnimmt",
  );
});

// ---- ROTPROBE 2: beide Backends -------------------------------------------------------
// Ein halbes Paar ist im Repo schon einmal zurueckgerollt worden (Commit deb9c8d): ein
// Feld, das nur in EINEM Backend lebt, ist in der Produktion (pg) nicht vorhanden,
// waehrend der lokale json-Dev es gruen sieht.
test("der Schluessel ueberlebt das json-Backend und ist set-once", () => {
  const call = jsonStore.createCall({
    direction: "outbound",
    from: "+49",
    to: "+49",
    tenantId: BOOTSTRAP,
  });

  jsonStore.recordSipCallId(call.id, SIP_CALL_ID_VOM_ANRUFSTART);
  jsonStore.recordSipCallId(call.id, "otb_zweiter_versuch");
  assert.equal(
    jsonStore.getCall(call.id).sipCallId,
    SIP_CALL_ID_VOM_ANRUFSTART,
    "ein zweiter Schreiber darf den ersten nicht ueberschreiben (set-once) - Anrufstart und Ergebnisabruf schreiben denselben Wert, und der frueheste zaehlt",
  );

  const aufPlatte = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  const gefunden = aufPlatte.calls.find((eintrag) => eintrag.sipCallId === SIP_CALL_ID_VOM_ANRUFSTART);
  assert.equal(gefunden?.id, call.id, "der Schluessel ueberlebt JSON.stringify/parse");
});

test("der Schluessel ueberlebt das pg-Backend (Spalte + Flush + rowToCall)", async () => {
  const db = new PGlite();
  const runner = {
    withClient: (fn) =>
      fn({ query: (sql, params) => db.query(sql, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();

  const call = store.createCall({
    direction: "outbound",
    from: "+49",
    to: "+49",
    tenantId: BOOTSTRAP,
  });
  assert.equal(call.sipCallId, null, "pg-Call-Default: null, nie undefined");

  store.recordSipCallId(call.id, SIP_CALL_ID_VOM_ANRUFSTART);
  await store.save();

  const wiedergeoeffnet = makePgStore(runner);
  await wiedergeoeffnet.init();
  assert.equal(
    wiedergeoeffnet.getCall(call.id).sipCallId,
    SIP_CALL_ID_VOM_ANRUFSTART,
    "ohne Spalte + ON CONFLICT DO UPDATE SET + rowToCall ginge der Schluessel beim Restart verloren UND der naechste Flush schriebe NULL zurueck",
  );
});

// ---- Sichtbarkeit ---------------------------------------------------------------------
// publicCall ist eine SPERRliste: was dort steht, wird gestrichen. Der Schluessel bleibt
// SICHTBAR - wie sein Geschwister-Handle elevenlabsConversationId auf demselben Weg, und
// aus einem Grund: genau diese Kennung braucht der Betreiber, um den Telnyx-Beleg eines
// Anrufs von Hand zu finden. Er ist weder PII noch Geheimnis noch ein Kostenwert. Die
// Kosten-Felder daneben BLEIBEN gestrichen - dieser Fall bewacht beides zugleich, damit
// eine kuenftige Aenderung an publicCall nicht versehentlich die Abrechnungs-Achse
// mitoeffnet.
test("publicCall zeigt den Join-Schluessel und streicht weiterhin die Kosten-Felder", () => {
  const sicht = publicCall({
    id: "call_sichtbarkeit",
    sipCallId: SIP_CALL_ID_VOM_ANRUFSTART,
    streamToken: "geheim",
    estimatedCostCents: 42,
    actualCostMicroCents: 4200,
    telnyxConversationId: "conv-telnyx",
  });

  assert.equal(sicht.sipCallId, SIP_CALL_ID_VOM_ANRUFSTART);
  assert.equal(sicht.streamToken, undefined, "das Zugangsgeheimnis darf die API nie verlassen");
  assert.equal(sicht.estimatedCostCents, undefined, "Kostenwerte bleiben gestrichen");
  assert.equal(sicht.actualCostMicroCents, undefined, "Kostenwerte bleiben gestrichen");
  assert.equal(sicht.telnyxConversationId, undefined, "Bestandsverhalten unveraendert");
});
