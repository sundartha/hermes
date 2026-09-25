// Voice-Render-Helfer (Server-Slim P3, reine Verschiebung aus server.js). Die Factory
// schliesst config und liest config.server.publicUrl/config.voice.sttSpeechTimeoutSec ZUR LAUFZEIT
// (nicht zur Import-Zeit einfrieren - sonst driftet der Telnyx-Absolut-URL-Pfad). Der
// voiceRenderer-Port, die Direktiven-Helfer, localeFor und PROVIDER
// werden hier importiert (EINE Quelle je, G5). Rein: kein I/O, keine Nebeneffekte;
// einzige Ausnahme ist die frische Turn-Marke je Gather (Zufall, kein IO, kein Zustand).
//
//   render                 - Direktiven-Liste -> Provider-Markup (TwiML/TeXML), Hot-Path.
//   turnDirectives         - Sprach-Turn (Budget-Engine): Gather + Redirect-Fallback.
//   sayInCallVoice         - gesprochener Satz im Voice-Profil des Calls (F1 P4).
//   followupTurnDirectives - Folge-Gather mit festem STT-Endpointing (G3).
import { voiceRenderer } from "./registry.js";
import { say as sayD, gather as gatherD, redirect as redirectD } from "./directives.js";
import { localeFor } from "../i18n/locales.js";
import { PROVIDER } from "../store/defaults.js";
import { newTurnToken, TURN_TOKEN_PARAM } from "./webhook-idempotenz.js";

export function makeVoiceRender({ config }) {
  // Kurz-Helfer fuer Direktiven-Listen -> Provider-Markup (TwiML/TeXML). provider
  // wird vom Aufrufer durchgereicht; undefined -> voiceRenderer-Default DEFAULT_PROVIDER
  // (Telnyx) -> jeder arg-lose render(x)-Aufruf bleibt byte-identisch (Hot-Path, R5).
  const render = (directives, provider) => voiceRenderer(provider).renderDirectives(directives);

  // Direktiven fuer einen Sprach-Turn (Budget-Engine): Gather mit optionalem Prompt +
  // Redirect-Fallback auf dieselbe Turn-URL. speechTimeoutSec (optional) setzt festes
  // STT-Endpointing statt "auto" - NUR Folge-Gathers im /voice/turn (G3). Erst-Gather
  // (Inbound-Greeting + Outbound) ruft OHNE -> "auto" bleibt (End-of-Speech-Erkennung
  // noetig, sonst Erst-Turn-Deadlock). Telnyx-TeXML loest relative URLs anders auf als
  // Twilio -> absolute URL fuer Telnyx (config.server.publicUrl zur Laufzeit gelesen).
  function turnDirectives(call, text, { speechTimeoutSec } = {}) {
    const isTelnyx = call.provider === PROVIDER.TELNYX;
    const base = isTelnyx ? config.server.publicUrl : "";
    // SEC-P1: EINE frische Turn-Marke je gerendertem Gather. Der Anbieter reicht sie
    // im Action- ODER im Redirect-Aufruf zurueck (genau eines von beiden feuert) ->
    // sie identifiziert das EREIGNIS. Zwei echte Runden tragen verschiedene Marken,
    // ein Retry derselben Runde traegt dieselbe. Die XML-Maskierung des "&" uebernimmt
    // escapeXml im Renderer (Gather-action UND Redirect-Body).
    const action = `${base}/voice/turn?callId=${call.id}&${TURN_TOKEN_PARAM}=${newTurnToken()}`;
    // Voice-Profil (TTS-Voice + STT-Locale) aus call.language ableiten (F1 P4). DE-Call
    // -> DE_FEMALE_NEURAL -> Renderer byte-identisch (Snapshot). Fail-safe ueber localeFor.
    const voiceProfile = localeFor(call.language).voiceProfile;
    return [gatherD({ promptText: text, action, voiceProfile, speechTimeoutSec }), redirectD(action)];
  }

  // Gesprochenen Satz im Voice-Profil des Calls rendern (F1 P4): sayD(text) defaultet auf
  // DE; in den sprachabhaengigen Pfaden (Turn-Ende, Fehler) muss die Voice der call.language
  // folgen. DE-Call -> DE-Default -> byte-identisch. EINE Ableitungsstelle (G5).
  function sayInCallVoice(call, text) {
    return sayD(text, localeFor(call.language).voiceProfile);
  }

  // Folge-Gather im laufenden Gespraech (/voice/turn): wie turnDirectives, aber mit
  // festem STT-Endpointing (config.voice.sttSpeechTimeoutSec) gegen Satz-Truncation (G3).
  // Eigener Name statt Boolean-Flag (kein Selektor-Argument, G15/F3).
  function followupTurnDirectives(call, text) {
    return turnDirectives(call, text, { speechTimeoutSec: config.voice.sttSpeechTimeoutSec });
  }

  return { render, turnDirectives, sayInCallVoice, followupTurnDirectives };
}
