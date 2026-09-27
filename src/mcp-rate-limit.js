// T2-07 (T-28): Rate-Limit fuer POST /mcp je MANDANT statt je IP. Hinter OpenAIs
// gemeinsamen ChatGPT-Egress-IPs draengt der eine globale IP-Eimer (createRateLimiter,
// middleware.js) sonst ALLE Nutzer in denselben Zaehler - ein einzelner drosselter
// Nutzer sperrt jeden anderen hinter derselben Egress-IP mit. Zwei getrennte Zaehler:
//
//   - Ablehnung: zaehlt NUR Anfragen, die mcpAuth (src/auth.js) ablehnt (kein Token,
//     Muell-Signatur, falscher iss/aud/exp, JWKS-Fehler, Token-/Legacy-Fehlschlag) -
//     Schutz gegen unauthentifizierte Flut, VOR jeder Identitaet, deshalb je IP.
//   - Mandant: zaehlt Anfragen NACH erfolgreicher Pruefung - je aufgeloestem Mandanten,
//     nicht je IP, damit viele Nutzer hinter derselben Egress-IP sich nicht gegenseitig
//     drosseln.
//
// Schluessel kommen NUR aus verifizierten oder Netz-Quellen (req.ip, ein vom
// Authorization-Server ausgestellter sub, ein am Gateway aufgeloester Mandant) - NIE aus
// unverifiziertem Token- oder Body-Inhalt. Das begrenzt das Kartenwachstum der beiden
// Zaehler-Maps auf dieselbe Groessenordnung wie heute (IPs) plus Mandanten und
// AS-ausgestellte subs; der Sweep (RATE_SWEEP_INTERVAL_MS) laeuft unveraendert.
//
// NICHT die anonymisierte Nutzer-ID aus dem Client-_meta (RFC-Referenz T-28 in
// tasks/openai-audit/00-openai-anforderungen.md): das ist ein unverifizierter, vom
// Client selbst gesetzter Body-Wert, den nur EIN Host ueberhaupt sendet. Der Mandant aus
// dem verifizierten Token ist die staerkere Grenze und deckt jeden Host gleichermassen ab.
import { makeFixedWindowCounter, RATE_WINDOW_MS, RATE_SWEEP_INTERVAL_MS } from "./middleware.js";
import { isTrustedLocalCaller } from "./routes/_tenant.js";
import { TENANT_REJECT } from "./request-tenant.js";

// Ablehnungs-Schluessel (Tabelle PLAN-OPENAI-TECHNIK-2.md/T2-07-spec): eine nicht-leere,
// vom Authorization-Server verifizierte sub (nur bei ERR_JWT_EXPIRED oder
// insufficient_scope uebergeben, s. src/auth.js) zaehlt fuer sich; jeder andere
// Ablehnungsgrund (kein Token, Muell-Signatur, fehlendes exp, JWKS-Fehler, Token-/
// Legacy-Fehlschlag) faellt auf die IP zurueck (fail-closed: eine unbekannte/fehlende
// sub darf nie unbegrenzt bleiben).
export function ablehnungsSchluessel(req, verifizierteSub) {
  if (typeof verifizierteSub === "string" && verifizierteSub) return `sub:${verifizierteSub}`;
  return `ip:${req.ip}`;
}

// Mandanten-Schluessel: ohne req.auth (Token-/Legacy-/off-Modus) gilt weiter die IP wie
// vor dieser Phase. Mit req.auth (OAuth) zaehlt der aufgeloeste Mandant; bleibt die
// Aufloesung TENANT_REJECT (Stub-Fassade, T2-05), zaehlt die verifizierte sub des Tokens,
// ohne sub die IP - nie unbegrenzt, nie aus unverifiziertem Inhalt.
export function mandantSchluessel(req, scopedTenant) {
  if (!req.auth) return `ip:${req.ip}`;
  if (scopedTenant === TENANT_REJECT) return req.auth.sub ? `sub:${req.auth.sub}` : `ip:${req.ip}`;
  return `tenant:${scopedTenant}`;
}

const TRUSTED_LOCAL_RESULT = Object.freeze({ allowed: true, retryAfterS: 0 });

// makeMcpDrosseln({ limitPerMin }): baut die zwei Fixed-Window-Zaehler (EINE Instanz je
// Prozess, nicht pro Request - sonst haette jeder Request ein frisches, leeres Fenster).
// isTrustedLocalCaller (In-Process-MCP-Tools/stdio-Nachbau) zaehlt bei KEINEM der beiden
// Zaehler mit - Paritaet zum globalen IP-Limiter, der denselben Aufrufer schon heute
// ausnimmt (src/app.js).
export function makeMcpDrosseln({ limitPerMin }) {
  const ablehnungHit = makeFixedWindowCounter({
    windowMs: RATE_WINDOW_MS,
    limit: limitPerMin,
    sweepMs: RATE_SWEEP_INTERVAL_MS,
  });
  const mandantHit = makeFixedWindowCounter({
    windowMs: RATE_WINDOW_MS,
    limit: limitPerMin,
    sweepMs: RATE_SWEEP_INTERVAL_MS,
  });

  function ablehnung(req, { verifizierteSub = null } = {}) {
    if (isTrustedLocalCaller(req)) return TRUSTED_LOCAL_RESULT;
    return ablehnungHit(ablehnungsSchluessel(req, verifizierteSub));
  }

  function mandant(req, { scopedTenant } = {}) {
    if (isTrustedLocalCaller(req)) return TRUSTED_LOCAL_RESULT;
    return mandantHit(mandantSchluessel(req, scopedTenant));
  }

  // T2-07-Nachbesserung (Befund safety/wichtig, Brute-Force): liest den IP-Eimer des
  // Ablehnungs-Zaehlers, OHNE zu zaehlen. Nicht erlaubt, sobald diese IP ihr Fenster an
  // Fehlversuchen schon ausgeschoepft hat. Nutzer: der statische Token-/Legacy-Vergleich in
  // mcpAuth (src/auth.js) fragt das VOR safeEqual - ab dem Fenster wird fuer diese IP gar
  // nicht mehr verglichen, auch ein richtig geratenes Token bekommt 429 (sonst verriete
  // "200 statt 429" jede richtige Vermutung, ungebremst). OAuth nutzt das bewusst NICHT:
  // Signaturen sind nicht ratbar, und gueltige ChatGPT-Nutzer hinter derselben Egress-IP
  // sollen nicht fuer fremde Fehlversuche gesperrt werden (T-28).
  function ipSperre(req) {
    if (isTrustedLocalCaller(req)) return TRUSTED_LOCAL_RESULT;
    return ablehnungHit.peek(ablehnungsSchluessel(req, null));
  }

  return { ablehnung, mandant, ipSperre };
}
