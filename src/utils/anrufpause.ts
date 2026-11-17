import { fehlerText } from "./fehler-text.ts";

export interface PausenSpeicher {
  anrufpauseGelesen?: () => Promise<unknown>;
  anrufpauseAktiv?: () => unknown;
}

export async function anrufpauseGilt(store: PausenSpeicher): Promise<boolean> {
  if (!store.anrufpauseGelesen) return store.anrufpauseAktiv?.() === true;
  try {
    return (await store.anrufpauseGelesen()) === true;
  } catch (fehler) {
    console.error("[anrufpause] nicht lesbar, gilt als aktiv:", fehlerText(fehler));
    return true;
  }
}
