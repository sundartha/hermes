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
