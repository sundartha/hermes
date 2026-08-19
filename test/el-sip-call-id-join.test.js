// ---- Der Join-Schluessel zwischen ElevenLabs-Kosten und Telefonie-Kosten -------------
// VORAUSSETZUNG fuer Fertig-Punkt 7 des Auftrags ("die Kosten sind gemessen: pro Anruf und
// pro Minute, aufgeschluesselt nach ElevenLabs, Sprachmodell und Telefonie"). Diese Datei
// baut KEINE Kostenzuordnung - sie nagelt nur fest, dass der Schluessel, ohne den es sie
// nie geben kann, bei uns ankommt und liegen bleibt.
//
// DER BELEG (17.08.2026, zwei echte Anrufe, s. .fortschritt.md): ein und derselbe Anruf
// hinterliess zwei Rechnungen, die sich nur ueber die "otb_"-Kennung verbinden lassen -
//   Telnyx      GET /v2/detail_records (record_type sip-trunking): sip_call_id = "otb_..."
//   ElevenLabs  der Gespraechs-Datensatz traegt denselben Wert unter
//               metadata.phone_call.call_id (GEMESSEN, s. test/fixtures/
//               elevenlabs-conversations.js)
// Die alte Kosten-Kette jointe ueber call_control_id + telnyx_session_id; BEIDES existiert
// auf der SIP-Trunk-Strecke nicht (call_control_id steht im Beleg leer,
// is_callcontrol: false). Aus der conversation_id ist der Wert NICHT berechenbar - beide
// teilen nur einen Zeitstempel-Anteil.
//
// DIE NAMENSFALLE, an Anruf 2 gemessen (JOIN_SCHLUESSEL_ANRUF_2): die Antwort des
// AnrufSTARTS fuehrt unter dem Namen sip_call_id einen VOELLIG ANDEREN Wert ("SCL_...",
// in Wahrheit ElevenLabs' call_sid). Zwei Felder, an beiden Enden gleich benannt, mit
// verschiedenen Werten - wer den Namen als Beleg nimmt, joint ins Leere. Deshalb ist die
// Antwort des Anrufstarts hier KEINE Quelle mehr, und deshalb steht ein Form-Waechter vor
// dem Feld (src/telephony/sip-call-id.js).
//
// UND ER IST FLUECHTIG: unser eigener Abbruch LOESCHT den Anbieter-Datensatz
// (convai.js#endConversation). Wer den Schluessel nicht vor dem Loeschen hat, hat ihn nie
// wieder - der Ergebnisabruf laeuft deshalb auf BEIDEN Wegen davor.
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
import { isTelnyxSipCallId } from "../src/telephony/sip-call-id.js";
import {
  CONVERSATION_DONE_WITH_ANALYSIS,
  CONVERSATION_FAILED_INVALID_DESTINATION,
  JOIN_SCHLUESSEL_ANRUF_2,
} from "./fixtures/elevenlabs-conversations.js";

// GEMESSEN, Anruf 2 vom 17.08.2026: derselbe Anruf, zwei Werte unter demselben Feldnamen.
// Der erste steht auf der Telefonie-Rechnung, der zweite kommt aus der Anrufstart-Antwort
// und findet dort nichts.
const OTB_JOINT = JOIN_SCHLUESSEL_ANRUF_2.telnyxDetailRecord.sip_call_id;
const SCL_JOINT_NICHT = JOIN_SCHLUESSEL_ANRUF_2.startAntwort.sip_call_id;

// Der Gespraechs-Datensatz von Anruf 2 wurde nicht in voller Laenge mitgeschrieben - nur
// sein phone_call-Fragment. Der Rumpf stammt deshalb aus dem vollstaendigen echten Fund
// vom 15.08., das Fragment aus Anruf 2. Nichts daran ist erfunden, es sind zwei echte
// Aufzeichnungen in einem Testkoerper.
const GESPRAECH_ANRUF_2 = Object.freeze({
  ...CONVERSATION_DONE_WITH_ANALYSIS,
  metadata: Object.freeze({
    ...CONVERSATION_DONE_WITH_ANALYSIS.metadata,
    phone_call: JOIN_SCHLUESSEL_ANRUF_2.phoneCall,
  }),
});
const CONVERSATION_ID = CONVERSATION_DONE_WITH_ANALYSIS.conversation_id;

const START_PATH = "/v1/convai/sip-trunk/outbound-call";

// Klein, damit der Ergebnisabruf im Test in Millisekunden aufloest statt im
// Produktionstakt (Muster FAKE_RESULT_POLL_MS, el-vorlage-variablen-abgleich.test.js).
const POLL_MS = 5;
const WARTE_MS = 4000;
const WARTE_TAKT_MS = 10;

// Ein Wert, der gar kein String ist: der Waechter liest aus einer Anbieter-Antwort und
// muss jeden Typ vertragen, ohne zu werfen. Die Zahl selbst ist beliebig.
const ZAHL_STATT_STRING = 42;

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
// jeder andere Pfad ist der Ergebnisabruf und bekommt den uebergebenen Gespraechs-Datensatz.
async function mitAttrappe({ startAntwort, gespraech }, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).includes(START_PATH) ? startAntwort : gespraech),
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

// Faengt console.error fuer die Dauer eines Aufrufs ein: der Waechter meldet LAUT, und
// genau diese Meldung ist der Gegenstand der Pruefung (ausserdem bleibt die Testausgabe
// sauber).
function mitLautemLog(fn) {
  const original = console.error;
  const zeilen = [];
  console.error = (...args) => zeilen.push(args.join(" "));
  try {
    fn();
  } finally {
    console.error = original;
  }
  return zeilen;
}

// ---- ROTPROBE 1: die Namensfalle von Anruf 2 ------------------------------------------
test("die sip_call_id der Anrufstart-Antwort wird verworfen, persistiert wird der Wert aus dem Gespraechs-Datensatz", async () => {
  const call = neuerAnruf();
  assert.equal(call.sipCallId, null, "Call-Default: null, nie undefined (json<->pg-Parity)");

  const { originateCall } = outboundFactory(jsonStore);
  const gefunden = await mitAttrappe(
    {
      // GENAU die Antwort von Anruf 2: unter dem Namen sip_call_id steht der call_sid.
      startAntwort: {
        success: true,
        conversation_id: CONVERSATION_ID,
        sip_call_id: SCL_JOINT_NICHT,
      },
      gespraech: GESPRAECH_ANRUF_2,
    },
    async () => {
      await originateCall(jsonStore.getCall(call.id));
      return warteBis(() => Boolean(jsonStore.getCall(call.id)?.sipCallId));
    },
  );
  anrufStillegen(call.id);

  assert.ok(gefunden, "der Ergebnisabruf hat den Schluessel nicht geschrieben");
  assert.equal(
    jsonStore.getCall(call.id).sipCallId,
    OTB_JOINT,
    "nur der 'otb_'-Wert steht auf dem Telnyx-Beleg - er kommt aus metadata.phone_call.call_id und wird gelesen, BEVOR der Loeschversuch den Anbieter-Datensatz mitnimmt",
  );
  assert.notEqual(
    jsonStore.getCall(call.id).sipCallId,
    SCL_JOINT_NICHT,
    "die Anrufstart-Antwort liefert unter demselben Feldnamen ElevenLabs' call_sid - dieser Wert findet auf der Telefonie-Rechnung nichts (gemessen, Anruf 2 vom 17.08.2026)",
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

// ---- Der PREIS dieser Wahl, ausdruecklich festgenagelt --------------------------------
// Die Anrufstart-Antwort faellt als Quelle weg, es bleibt genau EINE: der Ergebnisabruf.
// Kommt nie ein Ergebnis (Anbieter stumm, Prozess vorher weg), bleibt der Schluessel leer
// und die Telefonie-Kosten dieses Anrufs sind ihm nicht mehr zuzuordnen. Das ist bewusst
// getragen: ein FALSCHER Schluessel joint ebenfalls nicht - er sperrt zusaetzlich (set-once)
// die einzige richtige Quelle aus und BEHAUPTET dabei eine Zuordnung, die es nicht gibt.
// Leer ist ehrlich, falsch ist eine Luege.
test("ohne Ergebnisabruf bleibt der Schluessel leer statt falsch", async () => {
  const call = neuerAnruf();

  const { originateCall } = outboundFactory(jsonStore);
  await mitAttrappe(
    {
      startAntwort: {
        success: true,
        conversation_id: CONVERSATION_ID,
        sip_call_id: SCL_JOINT_NICHT,
      },
      // Der Anbieter meldet ein gescheitertes Gespraech ohne brauchbaren Datensatz-Inhalt;
      // geprueft wird hier nur der Zustand DIREKT nach dem Anrufstart.
      gespraech: CONVERSATION_FAILED_INVALID_DESTINATION,
    },
    () => originateCall(jsonStore.getCall(call.id)),
  );
  const direktNachDemStart = jsonStore.getCall(call.id).sipCallId;
  anrufStillegen(call.id);

  assert.equal(
    direktNachDemStart,
    null,
    "der Anrufstart darf nichts schreiben - sein Feld traegt den call_sid, nicht den Join-Schluessel",
  );
});

// ---- ROTPROBE 2: der Waechter ---------------------------------------------------------
test("der Form-Waechter trennt den Telnyx-Schluessel vom call_sid desselben Anrufs", () => {
  assert.equal(
    isTelnyxSipCallId(JOIN_SCHLUESSEL_ANRUF_2.telnyxDetailRecord.sip_call_id),
    true,
    "der Wert vom Telnyx-Beleg MUSS durchkommen",
  );
  assert.equal(
    isTelnyxSipCallId(JOIN_SCHLUESSEL_ANRUF_2.phoneCall.call_id),
    true,
    "derselbe Wert aus dem Gespraechs-Datensatz - unsere einzige Quelle",
  );
  assert.equal(
    isTelnyxSipCallId(JOIN_SCHLUESSEL_ANRUF_2.phoneCall.call_sid),
    false,
    "der call_sid desselben Anrufs - genau der Wert, der am 17.08.2026 faelschlich als Join-Schluessel persistiert wurde",
  );
  assert.equal(
    isTelnyxSipCallId(JOIN_SCHLUESSEL_ANRUF_2.startAntwort.sip_call_id),
    false,
    "unter dem Namen sip_call_id geliefert - und trotzdem derselbe untaugliche Wert",
  );
  // Jede gemessene "otb_"-Kennung im Repo kommt durch: der Waechter ist an ECHTEN Werten
  // kalibriert, nicht an einem einzigen Beispiel.
  for (const gemessen of [
    CONVERSATION_DONE_WITH_ANALYSIS.metadata.phone_call.call_id,
    CONVERSATION_FAILED_INVALID_DESTINATION.metadata.phone_call.call_id,
  ])
    assert.equal(isTelnyxSipCallId(gemessen), true, `gemessener Wert abgewiesen: ${gemessen}`);
});

test("der Waechter ist locker genug fuer eine harmlose Formaenderung des Anbieters", () => {
  // Er prueft NUR die Namensraum-Kennung und eine grosszuegige Mindestlaenge - Zeichenvorrat,
  // Gross-/Kleinschreibung und Laenge des Rumpfes duerfen sich aendern, ohne dass ein
  // richtiger Schluessel verloren geht.
  for (const kuenftig of [
    "otb_9901M08D8GNCE3XS4XPKA1H3773A",
    "OTB_4801m08d8gnce3xs4xpka1h3773a",
    "otb_4801-m08d-8gnc-e3xs",
    "otb_4801m08d8gnce3xs4xpka1h3773a0000000000000000",
  ])
    assert.equal(isTelnyxSipCallId(kuenftig), true, `harmlose Form abgewiesen: ${kuenftig}`);

  // Was NICHT durchkommt, ist eine leere Huelse oder gar kein String - beides koennte den
  // set-once-Platz belegen, ohne je zu joinen.
  for (const untauglich of ["otb_", "otb_1234", "", null, undefined, ZAHL_STATT_STRING, {}])
    assert.equal(isTelnyxSipCallId(untauglich), false, `untaugliche Form angenommen: ${untauglich}`);
});

test("ein Wert in fremder Form belegt den set-once-Platz nicht und wird laut gemeldet", () => {
  const call = jsonStore.createCall({
    direction: "outbound",
    from: "+49",
    to: "+49",
    tenantId: BOOTSTRAP,
  });

  const zeilen = mitLautemLog(() => jsonStore.recordSipCallId(call.id, SCL_JOINT_NICHT));
  assert.equal(
    jsonStore.getCall(call.id).sipCallId,
    null,
    "ein Wert, der den Telnyx-Beleg nicht finden kann, darf nicht als Join-Schluessel durchgehen",
  );
  assert.equal(zeilen.length, 1, "die Abweisung muss LAUT sein, nicht still");
  assert.ok(
    zeilen[0].includes(SCL_JOINT_NICHT),
    `die Meldung muss den abgewiesenen Wert nennen, sonst ist sie nicht diagnostizierbar: ${zeilen[0]}`,
  );

  // DER PUNKT DES WAECHTERS: der Platz ist noch frei, die richtige Quelle kommt noch durch.
  jsonStore.recordSipCallId(call.id, OTB_JOINT);
  assert.equal(
    jsonStore.getCall(call.id).sipCallId,
    OTB_JOINT,
    "haette der fremde Wert den Platz belegt, waere der richtige Schluessel fuer immer ausgesperrt (set-once) - genau der Defekt vom 17.08.2026",
  );
});

// ---- ROTPROBE 3: beide Backends -------------------------------------------------------
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

  jsonStore.recordSipCallId(call.id, OTB_JOINT);
  jsonStore.recordSipCallId(call.id, "otb_zweiterversuch0000000000000");
  assert.equal(
    jsonStore.getCall(call.id).sipCallId,
    OTB_JOINT,
    "ein zweiter Schreiber darf den ersten nicht ueberschreiben (set-once) - ein wiederholter Ergebnisabruf traegt denselben Wert, und der frueheste zaehlt",
  );

  const aufPlatte = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  const gefunden = aufPlatte.calls.find((eintrag) => eintrag.sipCallId === OTB_JOINT);
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

  store.recordSipCallId(call.id, OTB_JOINT);
  await store.save();

  const wiedergeoeffnet = makePgStore(runner);
  await wiedergeoeffnet.init();
  assert.equal(
    wiedergeoeffnet.getCall(call.id).sipCallId,
    OTB_JOINT,
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
    sipCallId: OTB_JOINT,
    streamToken: "geheim",
    estimatedCostCents: 42,
    actualCostMicroCents: 4200,
    telnyxConversationId: "conv-telnyx",
  });

  assert.equal(sicht.sipCallId, OTB_JOINT);
  assert.equal(sicht.streamToken, undefined, "das Zugangsgeheimnis darf die API nie verlassen");
  assert.equal(sicht.estimatedCostCents, undefined, "Kostenwerte bleiben gestrichen");
  assert.equal(sicht.actualCostMicroCents, undefined, "Kostenwerte bleiben gestrichen");
  assert.equal(sicht.telnyxConversationId, undefined, "Bestandsverhalten unveraendert");
});
