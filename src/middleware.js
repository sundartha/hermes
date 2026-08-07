// HTTP-Schutzschichten fuer das Gateway - bewusst in-house, ohne neue Dependency.

// CSP erlaubt Inline-Skripte/-Styles und Google Fonts. Der urspruengliche Grund - das
// alte Dashboard public/tenant.html mit Inline-<script>/<style> und onclick-Handlern -
// ist mit P14 entfallen. Die Regel bleibt hier BEWUSST unveraendert: das Verschaerfen
// ist ein eigener Auftrag (die App-Shell aus apps/web muss vorher gegen die engere
// Policy gemessen werden), nicht ein Nebeneffekt der Loeschung.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": CSP,
  });
  // API-Antworten (Transkripte!) duerfen nirgends zwischengespeichert werden
  if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
  next();
}

const RATE_WINDOW_MS = 60_000;
const RATE_SWEEP_INTERVAL_MS = 5 * 60_000;

// Generischer Fixed-Window-Zaehler pro Schluessel (G5): EINE Quelle fuer den Per-IP-
// Rate-Limiter (unten) UND den per-callId-Turn-Limiter im Telnyx-Shim (P5). windowMs/
// limit/sweepMs als EIN Optionsobjekt (F1). Liefert eine hit(key)-Funktion, die den
// Zaehler fuer key erhoeht und {allowed, retryAfterS} zurueckgibt - reine Query+Zaehl-
// Logik, kein HTTP-Wissen (der Express-Adapter bleibt beim Aufrufer).
export function makeFixedWindowCounter({ windowMs, limit, sweepMs }) {
  const windows = new Map(); // key -> { count, startedAt }

  // Abgelaufene Fenster regelmaessig raeumen, damit die Map nicht unbegrenzt waechst.
  // unref(): der Timer darf den Prozess (z.B. Tests) nicht am Beenden hindern.
  setInterval(() => {
    const now = Date.now();
    for (const [key, w] of windows) if (now - w.startedAt >= windowMs) windows.delete(key);
  }, sweepMs).unref();

  return function hit(key) {
    const now = Date.now();
    let w = windows.get(key);
    if (!w || now - w.startedAt >= windowMs) {
      w = { count: 0, startedAt: now };
      windows.set(key, w);
    }
    w.count++;
    return {
      allowed: w.count <= limit,
      retryAfterS: Math.ceil((w.startedAt + windowMs - now) / 1000),
    };
  };
}

// Fixed-Window-Rate-Limiter pro Client-IP. Die Ausnahmen (localhost-Socket,
// /voice mit eigener Provider-Signaturpruefung) entscheidet der Aufrufer in server.js.
export function createRateLimiter(limitPerMin) {
  const rateHit = makeFixedWindowCounter({
    windowMs: RATE_WINDOW_MS,
    limit: limitPerMin,
    sweepMs: RATE_SWEEP_INTERVAL_MS,
  });

  return (req, res, next) => {
    const { allowed, retryAfterS } = rateHit(req.ip);
    if (!allowed) {
      res.set("Retry-After", String(retryAfterS));
      return res.status(429).json({ error: "Zu viele Anfragen. Bitte spaeter erneut versuchen." });
    }
    next();
  };
}

// Catch-all 4-arg-Error-Middleware (AC4): Last-Resort-Netz fuer Routen-Fehler, die
// nicht schon per-Route gefangen wurden (synchron geworfen oder per next(err)
// gereicht). MUSS in server.js NACH allen Route-Mounts und VOR app.listen registriert
// werden (Express-Error-MW sieht nur Fehler von davor gemounteten Routen). Liefert dem
// Client IMMER eine generische 500 - NIE err.message, err.stack oder Config/Env (Secret-/
// Param-Leak, Regel 4/5). err.stack wird NUR server-seitig laut geloggt (Debug bleibt
// moeglich, ohne den Client-Body zu vergiften). Bei bereits gesendeten Headern an den
// Express-Default delegieren (kein zweiter Write). Die 4-arg-Signatur ist Pflicht -
// daran erkennt Express die Error-MW; _next bleibt deshalb in der Signatur.
export function errorHandler(err, _req, res, next) {
  // secret-frei + laut: nur der Stack ins Server-Log, nie in die Antwort.
  console.error("[error]", err && err.stack ? err.stack : String(err));
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "internal error" });
}
