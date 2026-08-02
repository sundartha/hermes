// AL-D3 (MESSAPPARAT, KEIN FIX von D-4): get_consult wird nur angeboten, solange ein
// Client pollt (consultClientIsPolling, src/consult/in-call.js). Der Bench uebernimmt
// genau diese Rolle - pollen und antworten -, damit das Werkzeug im Werkzeugsatz LIEGT.
// Die Poll-Frische selbst (CONSULT_POLL_FRESH_MS) wird NICHT angefasst.
//
// KEINE ZUGANGSDATEN: /api/* haengt hinter internalOnly (AUTH-P5, seit AUTH-P7 die
// einzige Sicherung) - der Bench laeuft ueber echten Loopback und braucht darum keine.
// Kaeme die Pumpe je durch einen Proxy (X-Forwarded-For gesetzt), weist internalOnly
// mit 403 ab (grund=not_local) statt mit 401 - die Pumpe bricht dann LAUT ab (der
// Fehler faellt bei stop() aus, statt still weiterzupollen).
const CONSULT_EVENT = Object.freeze({ CONSULT: "consult", DONE: "done" });
const HTTP_FORBIDDEN = 403;

async function fetchConsultEvent({ baseUrl, callId, afterEventId, signal }) {
  const query = afterEventId ? `?after=${encodeURIComponent(afterEventId)}` : "";
  const res = await fetch(`${baseUrl}/api/calls/${callId}/consult${query}`, { signal });
  if (res.status === HTTP_FORBIDDEN) {
    throw new Error("consult-pump: 403 auf GET /api/calls/:id/consult - internalOnly-Annahme verletzt (kein Loopback?)");
  }
  return res.json();
}

async function postConsultAnswer({ baseUrl, callId, eventId, answers, signal }) {
  return fetch(`${baseUrl}/api/calls/${callId}/consult/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event_id: eventId, answers }),
    signal,
  });
}

// Der Handler ruft store.noteConsultPoll(call.id) VOR dem Long-Poll (routes/api-calls.js)
// - die Frische erneuert sich also bei JEDEM Zyklus dieser Schleife von selbst, keine
// eigene Pflege noetig. Haltezeit 22 s gegen ein 25-s-Fenster (CONSULT_POLL_FRESH_MS)
// -> nahtlos.
async function pumpLoop({ baseUrl, callId, answers, signal, onFatal }) {
  let afterEventId = null;
  while (!signal.aborted) {
    let event;
    try {
      event = await fetchConsultEvent({ baseUrl, callId, afterEventId, signal });
    } catch (err) {
      if (signal.aborted || err.name === "AbortError") return;
      onFatal(err);
      return;
    }
    if (event.event === CONSULT_EVENT.DONE) return;
    if (event.event === CONSULT_EVENT.CONSULT) {
      afterEventId = event.eventId;
      await postConsultAnswer({ baseUrl, callId, eventId: event.eventId, answers, signal }).catch((err) => {
        if (!signal.aborted && err.name !== "AbortError") onFatal(err);
      });
    }
  }
}

/**
 * Startet die Pumpe. Laeuft bis stop() oder bis der Call terminal wird (event "done").
 *
 * @param {{baseUrl: string, callId: string, answers: string[]}} args
 * @returns {{stop: () => Promise<void>}}
 */
export function startConsultPump({ baseUrl, callId, answers }) {
  const controller = new AbortController();
  let fatalError = null;
  const onFatal = (err) => {
    fatalError = err;
  };
  const running = pumpLoop({ baseUrl, callId, answers, signal: controller.signal, onFatal });

  return {
    async stop() {
      controller.abort();
      await running;
      if (fatalError) throw fatalError;
    },
  };
}
