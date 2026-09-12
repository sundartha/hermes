// Telefonie-Registry: liefert die aktive Adapter-Instanz ueber eine ADAPTERS-Tabelle
// + pick(port, provider) (P5). Ein zweiter Provider wird HIER an EINER Datenstruktur
// registriert statt an mehreren Ternaries - pick() wirft fail-closed, wenn (port,
// provider) fehlt. voiceRenderer/messaging waehlen ueber einen optionalen
// provider-Param. Der Default ist DEFAULT_PROVIDER - EINE Quelle (G5) mit dem
// Rueckfall in routes/voice.js und state-ops.js. Ein eigener, hier hartkodierter
// Anbieter waere eine zweite Antwort auf dieselbe Frage "wer gilt, wenn nichts es
// sagt" und lief nach C-P1 kurzzeitig auseinander (siehe C-P1b). inboundSignatureVerifier dispatcht NACH Signatur-Header (nicht
// nach provider/To): die Signatur ist die erste fail-closed-Stufe und liegt
// strukturell VOR dem To-Routing (P3c) - To/provider vor gueltiger Signatur zu
// lesen waere Tenant-Spoofing. providerFromHeaders ist die EINZIGE Header->Provider-
// Karte: der Verifier dispatcht darueber, server.js (P6a) leitet daraus den
// Inbound-Provider ab (Single Source of Truth). voiceControl ist provider-aware
// (Telnyx-Outbound, Onboarding-Phase): Default = DEFAULT_PROVIDER wie oben. providerSupports/CAPABILITY (P5) sind eine zweite, davon
// getrennte Tabelle: Ja/Nein-Metadaten statt Adapter-Instanzen (ersetzt die
// verstreuten provider===PROVIDER.TELNYX-Capability-Checks in den Routen).
import { telnyxVoice } from "./adapters/telnyx/voice.js";
import { telnyxMessaging } from "./adapters/telnyx/messaging.js";
import { renderDirectives as telnyxRenderDirectives } from "./adapters/telnyx/render.js";
import { verifyInboundSignature as telnyxVerify } from "./adapters/telnyx/signature.js";
import { telnyxNumberProvisioning } from "./adapters/telnyx/numbers.js";
import { telnyxConfigRead } from "./adapters/telnyx/config-read.js";
import { telnyxMedia } from "./adapters/telnyx/media.js";
import { telnyxWebhookEvents } from "./adapters/telnyx/webhook-events.js";
import { DEFAULT_PROVIDER, PROVIDER } from "../store/defaults.js";
import { config } from "../config.js";
import crypto from "node:crypto";

// OUT-05 (F2): Test-Seam. fakeVoice ersetzt den Provider-Transport, wenn config.safety.fakeOriginate
// gesetzt ist (boot-gehaertet, boot-guard.js) - EIN zentraler Registry-Gate, server.js bleibt
// davon unberuehrt. originateCall liefert einen synthetischen, netzfreien Erfolg; endCall ist
// ein No-op. Alle Sicherheits-Gates (Budget/Denylist/Land/Stundenlimit/Offenlegung/Signatur)
// laufen unveraendert VOR voiceControl.
/** @type {import("./ports.js").VoiceControl} */
const fakeVoice = {
  async originateCall() {
    return { sid: `fake_${crypto.randomBytes(8).toString("hex")}` };
  },
  async endCall() {},
  // Call-Control-Variante (P4): netzfreie Aequivalente, damit ein fakeOriginate-Testpfad,
  // der die neuen Methoden ruft (ab P5), nicht crasht. fakeVoice bleibt vollstaendiger
  // VoiceControl-Ersatz (G11 - keine Teil-Implementierung des Ports).
  async originateViaCallControl() {
    return { callControlId: `fake_cc_${crypto.randomBytes(8).toString("hex")}` };
  },
  async endCallViaCallControl() {},
  async startAssistant() {},
  async speak() {},
};

// EINZIGE Provider->Port-Registrierung. Ein zweiter Provider wird HIER an einer
// Datenstruktur eingetragen statt an mehreren Ternaries. Jeder Eintrag IST der
// Rueckgabewert der Factory (Adapter-Objekt bzw. fertiger VoiceRenderer) - pick()
// bleibt dadurch uniform ueber alle Ports. Seit C-P4 ist Telnyx der einzige
// registrierte Anbieter; die Tabelle bleibt trotzdem eine Tabelle - sie ist der Ort,
// an dem ein neuer Adapter EINMAL eintraegt, statt an sechs Factories.
const PORT = Object.freeze({
  VOICE_CONTROL: "voiceControl",
  MESSAGING: "messaging",
  MEDIA_TRANSPORT: "mediaTransport",
  WEBHOOK_EVENTS: "webhookEvents",
  NUMBER_PROVISIONING: "numberProvisioning",
  // OUTBOUND-E4: rein LESENDER Port (Drift-Waechter). Eigener Name statt eines
  // Anhaengsels an NUMBER_PROVISIONING - der Port kauft nichts, das waere die falsche
  // Nachbarschaft.
  PROVIDER_CONFIG_READ: "providerConfigRead",
  VOICE_RENDERER: "voiceRenderer",
});

const ADAPTERS = Object.freeze({
  [PORT.VOICE_CONTROL]: { [PROVIDER.TELNYX]: telnyxVoice },
  [PORT.MESSAGING]: { [PROVIDER.TELNYX]: telnyxMessaging },
  [PORT.MEDIA_TRANSPORT]: { [PROVIDER.TELNYX]: telnyxMedia },
  [PORT.WEBHOOK_EVENTS]: { [PROVIDER.TELNYX]: telnyxWebhookEvents },
  [PORT.NUMBER_PROVISIONING]: { [PROVIDER.TELNYX]: telnyxNumberProvisioning },
  [PORT.PROVIDER_CONFIG_READ]: { [PROVIDER.TELNYX]: telnyxConfigRead },
  // Sonderfall (b): Eintrag = fertiger VoiceRenderer. Der Renderer bekommt seine
  // Plattform-Config LAZY zur Render-Zeit injiziert - der Arrow liest config erst beim
  // Aufruf, NICHT zur Import-Zeit (P15: kein Lazy-Init-Singleton, config-Bindung an der
  // Kompositionsstelle). sttProfile ist die neutrale STT-Wahl und geht als PROFIL durch,
  // nicht als aufgeloester Anbieter-String: die Uebersetzung gehoert in den Adapter.
  // Beide Telnyx-Pfade (Gather hier, Assistant in adapters/telnyx/voice.js) speisen sich
  // aus DEMSELBEN Config-Schluessel - zwei Schluessel waeren die alte Duplizierung,
  // nur von den Modell-Strings auf die Env-Namen verschoben.
  [PORT.VOICE_RENDERER]: {
    [PROVIDER.TELNYX]: {
      renderDirectives: (d) => telnyxRenderDirectives(d, { sttProfile: config.voice.sttProfile }),
    },
  },
});

// Liefert die registrierte Implementierung fuer (port, provider) oder wirft fail-closed.
// Der Fehlertext nennt Provider + Port (Diagnose) und enthaelt NIE ein Secret; "nicht
// unterstuetzt" ist bewusst Teil der Meldung (Bestandsvertrag numberProvisioning).
function pick(port, provider) {
  const impl = ADAPTERS[port]?.[provider];
  if (impl === undefined)
    throw new Error(`Provider '${provider}' fuer Port '${port}' nicht unterstuetzt`);
  return impl;
}

// Optionale Provider-Faehigkeiten (KEIN Adapter, sondern Ja/Nein-Metadaten). Ersetzt die
// drei verstreuten provider===PROVIDER.TELNYX-Checks (S2-22). Fail-closed: fehlender
// Provider ODER fehlende Capability -> false.
export const CAPABILITY = Object.freeze({
  AI_ASSISTANT: "aiAssistant", // Telnyx Call-Control-AI-Assistant-Pfad
  PLAY_AUDIO_TTS: "playAudioTts", // <Play>-Vorab-Synthese (ElevenLabs) statt <Say>
});

const PROVIDER_CAPABILITIES = Object.freeze({
  [PROVIDER.TELNYX]: Object.freeze({
    [CAPABILITY.AI_ASSISTANT]: true,
    [CAPABILITY.PLAY_AUDIO_TTS]: true,
  }),
});

export function providerSupports(provider, capability) {
  return PROVIDER_CAPABILITIES[provider]?.[capability] === true;
}

/** @returns {import("./ports.js").VoiceControl} */
export const voiceControl = (provider = DEFAULT_PROVIDER) => {
  // Sonderfall (a): fakeOriginate-Override VOR pick (Test-Seam, boot-gehaertet).
  if (config.safety.fakeOriginate) return fakeVoice;
  return pick(PORT.VOICE_CONTROL, provider);
};

/** @returns {import("./ports.js").Messaging} */
export const messaging = (provider = DEFAULT_PROVIDER) => pick(PORT.MESSAGING, provider);

// MediaTransport (Port 4, Realtime-WS-Frame-Schicht, Aufrufer bridge.js). Provider-
// aware wie voiceControl: Default = DEFAULT_PROVIDER (eine Quelle, G5).
/** @returns {import("./ports.js").MediaTransport} */
export const mediaTransport = (provider = DEFAULT_PROVIDER) => pick(PORT.MEDIA_TRANSPORT, provider);

// WebhookEvents (Port 5, reines Parsing VOR den Safety-Gates). Provider-aware wie
// mediaTransport: Default = DEFAULT_PROVIDER (eine Quelle, G5).
// Dispatch bewusst per provider-Param (NICHT header-basiert wie inboundSignatureVerifier):
// alle 3 Call-Sites kennen provider bereits vertrauenswuerdig aus dem Store bzw. aus
// providerFromHeaders+erfolgreicher Signaturpruefung weiter oben im Request-Pfad -
// header-basiert waere hier unnoetige Spoof-Flaeche (Provider-Wahl VOR Signatur-Trust).
/** @returns {import("./ports.js").WebhookEvents} */
export const webhookEvents = (provider = DEFAULT_PROVIDER) => pick(PORT.WEBHOOK_EVENTS, provider);

// NumberProvisioning (Port 3, Onboarding/Geld-Pfad). Behaelt seinen EIGENEN, explizit
// hingeschriebenen Default (statt DEFAULT_PROVIDER wie die uebrigen Factories): dieser
// Port kauft Nummern und damit Geld-Verpflichtungen: Bestandsvertrag seit P5. Fail-closed:
// ein nicht unterstuetzter Provider wirft, statt still einen falschen Adapter zu liefern.
/** @returns {import("./ports.js").NumberProvisioning} */
export const numberProvisioning = (provider = PROVIDER.TELNYX) =>
  pick(PORT.NUMBER_PROVISIONING, provider);

// OUTBOUND-E4: rein LESENDER Port (Drift-Waechter). Eigener, explizit hingeschriebener
// Default wie numberProvisioning - fail-closed bei unbekanntem Provider.
/** @returns {import("./ports.js").ProviderConfigRead} */
export const providerConfigRead = (provider = PROVIDER.TELNYX) =>
  pick(PORT.PROVIDER_CONFIG_READ, provider);

// Telnyx bekommt die STT-Profil-Wahl lazy zur Render-Zeit injiziert (Sonderfall b, siehe
// ADAPTERS oben) - der Renderer selbst bleibt config-frei/pur (Snapshot-Tests ohne Env).
// Die ElevenLabs-Plattform-Stimme wird hier seit IP3 NICHT mehr injiziert: der
// Relay-Zweig am <Say> ist entfernt (A/B-belegt defekt, Begruendung im Modulkopf von
// adapters/telnyx/render.js); der ElevenLabs-Weg der Budget-Engine ist die
// <Play>-Vorabsynthese. Der Call-Control-speak-Pfad liest den Config-Block weiterhin
// direkt (adapters/telnyx/voice.js) - diese Aenderung erreicht ihn nicht.
/** @returns {import("./ports.js").VoiceRenderer} */
export const voiceRenderer = (provider = DEFAULT_PROVIDER) => pick(PORT.VOICE_RENDERER, provider);

// Header -> Provider (rein, IO-frei). EINZIGE Stelle, die Inbound-Signatur-Header
// auf einen Provider abbildet: der Signatur-Verifier dispatcht darueber UND
// server.js leitet daraus den Inbound-Provider ab (Single Source of Truth, G5).
// Kein erkannter Header -> null (Aufrufer entscheidet ueber den Fallback).
// C-P3: x-twilio-signature wird BEWUSST nicht mehr erkannt. Ein Request mit diesem
// Header laeuft ueber null in den fail-closed-Zweig des Verifizierers (403) - der
// Header hier wieder einzutragen, ohne gleichzeitig einen Twilio-Verifizierer zu
// registrieren, oeffnet einen Zweig OHNE Signaturpruefung (Absolute Regel 1).
export function providerFromHeaders(headers) {
  const h = headers || {};
  if (h["telnyx-signature-ed25519"] !== undefined && h["telnyx-timestamp"] !== undefined)
    return PROVIDER.TELNYX;
  return null;
}

/** @returns {import("./ports.js").InboundSignatureVerifier} */
export const inboundSignatureVerifier = () => ({
  verifyInboundSignature(req) {
    // Provider aus den Headern. Seit C-P3 gibt es genau EINEN Inbound-Verifizierer;
    // alles andere (auch ein Twilio-Signatur-Header) faellt fail-closed durch.
    const provider = providerFromHeaders(req.headers);
    if (provider === PROVIDER.TELNYX) return telnyxVerify(req);
    return false;
  },
});
