const LOG_TAG = "[el-vorspann]";
const TEILE = ["ms_tts", "ms_pruefe", "ms_waehle"];

interface Messbarer {
  id: string;
  startedAt: string;
  elCallControlId?: string | null;
}

const msSeitStart = ({ call, jetzt }: { call: Messbarer; jetzt: number }): string => String(jetzt - Date.parse(call.startedAt));

export function beginneAnrufstartMessung(jetztMs: () => number): {
  teil: <T>(name: string, lauf: () => Promise<T>) => Promise<T>;
  melde: (call: Messbarer) => void;
} {
  const teile: Record<string, number> = {};
  return {
    async teil<T>(name: string, lauf: () => Promise<T>): Promise<T> {
      const von = jetztMs();
      try {
        return await lauf();
      } finally {
        teile[name] = jetztMs() - von;
      }
    },
    melde(call: Messbarer): void {
      const ms = msSeitStart({ call, jetzt: jetztMs() });
      const teilzeiten = TEILE.map((name) => `${name}=${String(teile[name])}`).join(" ");
      console.log(`${LOG_TAG} auftrag_bis_wahl ms=${ms} ${teilzeiten} call=${call.id}`);
    },
  };
}

export function meldeAuftragBisKlingeln({
  call,
  ereignis,
  jetzt,
}: {
  call: Messbarer;
  ereignis: { callControlId: string | null };
  jetzt: number;
}): void {
  if (ereignis.callControlId === call.elCallControlId) return;
  console.log(`${LOG_TAG} auftrag_bis_klingeln ms=${msSeitStart({ call, jetzt })} call=${call.id}`);
}

const lies = (wert: unknown, schluessel: string): unknown => Reflect.get(Object(wert), schluessel);
const MS_JE_SEKUNDE = 1000;
const KEIN_WERT = "-";

export function meldeFirstMessageErgebnis({ callId, antwort }: { callId: string; antwort: Record<string, unknown> }): void {
  const eroeffnung = lies(lies(lies(antwort, "conversation_config_override"), "agent"), "first_message");
  const geliefert = typeof eroeffnung === "string";
  const laenge = geliefert ? eroeffnung.length : 0;
  console.log(`${LOG_TAG} first_message_ergebnis geliefert=${geliefert ? "ja" : "nein"} laenge=${String(laenge)} call=${callId}`);
}

const ERSTE_REDE_ZEICHEN = 40;

const VERBORGEN = "***";
const WORT_TRENNER = /\s+/;

const namensTeile = (namen: readonly unknown[]): string[] =>
  namen
    .flatMap((name) => (typeof name === "string" ? [name.trim(), ...name.split(WORT_TRENNER)] : []))
    .filter(Boolean)
    .sort((links, rechts) => rechts.length - links.length);

export function eroeffnungsFelder(antwort: unknown, namen: readonly unknown[]): string {
  const agent = lies(lies(antwort, "conversation_config_override"), "agent");
  const sprache = lies(agent, "language");
  const text = lies(agent, "first_message");
  if (typeof sprache !== "string" || typeof text !== "string") return "";
  const ohneNamen = namensTeile(namen).reduce((rest, name) => rest.replaceAll(name, VERBORGEN), text);
  return ` sprache=${sprache} erste_rede=${JSON.stringify(ohneNamen.slice(0, ERSTE_REDE_ZEICHEN))}`;
}

interface Gespraech {
  transcript?: ({ role?: unknown; message?: unknown; time_in_call_secs?: unknown } | null)[] | null;
  metadata?: { start_time_unix_secs?: unknown } | null;
}

interface Rede {
  call: Messbarer & { answeredAt?: string | null };
  conversation: Gespraech;
}

const alsMs = (wert: number): string => (Number.isFinite(wert) ? String(Math.round(wert)) : KEIN_WERT);

export function meldeAgentErsteRede({ call, conversation }: Rede): void {
  const zeile = conversation.transcript?.find((eintrag) => eintrag?.role === "agent" && Boolean(eintrag.message));
  if (!zeile) return;
  const start = conversation.metadata?.start_time_unix_secs;
  const sekunden = zeile.time_in_call_secs;
  const redeMs = typeof start === "number" && typeof sekunden === "number" ? (start + sekunden) * MS_JE_SEKUNDE : Number.NaN;
  const seitStart = alsMs(redeMs - Date.parse(call.startedAt));
  const seitAbheben = alsMs(redeMs - Date.parse(String(call.answeredAt)));
  console.log(`${LOG_TAG} agent_erste_rede ms_seit_start=${seitStart} ms_seit_abheben=${seitAbheben} call=${call.id}`);
}
