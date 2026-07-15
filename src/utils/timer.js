// Gemeinsamer Timer-Helfer (G5, Review-Blocker Runde 1: war byte-identisch in
// telnyx-call-control-ingest.js UND telnyx-conversation-watchdog.js dupliziert).
// setTimeout, der den Event-Loop NICHT am Leben haelt (der HTTP-Server tut das) -
// Muster middleware.js makeFixedWindowCounter (.unref()). Injizierbar fuer
// deterministische Fake-Timer-Tests (DI-Default in den Aufrufern).
export function defaultSetTimer(fn, ms) {
  const handle = setTimeout(fn, ms);
  if (handle && typeof handle.unref === "function") handle.unref();
  return handle;
}
