export const PERMANENT_ERROR_STREAK_LIMIT = 3;

const FEHLER = "[fristen] Fehlerserie schreiben fehlgeschlagen:";

export async function permanentErrorStreakExceeded({ store, call, permanent }) {
  try {
    const serie = await store.fortschreibeFehlerserie({ callId: call.id, tenantId: call.tenantId, permanent });
    return serie >= PERMANENT_ERROR_STREAK_LIMIT;
  } catch (fehler) {
    console.error(FEHLER, call.id, String(fehler));
    return false;
  }
}
