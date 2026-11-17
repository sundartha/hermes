export const SPRACHEN = Object.freeze(["de", "fr", "en"]);

const MANDANT = "abdruck-mandant";
const EIGENE_NUMMER = "+15550001234";
const ANRUFER = "+15550009876";
const INHABER = "Abdruck Inhaberin";
const VORNAME = "Abdruck";
const ZEITZONE = "Europe/Berlin";
const ANRUF_ID = "abdruck-anruf";
const POLL_NIE_MS = 3_600_000;
const SCHREIBENDE_METHODE = /^(record|mark)[A-Z]/;

const ZIELARTEN = Object.freeze(["fremd", "eigentuemer"]);
const ABDRUCK_ABSENDER = "abdruck-absender";

function stummeMethode(name) {
  return typeof name === "string" && SCHREIBENDE_METHODE.test(name) ? () => undefined : undefined;
}

export function abdruckSpeicher(sprache) {
  const nummer = Object.freeze({
    e164: EIGENE_NUMMER,
    tenantId: MANDANT,
    status: "active",
    provider: "telnyx",
    providerAgentPhoneNumberId: ABDRUCK_ABSENDER,
  });
  const zustand = Object.freeze({
    tenants: [{ id: MANDANT, defaultLanguage: sprache }],
    settings: {},
    numbers: [nummer],
  });
  const grundlage = {
    tenantContext: () => ({ ownerName: INHABER, firstName: VORNAME }),
    tenantTimezone: () => ZEITZONE,
    load: () => zustand,
    numberRecordByE164: (e164) => (e164 === nummer.e164 ? nummer : null),
    resolveProfile: () => ({ allowConsult: true }),
    getCall: () => null,
  };
  return new Proxy(grundlage, {
    get: (ziel, name) => (name in ziel ? ziel[name] : stummeMethode(name)),
  });
}

export function abdruckEinstellungen() {
  return {
    voice: {
      elevenLabsToolToken: "abdruck-werkzeug-geheimnis",
      elevenLabsOutbound: {
        apiKey: "abdruck-anbieter-zugang",
        agentId: "abdruck-agent",
        apiBase: "https://abdruck.invalid",
        resultPollMs: POLL_NIE_MS,
        environment: "production",
      },
    },
    telnyx: { telnyxElevenLabs: { voiceId: "abdruck-plattform-stimme" } },
    safety: { fakeOriginateElevenlabs: false },
  };
}

export function eingangsFaelle() {
  return SPRACHEN.flatMap((sprache) =>
    ZIELARTEN.map((anruferart) => ({
      name: `eingangsstart/${sprache}/${anruferart}`,
      speicherSprache: sprache,
      anruf: {
        id: ANRUF_ID,
        tenantId: MANDANT,
        direction: "inbound",
        status: "active",
        from: ANRUFER,
        to: EIGENE_NUMMER,
        language: sprache,
        ...(anruferart === "eigentuemer" ? { callerIsOwner: true } : {}),
      },
    })),
  );
}
