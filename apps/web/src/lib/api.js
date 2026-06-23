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

// ---- W4: read-only Datensicht (Calls / ActionItems / Kalender) ----------------
// Reine, DOM-freie Helfer fuer die Render-Logik. Sie tragen die Contract-Grenze
// zur API (welche Felder die state-Antwort hat, R5) UND die Beschriftungs-/
// Status-Logik -- testbar ohne DOM (P1/T1). Die Inseln bauen daraus den DOM
// ausschliesslich mit textContent/createElement (kein innerHTML mit Tenant-
// Strings -> kein XSS-Pfad, Leitplanke). Tenant-Werte werden NIE als HTML
// interpretiert; diese Helfer geben nur rohe Strings/Strukturen zurueck.

// Richtungen eines Calls (kein Magic-String an den Vergleichsstellen, G25).
export const CALL_DIRECTION = Object.freeze({ INBOUND: "inbound", OUTBOUND: "outbound" });

// Listen aus der state-Antwort -- jeweils nur, wenn es wirklich ein Array ist
// (fail-closed gegen fehlende/null-Felder: leere Liste statt Absturz, G26).
// EINE Stelle, an der das Frontend die Form `data.calls/actionItems/calendar`
// annimmt (Contract-Grenze, R5). data==null/undefined -> ueberall leere Listen.
function listFrom(data, key) {
  const value = data && data[key];
  return Array.isArray(value) ? value : [];
}
export const callsFrom = (data) => listFrom(data, "calls");
export const actionItemsFrom = (data) => listFrom(data, "actionItems");
export const calendarFrom = (data) => listFrom(data, "calendar");

// Live-Dot: der Agent gilt als "live", sobald MINDESTENS ein Call aktiv ist.
// Gleiche Bedingung wie im Bestand (tenant.html: calls.some status==="active").
export function isAgentLive(data) {
  return callsFrom(data).some((c) => c && c.status === "active");
}

// Gegenstelle eines Calls: bei outbound die angerufene Nummer (to), sonst der
// Anrufer (from). Liefert immer einen String (fehlend -> ""), nie undefined.
export function callCounterparty(call) {
  const c = call || {};
  const value = c.direction === CALL_DIRECTION.OUTBOUND ? c.to : c.from;
  return value || "";
}

// Untertitel eines Calls: das Anrufziel (goal), sonst eine richtungsabhaengige
// Standardbeschreibung -- 1:1 wie der Bestand (tenant.html renderCalls).
const CALL_SUBTITLE_INBOUND = "Eingehender Anruf";
const CALL_SUBTITLE_OUTBOUND = "Ausgehender Anruf";
export function callSubtitle(call) {
  const c = call || {};
  if (c.goal) return c.goal;
  return c.direction === CALL_DIRECTION.INBOUND ? CALL_SUBTITLE_INBOUND : CALL_SUBTITLE_OUTBOUND;
}

// Status-Beschriftung eines Calls (Anzeige-Text). Unbekannter/fehlender Status
// faellt fail-closed auf "Fehlgeschlagen" (wie der Bestand: jeder Nicht-
// active/completed/cancelled-Wert ist die Fehler-Beschriftung).
const CALL_STATUS_LABELS = Object.freeze({
  active: "Live",
  completed: "Beendet",
  cancelled: "Abgebrochen",
  failed: "Fehlgeschlagen",
});
export function callStatusLabel(call) {
  const status = (call && call.status) || "";
  return CALL_STATUS_LABELS[status] || CALL_STATUS_LABELS.failed;
}

// Status-Klassen-Suffix fuer das Badge (active/completed -> eigene Farbe, alles
// andere -> neutral/failed). Begrenzt auf bekannte Werte, damit kein roher
// Tenant-/Status-String in einen CSS-Klassennamen wandert (defensiv).
export function callStatusKind(call) {
  const status = (call && call.status) || "";
  return Object.prototype.hasOwnProperty.call(CALL_STATUS_LABELS, status) ? status : "failed";
}

// Ist ein Action Item ein Termin (Tag "Termin")? Gleiche Bedingung wie der
// Bestand (tenant.html: a.type==="appointment").
export function isAppointment(item) {
  return Boolean(item) && item.type === "appointment";
}

// Kalender-Datumsteile fuer die Anzeige (Tag / Monat-Kurz / Wochentag+Uhrzeit),
// aus dem ISO-start. Reine Formatierung (de-DE), DOM-frei und damit testbar.
// Ungueltiges/fehlendes Datum -> leere Teile (kein "Invalid Date" in der UI).
const CAL_LOCALE = "de-DE";
export function calendarDateParts(event) {
  const start = event && event.start;
  const d = start ? new Date(start) : null;
  if (!d || Number.isNaN(d.getTime())) return { day: "", month: "", when: "" };
  return {
    day: String(d.getDate()),
    month: d.toLocaleString(CAL_LOCALE, { month: "short" }),
    when: d.toLocaleString(CAL_LOCALE, { weekday: "short", hour: "2-digit", minute: "2-digit" }),
  };
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
