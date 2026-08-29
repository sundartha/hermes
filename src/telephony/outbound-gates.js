// Outbound-Gate-Kette (P6, Struct-1): die komplette Sicherheits-/Geld-Pruefung, die JEDER
// Outbound-Call (POST /api/calls) durchlaufen muss, BEVOR gewaehlt wird. Extrahiert aus
// server.js (verhaltens-erhaltender Refactor) - die Reihenfolge war vorher implizit durch
// die Reihenfolge der if-Bloecke im Handler; jetzt ist sie EXPLIZIT ein geordnetes Array
// (G31/G27: Struktur statt Konvention/Disziplin) - eine Umsortierung bricht bewusst den
// Snapshot-Test (test/outbound-gates-order.test.js), statt still zu bleiben.
//
// Vertrag pro Gate: { name, run(ctx) } - run liefert entweder null (naechstes Gate) oder ein
// Denial { status, body, audit }. audit ist null bei reinen 400-Formatfehlern (keine
// Sicherheits-Ablehnung, kein Audit-Log-Eintrag), sonst { event, detail } fuer den Aufrufer.
// Manche Gates lehnen NIE ab, sondern reichern nur ctx an (Derivations-Gates: resolve_identity,
// normalize_target, resolve_profile, compute_reserve - der Name sagt es, N7: Nebeneffekte
// sind im Namen sichtbar). ctx ist der EINE Transportweg zwischen den Gates
// (normalisiertes to, aufgeloester Tenant, Absendernummer, Reserve-Betrag...).
//
// INVARIANTE ABSENDER-HERKUNFT (GAP-19): eine fremdlaendische Absender-Herkunft ist NIE
// stumm. Entweder der Betreiber hat sie erklaert (FORCE_NUMBER_COUNTRY gesetzt) - dann
// meldet der Boot sie bei JEDEM Start (src/boot.js) - oder sie ist unerklaert, dann lehnt
// resolve_outbound den INLANDSANRUF unter fremder Kennung ab. Genau eine der beiden
// Sicherungen ist damit immer aktiv; beide lesen dasselbe Praedikat (numberOriginDecoupled).
//
// PRE-MORTEM (haerteste Invariante hier): `reserve_budget` ist das LETZTE Gate. Alles, was
// NACH der Schleife im Aufrufer laeuft, dialt und kostet Geld - kein Gate darf hinter
// reserve_budget einsortiert werden, sonst reserviert die Kette Budget fuer einen Call, der
// danach noch abgelehnt werden koennte (Geld waere blockiert, aber nie abgerechnet/freigegeben
// bis der Backstop-Timer greift). reserve_budget behaelt seinen eigenen try/catch: ein
// Store-Throw wird IMMER zum Denial (402), NIE zu reserviertem Budget, NIE zu einem unhandled
// reject (fail-closed, Absolute Regel 1).
//
// FRUEHWARNUNG (Budget-Achsen P6): NACH einer ERFOLGREICHEN Reservierung meldet
// reserve_budget - GENAU EINMAL pro Spend-Monat - dass die Plattform-Summe eine
// konfigurierbare Schwelle ueberschritten hat (Audit + optionale SMS an den Betreiber).
// TRIFFT KEINE ENTSCHEIDUNG und AENDERT KEIN Gate: der Call ist zu diesem Zeitpunkt
// bereits erlaubt. Absolut fail-soft (s. emitPlatformSpendWarning unten) - ein Fehler auf
// diesem Pfad darf niemals einen Anruf kosten.
import { config as defaultConfig } from "../config.js";
import {
  BOOTSTRAP_TENANT_ID,
  KYC_OUTBOUND_MIN,
  countryForE164,
  hasTrunkZeroAfterCountryCode,
  homeCountryCode,
  normalizeDialTarget,
  eurText,
  spendMonthEndDate,
  outboundReserveCents,
} from "../store/defaults.js";
import { emergencyBrakeSeconds } from "../call-duration.js";
import { findActiveNumber } from "../store/views.js";
import { openOutageAlert } from "../store/state-ops.js";
import { DRIFT_BEFUND } from "./outbound-config-drift.js";
import { befundBucket } from "./outbound-drift-watch.js";
import { sendFailSoftAlertSms } from "./alert-sms.js";
import { E164, invalidText, validateAssistantContext, validateMandate } from "../routes/_validation.js";
import { findPlan } from "../plans.js";
import { resolvePeriodStartIso } from "../billing/period.js";
import { includedMinutesFor } from "../billing/plan-caps.js";
import { deniedPrefix, isDenied } from "./number-denylist.js";
import { localeFor } from "../i18n/locales.js";

const HOUR_MS = 60 * 60 * 1000;
// OUTBOUND-E4: eigener Statuscode fuer den ANI-Riegel (503 = Dienst voruebergehend nicht
// verfuegbar - passender als 403/402, die bereits andere Gate-Gruende belegen).
const HTTP_SERVICE_UNAVAILABLE = 503;

// EXPORT: drei Ausgabestellen - der Pre-Gate-Check in routes/api-calls.js, das Gate
// trunk_zero_normalized und der Format-Zweig in numberGateError.
//
// SYSTEMGRENZE (P15b/C1, Owner-Entscheidung 2026-07-26): dieser Text ist EINSPRACHIG
// ENGLISCH und folgt NICHT der Tenant-Sprache. Ein reiner Eingabe-/Formatfehler ist ein
// Vertragsfehler der API-Kante, keine Nutzeransprache - dieselbe Denkweise wie O14
// (Modellsprache != Nutzersprache). Er gehoert deshalb NICHT ins Locale-Buendel
// (LOCALES.<lang>.gates). ALLE drei Stellen benutzen DIESELBE Konstante, auch der
// Format-Zweig in numberGateError, wo ein tenantId in Reichweite waere: die
// Sprachfreiheit haengt an der FEHLERKLASSE, nicht am Zufall des Aufrufpfads - eine
// Meldung, die je nach Pfad die Sprache wechselt, waere zwei Meldungen fuer denselben
// Fehler. Feldname und Beispielnummer bleiben stehen (Hinweiswert).
// Beides gepinnt in test/p15-gate-denial-language.test.js.
export const E164_FORMAT_ERROR = "'to' must be E.164, e.g. +4917212345678";

// ---- Plattform-Fruehwarnung (Budget-Achsen P6) ------------------------------------
// Eigenes Ereignis + eigener SMS-Praefix. Eine Warnung ist keine Ablehnung und aendert
// keine Gate-Entscheidung (s. reserve_budget-Gate unten). Seit KS-P9/E10 ist sie die
// EINZIGE Wirkung der Plattform-Achse - einen Plattform-Notaus gibt es nicht mehr.
const PLATFORM_WARN_EVENT = "platform_spend_warning";
const PLATFORM_WARN_SMS_PREFIX = "[Hermes] Plattform-Warnschwelle erreicht: ";

// EINE Fehlersenke (G5): der synchrone catch UND der Promise-catch in
// emitPlatformSpendWarning loggen dieselbe Zeile. Secret-frei (nur e.message), NIE die
// Zielnummer.
const logWarningFailure = (e) => console.error(`[${PLATFORM_WARN_EVENT}]`, e.message);

// Audit-Detail = die EINE Faktenquelle, aus der auch der SMS-Body gebaut wird (G5).
// AUSSCHLIESSLICH Summen-Cents + Monatsschluessel: KEINE tenantId, kein to, keine
// requestedBy. Die Plattform-Summe ist eine Betreiber-Groesse; eine tenantId daneben
// waere ein Cross-Tenant-Leck (Absolute Regel 4/6, wie beim Plattform-Notaus-Text).
const warningDetail = (w) => `summe_cents=${w.totalCents} monat=${w.monthKey}`;

// Audit-Ereignis jeder Outbound-Ablehnung. EINE Konstante statt elf Literalen (G25).
const PLACE_CALL_DENIED_EVENT = "place_call_denied";

// EINE Bauform fuer das Audit-Objekt einer Ablehnung (G5). Der Ablehnungsgrund steht
// genau EINMAL im Code und erscheint zweimal: im Bestands-Detailtext (Wortlaut
// byte-identisch, von test/outbound-gates-order.test.js + deny-diagnosability.test.js
// gepinnt) UND als eigenes, maschinenlesbares Feld, aus dem der Aufrufer das PII-freie
// Denial-Ereignis baut (GAP-35). Struktur statt Konvention (G27): ein auditierter Deny
// laesst sich gar nicht mehr ohne grund bauen. detailSuffix ist der bereits formatierte
// Rest der Bestandszeile (tenant=/requestedBy=) - er variiert je Gate und bleibt deshalb
// an der Aufrufstelle sichtbar.
const denialAudit = (grund, ctx, detailSuffix = "") => ({
  event: PLACE_CALL_DENIED_EVENT,
  grund,
  detail: `to=${ctx.to} grund=${grund}${detailSuffix}`,
});

const matchesPrefix = (to, codes) => codes.includes("*") || codes.some((c) => to.startsWith(c));
const hourWindowStart = () => new Date(Date.now() - HOUR_MS).toISOString();

// EXPORT (server.js: erster Pre-Gate-400-Check am ROHEN to, VOR jedem Gate). Rein. C4-
// Formfehler: Trunk-0 nach erlaubter Laendervorwahl (z.B. +4901737... statt +491737...) wird
// abgewiesen (REJECT statt kanonisieren - laenderspezifisches Korruptions-/Falschanruf-Risiko,
// z.B. +39 IT behaelt die fuehrende 0). !isDenied(to) WAHRT die Denylist-Praezedenz: eine
// gesperrte Nummer auch in Trunk-0-Schreibweise bleibt 403 denylist (auditiert), kein Kippen
// auf 400.
export const isTrunkZeroFormatError = (to) => !isDenied(to) && hasTrunkZeroAfterCountryCode(to);

// Traegt eine Nummer diese Vorwahl? Nicht-String (fehlende Herkunft aus einer DB-Zeile)
// -> nein. Das ist die EINE fail-closed-Kante der Kosten-Achse (P5/ORIG-01): wer keine
// Herkunft liefert, bekommt kein Inland. EXPORT, weil der Drift-Waechter
// (billing/cost-calibration.js) dieselbe Praefix-Frage stellt und sie nicht zweitfassen soll.
export const hasCountryPrefix = (number, prefix) =>
  typeof number === "string" && number.startsWith(prefix);

// Die getroffene Inlands-Vorwahl dieser Nummer, sonst null. Liefert den TREFFER statt
// true/false (Muster deniedPrefix): "Inland" heisst DIESELBE Vorwahl an beiden Enden, dafuer
// braucht es den Wert. BEWUSST NICHT matchesPrefix: das kennt die "*"-Wildcard des
// Land-Gates - mit ALLOWED_COUNTRY_CODES="*" (Live-Zustand) waere sonst jedes Ziel weltweit
// "Inland" und damit 20 statt 30 ct/min.
function domesticPrefixOf(number) {
  return defaultConfig.billing.voiceTariffDomesticPrefixes.find((p) => hasCountryPrefix(number, p)) ?? null;
}

// Hat der Betreiber das Kauf-Land bewusst vom Herkunftsland entkoppelt (FORCE_NUMBER_COUNTRY)?
// EINE Quelle fuer beide Haelften von GAP-19 (G5): das Herkunfts-Gate unten wertet sie als
// Betriebs-Ack und laesst fremde Absender-Herkunft passieren, der Boot-Guard (src/boot.js)
// meldet dieselbe Konstellation bei JEDEM Start. Genau eine der beiden Sicherungen ist damit
// immer aktiv - stumm ist die Konstellation nie.
export const numberOriginDecoupled = (provisioning) => Boolean(provisioning.forceNumberCountry);

// GAP-19: ein INLANDSANRUF des Tenants, gefuehrt unter einer DID aus einem anderen Land -
// genau die Konstellation, die Zustellrate und Rufnummern-Reputation kostet. Die beiden
// Seiten sind bewusst ASYMMETRISCH:
//   Ziel     - nur ein POSITIV abgeleitetes Land begruendet ueberhaupt einen Inlandsanruf.
//              countryForE164 liefert fuer +1 bewusst null (25 NANP-Laender teilen die
//              Vorwahl) -> kein Urteil, kein Raten.
//   Absender - muss seine Zugehoerigkeit zu genau diesem Land BEWEISEN; nicht ableitbar
//              (fremde/ungueltige Vorwahl) zaehlt als fremd (fail-closed).
// Kein bekanntes Tenant-Herkunftsland -> kein Urteil: ein Anruf, von dem niemand weiss, ob er
// ein Inlandsanruf ist, wird nicht abgelehnt.
function foreignOriginOnHomeCall({ to, fromNumber, tenantCountry }) {
  const targetCountry = countryForE164(to);
  if (!targetCountry || targetCountry !== String(tenantCountry || "").toUpperCase()) return false;
  return countryForE164(fromNumber) !== targetCountry;
}

// Herkunfts-Achse (P5, ORIG-01/02): ein Leg ist nur INLAND, wenn Ziel UND Absender dieselbe
// bekannte Inlands-Vorwahl tragen. Verschiedene Laender -> Ausland; ein Land OHNE gemessenen
// Inlandssatz (z.B. +1) -> ebenfalls Ausland, denn der guenstige Satz ist fuer +49/+33/+44
// erhoben, nicht fuer "irgendwo gleich" (O6: der Pauschalwert greift nur, wo kein echter
// Satz ermittelbar ist).
export function isDomesticLeg(to, from) {
  const toPrefix = domesticPrefixOf(to);
  return toPrefix !== null && toPrefix === domesticPrefixOf(from);
}

// Worst-Case-Minutentarif (GANZZAHL Cents/min) EINES Legs (outbound-p1c + P5, Kosten-Achse).
// EINE Kosten-Quelle (G5): Vorab-Reservierung, Budget-Reconcile UND Stripe-Voice-Meter.
// from ist PFLICHT ohne Default (zwei Positionsstellen, Function.length === 2): ein
// vergessener Aufrufer faellt beim Lesen auf, und zur Laufzeit greift der fail-closed-Weg
// ueber hasCountryPrefix - fehlende Herkunft ergibt den TEUERSTEN Satz, nie den Inlandssatz.
// Ein Fehler erzeugt damit sichtbare Ueberbepreisung, nie stillen Verlust.
// to ist an der Aufrufstelle bereits E.164-validiert (numberGateError). Liest das
// config-Singleton (defaultConfig) - in Produktion dasselbe Objekt wie das in die Factory
// injizierte config.
export function tariffCentsPerMin(to, from) {
  return isDomesticLeg(to, from)
    ? defaultConfig.billing.voiceTariffDomesticCents
    : defaultConfig.billing.voiceTariffDefaultCents;
}

// Loest die Frist DIESES Legs (Sekunden) aus der guthaben-abgeleiteten Notbremse
// (brakeSeconds, s. emergencyBrakeSeconds) und dem optionalen, UNVALIDIERTEN Body-Override
// auf. KS-P3 (b): der Body kann die Frist nur noch VERKUERZEN, nie verlaengern - ein Client
// kann sich keine Zeit erkaufen, die sein Guthaben nicht traegt. Die frueheren Fallback-
// Stufen (config-Default MAX_CALL_DURATION_S, Hard-Default) sind mit E2/E3 entfallen: eine
// feste Maximaldauer gibt es nicht mehr.
//
// Der S1-6 Wurzelfix bleibt inhaltlich erhalten: geprueft wird endlich UND strikt positiv,
// nicht bloss truthy (negative Zahlen sind in JS truthy - -300 rutschte frueher bis zu einer
// NEGATIVEN Reserve durch). 0/negativ/NaN/Muell -> die Notbremse.
//
// brakeSeconds ist bereits durch MAX_CALL_DURATION_CAP_S gedeckelt; ein zweites Math.min
// hierauf waere eine Duplizierung derselben Klemme (G5).
export function resolveMaxDurationS(raw, brakeSeconds) {
  const requested = parseInt(raw, 10);
  return Number.isFinite(requested) && requested > 0 ? Math.min(requested, brakeSeconds) : brakeSeconds;
}

// Sollstaerke der Gate-Kette (18 Glieder). Seit OUTBOUND-E4 mit dem neuen Glied
// ani_ownership. Erzwungen statt zugesichert (G27, OUT-14): weicht die gebaute Kette
// hiervon ab, wirft die Fabrik beim Bau - jeder Testlauf und jeder Boot faellt sofort auf,
// statt dass Kommentar und Wirklichkeit lautlos auseinanderlaufen (die alte Zaehlung stand
// lange falsch im Code). Die Zahl steht bewusst NUR hier.
const GATE_CHAIN_LENGTH = 18;

// OUTBOUND-E4: derselbe Bucket-Name wie der Drift-Waechter (outbound-drift-watch.js#
// befundBucket(DRIFT_BEFUND.OWNERSHIP_LOST)) - EINE Quelle (G5), damit der Riegel und der
// Waechter niemals unterschiedliche Marker-Namen lesen/schreiben.
const ANI_OWNERSHIP_BUCKET = befundBucket(DRIFT_BEFUND.OWNERSHIP_LOST);

// Reine Frische-Frage (Muster meldeErlaubt/outage-detection.js): kein/kein gueltiger
// Zeitstempel -> NICHT frisch (fail-open bei Unwissen - der Riegel gated nie auf einer
// Zeile, deren Alter er nicht kennt).
function frischGenug(lastSeenAtIso, maxAgeMs) {
  const ms = Date.parse(lastSeenAtIso || "");
  if (Number.isNaN(ms)) return false;
  return Date.now() - ms <= maxAgeMs;
}

// OUTBOUND-E4: der ANI-Riegel als EIGENSTAENDIGE Fabrik statt eines Inline-Objekts in
// makeOutboundGates (Blocker-Vermeidungsliste 3, Clean-Code): makeOutboundGates ist eine
// bereits gepinnte Altlast (eslint-suppressions.json, max-lines-per-function) - ein neues
// Glied INLINE haette den Pin weiter angehoben. Extrahiert haelt der Pin, statt ihn
// still zu bewegen. Eigene, hier lokale Denial-Form ({status, body, audit}) - dieselbe
// Form wie der dortige deny()-Helfer, hier direkt als Objektliteral statt ueber dessen
// Closure. denialAudit ist bereits modulweit definiert (s.o.), keine zweite Quelle.
//
// Er lehnt NUR ab, wenn ALLES zutrifft:
//   (1) OUTBOUND_ANI_GATE_ENABLED=true,
//   (2) es gibt eine OFFENE, durable ownership_lost-Messung,
//   (3) sie ist FRISCH (<= OUTBOUND_ANI_GATE_MAX_AGE_MS) - auf plan:free steht der
//       Prozess still, und eine fast stundenalte Messung darf keinen Anruf ablehnen,
//       obwohl der Eigentuemer vor drei Minuten eine neue DID gekauft hat,
//   (4) eine LIVE-NACHMESSUNG (derselbe GET wie Pruefung 3, eigener kurzer Timeout)
//       bestaetigt den Verlust.
// Jede Unsicherheit laesst DURCH (fail-open bei Unwissen): keine Messung, alte Messung,
// unknown, Nachmessung scheitert (auch ein Wurf, im try/catch abgefangen - Fail-open ist
// eine Eigenschaft DES GATES, nicht eine Disziplin des Aufrufers) -> der Anruf laeuft.
// Ein falsch-positives Gate schaltet das Produkt ab (PM-2); ein verbrannter Waehlversuch
// kostet Cent. OUTBOUND_FROZEN wird hier NIE geschrieben - der Notaus bleibt beim
// Eigentuemer. Sitzt in der Kette HINTER resolve_outbound (braucht ctx.fromNumber), VOR
// budget (ein Anruf, der sicher scheitert, soll keine Reserve binden).
function makeAniOwnershipGate({ config, store, aniOwnershipRecheck }) {
  return {
    name: "ani_ownership",
    async run(ctx) {
      if (!config.safety.outboundAniGateEnabled) return null;
      const marker = openOutageAlert(store.load(), ANI_OWNERSHIP_BUCKET);
      if (!marker || !frischGenug(marker.lastSeenAt, config.safety.outboundAniGateMaxAgeMs)) return null;
      // Blocker 2 (Review Runde 2): die Nachmessung muss die PLATTFORM-ANI treffen -
      // exakt die Nummer, die Pruefung 3 misst (N_ani = outbound.ani_override der
      // FQDN-Connection) und die der Marker drift:ownership_lost meint. ctx.fromNumber
      // ist die EIGENE aktive DID des ANRUFENDEN Tenants - eine andere Nummer, die im
      // realen Fall weiterhin dem Konto gehoert und den Riegel dadurch wirkungslos
      // machte (false-negativ) oder umgekehrt einen unbeteiligten Anruf haette ablehnen
      // koennen (false-positiv auf einer fremden Nummer).
      let nochImmerVerloren;
      try {
        nochImmerVerloren = await aniOwnershipRecheck(config.provisioning.platformAniE164);
      } catch {
        nochImmerVerloren = null;
      }
      if (nochImmerVerloren !== true) return null; // null/false -> durchlassen
      return {
        status: HTTP_SERVICE_UNAVAILABLE,
        body: { error: "Die Absendernummer der Plattform ist beim Anbieter nicht mehr verfuegbar. Der Anruf wurde nicht gestartet." },
        audit: denialAudit("ani_not_owned", ctx, ` tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`),
      };
    },
  };
}

// Fabrik: baut die geordnete Gate-Kette einmal beim Boot (P15, wie makeTenantResolver) -
// gebunden an store/config und die Tenant-Identitaets-Bausteine des Aufrufers (requestTenant/
// internalIdentity/OWNER_ID/TENANT_REJECT - EINE Quelle, kein zweiter Resolver, G5/DIP).
// aniOwnershipRecheck (OUTBOUND-E4): Default-No-op = Bestandsverhalten BYTE-IDENTISCH,
// wenn server.js nichts injiziert (das Gate liest den Riegel ohnehin nur bei
// OUTBOUND_ANI_GATE_ENABLED=true UND einer frischen Messung - der No-op laesst dann
// trotzdem durch, fail-open bei Unwissen).
export function makeOutboundGates({
  store,
  config = defaultConfig,
  requestTenant,
  internalIdentity,
  OWNER_ID,
  TENANT_REJECT,
  audit,
  messaging, aniOwnershipRecheck = async () => null,
}) {
  // Land-Gate: Schnittmenge global ∩ profil. Ein Profil kann nur WEITER einschraenken,
  // nie ueber die globale Erlaubnis hinaus (Profil "*"/leer = keine Zusatz-Einschraenkung).
  function countryGateAllowed(to, profile) {
    if (!matchesPrefix(to, config.safety.allowedCountryCodes)) return false;
    const p = profile.allowedCountryCodes;
    return !p || !p.length || matchesPrefix(to, p);
  }

  // Cooldown-Fensterstart fuer den per-(Tenant,Ziel)-Cap (outbound-p1d). Eigenes Fenster
  // (config.safety.perTargetWindowMs) - das Stundenlimit unten nutzt hourWindowStart.
  const perTargetWindowStart = () =>
    new Date(Date.now() - config.safety.perTargetWindowMs).toISOString();
  // Stundenlimit PRO TENANT - die EINZIGE Stunden-Achse (O5, PLAN-I18N-FIX P6). Eine
  // plattformweite Stundenbremse gibt es NICHT mehr: sie ist ersatzlos entfallen, weil ein
  // globales Anruflimit mit wachsender Tenant-Zahl jeden zusaetzlichen Kunden zum Gegner
  // aller anderen macht. Verbleibender Not-Aus fuer die Plattform ist OUTBOUND_FROZEN; die
  // GELD-Achse ist seit KS-P9/E10 aus demselben Grund EINE Achse (die pro-Tenant-Decke).
  // Gezaehlt wird nach tenantId, nicht nach requestedBy: ein Tenant kann sein Limit sonst
  // durch zusaetzliche Nutzer-Identitaeten vervielfachen (der Tausch ist strikt strenger).
  // Grenze = min(config, profil): MAX_CALLS_PER_HOUR ist Pro-Tenant-DEFAULT *und* Decke -
  // ein Profil kann nur senken; maxCallsPerHour:0 bleibt 0 (harter Block).
  function tenantHourReached(profile, tenantId) {
    const limit =
      profile.maxCallsPerHour == null
        ? config.safety.maxCallsPerHour
        : Math.min(config.safety.maxCallsPerHour, profile.maxCallsPerHour);
    return store.countOutboundCallsSince(hourWindowStart(), { tenantId }) >= limit;
  }
  // Per-(Tenant,Ziel)-Wiederhol-Cap (outbound-p1d, D4, Belaestigungs-Bremse, Schutz Dritter):
  // wie oft DIESER Tenant DASSELBE Ziel im Cooldown-Fenster schon angerufen hat; ab dem Cap
  // gesperrt. Zaehlt - wie die Stundenlimits - bewusst auch fehlgeschlagene Calls
  // (konservativ). Cap 0 -> jeder Outbound gesperrt (Not-Aus, wie maxCallsPerHour=0).
  function perTargetCapReached(tenantId, to) {
    return (
      store.countOutboundCallsSince(perTargetWindowStart(), { tenantId, to }) >=
      config.safety.perTargetCallCap
    );
  }

  // Anzeigetexte einer Ablehnung in der Sprache des TENANTS (P15/T2). EINE Aufloesungsregel:
  // store.tenantLanguage (= views.tenantLanguage -> resolveCallLanguage mit der aktiven
  // Nummer als Geo-Anker) - dieselbe Funktion, aus der auch der MCP-Transport
  // (routes/mcp.js) und die Self-Service-Antwort ihre Sprache ziehen; kein zweiter Lookup,
  // kein zweiter Fallback (localeFor faellt fail-safe auf den Weltdefault, R7).
  // Aufgeloest wird ERST, wenn eine Ablehnung feststeht: kein Gate-PRAEDIKAT liest die
  // Sprache, und der erlaubte Anruf zahlt keinen Lookup.
  const gateTexts = (tenantId) => localeFor(store.tenantLanguage(tenantId)).gates;

  // KYC-Gate (P6b4): vor dem ersten Outbound muss der Tenant mindestens KYC_OUTBOUND_MIN
  // (card) erreicht haben. fail-closed - fehlendes kyc_level -> store.kycReached liefert
  // FALSE (403); der Owner passiert, weil seedBootstrapKyc ihn beim Boot auf id_verified
  // heilt. Liefert {status,grund,message} (Gate-Vertrag) oder null.
  function kycGateError(tenantId) {
    if (store.kycReached(tenantId, KYC_OUTBOUND_MIN)) return null;
    return {
      status: 403,
      grund: "kyc",
      message: gateTexts(tenantId).kycInsufficient,
    };
  }

  // Verifikations-Gate (letztes Glied in numberGateError): mehrere Freigabe-Pfade, ALLE
  // optional - schlaegt keiner an, wird fail-closed abgewiesen (outbound-p3: keine statische
  // ALLOWED_NUMBERS mehr). Reihenfolge load-bearing: 0. Defense-in-depth (W5): suspendierter/
  // geschlossener Tenant -> HART 403, VOR jeder Lockerung (ein gueltiges profile.unrestricted
  // hebt das BEWUSST NICHT auf). 1. Admin-Override: profile.unrestricted ODER Ziel in
  // profile.allowedNumbers -> freigegeben. 2. Abo-Kopplung (W5): aktiver, KYC-verifizierter
  // Subscriber -> freigegeben (das Abo IST die Freigabe). 3. Sonst fail-closed Deny. Hebt NUR
  // dieses Gate auf; alle harten Gates davor (Denylist/Land/Limit) liefen schon.
  function allowlistError(to, { profile, tenantId }) {
    if (store.tenantInactive(tenantId))
      return {
        status: 403,
        grund: "abo",
        message: gateTexts(tenantId).subscriptionInactive,
      };
    // O2/GAP-03: Zahlungsbeanstandung sperrt OUTBOUND, laesst Inbound unberuehrt (dieses
    // Gate laeuft nur im Ausgangspfad). Reversibel: ein bestaetigtes aktives Abo loescht
    // den Hold (webhook.js ACTIVATE). Bei payment_action_required greift er erst nach
    // Fristablauf (dueAt), davor ist es nur Warnung + Audit (billingHoldActive liest die
    // Frist lazy gegen die Uhr, s. state-ops.js).
    const hold = store.billingHoldActive(tenantId);
    if (hold)
      return {
        status: 403,
        grund: "billing_hold",
        message: gateTexts(tenantId).billingHold,
      };
    if (profile.unrestricted) return null;
    if (profile.allowedNumbers?.includes(to)) return null;
    if (store.tenantActiveSubscriber(tenantId, KYC_OUTBOUND_MIN)) return null;
    return {
      status: 403,
      grund: "allowlist",
      message: gateTexts(tenantId).notAuthorized,
    };
  }

  // Minuten-Kontingent-Gate-Praedikat (B2, GAP B): hat der Request-Tenant die im laufenden
  // Abrechnungsfenster inkludierten Plan-Minuten aufgebraucht? NEUES PARALLELES Glied NEBEN
  // budgetExceeded - eigene Achse (Minuten-Ledger, kein Doppelzaehlen mit der EUR-Achse).
  // Reiner Read, kein Nebeneffekt. Fail-closed: kein Plan ODER kein aufloesbarer
  // Periodenanker -> planMinutesExceeded liefert true (blocken).
  function planMinutesExhausted(tenantId) {
    const sub = store.tenantSubscription(tenantId);
    const plan = sub.planSlug ? findPlan(sub.planSlug) : null;
    return store.planMinutesExceeded(tenantId, {
      // GAP-03: nach einer Rueckerstattung (periodCreditRevoked) ist das Guthaben der
      // laufenden Periode 0 - EINE Quelle mit der Anzeige (meter.js quotaView).
      includedMinutes: includedMinutesFor({ plan, subscription: sub }),
      periodStartIso: resolvePeriodStartIso(sub),
    });
  }

  // Liefert {status, grund, message} fuer das erste verletzte Gate, sonst null. Feste
  // Pruefreihenfolge: Denylist -> E.164 -> Laender-Gate -> Pro-Stunde-Limit (pro Tenant)
  // -> Pro-Ziel-Cap -> Verifikations-Gate. Die Denylist laeuft BEWUSST vor der
  // Formatpruefung: so erscheint eine Notruf-Kurzwahl (112) als bewusste Sperre (403
  // denylist), nicht als Formatfehler (400). caller = { profile, tenantId }: profile
  // steuert die Land-Schnittmenge und senkt das Stundenlimit, tenantId traegt das
  // Stundenlimit selbst, die Abo-Kopplung, den per-(Tenant,Ziel)-Cap UND den
  // Defense-in-depth-Block im Allowlist-Gate.
  function numberGateError(to, caller) {
    const { profile, tenantId } = caller;
    const denied = deniedPrefix(to);
    if (denied)
      return {
        status: 403,
        grund: "denylist",
        praefix: denied,
        message: gateTexts(tenantId).deniedNumber(to),
      };
    if (!E164.test(to)) return { status: 400, grund: "format", message: E164_FORMAT_ERROR };
    if (!countryGateAllowed(to, profile))
      return {
        status: 403,
        grund: "land",
        message: gateTexts(tenantId).countryBlocked(to),
      };
    // Ein Ablehnungstext nennt NIE einen internen Env-Namen (Regel-4-Nachbarschaft): der
    // Anrufer erfaehrt die Sperre, nicht die Konfigurationsflaeche. Der Blattwert bleibt
    // im Audit-Log (grund=stundenlimit) forensisch nachvollziehbar.
    if (tenantHourReached(profile, tenantId))
      return {
        status: 429,
        grund: "stundenlimit",
        message: gateTexts(tenantId).hourLimit,
      };
    if (perTargetCapReached(tenantId, to))
      return {
        status: 429,
        grund: "ziel_limit",
        message: gateTexts(tenantId).perTargetLimit,
      };
    return allowlistError(to, caller);
  }

  // Absendernummer + Provider fuer den Outbound EINES Tenants (I7, L4). JEDER Tenant - auch
  // der Owner (Tenant Null) - telefoniert NUR unter EIGENER aktiver Nummer (e164 + provider
  // aus s.numbers); kein config-Sonderzweig mehr. Keine aktive eigene Nummer -> null ->
  // Reject, NIE die Nummer eines anderen Tenants als Fallback (Toll-Fraud-Riegel).
  // numberRecord wird mitgegeben: der Geo-Anker der eigenen aktiven Nummer (F1 Phase 8) ist
  // die Quelle der Outbound-Gespraechssprache (number.language) in der Praezedenz-Aufloesung.
  function outboundFrom(s, tenantId) {
    const own = findActiveNumber(s, tenantId);
    return own ? { fromNumber: own.e164, provider: own.provider, numberRecord: own } : null;
  }

  // Liefert {status,grund,message} fuer das Herkunfts-Gate oder null (Vertrag wie
  // kycGateError). Der Text ist EINSPRACHIG ENGLISCH - dieselbe Systemgrenze wie
  // E164_FORMAT_ERROR (P15b/C1): eine Fehlkonfiguration der eigenen Absenderflaeche ist
  // keine Nutzeransprache, sie folgt deshalb nicht der Tenant-Sprache.
  function originGateError(ctx) {
    if (numberOriginDecoupled(config.provisioning)) return null;
    const foreign = foreignOriginOnHomeCall({
      to: ctx.to,
      fromNumber: ctx.fromNumber,
      tenantCountry: store.tenantGeo(ctx.tenantId).country,
    });
    if (!foreign) return null;
    return {
      status: 403,
      grund: "herkunft",
      message:
        "Outbound blocked: the active number of this tenant is not registered in the destination country.",
    };
  }

  // Ablehnungsgrund + -text der TENANT-Achse im budget-Gate (Bucket lesbar -> eigene Decke
  // + eigener Verbrauch; unbuchbar (D7) -> ziffernfreier Sperrtext budgetUnreadable: "NaN EUR"
  // waere eine Falschauskunft auf einer Geld-Kante). EIGENE Zahlen, NIE eine
  // Plattform-Groesse - die waere ein Cross-Tenant-Leck (Absolute Regel 4/6).
  function tenantBudgetDenial(tenantId) {
    const snapshot = store.tenantBudgetSnapshot(tenantId, config.billing);
    const texts = gateTexts(tenantId);
    if (snapshot.spentCents === null)
      return { grund: "budget_tenant", message: texts.budgetUnreadable };
    return {
      grund: "budget_tenant",
      message: texts.budgetCapReached(eurText(snapshot.spentCents), eurText(snapshot.capCents)),
    };
  }

  // EINE Quelle (G5) fuer die ZIFFERNFREIE Reserve-Ablehnung: Grund bleibt
  // reserve_erschoepft (kein dritter Grund fuer denselben Sperrzustand), der Text nennt
  // keine Zahl - "NaN EUR" waere eine Falschauskunft auf einer Geld-Kante.
  const reserveUnreadableDenial = (tenantId) => ({
    grund: "reserve_erschoepft",
    message: gateTexts(tenantId).budgetUnreadable,
  });

  // Ablehnungsgrund + -text der TENANT-Achse im reserve_budget-Gate: Fehlbetrag (EINE
  // Formel fuer beide Reserve-Gruende: reserveCents - remainingCents) + Spend-Monat-Ende
  // als Fakt (KEINE Reset-Zusage, P4-Achse ist vor P7 nicht die Gate-Quelle). Bucket
  // unbuchbar (D7) -> ziffernfreier Sperrtext ueber reserveUnreadableDenial.
  function tenantReserveDenial(tenantId, reserveCents) {
    const snapshot = store.tenantBudgetSnapshot(tenantId, config.billing);
    const texts = gateTexts(tenantId);
    if (snapshot.remainingCents === null) return reserveUnreadableDenial(tenantId);
    const missingEur = eurText(reserveCents - snapshot.remainingCents);
    const monthEnd = spendMonthEndDate(Date.now());
    if (snapshot.remainingCents > 0)
      return {
        grund: "reserve_ueber_rest",
        message: texts.reserveOverRemaining(missingEur, monthEnd),
      };
    return {
      grund: "reserve_erschoepft",
      message: texts.reserveExhausted(missingEur, monthEnd),
    };
  }

  // SAFETY-KERN: eigener try/catch. Wuerde der Claim in den try/catch des Gates fallen,
  // machte ein Throw hier aus einem BEREITS RESERVIERTEN Call ein 402 - die Reserve waere
  // gebucht und bliebe bis zum Backstop-Timer haengen. Eine Warnung darf nie ablehnen.
  function claimSpendWarning() {
    try {
      return store.claimPlatformSpendWarning(config.billing, new Date().toISOString());
    } catch (e) {
      logWarningFailure(e);
      return null;
    }
  }

  // Klassifiziert das Ergebnis von tryReserveOutboundBudget, OHNE eine zweite Entscheidung
  // zu treffen: tryReserveOutboundBudget bleibt die EINZIGE Quelle des Ja/Nein (reserved).
  // Laeuft im selben withStoreLock-Callback wie die Entscheidung (reserve_budget-Gate
  // unten) und bleibt REIN SYNCHRON (Lock-Invariante des Moduls, s. Modul-Doc oben).
  // Nach KS-P9 lehnt tryReserveOutboundBudget aus GENAU ZWEI Gruenden ab: die Tenant-Decke
  // (reserveExceedsBudget - reine Query, KEIN zweiter Reserve-Versuch) oder ein unbuchbarer
  // Reserve-Betrag (isBookableCents-Riegel, S1-6). Der zweite Fall darf keine Zahl nennen.
  function reserveOutcome(ctx) {
    const reserved = store.tryReserveOutboundBudget(ctx.tenantId, ctx.reserveCents, config.billing);
    if (reserved) return { reserved: true, warning: claimSpendWarning() };
    if (store.reserveExceedsBudget(ctx.tenantId, ctx.reserveCents, config.billing))
      return { reserved: false, ...tenantReserveDenial(ctx.tenantId, ctx.reserveCents) };
    return { reserved: false, ...reserveUnreadableDenial(ctx.tenantId) };
  }

  // Fruehwarnung melden (Budget-Achsen P6). TRIFFT KEINE ENTSCHEIDUNG: der Call ist hier
  // bereits erlaubt UND reserviert. Der Versand selbst liegt in sendFailSoftAlertSms
  // (src/telephony/alert-sms.js) - EIN fail-soft-Baustein fuer beide Alarm-Kanaele (G5);
  // die dortigen drei Fail-soft-Zusagen gelten unveraendert fuer diesen Pfad. Der Claim
  // haengt in seinem eigenen try/catch (s. claimSpendWarning). audit(event, null, detail)
  // -> ip=system: ein Plattform-Ereignis ist keinem Request zuzurechnen (Muster
  // sms_summary_skipped). Absender ist die Nummer, ueber die dieser Call laeuft - sie
  // steht im Gate-Kontext bereits fest, deshalb ein reiner ctx-Lesezugriff statt Lookup.
  // Der eigene try/catch bleibt und deckt AUSSCHLIESSLICH audit()+warningDetail(): der
  // Versand kann seit der Extraktion nicht mehr werfen, audit() schon - und ein Throw hier
  // machte aus einem BEREITS RESERVIERTEN Call ein 402 (dieselbe Begruendung wie bei
  // claimSpendWarning). Eine Warnung darf nie ablehnen.
  function emitPlatformSpendWarning(warning, ctx) {
    let detail;
    try {
      detail = warningDetail(warning);
      audit(PLATFORM_WARN_EVENT, null, detail);
    } catch (e) {
      logWarningFailure(e);
      return; // ohne belastbares detail keine SMS
    }
    sendFailSoftAlertSms({
      messaging,
      to: config.billing.platformAlertSmsTo,
      body: PLATFORM_WARN_SMS_PREFIX + detail,
      resolveSender: () => ({ provider: ctx.outboundProvider, e164: ctx.fromNumber }),
      onError: logWarningFailure,
    });
  }

  // Einheitliche Denial-Form (G5): audit === null bei reinen 400-Formatfehlern (keine
  // Sicherheits-Ablehnung, kein Audit-Log-Eintrag) - wie bisher bei to/objective-Pruefung,
  // Trunk-0-Formfehler, Text-/Kontext-Validierung. Sonst { event, detail } fuer den
  // Aufrufer-seitigen audit()-Call. F1 (<=3 Argumente): event+detail reisen IMMER zusammen
  // (ein audit()-Aufruf braucht beide oder keins) -> EIN audit-Objekt statt zwei Args.
  const deny = (status, body, audit = null) => ({ status, body, audit });

  // KS-P3 (b): die Notbremse dieses Legs aus dem AKTUELLEN Restguthaben. Die Rechenregel
  // selbst liegt in call-duration.js (EINE Quelle, G5) - hier werden nur ihre zwei
  // Eingaben beschafft. Gelesen wird DERSELBE Snapshot wie in tenantReserveDenial:
  // Ablehnungstext, Anzeige und Frist rechnen damit strukturell auf einer Achse (KS-P4).
  // Der Snapshot enthaelt die Reserve DIESES Calls noch nicht (compute_reserve laeuft vor
  // reserve_budget) - richtig so, die Frist beschreibt, was dieser Call ausgeben darf.
  function brakeSecondsFor(tenantId, tariffCents) {
    return emergencyBrakeSeconds({
      remainingCents: store.tenantBudgetSnapshot(tenantId, config.billing).remainingCents,
      tariffCentsPerMin: tariffCents,
    });
  }

  // Die geordnete Gate-Kette (Sollstaerke: GATE_CHAIN_LENGTH, unten erzwungen). Reihenfolge
  // load-bearing, per Snapshot-Test
  // (test/outbound-gates-order.test.js) festgenagelt. reserve_budget bleibt LETZTES Gate
  // (s. Modul-Doc, Pre-Mortem).
  const gates = [
    // OUTBOUND_FROZEN (outbound-p3): globaler Kill-Switch, ganz vorn + fail-closed. "true"
    // friert JEDEN Outbound sofort (403, kein Originate, kein Bypass) - Betriebs-Notbremse.
    // VOR der Tenant-Aufloesung, damit auch unbekannte Identitaeten erfasst sind. Audit ohne
    // requestedBy (Identitaet hier bewusst noch nicht aufgeloest).
    {
      name: "outbound_frozen",
      run(ctx) {
        if (!config.safety.outboundFrozen) return null;
        return deny(
          403,
          { error: "Outbound-Anrufe sind derzeit gesperrt (OUTBOUND_FROZEN)." },
          denialAudit("frozen", ctx),
        );
      },
    },
    // Derivations-Gate (mutiert ctx, lehnt nie ab): Identitaet serverseitig (nur localhost-
    // Header), nie aus dem Body. null = Owner. requestedBy bleibt die Identitaet (Audit/
    // Forensik, entkoppelt vom Rechteprofil, das auf tenantId keyt).
    {
      name: "resolve_identity",
      run(ctx) {
        const identity = internalIdentity(ctx.req);
        ctx.requestedBy = identity || OWNER_ID;
        ctx.tenantId = requestTenant(ctx.req);
        return null;
      },
    },
    // Tenant-Achse fail-closed: VORHANDENE, aber unbekannte Identitaet -> Reject, NIE Owner
    // (Asymmetrie zu resolveProfile). Ohne gueltigen Tenant darf gar kein Outbound entstehen.
    {
      name: "tenant_reject",
      run(ctx) {
        if (ctx.tenantId !== TENANT_REJECT) return null;
        return deny(
          403,
          { error: "Kein Tenant fuer diese Identitaet." },
          denialAudit("tenant_unbekannt", ctx, ` requestedBy=${ctx.requestedBy}`),
        );
      },
    },
    // Derivations-Gate: nationale Schreibweise wird HIER deterministisch aufgeloest, NICHT im
    // MCP-Client (das Chat-Modell reicht die Nutzer-Eingabe zeichengenau durch - jede LLM-
    // Umformung kann Ziffern erfinden). Telefon-Konvention: fuehrende 0 = Heimatland des
    // Tenants (private Mobilnummer als "SIM" vor eigener DID); "00" -> "+"; "+" unveraendert.
    // Kein ableitbares Heimatland -> unveraendert -> das folgende Gate liefert den E.164-400.
    // Ab hier sehen ALLE Gates, Audits und der Dial dieselbe normalisierte Nummer
    // ("geprueft == gewaehlt").
    {
      name: "normalize_target",
      run(ctx) {
        // GAP-25 Review-Fix Runde 2: der NANP-Zweig von homeCountryCode braucht das
        // TENANT-Herkunftsland (store.tenantGeo, dieselbe Quelle wie denialDimensions in
        // routes/api-calls.js, G5) als Guard - ohne ihn wuerde eine europaeische DID-
        // Zufalls-NANP-Nummer (DIDs sind heute default US, privateNumber ist optional)
        // jeden Tenant zum NANP-Heimatland machen.
        const homeCountry = homeCountryCode(
          [store.tenantPrivateNumber(ctx.tenantId), findActiveNumber(store.load(), ctx.tenantId)?.e164],
          store.tenantGeo(ctx.tenantId).country,
        );
        ctx.to = normalizeDialTarget(ctx.to, homeCountry);
        return null;
      },
    },
    // Die 00->+-Regel kann Trunk-0-Formfehler neu materialisieren ("00490173..." ->
    // "+490173...") - dasselbe C4-Praedikat wie der Pre-Gate-Check am rohen to, auf dem
    // NORMALISIERTEN Ergebnis. 400 = reiner Eingabefehler, kein Audit.
    {
      name: "trunk_zero_normalized",
      run(ctx) {
        if (!isTrunkZeroFormatError(ctx.to)) return null;
        return deny(400, { error: E164_FORMAT_ERROR });
      },
    },
    // KYC-Gate als erstes Glied der eigentlichen Sicherheits-Gate-Kette: Tenant-Reifegrad VOR
    // den Ziel-Gates.
    {
      name: "kyc",
      run(ctx) {
        const e = kycGateError(ctx.tenantId);
        if (!e) return null;
        return deny(
          e.status,
          { error: e.message },
          denialAudit(e.grund, ctx, ` tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`),
        );
      },
    },
    // Identitaets-Gate (G1): ohne registrierten Auftraggeber-Namen KEIN Outbound (sonst
    // renderte die Offenlegung "...von ."). Fail-closed, hier am Producer (NIE in
    // /voice/outbound, Premature-close-Schutz). tenantContext zieht ownerName aus dem Tenant
    // (kein config-Fallback) -> leer, solange der Tenant keinen ownerName im Store gesetzt hat.
    {
      name: "owner_name",
      run(ctx) {
        ctx.ownerName = store.tenantContext(ctx.tenantId).ownerName;
        if (ctx.ownerName) return null;
        return deny(
          403,
          { error: "Kein registrierter Auftraggeber-Name fuer diesen Tenant." },
          denialAudit("keine_identitaet", ctx, ` tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`),
        );
      },
    },
    // Derivations-Gate: Rechteprofil tenant-gekeyt, aufgeloest NACH dem TENANT_REJECT-Check,
    // direkt vor dem ersten Gebrauch (numberGateError). tenantId === BOOTSTRAP ->
    // OWNER_PROFILE, sonst stored-or-DEFAULT (fail-closed). identity/requestedBy bleiben fuer
    // Audit entkoppelt vom Rechteprofil.
    {
      name: "resolve_profile",
      run(ctx) {
        ctx.profile = store.resolveProfile(ctx.tenantId);
        return null;
      },
    },
    // Nummern-Gates VOR der Freitext-Validierung: gesperrte/ungueltige Ziele zuerst abweisen.
    // 400 (Formatfehler) bleibt unauditiert - nur echte Sicherheits-Ablehnungen (403/429)
    // landen im Audit-Log, OHNE tenant= im Detail (Bestandswortlaut).
    {
      name: "number_gate",
      run(ctx) {
        const e = numberGateError(ctx.to, { profile: ctx.profile, tenantId: ctx.tenantId });
        if (!e) return null;
        if (e.status === 400) return deny(400, { error: e.message });
        // GAP-18: die getroffene Sperr-Range steht im Audit (Plan: "Grund + Praefix"),
        // damit eine Ueberblockierung ganzer NPAs forensisch auffaellt. Nur beim
        // Denylist-Gate gesetzt -> alle uebrigen Detailzeilen bleiben byte-identisch.
        const praefix = e.praefix ? ` praefix=${e.praefix}` : "";
        return deny(
          e.status,
          { error: e.message },
          denialAudit(e.grund, ctx, `${praefix} requestedBy=${ctx.requestedBy}`),
        );
      },
    },
    // Freitext-Validierung (E164/Nummern-Gates liefen schon). 400 = reiner Eingabefehler,
    // kein Audit.
    {
      name: "valid_text",
      run(ctx) {
        const err =
          invalidText("objective", ctx.objective) ||
          invalidText("briefing", ctx.b.briefing) ||
          invalidText("constraints", ctx.b.constraints);
        if (!err) return null;
        return deny(400, { error: err });
      },
    },
    // P6 (Mandat statt Rueckfrage): optionales Vorab-Mandat, DIESELBE Naht wie die
    // objective/briefing-Validierung - NACH allen Sicherheits-Gates, 400 = reiner
    // Eingabefehler, kein Audit. Kein Flag: fehlt das Feld, bleibt ctx.mandate null und
    // der Prompt byte-identisch. Das Mandat erlaubt NUR muendliche Zusagen im vom Owner
    // gesetzten Rahmen; es oeffnet keinen Kalender-/Buchungspfad (E1) und beruehrt kein
    // Sicherheits-Gate.
    {
      name: "valid_mandate",
      run(ctx) {
        const r = validateMandate(ctx.b.mandate);
        if (r.error) return deny(400, { error: r.error });
        ctx.mandate = r.value;
        return null;
      },
    },
    // P3 (PLAN-PERSONAL-ASSISTANT): optionaler strukturierter Per-Call-Kontext, DIESELBE Naht
    // wie die objective/briefing-Validierung (NACH allen Sicherheits-Gates). Hinter dem Flag
    // (Default aus -> ctx.context bleibt null, /api/calls byte-identisch). Der Kontext speist
    // KEINE Identitaetsgroesse (Anti-Spoofing): er landet nur als HINTERGRUND-Sektion im
    // systemPrompt, nie in Offenlegung/Persona.
    {
      name: "assistant_context",
      run(ctx) {
        ctx.context = null;
        if (!config.tenancy.assistantContextEnabled) return null;
        const r = validateAssistantContext(ctx.b.context);
        if (r.error) return deny(400, { error: r.error });
        ctx.context = r.value;
        return null;
      },
    },
    // Absendernummer + Provider tenant-aware (Toll-Fraud-Riegel R3): JEDER Tenant - auch der
    // Owner - telefoniert nur unter EIGENER aktiver Store-Nummer; keine -> Reject, NIE die
    // Nummer eines anderen Tenants als Fallback. Das Glied prueft die aufgeloeste
    // Absendernummer zusaetzlich auf Tauglichkeit fuer DIESES Ziel (GAP-19, s. Modul-Doc).
    {
      name: "resolve_outbound",
      run(ctx) {
        const o = outboundFrom(store.load(), ctx.tenantId);
        if (!o) {
          return deny(
            403,
            { error: "Kein aktive Absendernummer fuer diesen Tenant." },
            denialAudit("keine_tenant_nummer", ctx, ` tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`),
          );
        }
        ctx.fromNumber = o.fromNumber;
        ctx.outboundProvider = o.provider;
        ctx.numberRecord = o.numberRecord;
        // GAP-19: die aufgeloeste Absendernummer wird gegen das Ziel geprueft, BEVOR gewaehlt
        // wird. Erst hier steht die Herkunft fest (number_gate laeuft vorher, ohne Absender).
        // ctx ist zu diesem Zeitpunkt bereits vollstaendig befuellt - eine Ablehnung darf die
        // Derivation nicht verschlucken (Forensik/Audit des Aufrufers liest ctx.fromNumber).
        const originError = originGateError(ctx);
        if (!originError) return null;
        return deny(
          originError.status,
          { error: originError.message },
          denialAudit(originError.grund, ctx, ` tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`),
        );
      },
    // OUTBOUND-E4: der ANI-Riegel - das EINZIGE Gate dieser Etappe, Default AUS. Fabrik
    // ausgelagert (makeAniOwnershipGate, oben) statt inline, damit diese bereits gepinnte
    // Altlast-Funktion (max-lines-per-function) durch das neue Glied NICHT weiter waechst
    // (Blocker-Vermeidungsliste 3). Volle Begruendung dort.
    }, makeAniOwnershipGate({ config, store, aniOwnershipRecheck }),
    // EINE Geld-Achse (KS-P9/E10): die pro-Tenant-Kostendecke, fail-closed. Die
    // Plattform-Achse misst und warnt nur noch, sie sperrt nicht mehr - kein Kunde wird
    // abgewiesen, weil ein anderer Geld ausgab. Der Nutzer bekommt damit IMMER die eigenen
    // Zahlen, auf die er reagieren kann; eine Plattform-Groesse erreicht ihn nie.
    {
      name: "budget",
      run(ctx) {
        if (!store.budgetExceeded(ctx.tenantId, config.billing)) return null;
        const { grund, message } = tenantBudgetDenial(ctx.tenantId);
        return deny(402, { error: message }, denialAudit(grund, ctx, ` tenant=${ctx.tenantId}`));
      },
    },
    // Minuten-Kontingent-Gate (B2, GAP B): SEPARATES Gate NEBEN dem Budget-Gate (eigenes
    // audit grund=minutes), NIE in die Budget-Pruefung gefaltet (getrennte Achsen). Hinter
    // config.billing.paymentEnabled (aus -> No-Op, byte-identisch). Owner/Bootstrap ausgenommen, VOR
    // der "kein Plan -> blocken"-Regel. Inbound bleibt ungated: die Minuten-Erschoepfung
    // deckelt nur den aktiven, teuren Outbound.
    {
      name: "minutes",
      run(ctx) {
        if (
          !config.billing.paymentEnabled ||
          ctx.tenantId === BOOTSTRAP_TENANT_ID ||
          !planMinutesExhausted(ctx.tenantId)
        )
          return null;
        return deny(
          402,
          {
            error:
              "Inkludierte Plan-Minuten aufgebraucht. Bitte Tarif anpassen oder neue Abrechnungsperiode abwarten.",
          },
          denialAudit("minutes", ctx, ` tenant=${ctx.tenantId}`),
        );
      },
    },
    // Derivations-Gate mit ZWEI seit KS-P3 (a) UNABHAENGIGEN Ableitungen fuer das folgende
    // reserve_budget-Gate:
    //   Reserve-Betrag - Worst-Case-Satz * festes Vorlauffenster (outboundReserveCents).
    //     Deckt nur noch die Zeit bis zum ersten Live-Zaehler-Griff und die Gleichzeitigkeit
    //     mehrerer Legs, NICHT mehr die Gespraechsdauer.
    //   Max-Dauer      - die guthaben-abgeleitete Notbremse, vom Body-Override hoechstens
    //     verkuerzt (resolveMaxDurationS).
    // Herkunft = die aktive Absender-DID aus resolve_outbound (steht in der Kette VOR diesem
    // Gate und lehnt ohne aktive Tenant-Nummer mit 403 ab).
    // Dieses Gate LIEST seit KS-P3 den Store (Guthaben-Snapshot fuer die Notbremse), lehnt
    // aber weiterhin NIE ab - die Geld-Entscheidung bleibt allein bei reserve_budget.
    {
      name: "compute_reserve",
      run(ctx) {
        const tariffCents = tariffCentsPerMin(ctx.to, ctx.fromNumber);
        ctx.reserveCents = outboundReserveCents(tariffCents);
        ctx.maxDur = resolveMaxDurationS(ctx.b.max_duration_s, brakeSecondsFor(ctx.tenantId, tariffCents));
        return null;
      },
    },
    // LETZTES Gate (s. Modul-Doc, Pre-Mortem). OUT-05 (F2): Check+Reserve ATOMAR unter
    // store.withStoreLock (Schnittmenge Tenant+global) VOR dem Dial. INVARIANTE: der
    // Lock-Body ist REIN SYNCHRON - NIE ein Netz-await hierhinein. fail-closed: JEDER
    // Body-Throw (z.B. json-IO) gilt als Denial (402), NIE als reserviert, und darf keinen
    // unhandled reject erzeugen. reserveOutcome (Achsen-Klassifizierung, P5a) laeuft IM
    // selben Lock-Callback wie tryReserveOutboundBudget selbst: der Ablehnungstext
    // beschreibt exakt den Zustand, auf dem die Entscheidung beruht - ein Nachlesen NACH
    // dem Lock haette eine fremde, zwischenzeitliche Freigabe schon sehen koennen.
    {
      name: "reserve_budget",
      async run(ctx) {
        let outcome;
        try {
          outcome = await store.withStoreLock(() => reserveOutcome(ctx));
        } catch (e) {
          console.error(`[place_call] reserve fehlgeschlagen tenant=${ctx.tenantId}:`, e.message); // secret-frei
          return deny(
            402,
            { error: "Reservierung fehlgeschlagen. Bitte erneut versuchen." },
            denialAudit("reserve_error", ctx, ` tenant=${ctx.tenantId}`),
          );
        }
        if (outcome.reserved) {
          if (outcome.warning) emitPlatformSpendWarning(outcome.warning, ctx);
          return null;
        }
        return deny(
          402,
          { error: outcome.message },
          denialAudit(outcome.grund, ctx, ` tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`),
        );
      },
    },
  ];

  if (gates.length !== GATE_CHAIN_LENGTH)
    throw new Error(
      `Outbound-Gate-Kette: ${gates.length} Glieder gebaut, erwartet ${GATE_CHAIN_LENGTH} - ` +
        "Kette und Sollstaerke (GATE_CHAIN_LENGTH) sind auseinandergelaufen.",
    );

  return { gates };
}
