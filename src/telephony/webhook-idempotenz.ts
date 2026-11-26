import { HTTP_OK, HTTP_SERVER_ERROR } from "../utils/http.ts";
import crypto from "node:crypto";
import { z } from "zod";
import { PROVIDER_WEBHOOK_HARDCUT_MS } from "../turn-budget.ts";
import { NUTZUNG_AUFFRISCHEN_FRIST_MS } from "../begriffe/speicher.ts";
import { ergebnisOderNull } from "./ergebnis-oder-null.ts";
import { escapeXml } from "./adapters/telnyx/render.ts";
import { TS_HEADER } from "./adapters/telnyx/signature.ts";

interface Anfrage {
  headers?: Record<string, string | string[] | undefined>;
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

type Weiter = (fehler?: unknown) => unknown;
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
  costProfile?: unknown;
}

interface WebhookStore {
  webhookZustellung?: Ablage | null;
  getCall: (id: unknown) => Anruf | null | undefined;
  leseCallUngebunden?: (id: string) => Promise<Anruf | null | undefined>;
  recordWebhookAnchors: (callId: unknown, anchors: Anker) => unknown;
}

interface Zeitgeber {
  jetzt: () => number;
  pause: (ms: number) => Promise<unknown>;
}

interface IdempotenzAbhaengigkeiten extends Zeitgeber {
  store: WebhookStore;
  keepAliveXml: (call: Anruf) => string;
  elPasswort: Geheimnis;
}

interface WachParameter {
  weg: string;
  anchorsOf: (req: Anfrage) => Anker | Promise<Anker>;
  seenBefore: (req: Anfrage, anchors: Anker) => Anruf | null | undefined | Promise<Anruf | null | undefined>;
  remember: (req: Anfrage, anchors: Anker) => unknown;
  ablage?: Ablage | null;
  geheimnis: Geheimnis;
}

type Wache = (req: Anfrage, res: Antwortkanal, next: Weiter) => void;
type Waechter = Record<"forIncoming" | "forElRueckfall" | "forElBein" | "forStatus" | "forVorspann", Wache>;

interface Wartebedarf {
  ablage: Ablage | null;
  weg: string;
  angenommen: Annahme | null;
  bindung: Bindung;
}

interface Warten extends Wartebedarf, Zeitgeber {
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
  LESEFEHLER: "lesefehler",
  SPAET: "spaet",
});

const REPLAY_GRUND = Object.freeze({ FRIST: "frist", FEHLER: "fehler" });

const ankerTeil = (wert: unknown): string => z.string().catch("").parse(wert);

function envelopeAnchor(req: Anfrage, { callId = "" }: { callId?: string } = {}): string | null {
  const timestamp = ankerTeil(req.headers?.[TS_HEADER]);
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

function queryEreignisAnker(req: Anfrage, ereignis: { praefix: string; unterscheider: unknown }): Anker {
  const { praefix, unterscheider } = ereignis;
  const callId = ankerTeil(req.query?.callId);
  const anchors = callId ? [`${praefix}:${callId}:${ankerTeil(unterscheider)}`] : [];
  const envelope = envelopeAnchor(req);
  return envelope ? [...anchors, envelope] : anchors;
}
export const elRueckfallAnchors = (req: Anfrage): Anker => queryEreignisAnker(req, { praefix: "rk", unterscheider: req.query?.quelle });
export const elBeinAnchors = (req: Anfrage): Anker => queryEreignisAnker(req, { praefix: "eb", unterscheider: req.body?.CallStatus });

export function statusAnchors(req: Anfrage): Anker {
  const envelope = envelopeAnchor(req, { callId: ankerTeil(req.query?.callId) });
  return envelope ? [`s${envelope}`] : [];
}

export function vorspannAnchors(req: Anfrage): Anker {
  const envelope = envelopeAnchor(req, { callId: ankerTeil(req.query?.callId) });
  return envelope ? [`v${envelope}`] : [];
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

async function versuche<T>(arbeit: () => T | Promise<T>): Promise<{ wert: T } | { fehler: unknown }> {
  try {
    return { wert: await arbeit() };
  } catch (fehler) {
    return { fehler };
  }
}

const LESEFEHLER_PRAEFIX: Record<string, string> = { incoming: "[incoming]" };

function antworteMitLesefehler({ weg, req, res, err }: { weg: string; req: Anfrage; res: Antwortkanal; err: unknown }): unknown {
  const praefix = LESEFEHLER_PRAEFIX[weg];
  const callId = ankerTeil(req.query?.callId) || "-";
  console.error(praefix, `Anruf lesen fehlgeschlagen (callId=${callId}):`, Reflect.get(Object(err), "message"));
  res.status(HTTP_SERVER_ERROR);
  return res.send("");
}

async function leseAnrufBinnenFrist(store: WebhookStore, id: string): Promise<Anruf | null | undefined> {
  if (!store.leseCallUngebunden) return store.getCall(id);
  const gelesen = await ergebnisOderNull(
    Promise.resolve(store.leseCallUngebunden(id)).then((anruf) => ({ anruf })),
    NUTZUNG_AUFFRISCHEN_FRIST_MS,
  );
  if (gelesen) return gelesen.anruf;
  console.error(`${REPLAY_LOG_PREFIX} Anruf nicht binnen der Frist gelesen, Pruefung mit dem Stand des Prozesses`);
  return store.getCall(id);
}

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

async function lesenBis(lesung: Zeitgeber & { ablage: Ablage; kennung: string; bindung: Bindung; ende: number }): Promise<Antwort | null> {
  const { ablage, kennung, bindung, ende, jetzt, pause } = lesung;
  const gelesen = await ergebnisOderNull(ablage.lies(kennung, bindung), ende - jetzt());
  if (!gelesen || gelesen.antwort || !gelesen.offen) return gelesen?.antwort ?? null;
  if (jetzt() + FREMDE_ANNAHME_TAKT_MS >= ende) return null;
  await pause(FREMDE_ANNAHME_TAKT_MS);
  return lesenBis(lesung);
}

async function uebernehmen({ ablage, weg, angenommen, bindung, ankunft, jetzt }: Warten & { ablage: Ablage; angenommen: FremdeAnnahme }): Promise<{ angenommen: Annahme; antwort?: Antwort | null | undefined }> {
  const uebernommen = await ablage.uebernehmen(angenommen.kennung, bindung, spaetFreigabe(weg));
  if (uebernommen.eigen) logWiederholung(weg, `${REPLAY_ART.UEBERNOMMEN} warte_ms=${String(jetzt() - ankunft)}`);
  return { angenommen: uebernommen.eigen ? uebernommen : angenommen, antwort: uebernommen.antwort };
}

async function wartenAufFremdeAntwort({ ablage, weg, angenommen, bindung, ankunft, jetzt, pause }: Warten): Promise<{ angenommen: Annahme | null; antwort?: Antwort | null | undefined }> {
  if (!ablage || angenommen?.eigen !== false || angenommen.antwort || !angenommen.kennung) {
    return { angenommen, antwort: angenommen?.antwort ?? null };
  }
  const ende = jetzt() + PROVIDER_WEBHOOK_HARDCUT_MS - angenommen.alterMs;
  try {
    const gelesen = await lesenBis({ ablage, kennung: angenommen.kennung, bindung, ende, jetzt, pause });
    if (gelesen) return { angenommen, antwort: gelesen };
    return await uebernehmen({ ablage, weg, angenommen, bindung, ankunft, jetzt, pause });
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
        Promise.resolve(remember(req, anchors)).catch((err: unknown) => {
          console.error(REPLAY_LOG_PREFIX, Reflect.get(Object(err), "message"));
        });
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

export function makeWebhookIdempotenz({ store, keepAliveXml, elPasswort, jetzt, pause }: IdempotenzAbhaengigkeiten): Waechter {
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
    const pruefeZustellung = async (req: Anfrage, res: Antwortkanal, next: Weiter): Promise<unknown> => {
      const ankunft = jetzt();
      const gelesenAnker = await versuche(() => anchorsOf(req));
      if ("fehler" in gelesenAnker) return antworteMitLesefehler({ weg, req, res, err: gelesenAnker.fehler });
      const anchors = gelesenAnker.wert;
      if (!anchors.length) return next();
      const pending = pendingFor(anchors);
      if (pending) return beantworteWartende({ pending, weg, res, next });
      const deferred = makeDeferredAnswer();
      claimAnchors(anchors, deferred.answer);
      const bindung = { anker: anchors, callSid: signierterCallSid(req) };
      const zuerst = await annehmenOderNull({ ablage, weg, bindung });
      const warten = { ablage, weg, angenommen: zuerst, bindung, ankunft, jetzt, pause };
      const { angenommen, antwort: gefunden } = await wartenAufFremdeAntwort(warten);
      const fremdeAntwort = gefunden && geheimnisEin(gefunden, geheimnis);
      if (fremdeAntwort) return liefereAusAblage({ deferred, weg, res, antwort: fremdeAntwort });
      const freigeben = freigabeFuer({ ablage, weg, angenommen, bindung });
      const gelesenBekannt = await versuche(() => seenBefore(req, anchors));
      if ("fehler" in gelesenBekannt) {
        releaseAnchors(anchors, deferred.answer);
        deferred.settle({ status: HTTP_SERVER_ERROR, body: "" });
        freigeben(FREIGABE_GRUND.LESEFEHLER);
        return antworteMitLesefehler({ weg, req, res, err: gelesenBekannt.fehler });
      }
      const known = gelesenBekannt.wert;
      if (known) {
        releaseAnchors(anchors, deferred.answer);
        return liefereKeepAlive({ deferred, weg, res, xml: keepAliveXml(known) });
      }
      const ablegen = antwortAblegen({ ablage, weg, angenommen, bindung, geheimnis, freigeben });
      const verwerfen = () => {
        if (angenommen?.eigen) releaseAnchors(anchors, deferred.answer);
      };
      rememberAnswerOnSend({ req, res, anchors, deferred, remember, ablegen, freigeben, verwerfen });
      return next();
    };
    return function webhookIdempotenzGuard(req, res, next): void {
      pruefeZustellung(req, res, next).catch(next);
    };
  }

  const leseAnruf = (id: string) => leseAnrufBinnenFrist(store, id);

  const forIncoming = makeGuard({
    weg: "incoming",
    ablage: store.webhookZustellung ?? null,
    geheimnis: elPasswort,
    anchorsOf: incomingAnchors,
    seenBefore: (req) => leseAnruf(signierterCallSid(req)),
    remember: () => undefined,
  });

  const ohneNeustartSchicht = { seenBefore: () => undefined, remember: () => undefined };
  const forElRueckfall = makeGuard({
    weg: "el-rueckfall",
    ablage: store.webhookZustellung ?? null,
    geheimnis: elPasswort,
    anchorsOf: elRueckfallAnchors,
    ...ohneNeustartSchicht,
  });
  const elBeinGuard = { weg: "el-bein", ablage: store.webhookZustellung ?? null, geheimnis: elPasswort, anchorsOf: elBeinAnchors };
  const forElBein = makeGuard({ ...elBeinGuard, ...ohneNeustartSchicht });

  const ereignisGuard = (weg: string, anchorsOf: WachParameter["anchorsOf"]): Wache =>
    makeGuard({ weg, anchorsOf, ablage: store.webhookZustellung ?? null, geheimnis: elPasswort, ...ohneNeustartSchicht });
  const forStatus = ereignisGuard("status", statusAnchors);
  const forVorspann = ereignisGuard("vorspann", vorspannAnchors);

  return { forIncoming, forElRueckfall, forElBein, forStatus, forVorspann };
}
