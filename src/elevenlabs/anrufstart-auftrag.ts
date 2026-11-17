import { z } from "zod";
import { MS_PER_SECOND } from "../utils/timer.js";
import { safeEqual } from "../util.ts";
import { REQUEST_TIMEOUT_MS } from "./convai.ts";

const AUFTRAG = z.object({ callId: z.string().min(1) });

const ABGLEICH_FRIST_MS = REQUEST_TIMEOUT_MS;
const ABGLEICH_VORLAUF_S = 60;
const ABGLEICH_SEITE = 50;

export const ANRUFSTART_AUSGANG = Object.freeze({
  GESTARTET: "gestartet",
  ABGEGLICHEN: "abgeglichen",
  OFFEN: "offen",
  UNKLAR: "unklar",
});

export type AnrufstartAusgang = (typeof ANRUFSTART_AUSGANG)[keyof typeof ANRUFSTART_AUSGANG];

interface Anruf {
  id: string;
  tenantId: string;
  to: string;
  elevenlabsConversationId?: string | null;
}

interface Gespraech {
  conversation_initiation_client_data?: { dynamic_variables?: { callee?: unknown; tenant_token?: unknown } };
}

interface Gespraechsliste {
  conversations?: { conversation_id: string }[];
  has_more?: boolean;
}

interface AnbieterGespraeche {
  liste: (abfrage: Record<string, string>) => Promise<Gespraechsliste | null>;
  hole: (conversationId: string) => Promise<Gespraech | null>;
}

interface Abhaengigkeiten {
  store: {
    leseCall: (callId: string) => Promise<Anruf | null | undefined>;
    load: () => { calls: Anruf[] };
    anrufstartMarker: {
      setze: (anfrage: { callId: string; tenantId: string; jetztIso: string }) => Promise<boolean>;
      lies: (callId: string) => Promise<string | null>;
    };
  };
  starte: (call: Anruf) => Promise<void>;
  anbieterGespraeche: AnbieterGespraeche;
  haltAnrufStartFest: (call: Anruf, conversationId: string) => unknown;
  beendeStartUnklar: (callId: string) => Promise<void>;
  mandantenToken: (tenantId: string) => string;
  jetztMs: () => number;
}

const variablenVon = (gespraech: Gespraech | null) => gespraech?.conversation_initiation_client_data?.dynamic_variables;

export function makeAnrufstartAuftrag({
  store,
  starte,
  anbieterGespraeche,
  haltAnrufStartFest,
  beendeStartUnklar,
  mandantenToken,
  jetztMs,
}: Abhaengigkeiten) {
  async function markiereVorAnbieterAufruf(call: Anruf): Promise<void> {
    const gesetzt = await store.anrufstartMarker.setze({
      callId: call.id,
      tenantId: call.tenantId,
      jetztIso: new Date(jetztMs()).toISOString(),
    });
    if (!gesetzt) throw new Error(`[anrufstart] Start schon versucht (call=${call.id}), kein zweiter Aufruf`);
  }

  const anderemAnrufGebunden = (call: Anruf, conversationId: string): boolean =>
    store.load().calls.some((andere) => andere.id !== call.id && andere.elevenlabsConversationId === conversationId);

  function gehoertZumAnruf(call: Anruf, gespraech: Gespraech | null): boolean {
    const erwartet = mandantenToken(call.tenantId);
    const variablen = variablenVon(gespraech);
    return variablen?.callee === call.to && erwartet !== "" && safeEqual(variablen.tenant_token, erwartet);
  }

  async function gespraecheZumAnruf(call: Anruf, versuchtIso: string) {
    const seitS = Math.floor(Date.parse(versuchtIso) / MS_PER_SECOND) - ABGLEICH_VORLAUF_S;
    const liste = await anbieterGespraeche.liste({
      call_start_after_unix: String(seitS),
      page_size: String(ABGLEICH_SEITE),
    });
    const frei = (liste?.conversations ?? [])
      .map((eintrag) => eintrag.conversation_id)
      .filter((id) => !anderemAnrufGebunden(call, id));
    const gespraeche = await Promise.all(frei.map(async (id) => ({ id, daten: await anbieterGespraeche.hole(id) })));
    const treffer = gespraeche.filter(({ daten }) => gehoertZumAnruf(call, daten)).map(({ id }) => id);
    return { treffer, vollstaendig: liste?.has_more !== true };
  }

  async function gleicheMitAnbieterAb(call: Anruf, versuchtIso: string): Promise<AnrufstartAusgang> {
    const { treffer, vollstaendig } = await gespraecheZumAnruf(call, versuchtIso);
    if (treffer.length === 1 && vollstaendig) {
      await haltAnrufStartFest(call, String(treffer[0]));
      return ANRUFSTART_AUSGANG.ABGEGLICHEN;
    }
    if (treffer.length === 0 && jetztMs() < Date.parse(versuchtIso) + ABGLEICH_FRIST_MS) return ANRUFSTART_AUSGANG.OFFEN;
    await beendeStartUnklar(call.id);
    return ANRUFSTART_AUSGANG.UNKLAR;
  }

  return async function fuehreAnrufstartAus(auftrag: { payload?: unknown } | null): Promise<AnrufstartAusgang> {
    const gelesen = AUFTRAG.safeParse(auftrag?.payload);
    const call = gelesen.success ? await store.leseCall(gelesen.data.callId) : null;
    if (!call) throw new Error("[anrufstart] Auftrag ohne bekannten Anruf");
    if (call.elevenlabsConversationId) return ANRUFSTART_AUSGANG.GESTARTET;
    const versuchtIso = await store.anrufstartMarker.lies(call.id);
    if (versuchtIso) return gleicheMitAnbieterAb(call, versuchtIso);
    await markiereVorAnbieterAufruf(call);
    await starte(call);
    return ANRUFSTART_AUSGANG.GESTARTET;
  };
}
