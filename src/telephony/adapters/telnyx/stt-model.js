// Telnyx-Uebersetzung der neutralen STT-Wahl. EINZIGER Telnyx-Ort mit einem
// Deepgram-Modellnamen; von BEIDEN Telnyx-Verbrauchern importiert - dem TeXML-Gather
// (render.js) und dem Call-Control-Assistant (voice.js). Praezedenz: elevenlabs-voice.js
// wird ebenfalls von beiden genutzt. Die Tabelle darf NICHT in einer der beiden Dateien
// wohnen, sonst waere die Duplizierung nur umgezogen (G5/G22).
//
// engine und model gehoeren in EINEN Datensatz: der model-Vendor MUSS zu
// transcriptionEngine passen (Telnyx-Doku). Zwei getrennt konfigurierbare Groessen daraus
// zu machen schuefe eine NEUE Divergenzachse, wo heute keine ist. Der Assistant-Pfad nimmt
// aus demselben Datensatz nur `model` - Call-Control-JSON kennt kein Engine-Feld.
//
// Rein: kein IO, kein config-Import (Aufrufer injizieren das Profil).
import { DEFAULT_STT_PROFILE, STT_PROFILE } from "../../stt-profile.js";

const TELNYX_STT = Object.freeze({
  // "Deepgram" + "deepgram/nova-3": hoechste Erkennungsgenauigkeit (Owner-Wahl
  // 2026-06-16, Premium-Add-on), mehrsprachig (DE+FR+EN). Der Assistant-Pfad wurde am
  // 2026-08-06 auf denselben Wert nachgezogen (B-7): flux lieferte auf deutschem
  // Telefon-Audio englischen Kauderwelsch und ignorierte den Sprach-Hint. Der Preis ist
  // bewusst bezahlt: eot_threshold/eager_eot_threshold/eot_timeout_ms sind flux-only,
  // mit nova-3 bestimmt Telnyx die Turn-Grenzen selbst.
  [STT_PROFILE.ACCURATE]: Object.freeze({ engine: "Deepgram", model: "deepgram/nova-3" }),
});

// Ohne Argument -> Default-Profil. Das haelt arg-lose Bestandsaufrufe (renderDirectives
// ohne opts, Snapshot-Tests) byte-identisch; ein GESETZTES, unbekanntes Profil wirft
// fail-closed wie voiceAttrs - ein Programmierfehler, kein Betriebszustand. Der
// Betriebsfall "Tippfehler in der Hosting-Umgebung" wird nicht hier, sondern am Boot
// abgefangen (boot-guard), damit er nie den Render-Pfad eines laufenden Anrufs trifft.
export function sttAttrs(profile = DEFAULT_STT_PROFILE) {
  const attrs = TELNYX_STT[profile];
  if (!attrs) throw new Error(`unbekanntes sttProfile: ${profile}`);
  return attrs;
}
