import { z } from "zod";
import { MS_PER_SECOND } from "../utils/timer.ts";
import { safeEqual } from "../util.ts";
import { REQUEST_TIMEOUT_MS } from "./convai.ts";

const AUFTRAG = z.object({ callId: z.string().min(1) });

const ABGLEICH_FRIST_MS = REQUEST_TIMEOUT_MS;
const ABGLEICH_VORLAUF_S = 60;
const ABGLEICH_SEITE = 50;

export const ANRUFSTART_WARTE_TAKT_MS = MS_PER_SECOND;

export const ANRUFSTART_GRUND = Object.freeze({ MARKER_FEHLT: "marker-nicht-gesetzt" });

export const ANRUFSTART_GRUND_ABSCHALTEN = "abschalten";

export const ANRUFSTART_AUSGANG = Object.freeze({
  GESTARTET: "gestartet",
  ABGEGLICHEN: "abgeglichen",
  OFFEN: "offen",
  UNKLAR: "unklar",
  ABGESPERRT: "abgesperrt",
  ABGELAUFEN: "abgelaufen",
});

export const ANRUFSTART_SPERRE = Object.freeze({
  EINGEFROREN: "outbound-frozen",
  PAUSE: "anrufpause",
});

interface Sperren<A> {
  eingefroren: () => boolean | Promise<boolean>;
  pausiert: (call: A) => boolean | Promise<boolean>;
}

export const ANRUFSTART_SPERR_TORE = Object.freeze([
  { name: "eingefroren", grund: ANRUFSTART_SPERRE.EINGEFROREN, gesperrt: <A>(sperren: Sperren<A>) => sperren.eingefroren() },
  { name: "pausiert", grund: ANRUFSTART_SPERRE.PAUSE, gesperrt: <A>(sperren: Sperren<A>, call: A) => sperren.pausiert(call) },
]);

export type AnrufstartAusgang = (typeof ANRUFSTART_AUSGANG)[keyof typeof ANRUFSTART_AUSGANG];

interface Anruf {
  id: string;
  tenantId: string;
  to: string;
  startedAt?: string;
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

interface Platz<A extends Anruf> {
  belege: (call: A) => Promise<boolean>;
  beendeNachWartefrist: (callId: string) => Promise<void>;
  warte: (ms: number) => Promise<void>;
}

interface Abhaengigkeiten<A extends Anruf> {
  store: {
    leseCall: (callId: string) => Promise<A | null | undefined>;
    anderesAnrufMitKonversation: (callId: string, conversationId: string) => Promise<boolean>;
    anrufstartMarker: {
      setze: (anfrage: { callId: string; tenantId: string; jetztIso: string }) => Promise<boolean>;
      lies: (callId: string) => Promise<string | null>;
    };
  };
  starte: (call: A) => Promise<void>;
  anbieterGespraeche: AnbieterGespraeche;
  haltAnrufStartFest: (call: A, conversationId: string) => unknown;
  beendeStartUnklar: (callId: string) => Promise<void>;
  sperren: Sperren<A> & {
    abgebrochen: (call: A) => boolean;
    abschaltend?: (() => boolean) | undefined;
  };
  platz?: Platz<A>;
  wartefristMs?: number;
  beendeOhneWahl: (callId: string, grund: string) => Promise<void>;
  armeTimer: (call: A) => void;
  mandantenToken: (tenantId: string) => string;
  jetztMs: () => number;
}

async function ersterSperrGrund<A>(sperren: Sperren<A>, call: A): Promise<string | null> {
  for (const tor of ANRUFSTART_SPERR_TORE) {
    if (await tor.gesperrt(sperren, call)) return tor.grund;
  }
  return null;
}

const variablenVon = (gespraech: Gespraech | null) => gespraech?.conversation_initiation_client_data?.dynamic_variables;

export function makeAnrufstartAuftrag<A extends Anruf>({
  store,
  starte,
  anbieterGespraeche,
  haltAnrufStartFest,
  beendeStartUnklar,
  sperren,
  beendeOhneWahl,
  armeTimer,
  mandantenToken,
  jetztMs,
  platz,
  wartefristMs = 0,
}: Abhaengigkeiten<A>) {
  async function setzeMarker(call: A): Promise<boolean> {
    try {
      return await store.anrufstartMarker.setze({
        callId: call.id,
        tenantId: call.tenantId,
        jetztIso: new Date(jetztMs()).toISOString(),
      });
    } catch (fehler) {
      await beendeOhneWahl(call.id, ANRUFSTART_GRUND.MARKER_FEHLT);
      throw fehler;
    }
  }

  async function markiereVorAnbieterAufruf(call: A): Promise<void> {
    const gesetzt = await setzeMarker(call);
    if (!gesetzt) throw new Error(`[anrufstart] Start schon versucht (call=${call.id}), kein zweiter Aufruf`);
  }

  const anderemAnrufGebunden = (call: Anruf, conversationId: string): Promise<boolean> =>
    store.anderesAnrufMitKonversation(call.id, conversationId).catch(() => true);

  function gehoertZumAnruf(call: Anruf, gespraech: Gespraech | null): boolean {
    const erwartet = mandantenToken(call.tenantId);
    const variablen = variablenVon(gespraech);
    return variablen?.callee === call.to && erwartet !== "" && safeEqual(variablen.tenant_token, erwartet);
  }

  async function gespraecheZumAnruf(call: A, versuchtIso: string) {
    const seitS = Math.floor(Date.parse(versuchtIso) / MS_PER_SECOND) - ABGLEICH_VORLAUF_S;
    const liste = await anbieterGespraeche.liste({
      call_start_after_unix: String(seitS),
      page_size: String(ABGLEICH_SEITE),
    });
    const kennungen = (liste?.conversations ?? []).map((eintrag) => eintrag.conversation_id);
    const gebunden = await Promise.all(kennungen.map((id) => anderemAnrufGebunden(call, id)));
    const frei = kennungen.filter((_id, nr) => !gebunden[nr]);
    const gespraeche = await Promise.all(frei.map(async (id) => ({ id, daten: await anbieterGespraeche.hole(id) })));
    const treffer = gespraeche.filter(({ daten }) => gehoertZumAnruf(call, daten)).map(({ id }) => id);
    return { treffer, vollstaendig: liste?.has_more !== true };
  }

  async function gleicheMitAnbieterAb(call: A, versuchtIso: string): Promise<AnrufstartAusgang> {
    const { treffer, vollstaendig } = await gespraecheZumAnruf(call, versuchtIso);
    if (treffer.length === 1 && vollstaendig) {
      await haltAnrufStartFest(call, String(treffer[0]));
      armeTimer(call);
      return ANRUFSTART_AUSGANG.ABGEGLICHEN;
    }
    if (treffer.length === 0 && jetztMs() < Date.parse(versuchtIso) + ABGLEICH_FRIST_MS) return ANRUFSTART_AUSGANG.OFFEN;
    await beendeStartUnklar(call.id);
    return ANRUFSTART_AUSGANG.UNKLAR;
  }

  async function sperrGrund(call: A): Promise<string | null> {
    const grund = await ersterSperrGrund(sperren, call);
    if (grund) return grund;
    if (sperren.abschaltend?.()) return ANRUFSTART_GRUND_ABSCHALTEN;
    return null;
  }

  async function sperreVorDemStart(call: A): Promise<boolean> {
    if (sperren.abgebrochen(call)) return true;
    const grund = await sperrGrund(call);
    if (grund) await beendeOhneWahl(call.id, grund);
    return grund !== null;
  }

  async function wartePlatz(aktuell: A, fristEnde: number): Promise<AnrufstartAusgang | null> {
    if (await sperreVorDemStart(aktuell)) return ANRUFSTART_AUSGANG.ABGESPERRT;
    if (!platz || (jetztMs() < fristEnde && (await platz.belege(aktuell)))) return null;
    if (!(jetztMs() < fristEnde)) {
      await platz.beendeNachWartefrist(aktuell.id);
      return ANRUFSTART_AUSGANG.ABGELAUFEN;
    }
    await platz.warte(ANRUFSTART_WARTE_TAKT_MS);
    const neu = await store.leseCall(aktuell.id);
    if (!neu) throw new Error("[anrufstart] Auftrag ohne bekannten Anruf");
    return wartePlatz(neu, fristEnde);
  }

  return async function fuehreAnrufstartAus(auftrag: { payload?: unknown } | null): Promise<AnrufstartAusgang> {
    const gelesen = AUFTRAG.safeParse(auftrag?.payload);
    const call = gelesen.success ? await store.leseCall(gelesen.data.callId) : null;
    if (!call) throw new Error("[anrufstart] Auftrag ohne bekannten Anruf");
    if (call.elevenlabsConversationId) return ANRUFSTART_AUSGANG.GESTARTET;
    const versuchtIso = await store.anrufstartMarker.lies(call.id);
    if (versuchtIso) return gleicheMitAnbieterAb(call, versuchtIso);
    const ohnePlatz = await wartePlatz(call, Date.parse(call.startedAt ?? "") + wartefristMs);
    if (ohnePlatz) return ohnePlatz;
    await markiereVorAnbieterAufruf(call);
    await starte(call);
    armeTimer(call);
    return ANRUFSTART_AUSGANG.GESTARTET;
  };
}
