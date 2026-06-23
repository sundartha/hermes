// Duenner fetch-Wrapper gegen die Hermes-Gateway-API. Das Frontend ist ein
// DUENNER CLIENT (Strategie 2.3): KEINE Auth-/Session-Logik hier, KEIN Token,
// KEIN PKCE, KEIN localStorage. Das session-Cookie ist HttpOnly und faehrt im
// same-origin-Modell bei jedem Aufruf automatisch mit -- JS kommt nie an das
// Cookie und braucht es auch nicht. credentials:"same-origin" ist der einzige
// defensive Zusatz; ein Authorization-Header wird NIE gesetzt.

// HTTP-Status, die die fail-closed Auth-Schicht des Gateways (webAuth) liefert:
// 401 = kein/ungueltiges Session-Cookie, 403 = Tenant noch nicht freigegeben.
// HTTP_UNAUTHORIZED exportiert, damit Inseln den 401-Fall (abgelaufene Session)
// erkennen, ohne den Magic-Wert zu duplizieren.
export const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

// UI-Zustaende, die die App-Shell aus genau EINEM state-Fetch ableitet. Eine
// Quelle (kein Magic-String an den Verbrauchsstellen), eingefroren gegen Mutation.
export const AUTH_STATE = Object.freeze({
  AUTHENTICATED: "authenticated",
  ANONYMOUS: "anonymous",
  PENDING: "pending",
  ERROR: "error",
});

// Name des DOM-Events, ueber das die Auth-Insel den ermittelten Zustand an die
// App-Shell meldet. Hier zentralisiert, damit Sender (AuthIsland) und Empfaenger
// (App-Shell) nicht auseinanderdriften.
export const AUTH_EVENT = "hermes:authstate";

// Fehler eines API-Aufrufs mit HTTP-Status. Der Aufrufer (loadAuthState)
// unterscheidet 401/403 darueber, ohne den rohen Response durchzureichen.
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Ein einzelner same-origin-Request. Wirft ApiError bei non-2xx (fail-closed:
// die UI behandelt jeden Nicht-Erfolg als "nicht eingeloggt"/Fehler, nie als
// Teil-Erfolg). parseJson:false fuer Endpunkte ohne Body (logout -> 204).
async function apiRequest(path, { method = "GET", parseJson = true } = {}) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new ApiError(res.status, `${method} ${path} -> ${res.status}`);
  return parseJson ? res.json() : null;
}

// Tenant-gefilterte Lese-Sicht (settings, calls, calendar, agent ...). Das
// Cookie autorisiert; KEIN Authorization-Header (Strategie 2.3).
export function fetchTenantState() {
  return apiRequest("/api/self-service/state");
}

// Session invalidieren. POST /auth/logout ist idempotent und liefert 204 ohne
// Body -- darum parseJson:false.
export function logout() {
  return apiRequest("/auth/logout", { method: "POST", parseJson: false });
}

// Startet die Stripe-Checkout-Session (setup-mode) zum Hinterlegen einer Karte.
// Der Gateway-Endpunkt antwortet mit JSON { url } (verifiziert in
// src/self-service-routes.js) -- der einzige existierende Billing-Schreibpfad.
// Der Aufrufer macht den Browser-Redirect auf diese url (zur Stripe-gehosteten
// Seite); das Frontend selbst kennt KEINE Stripe-Logik (duenner Client, 2.3).
// Bewusst NUR Karte hinterlegen: es gibt API-seitig kein Abo (subscribe/cancel/
// upgrade existieren nicht) -- ein solcher Aufruf liefe gegen 404 (CLAUDE.md
// Regel 6) und ist hier verboten.
export async function startBillingSetupCheckout() {
  const { url } = await apiRequest("/api/self-service/billing/setup-checkout", {
    method: "POST",
  });
  // Contract-Grenze (R5): das Backend garantiert { url } -- ein 200 ohne url
  // waere ein Drift. Fail-closed pruefen, statt window.location.assign(undefined)
  // an den Aufrufer durchzureichen (G26: null/undefined nie ungeprueft nutzen).
  if (typeof url !== "string" || url === "")
    throw new ApiError(0, "billing setup-checkout: Antwort ohne url");
  return url;
}

// Liest die Agent-Eckdaten (Nummer, Besitzer) aus der state-Antwort -- die EINE
// Stelle, an der das Frontend die Form `data.agent` annimmt (Contract-Grenze zur
// API, R5: Annahme nicht ueber mehrere Dateien streuen). Fehlende Felder -> leere
// Strings; ueber Platzhaltertexte entscheidet der Aufrufer.
export function agentInfo(data) {
  const agent = (data && data.agent) || {};
  return { number: agent.number || "", owner: agent.owner || "" };
}

// Liest den Karten-Status aus der state-Antwort -- die EINE Stelle, an der das
// Frontend die Form `data.hasCard` annimmt (Contract-Grenze zur API, R5).
// hasCard ist NUR ein Boolean, wenn PAYMENT_ENABLED am Gateway an ist; sonst
// fehlt das Feld komplett. Liefert daher { present, hasCard }: present=false
// (kein Boolean) -> die UI versteckt den Billing-Block byte-identisch zum
// Bestand; present=true -> hasCard sagt, ob bereits eine Karte hinterlegt ist.
export function cardStatus(data) {
  const present = typeof (data && data.hasCard) === "boolean";
  return { present, hasCard: present ? data.hasCard : false };
}

// Leitet den UI-Auth-Zustand aus genau EINEM state-Fetch ab -- die einzige
// Stelle, die HTTP-Status auf UI-Zustaende mappt (testbar ohne DOM). 200 ->
// eingeloggt (mit Daten); 401 -> anonym; 403 -> wartet auf Freigabe; alles
// andere (Netzfehler, 404, 5xx) -> Fehler. Fail-closed: nie als eingeloggt deuten.
export async function loadAuthState() {
  try {
    const data = await fetchTenantState();
    return { state: AUTH_STATE.AUTHENTICATED, data };
  } catch (err) {
    if (err instanceof ApiError && err.status === HTTP_UNAUTHORIZED) {
      return { state: AUTH_STATE.ANONYMOUS, data: null };
    }
    if (err instanceof ApiError && err.status === HTTP_FORBIDDEN) {
      return { state: AUTH_STATE.PENDING, data: null };
    }
    return { state: AUTH_STATE.ERROR, data: null };
  }
}
