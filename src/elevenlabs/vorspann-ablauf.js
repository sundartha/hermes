import { maxDurationSOf } from "../call-duration.js";
import { callFailureReason } from "../telephony/failure-reason.js";
import { CALL_CONTROL_EREIGNIS } from "../telephony/call-control-ereignis.js";
import { hangUpForCall, persistEndWithReason } from "../telephony/call-termination.js";
import { EL_DIAL_RING_TIMEOUT_S } from "./inbound-rueckfall.js";
import { INBOUND_EL_GRUND, vermerkeUebergabeGescheitert } from "./inbound-uebergabe-gescheitert.js";
import { EL_CALL_BINDING_SIP_HEADER, elSipZiel } from "./inbound-sip-uri.js";
import { STAND, makeVorspannBruecke, messeSeit } from "./vorspann-bruecke.js";
import { meldeVorspannRueckfall } from "./vorspann-erzeugen.js";
import { VORSPANN_ABLAGE_TTL_MS, VORSPANN_WAHL_GRUND, wahlSperrGrund } from "./vorspann-pruefung.js";
import { armiereVorspannFristen } from "./vorspann-fristen.js";

export const VORSPANN_PFAD = "/voice/vorspann";

const LOG_TAG = "[el-vorspann]";

const meldeStart = (callId, stand) =>
  messeSeit({ callId, messung: "playback_start", bezug: "ms_seit_abheben", stand, seit: STAND.ABGEHOBEN });

const logFehler = (aktion, callId, fehler) =>
  console.error(`${LOG_TAG} ${aktion} fehlgeschlagen call=${callId}: ${fehler.message}`);

function meldeWiedergabeStartFehler(callId, fehler) {
  logFehler("abheben", callId, fehler);
  meldeVorspannRueckfall({ callId, grund: VORSPANN_WAHL_GRUND.NICHT_ABGESPIELT });
}

function calleeAnfrage({ call, config }) {
  return {
    connectionId: config.telephony.telnyxCallControlAppId,
    to: call.to,
    from: call.from,
    webhookUrl: `${config.server.publicUrl}${VORSPANN_PFAD}?callId=${call.id}`,
    timeLimitS: maxDurationSOf(call),
    commandId: `vorspann-${call.id}`,
  };
}

function elBeinAnfrage({ call, config, calleeId, zugang }) {
  return {
    ...calleeAnfrage({ call, config }),
    to: elSipZiel(call.from),
    linkTo: calleeId,
    customHeaders: [{ name: EL_CALL_BINDING_SIP_HEADER, value: call.streamToken }],
    sipAuthUsername: zugang.username,
    sipAuthPassword: zugang.password,
    sipTransportProtocol: "TCP",
    timeoutS: EL_DIAL_RING_TIMEOUT_S,
    commandId: `vorspann-${call.id}-el`,
  };
}

async function legeBeinAuf(steuerung, callId, callControlId) {
  try {
    await steuerung.endCallViaCallControl(callControlId);
    return true;
  } catch (fehler) {
    logFehler("auflegen", callId, fehler);
    return false;
  }
}

async function legeBeideBeineAuf({ call, zustand, steuerung }) {
  zustand.stand.set(STAND.ABGEBROCHEN, Date.now());
  const beine = [zustand.calleeId, call.elCallControlId].filter(Boolean);
  beine.forEach((bein) => zustand.aufgelegt.add(bein));
  await Promise.all(
    beine.map(async (bein) => {
      if (!(await legeBeinAuf(steuerung, call.id, bein))) zustand.aufgelegt.delete(bein);
    }),
  );
}

function speichereElBein(callId, store) {
  try {
    store.save();
  } catch (fehler) {
    logFehler("el-bein-speichern", callId, fehler);
  }
}

async function waehleElBein({ call, zustand, steuerung, zugang, store, config }) {
  const { callControlId } = await steuerung.dialCallControl(elBeinAnfrage({ call, config, calleeId: zustand.calleeId, zugang }));
  if (!callControlId) throw new Error("Der Anbieter hat keine Kennung fuer das EL-Bein geliefert");
  const aufzeichnung = store.getCall(call.id);
  aufzeichnung.elCallControlId = callControlId;
  speichereElBein(call.id, store);
  if (aufzeichnung.status !== "active") await legeBeinAuf(steuerung, call.id, callControlId);
}

function vermerkeElFehler({ call, store, inboundBridges, rueckfall = VORSPANN_WAHL_GRUND.EL_FEHLER, grund = INBOUND_EL_GRUND.EL_UEBERGABE_GESCHEITERT }) {
  if (store.getCall(call.id).status !== "active") return;
  meldeVorspannRueckfall({ callId: call.id, grund: rueckfall });
  try {
    vermerkeUebergabeGescheitert({ callId: call.id, grund, nowMs: Date.now() }, { store, inboundBridges });
  } catch (fehler) {
    logFehler("vermerk", call.id, fehler);
  }
}

const vermerkeElFrist = (args) =>
  vermerkeElFehler({ ...args, rueckfall: VORSPANN_WAHL_GRUND.EL_FRIST, grund: VORSPANN_WAHL_GRUND.EL_FRIST });

const vermerkeNichtAbgespielt = ({ call, store }) => {
  try {
    store.recordFailureReason(call.id, VORSPANN_WAHL_GRUND.NICHT_ABGESPIELT);
  } catch (fehler) {
    logFehler("vermerk", call.id, fehler);
  }
};

const protokolliereFehler = (callId, aktion, schritt) => () => {
  try {
    schritt();
  } catch (fehler) {
    logFehler(aktion, callId, fehler);
  }
};

const persistEndGeschuetzt = ({ store, call, abgehoben, endStatus }) =>
  protokolliereFehler(
    call.id,
    "ende",
    persistEndWithReason({
      store,
      callId: call.id,
      reason: abgehoben ? null : callFailureReason({ status: "no-answer" }),
      endCall: () => store.endCallRecord(call.id, endStatus),
    }),
  );

const auflegenFuer = ({ aufzeichnung, traegerAuflegen, awaitAndPersistInboundElResult }) =>
  aufzeichnung.bridgedAt ? hangUpForCall({ call: aufzeichnung, hangUp: traegerAuflegen, awaitAndPersistInboundElResult }) : traegerAuflegen;

const elVorBruecke = ({ vomElBein, stand }) => vomElBein && !stand.has(STAND.BRUECKE) && !stand.has(STAND.ABGEBROCHEN);

const endStatusVon = ({ abgehoben, aufzeichnung }) => (abgehoben && !aufzeichnung.elFallbackAt && !aufzeichnung.failureReason ? "completed" : "failed");

export function makeVorspannAblauf({
  voiceControl,
  store,
  config,
  ttsStore,
  inboundBridges,
  ausgehendGesperrt,
  terminateAndBillCall,
  awaitAndPersistInboundElResult,
  billThunk,
  finishCall,
}) {
  const vermerkeElFehlerFuer = (call) => vermerkeElFehler({ call, store, inboundBridges });
  const zustaende = new Map();
  const abgehobeneAnrufe = new Set();

  async function pruefe({ call }) {
    const grund = wahlSperrGrund({ aktiv: call.status === "active", gesperrt: await ausgehendGesperrt() });
    if (grund) meldeVorspannRueckfall({ callId: call.id, grund });
    if (grund === VORSPANN_WAHL_GRUND.GESPERRT)
      throw new Error("Ausgehende Anrufe sind gesperrt (OUTBOUND_FROZEN oder Anrufpause)");
    return { grund };
  }

  async function waehle({ call, vorspann }) {
    const steuerung = voiceControl(call.provider);
    const { callControlId } = await steuerung.dialCallControl(calleeAnfrage({ call, config }));
    if (!callControlId) throw new Error("Der Anbieter hat keine Kennung fuer das neue Bein geliefert");
    if (call.status === "active") {
      const token = ttsStore.put(vorspann.audio, { bisFreigabe: true, ttlMs: VORSPANN_ABLAGE_TTL_MS });
      zustaende.set(call.id, { calleeId: callControlId, token, text: vorspann.text, stand: new Map(), aufgelegt: new Set() });
    } else await legeBeinAuf(steuerung, call.id, callControlId);
    return { callControlId };
  }

  async function beiAbgehoben({ call, zustand, zugang }) {
    if (abgehobeneAnrufe.has(call.id) || call.status !== "active") return;
    abgehobeneAnrufe.add(call.id);
    try {
      store.markAnswered(call.id);
      store.save();
    } catch (fehler) {
      logFehler("ereignis", call.id, fehler);
      return legeBeideBeineAuf({ call, zustand, steuerung: voiceControl(call.provider) });
    }
    zustand.stand.set(STAND.ABGEHOBEN, Date.now());
    const beineAuf = () => legeBeideBeineAuf({ call, zustand, steuerung: voiceControl(call.provider) });
    armiereVorspannFristen({ call, zustand, store, config, beineAuf, vermerkeElFrist: () => vermerkeElFrist({ call, store, inboundBridges }), vermerkeNichtAbgespielt: () => vermerkeNichtAbgespielt({ call, store }) });
    const audioUrl = `${config.server.publicUrl}/voice/tts/${zustand.token}`;
    const steuerung = voiceControl(call.provider);
    const [wiedergabe, elWahl] = await Promise.allSettled([
      steuerung.playbackStart(zustand.calleeId, { audioUrl }).then(() => meldeStart(call.id, zustand.stand)),
      waehleElBein({ call, zustand, steuerung, zugang, store, config }),
    ]);
    if (wiedergabe.status === "rejected") meldeWiedergabeStartFehler(call.id, wiedergabe.reason);
    if (elWahl.status === "rejected") logFehler("el-wahl", call.id, elWahl.reason);
    if (wiedergabe.status === "fulfilled" && elWahl.status === "fulfilled") return;
    if (elWahl.status === "rejected") vermerkeElFehlerFuer(call);
    await legeBeideBeineAuf({ call, zustand, steuerung });
  }

  const { beiElAngenommen, beiWiedergabeEnde } = makeVorspannBruecke({
    voiceControl,
    store,
    ttsStore,
    legeBeideBeineAuf,
    vermerkeElFehler: vermerkeElFehlerFuer,
    logFehler,
  });

  async function beiAufgelegt({ call, zustand, vomElBein }) {
    const abgehoben = abgehobeneAnrufe.delete(call.id);
    zustaende.delete(call.id);
    ttsStore.release(zustand.token);
    if (call.status !== "active") return;
    if (elVorBruecke({ vomElBein, stand: zustand.stand })) vermerkeElFehlerFuer(call);
    const andereBeinId = vomElBein ? zustand.calleeId : call.elCallControlId;
    const nochOffen = andereBeinId && !zustand.aufgelegt.has(andereBeinId);
    const aufzeichnung = store.getCall(call.id);
    const traegerAuflegen = nochOffen ? () => legeBeinAuf(voiceControl(call.provider), call.id, andereBeinId) : null;
    await terminateAndBillCall({
      persistEnd: persistEndGeschuetzt({ store, call, abgehoben, endStatus: endStatusVon({ abgehoben, aufzeichnung }) }),
      hangUp: auflegenFuer({ aufzeichnung, traegerAuflegen, awaitAndPersistInboundElResult }),
      onHangUpError: (fehler) => logFehler("nachlauf", call.id, fehler),
      bill: billThunk(finishCall, store, call.id),
      callId: call.id,
    });
  }

  const BEHANDLER = Object.freeze({
    [CALL_CONTROL_EREIGNIS.ABGEHOBEN]: (args) => (args.vomElBein ? beiElAngenommen(args) : beiAbgehoben(args)),
    [CALL_CONTROL_EREIGNIS.AUFGELEGT]: beiAufgelegt,
    [CALL_CONTROL_EREIGNIS.WIEDERGABE_ENDE]: (args) => (args.vomElBein ? undefined : beiWiedergabeEnde(args)),
  });

  async function behandle({ call, ereignis, zugang }) {
    const zustand = zustaende.get(call.id);
    const vomElBein = ereignis.callControlId === call.elCallControlId;
    if (!zustand || (!vomElBein && ereignis.callControlId !== zustand.calleeId)) return;
    try {
      await BEHANDLER[ereignis.ereignis]?.({ call, zustand, zugang, ereignis, vomElBein });
    } catch (fehler) {
      logFehler("ereignis", call.id, fehler);
    }
  }

  return { pruefe, waehle, behandle };
}
