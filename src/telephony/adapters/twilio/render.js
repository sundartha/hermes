// Twilio-Adapter: renderDirectives - uebersetzt neutrale Direktiven (directives.js)
// in TwiML. EINZIGER Ort mit Twilio-VoiceResponse + Provider-Voice-Namen.
import twilio from "twilio";
import { DIRECTIVE, VOICE_PROFILE } from "../../directives.js";

const VoiceResponse = twilio.twiml.VoiceResponse;

// Logisches Voice-Profil -> Twilio-Voice-Attribute. Fail-closed: unbekanntes
// Profil ist ein Programmierfehler (wirft), kein stiller Default-Voice-Fallback.
const TWILIO_VOICE = Object.freeze({
  [VOICE_PROFILE.DE_FEMALE_NEURAL]: { voice: "Polly.Vicki-Neural", language: "de-DE" },
});

// Deutsche Spracherkennung (Budget-Engine). Attribut-Reihenfolge ist
// vertraglich: Twilio serialisiert in Einfuege-Reihenfolge, der Snapshot-Test
// nagelt sie fest.
const GATHER_OPTS = Object.freeze({
  input: "speech",
  language: "de-DE",
  speechTimeout: "auto",
  speechModel: "deepgram_nova-2-general",
  actionOnEmptyResult: true,
});

function voiceAttrs(profile) {
  const attrs = TWILIO_VOICE[profile];
  if (!attrs) throw new Error(`unbekanntes voiceProfile: ${profile}`);
  return attrs;
}

// Eine Direktive an den VoiceResponse-Knoten haengen (eine Abstraktionsebene, G34).
function applyDirective(vr, d) {
  switch (d.kind) {
    case DIRECTIVE.SAY:
      vr.say(voiceAttrs(d.voiceProfile), d.text);
      break;
    case DIRECTIVE.GATHER: {
      const g = vr.gather({ ...GATHER_OPTS, action: d.action, method: "POST" });
      if (d.promptText) g.say(voiceAttrs(d.voiceProfile), d.promptText);
      break;
    }
    case DIRECTIVE.REDIRECT:
      vr.redirect({ method: "POST" }, d.url);
      break;
    case DIRECTIVE.HANGUP:
      vr.hangup();
      break;
    case DIRECTIVE.STREAM: {
      const s = vr.connect().stream({ url: d.url });
      for (const p of d.params) s.parameter(p);
      break;
    }
    default:
      throw new Error(`unbekannte Direktive: ${d.kind}`);
  }
}

/** @type {import("../../ports.js").VoiceRenderer["renderDirectives"]} */
export function renderDirectives(directives) {
  const vr = new VoiceResponse();
  for (const d of directives) applyDirective(vr, d);
  return vr.toString();
}
