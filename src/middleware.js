// HTTP-Schutzschichten fuer das Gateway - bewusst in-house, ohne neue Dependency.
const RATE_WINDOW_MS = 60_000;
const RATE_SWEEP_INTERVAL_MS = 5 * 60_000;

// Fixed-Window-Rate-Limiter pro Client-IP. Die Ausnahmen (localhost-Socket,
// /voice mit eigener Twilio-Signaturpruefung) entscheidet der Aufrufer in server.js.
export function createRateLimiter(limitPerMin) {
  const windows = new Map(); // ip -> { count, startedAt }

  // Abgelaufene Fenster regelmaessig raeumen, damit die Map nicht unbegrenzt waechst.
  // unref(): der Timer darf den Prozess (z.B. Tests) nicht am Beenden hindern.
  setInterval(() => {
    const now = Date.now();
    for (const [ip, w] of windows) if (now - w.startedAt >= RATE_WINDOW_MS) windows.delete(ip);
  }, RATE_SWEEP_INTERVAL_MS).unref();

  return (req, res, next) => {
    const now = Date.now();
    let w = windows.get(req.ip);
    if (!w || now - w.startedAt >= RATE_WINDOW_MS) {
      w = { count: 0, startedAt: now };
      windows.set(req.ip, w);
    }
    if (++w.count > limitPerMin) {
      res.set("Retry-After", String(Math.ceil((w.startedAt + RATE_WINDOW_MS - now) / 1000)));
      return res.status(429).json({ error: "Zu viele Anfragen. Bitte spaeter erneut versuchen." });
    }
    next();
  };
}
