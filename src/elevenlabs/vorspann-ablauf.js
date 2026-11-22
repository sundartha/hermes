import { maxDurationSOf } from "../call-duration.ts";
import { callFailureReason } from "../telephony/failure-reason.ts";
import { CALL_CONTROL_EREIGNIS } from "../telephony/call-control-ereignis.ts";
import { hangUpForCall, persistEndWithReason } from "../telephony/call-termination.ts";
import { EL_DIAL_RING_TIMEOUT_S } from "./inbound-rueckfall.ts";
import { INBOUND_EL_GRUND, vermerkeUebergabeGescheitert } from "./inbound-uebergabe-gescheitert.ts";
import { EL_CALL_BINDING_SIP_HEADER, elSipZiel } from "./inbound-sip-uri.ts";
import { STAND, makeVorspannBruecke, messeSeit } from "./vorspann-bruecke.js";
import { NICHT_ABGESPIELT_URSACHE, meldeVorspannRueckfall } from "./vorspann-erzeugen.js";
import { VORSPANN_ABLAGE_TTL_MS, VORSPANN_WAHL_GRUND, wahlSperrGrund } from "./vorspann-pruefung.js";
import { armiereKlingelfrist, armiereVorspannFristen } from "./vorspann-fristen.js";
import { behandleOhneZustand } from "./vorspann-ohne-zustand.js";

export const VORSPANN_PFAD = "/voice/vorspann";

const LOG_TAG = "[el-vorspann]";

const EL_NICHT_ANGENOMMEN = "el_nicht_angenommen";
const KEIN_WERT = "-";

const meldeElBeinAufgelegt = (callId, { hangupCause, sipHangupCause, hangupSource }) =>
  console.log(
    `${LOG_TAG} el_bein_aufgelegt hangup_cause=${hangupCause ?? KEIN_WERT} sip_hangup_cause=${sipHangupCause ?? KEIN_WERT} hangup_source=${hangupSource ?? KEIN_WERT} call=${callId}`,
  );

const meldeStart = (callId, stand, jetzt) =>
  messeSeit({ callId, messung: "playback_start", bezug: "ms_seit_abheben", stand, seit: STAND.ABGEHOBEN, jetzt });

const logFehler = (aktion, callId, fehler) =>
  console.error(`${LOG_TAG} ${aktion} fehlgeschlagen call=${callId}: ${fehler.message}`);

function meldeWiedergabeStartFehler(callId, fehler) {
  logFehler("abheben", callId, fehler);
  meldeVorspannRueckfall({ callId, grund: VORSPANN_WAHL_GRUND.NICHT_ABGESPIELT, ursache: NICHT_ABGESPIELT_URSACHE.START_ABGELEHNT });
}

function behandleWiedergabeStartFehler({ call, store, wiedergabe, elWahl }) {
  if (wiedergabe.status !== "rejected") return;
  meldeWiedergabeStartFehler(call.id, wiedergabe.reason);
  if (elWahl.status === "fulfilled") vermerkeNichtAbgespielt({ call, store });
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

async function legeBeideBeineAuf({ call, zustand, steuerung, now }) {
  zustand.stand.set(STAND.ABGEBROCHEN, now());
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
  const aufzeichnung = await store.leseCall(call.id);
  aufzeichnung.elCallControlId = callControlId;
  speichereElBein(call.id, store);
  if (aufzeichnung.status !== "active") await legeBeinAuf(steuerung, call.id, callControlId);
}

async function vermerkeElFehler({ call, store, inboundBridges, now, rueckfall = VORSPANN_WAHL_GRUND.EL_FEHLER, grund = INBOUND_EL_GRUND.EL_UEBERGABE_GESCHEITERT }) {
  try {
    if ((await store.leseCall(call.id)).status !== "active") return;
    meldeVorspannRueckfall({ callId: call.id, grund: rueckfall });
    vermerkeUebergabeGescheitert({ callId: call.id, grund, nowMs: now() }, { store, inboundBridges });
  } catch (fehler) {
    logFehler("vermerk", call.id, fehler);
  }
}

async function vermerkeElNichtAngenommen({ ereignis, ...args }) {
  meldeElBeinAufgelegt(args.call.id, ereignis);
  await vermerkeElFehler({ ...args, rueckfall: EL_NICHT_ANGENOMMEN });
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

const protokolliereFehler = (callId, aktion, schritt) => async () => {
  try {
    await schritt();
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

const auflegenFuer = ({ warBereitsGebunden, aufzeichnung, traegerAuflegen, awaitAndPersistInboundElResult }) =>
  warBereitsGebunden ? hangUpForCall({ call: aufzeichnung, hangUp: traegerAuflegen, awaitAndPersistInboundElResult }) : traegerAuflegen;

const elVorBruecke = ({ vomElBein, stand }) => vomElBein && !stand.has(STAND.BRUECKE) && !stand.has(STAND.ABGEBROCHEN);

const endStatusVon = ({ abgehoben, aufzeichnung }) => (abgehoben && !aufzeichnung.elFallbackAt && !aufzeichnung.failureReason ? "completed" : "failed");

async function pruefeWahl({ call, ausgehendGesperrt }) {
  const grund = wahlSperrGrund({ aktiv: call.status === "active", gesperrt: await ausgehendGesperrt() });
  if (grund) meldeVorspannRueckfall({ callId: call.id, grund });
  if (grund === VORSPANN_WAHL_GRUND.GESPERRT)
    throw new Error("Ausgehende Anrufe sind gesperrt (OUTBOUND_FROZEN oder Anrufpause)");
  return { grund };
}

async function beiKlingelfrist({ callId, zustand, store, voiceControl, abgehobeneAnrufe, beiAufgelegt }) {
  const call = await store.leseCall(callId);
  if (call.status !== "active" || abgehobeneAnrufe.has(callId)) return;
  await legeBeinAuf(voiceControl(call.provider), callId, zustand.calleeId);
  await beiAufgelegt({ call, zustand, vomElBein: false, abgehoben: false });
}

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
  now,
  setTimer,
}) {
  const vermerkeElFehlerFuer = (call) => vermerkeElFehler({ call, store, inboundBridges, now });
  const legeBeideBeineAufMitUhr = (args) => legeBeideBeineAuf({ ...args, now });
  const zustaende = new Map();
  const abgehobeneAnrufe = new Set();

  async function waehleBein({ steuerung, call, token }) {
    try {
      const { callControlId } = await steuerung.dialCallControl(calleeAnfrage({ call, config }));
      if (!callControlId) throw new Error("Der Anbieter hat keine Kennung fuer das neue Bein geliefert");
      return callControlId;
    } catch (fehler) {
      ttsStore.release(token);
      throw fehler;
    }
  }

  async function waehle({ call, vorspann }) {
    const steuerung = voiceControl(call.provider);
    const token = await ttsStore.put(vorspann.audio, { bisFreigabe: true, ttlMs: VORSPANN_ABLAGE_TTL_MS });
    const callControlId = await waehleBein({ steuerung, call, token });
    if (call.status === "active") {
      const zustand = { calleeId: callControlId, token, text: vorspann.text, stand: new Map(), aufgelegt: new Set() };
      zustaende.set(call.id, zustand);
      armiereKlingelfrist({ setTimer, beiFrist: () => beiKlingelfrist({ callId: call.id, zustand, store, voiceControl, abgehobeneAnrufe, beiAufgelegt }) });
    } else {
      ttsStore.release(token);
      await legeBeinAuf(steuerung, call.id, callControlId);
    }
    return { callControlId };
  }

  async function beiAbgehoben({ call, zustand, zugang }) {
    if (abgehobeneAnrufe.has(call.id) || call.status !== "active") return;
    abgehobeneAnrufe.add(call.id);
    try {
      await store.markAnswered(call.id);
      store.save();
    } catch (fehler) {
      logFehler("ereignis", call.id, fehler);
      return legeBeideBeineAufMitUhr({ call, zustand, steuerung: voiceControl(call.provider) });
    }
    zustand.stand.set(STAND.ABGEHOBEN, now());
    const beineAuf = () => legeBeideBeineAufMitUhr({ call, zustand, steuerung: voiceControl(call.provider) });
    armiereVorspannFristen({ call, zustand, store, config, beineAuf, vermerkeElFrist: () => vermerkeElFrist({ call, store, inboundBridges, now }), vermerkeNichtAbgespielt: () => vermerkeNichtAbgespielt({ call, store }), setTimer });
    const audioUrl = `${config.server.publicUrl}/voice/tts/${zustand.token}`;
    const steuerung = voiceControl(call.provider);
    const [wiedergabe, elWahl] = await Promise.allSettled([
      steuerung.playbackStart(zustand.calleeId, { audioUrl }).then(() => meldeStart(call.id, zustand.stand, now())),
      waehleElBein({ call, zustand, steuerung, zugang, store, config }),
    ]);
    behandleWiedergabeStartFehler({ call, store, wiedergabe, elWahl });
    if (elWahl.status === "rejected") logFehler("el-wahl", call.id, elWahl.reason);
    if (wiedergabe.status === "fulfilled" && elWahl.status === "fulfilled") return;
    if (elWahl.status === "rejected") await vermerkeElFehlerFuer(call);
    await legeBeideBeineAufMitUhr({ call, zustand, steuerung });
  }

  const { beiElAngenommen, beiWiedergabeEnde } = makeVorspannBruecke({
    voiceControl,
    store,
    ttsStore,
    legeBeideBeineAuf: legeBeideBeineAufMitUhr,
    vermerkeElFehler: vermerkeElFehlerFuer, vermerkeNichtAbgespielt: (call) => vermerkeNichtAbgespielt({ call, store }),
    logFehler,
    now,
  });

  async function beiAufgelegt({ call, zustand, vomElBein, ereignis, abgehoben = abgehobeneAnrufe.delete(call.id) }) {
    zustaende.delete(call.id);
    ttsStore.release(zustand.token);
    if (call.status !== "active") return;
    if (elVorBruecke({ vomElBein, stand: zustand.stand })) await vermerkeElNichtAngenommen({ call, store, inboundBridges, now, ereignis });
    const andereBeinId = vomElBein ? zustand.calleeId : call.elCallControlId;
    const nochOffen = andereBeinId && !zustand.aufgelegt.has(andereBeinId);
    const aufzeichnung = await store.leseCall(call.id);
    const warBereitsGebunden = Boolean(aufzeichnung.bridgedAt), traegerAuflegen = nochOffen ? () => legeBeinAuf(voiceControl(call.provider), call.id, andereBeinId) : null;
    await terminateAndBillCall({
      persistEnd: persistEndGeschuetzt({ store, call, abgehoben, endStatus: endStatusVon({ abgehoben, aufzeichnung }) }),
      hangUp: auflegenFuer({ warBereitsGebunden, aufzeichnung, traegerAuflegen, awaitAndPersistInboundElResult }),
      onHangUpError: (fehler) => logFehler("nachlauf", call.id, fehler),
      bill: billThunk(finishCall, store, call.id),
      callId: call.id,
    });
    if (!warBereitsGebunden) void awaitAndPersistInboundElResult(call.id).catch((fehler) => logFehler("nachlauf", call.id, fehler));
  }

  const BEHANDLER = Object.freeze({
    [CALL_CONTROL_EREIGNIS.ABGEHOBEN]: (args) => (args.vomElBein ? beiElAngenommen(args) : beiAbgehoben(args)),
    [CALL_CONTROL_EREIGNIS.AUFGELEGT]: beiAufgelegt,
    [CALL_CONTROL_EREIGNIS.WIEDERGABE_ENDE]: (args) => (args.vomElBein ? undefined : beiWiedergabeEnde(args)),
  });

  async function behandle({ call, ereignis, zugang }) {
    const zustand = zustaende.get(call.id);
    const vomElBein = ereignis.callControlId === call.elCallControlId;
    try {
      if (!zustand) return await behandleOhneZustand({ voiceControl, store, terminateAndBillCall, billThunk, finishCall, beiAufgelegt, logFehler, call, ereignis, vomElBein, now });
      if (!vomElBein && ereignis.callControlId !== zustand.calleeId) return;
      await BEHANDLER[ereignis.ereignis]?.({ call, zustand, zugang, ereignis, vomElBein });
    } catch (fehler) {
      logFehler("ereignis", call.id, fehler);
    }
  }

  return { pruefe: ({ call }) => pruefeWahl({ call, ausgehendGesperrt }), waehle, behandle, gesagterText: (callId) => zustaende.get(callId)?.text };
}
