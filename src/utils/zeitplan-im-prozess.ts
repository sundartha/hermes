export type Lauf = () => unknown;

export interface LaufMitMeldung {
  lauf: Lauf;
  beiFehler: (fehler: unknown) => void;
}

export interface Zeitplaner {
  plane: (name: string, intervallMs: number, lauf: Lauf | LaufMitMeldung) => Promise<void>;
}

const wirfWeiter = (fehler: unknown): void => {
  throw fehler;
};

export function normalisiereLauf(lauf: Lauf | LaufMitMeldung): LaufMitMeldung {
  return typeof lauf === "function" ? { lauf, beiFehler: wirfWeiter } : lauf;
}

export async function fuehreLaufAus({ lauf, beiFehler }: LaufMitMeldung): Promise<void> {
  try {
    await lauf();
  } catch (fehler) {
    beiFehler(fehler);
    throw fehler;
  }
}

export const zeitplanImProzess: Zeitplaner = {
  plane(_name, intervallMs, lauf) {
    const { lauf: arbeit, beiFehler } = normalisiereLauf(lauf);
    setInterval(() => {
      void new Promise((fertig) => {
        fertig(arbeit());
      }).catch(beiFehler);
    }, intervallMs).unref();
    return Promise.resolve();
  },
};
