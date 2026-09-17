// IEL-B8 (E8/L9/E9): Rueckfall-Entscheidung und Uebergabe-Direktiven des EL-Inbound-Wegs.
// Rein: jede Eingabe kommt aus dem PERSISTIERTEN Datensatz (E5) oder als Argument - nach einem
// Neustart entscheidet der Handler identisch. Kein Prozessspeicher, kein config, kein Log.
import { BRIDGE_STATE, bridgeStateOf } from "./inbound-bridge-state.js";
import { EL_RUECKFALL_QUELLE, elRueckfallUrl } from "./inbound-bridges.js";
import { elSipUri } from "./inbound-sip-uri.js";
import { dialSip, hangup, redirect, sayWithVoiceId } from "../telephony/directives.js";
import { callMaxDurationMs } from "../call-duration.js";
import { MAX_CALL_DURATION_CAP_S } from "../store/defaults.js";
import { MS_PER_SECOND } from "../utils/timer.js";

// STARTWERTE, NICHT GEMESSEN (Spec 8 zieht nach), Muster inbound-bridges.js:
//   EL_DIAL_RING_TIMEOUT_S: INVITE -> 407 -> 200 OK gemessen unter 1 s ([M1] F-A/J3); seit
//     IEX-A3 liegt kein eigener Satz mehr vor dem Dial. Der Wert bleibt unter
//     EL_BRIDGE_START_DEADLINE_MS: ein nie angenommenes SIP-Bein endet ueber dial_ende im
//     Fehlersatz, bevor die Frist greift - seit IEP-P2 auf einem bereits beantworteten
//     Anrufer-Bein, also im belegten Fall ([M1] F-F). Der Test pinnt die Ordnung.
//   EL_MIN_CONVERSATION_MS: der Anbieter bricht ein Gespraech mit fehlender Variable etwa 1,7 s
//     nach der Annahme ab (1008, [M1] J3); eine echte Eroeffnung dauert laenger.
export const EL_DIAL_RING_TIMEOUT_S = 10;
export const EL_MIN_CONVERSATION_MS = 5000;

// IEP-P2 (Owner-Entscheidung 8/10): Sofortannahme. Ohne answerOnBridge beantwortet das <Dial> als
// ERSTES Verb das eingehende Bein (Anbieter-Default false, Telnyx-Doku Dial-Verb: "Only takes
// effect when the inbound call has not yet been answered."). Damit gehoert die Medienstrecke ab
// dem TeXML uns.
// GRUND: mit true blieb das Anrufer-Bein 1,56 s unbeantwortet (Owner-Test #2); in dieser Zeit
// hoerte der Owner Netz-Klingeln und eine fremde Roboteransage. Test #1 nahm sofort an - dort trat
// beides nicht auf.
// GEGENBUCHUNG: die Pflichtmessung M-S3 ENTFAELLT. Sie fragte, ob nach einem nie beantworteten,
// gescheiterten Dial der <Redirect> noch laeuft und der Fehlersatz den Anruf beantwortet. Auf einem
// BEANTWORTETEN Bein ist der Weiterlauf bereits gemessen ([M1] F-F).
// UNGEMESSEN, tragend, Messung durch den Lead (U1): dass der Anbieter-Default hier wirklich sofort
// annimmt - alle M1-Messungen liefen auf bereits beantworteten Beinen.
// PREIS: wer waehrend der Wartephase auflegt, erzeugt jetzt eine real beantwortete Traegerminute
// (60 s Mindestabrechnung). Als ROLLOUT-Gate, nicht als Owner-Test-Gate, ist die
// Klingelphasen-Abbruchquote aus den detail_records zu beziffern. Umgekehrt entschaerft die
// Umstellung den Buchungsbefund, dass answeredAt heute VOR der Traeger-Annahme liegt.
// RUECKWEG (eine Zeile, der heutige Zustand): auf true zuruecksetzen, deployen.
export const EL_DIAL_ANSWER_ON_BRIDGE = false;

// EINE Quelle fuer Pfad und URL des SIP-Bein-Callbacks (Schreiber: Dial-Direktive, Leser: Route).
export const EL_BEIN_PFAD = "/voice/el-bein";

// IEP-P2: EINE Quelle fuer Pfad und URL des Begruessungslauts, der die Luecke zwischen der
// Sofortannahme und der ersten Agentensilbe besetzt. Ausgeliefert vom bestehenden statischen
// public/-Mount - kein Parameter, keine neue Route (CLAUDE.md Regel 3). Erzeugt von
// scripts/render-begruessungslaut.mjs.
export const EL_BEGRUESSUNGSLAUT_PFAD = "/brand/hermes-begruessungslaut.wav";

// Wurzel-relativ wie elBeinUrl; der Aufrufer setzt publicUrl davor.
export function elBegruessungslautUrl(publicUrl) {
  return `${publicUrl}${EL_BEGRUESSUNGSLAUT_PFAD}`;
}

// IEX-A2 (O3/E4): Budget ist kein Rueckfall mehr - eine gescheiterte Uebergabe spricht den Fehlersatz.
export const RUECKFALL_ENTSCHEIDUNG = Object.freeze({
  AUFLEGEN: "auflegen",
  FOLGE_GATHER: "folge_gather",
  FEHLERSATZ: "fehlersatz",
});

const BEKANNTE_QUELLEN = Object.freeze(Object.values(EL_RUECKFALL_QUELLE));
const QUELLE_UNBEKANNT = "unbekannt";

// Wurzel-relativ wie elRueckfallUrl; der Aufrufer setzt publicUrl davor.
export function elBeinUrl(callId) {
  return `${EL_BEIN_PFAD}?${new URLSearchParams({ callId })}`;
}

// Millisekunden seit einem persistierten ISO-Zeitpunkt; null, wenn er fehlt oder unlesbar ist.
function msSeitIso(iso, nowMs) {
  const zeitpunktMs = Date.parse(iso);
  return Number.isNaN(zeitpunktMs) ? null : nowMs - zeitpunktMs;
}

// A3-Kalibrierung ([el-rueckfall] ms_seit_bindung): null ohne lesbares elBoundAt (nie gebunden
// oder unlesbar). EINE Quelle fuer Log und Entscheidung (G5).
export function msSeitBindung(call, nowMs) {
  return msSeitIso(call?.elBoundAt, nowMs);
}

// IEX-A3 ([el-init] gebunden ms_seit_annahme): Anker ist answeredAt aus /voice/incoming.
export function msSeitAnnahme(call, nowMs) {
  return msSeitIso(call?.answeredAt, nowMs);
}

// Ohne lesbare Bindung nie "lang genug" -> Fehlersatz statt stillem Auflegen.
function gespraechLiefLangGenug(call, nowMs) {
  const dauerMs = msSeitBindung(call, nowMs);
  return dauerMs !== null && dauerMs >= EL_MIN_CONVERSATION_MS;
}

// RUECKFALL: der Fehlersatz ist bereits gesprochen (Anbieter-Wiederholung). GEBUNDEN alt: ein
// Gespraech hat stattgefunden (A3-Heuristik), der Nachlauf bleibt.
function nurNochAuflegen({ zustand, call, nowMs }) {
  if (zustand === BRIDGE_STATE.RUECKFALL) return true;
  return zustand === BRIDGE_STATE.GEBUNDEN && gespraechLiefLangGenug(call, nowMs);
}

// E4: Entscheidung ausschliesslich ueber Aktiv-Status + bridgeStateOf + elBoundAt.
export function rueckfallEntscheidungFuer({ call, nowMs }) {
  if (call?.status !== "active") return RUECKFALL_ENTSCHEIDUNG.AUFLEGEN;
  const zustand = bridgeStateOf(call);
  if (zustand === BRIDGE_STATE.KEIN_EL_INBOUND) return RUECKFALL_ENTSCHEIDUNG.FOLGE_GATHER;
  if (nurNochAuflegen({ zustand, call, nowMs })) return RUECKFALL_ENTSCHEIDUNG.AUFLEGEN;
  return RUECKFALL_ENTSCHEIDUNG.FEHLERSATZ; // WARTET oder GEBUNDEN jung
}

// Log-sicher: nur Enum-Werte, nie der rohe Query-Wert (Log-Injection).
export function rueckfallQuelleFuerLog(quelle) {
  return BEKANNTE_QUELLEN.includes(quelle) ? quelle : QUELLE_UNBEKANNT;
}

// IEX-A3 (3.1 Schritt 3): Dial/Sip als ERSTES Verb -> Redirect(dial_ende). Kein eigener Satz davor:
// den Hinweis spricht der Agent in seiner Eroeffnung (Riegel an der Init-Route).
// IEP-P2: das Dial beantwortet das Bein sofort (EL_DIAL_ANSWER_ON_BRIDGE), und statt des
// Telnyx-eigenen US-Freitons laeuft waehrend der Dial-Wartezeit unser Begruessungslaut
// (ringbackAudioUrl). Das Dial bleibt dabei das ERSTE Verb - es gibt kein Medien-Verb davor, also
// auch keine Dial-Verschiebung. begruessungslautUrl leer/null -> TeXML byte-gleich zur Form ohne
// Fuellung (Golden). Die AN/AUS-Entscheidung faellt beim Aufrufer, damit dieses Modul config-frei
// bleibt (Modulkopf).
// zugang.password ist SECRET: das Ergebnis wird nur gerendert, nie geloggt.
export function elUebergabeDirektiven({ call, zugang, publicUrl, begruessungslautUrl }) {
  return [
    dialSip({
      uri: elSipUri({ did: call.to, token: call.streamToken }),
      username: zugang.username,
      password: zugang.password,
      callerId: call.to,
      timeoutS: EL_DIAL_RING_TIMEOUT_S,
      // Fallback-Regel wie callMaxDurationMs (EINE Quelle); die Anbieter-Grenzen klemmt der Renderer.
      timeLimitS: callMaxDurationMs(call, MAX_CALL_DURATION_CAP_S) / MS_PER_SECOND,
      statusCallbackUrl: `${publicUrl}${elBeinUrl(call.id)}`,
      answerOnBridge: EL_DIAL_ANSWER_ON_BRIDGE,
      ringbackAudioUrl: begruessungslautUrl,
    }),
    redirect(`${publicUrl}${elRueckfallUrl({ callId: call.id, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE })}`),
  ];
}

// IEX-A2 (O3): fester Fehlersatz in der Stimme des Agenten (E19), danach aufgelegt - kein
// Gather, kein Budget-Gespraech. fehlersatz = { text, voiceProfile, voiceId }.
export function elFehlersatzDirektiven(fehlersatz) {
  return [sayWithVoiceId(fehlersatz), hangup()];
}
