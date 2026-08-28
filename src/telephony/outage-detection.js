// OUTBOUND-E3b (E-4/F2b): die EINE Erkennungsregel fuer einen systematischen Ausfall -
// beantwortet "liegt ein Ausfall vor?" an GENAU einem Ort, rein, IO-frei, zeit-injiziert.
// Der Versand ist bewusst getrennt (outage-report.js, Clean-Code-Auftrag: "die Frage wird
// an genau einem Ort beantwortet, der Versand ist davon getrennt").
//
// Gezaehlt wird NUR die Basis-Klasse not-placed (Schuld bei uns/Anbieter, E-2/E3a).
// unreachable (Ziel-Schuld) und result-unknown (Anbieter-5xx/Timeout, PM-20) zaehlen NIE.
//
// Der EIMER ist das Fehlergrund-Token OHNE Carrier-Suffix: "not-placed:invite-403-D51"
// und "not-placed:invite-403" sind DERSELBE Eimer (zwei Carrier mit derselben
// Ablehnungsursache sind EIN Defekt) - "not-placed:start-403" ist ein ANDERER Eimer (HTTP-
// Anrufstart vs. SIP-INVITE sind verschiedene Defekte). Ohne das Abschneiden vervielfacht
// sich die Eimerzahl und jeder Eimer erreicht seine Schwelle spaeter (PM-22).
import { MS_PER_MINUTE } from "../utils/timer.js";

export const OUTAGE_VERDICT = Object.freeze({
  OFF: "aus", // Rollback-Hebel: windowMs=0 schaltet die Regel komplett ab
  NONE: "kein-befund",
  FIRST: "erstbefund", // K0: erster Befund einer Klasse - WARN+Audit, kein Versand
  ALERT: "alarm", // K1 oder K2 - Meldeweg laeuft
  RECOVERED: "erholt", // Rueckkehr zu gesund - eine Audit-Zeile, kein Versand
});

// K1 braucht MEHRERE betroffene Tenants, damit "verschiedene Tenants" nicht schon bei
// einem einzigen zaehlt (Plan E-4: "ein Tenant, der immer wieder dieselbe unerreichbare
// Nummer waehlt, loest keine der drei Klauseln aus" gilt ohnehin ueber die Basis-Klasse -
// diese Konstante schaerft zusaetzlich die Tenant-Klausel selbst).
export const MIN_TENANTS_SHARED_FAULT = 2;

// Ganzzahliger Anteilsvergleich (Deviation D-4): fehler*PERCENT_BASE >= versuche*p bleibt
// exakt, keine Rundung wie bei einem Fliesskomma-Anteil.
const PERCENT_BASE = 100;

// Carrier-Kuerzel am Ende eines Fehlergrund-Tokens (failure-reason.js:
// CARRIER_CODE_IN_REASON, Form D<zwei Ziffern>, z.B. "-D51"). Der Eimer ist das Token
// OHNE diesen Anhang.
const CARRIER_SUFFIX = /-D\d{2}$/;

// Der EIMER eines Fehlergrund-Tokens: ohne Carrier-Anhang. null/leer -> null.
export function outageBucket(reason) {
  return reason ? String(reason).replace(CARRIER_SUFFIX, "") : null;
}

// Reines Zeitfenster ueber die PERSISTENTEN Anruf-Zeilen (PM-23: kein Ringpuffer, kein
// In-Memory-Zaehler - das Fenster wird bei jedem Aufruf frisch aus store.load().calls
// abgeleitet und ueberlebt damit jeden Prozess-Neustart, ohne selbst etwas zu speichern).
// Zaehlt NUR direction==="outbound" (ein eingehender Fehlschlag ist kein Outbound-
// Ausfall) mit endedAt im Fenster [nowMs-windowMs, nowMs]. erfolge = answeredAt gesetzt
// (E-2-Lehre: status ist keine Wahrheit, answeredAt ist der einzige Beleg fuer einen
// funktionierenden Waehlweg - der 27.08.-Datensatz zeigte status=failed,
// answered_at=NULL bei allen vier Versuchen). fehler/tenants zaehlen NUR Zeilen, deren
// EIMER exakt dem uebergebenen bucket entspricht.
export function outageWindow(calls, { nowMs, windowMs, bucket }) {
  const zahlen = { fehler: 0, versuche: 0, erfolge: 0, tenants: 0 };
  const betroffeneTenants = new Set();
  for (const call of calls) {
    if (call.direction !== "outbound") continue;
    const endedMs = Date.parse(call.endedAt || "");
    if (Number.isNaN(endedMs) || endedMs < nowMs - windowMs || endedMs > nowMs) continue;
    zahlen.versuche += 1;
    if (call.answeredAt) {
      zahlen.erfolge += 1;
      continue;
    }
    if (outageBucket(call.failureReason) !== bucket) continue;
    zahlen.fehler += 1;
    betroffeneTenants.add(call.tenantId);
  }
  zahlen.tenants = betroffeneTenants.size;
  return zahlen;
}

// Entprellung (S3-1/S3-2, Plan 2.3): NIE ein zweiter Alarm nach einer bereits
// ZUGESTELLTEN Meldung (debounceMs, entprellt am VORFALL) - aber eine fehlgeschlagene
// Zustellung darf nach retryMs nachgeholt werden (sonst gibt es NULL Meldungen zum
// echten Vorfall, obwohl die Alarm-Bedingung weiter erfuellt ist).
function meldeErlaubt(marker, nowMs, { debounceMs, retryMs }) {
  if (marker.reportedAt) return nowMs - Date.parse(marker.reportedAt) >= debounceMs;
  if (marker.lastAttemptAt) return nowMs - Date.parse(marker.lastAttemptAt) >= retryMs;
  return true;
}

// K1 (kleines Volumen, der Ist-Zustand): mehrere Fehler derselben Klasse UND (keine
// Erfolge im Fenster ODER mehrere betroffene Tenants) - UND versuche<minAttempts.
// Die dritte Klausel steht nicht woertlich im Auftrag, macht aber nur explizit, was der
// Auftrag selbst voraussetzt ("K2 greift, sobald ein Nenner da ist"): OHNE sie ist die
// Oder-Bedingung bei Skala IMMER wahr (Deviation D-2, PM-22) - K1 und K2 partitionieren
// dieselbe Volumen-Achse an derselben Grenze minAttempts, keine der beiden vom Auftrag
// geforderten Klauseln (0-Erfolge, Mehr-Tenants) entfaellt dadurch.
function kleinesVolumenAlarm(fenster, schwellen) {
  return (
    fenster.versuche < schwellen.minAttempts &&
    fenster.fehler >= schwellen.minFailures &&
    (fenster.erfolge === 0 || fenster.tenants >= MIN_TENANTS_SHARED_FAULT)
  );
}

// K2 (Skala): ab einem Mindestnenner entscheidet der ANTEIL, nicht die absolute Zahl -
// sonst waere die Regel bei wachsendem Verkehr immer erfuellt (PM-22).
function skalaAlarm(fenster, schwellen) {
  return (
    fenster.versuche >= schwellen.minAttempts &&
    fenster.fehler * PERCENT_BASE >= fenster.versuche * schwellen.failSharePercent
  );
}

// Die EINE Erkennungsregel (K0/K1/K2). fenster kommt aus outageWindow(); marker ist die
// aktuell OFFENE Zeile aus dem durablen Speicher (state-ops.js#openOutageAlert) oder
// undefined/null, wenn es keine gibt. schwellen = { windowMs, minFailures, minAttempts,
// failSharePercent, debounceMs, retryMs } (alles Env-Werte, config.billing).
export function beurteileAusfall({ fenster, marker, schwellen, nowMs }) {
  if (schwellen.windowMs === 0) return { urteil: OUTAGE_VERDICT.OFF, zahlen: fenster };
  if (fenster.fehler === 0)
    return { urteil: marker ? OUTAGE_VERDICT.RECOVERED : OUTAGE_VERDICT.NONE, zahlen: fenster };
  if (!marker) return { urteil: OUTAGE_VERDICT.FIRST, zahlen: fenster };
  const alarmBedingungErfuellt = kleinesVolumenAlarm(fenster, schwellen) || skalaAlarm(fenster, schwellen);
  const urteil =
    alarmBedingungErfuellt && meldeErlaubt(marker, nowMs, schwellen)
      ? OUTAGE_VERDICT.ALERT
      : OUTAGE_VERDICT.NONE;
  return { urteil, zahlen: fenster };
}

// Body-Vertrag (Regel 10, PII-frei): GENAU vier Groessen plus Klasse/Regel - keine E.164,
// kein Tenant-Bezeichner, keine Call-ID, kein Anbieter-Rohtext. Dieselbe Formulierung fuer
// Log-Zeile, Audit-Detail, Mail-Text und SMS-Body (eine Quelle, kein Auseinanderlaufen).
export function alarmZeile({ code, zahlen, regel, windowMs }) {
  const fensterMin = Math.round(windowMs / MS_PER_MINUTE);
  return (
    "Hermes Betriebsmeldung\n" +
    `klasse=${code} fehler=${zahlen.fehler} versuche=${zahlen.versuche} ` +
    `erfolge=${zahlen.erfolge} tenants=${zahlen.tenants} fenster_min=${fensterMin} regel=${regel}`
  );
}
