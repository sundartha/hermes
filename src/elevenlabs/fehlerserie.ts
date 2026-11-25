export const PERMANENT_ERROR_STREAK_LIMIT = 3;

const FEHLER = "[fristen] Fehlerserie schreiben fehlgeschlagen:";

interface FehlerserieStore {
  fortschreibeFehlerserie(eingabe: { callId: string; tenantId: string; permanent: boolean }): Promise<number>;
}

interface FehlerserieAnruf { id: string; tenantId: string }

export async function permanentErrorStreakExceeded({
  store,
  call,
  permanent,
}: {
  store: FehlerserieStore;
  call: FehlerserieAnruf;
  permanent: boolean;
}): Promise<boolean> {
  try {
    const serie = await store.fortschreibeFehlerserie({ callId: call.id, tenantId: call.tenantId, permanent });
    return serie >= PERMANENT_ERROR_STREAK_LIMIT;
  } catch (fehler) {
    console.error(FEHLER, call.id, String(fehler));
    return false;
  }
}
