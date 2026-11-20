import { z } from "zod";
import { anfrage } from "../utils/anfrage.js";
import { MS_PER_SECOND } from "../utils/timer.ts";
import { callLocaleFor } from "./call-locale.ts";
import { fetchAgent, type ConvaiKonto } from "./convai.ts";

const STIMMEN_FRIST_S = 10;

export const STIMMEN_FRIST_MS = STIMMEN_FRIST_S * MS_PER_SECOND;

const EIGENE_STIMME = z.object({
  conversation_config: z.object({ tts: z.object({ voice_id: z.string().min(1) }) }),
});

const OVERRIDE_FREIGEGEBEN = z.object({
  platform_settings: z.object({
    overrides: z.object({
      conversation_config_override: z.object({ tts: z.object({ voice_id: z.literal(true) }) }),
    }),
  }),
});

export function stimmenAnzahlVon({
  angefordert,
  agent,
  vorspannGespielt,
}: {
  angefordert: string;
  agent: unknown;
  vorspannGespielt: boolean;
}): number | null {
  const gelesen = EIGENE_STIMME.safeParse(agent).data;
  const eigene = gelesen?.conversation_config.tts.voice_id;
  if (eigene === undefined) return null;
  const freigegeben = OVERRIDE_FREIGEGEBEN.safeParse(agent).success;
  const wirksam = freigegeben ? angefordert : eigene;
  return new Set(vorspannGespielt ? [angefordert, wirksam] : [wirksam]).size;
}

interface Anruf {
  direction?: string;
  tenantId: string;
  from?: string;
  to: string;
  language?: string;
  bridgedAt?: string | null;
}

type MandantZustand = Parameters<typeof callLocaleFor>[0];

interface Speicher {
  load: () => MandantZustand;
  numberRecordByE164: (e164: string | undefined) => { language?: string | null } | null;
  leseCall: (callId: string) => Promise<Anruf | null>;
}

interface Konfiguration {
  telnyx: { telnyxElevenLabs: { voiceId: string } };
  voice: { elevenLabsOutbound: ConvaiKonto & { agentId: string } };
}

function angeforderteStimme({ store, config, call }: { store: Speicher; config: Konfiguration; call: Anruf }): string {
  const eingehend = call.direction === "inbound";
  const { telnyxElevenLabs } = config.telnyx;
  const standardStimme = telnyxElevenLabs.voiceId;
  return callLocaleFor(store.load(), {
    tenantId: call.tenantId,
    numberRecord: store.numberRecordByE164(eingehend ? call.to : call.from),
    ownerName: "",
    defaultVoiceId: standardStimme,
    to: call.to,
    callLanguage: call.language,
  }).voiceId;
}

export async function ermittleStimmenAnzahl({
  store,
  config,
  callId,
  fetchImpl = anfrage,
}: {
  store: Speicher;
  config: Konfiguration;
  callId: string;
  fetchImpl?: Parameters<typeof fetchAgent>[0]["fetchImpl"];
}): Promise<number | null> {
  try {
    const call = await store.leseCall(callId);
    if (!call) return null;
    const angefordert = angeforderteStimme({ store, config, call });
    const { agentId, ...konto } = config.voice.elevenLabsOutbound;
    const agent = await fetchAgent({ fetchImpl, account: konto, agentId, timeoutMs: STIMMEN_FRIST_MS });
    return stimmenAnzahlVon({ angefordert, agent, vorspannGespielt: Boolean(call.bridgedAt) });
  } catch (fehler) {
    console.warn(`[el-stimmen] nicht ermittelt (call=${callId}): ${fehler instanceof Error ? fehler.message : "unbekannt"}`);
    return null;
  }
}
