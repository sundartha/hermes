interface ZeitplanOptionen {
  beiFehler?: (fehler: unknown) => void;
}

export interface Zeitplaner {
  plane: (name: string, intervallMs: number, lauf: () => unknown, optionen?: ZeitplanOptionen) => Promise<void>;
}

export const zeitplanImProzess: Zeitplaner = {
  plane(_name, intervallMs, lauf, { beiFehler } = {}) {
    setInterval(() => {
      void new Promise((fertig) => {
        fertig(lauf());
      }).catch(beiFehler);
    }, intervallMs).unref();
    return Promise.resolve();
  },
};
