import { voiceRenderer } from "./registry.js";
import { say as sayD, gather as gatherD, redirect as redirectD } from "./directives.js";
import { localeFor } from "../i18n/locales.js";
import { PROVIDER } from "../store/defaults.js";
import { newTurnToken, TURN_TOKEN_PARAM } from "./webhook-idempotenz.js";

export function makeVoiceRender({ config }) {
  const render = (directives, provider) => voiceRenderer(provider).renderDirectives(directives);

  function turnDirectives(call, text, { speechTimeoutSec } = {}) {
    const isTelnyx = call.provider === PROVIDER.TELNYX;
    const base = isTelnyx ? config.server.publicUrl : "";
    const action = `${base}/voice/turn?callId=${call.id}&${TURN_TOKEN_PARAM}=${newTurnToken()}`;
    const voiceProfile = localeFor(call.language).voiceProfile;
    return [gatherD({ promptText: text, action, voiceProfile, speechTimeoutSec }), redirectD(action)];
  }

  function sayInCallVoice(call, text) {
    return sayD(text, localeFor(call.language).voiceProfile);
  }

  function followupTurnDirectives(call, text) {
    return turnDirectives(call, text, { speechTimeoutSec: config.voice.sttSpeechTimeoutSec });
  }

  return { render, turnDirectives, sayInCallVoice, followupTurnDirectives };
}
