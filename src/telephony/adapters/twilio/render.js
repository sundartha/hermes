// Twilio-Adapter: renderDirectives - uebersetzt neutrale Direktiven (directives.js)
// in TwiML. EINZIGER Ort mit Twilio-VoiceResponse + Provider-Voice-Namen.
import twilio from "twilio";
import { DIRECTIVE, VOICE_PROFILE } from "../../directives.js";

const VoiceResponse = twilio.twiml.VoiceResponse;

// Logisches Voice-Profil -> Twilio-Voice-Attribute. Fail-closed: unbekanntes
// Profil ist ein Programmierfehler (wirft), kein stiller Default-Voice-Fallback.
// Pro Sprache ein Eintrag; `language` (volles BCP-47) gilt fuer TTS-Voice UND
// STT-Locale (siehe gatherOpts) - eine Quelle, kein DE/FR-Drift.
const TWILIO_VOICE = Object.freeze({
  [VOICE_PROFILE.DE_FEMALE_NEURAL]: { voice: "Polly.Vicki-Neural", language: "de-DE" },
  [VOICE_PROFILE.FR_FEMALE_NEURAL]: { voice: "Polly.Lea-Neural", language: "fr-FR" },
});

function voiceAttrs(profile) {
  const attrs = TWILIO_VOICE[profile];
  if (!attrs) throw new Error(`unbekanntes voiceProfile: ${profile}`);
  return attrs;
}

// Spracherkennung (Budget-Engine). `language` kommt aus dem voiceProfile des Gathers
// (dieselbe TWILIO_VOICE-Map wie der Say-Voice), nicht hartkodiert: so transkribiert
// STT IMMER in der Sprache, in der gesprochen wird. R9: Locale MUSS volles BCP-47 sein
// (de-DE/fr-FR) - ein blosses "de"/"fr" laesst den Provider still auf Englisch fallen.
// Fail-closed: unbekanntes Profil wirft (via voiceAttrs), kein stiller DE-Fallback.
// Attribut-Reihenfolge ist vertraglich: Twilio serialisiert in Einfuege-Reihenfolge,
// der Snapshot-Test nagelt sie fest (DE bleibt dadurch byte-identisch).
function gatherOpts(profile) {
  return {
    input: "speech",
    language: voiceAttrs(profile).language,
    speechTimeout: "auto",
    speechModel: "deepgram_nova-2-general",
    actionOnEmptyResult: true,
  };
}

// Eine Direktive an den VoiceResponse-Knoten haengen (eine Abstraktionsebene, G34).
function applyDirective(vr, d) {
  switch (d.kind) {
    case DIRECTIVE.SAY:
      vr.say(voiceAttrs(d.voiceProfile), d.text);
      break;
    case DIRECTIVE.GATHER: {
      const g = vr.gather({ ...gatherOpts(d.voiceProfile), action: d.action, method: "POST" });
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
