interface Platz {
  callId: string;
  tenantId: string;
  ablaufMs: number;
}

interface Grenzen extends Pick<Platz, "callId" | "tenantId"> {
  jeAnruf: number;
  jeMandant: number;
}

interface Belegung extends Grenzen {
  haltefristMs: number;
}

interface KonsultPlaetze {
  belegen(belegung: Belegung): Promise<number | null>;
  freigeben(platzId: number): Promise<void>;
  offenJeAnruf(callId: string): number;
}

export const konsultPlatzFrei = (
  zeilen: readonly Pick<Platz, "callId" | "tenantId">[],
  { callId, tenantId, jeAnruf, jeMandant }: Grenzen,
): boolean =>
  zeilen.filter((zeile) => zeile.callId === callId).length < jeAnruf &&
  zeilen.filter((zeile) => zeile.tenantId === tenantId).length < jeMandant;

export function makeKonsultPlaetze({ jetztMs = Date.now }: { jetztMs?: () => number } = {}): KonsultPlaetze {
  const plaetze = new Map<number, Platz>();
  let zaehler = 0;

  const aktuelle = () => {
    const jetzt = jetztMs();
    for (const [platzId, platz] of plaetze) if (platz.ablaufMs <= jetzt) plaetze.delete(platzId);
    return [...plaetze.values()];
  };

  function belegen({ callId, tenantId, jeAnruf, jeMandant, haltefristMs }: Belegung) {
    if (!konsultPlatzFrei(aktuelle(), { callId, tenantId, jeAnruf, jeMandant })) return Promise.resolve(null);
    zaehler += 1;
    plaetze.set(zaehler, { callId, tenantId, ablaufMs: jetztMs() + haltefristMs });
    return Promise.resolve(zaehler);
  }

  function freigeben(platzId: number) {
    plaetze.delete(platzId);
    return Promise.resolve();
  }

  const offenJeAnruf = (callId: string) => aktuelle().filter((platz) => platz.callId === callId).length;

  return { belegen, freigeben, offenJeAnruf };
}

export const konsultPlaetze = makeKonsultPlaetze();
