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
// normalize_target, resolve_profile, resolve_outbound, compute_reserve - der Name sagt es,
// N7: Nebeneffekte sind im Namen sichtbar). ctx ist der EINE Transportweg zwischen den Gates
// (normalisiertes to, aufgeloester Tenant, Absendernummer, Reserve-Betrag...).
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
  hasTrunkZeroAfterCountryCode,
  homeCountryCode,
  normalizeDialTarget,
  eurText,
  spendMonthEndDate,
  DEFAULT_CALL_DURATION_S,
  MAX_CALL_DURATION_CAP_S,
} from "../store/defaults.js";
import { findActiveNumber } from "../store/views.js";
import { sendFailSoftAlertSms } from "./alert-sms.js";
import { E164, invalidText, validateAssistantContext, validateMandate } from "../routes/_validation.js";
import { findPlan } from "../plans.js";
import { resolvePeriodStartIso } from "../billing/period.js";

// Hardcoded (kein Env, nicht abschaltbar): Notruf-Kurzwahlen exakt (sonst wuerde "112" auch
// legitime Nummern als Prefix treffen), Premium-/Service-Prefixe per startsWith. Eng gefasst,
// damit normale Mobilnummern (+4915...) durchkommen.
const EMERGENCY_SHORT_CODES = ["110", "112", "911", "999"];
// Globale Best-effort-IRSF-Blockliste (outbound-p1b): die hoechsten Premium-/Satelliten-/
// IPRN-Risiko-Ziele weltweit. BEWUSST unvollstaendig - bei weltweiter Reichweite ('*',
// Phase 4) ist sie Beifang, NICHT der Hauptschutz (Hauptschutz = Kosten-Achse/Pre-Auth,
// Phase 1c). Strikt SUB-Ranges (Premium/Service/Satellit/IPRN), NIE ganze Laendercodes -
// eine gewoehnliche US-/ES-/DE-Mobilnummer muss durchkommen. Periodisch gegen eine
// gepflegte IRSF-Quelle aktualisieren. Quelle/Zweck je Gruppe im Kommentar.
const PREMIUM_PREFIXES = [
  // Satellit (Inmarsat / globale Mobil-Satellit) - sehr hohe Minutenpreise, IRSF-Liebling
  "+870",
  "+881",
  "+882",
  "+883",
  // IPRN (International Premium Rate Numbers)
  "+979",
  // DE Premium/Service: 0900 (Premium, kurz + lang), 0137 (Televoting), 0180 (Shared-Cost),
  // 0118 (Auskunft), 0700 (persoenliche Rufnummer, Restschuld)
  "+49900",
  "+490900",
  "+49137",
  "+49180",
  "+49118",
  "+49700",
  // UK Premium/Service: 118 (Directory Enquiries), 070 (Personal/Follow-me), 09 (Premium),
  // 084x/087x (Service)
  "+44118",
  "+4470",
  "+449",
  "+44843",
  "+44844",
  "+44845",
  "+44870",
  "+44871",
  // FR Premium/Service: 118 (Auskunft), 089x (audiotel/SVA Premium), 081x/082x (Service)
  "+33118",
  "+33899",
  "+33892",
  "+33810",
  "+33820",
];
const HOUR_MS = 60 * 60 * 1000;
const SECONDS_PER_MINUTE = 60;

// EXPORT (server.js Pre-Gate-Check + numberGateError-Format-Branch nutzen ihn).
export const E164_FORMAT_ERROR = "to muss E.164 sein, z.B. +4917212345678";

// ---- Ablehnungstexte nach Achse getrennt (P5a) -----------------------------------
// Der Plattform-Notaus ist eine BETREIBER-Groesse: die Meldung benennt ihn, nennt aber
// NIE eine Zahl - weder den Cap noch die Summe ueber fremde Tenants. Eine Plattform-Zahl
// in einer Tenant-Antwort waere ein Cross-Tenant-Leck (Absolute Regel 4/6). KONSTANTE
// statt Template: der String kann per Konstruktion keinen Wert interpolieren.
const PLATFORM_DENIAL = "Plattform-Notaus aktiv, bitte Betreiber kontaktieren.";
const PLATFORM_DENIAL_REASON = "budget_platform";
// Unlesbarer Verbrauchsstand (D7): die EIGENE Achse sperrt, aber es wird KEINE Zahl
// gerendert - "NaN EUR" waere eine Falschauskunft auf einer Geld-Kante.
const TENANT_UNREADABLE_DENIAL =
  "Dein Budget ist gesperrt: der Verbrauchsstand ist nicht lesbar. Bitte Betreiber kontaktieren.";

// Fruehwarnung (Budget-Achsen P6): eigenes Ereignis + eigener SMS-Praefix, GETRENNT von
// PLATFORM_DENIAL/PLATFORM_DENIAL_REASON oben - eine Warnung ist keine Ablehnung und
// aendert keine Gate-Entscheidung (s. reserve_budget-Gate unten).
const PLATFORM_WARN_EVENT = "platform_spend_warning";
const PLATFORM_WARN_SMS_PREFIX = "[Hermes] Plattform-Warnschwelle erreicht: ";

// EINE Fehlersenke (G5): der synchrone catch UND der Promise-catch in
// emitPlatformSpendWarning loggen dieselbe Zeile. Secret-frei (nur e.message), NIE die
// Zielnummer.
const logWarningFailure = (e) => console.error(`[${PLATFORM_WARN_EVENT}]`, e.message);

// Audit-Detail = die EINE Faktenquelle, aus der auch der SMS-Body gebaut wird (G5).
// AUSSCHLIESSLICH Summen-Cents + Monatsschluessel: KEINE tenantId, kein to, keine
// requestedBy. Die Plattform-Summe ist eine Betreiber-Groesse; eine tenantId daneben
// waere ein Cross-Tenant-Leck (Absolute Regel 4/6, wie PLATFORM_DENIAL).
const warningDetail = (w) => `summe_cents=${w.totalCents} monat=${w.monthKey}`;

const isDenied = (to) =>
  EMERGENCY_SHORT_CODES.includes(to) || PREMIUM_PREFIXES.some((p) => to.startsWith(p));
const matchesPrefix = (to, codes) => codes.includes("*") || codes.some((c) => to.startsWith(c));
const hourWindowStart = () => new Date(Date.now() - HOUR_MS).toISOString();

// EXPORT (server.js: erster Pre-Gate-400-Check am ROHEN to, VOR jedem Gate). Rein. C4-
// Formfehler: Trunk-0 nach erlaubter Laendervorwahl (z.B. +4901737... statt +491737...) wird
// abgewiesen (REJECT statt kanonisieren - laenderspezifisches Korruptions-/Falschanruf-Risiko,
// z.B. +39 IT behaelt die fuehrende 0). !isDenied(to) WAHRT die Denylist-Praezedenz: eine
// gesperrte Nummer auch in Trunk-0-Schreibweise bleibt 403 denylist (auditiert), kein Kippen
// auf 400.
export const isTrunkZeroFormatError = (to) => !isDenied(to) && hasTrunkZeroAfterCountryCode(to);

// Worst-Case-Minutentarif (GANZZAHL Cents/min) des Ziels (outbound-p1c, Kosten-Achse).
// EINE Kosten-Quelle (G5): Vorab-Reservierung, Budget-Reconcile UND Stripe-Voice-Meter.
// Inlands-Vorwahl -> guenstiger Inlandstarif, alles andere -> Worst-Case-Default. to ist an
// der Aufrufstelle bereits E.164-validiert (numberGateError). Prefix-Match wie matchesPrefix.
// Liest das config-Singleton (defaultConfig) - in Produktion dasselbe Objekt wie das in
// die Factory injizierte config; der Reserve-Betrag wird im Unit-Test nicht asserted.
export function tariffCentsPerMin(to) {
  return defaultConfig.billing.voiceTariffDomesticPrefixes.some((p) => to.startsWith(p))
    ? defaultConfig.billing.voiceTariffDomesticCents
    : defaultConfig.billing.voiceTariffDefaultCents;
}

// S1-6 Wurzelfix: loest die Max-Gespraechsdauer (Sekunden) aus dem optionalen, UNVALIDIERTEN
// Body-Override auf: erster endlich-UND-strikt-positiver Kandidat aus [Body, config-Default,
// Hard-Default], dann hart auf MAX_CALL_DURATION_CAP_S geklemmt. Ersetzt den `parseInt(raw||def,10)
// || DEFAULT`-Trap, der nur 0/null/NaN abfing (negative Zahlen sind in JS truthy: -300 rutschte
// bis zu einer NEGATIVEN Reserve durch). chosen ist immer >0 (DEFAULT_CALL_DURATION_S als Boden)
// -> Math.min nie NaN.
export function resolveMaxDurationS(raw, cfg) {
  const chosen = [parseInt(raw, 10), cfg.safety.maxCallDurationS, DEFAULT_CALL_DURATION_S].find(
    (v) => Number.isFinite(v) && v > 0,
  );
  return Math.min(chosen, MAX_CALL_DURATION_CAP_S);
}

// Fabrik: baut die geordnete Gate-Kette einmal beim Boot (P15, wie makeTenantResolver) -
// gebunden an store/config und die Tenant-Identitaets-Bausteine des Aufrufers (requestTenant/
// internalIdentity/OWNER_ID/TENANT_REJECT - EINE Quelle, kein zweiter Resolver, G5/DIP).
export function makeOutboundGates({
  store,
  config = defaultConfig,
  requestTenant,
  internalIdentity,
  OWNER_ID,
  TENANT_REJECT,
  audit,
  messaging,
}) {
  // Land-Gate: Schnittmenge global ∩ profil. Ein Profil kann nur WEITER einschraenken,
  // nie ueber die globale Erlaubnis hinaus (Profil "*"/leer = keine Zusatz-Einschraenkung).
  function countryGateAllowed(to, profile) {
    if (!matchesPrefix(to, config.safety.allowedCountryCodes)) return false;
    const p = profile.allowedCountryCodes;
    return !p || !p.length || matchesPrefix(to, p);
  }

  // Cooldown-Fensterstart fuer den per-(Tenant,Ziel)-Cap (outbound-p1d). Eigenes Fenster
  // (config.safety.perTargetWindowMs) - die Stundenlimits unten nutzen hourWindowStart.
  const perTargetWindowStart = () =>
    new Date(Date.now() - config.safety.perTargetWindowMs).toISOString();
  // Globales Stundenlimit ueber ALLE Outbound-Calls (Plattform-Notbremse, Bestand, wird nie
  // entfernt). Tenant-unabhaengig (ohne Filter = alle Calls).
  const globalHourReached = () =>
    store.countOutboundCallsSince(hourWindowStart()) >= config.safety.maxCallsPerHour;
  // Pro-Nutzer-Stundenlimit: effektiv min(global, profil) - ein Profil kann nur senken.
  function userHourReached(profile, requestedBy) {
    const limit =
      profile.maxCallsPerHour == null
        ? config.safety.maxCallsPerHour
        : Math.min(config.safety.maxCallsPerHour, profile.maxCallsPerHour);
    return store.countOutboundCallsSince(hourWindowStart(), { requestedBy }) >= limit;
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

  // KYC-Gate (P6b4): vor dem ersten Outbound muss der Tenant mindestens KYC_OUTBOUND_MIN
  // (card) erreicht haben. fail-closed - fehlendes kyc_level -> store.kycReached liefert
  // FALSE (403); der Owner passiert, weil seedBootstrapKyc ihn beim Boot auf id_verified
  // heilt. Liefert {status,grund,message} (Gate-Vertrag) oder null.
  function kycGateError(tenantId) {
    if (store.kycReached(tenantId, KYC_OUTBOUND_MIN)) return null;
    return {
      status: 403,
      grund: "kyc",
      message: "Verifikation unzureichend (KYC) fuer Outbound-Anrufe. Bitte Identitaet bestaetigen.",
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
        message: "Abo inaktiv (Tenant gesperrt). Outbound-Anrufe sind gesperrt.",
      };
    if (profile.unrestricted) return null;
    if (profile.allowedNumbers?.includes(to)) return null;
    if (store.tenantActiveSubscriber(tenantId, KYC_OUTBOUND_MIN)) return null;
    return {
      status: 403,
      grund: "allowlist",
      message:
        "Outbound nicht freigegeben: kein aktives Abo / keine Verifikation fuer diesen Tenant.",
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
      includedMinutes: plan?.includedMinutes,
      periodStartIso: resolvePeriodStartIso(sub),
    });
  }

  // Liefert {status, grund, message} fuer das erste verletzte Gate, sonst null. Feste
  // Pruefreihenfolge: Denylist -> E.164 -> Laender-Gate -> Pro-Stunde-Limit (global + Nutzer)
  // -> Pro-Ziel-Cap -> Verifikations-Gate. Die Denylist laeuft BEWUSST vor der
  // Formatpruefung: so erscheint eine Notruf-Kurzwahl (112) als bewusste Sperre (403
  // denylist), nicht als Formatfehler (400). caller = { profile, requestedBy, tenantId }:
  // profile/requestedBy steuern Land-Schnittmenge + pro-Nutzer-Limit, tenantId die
  // Abo-Kopplung, den per-(Tenant,Ziel)-Cap UND den Defense-in-depth-Block im
  // Allowlist-Gate.
  function numberGateError(to, caller) {
    const { profile, requestedBy, tenantId } = caller;
    if (isDenied(to))
      return {
        status: 403,
        grund: "denylist",
        message: `Nummer ${to} ist gesperrt (Notruf-/Premium-/Service-Nummer). Anruf verweigert.`,
      };
    if (!E164.test(to)) return { status: 400, grund: "format", message: E164_FORMAT_ERROR };
    if (!countryGateAllowed(to, profile))
      return {
        status: 403,
        grund: "land",
        message: `Laendervorwahl von ${to} ist nicht erlaubt (ALLOWED_COUNTRY_CODES). Anruf verweigert.`,
      };
    if (globalHourReached())
      return {
        status: 429,
        grund: "stundenlimit",
        message: `Stundenlimit fuer Outbound-Anrufe erreicht (MAX_CALLS_PER_HOUR=${config.safety.maxCallsPerHour}). Bitte spaeter erneut.`,
      };
    if (userHourReached(profile, requestedBy))
      return {
        status: 429,
        grund: "stundenlimit_nutzer",
        message: "Persoenliches Stundenlimit fuer Outbound-Anrufe erreicht. Bitte spaeter erneut.",
      };
    if (perTargetCapReached(tenantId, to))
      return {
        status: 429,
        grund: "ziel_limit",
        message: "Wiederhol-Limit fuer dieses Ziel erreicht. Bitte spaeter erneut.",
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

  // Ablehnungsgrund + -text der TENANT-Achse im budget-Gate (Bucket lesbar -> eigene Decke
  // + eigener Verbrauch; unbuchbar (D7) -> ziffernfreier Sperrtext, s. TENANT_UNREADABLE_DENIAL).
  // EIGENE Zahlen, NIE eine Plattform-Groesse (Absolute Regel 4/6, s. PLATFORM_DENIAL oben).
  function tenantBudgetDenial(tenantId) {
    const snapshot = store.tenantBudgetSnapshot(tenantId, config.billing);
    if (snapshot.spentCents === null)
      return { grund: "budget_tenant", message: TENANT_UNREADABLE_DENIAL };
    return {
      grund: "budget_tenant",
      message: `Dein Budget-Limit ist erreicht: ${eurText(snapshot.spentCents)} von ${eurText(snapshot.capCents)} EUR verbraucht.`,
    };
  }

  // Ablehnungsgrund + -text der TENANT-Achse im reserve_budget-Gate: Fehlbetrag (EINE
  // Formel fuer beide Reserve-Gruende: reserveCents - remainingCents) + Spend-Monat-Ende
  // als Fakt (KEINE Reset-Zusage, P4-Achse ist vor P7 nicht die Gate-Quelle). Bucket
  // unbuchbar (D7) -> ziffernfreier Sperrtext, Grund bleibt reserve_erschoepft (kein
  // dritter Grund fuer denselben Sperrzustand).
  function tenantReserveDenial(tenantId, reserveCents) {
    const snapshot = store.tenantBudgetSnapshot(tenantId, config.billing);
    if (snapshot.remainingCents === null)
      return { grund: "reserve_erschoepft", message: TENANT_UNREADABLE_DENIAL };
    const missingEur = eurText(reserveCents - snapshot.remainingCents);
    const monthEnd = spendMonthEndDate(Date.now());
    if (snapshot.remainingCents > 0)
      return {
        grund: "reserve_ueber_rest",
        message: `Dieser Anruf passt nicht mehr in dein Budget: es fehlen ${missingEur} EUR. Aktueller Spend-Monat endet am ${monthEnd}.`,
      };
    return {
      grund: "reserve_erschoepft",
      message: `Dein Budget ist erschoepft: es fehlen ${missingEur} EUR. Aktueller Spend-Monat endet am ${monthEnd}.`,
    };
  }

  // Klassifiziert das Ergebnis von tryReserveOutboundBudget NACH Achse (Tenant vs.
  // Plattform), OHNE eine zweite Entscheidung zu treffen: tryReserveOutboundBudget bleibt
  // die EINZIGE Quelle des Ja/Nein (reserved). Bei Ablehnung fragt reserveExceedsBudget
  // (reine Query, KEIN zweiter Reserve-Versuch) dieselbe Tenant-Decke, die
  // tryReserveOutboundBudget intern schon geprueft hat - false dort heisst zwingend "die
  // Plattform-Achse hat abgelehnt" (Schnittmenge, Regel 1). Laeuft im selben
  // withStoreLock-Callback wie die Entscheidung (reserve_budget-Gate unten) und bleibt
  // REIN SYNCHRON (Lock-Invariante des Moduls, s. Modul-Doc oben).
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

  function reserveOutcome(ctx) {
    const reserved = store.tryReserveOutboundBudget(ctx.tenantId, ctx.reserveCents, config.billing);
    if (reserved) return { reserved: true, warning: claimSpendWarning() };
    if (store.reserveExceedsBudget(ctx.tenantId, ctx.reserveCents, config.billing))
      return { reserved: false, ...tenantReserveDenial(ctx.tenantId, ctx.reserveCents) };
    return { reserved: false, grund: PLATFORM_DENIAL_REASON, message: PLATFORM_DENIAL };
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

  // Die geordnete Gate-Kette (16 Glieder). Reihenfolge load-bearing, per Snapshot-Test
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
        return deny(403, { error: "Outbound-Anrufe sind derzeit gesperrt (OUTBOUND_FROZEN)." }, {
          event: "place_call_denied",
          detail: `to=${ctx.to} grund=frozen`,
        });
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
        return deny(403, { error: "Kein Tenant fuer diese Identitaet." }, {
          event: "place_call_denied",
          detail: `to=${ctx.to} grund=tenant_unbekannt requestedBy=${ctx.requestedBy}`,
        });
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
        const homeCountry = homeCountryCode([
          store.tenantPrivateNumber(ctx.tenantId),
          findActiveNumber(store.load(), ctx.tenantId)?.e164,
        ]);
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
        return deny(e.status, { error: e.message }, {
          event: "place_call_denied",
          detail: `to=${ctx.to} grund=${e.grund} tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`,
        });
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
        return deny(403, { error: "Kein registrierter Auftraggeber-Name fuer diesen Tenant." }, {
          event: "place_call_denied",
          detail: `to=${ctx.to} grund=keine_identitaet tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`,
        });
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
        const e = numberGateError(ctx.to, {
          profile: ctx.profile,
          requestedBy: ctx.requestedBy,
          tenantId: ctx.tenantId,
        });
        if (!e) return null;
        if (e.status === 400) return deny(400, { error: e.message });
        return deny(e.status, { error: e.message }, {
          event: "place_call_denied",
          detail: `to=${ctx.to} grund=${e.grund} requestedBy=${ctx.requestedBy}`,
        });
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
    // Nummer eines anderen Tenants als Fallback.
    {
      name: "resolve_outbound",
      run(ctx) {
        const o = outboundFrom(store.load(), ctx.tenantId);
        if (!o) {
          return deny(403, { error: "Kein aktive Absendernummer fuer diesen Tenant." }, {
            event: "place_call_denied",
            detail: `to=${ctx.to} grund=keine_tenant_nummer tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`,
          });
        }
        ctx.fromNumber = o.fromNumber;
        ctx.outboundProvider = o.provider;
        ctx.numberRecord = o.numberRecord;
        return null;
      },
    },
    // Budget-Schnittmenge (R2): pro-Tenant-Budget UND globaler Notaus (Summe ueber alle
    // Buckets) PARALLEL, beide fail-closed. Der globale Notaus wird NIE entfernt; pro-Tenant
    // schraenkt nur zusaetzlich ein. PRAEZEDENZ (P5a, Achsen in Text getrennt): budgetExceeded
    // wird IMMER geprueft, globalBudgetExceeded NUR wenn das erste false ist (wie zuvor per
    // Kurzschluss-`&&`) - feuern BEIDE Achsen, gewinnt die EIGENE: der Nutzer bekommt die
    // Zahl, auf die er reagieren kann, eine Plattform-Groesse erreicht ihn nie.
    {
      name: "budget",
      run(ctx) {
        if (store.budgetExceeded(ctx.tenantId, config.billing)) {
          const { grund, message } = tenantBudgetDenial(ctx.tenantId);
          return deny(402, { error: message }, {
            event: "place_call_denied",
            detail: `to=${ctx.to} grund=${grund} tenant=${ctx.tenantId}`,
          });
        }
        if (store.globalBudgetExceeded(config.billing)) {
          return deny(402, { error: PLATFORM_DENIAL }, {
            event: "place_call_denied",
            detail: `to=${ctx.to} grund=${PLATFORM_DENIAL_REASON} tenant=${ctx.tenantId}`,
          });
        }
        return null;
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
          {
            event: "place_call_denied",
            detail: `to=${ctx.to} grund=minutes tenant=${ctx.tenantId}`,
          },
        );
      },
    },
    // Derivations-Gate: Max-Dauer (Body-Override, gecappt auf MAX_CALL_DURATION_CAP_S) +
    // Reserve-Betrag (Worst-Case-Tarif * aufgerundete Minuten) fuer das folgende
    // reserve_budget-Gate.
    {
      name: "compute_reserve",
      run(ctx) {
        ctx.maxDur = resolveMaxDurationS(ctx.b.max_duration_s, config);
        ctx.reserveCents = tariffCentsPerMin(ctx.to) * Math.ceil(ctx.maxDur / SECONDS_PER_MINUTE);
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
          return deny(402, { error: "Reservierung fehlgeschlagen. Bitte erneut versuchen." }, {
            event: "place_call_denied",
            detail: `to=${ctx.to} grund=reserve_error tenant=${ctx.tenantId}`,
          });
        }
        if (outcome.reserved) {
          if (outcome.warning) emitPlatformSpendWarning(outcome.warning, ctx);
          return null;
        }
        return deny(402, { error: outcome.message }, {
          event: "place_call_denied",
          detail: `to=${ctx.to} grund=${outcome.grund} tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`,
        });
      },
    },
  ];

  return { gates };
}
