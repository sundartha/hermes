import { meldeAuftragBisKlingeln } from "./anrufstart-messung.ts";
import { fristenEinstellungen } from "../config.ts";
import { maxDurationSOf } from "../call-duration.ts";
import { callFailureReason } from "../telephony/failure-reason.ts";
import { CALL_CONTROL_EREIGNIS } from "../telephony/call-control-ereignis.ts";
import { hangUpForCall, persistEndWithReason } from "../telephony/call-termination.ts";
import { EL_DIAL_RING_TIMEOUT_S } from "./inbound-rueckfall.ts";
import { INBOUND_EL_GRUND, vermerkeUebergabeGescheitert } from "./inbound-uebergabe-gescheitert.ts";
import { EL_CALL_BINDING_SIP_HEADER, elSipZiel } from "./inbound-sip-uri.ts";
import { STAND, elBeinVon, makeVorspannBruecke, messeSeit, standAusObjekt, standNachObjekt } from "./vorspann-bruecke.js";
import { NICHT_ABGESPIELT_URSACHE, meldeVorspannRueckfall } from "./vorspann-erzeugen.js";
import { VORSPANN_ABLAGE_TTL_MS, VORSPANN_WAHL_GRUND, vorspannZeileTtlMs, wahlSperrGrund } from "./vorspann-pruefung.js";
import { beiVorspannFrist, setzeKlingelfrist, setzeVorspannFristen } from "./vorspann-fristen.js";
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

const zustandsRef = (call) => ({ tenantId: call.tenantId, callId: call.id });

const zustandVon = (zeile) => zeile && { ...zeile, stand: standAusObjekt(zeile.stand), aufgelegt: new Set(zeile.aufgelegt) };

const speichereZustand = ({ vorspannZustand, call, zustand }) =>
  vorspannZustand
    .speichere({ ...zustandsRef(call), stand: standNachObjekt(zustand.stand) })
    .catch((fehler) => logFehler("zustand", call.id, fehler));

const aendereAufgelegt = (aenderung, { vorspannZustand, call, bein }) =>
  vorspannZustand[aenderung]({ ...zustandsRef(call), bein }).catch((fehler) => logFehler("zustand", call.id, fehler));

async function legeBeideBeineAuf({ call, zustand, steuerung, now, vorspannZustand }) {
  zustand.stand.set(STAND.ABGEBROCHEN, now());
  const beine = [zustand.calleeId, elBeinVon(call, zustand)].filter(Boolean);
  await speichereZustand({ vorspannZustand, call, zustand });
  await Promise.all(
    beine.map(async (bein) => {
      zustand.aufgelegt.add(bein);
      await aendereAufgelegt("legeAufgelegtAn", { vorspannZustand, call, bein });
      if (await legeBeinAuf(steuerung, call.id, bein)) return;
      zustand.aufgelegt.delete(bein);
      await aendereAufgelegt("nimmAufgelegtWeg", { vorspannZustand, call, bein });
    }),
  );
  await speichereZustand({ vorspannZustand, call, zustand });
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
  const ursache = [ereignis.hangupCause && `hangup_cause=${ereignis.hangupCause}`, ereignis.sipHangupCause && `sip_hangup_cause=${ereignis.sipHangupCause}`];
  const grund = [INBOUND_EL_GRUND.EL_UEBERGABE_GESCHEITERT, ...ursache].filter(Boolean).join(" ");
  await vermerkeElFehler({ ...args, rueckfall: EL_NICHT_ANGENOMMEN, grund });
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

const meldeNichtAbgespielt = ({ call, store }) => {
  meldeVorspannRueckfall({ callId: call.id, grund: VORSPANN_WAHL_GRUND.NICHT_ABGESPIELT, ursache: NICHT_ABGESPIELT_URSACHE.KEIN_ENDE_EREIGNIS });
  vermerkeNichtAbgespielt({ call, store });
};

async function setzeFristenGeschuetzt({ call, store, config, now }) {
  try {
    await setzeVorspannFristen({ call, store, config, jetzt: now });
    return true;
  } catch (fehler) {
    logFehler("frist", call.id, fehler);
    return false;
  }
}

const beiVorspannFristVon = ({ store, inboundBridges, now, ladeZustand, beineAuf, beiKlingel }) => async ({ callId, frist }) => {
  if (frist === "klingel") return beiKlingel(callId);
  const call = await store.leseCall(callId);
  const melde = { wiedergabe: () => meldeNichtAbgespielt({ call, store }), elBein: () => vermerkeElFrist({ call, store, inboundBridges, now }) };
  await beiVorspannFrist({ frist, call, ladeZustand, melde, beineAuf: (zustand) => beineAuf(call, zustand) });
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

async function beiKlingelfrist({ callId, ladeZustand, store, voiceControl, beiAufgelegt, vorspannZustand }) {
  const call = await store.leseCall(callId);
  const zustand = call.status === "active" ? await ladeZustand(call) : undefined;
  if (!zustand || zustand.abgehoben) return;
  await legeBeinAuf(voiceControl(call.provider), callId, zustand.calleeId);
  const zeile = await vorspannZustand.entnimm(zustandsRef(call));
  if (!zeile) return;
  await beiAufgelegt({ call, zustand, vomElBein: false, abgehoben: false, aufgelegt: new Set(zeile.aufgelegt) });
}

const setzeKlingelfristGeschuetzt = ({ call, store, config, now, beiFehler }) =>
  setzeKlingelfrist({ call, store, config, jetzt: now }).catch(async (fehler) => {
    logFehler("frist", call.id, fehler);
    await beiFehler();
  });

async function waehleBein({ steuerung, call, token, vorspann, config, ttsStore, vorspannZustand }) {
  try {
    const { vorspannKlingelFristMs, vorspannWiedergabeFristMs, bridgeStartDeadlineMs } = config.voice.elevenLabsOutbound;
    const ttlMs = vorspannZeileTtlMs({ klingelFristMs: vorspannKlingelFristMs, wiedergabeFristMs: vorspannWiedergabeFristMs, bridgeStartDeadlineMs, fristenTaktMs: fristenEinstellungen.fristenTaktMs });
    await vorspannZustand.anlegen({ ...zustandsRef(call), token, text: vorspann.text, ttlMs });
    const { callControlId } = await steuerung.dialCallControl(calleeAnfrage({ call, config }));
    if (!callControlId) throw new Error("Der Anbieter hat keine Kennung fuer das neue Bein geliefert");
    return callControlId;
  } catch (fehler) {
    ttsStore.release(token);
    await vorspannZustand.loesche(zustandsRef(call));
    throw fehler;
  }
}

async function verwirfBein({ steuerung, call, callControlId, token, ttsStore, vorspannZustand }) {
  ttsStore.release(token);
  await legeBeinAuf(steuerung, call.id, callControlId);
  await vorspannZustand.loesche(zustandsRef(call));
}

export function makeVorspannAblauf({
  voiceControl,
  store,
  config,
  ttsStore,
  vorspannZustand,
  inboundBridges,
  ausgehendGesperrt,
  terminateAndBillCall,
  awaitAndPersistInboundElResult,
  billThunk,
  finishCall,
  now,
}) {
  const vermerkeElFehlerFuer = (call) => vermerkeElFehler({ call, store, inboundBridges, now });
  const legeBeideBeineAufMitUhr = (args) => legeBeideBeineAuf({ ...args, now, vorspannZustand });
  const beineAufFuer = (call, zustand) => legeBeideBeineAufMitUhr({ call, zustand, steuerung: voiceControl(call.provider) });
  const ladeZustand = async (call) => zustandVon(await vorspannZustand.lade(zustandsRef(call)));

  async function waehle({ call, vorspann }) {
    const steuerung = voiceControl(call.provider);
    const token = await ttsStore.put(vorspann.audio, { bisFreigabe: true, ttlMs: VORSPANN_ABLAGE_TTL_MS });
    const callControlId = await waehleBein({ steuerung, call, token, vorspann, config, ttsStore, vorspannZustand });
    if (call.status === "active") {
      await vorspannZustand.setzeCallee({ ...zustandsRef(call), calleeId: callControlId });
      await setzeKlingelfristGeschuetzt({ call, store, config, now, beiFehler: () => beiKlingelfrist({ callId: call.id, ladeZustand, store, voiceControl, beiAufgelegt, vorspannZustand }) });
    } else await verwirfBein({ steuerung, call, callControlId, token, ttsStore, vorspannZustand });
    return { callControlId };
  }

  async function beiAbgehoben({ call, zustand, zugang }) {
    if (call.status !== "active" || !(await vorspannZustand.beanspruecheAbgehoben(zustandsRef(call)))) return;
    try {
      await store.markAnswered(call.id);
      store.save();
    } catch (fehler) {
      logFehler("ereignis", call.id, fehler);
      return legeBeideBeineAufMitUhr({ call, zustand, steuerung: voiceControl(call.provider) });
    }
    zustand.stand.set(STAND.ABGEHOBEN, now());
    await speichereZustand({ vorspannZustand, call, zustand });
    if (!(await setzeFristenGeschuetzt({ call, store, config, now }))) return legeBeideBeineAufMitUhr({ call, zustand, steuerung: voiceControl(call.provider) });
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
    vorspannZustand,
    legeBeideBeineAuf: legeBeideBeineAufMitUhr,
    vermerkeElFehler: vermerkeElFehlerFuer, vermerkeNichtAbgespielt: (call) => vermerkeNichtAbgespielt({ call, store }),
    logFehler,
    now,
  });

  async function beiAufgelegt({ call, zustand, vomElBein, ereignis, abgehoben = zustand.abgehoben, aufgelegt = zustand.aufgelegt }) {
    ttsStore.release(zustand.token);
    if (call.status !== "active") return;
    if (elVorBruecke({ vomElBein, stand: zustand.stand })) await vermerkeElNichtAngenommen({ call, store, inboundBridges, now, ereignis });
    const andereBeinId = vomElBein ? zustand.calleeId : elBeinVon(call, zustand);
    const nochOffen = andereBeinId && !aufgelegt.has(andereBeinId);
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
    [CALL_CONTROL_EREIGNIS.AUFGELEGT]: async (args) => {
      const zeile = await vorspannZustand.entnimm(zustandsRef(args.call));
      if (zeile) await beiAufgelegt({ ...args, aufgelegt: new Set(zeile.aufgelegt) });
    },
    [CALL_CONTROL_EREIGNIS.WIEDERGABE_ENDE]: (args) => (args.vomElBein ? undefined : beiWiedergabeEnde(args)),
  });

  async function behandle({ call, ereignis, zugang }) {
    try {
      const zustand = await ladeZustand(call);
      const vomElBein = ereignis.callControlId === (zustand ? elBeinVon(call, zustand) : call.elCallControlId);
      if (!zustand) return await behandleOhneZustand({ voiceControl, store, terminateAndBillCall, billThunk, finishCall, beiAufgelegt, logFehler, call, ereignis, vomElBein, now });
      zustand.calleeId ??= await vorspannZustand.setzeCallee({ ...zustandsRef(call), calleeId: ereignis.callControlId });
      if (!vomElBein && ereignis.callControlId !== zustand.calleeId) return;
      await BEHANDLER[ereignis.ereignis]?.({ call, zustand, zugang, ereignis, vomElBein });
      await speichereZustand({ vorspannZustand, call, zustand });
    } catch (fehler) {
      logFehler("ereignis", call.id, fehler);
    }
  }

  return { pruefe: ({ call }) => pruefeWahl({ call, ausgehendGesperrt }), waehle, beiFrist: beiVorspannFristVon({ store, inboundBridges, now, ladeZustand, beineAuf: beineAufFuer, beiKlingel: (callId) => beiKlingelfrist({ callId, ladeZustand, store, voiceControl, beiAufgelegt, vorspannZustand }) }), behandle: (args) => (args.ereignis.ereignis === CALL_CONTROL_EREIGNIS.KLINGELT ? meldeAuftragBisKlingeln({ ...args, jetzt: now() }) : behandle(args)), gesagterText: (callId, tenantId) => vorspannZustand.leseText({ tenantId, callId }) };
}
