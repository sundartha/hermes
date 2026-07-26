// Reine, IO-freie Code-Defaults und Profil-Sanitisierung. Von BEIDEN Backends
// (json.js + pg.js) genutzt, damit "frischer pg-Zustand == frischer json-Zustand"
// strukturell garantiert ist (eine Quelle statt zwei). Kein DB-/Datei-Zugriff hier.

// GAP-14/O7: der Inbound-Pflichtsatz (Blatt-Modul, importiert selbst nichts - kein
// Zyklus moeglich). Der geseedete DEFAULT_GREETING traegt ihn AT REST (s.u.).
import { INBOUND_NOTICES, withInboundNotice } from "../i18n/inbound-notice.js";

// Bootstrap-Tenant: in der Single-Tenant-Phase laeuft alles unter genau einem Tenant
// (der "erste" Tenant, kein hartcodierter Owner-Sonderfall mehr - Owner-Removal P2a).
// Benannte Konstante statt verstreutem Magic-String (von json/pg/state-ops/server
// gemeinsam genutzt). pg.js re-exportiert sie, damit RLS-GUC + Seeding davon haengen.
// Wert bleibt vorerst "owner" (Symbol neutralisiert; ein Wert-Wechsel waere eine
// Store-Migration und gehoert nach P2b/P5).
export const BOOTSTRAP_TENANT_ID = "owner";

// Demo-Termine relativ zum Startzeitpunkt (Tage voraus / Uhrzeit). Werte als
// benannte Eintraege statt nackter Zahlen mitten im Code.
const DEMO_EVENTS = [
  { id: "ev1", title: "Team-Meeting", daysAhead: 1, startHour: 10, endHour: 11 },
  { id: "ev2", title: "Mittagessen mit Alex", daysAhead: 2, startHour: 12, endHour: 13 },
  { id: "ev3", title: "Projekt-Review", daysAhead: 3, startHour: 15, endHour: 16.5 },
];

// Hoechstens so viele Notifications behalten (Ring-Puffer, neueste zuerst).
export const MAX_NOTIFICATIONS = 50;

// Telefonie-Provider fuer den config-derived Nummern-Seed (number-Tabelle). Bisher
// als "twilio" an mehreren Stellen hardcodet (state-ops.seedBootstrapNumber,
// pg.flushNumbers, migrate.seedDefaults); ab P5 (zweiter Provider Telnyx) eine
// benannte Konstante (G25), eine Quelle (G5/G13). Die telephony-registry importiert
// dieselben Werte fuer den Header-Dispatch.
export const PROVIDER = Object.freeze({ TWILIO: "twilio", TELNYX: "telnyx" });
export const DEFAULT_PROVIDER = PROVIDER.TWILIO;

// Provider fuer den Owner-Number-Autoseed aufloesen (render-owner-autoseed, AC4 /
// Pre-Mortem R1 - stiller Falsch-Carrier). PURE Entscheidung (providerRaw als Arg,
// lowercase erwartet wie config.provisioning.ownerNumberProvider), bewusst getrennt vom IO-Wrapper
// in json.js und so direkt unit-testbar: ungesetzt/leer -> DEFAULT_PROVIDER (Twilio,
// haeufigste Konfiguration, Zero-Config); gesetzt + gueltig (twilio|telnyx) -> dieser
// Provider; gesetzt + ungueltig (z.B. Tippfehler "twillio") -> null (fail-closed -> der
// Aufrufer seedet NICHT, der Boot-Guard greift, statt still den falschen Carrier zu
// schreiben). Die Trennung leer<->Muell ist gewollt: nur Muell ist ein Refusal-Grund.
// Validierungs-Quelle ist dasselbe Object.values(PROVIDER) wie in seedBootstrapNumberFromConfig (G5).
export function resolveSeedProvider(providerRaw) {
  if (!providerRaw) return DEFAULT_PROVIDER;
  return Object.values(PROVIDER).includes(providerRaw) ? providerRaw : null;
}

// ---- Number-Lifecycle (Onboarding ohne Payment) ----
// Zustaende einer provisionierten Nummer. Eine Nummer wird NIE direkt "active"
// gebaut - sie durchlaeuft requested -> provisioning -> active. Der reale
// Provider-Kauf haengt strukturell an provisioning (kein Kauf ohne diesen
// Zustand); die Cap-Pruefung (config.provisioning.maxNumbers) ersetzt das frueher geplante
// Stripe-Schloss (Payment uebersprungen, Kosten-Notbremse bleibt).
export const NUMBER_STATUS = Object.freeze({
  REQUESTED: "requested", // angefragt, noch KEINE e164, KEIN Provider-Kauf
  PROVISIONING: "provisioning", // Kauf/Konfiguration beim Provider laeuft
  // Geld wird eingezogen (Stripe capture), bevor die Nummer aktiv routet. NUR im
  // Payment-Pfad erreicht (PAYMENT_ENABLED); payment-off ueberspringt diesen Zustand
  // (provisioning -> active bleibt legal) -> byte-identisch zum Bestand.
  CAPTURING: "capturing",
  ACTIVE: "active", // gekauft + konfiguriert + dem Tenant zugewiesen, routet
  FAILED: "failed", // Kauf/Konfig fehlgeschlagen -> Rollback/Release
  SUSPENDED: "suspended", // Abuse/Budget/manuell stillgelegt (routet nicht)
  RELEASED: "released", // freigegeben (terminal)
});

// Erlaubte Transitionen (fail-closed: alles nicht hier Gelistete ist verboten).
// from -> Set der zulaessigen Folge-Zustaende. RELEASED ist terminal (leer).
export const NUMBER_TRANSITIONS = Object.freeze({
  [NUMBER_STATUS.REQUESTED]: [NUMBER_STATUS.PROVISIONING, NUMBER_STATUS.FAILED],
  [NUMBER_STATUS.PROVISIONING]: [
    NUMBER_STATUS.CAPTURING,
    NUMBER_STATUS.ACTIVE,
    NUMBER_STATUS.FAILED,
  ],
  [NUMBER_STATUS.CAPTURING]: [NUMBER_STATUS.ACTIVE, NUMBER_STATUS.FAILED],
  [NUMBER_STATUS.ACTIVE]: [NUMBER_STATUS.SUSPENDED, NUMBER_STATUS.RELEASED],
  [NUMBER_STATUS.SUSPENDED]: [NUMBER_STATUS.ACTIVE, NUMBER_STATUS.RELEASED],
  [NUMBER_STATUS.FAILED]: [NUMBER_STATUS.RELEASED],
  [NUMBER_STATUS.RELEASED]: [],
});

// Skip-Grund, den requestNumber sichtbar am Tenant hinterlaesst (Fix B, PLAN-
// PROVISIONING-CAP.md Phase A). Bewusst NUR dieser eine Grund: tenant_cap/tenant_inactive
// sind fachlich andere Faelle (Tenant hat schon eine Nummer bzw. ist nicht aktiv) und
// nicht Teil dieser Phase.
export const GLOBAL_CAP_REASON = "global_cap";

// Skip-Gruende von requestNumber() als Enum (G25/G11): EINE Quelle statt verstreuter
// String-Literale in state-ops.js. GLOBAL_CAP bleibt der bestehende GLOBAL_CAP_REASON-
// Export (kein Duplikat, Wert identisch).
export const REQUEST_NUMBER_REASON = Object.freeze({
  TENANT_INACTIVE: "tenant_inactive",
  TENANT_CAP: "tenant_cap",
  GLOBAL_CAP: GLOBAL_CAP_REASON,
});

// Persistenz-Entscheidung fuer ein requestNumber()-Ergebnis (Fix B, PLAN-PROVISIONING-
// CAP.md Phase A). Erfolg wird IMMER persistiert ('requested' auch im Dry-Run); der
// global_cap-Skip wird IMMER persistiert (reine Observability, kein Trigger); jeder
// andere Skip-Grund (tenant_cap/tenant_inactive) bleibt ungespeichert (ausserhalb des
// Scopes dieser Phase). EINE Quelle fuer BEIDE Call-Sites (POST /api/onboard UND
// triggerTenantProvisioning, G5/S2 - vorher woertlich dupliziert).
export function shouldPersistProvisionResult(r) {
  return r.ok || r.reason === GLOBAL_CAP_REASON;
}

// ---- Provisioning-Jobs (async Worker, P6b2) ----
// Status eines enqueued Jobs. EINE Quelle (G5/G13): der In-Memory-Queue-Adapter
// (queue/adapters/memory) UND die persistente Job-Spur im Store-Spiegel (state-ops
// recordProvisioningJob) importieren dieselben Werte - sonst driften zwei Listen
// von "queued"/"done"/"failed"-Strings auseinander. PROVISION_NUMBER_JOB ist der
// einzige Job-Typ in P6b2 (Nummer kaufen + konfigurieren).
export const PROVISIONING_JOB_STATUS = Object.freeze({
  QUEUED: "queued",
  DONE: "done",
  FAILED: "failed",
});
export const PROVISION_NUMBER_JOB = "provision_number";

// ---- Metering / Budget (P6b3) ----
// usage_event.kind: die Stripe-Meter (Plan-Datenmodell). EINE Quelle (G5/G13): der
// Recorder (state-ops recordUsageEvent), der Flush (billing/meter.js) UND die
// pg-Hydrierung/Flush importieren dieselben Werte - sonst driften kind-Strings.
// P6b3 verdrahtet die DREI im Scope (voice_minute, ai_token, number_month); SMS
// bleibt als zukunftssicherer kind-Wert im Enum (Datenmodell-Treue, OHNE Producer
// in dieser Phase - reine Datenkonstante, kein Code-Branch).
export const USAGE_EVENT_KIND = Object.freeze({
  VOICE_MINUTE: "voice_minute",
  AI_TOKEN: "ai_token",
  SMS: "sms",
  NUMBER_MONTH: "number_month",
});

// LCT P3: Herkunft des Ist-Werts am Call (costTruedSource). KEINE dritte Kosten-Achse -
// eine Herkunftsangabe. 'incomplete' = Records da, Pflicht-Menge nicht vollstaendig
// (auch bei LEERER Pflicht-Menge: die beweist nichts) - ein DATENPROBLEM (Messung
// lueckenhaft). 'no_estimate' (LCT P4) = Records VOLLSTAENDIG bewiesen, aber KEIN
// persistierter Schaetzbetrag (Bestandszeile von vor P2) - strukturell nicht korrigierbar,
// kein Messproblem; wie 'incomplete' nicht erstattbar und nicht 'telnyx_detail_records',
// aber ein anderer Sachverhalt und deshalb ein eigener Zustand (zwei Ursachen teilen sich
// NICHT ein Label). 'unavailable' = nicht gemessen (ok:false, leere Antwort, unparsbare
// Summe) und NIEMALS "Kosten = 0".
export const COST_TRUING_SOURCE = Object.freeze({
  DETAIL_RECORDS: "telnyx_detail_records",
  INCOMPLETE: "incomplete",
  NO_ESTIMATE: "no_estimate",
  UNAVAILABLE: "unavailable",
});

// Cent<->EUR-Bruecke (G25): EUR-Ableitung an Anzeige-/Persistenz-Kanten (z.B.
// api-read.js usageView, pg.js flushUsage). Das Budget-Gate selbst vergleicht rein
// Integer costCents (P1) - keine Division im Gate-Pfad.
export const CENTS_PER_EUR = 100;

// Nachkommastellen der EUR-Anzeige in Ablehnungstexten (P5a). Benannte Konstante statt
// nackter "2" in toFixed().
export const EUR_DECIMALS = 2;

// EINE Geld-nach-Text-Kante (G5/G25): Ablehnungstexte (outbound-gates.js) formatieren
// Cents NUR hier zu einem EUR-String. api-read.js bleibt numerisch (JSON-Zahl, kein
// String) - kein Duplikat derselben Formatierung.
export function eurText(cents) {
  return (cents / CENTS_PER_EUR).toFixed(EUR_DECIMALS);
}

// 'YYYY-MM-DD' - Laenge des ISO-Datumspraefix (G25, keine nackte 10 in slice()).
const ISO_DATE_LENGTH = 10;

// Letzter Tag des laufenden UTC-Kalendermonats (Spend-Monat-Achse, s. state-ops.js
// spendMonthKeyOf/emptyUsage - dieselbe Achse, hier nur als Anzeige-Datum statt als
// Vergleichsschluessel). Tag 0 des Folgemonats = letzter Tag des laufenden Monats;
// Date.UTC normalisiert den Dezember-Ueberlauf selbst (Monat 12 -> Jahr+1, Monat 0).
// nowMs kommt vom Aufrufer (Date.now()), damit dieses Modul zeit-frei bleibt (Muster
// voiceMinutesUsedSince/setSuspendedAtIfAbsent) und der Wert nie unlesbar sein kann.
// Reine Funktion.
export function spendMonthEndDate(nowMs) {
  const at = new Date(nowMs);
  const lastDayOfMonth = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0));
  return lastDayOfMonth.toISOString().slice(0, ISO_DATE_LENGTH);
}

// Sub-Cent-Aufloesung fuer die KI-Kosten-Akkumulation (Safety-BLOCKER P1): der
// Sub-Cent-Anteil eines Turns (Haiku << 0,5 Cent) darf NICHT pro Inkrement auf 0
// gerundet werden. trackUsage akkumuliert exakt in Mikro-Cents (1 Cent = 1e6) und
// bucht nur den vollen Cent-Uebertrag in costCents (G26: Money at rest = Ganzzahl).
export const MICRO_CENTS_PER_CENT = 1_000_000;

// Audit-/Log-Grund fuer einen unbuchbaren Geldwert (D7). EINE Quelle (G5/G25): Schreib-,
// Lese- und Hydrierungskante nennen denselben String, damit der Operator "Bucket vergiftet"
// NIE mit "Budget wirklich erschoepft" verwechselt - genau diese Fehldiagnose hat den
// Vorfall verlaengert. Deutsch, wie die uebrigen Gate-Gruende (denylist/land/reserve).
export const USAGE_CORRUPT_REASON = "usage_korrupt";

// Ist x ein BUCHBARER Geldbetrag (GANZZAHL-Cents-Konvention, G26)? EINZIGE
// Gueltigkeitsquelle aller Geld-Kanten (D7, G5): Schreibkante (trackUsage,
// addVoiceUsageCostCents), Lesekante (budgetExceeded, globalBudgetExceeded und die beiden
// reserve-bewussten Schwestern), Reserve-Riegel (tryReserveOutboundBudget) und die
// pg-Hydrierung (rowToUsage) fragen NUR hier. Vorher stand eine negierte Vorzeichenpruefung
// ad hoc genau einmal (in tryReserveOutboundBudget); fuenf weitere Inline-Kopien waeren
// exakt die Invarianten-per-Konvention-Klasse, an der die naechste vergessene
// Schreibstelle fail-open geht.
//
// Prueft auf Endlichkeit, Ganzzahligkeit und Nicht-Negativitaet, NIE auf Kleinheit
// (P1-Safety-BLOCKER): ein Sub-Cent-Turn (Haiku << 0,5 Cent, faehrt in
// costMicroCentsRem) und ein legitimer 0-Betrag bleiben buchbar - die Kleinheits-Ausnahme
// gilt fuer die MICRO-Cent-Einheit, nicht fuer die (groebere) Cents-Achse selbst.
// Number.isFinite faengt NaN UND +/-Infinity (ein positiver Unendlich-Wert waere bei
// einer reinen >=0-Pruefung durchgerutscht - genau die Luecke, die die alte Pruefung
// offen liess) und faengt zugleich Nicht-Zahlen ("5" ist nicht buchbar).
// Number.isInteger (Review-Fix Runde 1, G26): diese Funktion ist die EINZIGE
// Gueltigkeitsquelle der Ganzzahl-Cents-Konvention (G26, Money at rest) - ohne
// Ganzzahl-Pruefung waere ein fraktionaler Wert (z.B. 0.5) klaglos in den
// Ganzzahl-Akkumulator costCents geschrieben worden. turnIncrementsBookable bleibt
// kompatibel: Token-Zaehler und microInc sind produktionsseitig immer Ganzzahlen.
// Reine Funktion.
export function isBookableCents(x) {
  return Number.isFinite(x) && Number.isInteger(x) && x >= 0;
}

// Skala, in der providerToBucketRateMicro gefuehrt wird (config.js). Benannt, damit
// weder die Korrektur-Formel (state-ops.CORRECTION_DIVISOR) noch der Drift-Waechter
// (cost-calibration.providerMicroCentsToBucketCents) eine nackte 1_000_000 im Rumpf
// traegt (G25) und nicht mit dem gleich aussehenden MICRO_CENTS_PER_CENT verwechselt
// wird - die beiden haben NICHTS miteinander zu tun (Kurs-Skala vs. Geld-Aufloesung).
// EINE Quelle fuer beide Umrechner (G5): dieselbe Kurs-Skala wird nie zweimal gepflegt.
export const PROVIDER_RATE_SCALE = 1_000_000;

// Ist x ein buchbarer KORREKTUR-Betrag (LCT P4)? Schwester von isBookableCents, mit
// EINEM Unterschied: BELIEBIGES VORZEICHEN. isBookableCents (x >= 0) bleibt
// UNVERAENDERT - es ist der fail-closed-Riegel gegen korrupte Werte auf dem
// Bestandspfad (D12) und wird NICHT aufgeweicht, sondern bekommt einen Nachbarn.
export function isCorrectionCents(x) {
  return Number.isFinite(x) && Number.isInteger(x);
}

// Preis-Bezugsgroesse der Anthropic-Preisstaffel (USD pro 1 Mio. Tokens). Benannt
// (G25), weil tokenCostUsd sonst zwei nackte 1e6 traegt, die NICHTS mit dem
// gleich aussehenden MICRO_CENTS_PER_CENT zu tun haben.
export const TOKENS_PER_M_TOK = 1_000_000;

// Globaler Notaus-Cap in GANZZAHL Cents (G5: eine Quelle fuer das Gate-Rechnen in Cents).
// cfg.platformSpendCapCents ist bereits Cents -> reiner benannter Seam, kein Einheiten-Mix
// im Gate. Die EUR-Anzeige-Schwester (frueher globalCapEur) ist mit P5a entfallen: die
// Plattform-Achse gibt NIE eine Zahl an einen Tenant heraus (Cross-Tenant-Leck-Riegel,
// s. outbound-gates.js PLATFORM_DENIAL) - eine EUR-Ableitung dieses Caps hatte ab da
// keinen Aufrufer mehr (F4, tote Funktion).
export function globalCapCents(cfg) {
  return cfg.platformSpendCapCents;
}

// Intrinsische Fallback-/Cap-Werte der Reserve-Dauer (KEIN Operator-Knopf -> nicht config.js,
// G35 n.z.). MAX_CALL_DURATION_CAP_S deckelt AUCH den Body-Override (place_call max_duration_s).
export const DEFAULT_CALL_DURATION_S = 180;
export const MAX_CALL_DURATION_CAP_S = 300;

// P6 (PLAN-CONVERSATION-QUALITY-V2, Anhang C): Verhalten des Agenten, wenn ein Angebot
// AUSSERHALB des vorab erteilten Mandats liegt. EINE Quelle (G25/G5) fuer das
// place_call-Schema (zod-Enum), die /api/calls-Validierung und den Prompt-Renderer.
// Das Mandat erlaubt NUR muendliche Zusagen im vom Owner gesetzten Rahmen - es oeffnet
// keinen Kalender- oder Buchungspfad (Owner-Entscheidung E1).
export const MANDATE_OUT_OF_SCOPE = Object.freeze({
  TAKE_MESSAGE: "take_message",
  DECLINE: "decline",
  ACCEPT_BEST: "accept_best",
});
export const MANDATE_OUT_OF_SCOPE_VALUES = Object.freeze(Object.values(MANDATE_OUT_OF_SCOPE));
// Konservativster der drei Wege: ohne ausdrueckliche Angabe gibt der Agent ein Angebot
// ausserhalb seines Spielraums als Nachricht weiter, statt ab- oder zuzusagen.
export const MANDATE_OUT_OF_SCOPE_DEFAULT = MANDATE_OUT_OF_SCOPE.TAKE_MESSAGE;

// Tenant-Lebenszyklus (Onboarding). status steuert, ob ein Tenant ueberhaupt
// Nummern/Calls bekommen darf (suspended/closed = gesperrt, fail-closed).
export const TENANT_STATUS = Object.freeze({
  ACTIVE: "active",
  SUSPENDED: "suspended",
  CLOSED: "closed",
});

// Kanonische Tenant-ID aus einer IdP-Identitaet (WorkOS access_token sub). EINE Quelle
// (G5) fuer Web-Login (upsertOnFirstLogin) UND den idp-gebundenen Onboard-Pfad: derselbe
// sub MUSS denselben Tenant-Record adressieren, sonst entstehen zwei Records pro Person.
// Praefix als benannte Konstante (G25), nicht als verstreuter Magic-String.
const TENANT_ID_PREFIX = "t_";
export const tenantIdForSubject = (sub) => `${TENANT_ID_PREFIX}${sub}`;

// KYC-Reifegrad eines Tenants (P6b4). Geordnete Stufen: jede hoehere schliesst
// die niedrigeren ein. EINE Quelle (G5/G25): der Gate-Vergleich (state-ops
// kycReached) UND der Setter (setKycLevel) UND die pg-Hydrierung/Flush
// importieren dieselben Werte - sonst driften die level-Strings.
// none < otp < card < id_verified. KYC_ORDER bildet die Vergleichbarkeit ab
// (Index = Rang), damit ">= card" ohne magische Zahlen ausdrueckbar ist.
export const KYC_LEVEL = Object.freeze({
  NONE: "none",
  OTP: "otp",
  CARD: "card",
  ID_VERIFIED: "id_verified",
});
export const KYC_ORDER = Object.freeze([
  KYC_LEVEL.NONE,
  KYC_LEVEL.OTP,
  KYC_LEVEL.CARD,
  KYC_LEVEL.ID_VERIFIED,
]);

// Schwelle fuer Outbound (Gate). >= card. Benannte Konstante (G25), eine Quelle
// fuer Gate + Tests.
export const KYC_OUTBOUND_MIN = KYC_LEVEL.CARD;

function nextWeekday(daysAhead, hour) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const wholeHours = Math.floor(hour);
  const minutes = (hour % 1) * 60;
  d.setHours(wholeHours, minutes, 0, 0);
  return d.toISOString();
}

// Default-Begruessung (erster Inbound-Satz). EINE Quelle (G5): defaultSettings()
// UND der Greeting-Katalog (i18n/greeting-catalog.js greetingTemplatesFor) referenzieren
// sie, damit der geseedete Default IMMER eine waehlbare Vorlage bleibt (kein Drift).
//
// GAP-14: der geseedete Default traegt den Pflichtsatz bereits AT REST. Sonst waere der
// Default der einzige Wert, den updateSettings nach dem Guard (state-ops) nicht mehr
// zurueckschreiben koennte. Zusammensetzung statt zweiter Literal-Kopie des Satzes (G5).
export const DEFAULT_GREETING = withInboundNotice(
  "Hallo, hier ist der KI-Assistent von {owner}. {owner} kann gerade nicht ans Telefon. Ich kann eine Nachricht fuer {owner} aufnehmen. Wie kann ich helfen?",
  INBOUND_NOTICES.de,
);

// ---- Geo-Location (F1): Default-Land + -Sprache ----
// EINE Quelle (G5/G25) fuer die Geo-Defaults: defaultSettings().language, der
// config-derived Number-Seed (seedBootstrapNumber), der Nummern-Request (requestNumber)
// UND der Code-Fallback der spaeteren Sprach-/Routing-Konsumenten leiten DE/de
// hieraus ab. Die Geo-Felder auf Number-/Tenant-Record sind additiv NULLABLE
// (Bestand ohne Wert -> Code-Fallback hier, nie hart angenommen, R7). country =
// ISO-3166-1-alpha-2, language = BCP-47-kurz.
export const DEFAULT_COUNTRY = "DE";
// Weltdefault (Owner-Entscheidung 7.12, PLAN-I18N-FIX P10): "en", NICHT mehr "de".
// LANGUAGE_FOR_COUNTRY (i18n/locales.js) bleibt unveraendert - DE/AT/CH/FR/GB/IE loesen
// weiterhin auf ihre eigene Sprache auf, dieser Flip aendert nur den Fallback fuer JEDES
// andere/unbekannte Land.
//
// Review-Fix (Runde 1, P10-Blocker "ENTSCHAERFT (1)"): der Flip haengt zusaetzlich an
// einem Env-Schalter (WORLD_DEFAULT_LANGUAGE_ENABLED, s. config.js) - Rueckflip ohne
// Deploy in Minuten (Render-Dashboard-Env-Aenderung statt Commit-Revert). Diese Datei
// bleibt IO-/config-frei (s. Datei-Kopf, "reine Code-Defaults", von beiden Backends UND
// von reinen Unit-Tests config-frei importierbar): config.js liest den Schalter EINMAL
// beim Boot und drueckt das Ergebnis ueber setWorldDefaultLanguageEnabled() hier rein
// (Wiring im Kompositions-Root, P15) - kein Rueck-Import defaults.js->config.js noetig.
// Reine Unit-Tests, die config.js nie laden, sehen weiterhin den unveraenderten
// Default "en" (byte-identisch zum Bestand vor diesem Fix).
export let DEFAULT_LANGUAGE = "en";

// NUR von config.js aufgerufen (s.o.), sonst bleibt der Code-Default "en" stehen.
// enabled=false -> Rueckfall auf "de" (Vor-Flip-Verhalten, Aktivierungsfenster-Default
// laut PLAN-I18N-FIX.md P10 bis zur Abnahme von P13); enabled=true -> "en" (Weltdefault).
export function setWorldDefaultLanguageEnabled(enabled) {
  DEFAULT_LANGUAGE = enabled ? "en" : "de";
}

// P8/FMT-28 (Owner-Entscheidung 7.6): IANA-Zeitzone des Default-Landes. Reine ANZEIGE -
// sie faerbt nur die Uhrzeit im Systemprompt (claude.js). Ein Anrufzeit-Gate ist
// ausdruecklich ABGELEHNT (LAW-07); dass KEIN Gate-Modul dieses Feld liest, pinnt
// test/p8-timezone-no-gate.test.js strukturell.
export const DEFAULT_TIMEZONE = "Europe/Berlin";

// Fail-safe Aufloesung einer gespeicherten Zeitzone (R7-Muster wie localeFor): fehlend,
// leer oder kein gueltiger IANA-Bezeichner -> DEFAULT_TIMEZONE. PFLICHT, weil
// Date#toLocaleString mit einer unbekannten timeZone einen RangeError WIRFT - ein
// Muellwert an dieser Stelle wuerde sonst jeden Prompt-Bau und damit jeden Anruf toeten.
export function resolveTimezone(timezone) {
  if (typeof timezone !== "string" || !timezone.trim()) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function defaultSettings() {
  return {
    agentName: "Hermes",
    greeting: DEFAULT_GREETING,
    // Seit P1b (Owner-Entscheidung E1) OHNE lesenden Konsumenten: der Telefon-Agent
    // hat kein Kalender-/Buchungs-Tool mehr, und Self-Service kann die Felder nicht
    // mehr setzen. Bewusst NICHT entfernt - ein Spalten-Drop waere eine Migration mit
    // Rollback-Risiko ohne funktionalen Gewinn. Die GLEICHNAMIGEN Felder auf der
    // Profil-Achse (PROFILE_FIELDS weiter unten) leben unabhaengig weiter und gaten
    // weiterhin das MCP-Tool und POST /api/calendar - nicht verwechseln.
    allowCalendar: true,
    allowBooking: true,
    allowSummaries: true,
    // F2 P7: Opt-Out fuer die Summary-SMS an die private Nummer (Decision #2, Muster
    // allowSummaries). Default true = Bestandsverhalten (wer eine private Nummer hinterlegt,
    // bekommt die SMS). false = Summary ja, aber KEINE SMS - ohne die Nummer (Login-/
    // Kontaktkanal) loeschen zu muessen. Kein PII (Boolean) -> ueber /api/state + MCP
    // sichtbar unkritisch; schreibbar ueber die POST /api/settings-Whitelist (updateSettings).
    smsSummaryOptIn: true,
    allowPersonalData: false,
    allowBankData: false,
    // Gespraechssprache pro Tenant als OPTIONALES Override (F1 Phase 4, Entscheidung #8):
    // null = "nicht gesetzt" -> die Aufloesungs-Praezedenz (resolveCallLanguage) faellt
    // auf number.language -> tenant.defaultLanguage -> DEFAULT_LANGUAGE (Weltdefault, P10)
    // durch. Ein harter Default wuerde number.language IMMER ueberstimmen (Praezedenz-Bug)
    // -> deshalb null statt eines festen Sprachcodes.
    // Im Dashboard umstellbar (updateSettings hat eine eigene language-Validierung gegen
    // SUPPORTED_LANGUAGES, da typeof null === "object" den generischen Typ-Check umgeht).
    language: null,
    // Stehender Tenant-Stil (P2, Owner-Entscheidung 6.1): kuratierte NON-PII-Enum-ID
    // (PERSONA_STYLE_IDS, src/i18n/locales.js) ODER null. null = Bestand (neutral, Siezen)
    // -> agentStyle=null byte-identisch zum heutigen systemPrompt (P0-Pins). Faerbt NUR
    // Ton + Anrede EINER System-Prompt-Zeile (claude.js styleClause), NIE Offenlegung/
    // Persona/Telefon-Regeln. Validiert fail-closed in updateSettings (kein Freitext).
    agentStyle: null,
  };
}

// Demo-Termine, damit der Agent echte Verfuegbarkeiten hat.
export function demoCalendar() {
  return DEMO_EVENTS.map((e) => ({
    id: e.id,
    title: e.title,
    start: nextWeekday(e.daysAhead, e.startHour),
    end: nextWeekday(e.daysAhead, e.endHour),
  }));
}

// Settings-Map mit dem Owner-Bucket vorbelegt (Identitaets-Schicht pro-Tenant, I2;
// analog emptyUsageMap). s.settings ist eine Map tenantId -> Settings. Der
// Owner-Bucket existiert von Anfang an (Dashboard/POST /api/settings lesen ihn).
export function defaultSettingsMap() {
  return { [BOOTSTRAP_TENANT_ID]: defaultSettings() };
}

// Kalender-Map mit dem Owner-Demo-Kalender vorbelegt (I2; analog emptyUsageMap).
// s.calendar ist eine Map tenantId -> [events]. Nur der Owner ist vorbelegt; ein
// neuer Tenant bekommt ueber calendarFor eine leere Liste.
export function calendarMap() {
  return { [BOOTSTRAP_TENANT_ID]: demoCalendar() };
}

// Leerer Usage-Bucket. Money at rest = GANZZAHL Cents (costCents, G26). costMicroCentsRem
// = ephemerer Sub-Cent-Rest der KI-Akkumulation (nie auf Platte, Reset 0 bei Boot).
// spendMonthKey/spendMonthCostCents (P4): zweite, PERIODISCHE Achse (UTC-Kalendermonat)
// NEBEN dem unveraenderten Lebenszeit-Zaehler costCents. null = noch nie gestempelt ->
// die Leseprojektion spendMonthUsageCents liefert 0. Sie ist die Gate-Quelle NUR bei
// BUDGET_MONTH_ENABLED=true (P7). NICHT die Stripe-Abrechnungsperiode
// (src/billing/period.js) - die traegt seit GAP-01 die dritte Achse weiter unten.
export function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    costMicroCentsRem: 0,
    // LCT P4: Sub-Cent-Rest der KORREKTURBUCHUNGEN. PERSISTIERT - und das ist der
    // Unterschied zum Nachbarn costMicroCentsRem eine Zeile darueber, der ausdruecklich
    // ephemer ist. Zwei gleich benannte Rest-Felder mit verschiedener Lebensdauer sind
    // eine Falle fuer den naechsten Leser, deshalb hier hart begruendet: der
    // Korrektur-Rest sammelt sich ueber TAGE (ein Abgleichlauf alle 6 h, verzoegert um
    // 180 min), der trackUsage-Rest entsteht und verbraucht sich innerhalb EINES
    // Gespraechs. Ein Restart wirft beim Korrektur-Rest also echtes Geld weg.
    costCorrectionMicroCentsRem: 0,
    // KE-P6: ElevenLabs-Zeichen dieses Tenants, LEBENSZEIT-Summe wie calls. Quelle ist
    // AUSSCHLIESSLICH der zugeordnete Telnyx-Beleg (number_of_characters am
    // text-to-speech-Beleg mit provider elevenlabs) - der globale platformTtsUsage-Zaehler
    // daneben misst den anderen Pfad (Play-TTS) und bleibt unveraendert. REINE SICHTBARKEIT:
    // kein Gate, kein Meter, keine Projektion liest diese Zahl (die /api/state-Usage-
    // Projektion ist eine Whitelist, s. test/api-state-usage-axis.test.js).
    ttsCharacters: 0,
    calls: 0,
    spendMonthKey: null,
    spendMonthCostCents: 0,
    // GAP-01 (P6): DRITTE Achse - das Budget-Gate misst den Verbrauch der laufenden
    // STRIPE-Abrechnungsperiode statt der Lebenszeit. budgetPeriodKey = ISO-Periodenstart
    // (resolvePeriodStartIso, billing/period.js); null = nie gestempelt -> das Gate faellt
    // auf costCents (Lebenszeit, strengste Achse) zurueck. budgetPeriodBaselineCents ist
    // der Lebenszeit-Stand BEI Periodenbeginn - der Reset ist eine Subtraktion, kein
    // Nullen: costCents bleibt monoton (Forensik + D7-Gegenprobe).
    // NICHT der UTC-Kalendermonat (spendMonthKey daneben) und NICHT die Plattform-Achse.
    budgetPeriodKey: null,
    budgetPeriodBaselineCents: 0,
  };
}

// Usage-Map mit dem Owner-Bucket vorbelegt. Daten-Schicht pro-Tenant (P4):
// s.usage ist eine Map tenantId -> Bucket. Laufzeit bleibt owner-only, der
// Owner-Bucket existiert von Anfang an (Dashboard/get_agent_status lesen ihn).
export function emptyUsageMap() {
  return { [BOOTSTRAP_TENANT_ID]: emptyUsage() };
}

// LCT P7: globaler ElevenLabs-Zeichenzaehler (nicht tenant-scoped, Muster profile - EIN
// Konto, keine Tenant-Dimension). PERSISTIERT (ueberlebt einen Restart - ein Free-Tier-
// Dyno startet haeufig neu, ein rein prozess-lokaler Zaehler erreichte die Kontingent-
// Wand nie; dieselbe Begruendung wie costTruingAttempts). cycleKey/warnedCycle sind
// 'YYYY-MM'-Zyklusschluessel (Anker = TTS_QUOTA_CYCLE_ANCHOR_DAY, NICHT der Kalendermonat -
// der ElevenLabs-Zyklus faellt auf einen Tag mitten im Monat). REINE SICHTBARKEIT: kein
// Gate liest die Zahl.
export function emptyPlatformTtsUsage() {
  return { cycleKey: null, characters: 0, warnedCycle: null };
}

// ---- Rechteprofile pro Nutzer (Phase 2) ----
// Profil-Felder mit erwartetem Typ (Whitelist gegen sanitizeProfile, analog
// updateSettings). "string[]" = Array aus Strings.
export const PROFILE_FIELDS = {
  allowedNumbers: "string[]", // eigene Ziel-Freigabe (Pfad 1: gezielte Nummern ohne Abo/Verifikation)
  allowedCountryCodes: "string[]", // engt das globale Land-Gate weiter ein (nie auf)
  unrestricted: "boolean", // erfuellt das Verifikations-Gate (Pfad 1; nur dieses Gate, kein hartes Gate)
  allowCalendar: "boolean", // get_calendar-MCP-Tool
  allowBooking: "boolean", // POST /api/calendar
  // number ODER null: null = keine Profil-Senkung (effektiv der Pro-Tenant-Default
  // config.safety.maxCallsPerHour, telephony/outbound-gates tenantHourReached). Muss als
  // null erhalten bleiben (PLAN_PROFILE/OWNER_PROFILE) - sonst faellt das Profil ueber
  // resolveProfileFrom still auf DEFAULT_PROFILE.maxCallsPerHour (A11).
  maxCallsPerHour: "number?", // pro-Tenant-Stundenlimit (effektiv min(config, profil))
};

// E.164-Normalisierung: entfernt Whitespace/Bindestriche/Klammern aus einer
// Telefonnummer ("+49 151-(0)123" -> "+491510123"). EINE Quelle (G5/DRY) fuer die
// Inbound-To-Pruefung (server.js), den config-derived Nummern-Seed
// (state-ops.seedBootstrapNumber, migrate.seedNumber) UND die Profil-Allowlist
// (sanitizeProfile) - sonst driften drei Kopien desselben Regex. Nicht-String ->
// "" (env-gating/Guard beim Aufrufer). Seed + Lookup teilen dieselbe Form, damit
// eine gesetzte Owner-Nummer mit Trennzeichen trotzdem routbar bleibt (TD-2).
export function normNum(n) {
  return typeof n === "string" ? n.replace(/[\s\-()]/g, "") : "";
}

// E.164-Format: '+' gefolgt von 7-15 Ziffern, erste Ziffer != 0. EINE Quelle (G5):
// kanonisch hier neben normNum (dem Praezedenzort fuer geteilte Telefon-Helfer),
// damit der private-number-Setter in state-ops normalisiert UND validiert, ohne den
// Regex zu kopieren. routes/_validation.js re-exportiert diese Konstante (statt eine
// zweite Definition zu pflegen) - normale Schicht-Richtung (routes -> store), kein
// Zyklus (defaults.js importiert nichts). Wert byte-identisch zur frueheren Definition.
export const E164 = /^\+[1-9]\d{6,14}$/;

// Laendervorwahlen, bei denen eine '0' UNMITTELBAR nach der Vorwahl ein nationaler
// Trunk-Praefix (Verkehrsausscheidungsziffer) ist, der in E.164 NICHT vorkommen darf
// (DE/FR/UK lassen die fuehrende 0 im internationalen Format weg). BEWUSST eine eigene,
// enge Liste - NICHT an config.safety.allowedCountryCodes gekoppelt (G13): Italien (+39) z.B.
// BEHAELT die fuehrende 0 im NSN; eine an die Anruf-Allowlist gebundene Regel wuerde dort
// gueltige Nummern faelschlich ablehnen (Pre-Mortem). Telefonie-Tatsache, kein Policy-Gate
// -> bewusst kein Env-Knopf (fail-safe gegen Fehlkonfiguration).
const TRUNK_ZERO_COUNTRY_CODES = ["+49", "+33", "+44"];
const NATIONAL_TRUNK_PREFIX = "0";

// NANP (+1, Nordamerika + karibische Mitglieder): EIGENE Wahl-Konvention. Der nationale
// Praefix ist "1" (nicht "0"), der internationale "011" (nicht "00"). Deshalb eine eigene
// Liste NEBEN TRUNK_ZERO_COUNTRY_CODES statt eines Eintrags darin: dort gilt die
// "fuehrende 0"-Regel, hier gilt sie NIE (hasTrunkZeroAfterCountryCode bleibt unberuehrt).
const NANP_COUNTRY_CODE = "+1";
const NANP_INTERNATIONAL_PREFIX = "011";
const NANP_TRUNK_PREFIX = "1";
const NANP_NSN_DIGITS = 10; // Teilnehmernummer ohne Laender-/Trunk-Praefix
const NANP_NATIONAL_DIGITS = NANP_NSN_DIGITS + NANP_TRUNK_PREFIX.length;

// NANP-Plausibilitaet (Review-Fix Runde 1, GAP-25): NPA (Ortsvorwahl) und NXX
// (Nebenstellen-Praefix) beginnen laut NANP-Nummerierungsplan NIE mit 0 oder 1 - nur
// 2-9 sind gueltige erste Ziffern. Ohne diese Pruefung wuerde JEDE 10-stellige Eingabe
// (z.B. eine deutsche Ortsnetznummer ohne fuehrende 0) klaglos zu einer formal
// gueltigen E.164-Nummer materialisiert ("ablehnen statt raten" wird sonst verletzt -
// s. Kommentar an normalizeNanpTarget/normalizeDialTarget).
const NANP_NSN_PATTERN = /^[2-9]\d{2}[2-9]\d{6}$/;

// Heimatlaender, fuer die eine nationale Wahl-Konvention BEKANNT ist. Nur fuer sie darf
// aus einer nationalen Schreibweise eine E.164-Nummer materialisiert werden.
const DIALING_HOME_COUNTRY_CODES = [...TRUNK_ZERO_COUNTRY_CODES, NANP_COUNTRY_CODE];

// ISO-3166-1-alpha-2-Mitgliedslaender des NANP (Nordamerika + karibische Mitglieder).
// Fixe Telefonie-Tatsache (Nummerierungsplan-Mitgliedschaft), NICHT konfigurierbar
// (G35 n.z., wie TRUNK_ZERO_COUNTRY_CODES/NO_NATIONAL_ELEVEN_RANGE_COUNTRIES) und
// NICHT an config.safety.allowedCountryCodes gekoppelt (G13, gleiche Begruendung wie
// bei TRUNK_ZERO_COUNTRY_CODES: eine Policy-Liste ist kein Telefonie-Fakt).
const NANP_ISO_COUNTRIES = Object.freeze([
  "US", "CA", "AG", "AI", "AS", "BB", "BM", "BS", "DM", "DO", "GD", "GU", "JM", "KN",
  "KY", "LC", "MP", "MS", "PR", "SX", "TC", "TT", "VC", "VG", "VI",
]);

// Ist countryIso (ISO-3166-1-alpha-2, aus tenantGeo) ein NANP-Mitgliedsland? Reines
// Praedikat, Nicht-String/unbekannt -> false (fail-closed). EINE Quelle (G5) fuer den
// homeCountryCode-Guard unten.
export function isNanpCountry(countryIso) {
  return typeof countryIso === "string" && NANP_ISO_COUNTRIES.includes(countryIso.toUpperCase());
}

// Heimatlaender, in denen eine nationale Rufnummer NIE mit "11" beginnt: die 11x-Gasse ist
// dort reine Kurzwahl/Dienste (DE 110/112/115/116xxx/118xx, FR 112/115/118xxx). Eine
// Eingabe "011..." kann dort also keine nationale Nummer sein - normalisiert man sie
// trotzdem ueber die Trunk-0-Regel, materialisiert man aus einer NANP-Auslandswahl
// ("011" + 44...) eine falsche INLANDS-Nummer und ruft einen Dritten an (GAP-25).
// "+44" ist BEWUSST NICHT dabei: 0113/0114/0115/0116/0117/0118 sind echte britische
// Ortsnetze - dort bleibt der Wahlpfad byte-identisch zum Bestand.
const NO_NATIONAL_ELEVEN_RANGE_COUNTRIES = ["+49", "+33"];

// true, wenn die (bereits normNum-normalisierte) Nummer eine Trunk-0 direkt nach einer
// dieser Laendervorwahlen traegt (z.B. +4901737... statt +491737...). Reines Praedikat
// (kein Kanonisieren - Owner-Entscheidung #4: REJECT). Nicht-String/leer -> false
// (fail-closed beim Aufrufer; das allgemeine E.164-Format prueft weiter die E164-Regex
// bzw. numberGateError). Vertrag bewusst getrennt von normNum (nur kosmetisch) und E164.
export function hasTrunkZeroAfterCountryCode(e164) {
  if (typeof e164 !== "string" || !e164) return false;
  return TRUNK_ZERO_COUNTRY_CODES.some((code) => e164.startsWith(code + NATIONAL_TRUNK_PREFIX));
}

// Heimat-Laendervorwahl eines Tenants fuer die Interpretation nationaler Rufnummern: die
// erste Kandidaten-Nummer (bereits E.164 im Store), deren Vorwahl eine BEKANNTE Wahl-
// Konvention hat (DIALING_HOME_COUNTRY_CODES = Trunk-0-Laender + NANP, s.o.) - NUR dort
// laesst sich eine nationale Schreibweise ueberhaupt korrekt aufloesen (Gegenbeispiel +39
// IT, s.o.). Kandidaten in Praezedenz beim Aufrufer (private Mobilnummer = die "SIM" des
// Nutzers vor eigener DID - die DID kann in einem anderen Land liegen als der Nutzer,
// z.B. US-DID eines DE-Tenants). Kein Treffer/leer -> null (Aufrufer normalisiert dann
// NICHT, das E164-Gate lehnt ab - ablehnen statt raten).
//
// tenantCountryIso (ISO-3166-1-alpha-2, aus store.tenantGeo) ist der GUARD fuer den
// NANP-Zweig (Review-Fix Runde 2, GAP-25): eine Kandidatennummer, die zufaellig NANP-
// foermig ist (haeufigster Fall - eine DID OHNE eigene privateNumber; DIDs sind heute per
// FORCE_NUMBER_COUNTRY default US), darf NUR dann als Heimatland gelten, wenn das
// TENANT-Herkunftsland selbst NANP ist. Sonst wuerde JEDER europaeische Tenant ohne
// privateNumber ueber seine US-DID zum NANP-Heimatland (der Fund aus Runde 1: eine
// deutsche Ortsnetznummer ohne fuehrende 0 waere dann als formal gueltige +1-Nummer
// materialisiert worden - genau der neue Fremdanruf-Pfad, den diese Funktion verhindern
// soll). Trunk-0-Laender (+49/+33/+44) bleiben UNGUARDED: ihre Kandidaten-Herkunft war
// nie das Sicherheitsproblem (nur der NANP-Zweig oeffnete den neuen Pfad). Ein nicht
// bestaetigter NANP-Kandidat wird uebersprungen (naechster Kandidat gewinnt), nicht die
// ganze Suche abgebrochen.
export function homeCountryCode(candidateNumbers, tenantCountryIso = null) {
  for (const num of candidateNumbers) {
    if (typeof num !== "string") continue;
    const code = DIALING_HOME_COUNTRY_CODES.find((c) => num.startsWith(c));
    if (!code) continue;
    if (code === NANP_COUNTRY_CODE && !isNanpCountry(tenantCountryIso)) continue;
    return code;
  }
  return null;
}

// Internationale Verkehrsausscheidungsziffern "00" (ITU-Standard in allen
// TRUNK_ZERO_COUNTRY_CODES-Laendern): "0049..." ist die Wahl-Schreibweise von "+49...".
const INTERNATIONAL_CALL_PREFIX = "00";

// NANP-Zweig: "00..." ist die ITU-Auslandsvorwahl (unzweideutig - "00" ist in KEINER
// NANP-Schreibweise ein gueltiges Praefix, NPA/NXX beginnen nie mit 0, s.
// NANP_NSN_PATTERN), "011..." die NANP-EIGENE Auslandsvorwahl, "1"+10 Ziffern die
// nationale Schreibweise, 10 blanke Ziffern die Teilnehmernummer. "00" wird VOR "011"
// geprueft (dieselbe Reihenfolge wie im Trunk-0-Zweig) - Review-Fix Runde 1 (GAP-25):
// ein NANP-Heimatland (z.B. eine europaeische Tenant-DID ohne privateNumber, die zufaellig
// eine US-Nummer ist) darf eine ITU-Wahl ("0049...") nicht mehr ablehnen, nur weil die
// DID zufaellig NANP ist - das war vor diesem Fix eine Regression gegen den Trunk-0-Pfad.
// normNum vorweg, weil die NANP-Schreibweise ueblicherweise Trennzeichen traegt
// ("1-415-555-0123"); normNum ist idempotent - der Produktionspfad
// (routes/api-calls.js normNum(b.to)) aendert sich dadurch nicht (G5: dieselbe eine
// Quelle, kein zweites Regex).
function normalizeNanpTarget(raw) {
  const num = normNum(raw);
  if (num.startsWith("+")) return num;
  if (num.startsWith(INTERNATIONAL_CALL_PREFIX))
    return "+" + num.slice(INTERNATIONAL_CALL_PREFIX.length);
  if (num.startsWith(NANP_INTERNATIONAL_PREFIX))
    return "+" + num.slice(NANP_INTERNATIONAL_PREFIX.length);
  if (!/^\d+$/.test(num)) return num;
  // Review-Fix Runde 1 (GAP-25): NPA/NXX-Plausibilitaet PRUEFEN statt raten - eine
  // 10-stellige Eingabe, die keine gueltige NANP-Teilnehmernummer sein kann (z.B. eine
  // deutsche Ortsnetznummer ohne fuehrende 0), bleibt unveraendert -> das E164-Gate
  // lehnt ab (400), statt eine formal gueltige, aber falsche +1-Nummer zu erfinden.
  if (num.length === NANP_NATIONAL_DIGITS && num.startsWith(NANP_TRUNK_PREFIX)) {
    const nsn = num.slice(NANP_TRUNK_PREFIX.length);
    return NANP_NSN_PATTERN.test(nsn) ? "+" + num : num;
  }
  if (num.length === NANP_NSN_DIGITS) return NANP_NSN_PATTERN.test(num) ? NANP_COUNTRY_CODE + num : num;
  return num; // unbekannte Form -> unveraendert, das E164-Gate lehnt ab (ablehnen statt raten)
}

// Trunk-0-Zweig (Bestandsverhalten, byte-identisch bis auf die "011"-Ausnahme).
function normalizeTrunkZeroTarget(num, homeCountry) {
  if (num.startsWith(INTERNATIONAL_CALL_PREFIX))
    return "+" + num.slice(INTERNATIONAL_CALL_PREFIX.length);
  if (
    num.startsWith(NANP_INTERNATIONAL_PREFIX) &&
    NO_NATIONAL_ELEVEN_RANGE_COUNTRIES.includes(homeCountry)
  )
    return num; // GAP-25: keine Inlandsnummer aus einer NANP-Auslandswahl erfinden
  if (num.startsWith(NATIONAL_TRUNK_PREFIX) && homeCountry)
    return homeCountry + num.slice(NATIONAL_TRUNK_PREFIX.length);
  return num;
}

// Deterministische Normalisierung eines Wahl-Ziels nach Telefon-Konvention (Wurzelfix
// LLM-Ziffern-Regeneration: der MCP-Client reicht die Nutzer-Eingabe zeichengenau durch,
// JEDE Umformung passiert hier in Code statt im Modell). Erwartet normNum-Form (Ausnahme:
// der NANP-Zweig normalisiert selbst, s.o.). KEINE Validierung hier: das nachgelagerte
// E164-/Trunk-0-Gate lehnt ab (fail-closed). Reihenfolge im Trunk-0-Zweig ist die
// Spezifikation: "00" (ITU) gewinnt vor der "011"-Ausnahme, sonst wuerde "0011..." falsch
// klassifiziert.
export function normalizeDialTarget(num, homeCountry) {
  if (typeof num !== "string") return "";
  if (homeCountry === NANP_COUNTRY_CODE) return normalizeNanpTarget(num);
  return normalizeTrunkZeroTarget(num, homeCountry);
}

// P8/FMT-11: der strenge Bestands-Default des Summary-SMS-Gates. Als benannte Konstante
// (G25) statt zweier Literal-Kopien - countryAllowed UND die Land-Herleitung unten
// teilen ihn.
const DEFAULT_PRIVATE_NUMBER_CODES = Object.freeze(["+49"]);

// ISO-3166-1-alpha-2 -> E.164-Laendervorwahl fuer die Laender, in denen Hermes heute
// Kunden hat (identische Menge wie LANGUAGE_FOR_COUNTRY in i18n/locales.js; NANP laeuft
// ueber isNanpCountry, s.u.). BEWUSST keine Weltliste: ein unbekanntes Land faellt auf
// den strengen Bestands-Default zurueck, statt das Gate still zu oeffnen.
const CALLING_CODE_FOR_COUNTRY = Object.freeze({
  DE: "+49", AT: "+43", CH: "+41", FR: "+33", GB: "+44", IE: "+353",
});

// Erlaubte E.164-Praefixe der privaten Summary-Nummer EINES Tenants (Toll-Fraud-Gate H1).
// Das Gate BLEIBT eine Allowlist - landabhaengig ist ausschliesslich die HERLEITUNG des
// erlaubten Praefixes aus dem Tenant-Land, nie die Existenz des Gates (P8-Gegenmassnahme 2).
// Unbekanntes/fehlendes Land -> DEFAULT_PRIVATE_NUMBER_CODES (fail-closed, byte-identisch
// zum Bestand). isNanpCountry ist die EINE Quelle fuer die 25 NANP-Mitgliedslaender (G5).
export function allowedPrivateNumberCodes(countryIso) {
  const cc = String(countryIso || "").toUpperCase();
  if (isNanpCountry(cc)) return [NANP_COUNTRY_CODE];
  const code = CALLING_CODE_FOR_COUNTRY[cc];
  return code ? [code] : DEFAULT_PRIVATE_NUMBER_CODES;
}

// Laendercode-Gate fuer die private Summary-Nummer (F2, Toll-Fraud-Schutz H1). Reines
// Praefix-Praedikat: erlaubt nur Nummern, deren E.164-Praefix in allowedCodes liegt.
// Default DEFAULT_PRIVATE_NUMBER_CODES - BEWUSST strenger als das globale Call-Gate
// (+49,+33,+44): die Summary-SMS soll eng sein (jede gesendete SMS kostet uns). "*" hebt
// das Gate auf. Erwartet eine bereits normalisierte (normNum) E.164-Nummer; Nicht-String/
// leer -> false (fail-closed). Spiegelt die Praefix-Logik von server.js matchesPrefix
// bewusst, bleibt hier aber unabhaengig (eigener, strengerer Default; kein Import aus dem
// Route-Layer).
export function countryAllowed(e164, allowedCodes = DEFAULT_PRIVATE_NUMBER_CODES) {
  if (typeof e164 !== "string" || !e164) return false;
  return allowedCodes.includes("*") || allowedCodes.some((c) => e164.startsWith(c));
}

// Whitelist gegen PROFILE_FIELDS (Key + Typ). Unbekannte Keys / falsche Typen
// werden verworfen. allowedNumbers wird wie eine Nummern-Liste normalisiert (normNum-Schema),
// damit der Gate-Vergleich gegen E.164 trifft; Laendercodes nur getrimmt.
export function sanitizeProfile(patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch || {})) {
    const type = PROFILE_FIELDS[key];
    if (!type) continue;
    if (type === "string[]") {
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        clean[key] =
          key === "allowedNumbers"
            ? value.map(normNum).filter(Boolean)
            : value.map((c) => c.trim()).filter(Boolean);
      }
    } else if (type === "number?") {
      // Nullable Zahl: null ist eine VALIDE Belegung (kein pro-Nutzer-Limit -> globaler
      // Cap), NICHT verwerfen (sonst A11, s. PROFILE_FIELDS). Nicht-Zahl/Nicht-null faellt
      // wie bisher raus (profiles.test.js "viele" -> verworfen bleibt gruen).
      if (value === null || typeof value === "number") clean[key] = value;
    } else if (typeof value === type) {
      clean[key] = value;
    }
  }
  return clean;
}

// Default-Profil: KEIN Outbound (0 = harter Block, fail-closed fuer profillose Nutzer).
// 0 ist eine echte Schwelle, kein Falsy-"kein Limit": tenantHourReached rechnet
// limit=min(config,0)=0, count>=0 ist immer wahr (telephony/outbound-gates). Nur ein Plan-Profil
// (A2/A3, maxCallsPerHour=null) ODER der Owner (OWNER_PROFILE) schaltet Outbound frei.
const DEFAULT_PROFILE_MAX_CALLS_PER_HOUR = 0;

// Owner-Profil: gilt fuer den Bootstrap-Tenant (resolveProfileFrom matcht tenantId ===
// BOOTSTRAP_TENANT_ID). Das Profil lockert nichts (unrestricted=false, leere Profil-
// Allowlist) - der Owner passiert das Verifikations-Gate ueber Pfad 2 (aktiver Subscriber
// via Boot-Seed, outbound-p1/p3), keine Profil-Senkung des Stundenlimits
// (maxCallsPerHour=null -> effektiv der Pro-Tenant-Default), Kalender/Booking erlaubt.
// So wird der Owner NIE per Stundenlimit
// gesperrt (R2) - hart auf OWNER_PROFILE gepinnt; ein etwaiges s.profiles[BOOTSTRAP] wird
// bewusst ignoriert.
const OWNER_PROFILE = {
  allowedNumbers: [],
  allowedCountryCodes: [],
  unrestricted: false,
  allowCalendar: true,
  allowBooking: true,
  maxCallsPerHour: null,
};

// Default = authentifiziert, aber (noch) ohne Profil: fail-closed/restriktiv.
// Keine Allowlist-Lockerung, KEIN Outbound (maxCallsPerHour=0), kein Kalender/Booking.
const DEFAULT_PROFILE = {
  allowedNumbers: [],
  allowedCountryCodes: [],
  unrestricted: false,
  allowCalendar: false,
  allowBooking: false,
  maxCallsPerHour: DEFAULT_PROFILE_MAX_CALLS_PER_HOUR,
};

// Effektives Profil aus einer tenantId + dem gespeicherten Profil (oder undefined).
// tenantId === BOOTSTRAP_TENANT_ID -> Owner (hart auf OWNER_PROFILE gepinnt, nie gesperrt,
// R2). Andere tenantId mit gespeichertem Profil -> ueber DEFAULT gemerged (fehlende Felder
// fallen restriktiv zurueck). tenantId ohne Profil ODER leer/null/"reject" -> DEFAULT (kein
// Falsy-Kollaps auf Owner mehr - exakte BOOTSTRAP-Gleichheit statt !tenantId, Sec1). Reine
// Merge-Logik, vom Storage entkoppelt: der Aufrufer reicht den gespeicherten Datensatz herein.
export function resolveProfileFrom(tenantId, storedProfile) {
  if (tenantId === BOOTSTRAP_TENANT_ID) return { ...OWNER_PROFILE }; // R2: Owner nie gesperrt
  return storedProfile ? { ...DEFAULT_PROFILE, ...storedProfile } : { ...DEFAULT_PROFILE };
}
