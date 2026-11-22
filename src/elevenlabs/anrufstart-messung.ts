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
      const teilzeiten = TEILE.map((name) => `${name}=${String(teile[name] ?? 0)}`).join(" ");
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
