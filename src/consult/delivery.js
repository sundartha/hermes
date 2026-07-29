// Consult-Zustellung, Stufe 0 (A2): kurzer, client-gezogener Long-Poll ueber die
// bestehende /api/*-Kante. Stufe 1 (Tasks-Extension) und Stufe 2 (MRTR) ersetzen
// SPAETER GENAU DIESE DATEI - Vertrag (ports.js), Zustand (call.consults) und
// Aufrufer bleiben unberuehrt.
//
// WARUM EIN TICK-LOOP UND KEIN EVENT-BUS: der Zustand liegt am Call (A2), und er
// wird von mehreren Pfaden geschrieben (Route, spaeter agentTurn, pg-Re-Hydrierung
// nach Instanzwechsel). Ein Notifier waere ein ZWEITER Zustandskanal, den jeder
// dieser Pfade mitpflegen muesste - genau die Klasse, die im Repo schon einmal
// stille Datenverluste erzeugt hat. Der Loop liest die EINE Quelle. 250 ms Latenz
// gegen 22 s Haltezeit sind irrelevant.
//
// ZAEHLUNG AM CALL/TENANT, NICHT AM SOCKET: res.on("close") schliesst in
// routes/mcp.js Transport UND Server, waehrend ein Handler weiterlaufen kann. Die
// Zaehler werden im finally dekrementiert, nicht auf ein Socket-Ereignis hin.

export const CONSULT_POLL_HOLD_MS = 22000; // Abnahme 4 verlangt >= 20 s gemessen
export const CONSULT_POLL_TICK_MS = 250;
export const CONSULT_POLL_ABORT_MARGIN_MS = 3000;
export const CONSULT_POLL_ABORT_MS = CONSULT_POLL_HOLD_MS + CONSULT_POLL_ABORT_MARGIN_MS;
// Harte Obergrenzen gleichzeitig offener Polls - BENANNTE KONSTANTEN, KEIN
// Env-Knopf. Zwei je Call decken das legitime Muster ab (ein laufender Poll + ein
// nachrueckender waehrend des Ueberlapps), vier je Tenant decken parallele Anrufe.
export const MAX_OPEN_POLLS_PER_CALL = 2;
export const MAX_OPEN_POLLS_PER_TENANT = 4;

// Die drei Ereignisformen des Kanals (G25: kein nacktes String-Literal an fuenf Stellen).
export const CONSULT_EVENT = Object.freeze({ CONSULT: "consult", DONE: "done", NONE: "none" });

const NO_EVENT = Object.freeze({ event: CONSULT_EVENT.NONE, eventId: null, questions: [] });
const DONE_EVENT = Object.freeze({ event: CONSULT_EVENT.DONE, eventId: null, questions: [] });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Zaehler-Paar-Helfer: eine Map tenantId|callId -> Anzahl offener Warter.
function bump(counter, key, delta) {
  const next = (counter.get(key) || 0) + delta;
  if (next <= 0) counter.delete(key);
  else counter.set(key, next);
  return next;
}

/**
 * @param {{store: object, holdMs?: number, tickMs?: number}} deps
 *   holdMs/tickMs sind TEST-OVERRIDES nach dem Repo-Idiom von makeGracefulShutdown({exit, log});
 *   die Produktionsverdrahtung uebergibt sie nie. Ausdruecklich KEIN Env-Knopf.
 * @returns {import("./ports.js").ConsultDelivery}
 */
export function makeConsultDelivery({
  store,
  holdMs = CONSULT_POLL_HOLD_MS,
  tickMs = CONSULT_POLL_TICK_MS,
}) {
  // Instanz-Zustand, KEIN Modul-Global: eine zweite Instanz haette zweite Zaehler und
  // damit gar keine Obergrenze - deshalb wird genau EINE in server.js verdrahtet (INV-7).
  const pollsPerCall = new Map();
  const pollsPerTenant = new Map();
  let draining = false;

  // Liefert false, wenn eine der beiden Obergrenzen erreicht ist (dann wird KEIN Slot
  // belegt - der Aufrufer antwortet sofort mit "none").
  function claimSlot(callId, tenantId) {
    const callOpen = pollsPerCall.get(callId) || 0;
    const tenantOpen = pollsPerTenant.get(tenantId) || 0;
    if (callOpen >= MAX_OPEN_POLLS_PER_CALL || tenantOpen >= MAX_OPEN_POLLS_PER_TENANT)
      return false;
    bump(pollsPerCall, callId, 1);
    bump(pollsPerTenant, tenantId, 1);
    return true;
  }

  function freeSlot(callId, tenantId) {
    bump(pollsPerCall, callId, -1);
    bump(pollsPerTenant, tenantId, -1);
  }

  // Rein: liest den Store und uebersetzt ihn in ein Ereignis. Terminaler Call -> "done"
  // (der Client hoert damit auf zu pollen und holt sich das Ergebnis), offene Rueckfrage
  // -> "consult", sonst "none". Liefert NIE Transkript/Audio (Regel 5).
  function currentEvent(callId, afterEventId) {
    const consult = store.pendingConsult(callId, afterEventId);
    if (consult)
      return {
        event: CONSULT_EVENT.CONSULT,
        eventId: consult.id,
        questions: consult.questions,
      };
    const call = store.getCall(callId);
    return call && call.status !== "active" ? DONE_EVENT : NO_EVENT;
  }

  async function waitForEvent({ callId, tenantId, afterEventId, signal }) {
    if (!claimSlot(callId, tenantId)) return NO_EVENT;
    const deadline = Date.now() + holdMs;
    try {
      for (;;) {
        const event = currentEvent(callId, afterEventId);
        if (event.event !== CONSULT_EVENT.NONE) return event;
        if (draining || signal?.aborted || Date.now() >= deadline) return NO_EVENT;
        await sleep(tickMs);
      }
    } finally {
      freeSlot(callId, tenantId);
    }
  }

  return {
    waitForEvent,
    // Shutdown-Drain: jeder Warter loest binnen einem Tick auf. MUSS vor
    // httpServer.close() laufen - sonst haelt ein 22-s-Poll den Drain auf, der
    // Watchdog kappt mit exit(0) und der finale Store-Flush faellt aus.
    releaseOpenPolls() {
      draining = true;
    },
    openPollCount: (callId) => pollsPerCall.get(callId) || 0,
  };
}
