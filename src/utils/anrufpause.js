export async function anrufpauseGilt(store) {
  if (!store.anrufpauseGelesen) return store.anrufpauseAktiv?.() === true;
  try {
    return (await store.anrufpauseGelesen()) === true;
  } catch (fehler) {
    console.error("[anrufpause] nicht lesbar, gilt als aktiv:", fehler?.message);
    return true;
  }
}
