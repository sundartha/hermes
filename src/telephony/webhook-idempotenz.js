// SEC-P1: Wiederholungs-Riegel der zwei ungeschuetzten Voice-Webhooks
// (/voice/incoming, /voice/turn) plus die zwei Webhooks des EL-Inbound-Wegs
// (/voice/el-rueckfall, /voice/el-bein, IEL-B8 - diese nur mit Schicht 1, Begruendung in
// makeWebhookIdempotenz). Zwei Schichten, beide notwendig:
//   1. Prozess-Cache: liefert die ERSTE Antwort byte-identisch nochmal aus und
//      serialisiert eine Wiederholung, die eintrifft, waehrend die erste noch laeuft.
//   2. Persistierter Anker am Anruf-Datensatz: ueberlebt den Neustart (Vorbild
//      billedAt) und beantwortet die Wiederholung mit einer mikrofon-offenen
//      Antwort, wenn der Wortlaut mit dem Prozess gestorben ist.
// Der Anker kommt IMMER aus dem Anbieter-Ereignis, nie aus unserer Uhr. Die
// Begruendung der Turn-Ersatzform (zwei Anker) steht in PLAN-SECURITY.md (SEC-P1).
//
// Der Riegel VERWIRFT NIE: eine Wiederholung bekommt dieselbe Antwort bzw. ein offenes
// Mikrofon, ein echtes Ereignis laeuft unveraendert durch den Handler. Er beruehrt KEIN
// Safety-Gate (er fuegt hinzu, er nimmt nichts weg) und wird PRO ROUTE registriert,
// also strukturell HINTER der /voice-Signaturpruefung.
import crypto from "node:crypto";
import { PROVIDER_WEBHOOK_HARDCUT_MS } from "../turn-budget.js";
import { TS_HEADER } from "./adapters/telnyx/signature.js";

// Query-Parameter, unter dem die Turn-Marke in der Action-/Redirect-URL reist.
export const TURN_TOKEN_PARAM = "turnToken";
// 64 Bit unratbar - Muster streamToken (16 Byte) eine Nummer kleiner: die Marke ist
// kurzlebig (genau ein Gather) und steht in einer URL.
const TURN_TOKEN_BYTES = 8;
// Prozess-Cache-Deckel (Anker -> Antwort). Mechanismus-Invariante, kein Betriebsknopf:
// ein Env-Schalter waere eine abschaltbare Sicherung.
const ANSWER_CACHE_MAX = 200;

// Frische Marke fuer EINEN gerenderten Gather. Der Anbieter reicht sie im Action- ODER
// im Redirect-Aufruf zurueck (genau eines von beiden feuert) -> sie identifiziert das
// EREIGNIS, nicht den Anruf.
export function newTurnToken() {
  return crypto.randomBytes(TURN_TOKEN_BYTES).toString("hex");
}

// Fingerabdruck des SIGNIERTEN Umschlags: sha256 ueber exakt die Bytes, die der
// Verifizierer geprueft hat (`${ts}|${rawBody}`). Faengt jede byte-identische
// Wiederholung, auch eine mit manipulierter Query. Fehlt der Umschlag (lokaler
// Skip-Modus) -> null, der Aufrufer faellt dann auf die uebrigen Anker zurueck.
function envelopeAnchor(req) {
  const timestamp = req.headers?.[TS_HEADER];
  if (!timestamp || !req.rawBody) return null;
  const hash = crypto.createHash("sha256");
  hash.update(`${timestamp}|`);
  hash.update(req.rawBody);
  return `e:${hash.digest("hex")}`;
}

// Genau EIN "a call comes in"-Ereignis je Leg traegt dieselbe anbieterseitige CallSid.
// Fehlende SID -> kein Anker -> Bestandsverhalten (fail-open dort, wo heute nichts
// geschuetzt ist; in Produktion liegt die SID immer vor).
export function incomingAnchors(req) {
  const sid = req.body?.CallSid;
  return typeof sid === "string" && sid ? [`in:${sid}`] : [];
}

// Der TeXML-Gather-Callback traegt KEIN anbieterseitiges Ereignis-Merkmal (nur
// Transcript/SpeechResult und die callId, die WIR gesetzt haben). CallSid allein waere
// der teuerste Fehler: die zweite Runde desselben Anrufs saehe wie ein Duplikat aus und
// der Agent verstummte. Deshalb zwei Anker - die Turn-Marke faengt den Anbieter-Retry
// (auch neu signiert), der Umschlag-Fingerabdruck den Angreifer, der die Marke streicht.
export function turnAnchors(req) {
  const token = req.query?.[TURN_TOKEN_PARAM];
  const anchors = [];
  if (typeof token === "string" && token) anchors.push(`t:${token}`);
  const envelope = envelopeAnchor(req);
  if (envelope) anchors.push(envelope);
  return anchors;
}

// IEL-B8: Ereignis-Anker = Praefix + callId + Unterscheider der Route (Herkunft des Rueckfalls bzw.
// Bein-Status). Ein Rueckfall-Dokument hat je Herkunft genau EIN Ereignis (Dial endet einmal,
// Fristen raeumen sich gegenseitig ab), ein SIP-Bein meldet answered einmal. Dazu der
// Umschlag-Fingerabdruck (faengt die byte-identische Wiederholung auch mit manipulierter Query).
const ankerTeil = (wert) => (typeof wert === "string" ? wert : "");
function queryEreignisAnker(req, { praefix, unterscheider }) {
  const callId = ankerTeil(req.query?.callId);
  const anchors = callId ? [`${praefix}:${callId}:${ankerTeil(unterscheider)}`] : [];
  const envelope = envelopeAnchor(req);
  return envelope ? [...anchors, envelope] : anchors;
}
export const elRueckfallAnchors = (req) => queryEreignisAnker(req, { praefix: "rk", unterscheider: req.query?.quelle });
export const elBeinAnchors = (req) => queryEreignisAnker(req, { praefix: "eb", unterscheider: req.body?.CallStatus });

// Aufgeschobenes Versprechen auf die Antwort der ERSTEN Zustellung. Ein zweiter resolve
// ist ein No-op (Promise-Semantik) - deshalb duerfen Antwort-Abfang und close-Handler
// beide aufloesen.
function makeDeferredAnswer() {
  let settle;
  const answer = new Promise((resolve) => {
    settle = resolve;
  });
  return { answer, settle };
}

// Auf die erste Zustellung warten, aber hoechstens so lange, wie der Anbieter selbst
// wartet - danach hat er ohnehin gekappt. Die Uhr ist unref()'d, sonst haelt sie den
// Prozess offen (Spawn-Tests haengen). null = keine Antwort innerhalb der Frist.
function answerWithinProviderDeadline(pending) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), PROVIDER_WEBHOOK_HARDCUT_MS);
    timer.unref?.();
    pending.then((answer) => {
      clearTimeout(timer);
      resolve(answer);
    });
  });
}

// Die erste Antwort ein zweites Mal ausliefern - Status, Content-Type und Body
// byte-identisch (der Anbieter-Retry ist legitim und darf kein 4xx sehen).
function replayAnswer(res, answer) {
  res.status(answer.status);
  if (answer.contentType) res.type(answer.contentType);
  return res.send(answer.body);
}

export function makeWebhookIdempotenz({ store, keepAliveXml }) {
  // Anker -> Versprechen auf die Antwort seiner Zustellung. EINE Instanz je Server
  // (INV-7): der Zustand lebt im Abschluss dieser Fabrik, kein Modul-Singleton (P15).
  const deliveries = new Map();

  function pendingFor(anchors) {
    for (const anchor of anchors) {
      const pending = deliveries.get(anchor);
      if (pending) return pending;
    }
    return null;
  }

  // Anker beanspruchen. SYNCHRON und ohne await ab der Pruefung -> in Node unteilbar
  // (Muster lastAppliedByKey in billing/webhook.js). LRU: Map ist einfuege-geordnet,
  // die aeltesten Anker fallen ueber den Deckel heraus.
  function claimAnchors(anchors, pending) {
    for (const anchor of anchors) deliveries.set(anchor, pending);
    while (deliveries.size > ANSWER_CACHE_MAX)
      deliveries.delete(deliveries.keys().next().value);
  }

  // res.send ersetzen, um die ausgelieferte Antwort zu merken und den persistierten
  // Anker zu schreiben. Object.assign statt direkter Zuweisung: res gehoert Express,
  // nicht uns (dieselbe Form und Begruendung wie captureRawBody in app.js).
  // FAIL-SOFT: ein Fehler im Ledger darf nie ein laufendes Gespraech toeten
  // (Muster releaseReserve in call-finish.js).
  function rememberAnswerOnSend({ req, res, anchors, deferred, remember }) {
    const send = res.send.bind(res);
    Object.assign(res, {
      send(body) {
        try {
          deferred.settle({
            status: res.statusCode,
            contentType: res.get("Content-Type"),
            body,
          });
          remember(req, anchors);
        } catch (err) {
          console.error("[webhook-idempotenz]", err.message);
        }
        return send(body);
      },
    });
    // Nie geantwortet (Absturz/Abbruch) -> Wiederholungen warten sonst ins Leere.
    res.on("close", () => deferred.settle(null));
  }

  // Der gemeinsame Ablauf aller Routen (G5) - sie unterscheiden sich NUR in der
  // Anker-Ableitung, der Neustart-Lesung und dem Schreibweg.
  function makeGuard({ anchorsOf, seenBefore, remember }) {
    return async function webhookIdempotenzGuard(req, res, next) {
      const anchors = anchorsOf(req);
      if (!anchors.length) return next();
      const pending = pendingFor(anchors);
      if (pending) {
        const answer = await answerWithinProviderDeadline(pending);
        return answer ? replayAnswer(res, answer) : next();
      }
      const known = seenBefore(req, anchors);
      if (known) return res.type("text/xml").send(keepAliveXml(known));
      const deferred = makeDeferredAnswer();
      claimAnchors(anchors, deferred.answer);
      rememberAnswerOnSend({ req, res, anchors, deferred, remember });
      return next();
    };
  }

  // Der Anker des Inbound-Webhooks IST der Anruf-Datensatz (twilioSid, gesetzt in
  // createCall) - deshalb kein remember und kein neues Feld.
  const forIncoming = makeGuard({
    anchorsOf: incomingAnchors,
    seenBefore: (req) => store.getCall(req.body?.CallSid || ""),
    remember: () => {},
  });

  const forTurn = makeGuard({
    anchorsOf: turnAnchors,
    seenBefore: (req, anchors) => {
      const call = store.getCall(req.query?.callId || "");
      if (!call) return null;
      const seen = call.webhookAnchors ?? [];
      return anchors.some((anchor) => seen.includes(anchor)) ? call : null;
    },
    remember: (req, anchors) => store.recordWebhookAnchors(req.query?.callId || "", anchors),
  });

  // IEL-B8: KEINE Neustart-Schicht. Beide Handler entscheiden ausschliesslich aus dem persistierten
  // Brueckenzustand (E5/E8). keepAliveXml waere fuer ein uebergebenes Bein ein LEERES Dokument -
  // im Rueckfall also Stille. Der Prozess-Cache liefert die erste Antwort byte-identisch nochmal.
  const ohneNeustartSchicht = { seenBefore: () => null, remember: () => {} };
  const forElRueckfall = makeGuard({ anchorsOf: elRueckfallAnchors, ...ohneNeustartSchicht });
  const forElBein = makeGuard({ anchorsOf: elBeinAnchors, ...ohneNeustartSchicht });

  return { forIncoming, forTurn, forElRueckfall, forElBein };
}
