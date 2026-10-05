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

const ZIEL_JE_SPRACHE = Object.freeze({
  de: "+491737250000",
  fr: "+33612345678",
  en: "+447700900123",
});

const AUFTRAG = Object.freeze({
  goal: "Einen Beratungstermin in der kommenden Woche vereinbaren",
  constraints: "Keine Zusage über 50 Euro",
  context: {
    summary: "Rückruf zu einer Terminanfrage",
    recipient_relationship: "Praxis",
    desired_outcome: "fester Termin",
    key_facts: ["Kundennummer liegt vor", "vormittags bevorzugt"],
  },
  briefing: "Die Anfrage kam per E-Mail.",
  mandate: {
    decide_freely: "Uhrzeit frei wählen",
    fallback_order: "sonst einen Rückruf anbieten",
  },
});

const ZIELARTEN = Object.freeze(["fremd", "eigentuemer"]);
const CONSULT_STUFEN = Object.freeze(["consult-an", "consult-aus"]);

function stummeMethode(name) {
  return typeof name === "string" && SCHREIBENDE_METHODE.test(name) ? () => undefined : undefined;
}

export function abdruckSpeicher(sprache) {
  const nummer = Object.freeze({ e164: EIGENE_NUMMER, tenantId: MANDANT, status: "active", provider: "telnyx" });
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
        agentPhoneNumberId: "abdruck-absender",
        apiBase: "https://abdruck.invalid",
        resultPollMs: POLL_NIE_MS,
        environment: "production",
      },
    },
    telnyx: { telnyxElevenLabs: { voiceId: "abdruck-plattform-stimme" } },
    safety: { fakeOriginateElevenlabs: false },
  };
}

function ausgehenderAnruf({ ziel, sprache, eigentuemer }) {
  return {
    ...structuredClone(AUFTRAG),
    id: ANRUF_ID,
    tenantId: MANDANT,
    direction: "outbound",
    status: "active",
    from: EIGENE_NUMMER,
    to: ziel,
    ...(sprache ? { language: sprache } : {}),
    ...(eigentuemer ? { calleeIsOwner: true } : {}),
  };
}

function anrufstartFall({ sprache, zielart, consult }) {
  return {
    name: `anrufstart/${sprache}/${zielart}/${consult}`,
    speicherSprache: sprache,
    consult: consult === "consult-an",
    anruf: ausgehenderAnruf({
      ziel: ZIEL_JE_SPRACHE[sprache],
      sprache,
      eigentuemer: zielart === "eigentuemer",
    }),
  };
}

const MISCHSPRACHE_FALL = Object.freeze({
  name: "anrufstart/de-nach-fr/fremd/consult-aus",
  speicherSprache: "de",
  consult: false,
  anruf: ausgehenderAnruf({ ziel: ZIEL_JE_SPRACHE.fr, sprache: null, eigentuemer: false }),
});

export function anrufstartFaelle() {
  const faelle = SPRACHEN.flatMap((sprache) =>
    ZIELARTEN.flatMap((zielart) => CONSULT_STUFEN.map((consult) => anrufstartFall({ sprache, zielart, consult }))),
  );
  return [...faelle, MISCHSPRACHE_FALL];
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
