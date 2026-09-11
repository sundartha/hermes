// Duenner fetch-Wrapper gegen die Hermes-Gateway-API. Das Frontend ist ein
// DUENNER CLIENT (Strategie 2.3): KEINE Auth-/Session-Logik hier, KEIN Token,
// KEIN PKCE, KEIN localStorage. Das session-Cookie ist HttpOnly und faehrt im
// same-origin-Modell bei jedem Aufruf automatisch mit -- JS kommt nie an das
// Cookie und braucht es auch nicht. credentials:"same-origin" ist der einzige
// defensive Zusatz; ein Authorization-Header wird NIE gesetzt.
//
// i18n (Etappe 2): die dynamischen Anzeige-Strings dieses Moduls (Call-
// Untertitel, Status-/Rollen-Beschriftungen, Sprach-/Berechtigungs-Kacheln,
// Nummern-Platzhalter) bleiben mit ihrem EN-Wert test-gepinnt; je eine kleine
// "_DE"-Entsprechung daneben + tPair/tDyn (lib/i18n.js) machen sie sprach-
// bewusst. Das i18n.js-"localStorage" oben ist NICHT dasselbe wie dieser
// Kommentar -- getLang() liest NUR den UI-Sprachschalter, kein Session-/Auth-
// Zustand dieses Clients.

import { tPair, tDyn } from "./i18n.js";

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
// GP-P3: die EINE Adresse der Karten-Erfassung (G5/G25) - startBillingSetupCheckout ruft
// sie, numberPlaceholderAction zeigt auf sie. Zwei getippte Literale wuerden driften.
export const BILLING_SETUP_CHECKOUT_PATH = "/api/self-service/billing/setup-checkout";

export async function startBillingSetupCheckout(plan) {
  const options = { method: "POST" };
  if (plan !== undefined) options.body = { plan };
  const { url } = await apiRequest(BILLING_SETUP_CHECKOUT_PATH, options);
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

// 312k-P3: Vormerkung/Ruecknahme der Kuendigung zum Periodenende (§ 312k BGB). Beide
// POST same-origin, KEIN Body (die Identitaet kommt aus der Session, nie aus dem Client -
// Muster startBillingSubscribe ohne Body-Identitaet). Erfolg (auch beim idempotenten
// Doppelklick, s. Gateway self-service-routes.js): { cancelAtPeriodEnd, currentPeriodEnd }.
// Wirft ApiError bei non-2xx (409 no_subscription, 401 abgelaufene Session).
export function startBillingCancel() {
  return apiRequest("/api/self-service/billing/cancel", { method: "POST" });
}
export function startBillingResume() {
  return apiRequest("/api/self-service/billing/resume", { method: "POST" });
}

// Liest den schlanken Billing-Status (GET, webAuthPendingMw -> auch fuer suspendierte
// Tenants erreichbar). NUR Lifecycle-Flags { paymentEnabled, hasCard, planSlug, status }
// -- keine PII/Secrets, keine active-only /state-Felder. Der Aktivierungs-Pfad (suspended)
// rendert daraus dieselben Plan-Kacheln wie der aktive Pfad.
export function fetchBillingStatus() {
  return apiRequest("/api/self-service/billing/status");
}

// ---- F2-Newsletter-Recipients: Zusatzempfaenger (Double-Opt-in) ---------------
// POST/DELETE {email} same-origin -- kleine, reine Wrapper (Muster startBillingCancel:
// KEINE eigene Fehlerbehandlung hier, die liegt bei lib/subscribe.js). Wirft ApiError
// bei non-2xx; err.code traegt den stabilen Server-Grund (400 invalid_format/duplicate/
// cap_reached/daily_limit, 401 abgelaufene Session -- s. self-service-routes.js).
export function addNewsletterRecipient(email) {
  return apiRequest("/api/self-service/newsletter-recipients", { method: "POST", body: { email } });
}
export function removeNewsletterRecipient(email) {
  return apiRequest("/api/self-service/newsletter-recipients", { method: "DELETE", body: { email } });
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
const NUMBER_TEXT_NO_NUMBER_DE = "Noch keine Nummer zugewiesen";
const NUMBER_TEXT_SETTING_UP = "Setting up your number…";
const NUMBER_TEXT_SETTING_UP_DE = "Deine Nummer wird eingerichtet…";
const NUMBER_TEXT_SETUP_FAILED = "Number setup failed";
const NUMBER_TEXT_SETUP_FAILED_DE = "Einrichtung der Nummer fehlgeschlagen";
const NUMBER_TEXT_SETUP_BLOCKED = "Number setup delayed — capacity limit reached";
const NUMBER_TEXT_SETUP_BLOCKED_DE = "Einrichtung verzögert — Kapazitätsgrenze erreicht";

// Platzhaltertext fuer eine NICHT-aktive Nummer: failed/blocked bekommen jetzt einen
// eigenen Hinweis statt im generischen "No number assigned yet" zu verschwinden (Bug B -
// der Tenant sah bisher keinen Unterschied zu "noch nicht bestellt"). Rein (kein DOM) ->
// mit node:test unit-testbar, anders als die DOM-Verdrahtung in AgentChip.astro. Aktive
// Nummer kommt hier nie an (der Aufrufer zeigt dann die echte e164 statt eines Platzhalters).
export function numberPlaceholderText(data) {
  if (isNumberProvisioning(data)) return tPair(NUMBER_TEXT_SETTING_UP, NUMBER_TEXT_SETTING_UP_DE);
  const { numberStatus } = agentInfo(data);
  if (numberStatus === NUMBER_STATUS.FAILED) return tPair(NUMBER_TEXT_SETUP_FAILED, NUMBER_TEXT_SETUP_FAILED_DE);
  if (numberStatus === NUMBER_STATUS.BLOCKED) return tPair(NUMBER_TEXT_SETUP_BLOCKED, NUMBER_TEXT_SETUP_BLOCKED_DE);
  return tPair(NUMBER_TEXT_NO_NUMBER, NUMBER_TEXT_NO_NUMBER_DE);
}

const NUMBER_ACTION_FIX_PAYMENT = "Update payment method";
const NUMBER_ACTION_FIX_PAYMENT_DE = "Zahlungsmittel aktualisieren";

// GP-P3: der failed-Platzhalter bekommt eine ECHTE Aktion statt eines passiven Satzes -
// die haeufigste Ursache eines gescheiterten Nummern-Setups ist eine Zahlungsmethode,
// die keinen Hold traegt (Vorfall 11.09.2026), und dagegen hilft genau ein Kartenwechsel.
// Nach dem erfolgreichen Wechsel stoesst der Server das Provisioning selbst wieder an
// (self-service-routes.js, billing/return) - dieser Knopf braucht KEINEN neuen Endpunkt.
// Rein (kein DOM, kein fetch) -> mit node:test unit-testbar. Alle uebrigen Status tragen
// KEINE Aktion (null): dort hilft ein Kartenwechsel nicht.
export function numberPlaceholderAction(data) {
  const { numberStatus } = agentInfo(data);
  if (numberStatus !== NUMBER_STATUS.FAILED) return null;
  return {
    label: tPair(NUMBER_ACTION_FIX_PAYMENT, NUMBER_ACTION_FIX_PAYMENT_DE),
    href: BILLING_SETUP_CHECKOUT_PATH,
  };
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
// 312k-P1/P3: cancelAtPeriodEnd zusaetzlich zu planSlug/currentPeriodEnd -- fehlt das
// Feld (aelterer Server) -> false (fail-closed neutral: "nicht gekuendigt" ist der
// unauffaellige Default, nie true ohne Beleg vom Server, Muster der uebrigen booleschen
// Server-Flags in dieser Datei, z.B. hasCard/isNumberProvisioning).
export function subscriptionFrom(data) {
  const sub = (data && data.subscription) || {};
  return {
    planSlug: sub.planSlug || "",
    currentPeriodEnd: sub.currentPeriodEnd || 0,
    cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
  };
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

// ---- W4: read-only Anrufliste (inkl. Gespraechsverlauf) -----------------------
// Reine, DOM-freie Helfer fuer die Render-Logik. Sie tragen die Contract-Grenze
// zur API (welche Felder die state-Antwort hat, R5) UND die Beschriftungs-/
// Status-Logik -- testbar ohne DOM (P1/T1). Die Insel baut daraus den DOM
// ausschliesslich mit textContent/createElement (kein innerHTML mit Tenant-
// Strings -> kein XSS-Pfad, Leitplanke). Tenant-Werte werden NIE als HTML
// interpretiert; diese Helfer geben nur rohe Strings/Strukturen zurueck.

// Richtungen eines Calls (kein Magic-String an den Vergleichsstellen, G25).
export const CALL_DIRECTION = Object.freeze({ INBOUND: "inbound", OUTBOUND: "outbound" });

// Liste aus der state-Antwort -- nur, wenn es wirklich ein Array ist (fail-
// closed gegen fehlende/null-Felder: leere Liste statt Absturz, G26). EINE
// Stelle, an der das Frontend die Form `data.calls` annimmt (Contract-Grenze,
// R5). data==null/undefined -> leere Liste.
function listFrom(data, key) {
  const value = data && data[key];
  return Array.isArray(value) ? value : [];
}
export const callsFrom = (data) => listFrom(data, "calls");
// Der Benachrichtigungs-Feed (data.notifications) steht weiterhin in beiden
// state-Antworten, wird aber seit 2026-09-10 (Owner-Wunsch) von KEINER Zeile
// im Frontend gelesen -- kein Leser, also auch kein Selektor hier.

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
const CALL_SUBTITLE_INBOUND_DE = "Eingehender Anruf";
const CALL_SUBTITLE_OUTBOUND = "Outbound call";
const CALL_SUBTITLE_OUTBOUND_DE = "Ausgehender Anruf";
export function callSubtitle(call) {
  const c = call || {};
  if (c.goal) return c.goal;
  return c.direction === CALL_DIRECTION.INBOUND
    ? tPair(CALL_SUBTITLE_INBOUND, CALL_SUBTITLE_INBOUND_DE)
    : tPair(CALL_SUBTITLE_OUTBOUND, CALL_SUBTITLE_OUTBOUND_DE);
}

// Status-Beschriftung eines Calls (Anzeige-Text). Unbekannter/fehlender Status
// faellt fail-closed auf "Failed" (wie der Bestand: jeder Nicht-
// active/completed/cancelled-Wert ist die Fehler-Beschriftung).
// Exportiert NUR fuer den Woerterbuch-Paritaets-Waechter (test/dashboard-i18n-
// surface.test.js) -- der einzige Verbraucher innerhalb dieses Moduls bleibt
// callStatusLabel().
export const CALL_STATUS_LABELS = Object.freeze({
  active: "Live",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
});
export const CALL_STATUS_LABELS_DE = Object.freeze({
  active: "Live",
  completed: "Abgeschlossen",
  cancelled: "Abgebrochen",
  failed: "Fehlgeschlagen",
});
export function callStatusLabel(call) {
  return tDyn({ en: CALL_STATUS_LABELS, de: CALL_STATUS_LABELS_DE }, callStatusKind(call));
}

// Status-Klassen-Suffix fuer das Badge (active/completed -> eigene Farbe, alles
// andere -> neutral/failed). Begrenzt auf bekannte Werte, damit kein roher
// Tenant-/Status-String in einen CSS-Klassennamen wandert (defensiv).
export function callStatusKind(call) {
  const status = (call && call.status) || "";
  return Object.prototype.hasOwnProperty.call(CALL_STATUS_LABELS, status) ? status : "failed";
}

// ---- W4b: Gespraechsverlauf (Transkript) eines Calls --------------------------
// Die Daten sind schon im state (views.js publicCall strippt transcript/summary
// NICHT) -- kein neuer Endpunkt. Turns kommen 1:1 aus dem Store (state-ops.js
// addTranscript/pg.js): {role, text, at}. role ist "agent" oder "caller" (kein
// drittes Enum bisher, siehe src/claude.js); unbekannte/fehlende Rollen fallen
// fail-closed auf die Gegenstelle-Beschriftung zurueck (gleiche Handschrift wie
// callStatusLabel/callStatusKind oben).
export const TRANSCRIPT_ROLE_AGENT = "agent";

// Turn-Liste eines Calls -- nur, wenn wirklich ein Array (fail-closed, G26).
export function transcriptFrom(call) {
  const t = call && call.transcript;
  return Array.isArray(t) ? t : [];
}

export function isAgentTurn(turn) {
  return Boolean(turn) && turn.role === TRANSCRIPT_ROLE_AGENT;
}

// "Counterparty" statt "Caller": bei outbound-Calls ruft der Agent an, die
// Gegenstelle nimmt ab -- dasselbe Vokabular wie callCounterparty() oben, kein
// zweiter Begriff fuer dieselbe Sache.
// Exportiert NUR fuer den Woerterbuch-Paritaets-Waechter (s.o. CALL_STATUS_LABELS).
export const TURN_ROLE_LABELS = Object.freeze({ agent: "Agent", caller: "Counterparty" });
// "Gegenstelle" -- dasselbe deutsche Wort, das die Kommentare dieses Moduls
// bereits durchgaengig fuer "Counterparty" verwenden (kein zweiter Begriff).
export const TURN_ROLE_LABELS_DE = Object.freeze({ agent: "Agent", caller: "Gegenstelle" });
export function turnRoleLabel(turn) {
  const role = (turn && turn.role) || "";
  const key = Object.prototype.hasOwnProperty.call(TURN_ROLE_LABELS, role) ? role : "caller";
  return tDyn({ en: TURN_ROLE_LABELS, de: TURN_ROLE_LABELS_DE }, key);
}

// Uhrzeit eines Turns (HH:MM, 24h) aus dem ISO-Zeitstempel `at`. BEWUSST ohne
// toLocaleString/Intl -- der WEB-18-Drift-Test (test/dashboard-i18n-surface.
// test.js) zaehlt jede Locale-Aufrufstelle in apps/web/src durch; ein simples
// Zeit-Padding braucht keine Locale und haelt die Zaehlung unangetastet.
// Fehlend/ungueltig -> "" (der Aufrufer zeigt dann einfach keine Uhrzeit).
export function turnTimeLabel(turn) {
  const at = turn && turn.at;
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Zusammenfassung eines Calls (summarizeCall setzt sie nachtraeglich; initial
// null). Nur ein echter String zaehlt -- sonst "" (die UI zeigt dann keinen
// Summary-Block, kein "null" im DOM).
export function callSummary(call) {
  const summary = call && call.summary;
  return typeof summary === "string" ? summary : "";
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
// Settings-Redesign (Aug 2026): SettingsIsland.astro bietet fuer agentName/
// agentStyle KEIN Steuerelement mehr (Fokus auf Sprachwahl) -- die Liste bleibt
// TROTZDEM 1:1 zum Server-Vertrag (s.o., Drift-Tests vergleichen exakt gegen
// SELF_SERVICE_FREE_FIELDS). Ein Feld ohne Steuerelement reist einfach nie im
// Formular-Snapshot mit (readForm liefert nur, was es rendert) -- buildSettingsPatch
// unten ueberspringt es dann per "src[key] === undefined", kein Sonderfall noetig.
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

// DE-Entsprechung der Kachel-Beschriftungen oben (Schluessel = value). EN bleibt
// unveraendert die Quelle der Wahrheit (SETTINGS_LANGUAGES.label, test-gepinnt) --
// SettingsIsland.astro rendert die Kacheln serverseitig/englisch aus diesem Array
// und ruft settingsLanguageLabel() zusaetzlich beim Formular-Fuellen (fillForm,
// auf jedem AUTH_EVENT inkl. des vom Sprachumschalter re-dispatchten), um die
// sichtbare Beschriftung auf die aktuelle Sprache zu bringen.
export const SETTINGS_LANGUAGE_LABELS_DE = Object.freeze({
  "": "Automatisch (nach Nummer)",
  de: "Deutsch",
  fr: "Französisch",
  en: "Englisch",
});
// Aus SETTINGS_LANGUAGES abgeleitet statt dupliziert (G5: eine EN-Quelle) --
// exportiert NUR fuer den Woerterbuch-Paritaets-Waechter (test/dashboard-i18n-
// surface.test.js).
export const SETTINGS_LANGUAGE_LABELS_EN = Object.freeze(
  Object.fromEntries(SETTINGS_LANGUAGES.map((l) => [l.value, l.label])),
);

// Sprachbewusste Kachel-Beschriftung. Unbekannter Wert -> der rohe Wert (nie leer).
export function settingsLanguageLabel(value) {
  return tDyn({ en: SETTINGS_LANGUAGE_LABELS_EN, de: SETTINGS_LANGUAGE_LABELS_DE }, value) || value;
}

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

// DE-Entsprechung von label/hint oben (Schluessel = key). Gleiches Muster wie
// SETTINGS_LANGUAGE_LABELS_*: EN bleibt in SETTINGS_PERMISSION_TOGGLES die
// Quelle der Wahrheit, SettingsIsland.astro ruft settingsPermissionLabel/-Hint
// beim Formular-Fuellen (fillForm, jedes AUTH_EVENT).
export const SETTINGS_PERMISSION_LABELS_EN = Object.freeze(
  Object.fromEntries(SETTINGS_PERMISSION_TOGGLES.map((t) => [t.key, t.label])),
);
export const SETTINGS_PERMISSION_LABELS_DE = Object.freeze({
  allowPersonalData: "Persönliche Daten",
  allowBankData: "Bankdaten",
});
export const SETTINGS_PERMISSION_HINTS_EN = Object.freeze(
  Object.fromEntries(SETTINGS_PERMISSION_TOGGLES.map((t) => [t.key, t.hint])),
);
export const SETTINGS_PERMISSION_HINTS_DE = Object.freeze({
  allowPersonalData: "Adresse, E-Mail usw. weitergeben.",
  allowBankData: "Zahlungsdaten weitergeben (nicht empfohlen).",
});

export function settingsPermissionLabel(key) {
  return tDyn({ en: SETTINGS_PERMISSION_LABELS_EN, de: SETTINGS_PERMISSION_LABELS_DE }, key) || key;
}
export function settingsPermissionHint(key) {
  return tDyn({ en: SETTINGS_PERMISSION_HINTS_EN, de: SETTINGS_PERMISSION_HINTS_DE }, key) || "";
}

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
// Settings-Redesign (Aug 2026): SettingsIsland.astro ruft diese Funktion NICHT mehr
// auf (das Stil-Dropdown ist aus der UI entfernt). Bewusst stehen gelassen statt
// geloescht: reine, DOM-freie Logik mit eigenem Drift-Test gegen das Server-Enum
// PERSONA_STYLE_IDS (apps/web/test/settings.test.js) -- kein anderer Verbraucher im
// Frontend (grep-geprueft), aber kein Aufwand, sie zu entfernen, und ein zukuenftiges
// Comeback des Stil-Dropdowns braucht dann keinen neuen Drift-Test.
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
// `form` = { language, agentName?, agentStyle?, greeting?, allowPersonalData,
// allowBankData }. greeting ist ein gewaehlter Template-String (kein Freitext-
// Eingabefeld existiert) -- seit dem Settings-Redesign (Aug 2026) baut die Insel
// gar kein greeting-Steuerelement mehr, darum reist das Feld NUR mit, wenn ein
// Aufrufer es explizit liefert (z.B. ein Test). Unbekannte Schluessel werden
// NICHT uebernommen -- die UI sendet erst gar nichts ausserhalb der Whitelist.
export function buildSettingsPatch(form) {
  const src = form || {};
  // greeting steht bewusst NICHT in SETTINGS_FREE_FIELDS: der Server prueft es gegen
  // den Vorlagenkatalog (selfServicePatch), nicht ueber die Free-Field-Liste. Wie bei
  // den FREE_FIELDS unten gilt: fehlt es im Snapshot (undefined), reist es nicht mit --
  // sonst wuerde jedes Speichern ein stilles greeting:"" senden, das der Server als
  // rejected zurueckmeldet (kein Template), weil die Insel keine Vorlagenauswahl mehr hat.
  const patch = {};
  if (src.greeting !== undefined) patch.greeting = String(src.greeting ?? "");
  for (const key of SETTINGS_FREE_FIELDS) {
    // Ein Feld, dessen Steuerelement die Insel gar nicht gerendert hat (undefined),
    // reist NICHT mit: "" ist fuer die optionalen Enum-Overrides (language,
    // agentStyle) ein RESET - ein nie sichtbares Dropdown wuerde sonst einen
    // gespeicherten Wert still loeschen.
    if (src[key] === undefined) continue;
    patch[key] = String(src[key] ?? "");
  }
  // Owner-Entscheidung 2026-08-14: die Permissions-Oberflaeche ist aus dem
  // Dashboard entfernt. Ein Toggle, den die Insel nicht gerendert hat
  // (undefined im Snapshot), reist NICHT mit -- sonst wuerde jedes Speichern
  // die serverseitig gespeicherten Werte still auf false zuruecksetzen.
  // Explizit uebergebene Booleans reisen weiter (Whitelist-Grenze lebt im
  // Server, das Feld selbst bleibt gueltig).
  for (const { key } of SETTINGS_PERMISSION_TOGGLES) {
    if (src[key] === undefined) continue;
    patch[key] = Boolean(src[key]);
  }
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
const PRIVATE_NUMBER_TEXT_NONE_DE = "Noch keine Nummer gespeichert.";
const PRIVATE_NUMBER_TEXT_PREFIX = "Currently saved: ";
const PRIVATE_NUMBER_TEXT_PREFIX_DE = "Aktuell gespeichert: ";
export function privateNumberStatusText(data) {
  const masked = maskedPrivateNumberFrom(data);
  return masked
    ? `${tPair(PRIVATE_NUMBER_TEXT_PREFIX, PRIVATE_NUMBER_TEXT_PREFIX_DE)}${masked}`
    : tPair(PRIVATE_NUMBER_TEXT_NONE, PRIVATE_NUMBER_TEXT_NONE_DE);
}

// Stabiler Fehlercode der Schreib-Route bei ungueltiger/gesperrter Nummer
// (src/self-service-routes.js). Hier benannt, damit die Insel keinen Magic-String haelt.
export const ERROR_INVALID_PRIVATE_NUMBER = "invalid_private_number";

// Meldungstexte des Nummern-Formulars (Speichern/Entfernen/leeres Feld/ungueltige
// Nummer) -- dynamische Strings, EN Quelle der Wahrheit + DE-Zwilling (Muster
// NEWSLETTER_MESSAGES, lib/subscribe.js). Session-abgelaufen/generischer Fehler
// bleiben bewusst AUSSERHALB dieses Katalogs: das ist derselbe Text wie beim
// Settings-Formular (STRINGS.settingsSessionExpired/settingsNotSaved, lib/i18n.js
// t()) -- keine zweite Kopie in diesem Modul (G5).
export const PRIVATE_NUMBER_MESSAGES = Object.freeze({
  saved: "Number saved.",
  removed: "Number removed.",
  missing: "Enter a number first, or use Remove.",
  invalid: "That number isn't valid or isn't allowed. Use the international format, for example +49 151 23456789.",
});
export const PRIVATE_NUMBER_MESSAGES_DE = Object.freeze({
  saved: "Nummer gespeichert.",
  removed: "Nummer entfernt.",
  missing: "Gib zuerst eine Nummer ein, oder nutze Entfernen.",
  invalid:
    "Diese Nummer ist ungültig oder gesperrt. Nutze das internationale Format, zum Beispiel +49 151 23456789.",
});
export function privateNumberMessage(key) {
  return tDyn({ en: PRIVATE_NUMBER_MESSAGES, de: PRIVATE_NUMBER_MESSAGES_DE }, key);
}

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
