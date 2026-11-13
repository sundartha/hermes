import { HTTP_OK } from "../utils/http.ts";
import crypto from "node:crypto";
import { z } from "zod";
import { setTimeout as pause } from "node:timers/promises";
import { PROVIDER_WEBHOOK_HARDCUT_MS } from "../turn-budget.js";
import { ergebnisOderNull } from "./ergebnis-oder-null.ts";
import { escapeXml } from "./adapters/telnyx/render.ts";
import { TS_HEADER } from "./adapters/telnyx/signature.js";
import { BRIDGE_STATE, bridgeStateOf, istOutboundElProfil } from "../elevenlabs/inbound-bridge-state.js";

interface Anfrage {
  headers?: Record<string, string | undefined>;
  rawBody?: string | Buffer;
  body?: { CallSid?: unknown; CallStatus?: unknown };
  query?: { callId?: unknown; quelle?: unknown; turnToken?: unknown };
}

interface Antwort {
  status: number;
  contentType?: string | undefined;
  body: string | Buffer;
}

interface Antwortkanal {
  statusCode: number;
  status: (code: number) => unknown;
  type: (contentType: string) => unknown;
  get: (name: string) => string | undefined;
  send: (body: string | Buffer) => unknown;
  on: (ereignis: string, rueckruf: () => void) => unknown;
}

type Weiter = () => unknown;
type Wartende = Promise<Antwort | null>;
type Anker = string[];
type Geheimnis = () => string | undefined;
type Freigeben = (grund: string) => unknown;

interface Deferred {
  answer: Wartende;
  settle: (answer: Antwort | null) => void;
}

interface Bindung {
  anker: Anker;
  callSid: string;
}

interface Rueckrufe {
  beiSpaeterFreigabe: () => void;
  beiSpaeterFehler: (err: unknown) => void;
}

interface FremdeAnnahme {
  eigen: false;
  kennung: string;
  alterMs: number;
  antwort?: Antwort | null;
}

type Annahme =
  | { eigen: true; kennung: string; antwort?: Antwort | null }
  | FremdeAnnahme
  | { eigen: false; kennung: null; antwort?: Antwort | null };

interface Ablage {
  annehmen: (bindung: Bindung, rueckrufe: Rueckrufe) => Promise<Annahme>;
  lies: (kennung: string, bindung: Bindung) => Promise<{ antwort?: Antwort | null; offen?: boolean } | null>;
  uebernehmen: (kennung: string, bindung: Bindung, rueckrufe: Rueckrufe) => Promise<Annahme>;
  freigeben: (kennung: string, bindung: Bindung) => Promise<unknown>;
  beantworten: (kennung: string, bindung: Bindung, antwort: Antwort) => Promise<unknown>;
}

interface Anruf {
  webhookAnchors?: string[];
}

interface WebhookStore {
  webhookZustellung?: Ablage | null;
  getCall: (id: unknown) => Anruf | null | undefined;
  recordWebhookAnchors: (callId: unknown, anchors: Anker) => unknown;
}

interface IdempotenzAbhaengigkeiten {
  store: WebhookStore;
  keepAliveXml: (call: Anruf) => string;
  elPasswort: Geheimnis;
}

interface WachParameter {
  weg: string;
  anchorsOf: (req: Anfrage) => Anker;
  seenBefore: (req: Anfrage, anchors: Anker) => Anruf | null | undefined;
  remember: (req: Anfrage, anchors: Anker) => unknown;
  ablage?: Ablage | null;
  geheimnis: Geheimnis;
}

type Wache = (req: Anfrage, res: Antwortkanal, next: Weiter) => Promise<unknown>;
type Waechter = Record<"forIncoming" | "forTurn" | "forElRueckfall" | "forElBein" | "forElUebergabe" | "forStatus", Wache>;

interface Wartebedarf {
  ablage: Ablage | null;
  weg: string;
  angenommen: Annahme | null;
  bindung: Bindung;
}

interface Warten extends Wartebedarf {
  ankunft: number;
}

interface AblageParameter extends Wartebedarf {
  geheimnis: Geheimnis;
  freigeben: Freigeben;
}

interface SendeParameter {
  req: Anfrage;
  res: Antwortkanal;
  anchors: Anker;
  deferred: Deferred;
  remember: WachParameter["remember"];
  ablegen: (answer: Antwort) => void;
  freigeben: Freigeben;
  verwerfen: () => void;
}

const UEBERGABE_ZUSTAENDE: readonly string[] = [BRIDGE_STATE.GEBUNDEN, BRIDGE_STATE.RUECKFALL];

export const TURN_TOKEN_PARAM = "turnToken";
const TURN_TOKEN_BYTES = 8;
const ANSWER_CACHE_MAX = 200;
const FREMDE_ANNAHME_TAKT_MS = 200;
const KEEPALIVE_CONTENT_TYPE = "text/xml";
const GEHEIMNIS_MARKE = "hermes-el-sip-geheimnis-marke";
const REPLAY_LOG_PREFIX = "[webhook-idempotenz]";
const REPLAY_ART = Object.freeze({
  ANTWORT_WIEDERHOLT: "antwort_wiederholt",
  NEU_VERARBEITET: "neu_verarbeitet",
  KEEPALIVE: "keepalive",
  OHNE_ERKENNUNG: "ohne_erkennung",
  UEBERNOMMEN: "uebernommen",
});

const FREIGABE_GRUND = Object.freeze({
  ABBRUCH: "abbruch",
  ABLEGEN_FEHLGESCHLAGEN: "ablegen_fehlgeschlagen",
  SPAET: "spaet",
});

const REPLAY_GRUND = Object.freeze({ FRIST: "frist", FEHLER: "fehler" });

const ankerTeil = (wert: unknown): string => z.string().catch("").parse(wert);

export function newTurnToken(): string {
  return crypto.randomBytes(TURN_TOKEN_BYTES).toString("hex");
}

function envelopeAnchor(req: Anfrage, { callId = "" }: { callId?: string } = {}): string | null {
  const timestamp = req.headers?.[TS_HEADER];
  if (!timestamp || !req.rawBody) return null;
  const hash = crypto.createHash("sha256");
  hash.update(`${timestamp}|`);
  if (callId) hash.update(`${callId}|`);
  hash.update(req.rawBody);
  return `e:${hash.digest("hex")}`;
}

export function incomingAnchors(req: Anfrage): Anker {
  const sid = ankerTeil(req.body?.CallSid);
  return sid ? [`in:${sid}`] : [];
}

export function turnAnchors(req: Anfrage): Anker {
  const token = ankerTeil(req.query?.[TURN_TOKEN_PARAM]);
  const anchors: Anker = [];
  if (token) anchors.push(`t:${token}`);
  const envelope = envelopeAnchor(req);
  if (envelope) anchors.push(envelope);
  return anchors;
}

function queryEreignisAnker(req: Anfrage, ereignis: { praefix: string; unterscheider: unknown }): Anker {
  const { praefix, unterscheider } = ereignis;
  const callId = ankerTeil(req.query?.callId);
  const anchors = callId ? [`${praefix}:${callId}:${ankerTeil(unterscheider)}`] : [];
  const envelope = envelopeAnchor(req);
  return envelope ? [...anchors, envelope] : anchors;
}
export const elRueckfallAnchors = (req: Anfrage): Anker => queryEreignisAnker(req, { praefix: "rk", unterscheider: req.query?.quelle });
export const elUebergabeAnchors = (req: Anfrage): Anker => queryEreignisAnker(req, { praefix: "eu", unterscheider: "" });
export const elBeinAnchors = (req: Anfrage): Anker => queryEreignisAnker(req, { praefix: "eb", unterscheider: req.body?.CallStatus });

export function statusAnchors(req: Anfrage): Anker {
  const envelope = envelopeAnchor(req, { callId: ankerTeil(req.query?.callId) });
  return envelope ? [`s${envelope}`] : [];
}

function makeDeferredAnswer(): Deferred {
  const { promise, resolve } = Promise.withResolvers<Antwort | null>();
  return { answer: promise, settle: resolve };
}

const answerWithinProviderDeadline = (pending: Wartende): Wartende => ergebnisOderNull(pending, PROVIDER_WEBHOOK_HARDCUT_MS);

function replayAnswer(res: Antwortkanal, answer: Antwort): unknown {
  res.status(answer.status);
  if (answer.contentType) res.type(answer.contentType);
  return res.send(answer.body);
}

function logWiederholung(weg: string, art: string, grund: string | null = null): void {
  const zusatz = grund ? ` grund=${grund}` : "";
  console.log(`${REPLAY_LOG_PREFIX} wiederholte_zustellung weg=${weg} art=${art}${zusatz}`);
}

const logFreigabe = (weg: string, grund: string): void => {
  console.log(`${REPLAY_LOG_PREFIX} annahme_freigegeben weg=${weg} grund=${grund}`);
};

const logOhneErkennung = (weg: string, err: unknown): void => {
  logWiederholung(weg, REPLAY_ART.OHNE_ERKENNUNG, Reflect.get(Object(err), "frist") ? REPLAY_GRUND.FRIST : REPLAY_GRUND.FEHLER);
};

interface WartendeParameter {
  pending: Wartende;
  weg: string;
  res: Antwortkanal;
  next: Weiter;
}

async function beantworteWartende({ pending, weg, res, next }: WartendeParameter): Promise<unknown> {
  const answer = await answerWithinProviderDeadline(pending);
  logWiederholung(weg, answer ? REPLAY_ART.ANTWORT_WIEDERHOLT : REPLAY_ART.NEU_VERARBEITET);
  return answer ? replayAnswer(res, answer) : next();
}

const alsText = (body: string | Buffer): string => (Buffer.isBuffer(body) ? body.toString("utf8") : body);

function geheimnisRaus(answer: Antwort, geheimnis: Geheimnis): Antwort {
  const wert = geheimnis();
  if (!wert) return answer;
  return { ...answer, body: alsText(answer.body).split(escapeXml(wert)).join(GEHEIMNIS_MARKE) };
}

function geheimnisEin(antwort: Antwort, geheimnis: Geheimnis): Antwort | null {
  const text = alsText(antwort.body);
  if (!text.includes(GEHEIMNIS_MARKE)) return antwort;
  const wert = geheimnis();
  if (!wert) return null;
  return { ...antwort, body: text.split(GEHEIMNIS_MARKE).join(escapeXml(wert)) };
}

interface LieferParameter {
  deferred: Deferred;
  weg: string;
  res: Antwortkanal;
}

function liefereAusAblage({ deferred, weg, res, antwort }: LieferParameter & { antwort: Antwort }): unknown {
  deferred.settle(antwort);
  logWiederholung(weg, REPLAY_ART.ANTWORT_WIEDERHOLT);
  return replayAnswer(res, antwort);
}

function liefereKeepAlive({ deferred, weg, res, xml }: LieferParameter & { xml: string }): unknown {
  const keepAlive = { status: HTTP_OK, contentType: KEEPALIVE_CONTENT_TYPE, body: xml };
  deferred.settle(keepAlive);
  logWiederholung(weg, REPLAY_ART.KEEPALIVE);
  return replayAnswer(res, keepAlive);
}

const signierterCallSid = (req: Anfrage): string => ankerTeil(req.body?.CallSid);

const spaetFreigabe = (weg: string): Rueckrufe => ({
  beiSpaeterFreigabe: () => {
    logFreigabe(weg, FREIGABE_GRUND.SPAET);
  },
  beiSpaeterFehler: (err: unknown) => {
    logOhneErkennung(weg, err);
  },
});

async function annehmenOderNull({ ablage, weg, bindung }: Omit<Wartebedarf, "angenommen">): Promise<Annahme | null> {
  if (!ablage) return null;
  try {
    return await ablage.annehmen(bindung, spaetFreigabe(weg));
  } catch (err) {
    logOhneErkennung(weg, err);
    return null;
  }
}

async function lesenBis({ ablage, kennung, bindung, ende }: { ablage: Ablage; kennung: string; bindung: Bindung; ende: number }): Promise<Antwort | null> {
  const gelesen = await ergebnisOderNull(ablage.lies(kennung, bindung), ende - Date.now());
  if (!gelesen || gelesen.antwort || !gelesen.offen) return gelesen?.antwort ?? null;
  if (Date.now() + FREMDE_ANNAHME_TAKT_MS >= ende) return null;
  await pause(FREMDE_ANNAHME_TAKT_MS);
  return lesenBis({ ablage, kennung, bindung, ende });
}

async function uebernehmen({ ablage, weg, angenommen, bindung, ankunft }: Warten & { ablage: Ablage; angenommen: FremdeAnnahme }): Promise<{ angenommen: Annahme; antwort?: Antwort | null | undefined }> {
  const uebernommen = await ablage.uebernehmen(angenommen.kennung, bindung, spaetFreigabe(weg));
  if (uebernommen.eigen) logWiederholung(weg, `${REPLAY_ART.UEBERNOMMEN} warte_ms=${String(Date.now() - ankunft)}`);
  return { angenommen: uebernommen.eigen ? uebernommen : angenommen, antwort: uebernommen.antwort };
}

async function wartenAufFremdeAntwort({ ablage, weg, angenommen, bindung, ankunft }: Warten): Promise<{ angenommen: Annahme | null; antwort?: Antwort | null | undefined }> {
  if (!ablage || angenommen?.eigen !== false || angenommen.antwort || !angenommen.kennung) {
    return { angenommen, antwort: angenommen?.antwort ?? null };
  }
  const ende = Date.now() + PROVIDER_WEBHOOK_HARDCUT_MS - angenommen.alterMs;
  try {
    const gelesen = await lesenBis({ ablage, kennung: angenommen.kennung, bindung, ende });
    if (gelesen) return { angenommen, antwort: gelesen };
    return await uebernehmen({ ablage, weg, angenommen, bindung, ankunft });
  } catch (err) {
    logOhneErkennung(weg, err);
    return { angenommen, antwort: null };
  }
}

function freigabeFuer({ ablage, weg, angenommen, bindung }: Wartebedarf): Freigeben {
  if (!ablage || !angenommen?.eigen) return () => undefined;
  return (grund: string) =>
    ablage
      .freigeben(angenommen.kennung, bindung)
      .then(() => {
        logFreigabe(weg, grund);
      })
      .catch((err: unknown) => {
        logOhneErkennung(weg, err);
      });
}

function antwortAblegen({ ablage, weg, angenommen, bindung, geheimnis, freigeben }: AblageParameter): (answer: Antwort) => void {
  if (angenommen && !angenommen.eigen) logWiederholung(weg, REPLAY_ART.NEU_VERARBEITET);
  if (!ablage || !angenommen?.eigen) return () => undefined;
  return (answer: Antwort) => {
    if (typeof answer.body !== "string" && !Buffer.isBuffer(answer.body)) return;
    ablage
      .beantworten(angenommen.kennung, bindung, geheimnisRaus(answer, geheimnis))
      .catch((err: unknown) => {
        logOhneErkennung(weg, err);
        return freigeben(FREIGABE_GRUND.ABLEGEN_FEHLGESCHLAGEN);
      });
  };
}

function rememberAnswerOnSend({ req, res, anchors, deferred, remember, ablegen, freigeben, verwerfen }: SendeParameter): void {
  const send = res.send.bind(res);
  let gesendet = false;
  Object.assign(res, {
    send(body: string | Buffer) {
      gesendet = true;
      try {
        const answer = { status: res.statusCode, contentType: res.get("Content-Type"), body };
        deferred.settle(answer);
        remember(req, anchors);
        ablegen(answer);
      } catch (err) {
        console.error(REPLAY_LOG_PREFIX, Reflect.get(Object(err), "message"));
      }
      return send(body);
    },
  });
  res.on("close", () => {
    deferred.settle(null);
    if (gesendet) return;
    verwerfen();
    freigeben(FREIGABE_GRUND.ABBRUCH);
  });
}

export function makeWebhookIdempotenz({ store, keepAliveXml, elPasswort }: IdempotenzAbhaengigkeiten): Waechter {
  const deliveries = new Map<string, Wartende>();

  function pendingFor(anchors: Anker): Wartende | null {
    for (const anchor of anchors) {
      const pending = deliveries.get(anchor);
      if (pending) return pending;
    }
    return null;
  }

  function claimAnchors(anchors: Anker, pending: Wartende): void {
    for (const anchor of anchors) deliveries.set(anchor, pending);
    for (const aeltester of deliveries.keys()) {
      if (deliveries.size <= ANSWER_CACHE_MAX) break;
      deliveries.delete(aeltester);
    }
  }

  function releaseAnchors(anchors: Anker, pending: Wartende): void {
    for (const anchor of anchors) if (deliveries.get(anchor) === pending) deliveries.delete(anchor);
  }

  function makeGuard({ weg, anchorsOf, seenBefore, remember, ablage = null, geheimnis }: WachParameter): Wache {
    return async function webhookIdempotenzGuard(req, res, next) {
      const ankunft = Date.now();
      const anchors = anchorsOf(req);
      if (!anchors.length) return next();
      const pending = pendingFor(anchors);
      if (pending) return beantworteWartende({ pending, weg, res, next });
      const deferred = makeDeferredAnswer();
      claimAnchors(anchors, deferred.answer);
      const bindung = { anker: anchors, callSid: signierterCallSid(req) };
      const zuerst = await annehmenOderNull({ ablage, weg, bindung });
      const warten = { ablage, weg, angenommen: zuerst, bindung, ankunft };
      const { angenommen, antwort: gefunden } = await wartenAufFremdeAntwort(warten);
      const fremdeAntwort = gefunden && geheimnisEin(gefunden, geheimnis);
      if (fremdeAntwort) return liefereAusAblage({ deferred, weg, res, antwort: fremdeAntwort });
      const known = seenBefore(req, anchors);
      if (known) {
        releaseAnchors(anchors, deferred.answer);
        return liefereKeepAlive({ deferred, weg, res, xml: keepAliveXml(known) });
      }
      const freigeben = freigabeFuer({ ablage, weg, angenommen, bindung });
      const ablegen = antwortAblegen({ ablage, weg, angenommen, bindung, geheimnis, freigeben });
      const verwerfen = () => {
        if (angenommen?.eigen) releaseAnchors(anchors, deferred.answer);
      };
      rememberAnswerOnSend({ req, res, anchors, deferred, remember, ablegen, freigeben, verwerfen });
      return next();
    };
  }

  const forIncoming = makeGuard({
    weg: "incoming",
    ablage: store.webhookZustellung ?? null,
    geheimnis: elPasswort,
    anchorsOf: incomingAnchors,
    seenBefore: (req) => store.getCall(req.body?.CallSid ?? ""),
    remember: () => undefined,
  });

  const forTurn = makeGuard({
    weg: "turn",
    ablage: store.webhookZustellung ?? null,
    geheimnis: elPasswort,
    anchorsOf: turnAnchors,
    seenBefore: (req, anchors) => {
      const call = store.getCall(req.query?.callId ?? "");
      if (!call) return null;
      const seen = call.webhookAnchors ?? [];
      return anchors.some((anchor) => seen.includes(anchor)) ? call : null;
    },
    remember: (req, anchors) => store.recordWebhookAnchors(req.query?.callId ?? "", anchors),
  });

  const ohneNeustartSchicht = { seenBefore: () => null, remember: () => undefined };
  const forElRueckfall = makeGuard({
    weg: "el-rueckfall",
    ablage: store.webhookZustellung ?? null,
    geheimnis: elPasswort,
    anchorsOf: elRueckfallAnchors,
    ...ohneNeustartSchicht,
  });
  const uebergabeLaeuftOderEndete = (req: Anfrage): Anruf | null | undefined => {
    const call = store.getCall(ankerTeil(req.query?.callId));
    return UEBERGABE_ZUSTAENDE.includes(bridgeStateOf(call)) ? call : null;
  };
  const forElUebergabe = makeGuard({
    weg: "el-uebergabe",
    ablage: store.webhookZustellung ?? null,
    geheimnis: elPasswort,
    anchorsOf: (req) => (istOutboundElProfil(store.getCall(ankerTeil(req.query?.callId))) ? elUebergabeAnchors(req) : []),
    seenBefore: uebergabeLaeuftOderEndete,
    remember: ohneNeustartSchicht.remember,
  });
  const forElBein = makeGuard({ weg: "el-bein", geheimnis: elPasswort, anchorsOf: elBeinAnchors, ...ohneNeustartSchicht });

  const forStatus = makeGuard({
    weg: "status",
    ablage: store.webhookZustellung ?? null,
    geheimnis: elPasswort,
    anchorsOf: statusAnchors,
    ...ohneNeustartSchicht,
  });

  return { forIncoming, forTurn, forElRueckfall, forElBein, forElUebergabe, forStatus };
}
