// Voice-Render-Helfer (Server-Slim P3, reine Verschiebung aus server.js). Die Factory
// schliesst config und liest config.publicUrl/config.sttSpeechTimeoutSec ZUR LAUFZEIT
// (nicht zur Import-Zeit einfrieren - sonst driftet der Telnyx-Absolut-URL-Pfad). Der
// voiceRenderer-Port, die Direktiven-Helfer, localeFor, MEDIA_PATH und DEFAULT_PROVIDER
// werden hier importiert (EINE Quelle je, G5). Rein: kein I/O, keine Nebeneffekte.
//
//   render                 - Direktiven-Liste -> Provider-Markup (TwiML/TeXML), Hot-Path.
//   turnDirectives         - Sprach-Turn (Budget-Engine): Gather + Redirect-Fallback.
//   sayInCallVoice         - gesprochener Satz im Voice-Profil des Calls (F1 P4).
//   followupTurnDirectives - Folge-Gather mit festem STT-Endpointing (G3).
//   streamDirectives       - Realtime-Stream-Direktive an die Bridge.
import { voiceRenderer } from "./registry.js";
import {
  say as sayD,
  gather as gatherD,
  redirect as redirectD,
  stream as streamD,
} from "./directives.js";
import { localeFor } from "../i18n/locales.js";
import { MEDIA_PATH } from "../bridge.js";
import { DEFAULT_PROVIDER, PROVIDER } from "../store/defaults.js";

export function makeVoiceRender({ config }) {
  // Kurz-Helfer fuer Direktiven-Listen -> Provider-Markup (TwiML/TeXML). provider
  // wird vom Aufrufer durchgereicht; undefined -> voiceRenderer-Default twilio ->
  // jeder arg-lose render(x)-Aufruf bleibt byte-identisch (Hot-Path, R5).
  const render = (directives, provider) => voiceRenderer(provider).renderDirectives(directives);

  // Direktiven fuer einen Sprach-Turn (Budget-Engine): Gather mit optionalem Prompt +
  // Redirect-Fallback auf dieselbe Turn-URL. speechTimeoutSec (optional) setzt festes
  // STT-Endpointing statt "auto" - NUR Folge-Gathers im /voice/turn (G3). Erst-Gather
  // (Inbound-Greeting + Outbound) ruft OHNE -> "auto" bleibt (End-of-Speech-Erkennung
  // noetig, sonst Erst-Turn-Deadlock). Telnyx-TeXML loest relative URLs anders auf als
  // Twilio -> absolute URL fuer Telnyx (config.publicUrl zur Laufzeit gelesen).
  function turnDirectives(call, text, { speechTimeoutSec } = {}) {
    const isTelnyx = call.provider === PROVIDER.TELNYX;
    const base = isTelnyx ? config.server.publicUrl : "";
    const action = `${base}/voice/turn?callId=${call.id}`;
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
  // festem STT-Endpointing (config.sttSpeechTimeoutSec) gegen Satz-Truncation (G3).
  // Eigener Name statt Boolean-Flag (kein Selektor-Argument, G15/F3).
  function followupTurnDirectives(call, text) {
    return turnDirectives(call, text, { speechTimeoutSec: config.voice.sttSpeechTimeoutSec });
  }

  // Realtime-Engine: Direktive fuer den Media-Stream an die Bridge. Der WS-Pfad ist
  // provider-aware (Twilio /media byte-identisch, Telnyx eigener Pfad) - der upgrade-
  // Handler leitet daraus fail-closed den Provider ab. stream_token authentifiziert
  // den WebSocket (Bridge prueft beim start-Event, bridge.js).
  function streamDirectives(call) {
    const path = MEDIA_PATH[call.provider] || MEDIA_PATH[DEFAULT_PROVIDER];
    const url = config.server.publicUrl.replace(/^https/, "wss") + path;
    return [
      streamD({
        url,
        params: [
          { name: "call_id", value: call.id },
          { name: "stream_token", value: call.streamToken },
        ],
      }),
    ];
  }

  return { render, turnDirectives, sayInCallVoice, followupTurnDirectives, streamDirectives };
}
