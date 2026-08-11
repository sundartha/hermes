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
const HTTP_NO_CONTENT = 204;
// 409 = Vorbedingung verletzt beim Abo-Buchen (no_card / already_subscribed).
// Exportiert, damit die Subscribe-Verdrahtung (lib/subscribe.js) den gefuehrten
// Karten-Flow vom "bereits aboniert"-Hinweis trennt, ohne den Magic-Wert zu doppeln.
export const HTTP_CONFLICT = 409;

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
  // info = die maschinenlesbaren Felder des {error}-Body: code (z.B. "no_card",
  // "already_subscribed") + next (optionaler Funnel-Hinweis, z.B. "setup-checkout",
  // dem die UI deterministisch folgt). Beide undefined, wenn der Body sie nicht trug --
  // die Status-basierte Behandlung bleibt fail-closed (kein Verlass auf code/next).
  constructor(status, message, { code, next } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.next = next;
  }
}

// Best-effort: liest die maschinenlesbaren Felder eines non-2xx JSON-Body ({error, next}).
// Additiv und fail-closed: JEDER Fehler (kein JSON, kein Objekt) -> {} (kein code/next).
// Der Aufrufer behandelt non-2xx ohnehin als Misserfolg; code/next verfeinern nur die Folge
// (z.B. next:"setup-checkout" -> gefuehrter Checkout statt generischer Fehler).
async function readErrorInfo(res) {
  try {
    const body = await res.json();
    if (!body || typeof body !== "object") return {};
    return {
      code: typeof body.error === "string" ? body.error : undefined,
      next: typeof body.next === "string" ? body.next : undefined,
    };
  } catch {
    return {};
  }
}

// Ein einzelner same-origin-Request. Wirft ApiError bei non-2xx (fail-closed:
// die UI behandelt jeden Nicht-Erfolg als "nicht eingeloggt"/Fehler, nie als
// Teil-Erfolg). parseJson:false erzwingt null (fuer Endpunkte, die niemals
// einen Body senden). 204-Antworten liefern IMMER null, unabhaengig von
// parseJson -- res.json() wuerde auf leerem Body werfen (z.B. logout: 204 ODER
// 200+JSON, je nachdem ob eine WorkOS-Session-ID vorlag). body (Objekt) -> als
// JSON gesendet mit Content-Type:application/json (Schreibpfad settings/billing);
// fehlt body, geht kein Body und kein Content-Type raus.
async function apiRequest(path, { method = "GET", parseJson = true, body } = {}) {
  const headers = { Accept: "application/json" };
  const options = { method, credentials: "same-origin", headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const res = await fetch(path, options);
  if (!res.ok) {
    const info = await readErrorInfo(res);
    throw new ApiError(res.status, `${method} ${path} -> ${res.status}`, info);
  }
  if (!parseJson) return null;
  return res.status === HTTP_NO_CONTENT ? null : res.json();
}

// Tenant-gefilterte Lese-Sicht (settings, calls, calendar, agent ...). Das
// Cookie autorisiert; KEIN Authorization-Header (Strategie 2.3).
export function fetchTenantState() {
  return apiRequest("/api/self-service/state");
}

// Session invalidieren, same-origin. Antwort: 204 ohne Body (Alt-Session/Dev-Login ohne
// WorkOS-Session-ID -- rein lokal) ODER 200 JSON {logoutUrl} (WorkOS-Session-ID vorhanden).
// Gibt logoutUrl zurueck (oder null bei 204) -- der Aufrufer MUSS bei einer logoutUrl den
// Browser TOP-LEVEL dorthin navigieren, sonst bleibt WorkOS' eigene AuthKit-SSO-Session
// aktiv (siehe PLAN-WORKOS-LOGOUT.md).
export async function logout() {
  const result = await apiRequest("/auth/logout", { method: "POST" });
  return result && typeof result.logoutUrl === "string" ? result.logoutUrl : null;
}

// Startet die Stripe-Checkout-Session (setup-mode) zum Hinterlegen einer Karte.
// Der Gateway-Endpunkt antwortet mit JSON { url } (verifiziert in
// src/self-service-routes.js); der Aufrufer macht den Browser-Redirect auf diese
// url (zur Stripe-gehosteten Seite) -- das Frontend kennt KEINE Stripe-Logik (2.3).
// Optionaler plan (Kachel-Flow, BK2): wird als Body { plan } mitgesendet, damit die
// Rueckkehr (billing/return) den getragenen Plan direkt bucht (gefuehrter no_card-Pfad).
// OHNE plan geht KEIN Body raus -> byte-identisch zum reinen "Karte hinterlegen".
export async function startBillingSetupCheckout(plan) {
  const options = { method: "POST" };
  if (plan !== undefined) options.body = { plan };
  const { url } = await apiRequest("/api/self-service/billing/setup-checkout", options);
  // Contract-Grenze (R5): das Backend garantiert { url } -- ein 200 ohne url
  // waere ein Drift. Fail-closed pruefen, statt window.location.assign(undefined)
  // an den Aufrufer durchzureichen (G26: null/undefined nie ungeprueft nutzen).
  if (typeof url !== "string" || url === "")
    throw new ApiError(0, "billing setup-checkout: Antwort ohne url");
  return url;
}

// Bucht ein Abo (POST same-origin, JSON-Body { plan }). Loest beim Backend ECHTES
// wiederkehrendes Geld aus (Recurring) -> NUR vom expliziten Subscribe-Klick. Erfolg:
// { plan, currentPeriodEnd } + der Tenant wird aktiv. Wirft ApiError bei non-2xx; der
// .next ("setup-checkout") steuert die gefuehrte Folge (Funnel) in lib/subscribe.js.
export function startBillingSubscribe(plan) {
  return apiRequest("/api/self-service/billing/subscribe", { method: "POST", body: { plan } });
}

// Liest den schlanken Billing-Status (GET, webAuthPendingMw -> auch fuer suspendierte
// Tenants erreichbar). NUR Lifecycle-Flags { paymentEnabled, hasCard, planSlug, status }
// -- keine PII/Secrets, keine active-only /state-Felder. Der Aktivierungs-Pfad (suspended)
// rendert daraus dieselben Plan-Kacheln wie der aktive Pfad.
export function fetchBillingStatus() {
  return apiRequest("/api/self-service/billing/status");
}

// Liest die Agent-Eckdaten (Nummer, Besitzer, numberStatus) aus der state-Antwort --
// die EINE Stelle, an der das Frontend die Form `data.agent` annimmt (Contract-Grenze
// zur API, R5: Annahme nicht ueber mehrere Dateien streuen). Fehlende Felder -> leere
// Strings; ueber Platzhaltertexte entscheidet der Aufrufer.
export function agentInfo(data) {
  const agent = (data && data.agent) || {};
  return {
    number: agent.number || "",
    owner: agent.owner || "",
    numberStatus: agent.numberStatus || "",
  };
}

// Spiegel von NUMBER_DISPLAY_STATUS (src/store/views.js) -- Werte identisch (Drift-Test).
export const NUMBER_STATUS = Object.freeze({
  ACTIVE: "active",
  PROVISIONING: "provisioning",
  REQUESTED: "requested",
  FAILED: "failed",
  BLOCKED: "blocked",
  NONE: "none",
});

// "Wird die Nummer gerade eingerichtet?" -- true fuer requested/provisioning (noch keine
// aktive e164, aber unterwegs), sonst false. Steuert den Chip-Platzhalter "Setting up...".
export function isNumberProvisioning(data) {
  const { numberStatus } = agentInfo(data);
  return numberStatus === NUMBER_STATUS.PROVISIONING || numberStatus === NUMBER_STATUS.REQUESTED;
}

// Hintergrund-Poll waehrend "Setting up...": ohne das haengt der Chip auf dem
// Platzhalter fest, bis der Nutzer die Seite manuell neu laedt (Bug, Jul 2026).
// Intervall + Deckel hier benannt statt als Magic Number an der Aufrufstelle.
export const NUMBER_POLL_INTERVAL_MS = 4000;
export const NUMBER_POLL_MAX_ATTEMPTS = 90; // ~6 Minuten Deckel -> kein Endlos-Timer bei nie fertiger Nummer

// Ob die Auth-Insel nach diesem refresh() einen weiteren Poll ansetzen soll: nur
// waehrend eine Nummer eingerichtet wird (isNumberProvisioning) UND innerhalb des
// Attempt-Deckels. attemptCount ist die Anzahl bereits verstrichener Polls (0-basiert).
export function shouldPollNumberStatus(result, attemptCount) {
  if (!result || result.state !== AUTH_STATE.AUTHENTICATED) return false;
  if (!isNumberProvisioning(result.data)) return false;
  return attemptCount < NUMBER_POLL_MAX_ATTEMPTS;
}

// Chip-Platzhaltertexte (Fix C, PLAN-VOUCHER-SETUP-FEE-GAP.md) - EINE Quelle (G5) statt
// einer zweiten Kopie im Astro-Script. Wortlaut ist ein Vorschlag (siehe Plan §6).
const NUMBER_TEXT_NO_NUMBER = "No number assigned yet";
const NUMBER_TEXT_SETTING_UP = "Setting up your number…";
const NUMBER_TEXT_SETUP_FAILED = "Number setup failed";
const NUMBER_TEXT_SETUP_BLOCKED = "Number setup delayed — capacity limit reached";

// Platzhaltertext fuer eine NICHT-aktive Nummer: failed/blocked bekommen jetzt einen
// eigenen Hinweis statt im generischen "No number assigned yet" zu verschwinden (Bug B -
// der Tenant sah bisher keinen Unterschied zu "noch nicht bestellt"). Rein (kein DOM) ->
// mit node:test unit-testbar, anders als die DOM-Verdrahtung in AgentChip.astro. Aktive
// Nummer kommt hier nie an (der Aufrufer zeigt dann die echte e164 statt eines Platzhalters).
export function numberPlaceholderText(data) {
  if (isNumberProvisioning(data)) return NUMBER_TEXT_SETTING_UP;
  const { numberStatus } = agentInfo(data);
  if (numberStatus === NUMBER_STATUS.FAILED) return NUMBER_TEXT_SETUP_FAILED;
  if (numberStatus === NUMBER_STATUS.BLOCKED) return NUMBER_TEXT_SETUP_BLOCKED;
  return NUMBER_TEXT_NO_NUMBER;
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

// Liest die Abo-Sicht aus der state-Antwort -- die EINE Stelle, an der das Frontend
// die Form `data.subscription` annimmt (Contract-Grenze, R5). Fehlt das Feld
// (PAYMENT_ENABLED aus / kein Abo) -> { planSlug:"", currentPeriodEnd:0 } (neutral,
// nie undefined). currentPeriodEnd ist ein Unix-Sekunden-Epoch (Backend, store.tenantSubscription).
export function subscriptionFrom(data) {
  const sub = (data && data.subscription) || {};
  return { planSlug: sub.planSlug || "", currentPeriodEnd: sub.currentPeriodEnd || 0 };
}

// Liest das Minuten-Kontingent aus der state-Antwort (BK4). Nur ein Objekt mit den
// erwarteten Zahlen zaehlt; alles andere (fehlend / kein aktives Abo -> Backend liefert
// null) -> null (die UI versteckt die Kontingent-Zeile). Keys gespiegelt aus
// src/billing/meter.js quotaView (includedMinutes/remainingMinutes).
export function quotaFrom(data) {
  const quota = data && data.quota;
  if (
    !quota ||
    typeof quota.includedMinutes !== "number" ||
    typeof quota.remainingMinutes !== "number"
  ) {
    return null;
  }
  return { includedMinutes: quota.includedMinutes, remainingMinutes: quota.remainingMinutes };
}

// Liest die Einrichtungsgebuehr aus der state-/billing-status-Antwort (Phase A,
// PLAN-VOUCHER-SETUP-FEE-GAP.md) -- die EINE Stelle, an der das Frontend die Form
// `data.numberSetupFeeCents`/`data.currency` annimmt (Contract-Grenze, R5). Fehlendes/
// nicht-numerisches/<=0-Feld (PAYMENT_ENABLED aus, altes Backend, Fee=0 konfiguriert)
// -> null (die Kachel zeigt dann keine Gebuehren-Zeile, byte-identisch zum Bestand).
export function numberSetupFeeFrom(data) {
  const cents = data && data.numberSetupFeeCents;
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) return null;
  return { amountCents: cents, currency: (data && data.currency) || "eur" };
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
const CALL_SUBTITLE_INBOUND = "Inbound call";
const CALL_SUBTITLE_OUTBOUND = "Outbound call";
export function callSubtitle(call) {
  const c = call || {};
  if (c.goal) return c.goal;
  return c.direction === CALL_DIRECTION.INBOUND ? CALL_SUBTITLE_INBOUND : CALL_SUBTITLE_OUTBOUND;
}

// Status-Beschriftung eines Calls (Anzeige-Text). Unbekannter/fehlender Status
// faellt fail-closed auf "Failed" (wie der Bestand: jeder Nicht-
// active/completed/cancelled-Wert ist die Fehler-Beschriftung).
const CALL_STATUS_LABELS = Object.freeze({
  active: "Live",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
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
// aus dem ISO-start. Reine Formatierung (en-US), DOM-frei und damit testbar.
// Ungueltiges/fehlendes Datum -> leere Teile (kein "Invalid Date" in der UI).
const CAL_LOCALE = "en-US";
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

// ---- W3: Dashboard-Statistik (clientseitig aus calls[] abgeleitet) ------------
// Reine, DOM-freie Helfer. WICHTIG (Strategie R3): Roh-Nutzung (Minuten-
// Kontingent, Guthaben, Tarif) ist NICHT im /state. Wir leiten ausschliesslich
// aus den real vorhandenen Call-Feldern ab (direction, summary, startedAt,
// answeredAt, endedAt) — KEIN erfundenes Kontingent. Eine praezise
// "Rest-Minuten"-Anzeige braucht ein neues /state-Feld (Backend-Follow-up).

// Gespraechsdauer EINES Calls in Sekunden: answeredAt -> endedAt. Fehlt einer
// der Zeitstempel (nicht beantwortet / noch aktiv) oder ist er ungueltig/negativ
// -> 0 (fail-closed, kein NaN/keine Negativdauer in der Summe, G26).
const MS_PER_SECOND = 1000;
export function callDurationSec(call) {
  const c = call || {};
  if (!c.answeredAt || !c.endedAt) return 0;
  const answered = new Date(c.answeredAt).getTime();
  const ended = new Date(c.endedAt).getTime();
  if (Number.isNaN(answered) || Number.isNaN(ended) || ended <= answered) return 0;
  return Math.round((ended - answered) / MS_PER_SECOND);
}

// Liegt ein ISO-Zeitstempel im aktuellen Kalendermonat von `ref`? Fehlend/
// ungueltig -> false. Reine Zeit-Logik (ref injiziert -> testbar, P12-R).
function isSameMonth(iso, ref) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

// Liegt ein ISO-Zeitstempel innerhalb der letzten 7 Tage vor `ref` (nicht in der
// Zukunft)? Fehlend/ungueltig -> false.
const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 24 * 60 * 60 * MS_PER_SECOND;
function isWithinWeek(iso, refMs) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t <= refMs && refMs - t <= DAYS_PER_WEEK * MS_PER_DAY;
}

// Abgeleitete Anruf-Statistik aus dem state. `now` ist injiziert (Default: jetzt)
// -> die Zeit-abhaengigen Zahlen (Woche/Monat) sind deterministisch testbar.
// Liefert nur Zahlen, die aus echten Feldern stammen (kein erfundenes Kontingent).
export function callStats(data, now = new Date()) {
  const calls = callsFrom(data);
  const refMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const ref = new Date(refMs);
  const stats = {
    total: 0,
    thisWeek: 0,
    thisMonth: 0,
    inbound: 0,
    outbound: 0,
    withSummary: 0,
    durationSec: 0,
  };
  for (const call of calls) {
    stats.total += 1;
    if (call && call.direction === CALL_DIRECTION.OUTBOUND) stats.outbound += 1;
    else stats.inbound += 1;
    if (call && call.summary) stats.withSummary += 1;
    stats.durationSec += callDurationSec(call);
    const startedAt = call && call.startedAt;
    if (isWithinWeek(startedAt, refMs)) stats.thisWeek += 1;
    if (isSameMonth(startedAt, ref)) stats.thisMonth += 1;
  }
  return stats;
}

// Formatiert eine Dauer in Sekunden fuer die Anzeige (en): "0 min" / "< 1 min" /
// "N min" / "H h" / "H h M min". Reine Formatierung, DOM-frei.
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
export function formatCallDuration(totalSec) {
  const sec = Number.isFinite(totalSec) && totalSec > 0 ? Math.round(totalSec) : 0;
  if (sec < SECONDS_PER_MINUTE) return sec === 0 ? "0 min" : "< 1 min";
  const minutes = Math.floor(sec / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const remMinutes = minutes % MINUTES_PER_HOUR;
  return remMinutes ? `${hours} h ${remMinutes} min` : `${hours} h`;
}

// ---- W5: Settings-Editor (der EINZIGE existierende Schreibpfad) ---------------
// Reine, DOM-freie Helfer fuer den Settings-Editor: die Contract-Grenze zur
// Backend-Whitelist (welche Felder POST /api/self-service/settings ueberhaupt
// annimmt, R5) UND das Ableiten von changed/rejected aus der Antwort. Testbar
// ohne DOM (P1/T1). Die Insel verdrahtet nur den DOM-Form + AUTH_EVENT.
//
// SPIEGELT die Backend-Whitelist (src/self-service.js, NUR-Lese-Vertrag) -- die
// UI bietet AUSSCHLIESSLICH an, was der Server akzeptiert (Server filtert via
// selfServicePatch ohnehin; die UI ist NICHT die Verteidigung, darf aber nichts
// anbieten, was es nicht gibt). Freitext-greeting ist gar nicht erst baubar:
// greeting ist KEIN Free-Field, sondern nur eine Template-Auswahl.

// Frei setzbare Felder, 1:1 zu SELF_SERVICE_FREE_FIELDS in src/self-service.js
// (Typ-/Enum-Check macht updateSettings serverseitig). Das ist DIE EINE Feldliste
// dieses Clients: buildSettingsPatch laeuft ueber genau sie, die Insel haelt kein
// zweites Set (G5/S2). Gesichert wird der Spiegel von zwei Tests, die BEIDE Listen
// importieren und vergleichen (apps/web/test/settings.test.js und
// test/dashboard-i18n-surface.test.js) - dasselbe Muster wie beim Plan-Katalog-
// Spiegel apps/web/src/lib/plans.js <-> src/plans.js. Server-Code wandert bewusst
// NICHT ins Browser-Bundle (duenner Client, Strategie 2.3).
// allowCalendar/allowBooking sind seit P1b KEINE Self-Service-Felder mehr (der
// Telefon-Agent hat weder Kalender- noch Buchungs-Tool). Sie standen hier zuletzt
// als Angebot ohne Wirkung: der Server meldete sie bei JEDEM Speichern als rejected.
export const SETTINGS_FREE_FIELDS = Object.freeze(["agentName", "language", "agentStyle"]);

// Permission-Flags, die ein Tenant NUR restriktiver setzen darf (true->false ja,
// false->true NEIN -- Aktivieren bleibt Plattform-Admin). 1:1 zu
// SELF_SERVICE_RESTRICT_ONLY_FIELDS in src/self-service.js.
export const SETTINGS_RESTRICT_ONLY_FIELDS = Object.freeze(["allowPersonalData", "allowBankData"]);

// Sprach-Optionen des language-Dropdowns. "" = "Automatic (by number)" (das
// Override leeren); die uebrigen Codes spiegeln SUPPORTED_LANGUAGES
// (src/i18n/locales.js = Object.keys(LOCALES)). Hier zentralisiert + drift-
// getestet, damit eine 4. Backend-Sprache nicht still im Dropdown fehlt (G22).
// Der Server validiert language ohnehin fail-closed gegen SUPPORTED_LANGUAGES.
export const SETTINGS_LANGUAGES = Object.freeze([
  { value: "", label: "Automatic (by number)" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "en", label: "English" },
]);

// Die Permission-Toggles der UI (Reihenfolge + Beschriftung). Es sind GENAU die
// restrict-only-Flags: ein Tenant darf sie nur restriktiver setzen (true->false ja,
// false->true NEIN - Aktivieren bleibt Plattform-Admin). Ein eigenes restrictOnly-
// Feld traegt die Liste deshalb nicht mehr: es waere ueberall true und wurde von
// keinem Steuerelement gelesen (toter Datensatz, G9). agentName/greeting/language/
// agentStyle sind eigene Controls (Text/Dropdowns), kein Toggle.
export const SETTINGS_PERMISSION_TOGGLES = Object.freeze([
  { key: "allowPersonalData", label: "Personal data", hint: "Share address, email, etc." },
  { key: "allowBankData", label: "Bank details", hint: "Share payment data (not recommended)" },
]);

// Englische Beschriftungen der kuratierten Stil-IDs (PERSONA_STYLE_IDS,
// src/i18n/locales.js). Die IDs sind historisch deutschsprachig, /app ist englisch
// (Produktentscheidung 7.15) - eine aus der ID abgeleitete Beschriftung truege den
// deutschen Wortstamm. Die GUELTIGEN IDs kommen weiterhin AUSSCHLIESSLICH vom Server
// (state.personaStyleIds); dieser Katalog liefert nur den Anzeigetext, kein zweites
// ID-Set (G5/S2). Drift gegen PERSONA_STYLE_IDS faengt apps/web/test/settings.test.js.
export const PERSONA_STYLE_LABELS = Object.freeze({
  "warm-persoenlich": "Warm and personal",
  "formell-professionell": "Formal and professional",
});

// "" = kein Override -> neutraler Bestandsstil (updateSettings speichert "" als null).
const PERSONA_STYLE_DEFAULT_OPTION = Object.freeze({ value: "", label: "Default (neutral)" });

// Beschriftung einer Stil-ID; eine dem Client unbekannte Server-ID faellt fail-soft auf
// die rohe ID zurueck (das Dropdown verschluckt keine Server-Option). hasOwnProperty
// statt [] - eine Server-ID darf nie ein Prototyp-Feld treffen (wie callStatusKind).
function personaStyleLabel(id) {
  return Object.prototype.hasOwnProperty.call(PERSONA_STYLE_LABELS, id)
    ? PERSONA_STYLE_LABELS[id]
    : id;
}

// Optionen des Stil-Dropdowns aus der state-Antwort -- die EINE Stelle, an der das
// Frontend die Form `data.personaStyleIds` annimmt (Contract-Grenze, R5). Fehlt das
// Feld (alter Server) -> null = "Steuerelement verstecken" (I9-Muster wie hasCard);
// dann reist agentStyle auch NICHT im Patch mit (s. buildSettingsPatch).
export function personaStyleOptions(data) {
  const ids = data && data.personaStyleIds;
  if (!Array.isArray(ids)) return null;
  return [
    PERSONA_STYLE_DEFAULT_OPTION,
    ...ids.map((id) => ({ value: id, label: personaStyleLabel(id) })),
  ];
}

// Settings + greeting-Vorlagen aus der state-Antwort -- die EINE Stelle, an der
// das Frontend die Form `data.settings`/`data.greetingTemplates` annimmt
// (Contract-Grenze, R5). Fehlende Felder -> leeres Objekt / leere Liste, damit
// die Insel nie auf undefined zugreift (G26).
export function settingsFrom(data) {
  const settings = (data && data.settings) || {};
  const templates = data && data.greetingTemplates;
  return { settings, greetingTemplates: Array.isArray(templates) ? templates : [] };
}

// Baut den Schreib-Patch aus dem rohen Formular-Snapshot: NUR Whitelist-Felder.
// `form` = { agentName, language, agentStyle?, greeting, allowPersonalData,
// allowBankData }. greeting ist ein gewaehlter Template-String (kein Freitext-
// Eingabefeld existiert). Unbekannte Schluessel werden NICHT uebernommen -- die
// UI sendet erst gar nichts ausserhalb der Whitelist.
export function buildSettingsPatch(form) {
  const src = form || {};
  // greeting steht bewusst NICHT in SETTINGS_FREE_FIELDS: der Server prueft es gegen
  // den Vorlagenkatalog (selfServicePatch), nicht ueber die Free-Field-Liste.
  const patch = { greeting: String(src.greeting ?? "") };
  for (const key of SETTINGS_FREE_FIELDS) {
    // Ein Feld, dessen Steuerelement die Insel gar nicht gerendert hat (undefined),
    // reist NICHT mit: "" ist fuer die optionalen Enum-Overrides (language,
    // agentStyle) ein RESET - ein nie sichtbares Dropdown wuerde sonst einen
    // gespeicherten Wert still loeschen.
    if (src[key] === undefined) continue;
    patch[key] = String(src[key] ?? "");
  }
  for (const { key } of SETTINGS_PERMISSION_TOGGLES) patch[key] = Boolean(src[key]);
  return patch;
}

// Leitet changed/rejected aus dem gesendeten Patch + den GESPEICHERTEN Settings
// ab. POST /api/self-service/settings antwortet mit dem vollen settings-Objekt
// (verifiziert in src/self-service-routes.js: res.json(settings)) -- NICHT mit
// {changed, rejected}. Darum diffen wir hier: ein angefragtes Feld gilt als
// uebernommen (changed), wenn der gespeicherte Wert dem angefragten entspricht,
// sonst als abgelehnt (rejected) -- exakt der serverseitige selfServicePatch-
// Effekt (z.B. ein false->true-Versuch auf ein restrict-only-Flag erscheint hier
// als rejected, weil der gespeicherte Wert beim alten Wert bleibt). Reine Logik.
// Gilt der gespeicherte Wert als "so uebernommen wie angefragt"? Ein zurueckgesetztes
// optionales Override (language/agentStyle) reist als "" im Patch und liegt danach als
// null im Store (updateSettings: "" -> null). Ohne diese eine Glaettung meldete die UI
// ein erfolgreiches Zuruecksetzen als "rejected". Ein gar nicht vorhandenes Feld
// (undefined) bleibt eine echte Ablehnung.
function isSavedAsRequested(savedValue, requestedValue) {
  return savedValue === requestedValue || (savedValue === null && requestedValue === "");
}

export function settingsOutcome(patch, savedSettings) {
  const saved = savedSettings || {};
  const changed = [];
  const rejected = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (isSavedAsRequested(saved[key], value)) changed.push(key);
    else rejected.push(key);
  }
  return { changed, rejected };
}

// Schreibt den Settings-Patch (POST same-origin, JSON-Body). Antwort = das volle,
// serverseitig gefilterte settings-Objekt (selfServicePatch + updateSettings).
// Wie der ganze Client: KEIN Authorization-Header, das Session-Cookie autorisiert
// (Strategie 2.3). Wirft ApiError bei non-2xx (z.B. 401 abgelaufene Session).
export function saveSettings(patch) {
  return apiRequest("/api/self-service/settings", { method: "POST", body: patch });
}

// ---- P13: private Rufnummer (eigene Naht, NICHT der settings-Patch) -----------
// Kontakt-PII am Tenant-Record, nicht in settings (settings leakt komplett ueber
// /api/state + MCP, H4). Der Server liefert das Feld AUSSCHLIESSLICH maskiert
// (maskPrivateNumber) und nimmt es ueber eine eigene Route entgegen.

// Die maskierte eigene Rufnummer aus der state-Antwort -- die EINE Stelle, an der das
// Frontend die Form `data.privateNumber` annimmt (Contract-Grenze, R5). Kein
// String/kein Wert -> "" (die UI zeigt den Leerzustand).
function maskedPrivateNumberFrom(data) {
  const value = data && data.privateNumber;
  return typeof value === "string" ? value : "";
}

// Statuszeile der Nummern-Karte. Die Maske ist der EINZIGE Wert, den die UI je
// anzeigt; der volle Wert verlaesst den Server nicht und wird nirgends gehalten.
const PRIVATE_NUMBER_TEXT_NONE = "No number saved yet.";
const PRIVATE_NUMBER_TEXT_PREFIX = "Currently saved: ";
export function privateNumberStatusText(data) {
  const masked = maskedPrivateNumberFrom(data);
  return masked ? `${PRIVATE_NUMBER_TEXT_PREFIX}${masked}` : PRIVATE_NUMBER_TEXT_NONE;
}

// Stabiler Fehlercode der Schreib-Route bei ungueltiger/gesperrter Nummer
// (src/self-service-routes.js). Hier benannt, damit die Insel keinen Magic-String haelt.
export const ERROR_INVALID_PRIVATE_NUMBER = "invalid_private_number";

// Schreibt die private Rufnummer (POST same-origin, EIGENER Endpunkt - nicht der
// settings-Patch). "" loescht den Eintrag (dokumentierter Opt-Out des Servers).
// Antwort: { ok, hasPrivateNumber } - NIE die Nummer. Wirft ApiError bei non-2xx
// (400 = ERROR_INVALID_PRIVATE_NUMBER, 401 = abgelaufene Session). Wie der ganze
// Client: KEIN Authorization-Header, das Session-Cookie autorisiert (Strategie 2.3).
export function savePrivateNumber(privateNumber) {
  return apiRequest("/api/self-service/private-number", {
    method: "POST",
    body: { privateNumber: String(privateNumber ?? "") },
  });
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
