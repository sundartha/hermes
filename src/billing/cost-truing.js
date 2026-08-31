// Kosten-Abgleich (LCT P3, seit LCT P4 buchend): misst die Ist-Kosten JEDES beendeten
// Calls gegen den Provider - seit KV-P3 in BEIDEN Richtungen. Der Richtungsfilter fiel,
// weil ein Inbound-Call seit KV-P2 eine Schaetzung auf der Gate-Achse traegt (6 EUR-Cent
// je angefangener Minute) und ohne Abgleich dauerhaft rund 3,5x ueber dem an KV-M1
// gemessenen Ist (1,87 US-Cent/min) stehen bliebe. Schreibt weiterhin AUSSCHLIESSLICH die
// vier P2-Felder, die publicCall (src/store/views.js) bereits strippt und die kein Gate,
// kein Meter und keine Projektion liest. Muster makeMetering (store+config im Closure,
// keine Telefonie-Logik im Server, kein Netz-IO im Store).
//
// Warum NICHT in finishCall: die CDR-Latenz ist UNBELEGT (PLAN-LIVE-COST-TRACING.md
// Kap. 2.6) - ein synchroner Abruf blockierte den Teardown oder lieferte verlaesslich null.
//
// Warum KEIN eigenes SQL: unter FORCE ROW LEVEL SECURITY liefert eine naive, direkt
// abgesetzte Anfrage 0 Zeilen bzw., bei klebender GUC auf einer geteilten DB-Connection,
// die Zeilen des FALSCHEN Tenants. Der Job arbeitet ausschliesslich auf dem In-Memory-
// Spiegel, den hydrate() in src/store/pg.js ohnehin PRO TENANT vollstaendig laedt
// (state.calls ist flach ueber alle Tenants) - daher laeuft er tenant-uebergreifend,
// ohne je einen Tenant-Filter zu formulieren oder eine eigene Datenbank-Verbindung zu
// beruehren.
//
// Warum der Laufriegel PROZESS-LOKAL ist: Render laeuft mit EINER Instanz; ein DB-Lock
// waere eigene Infrastruktur fuer ein Problem, das diese Topologie nicht hat. DIESE
// VORAUSSETZUNG FAELLT BEIM ERSTEN SKALIERUNGSSCHRITT (2. Instanz) - dann ist der Riegel
// wirkungslos und muss ersetzt werden.
//
// Waehrungs-Regel (D5): actualCostMicroCents bleibt am Call USD-Mikro-Cent,
// UNVERAENDERT. Die Umrechnung USD -> EUR-Bucket lebt an GENAU EINER Stelle:
// convertProviderMicroToBucketCents (state-ops.js), aufgerufen ausschliesslich aus
// applyCostCorrectionCents. In diesem Modul wird NIE umgerechnet.
//
// Deckungsquote (KV-M3): costTruingCoveragePercent zaehlt seit dieser Phase im Nenner
// NUR noch belegbare Calls (beantwortet, mit buchbarer Schaetzung, innerhalb des
// Provider-Belegfensters) statt JEDEM beendeten Call - der Nenner enthielt vorher Calls,
// die strukturell nie einen Beleg bekommen koennen (Plan-Befund N4). Die drei
// ausgeschlossenen Gruppen bekommen eigene, IMMER sichtbare Zaehler in der Sweep-Zeile
// und im Rueckgabewert (coverageBucketOf/coverageBreakdown).
import {
  COST_TRUING_SOURCE,
  MAX_CALL_DURATION_CAP_S,
  MICRO_CENTS_PER_CENT,
  isBookableCents,
} from "../store/defaults.js";
import { MS_PER_SECOND } from "../utils/timer.js";
import { chargeAnchorsOfCall, closeOutageAlert, nextCostTruingAttempt, openOutageAlert } from "../store/state-ops.js";
import { sendBootstrapAlertSms } from "../telephony/alert-sms.js";
import { meldeBetreiberNotiz, meldeVollBefund } from "../telephony/outage-report.js";
import { alarmKanalZeile, betreiberAlarmKanaele } from "../boot-guard.js";
import { tariffDriftReportFromConfig, alertableDriftFindings, driftLine } from "./cost-calibration.js";
import { KOSTENPROFIL, kostenprofilFuerAnruf, pflichttypenFuerProfil } from "./kostenarten.js";
import { belegVollstaendig, schreibeSweepKostenbeleg } from "./sweep-kostenbeleg.js";
import { legRefOfCall } from "./call-leg-ref.js";
// KV2-6: die Deckung JE TRAEGER und der faelligkeits-unabhaengige Herzschlag. Das
// Regelwerk liegt bewusst in einem eigenen Modul und NICHT hier: diese Datei traegt ein
// gepinntes Lint-Budget (eslint-suppressions.json, makeCostTruing 292 Zeilen), und der
// Kostenpfad soll seine Kennzahl nicht ein zweites Mal formulieren. Import-Richtung ist
// strikt einseitig - kosten-deckung.js kennt cost-truing.js nicht (kein Zyklus).
import { kostenBuchBericht, istBuchBefundCode } from "./kosten-deckung.js";

// Zwei Ausloeser (Intervall + manueller Endpunkt), EIN benannter Grund je. Exportiert:
// boot.js und api-billing.js teilen sich diese eine Quelle statt zweier Magic-Strings.
export const SWEEP_TRIGGER = Object.freeze({ INTERVAL: "interval", MANUAL: "manual" });

const PERCENT_BASE = 100;
const MS_PER_MINUTE = 60 * 1000;
const SWEEP_RUNNING_REASON = "sweep_running";
// Grund fuer einen Pool, der zwar geantwortet hat, dessen Menge aber nachweislich
// unvollstaendig ist (pool.complete === false, ab KE-P3 erreichbar).
const POOL_INCOMPLETE_REASON = "pool_incomplete";
const COST_TRUING_FINDING = Object.freeze({
  COVERAGE_BELOW_THRESHOLD: "coverage_below_threshold",
  COVERAGE_STALLED: "coverage_stalled",
  // KE-P8: dritter Code auf DEMSELBEN Kanal - kein eigener Alarmweg, keine SMS-Klasse (PM-7).
  REQUESTS_ABOVE_THRESHOLD: "requests_above_threshold",
  // KV-P7: vierter/fuenfter Code auf DEMSELBEN Kanal (kein eigener Alarmweg, keine
  // SMS-Klasse - dieselbe Praezedenz wie REQUESTS_ABOVE_THRESHOLD). Meldet die
  // ElevenLabs-Kontingent-Warnschwelle/-Erschoepfung, wenn sie ueber den Telnyx-Relay-
  // Verbrauch (recordRelayTtsCharacters) erreicht wird - der Play-TTS-Pfad alarmiert
  // dieselbe Schwelle stattdessen per SMS (server.js), NICHT hierueber.
  TTS_QUOTA_WARN_THRESHOLD: "tts_quota_warn_threshold",
  TTS_QUOTA_EXHAUSTED: "tts_quota_exhausted",
});
const COST_TRUING_AUDIT_EVENT = "cost_truing_befund";

// KV2-1: der Marker-Namensraum des Kostenpfads in state.outageAlerts. Kollidiert mit
// keinem Bestands-Eimer (Fehlergrund "not-placed*", "drift:", "hold:", "self-test:") -
// wichtig, weil runOutageRecoverySweep NUR Fehlergrund-Eimer schliesst (istFehlergrundEimer)
// und schliesseVerschwundeneBefunde nur "drift:"-Marker: ein kosten:-Marker wird also von
// keinem fremden Sweep angefasst. Jeder Befund-Code bekommt seinen EIGENEN Eimer und damit
// seine EIGENE Entprellung (Plan 4.9).
const KOSTEN_BUCKET_PREFIX = "kosten:";
const kostenBucket = (code) => `${KOSTEN_BUCKET_PREFIX}${code}`;

// Die Deckungs-Achse - EINE Liste fuer drei Leser: die Meldestufe (VOLL), das Schliessen
// bei Erholung und der Stillstands-Bezug. Drei getrennte Aufzaehlungen liefen beim ersten
// Nachziehen auseinander (G5).
const COVERAGE_FINDING_CODES = Object.freeze([
  COST_TRUING_FINDING.COVERAGE_BELOW_THRESHOLD,
  COST_TRUING_FINDING.COVERAGE_STALLED,
]);

// Meldestufe je Befund-Code (Muster VOLL_KLASSEN, telephony/outbound-drift-watch.js):
// die Deckungs-Achse meldet VOLL (WARN -> Audit -> Mail -> SMS), Volumen und
// TTS-Kontingent bleiben auf der kostenlosen Notiz-Stufe. Das ist keine neue Entscheidung,
// sondern die bestehende: KE-P8/PM-7 ("kein eigener Alarmweg, keine SMS-Klasse") und
// KV-P7 (der Play-TTS-Pfad alarmiert dieselbe Schwelle bereits per SMS aus server.js -
// eine zweite SMS waere Kanal-Verdopplung auf demselben Konto).
const VOLL_BEFUND_CODES = new Set(COVERAGE_FINDING_CODES);

// Ein eigenes Ereignis fuer den Uebergang zurueck ueber die Schwelle (Muster
// drift_recovered). Nie zwei Sachverhalte auf einem Label: "Befund" und "Befund weg" sind
// zwei Aussagen.
const COST_TRUING_RECOVERED_EVENT = "cost_truing_erholt";

// Modul-Ebene statt im makeCostTruing-Closure (G30/G34: eine Aufgabe, eine
// Abstraktionsebene je Funktion) - beide sind rein und brauchen nur die zwei
// Zahlen, keinen Zugriff auf store/audit/messaging.
//
// Die Zahlen der Deckungs-Achse. Das Feld sweeps= (prozesslokaler Zaehler) ist seit
// KV2-1 durch seit= ersetzt - dieselbe Frage ("seit wann durchgehend unter der
// Schwelle"), aber am DURABLEN Marker beantwortet (firstSeenAt) statt in einer
// Prozesserinnerung. Der alte Zaehler wurde von JEDEM Deploy genullt und erreichte die
// Eskalationsstufe nie (AUFTRAG B3, im Live-Log gemessen: nach dem Deploy wieder
// sweeps=1). Der Name wechselt mit dem Sachverhalt (G11: nie zwei Bedeutungen auf einem
// Label).
function coverageDetail(coveragePercent, minCoveragePercent, seitIso) {
  return `deckung=${coveragePercent}% schwelle=${minCoveragePercent}% seit=${seitIso}`;
}

// Die Terminierungsregel in ZEIT statt in Sweeps. Die SCHWELLE bleibt
// COST_TRUING_COVERAGE_STALL_SWEEPS und wird ueber die EINE Kadenz-Quelle
// COST_TRUING_SWEEP_INTERVAL_MS umgerechnet (min 1 Minute, also nie 0) - kein neuer
// Env-Wert, keine zweite Zeit-Groesse. Die Schwelle wird NIE gesenkt, um die
// Vorbedingung zu erfuellen.
function coverageStallMs(stallSweeps, sweepIntervalMs) {
  return stallSweeps * sweepIntervalMs;
}

// Zurueck ueber der Schwelle: die offenen Deckungs-Marker schliessen, damit firstSeenAt
// beim naechsten Einbruch neu beginnt (das durable Gegenstueck zu sweepsBelowThreshold=0).
// EINE Audit-Zeile je Uebergang, und NUR wenn wirklich etwas geschlossen wurde - sonst
// schriebe jeder gesunde Sweep eine Zeile (Muster drift_recovered). store/audit als
// Parameter statt Closure (F1: 3 Argumente) - dieselbe Instanz, die der Aufrufer haelt.
async function closeCoverageBefunde(store, audit, nowMs) {
  const geschlossen = await store.withStoreLock(() => {
    const state = store.load();
    return COVERAGE_FINDING_CODES
      .map((code) => closeOutageAlert(state, { code: kostenBucket(code), nowMs }))
      .filter(Boolean).length;
  });
  store.save();
  if (geschlossen === 0) return;
  const zeile = `marker=${geschlossen}`;
  console.log(`[cost-truing] erholt ${zeile}`);
  audit(COST_TRUING_RECOVERED_EVENT, null, zeile);
}
// LCT P5 (Drift-Waechter): eigenes Audit-Ereignis + eigener SMS-Praefix, getrennt von
// COST_TRUING_AUDIT_EVENT (verschiedene Aussage: Deckungsquote vs. Tarif-Abweichung).
const TARIFF_DRIFT_AUDIT_EVENT = "tarif_drift_befund";
const DRIFT_ALERT_SMS_PREFIX = "[hermes] Tarif-Drift: ";

// KE-P8 (Bruchpunkt-Waechter): Betriebsschwelle EINES Sweeps, in HTTP-Anfragen.
// Herleitung (Plan Kap. 3): /v2/detail_records erlaubt gemessene 40 Anfragen je FIXEM
// UTC-Minutenfenster (Plan F1, Messung 2026-07-21). 1440 Anfragen sind damit 36 Minuten
// reiner Abrufzeit - 10 % des 6-h-Intervalls, aus dem die Schwelle stammt. Seit KE-P6B
// laeuft der Sweep stuendlich; dieselben 1440 Anfragen sind dort rund 48 Minuten (unser
// Drossel-Budget ist 30/min, nicht 40) und fuellen damit fast das ganze Intervall: die
// Schwelle meldet weiterhin VOR dem Punkt, an dem zwei Sweeps ineinander laufen, nur knapper.
// Die gemessenen 40 werden BEWUSST NICHT aus dem Telnyx-Adapter importiert - der
// Billing-Pfad kennt keinen Provider (DIP), und die Schwelle ist eine Betriebsgroesse,
// keine Provider-Eigenschaft. Aendert der Provider sein Kontingent, ist sie neu
// herzuleiten; sichtbar wird das an anfragen= in der Sweep-Zeile (PM-6).
// BEWUSST keine Env-Variable: eine Warnschwelle, die sich hochdrehen laesst, ist die
// Sicherung, die an ihre eigene Verletzung angepasst wird.
const SWEEP_REQUESTS_WARN_THRESHOLD = 1440;

// Die vier sich gegenseitig ausschliessenden Ausgaenge des Praedikats "belegbar"
// (KV-M3, N4-Behebung). EIN Ausdruck mit vier benannten Buckets statt eines Booleans -
// jede ausgeschlossene Gruppe bekommt einen eigenen, sichtbaren Zaehler (s.
// coverageBreakdown), statt still im Nenner zu verschwinden.
const COVERAGE_BUCKET = Object.freeze({
  ELIGIBLE: "eligible",
  NEVER_ANSWERED: "nie_beantwortet",
  NO_ESTIMATE: "ohne_schaetzung",
  OUTSIDE_WINDOW: "ausserhalb_fenster",
});

// Providerseitiges Belegfenster (KV-M3, N4-Behebung Teil 1): /v2/detail_records deckt
// GEMESSEN nur die letzten PROVIDER_COST_RECORD_WINDOW_DAYS Tage ab (Kosten-Inventar
// 2026-07-31, tasks/kosten-inventar.md:546: "last_7_days"). Diese Zahl existierte vor
// KV-M3 an KEINER Stelle im Code (grep auf "last_7_days"/"7 Tage" in src/: 0 Treffer) -
// das war der Befund selbst, keine Kopie eines vorhandenen Werts.
// Ein beendeter Call AELTER als dieses Fenster kann strukturell nie mehr belegt werden,
// unabhaengig davon, ob je ein Sweep ihn versucht hat.
// BEWUSST KEINE Env-Variable, aus DEMSELBEN Grund wie SWEEP_REQUESTS_WARN_THRESHOLD
// (oben in dieser Datei): ein Wert, den ein Operator herunterdrehen kann, um Calls
// vorzeitig aus dem Nenner zu nehmen, ist die Sicherung, die an ihre eigene Verletzung
// angepasst wird - ein zu KLEIN gesetztes Fenster schliesst noch belegbare Calls aus
// dem Nenner aus und TREIBT die Quote kuenstlich nach oben, still den WARN aushebelnd.
// Ein zu GROSSES Fenster ist dagegen harmlos (es drueckt die Quote hoechstens, nie
// faelschlich hoch) - die Richtung mit Schadenspotenzial ist die eine, die eine
// Env-Variable eroeffnen wuerde. Exportiert, damit Tests exakt gegen sie koppeln
// (kein zweites "7" in den Tests, G5/G25).
export const PROVIDER_COST_RECORD_WINDOW_DAYS = 7;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
// KV2-6: exportiert, weil die Deckung je Traeger GENAU dieses Fenster misst - ein Anruf
// ausserhalb kann strukturell keinen Beleg mehr bekommen. Die Zahl wandert NICHT in das
// neue Modul (das erzeugte einen Import-Zyklus); sie wird von dort als Parameter
// entgegengenommen. EINE Quelle bleibt diese Zeile.
export const PROVIDER_COST_RECORD_WINDOW_MS =
  PROVIDER_COST_RECORD_WINDOW_DAYS * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

// DAS Praedikat "beendeter Call" - RICHTUNGSOFFEN seit KV-P3. Bis dahin stand hier
// zusaetzlich direction === "outbound"; der Filter war die zweite Haelfte der
// Inbound-Luecke (L1): KV-P2 bucht die Schaetzung, ohne diesen Abgleich bliebe sie
// fuer immer stehen. Der Name traegt die Richtung deshalb nicht mehr mit (N2) - ein
// Name, der "Outbound" behauptet, waehrend die Funktion beide Richtungen bedient,
// ist die Sorte Luege, an der die naechste Phase falsch abbiegt.
// EINE Quelle fuer BEIDE Verbraucher (G5): den Kandidaten-Riegel (isTruingCandidate)
// und die VORFILTERUNG des Deckungsquote-Nenners (coverageBreakdown) - zwei getrennte
// Fassungen liefen beim ersten Nachziehen auseinander. Seit KV-M3 ist isEndedCall nicht
// mehr der Nenner selbst (s. coverageBucketOf): ein beendeter Call zaehlt nur dann, wenn
// er zusaetzlich belegbar ist.
const isEndedCall = (call) => !!call.endedAt;
// KV2-5: dritte Alternative sipCallId. Ein EL-Anruf traegt weder twilioSid noch
// callControlId (12/12 gemessen, befund-telnyx.md O1) - providerLegIdOf lieferte fuer ihn
// null, isRetrievable war falsch, und er wurde vom Sweep uebersprungen.
// FOLGE, benannt: ab diesem Deploy sind die 12 EL-Altanrufe erstmals Kandidaten. Dass
// dabei kein Cent bewegt wird, traegt der EL-Riegel unten (sweepDarfKorrigieren).
// Ableitung liegt in call-leg-ref.js (EINE Quelle mit sweep-kostenbeleg.js#legRefOfCall).
const providerLegIdOf = legRefOfCall;

// Die Pflicht-Typmenge DIESES Anrufs (KV2-5(f)) - Profil-Aufloesung und Env-Wert an EINER
// Stelle zusammengefuehrt, damit die Aufrufzeile in trueOneCall lesbar bleibt.
const pflichttypenVon = (call, billing) =>
  pflichttypenFuerProfil(kostenprofilFuerAnruf(call), billing.costTruingRequiredRecordTypes);

// Darf der Sweep fuer diesen Anruf eine Korrektur BUCHEN? Zwei Ausschlussgruende, eine
// Frage:
//   1. Kein buchbarer Schaetzbetrag -> strukturell nicht korrigierbar (Bestandsregel).
//   2. EL-Route -> der Telnyx-Pool traegt NUR den SIP-Anteil (4,01 US-ct gemessen), NIE
//      die ElevenLabs-Kosten (56 US-ct ueber 8 Anrufe). Gegen eine 30-ct-Schaetzung
//      gebucht, loeschte er rund 90 % der echten Kosten von der Gate-Achse - die B6-Falle.
//      Diese Kette SAMMELT hier, sie bucht nicht; gebucht wird erst in KV2-8 aus der
//      Belegsumme beider Traeger. Der Riegel haengt am PROFIL, nicht an einem Flag, und
//      erfasst ueber die Legacy-Zuordnung auch die 12 profillosen EL-Altzeilen (KV2-5(h)).
const sweepDarfKorrigieren = (call) =>
  isBookableCents(call.estimatedCostCents) && kostenprofilFuerAnruf(call) !== KOSTENPROFIL.EL_CONVAI_SIP;

// Beendet-Zeitstempel EINES Calls in Millisekunden, oder null (fehlend/unbrauchbar).
// EINE Parse-Stelle fuer die zwei Verbraucher - die Faelligkeit eines Kandidaten und die
// Zeitschranke des Belegabrufs (G5). Zwei eigene Date.parse-Ausdruecke liefen beim ersten
// Nachziehen auseinander, und ein NaN, das bis in new Date(...).toISOString() durchschluege,
// wuerfe - der Sweep braeche mitten in der Kandidatenliste ab.
const endedAtMs = (call) => {
  const ms = Date.parse(call.endedAt);
  return Number.isFinite(ms) ? ms : null;
};

// DAS Praedikat "belegbar" (KV-M3, N4). Ein beendeter Call kann NUR dann je einen
// Provider-Beleg bekommen, wenn (1) er ueberhaupt beantwortet wurde - ein nie
// angenommenes Leg hat nichts zu belegen -, (2) eine buchbare Schaetzung persistiert
// ist - ohne sie klassifiziert truedSourceOf() ihn ohnehin fuer immer als NO_ESTIMATE,
// s. dort -, und (3) sein Ende innerhalb des Provider-Belegfensters liegt.
// Reihenfolge ist eine Aussage: "nie beantwortet" geht vor "ohne Schaetzung", weil ein
// nie beantworteter Call strukturell auch nie eine Schaetzung bekommt
// (reconcileVoiceBudget bucht nur auf tatsaechlich verbrauchte Minuten) - die
// aussagekraeftigere Kategorie darf nicht hinter der schwaecheren verschwinden.
// EINE Quelle (G5): sowohl der Nenner der Deckungsquote als auch die drei
// Nebenzaehler (coverageBreakdown) lesen AUSSCHLIESSLICH diese Funktion - eine zweite,
// getrennt gepflegte Fassung liefe beim naechsten Nachziehen auseinander, exakt wie
// isEndedCall es vor KV-P3 tat.
function coverageBucketOf(call, nowMs) {
  if (!call.answeredAt) return COVERAGE_BUCKET.NEVER_ANSWERED;
  if (!isBookableCents(call.estimatedCostCents)) return COVERAGE_BUCKET.NO_ESTIMATE;
  const endedMs = endedAtMs(call);
  if (endedMs === null || nowMs - endedMs > PROVIDER_COST_RECORD_WINDOW_MS)
    return COVERAGE_BUCKET.OUTSIDE_WINDOW;
  return COVERAGE_BUCKET.ELIGIBLE;
}

// EIN Durchlauf ueber alle beendeten Calls (KV-M3, G5/G30): bildet Nenner, Zaehler UND
// die drei Nebenzaehler in einem Pass - keine zweite Iteration, kein zweiter
// Formel-Ausdruck. costTruingCoveragePercent und die Sweep-Log-Zeile leiten sich BEIDE
// aus GENAU diesem Objekt ab (percentFromBreakdown), damit sie nie auseinanderlaufen
// koennen. Zaehler (proven) bleibt costTruedSource === 'telnyx_detail_records' (dieser
// Wert wird nur bei kompletter Pflicht-Typ-Menge gesetzt - EINE Quelle der
// Vollstaendigkeits-Aussage, kein zweites Praedikat).
function coverageBreakdown(state, nowMs) {
  const ended = Array.isArray(state?.calls) ? state.calls.filter(isEndedCall) : [];
  const breakdown = { eligible: 0, proven: 0, noEstimate: 0, neverAnswered: 0, outsideWindow: 0 };
  for (const call of ended) {
    const bucket = coverageBucketOf(call, nowMs);
    if (bucket === COVERAGE_BUCKET.NEVER_ANSWERED) {
      breakdown.neverAnswered++;
      continue;
    }
    if (bucket === COVERAGE_BUCKET.NO_ESTIMATE) {
      breakdown.noEstimate++;
      continue;
    }
    if (bucket === COVERAGE_BUCKET.OUTSIDE_WINDOW) {
      breakdown.outsideWindow++;
      continue;
    }
    breakdown.eligible++;
    if (call.costTruedSource === COST_TRUING_SOURCE.DETAIL_RECORDS) breakdown.proven++;
  }
  return breakdown;
}

// Die Quote aus einem bereits gebildeten Breakdown (KV-M3): NENNER 0 -> 0, kein
// Freispruch - dieselbe Konvention wie vor dieser Phase, jetzt bezogen auf den engeren
// (nur belegbare Calls zaehlenden) Nenner. Abgerundet (floor) - die Abweichung geht
// Richtung "zu wenig Deckung", nie Richtung vorgetaeuschter Reife.
function percentFromBreakdown({ eligible, proven }) {
  return eligible === 0 ? 0 : Math.floor((proven * PERCENT_BASE) / eligible);
}

// Marge, um die die Zeitschranke des Belegabrufs VOR dem aeltesten Kandidaten liegt (KE-P5).
// GELD-Sicherung, kein Sparknopf - die Richtungen sind nicht symmetrisch:
//   zu grosszuegig -> ein paar Anfragen mehr, kein Beleg geht verloren;
//   zu knapp       -> die Seitenschleife des Adapters endet, BEVOR der Beleg gefunden ist,
//                     und der Pool gilt trotzdem als vollstaendig (complete:true) - eine
//                     Rueckerstattung auf einer bewiesenen Untermenge.
// Herleitung: die Belege tragen Zeitfelder vom GESPRAECHSBEGINN, nicht vom Ende - der
// Pflicht-Typ call-control fuehrt ausschliesslich started_at (Messung 2026-07-21). Der
// groesste Abstand zum endedAt eines Kandidaten ist damit die Gespraechsdauer, und die
// deckelt MAX_CALL_DURATION_CAP_S (die absolute Obergrenze der Notbremse, KS-P3). Die
// Marge ist deshalb ABGELEITET und nicht als Zahl gepflegt: sie war schon einmal eine
// Zahl, die an einem Cap hing, der sich geaendert hat (TOD 12). Das Zwoelffache traegt
// zusaetzlich den Versatz zwischen unserer Uhr (endedAt) und der Provider-Uhr
// (Belegzeitstempel); zwoelffach, weil die Richtungen nicht symmetrisch sind (s.o.).
const POOL_SINCE_MARGIN_FACTOR = 12;
const POOL_SINCE_MARGIN_MS = POOL_SINCE_MARGIN_FACTOR * MAX_CALL_DURATION_CAP_S * MS_PER_SECOND;

// Zeitschranke des Belegabrufs, abgeleitet aus dem AELTESTEN Kandidaten (KE-P5): ohne sie
// zog ein Sweep mit einem 3 h alten Call denselben Umfang wie einer mit 200 Kandidaten -
// der Adapter blaettert je Typ bis zur letzten Seite bzw. bis zur Seitenobergrenze.
// Kein Kandidat mit brauchbarem Zeitstempel -> KEINE Schranke (undefined): das kostet
// Anfragen, kann aber keinen Beleg verlieren. Ein unbrauchbarer endedAt faellt heraus,
// statt die Schranke als NaN ins Bodenlose zu ziehen (solche Calls sind ohnehin keine
// Kandidaten, s. isTruingCandidate).
function poolSinceFor(candidates) {
  let oldestMs = null;
  for (const call of candidates) {
    const ms = endedAtMs(call);
    if (ms !== null && (oldestMs === null || ms < oldestMs)) oldestMs = ms;
  }
  return oldestMs === null ? undefined : new Date(oldestMs - POOL_SINCE_MARGIN_MS).toISOString();
}

// Anteil der beendeten Calls mit beweisbar vollstaendiger Datenlage - seit KV-M3 NUR
// noch unter den BELEGBAREN (coverageBucketOf: beantwortet, mit buchbarer Schaetzung,
// innerhalb des Provider-Belegfensters). Vor KV-M3 zaehlte der Nenner JEDEN beendeten
// Call, egal ob er strukturell je einen Beleg bekommen konnte (Plan-Befund N4) - eine
// Warnung, die nie gruen werden kann, ist keine Warnung mehr, sondern Tapete. Die drei
// ausgeschlossenen Gruppen verschwinden NICHT, sie bekommen eigene, IMMER sichtbare
// Zaehler (s. reportCoverage/sweepAllCandidates), damit eine Quote von z.B. 100% nie
// verschleiert, wie viele Calls ohne Schaetzung oder ausserhalb des Belegfensters lagen.
// Abgerundet (floor) - die Abweichung geht Richtung "zu wenig Deckung", nie Richtung
// vorgetaeuschter Reife. NENNER 0 -> 0, kein Freispruch (percentFromBreakdown). Nicht
// persistiert: live aus dem geladenen Spiegel gerechnet. Aufrufer reichen store.load()
// herein (P4- und P4b-Boot-Guard rufen DIESE Funktion, statt die Rechnung ein zweites
// Mal zu erfinden). nowMs mit Default (Date.now()), damit alle Bestandsaufrufer mit
// einem Argument unveraendert weiterlaufen.
export function costTruingCoveragePercent(state, nowMs = Date.now()) {
  return percentFromBreakdown(coverageBreakdown(state, nowMs));
}

// messaging/mailer sind der Betreiber-Alarmkanal (Plan 4.9), kein Abgleich-Pfad - der
// Provider-Kosten-Abgleich selbst laeuft ausschliesslich ueber voiceControl. audit ist
// seit KV2-1 die DURABLE Variante (server.js#durableAudit); ein Test kann jede Funktion
// mit der util.js#audit-Signatur injizieren.
export function makeCostTruing({ store, config, voiceControl, audit, messaging, mailer, now = Date.now }) {
  // Modul-lokaler Laufriegel. BEIDE Ausloeser (Intervall + manueller Endpunkt) teilen
  // sich diesen einen Boolean. GESETZT VOR DEM ERSTEN await, freigegeben im finally:
  // Node ist single-threaded, aber der Sweep awaitet den Pool-Abruf je Provider (KE-P2,
  // vor der Buchungsschleife). Feuert das Intervall, waehrend der manuelle Lauf noch auf
  // eine Antwort wartet, saehen sonst BEIDE Laeufe costTruedAt === null fuer denselben Call und
  // verarbeiteten ihn doppelt (ab P4: doppelte Korrekturbuchung). Ein nach dem await
  // gesetzter Riegel schuetzt genau hier NICHT. Ein zweiter Aufruf ist ein
  // protokolliertes No-op, KEIN Fehler. (costTruedAt selbst riegelt nur SEQUENZIELLE
  // Wiederholung, nicht Verschraenkung - deshalb beide Riegel, nicht einer.)
  let sweepRunning = false;

  // Entprellfenster der NOTIZ-Stufe (COST_ALERT_DEBOUNCE_MS, Default 24 h) und der
  // Tarif-Drift-SMS (P5 keyt zusaetzlich auf den Praefix, "<praefix> <code>"). BEWUSST
  // DIESELBE Map und DIESELBE Regel fuer beide.
  // KV2-1: die VOLL-Stufe entprellt NICHT mehr hier, sondern am DURABLEN Marker
  // (outage-report.js#meldeVollBefund, OUTAGE_ALERT_DEBOUNCE_MS/-RETRY_MS). Warum die
  // Notiz-Stufe trotzdem diese Map braucht: sie setzt nie sent:true, also bleiben
  // lastAttemptAt/reportedAt null und meldeErlaubt liefert immer true - der Marker KANN
  // eine nie sendende Stufe nicht entprellen.
  const lastFindingMs = new Map();

  // Kandidaten-Praedikat (persistierter Versuchszaehler, kein In-Memory). COST_TRUING_
  // MAX_ATTEMPTS gegen den PERSISTIERTEN Zaehler (P2): ein prozess-lokaler Zaehler wird
  // auf dem Render-Free-Tier bei jedem Restart genullt, erreicht die Obergrenze nie und
  // liesse den Job unbegrenzt gegen tote Calls laufen.
  function isTruingCandidate(call, nowMs) {
    if (!isEndedCall(call) || call.costTruedAt !== null) return false;
    if (nextCostTruingAttempt(call) > config.billing.costTruingMaxAttempts) return false;
    const endedMs = endedAtMs(call);
    if (endedMs === null) return false; // unbrauchbarer Zeitstempel != "faellig"
    return nowMs - endedMs >= config.billing.costTruingDelayMinutes * MS_PER_MINUTE;
  }

  function sumRecordMicroCents(records) {
    let total = 0;
    for (const r of records) {
      // P1 liefert Ganzzahl-Mikro-Cents. Zweite Linie: alles andere ist ein Datenfehler
      // und wird zu "nicht gemessen" (null), NIE stillschweigend zu 0 addiert.
      if (!Number.isSafeInteger(r?.costMicroCents) || r.costMicroCents < 0) return null;
      total += r.costMicroCents;
      if (!Number.isSafeInteger(total)) return null;
    }
    return total;
  }

  // Summe eines GANZZAHL-Mengenfelds ueber alle Records. Nicht-ganzzahlig, fehlend oder
  // negativ zaehlt als 0 (fail-closed). EINE Regel fuer BEIDE Mengen (G5): billedSec (Beweis
  // der Abrechnung) und ttsCharacters (ElevenLabs-Menge) - zwei nebeneinander gepflegte
  // reduce-Ausdruecke liefen beim ersten Nachziehen auseinander.
  function sumIntegerField(records, field) {
    return records.reduce(
      (sum, r) => sum + (Number.isSafeInteger(r?.[field]) && r[field] > 0 ? r[field] : 0), 0);
  }

  // Die leere Pflicht-Menge (Punkt 5 des Auftrags) - EIN Ausdruck, testgepinnt:
  // requiredRecordTypes.length > 0 ist DER Riegel: ueber der LEEREN Menge ist
  // "jeder Typ ist vertreten" allquantifiziert wahr und damit fuer JEDEN Call erfuellt -
  // der Vollstaendigkeits- faellt still auf den Anwesenheitsbeweis zurueck. Leer heisst
  // deshalb 'incomplete' ("nichts bewiesen"), nie 'telnyx_detail_records'. Kein geratener
  // Nicht-leer-Default (der saehe nach Vollstaendigkeit aus).
  function classifyRecords(records, requiredRecordTypes) {
    if (!Array.isArray(records) || records.length === 0) return null; // leere Antwort = keine Messung
    const total = sumRecordMicroCents(records);
    if (total === null) return null;
    const found = new Set(records.map((r) => r.recordType));
    const complete = requiredRecordTypes.length > 0 && requiredRecordTypes.every((t) => found.has(t));
    return {
      actualCostMicroCents: total,
      source: complete ? COST_TRUING_SOURCE.DETAIL_RECORDS : COST_TRUING_SOURCE.INCOMPLETE,
      // LCT P4: zweiter Beleg des Vollstaendigkeits-Praedikats.
      billedSecTotal: sumIntegerField(records, "billedSec"),
      // KE-P6: ElevenLabs-Zeichen der ZUGEORDNETEN text-to-speech-Belege dieses Calls.
      // 0 heisst "kein zugeordneter ElevenLabs-Beleg" und fuehrt zu KEINEM Schreibzugriff.
      ttsCharacters: sumIntegerField(records, "ttsCharacters"),
    };
  }

  // Kontrolle, deren Fehlen D2 ausmacht: der konfigurierte Tarif wird ab hier DAUERHAFT
  // gegen die Wirklichkeit gehalten. Bezugsgroesse ist AUSSCHLIESSLICH der persistierte
  // estimatedCostCents (P2) - nie ein aus tariffCentsPerMin rekonstruierter Wert.
  //
  // BEWUSSTE, BEGRENZTE ABWEICHUNG: die linke Seite ist USD-Mikro-Cent, die rechte
  // EUR-Cent. In P3 wird NICHT umgerechnet (der Umrechnungskurs Provider->Bucket bekommt
  // seinen Verbraucher erst in P4). Zulaessig, weil diese Zeile eine LOG-Ausgabe ist: sie
  // bewegt kein Geld, speist kein Gate und wird nirgends persistiert. P4 ersetzt den
  // Vergleich durch den umgerechneten.
  function warnOnCostDrift(call, actualMicroCents) {
    const estimateCents = call.estimatedCostCents;
    // Fehlender/0-Schaetzbetrag: KEINE Drift-Aussage (und erst recht kein "keine Drift").
    if (!Number.isSafeInteger(estimateCents) || estimateCents <= 0) return;
    const estimateMicroCents = estimateCents * MICRO_CENTS_PER_CENT;
    const deviationPercent = Math.floor(
      (Math.abs(actualMicroCents - estimateMicroCents) * PERCENT_BASE) / estimateMicroCents,
    );
    if (deviationPercent <= config.billing.costDriftWarnPercent) return;
    console.warn(
      `[cost-truing] Kosten-Drift call=${call.id} ist_usd_mikrocent=${actualMicroCents} ` +
        `schaetzung_eur_cent=${estimateCents} abweichung=${deviationPercent}%`,
    );
  }

  function shouldEmitFinding(key, nowMs) {
    const last = lastFindingMs.get(key);
    if (last !== undefined && nowMs - last < config.billing.costAlertDebounceMs) return false;
    lastFindingMs.set(key, nowMs);
    return true;
  }

  // DER Befundkanal, seit KV2-1 auf dem BESTEHENDEN Betreiber-Meldeweg (Plan 4.9): WARN ->
  // Audit (durabel) -> je nach Stufe Mail+SMS. Er wird hier NICHT neu gebaut - alarmErlaubt/
  // meldeVollBefund/meldeBetreiberNotiz sind dieselben Bausteine wie beim Drift-Waechter
  // (EIN Meldeweg, G5). WAS gemeldet wird, formuliert weiterhin der Aufrufer im detail;
  // der Kanal kennt weder Deckungsquote noch Anfragezahl.
  // Die Inhalts-WARN bleibt die BESTEHENDE Zeile ("[cost-truing] Befund grund=..."): der
  // Meldeweg loggt nur aktion+klasse, das Detail stuende sonst in keiner Log-Zeile mehr.
  // zeile ist zugleich Audit-Detail UND Mail-Body und bleibt deshalb byte-identisch zum
  // Bestandsformat (Log-/Test-Konsumenten) - PII-frei per Vertrag der Aufrufer.
  async function emitFinding(code, detail, nowMs) {
    // Die Bestandscodes sind feste Strings, verglichen ueber die Menge; die drei
    // KV2-6-Klassen tragen den Traeger hinter einem ':' und werden deshalb ueber ihre
    // KLASSE erkannt (istBuchBefundCode). Alle drei melden VOLL (Mail+SMS) - 4.9 fuehrt
    // sie unter demselben Meldeweg, und die Entprellung bleibt der durable Marker je
    // Eimer (meldeVollBefund), inklusive Rueckfall auf die Notiz-Stufe im Entprellfenster.
    const voll = VOLL_BEFUND_CODES.has(code) || istBuchBefundCode(code);
    if (!voll && !shouldEmitFinding(code, nowMs)) return;
    const zeile = `grund=${code} ${detail}`;
    console.warn(`[cost-truing] Befund ${zeile}`);
    const meldung = { store, config, audit, messaging, mailer,
      bucket: kostenBucket(code), aktion: COST_TRUING_AUDIT_EVENT, zeile, nowMs };
    if (voll) await meldeVollBefund(meldung);
    else await meldeBetreiberNotiz(meldung);
  }

  // coverageDetail/coverageStallMs/closeCoverageBefunde sind Modul-Ebene (oben, vor
  // makeCostTruing) - reine Funktionen bzw. store/audit als explizite Parameter statt
  // Closure (G30/G34, F1).
  async function reportCoverage(coveragePercent, coverage, nowMs) {
    const min = config.billing.costTruingMinCoveragePercent;
    console.log(
      `[cost-truing] deckung=${coveragePercent}% schwelle=${min}% ` +
        `ohne_schaetzung=${coverage.noEstimate} nie_beantwortet=${coverage.neverAnswered} ` +
        `ausserhalb_fenster=${coverage.outsideWindow}`,
    );
    if (coveragePercent >= min) {
      await closeCoverageBefunde(store, audit, nowMs);
      return;
    }
    // Marker VOR dem Melden lesen: emitFinding legt ihn sonst gerade erst an, und seit=
    // stuende im ersten Sweep eines Einbruchs auf einem anderen Wert als in den folgenden.
    const marker = openOutageAlert(store.load(), kostenBucket(COST_TRUING_FINDING.COVERAGE_BELOW_THRESHOLD));
    const seitIso = marker ? marker.firstSeenAt : new Date(nowMs).toISOString();
    const detail = coverageDetail(coveragePercent, min, seitIso);
    await emitFinding(COST_TRUING_FINDING.COVERAGE_BELOW_THRESHOLD, detail, nowMs);
    const stallMs = coverageStallMs(config.billing.costTruingCoverageStallSweeps, config.billing.costTruingSweepIntervalMs);
    if (nowMs - Date.parse(seitIso) < stallMs) return;
    await emitFinding(COST_TRUING_FINDING.COVERAGE_STALLED, detail, nowMs);
  }

  // Zaehlt das Ergebnis EINES abgeglichenen Calls in die Sweep-Bilanz ein. Bezugsgroesse
  // ist der PERSISTIERTE truedSource (nicht der rohe measured.source) - die Bilanz zaehlt
  // damit GENAU den Sachverhalt, der am Call landet, und kann ihm nie widersprechen.
  // 'unavailable' (== measured war null: ok:false/leere Antwort/unparsbare Summe): closed
  // -> Versuche erschoepft, dauerhaft 'failed'; offen -> ein spaeterer Lauf bekommt eine
  // neue Chance (unavailable). Sonst nach Herkunft: 'telnyx_detail_records' -> gemessen,
  // 'no_estimate' -> ohne Schaetzbetrag (NIE gemessen), Rest ('incomplete') -> unvollstaendig.
  function countOutcome(tally, truedSource, closed) {
    if (truedSource === COST_TRUING_SOURCE.UNAVAILABLE) {
      if (closed) tally.failed++;
      else tally.unavailable++;
      return;
    }
    if (truedSource === COST_TRUING_SOURCE.DETAIL_RECORDS) tally.measured++;
    else if (truedSource === COST_TRUING_SOURCE.NO_ESTIMATE) tally.noEstimate++;
    else tally.incomplete++;
  }

  // LCT P4, das Herz der Phase: das VOLLSTAENDIGKEITS-Praedikat. Nur wenn ALLE drei
  // Belege vorliegen, darf Geld ZURUECKGEGEBEN werden. Nachgebucht wird immer.
  //   1. source === 'telnyx_detail_records' - gesetzt NUR bei kompletter Pflicht-Menge
  //      (classifyRecords, EINE Quelle; ueber der LEEREN Menge ist das nie wahr).
  //   2. billedSecTotal > 0 - Records ohne abgerechnete Sekunden beweisen nichts.
  //   3. estimatedCostCents ist ein persistierter, buchbarer Betrag (P2) - gegen den
  //      und NUR gegen den wird gerechnet, nie gegen einen neu abgeleiteten Tarif.
  // Die Waehrung steht bewusst NICHT in dieser Liste: P1 verwirft fremdwaehrende
  // Records schon am Adapter, ein zweiter Riegel hier waere eine zweite Wahrheit (G5).
  // Bedingung 1+2 teilt sich diese Funktion seit KV2-5 mit der Reife der
  // telnyx_call_records-Belegzeile (belegVollstaendig, sweep-kostenbeleg.js) - EINE
  // Quelle (G5). Bedingung 3 bleibt hier: sie ist eine Eigenschaft des ANRUFS, nicht des
  // Belegs (Spec (g)).
  function refundProven(call, measured) {
    return (
      belegVollstaendig(measured) &&
      isBookableCents(call.estimatedCostCents)
    );
  }

  // Kein buchbarer Schaetzbetrag -> strukturell nicht korrigierbar. Zwei getrennte
  // Sachverhalte, zwei getrennte Zustaende (kein gemeinsames Label):
  //   - Records VOLLSTAENDIG (measured.source === 'telnyx_detail_records') -> 'no_estimate'
  //     (die Messung ist gut, es fehlt nur der Schaetzbetrag).
  //   - Records unvollstaendig -> es bleibt beim Messproblem 'incomplete' (== measured.source).
  // Beide sind nicht 'telnyx_detail_records', drueckt die Deckungsquote also identisch.
  function truedSourceOf(call, measured) {
    if (isBookableCents(call.estimatedCostCents)) return measured.source;
    return measured.source === COST_TRUING_SOURCE.DETAIL_RECORDS
      ? COST_TRUING_SOURCE.NO_ESTIMATE
      : measured.source;
  }

  // Legt zuerst die Sweep-Belegzeile an (KV2-5(g), immer - unabhaengig vom Ausschluss
  // unten) und bucht danach, sofern erlaubt, die Korrektur EINES abgeglichenen Calls.
  // Reihenfolge ist Absicht: ein fehlender Schaetzbetrag ist eine Eigenschaft des Anrufs
  // und darf nie die Bedeutung "Beleg fehlt" bekommen (Spec (g)); die EL-Route bekommt
  // gerade dann ihre telnyx_sip-Zeile, wenn sie nichts bucht (sweepDarfKorrigieren).
  function belegenUndBuchen(call, measured, records) {
    schreibeSweepKostenbeleg({ store, call, measured, records });
    if (!sweepDarfKorrigieren(call)) return;
    const { booked, deltaCents } = store.applyCostCorrectionCents(call.tenantId, {
      actualCostMicroCents: measured.actualCostMicroCents,
      estimatedCostCents: call.estimatedCostCents,
      providerToBucketRateMicro: config.billing.providerToBucketRateMicro,
      dataComplete: refundProven(call, measured),
      // KS-P5: die Anker der Belastung reisen mit. Ohne sie faellt die Gutschrift auf
      // NO_CHARGE_ANCHORS zurueck und wirkt nur auf der Lebenszeit-Achse.
      chargeAnchors: chargeAnchorsOfCall(call),
    });
    console.log(`[cost-truing] korrektur call=${call.id} delta_eur_cent=${deltaCents} gebucht=${booked}`);
  }

  // ElevenLabs-Zeichen des Calls, PRO TENANT (KE-P6, Plan F6) UND auf dem globalen
  // Plattform-Kontingent-Zaehler (KV-P7, C2: dieser Kommentar behauptete vor KV-P7, der
  // globale Zaehler bliebe unveraendert und stuende auf dem Assistant-Pfad "dauerhaft bei
  // 0" - das stimmte, BEVOR store.recordRelayTtsCharacters existierte, und ist jetzt
  // falsch). Auf dem Assistant-Pfad synthetisiert Telnyx die Stimme serverseitig; genau
  // diesen Verbrauch sah der Kontingent-Zaehler bisher strukturell nie, unabhaengig davon
  // ob Play-TTS an oder aus ist (Klaerung Teil (c), tasks/kv-p7-tts-klaerung.md). Die
  // Warnschwelle/Erschoepfung laeuft ab jetzt ueber DENSELBEN Befundkanal wie die uebrigen
  // Sweep-Befunde (emitFinding: entprellen -> WARN -> Audit) - KEINE SMS: der Play-TTS-Pfad
  // alarmiert dieselbe Schwelle bereits per SMS (server.js), eine zweite Alarmklasse fuer
  // dasselbe Konto waere Kanal-Verdopplung.
  // RIEGEL GEGEN DOPPELZAEHLUNG ist costTruedAt und sonst nichts: eine Messung
  // (measured !== null) setzt closed und damit costTruedAt, der Call ist danach nie wieder
  // Kandidat (isTruingCandidate). Kein zweiter Riegel noetig - ein zweiter waere eine zweite
  // Wahrheit. Gegen VERSCHRAENKUNG zweier Sweeps traegt der Laufriegel sweepRunning.
  // 0 Zeichen -> gar kein Schreibzugriff (ein Anruf ohne zugeordneten ElevenLabs-Beleg darf
  // keine Tenant-Zeile anfassen).
  // KV2-1: sammelt statt sofort zu melden - gemeldet wird NACH der Buchungsschleife (der
  // Meldeweg ist seit dieser Phase asynchron: Marker-Lock, Versand), und ein await IN der
  // Schleife braeche die Zusage "zwischen Pool-Abruf und Bilanz kommt kein await mehr"
  // (D1/PM-5), an der der Schutz gegen verschraenkte Sweeps haengt.
  // sammler HIER statt eines Rueckgabewerts an trueOneCall (G34/C2): trueOneCall traegt
  // bereits die Komplexitaets-Obergrenze dieser Datei (eslint-suppressions.json) - eine
  // weitere Verzweigung dort haette sie ERHOEHT. Die Entscheidung "melden oder nicht"
  // gehoert ohnehin zu DIESER Funktion (sie kennt measured.ttsCharacters/warnung), nicht
  // zur Aufrufer-Schleife.
  // 0 Zeichen -> gar kein Schreibzugriff und kein Befund.
  function bookTtsCharactersFor(call, measured, sammler) {
    if (measured.ttsCharacters <= 0) return;
    const nowMs = now(); // EIN Zeitpunkt, zwei Projektionen (Muster closedAt in trueOneCall)
    const warnung = store.recordRelayTtsCharacters(call.tenantId, measured.ttsCharacters, new Date(nowMs).toISOString());
    if (warnung) sammler.ttsWarnungen.push(warnung);
  }

  async function reportTtsQuotaFinding(warning, nowMs) {
    const code = warning.exhausted
      ? COST_TRUING_FINDING.TTS_QUOTA_EXHAUSTED
      : COST_TRUING_FINDING.TTS_QUOTA_WARN_THRESHOLD;
    await emitFinding(code, `zeichen=${warning.characters}/${warning.quota} zyklus=${warning.cycleKey}`, nowMs);
  }

  // Abruf-Kennzahlen EINER Provider-Antwort, gelesen VOR der Buchbarkeits-Uebersetzung
  // (bookablePool weiter unten): sie beschreiben den ABRUF, nicht die Buchbarkeit. Getrennt
  // gehalten, weil bookablePool eine complete:false-Antwort bewusst zu ok:false verdichtet -
  // die Anfragen waren trotzdem da und muessen im Log erscheinen (sonst waere der
  // Bruchpunkt-Waechter ausgerechnet im Stoerfall blind).
  // `incomplete` heisst "dieser Abruf hat KEIN vollstaendiges Bild geliefert" - ok:false und
  // complete:false sind darin dasselbe.
  const nonNegativeCount = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : 0);

  function poolFetchStats(pool) {
    return {
      requests: nonNegativeCount(pool?.requests),
      pages: nonNegativeCount(pool?.pages),
      records: Array.isArray(pool?.raw) ? pool.raw.length : 0,
      incomplete: !(pool?.ok === true && pool.complete !== false),
    };
  }

  function emptyFetchTally() {
    return { requests: 0, pages: 0, records: 0, incompletePools: 0 };
  }

  function addPoolFetchStats(fetchTally, stats) {
    fetchTally.requests += stats.requests;
    fetchTally.pages += stats.pages;
    fetchTally.records += stats.records;
    if (stats.incomplete) fetchTally.incompletePools++;
  }

  // "Kein Abgleich moeglich": unbekannter Provider (die Registry wirft fail-closed) oder ein
  // Adapter ohne die beiden Beleg-Methoden - sie sind OPTIONAL am Port, nicht jeder Carrier
  // liefert Einzelbelege (bis C-P4 war Twilio genau dieser Fall). EINE
  // Entscheidung an EINER Stelle (G5). SYNCHRON und ohne Netz - genau deshalb steht die
  // Aufloesung ab KE-P9 VOR dem Abruf zur Verfuegung, statt als dessen Nebenprodukt zu
  // entstehen; ein zweiter Netz-Zugriff kommt dadurch NICHT hinzu (PM-5).
  function costRecordControlFor(provider) {
    let control;
    try {
      control = voiceControl(provider);
    } catch {
      return null;
    }
    const hasCostRecordMethods =
      typeof control.fetchCostRecordPool === "function" && typeof control.assignCostRecords === "function";
    return hasCostRecordMethods ? control : null;
  }

  // DIE Bedingung "abrufbar" (KE-P9), an GENAU EINER Stelle formuliert: ohne belegfaehigen
  // Adapter oder ohne aufloesbare Leg-Referenz ist ein Call strukturell nie abgleichbar. Er
  // darf deshalb weder den UMFANG des Belegabrufs (welche Provider) noch dessen ZEITSCHRANKE
  // bestimmen - ein einziger solcher Call fror `since` sonst dauerhaft ein, und der Pool
  // wuchs mit dem gesamten Kontoverkehr, bis die Seitenobergrenze reisst und ALLE Kandidaten
  // unavailable werden (keine Rueckerstattung mehr, fuer niemanden).
  // Zwei getrennt gepflegte Fassungen dieser Bedingung waeren der Fehlertyp, der in dieser
  // Kette schon dreimal gefangen wurde: ein Call fiele still aus dem Abruffenster und wuerde
  // trotzdem abgeglichen - oder umgekehrt.
  // Fehlende Faehigkeit bleibt der konservative Fall: der Call bleibt im NENNER der
  // Deckungsquote und drueckt sie, statt sie zu beschoenigen.
  const isRetrievable = (call, control) => control !== null && providerLegIdOf(call) !== null;

  // Jeder in diesem Sweep vorkommende Provider genau EINMAL aufgeloest. Rein synchron; die
  // Map ist die EINE Wahrheit, aus der sowohl der Abruf-Filter als auch der Abruf selbst
  // liest (kein zweites voiceControl-Ergebnis, das abweichen koennte).
  function costRecordControlsFor(candidates) {
    const controls = new Map();
    for (const call of candidates)
      if (!controls.has(call.provider)) controls.set(call.provider, costRecordControlFor(call.provider));
    return controls;
  }

  // Nur ein VOLLSTAENDIGER Pool darf Geld bewegen: gegen eine bewiesene Untermenge erstattet
  // die Korrektur real ausgegebenes Geld zurueck - die fail-OPEN-Richtung im Geldpfad.
  // complete:false ist deshalb dasselbe wie ok:false, uebersetzt an genau EINER Stelle.
  function bookablePool(pool) {
    if (!pool?.ok) return pool ?? { ok: false };
    return pool.complete === false ? { ok: false, reason: POOL_INCOMPLETE_REASON } : pool;
  }

  // Der Belegabruf EINES Providers - genau EINMAL je Sweep (D1: der Abruf ist
  // schleifeninvariant, die Query kennt weder legId noch Zeitfenster). `since` bindet
  // ausschliesslich die Seitenschleife des Adapters und geht NIE als Query-Parameter
  // hinaus - ein geratener Zeitfilter liefert HTTP 200 mit 0 Treffern (Messung, s. ports.js).
  // Bekommt die BEREITS aufgeloeste Belegsteuerung herein (KE-P9): dass dieser Adapter
  // belegfaehig ist, wurde beim Auswaehlen der abrufbaren Kandidaten entschieden und wird
  // hier nicht ein zweites Mal beurteilt.
  async function fetchCostRecordPoolFor(control, since) {
    try {
      const answer = await control.fetchCostRecordPool({ since });
      return { control, pool: bookablePool(answer), stats: poolFetchStats(answer) };
    } catch {
      // der Port WIRFT NIE - zweite Linie. Kein zaehlbarer Abruf, aber auch kein
      // vollstaendiges Bild (poolFetchStats(null) -> incomplete:true).
      return { control, pool: { ok: false }, stats: poolFetchStats(null) };
    }
  }

  // Ein Pool je vorkommendem Provider der ABRUFBAREN Kandidaten, jeder Provider genau einmal.
  // Die Kandidatenliste bestimmt die Menge - kein Providername im Billing-Pfad (DIP). Kein
  // abrufbarer Kandidat -> kein Abruf: die Schleife laeuft nicht, 0 Anfragen (KE-P9; genau
  // derselbe Ausgang wie "gar keine Kandidaten").
  // EINE Zeitschranke je Sweep, VOR der Schleife bestimmt: sie haengt an der Kandidatenmenge,
  // nicht am Provider - je Provider neu zu rechnen waere dieselbe Zahl zweimal (G5). Gebildet
  // ueber ALLE abrufbaren Kandidaten, nie ueber eine Teilmenge davon: eine zu weit nach vorn
  // gerutschte Schranke verloere Belege und meldete den Pool trotzdem als vollstaendig - die
  // fail-OPEN-Richtung im Geldpfad (s. POOL_SINCE_MARGIN_MS).
  // Rein synchron ausserhalb des Abrufs, also kein zusaetzliches Netz-await (PM-5).
  async function fetchCostRecordPools(retrievable, controls) {
    const since = poolSinceFor(retrievable);
    const pools = new Map();
    const fetchTally = emptyFetchTally();
    for (const call of retrievable) {
      if (pools.has(call.provider)) continue;
      const fetched = await fetchCostRecordPoolFor(controls.get(call.provider), since);
      pools.set(call.provider, fetched);
      addPoolFetchStats(fetchTally, fetched.stats);
    }
    return { pools, fetchTally };
  }

  // SYNCHRON (KE-P2/PM-5): zwischen Pool-Abruf und Buchungsschleife liegt strukturell kein
  // Netz-await mehr. Provideraufloesung und Faehigkeitspruefung sind in costRecordControlFor
  // gewandert (EINE Entscheidung, EINE Stelle). Ab KE-P9 laeuft die Schleife ausschliesslich
  // ueber ABRUFBARE Kandidaten (isRetrievable) - control und legId sind hier deshalb
  // strukturell vorhanden, ein Ueberspring-Zweig waere toter Code. Wer nicht abrufbar ist,
  // erreicht diese Funktion nie und bleibt ein vollstaendiges No-op (kein Wurf, KEIN
  // Feld-Schreiben, KEIN verbrauchter Versuch).
  function trueOneCall(call, { control, pool }, sammler) {
    const legId = providerLegIdOf(call);
    let result;
    try {
      // Ein nicht nutzbarer Pool laesst ALLE Kandidaten 'unavailable' - kein Teilerfolg, keine
      // Herkunft 'telnyx_detail_records', keine Rueckerstattung. Der Versuchszaehler steigt
      // je Kandidat genau einmal, exakt wie bei einem ok:false-Abruf im Bestand.
      result = pool.ok
        ? control.assignCostRecords(pool, { legId, startedAt: call.startedAt, endedAt: call.endedAt })
        : pool;
    } catch {
      result = { ok: false }; // der Port WIRFT NIE - zweite Linie, nie ein Sweep-Abbruch
    }

    // ok:false, leere Antwort und unparsbare Summe sind IM TYP von einer gemessenen Null
    // unterscheidbar (P1) und heissen NIEMALS "keine Kosten" (PM-4).
    const measured = result?.ok
      ? classifyRecords(result.records, pflichttypenVon(call, config.billing))
      : null;
    const attempt = nextCostTruingAttempt(call);
    const closed = measured !== null || attempt >= config.billing.costTruingMaxAttempts;
    // EINE Herkunfts-Bestimmung fuer Persistenz UND Bilanz (G5): countOutcome zaehlt exakt
    // den Wert, der am Call landet - kein zweites, aus measured.source neu abgeleitetes Urteil.
    const truedSource = measured ? truedSourceOf(call, measured) : COST_TRUING_SOURCE.UNAVAILABLE;

    store.recordCallCostTruingResult(call.id, {
      source: truedSource,
      actualCostMicroCents: measured ? measured.actualCostMicroCents : null,
      closedAt: closed ? new Date(now()).toISOString() : null,
    });

    if (measured) warnOnCostDrift(call, measured.actualCostMicroCents);
    // LCT P4: der Flip. Idempotenz traegt costTruedAt (oben gesetzt) - ein zweiter Lauf
    // sieht den Call nicht mehr als Kandidaten; gegen VERSCHRAENKUNG traegt der
    // Laufriegel aus P3. Hier ist deshalb KEIN dritter Riegel noetig.
    if (measured) belegenUndBuchen(call, measured, result.records);
    if (measured) bookTtsCharactersFor(call, measured, sammler);
    countOutcome(sammler.tally, truedSource, closed);
  }

  // Der SMS-Versand ist ECHT und KOSTENPFLICHTIG. Die Kostenklemme ist die Entprellung:
  // hoechstens EINE Meldung je Praefix und Befund-Code je COST_ALERT_DEBOUNCE_MS (24 h) ->
  // bei 3 Praefixen x 3 alarmierenden Codes (ALERTABLE_DRIFT_CODES) maximal 9 SMS am Tag,
  // statt einer Meldung je Befund und Sweep. Der Schluessel traegt den Code,
  // conversion_error entprellt also getrennt von under-/overestimate.
  //
  // Versand ueber den geteilten Bootstrap-Alarm-Baustein (G5, EINE Quelle mit der
  // ElevenLabs-Kontingent-Warnung LCT P7): Empfaenger-Riegel, Bootstrap-Absender (die
  // eigene Betreiber-Nummer, NIE die DID eines Kunden), try/catch und fire-and-forget
  // liegen alle dort. Ein Alarm darf einen Sweep nie abbrechen. Das Ziel
  // (platformAlertSmsTo) wird NIE geloggt.
  function alertDrift(entry, nowMs) {
    if (!shouldEmitFinding(`${entry.prefix} ${entry.code}`, nowMs)) return;
    const detail = driftLine(entry);
    console.warn(`[cost-truing] Tarif-Drift ${detail}`);
    audit(TARIFF_DRIFT_AUDIT_EVENT, null, detail); // req=null -> ip=system
    sendBootstrapAlertSms({ messaging, config, store, prefix: DRIFT_ALERT_SMS_PREFIX, detail, logTag: "cost-truing" });
  }

  // Ausloeser 2 von 2 (Laufzeit). Der Boot-Guard allein genuegt NICHT: er feuert einmal je
  // Prozessstart, und ein Dienst, der nach dem Deploy wochenlang ohne Restart laeuft,
  // wertet genau in dem Zeitraum nicht aus, in dem sich P4 auf P5 als Gegenmassnahme
  // stuetzt. insufficient_samples wird GELOGGT, aber NIE alarmiert (alertableDriftFindings).
  function reportTariffDrift(state, nowMs) {
    const report = tariffDriftReportFromConfig(state.calls, config.billing);
    console.log(`[cost-truing] tarif-drift ${report.map(driftLine).join(" | ")}`);
    for (const entry of alertableDriftFindings(report)) alertDrift(entry, nowMs);
  }

  // Die Sweep-Bilanz als EINE Zeile. Das Format ist TESTGEPINNT: es ist die Datenquelle des
  // Bruchpunkt-Waechters (KE-P8) und liefert B = pool/kandidaten aus der Wirklichkeit (U9).
  // Die Bestandsfelder und ihre Reihenfolge bleiben unveraendert (Log-Konsumenten), die vier
  // Abruf-Felder kommen HINTEN dazu.
  // vollstaendig=true heisst "kein unvollstaendiger Abruf in diesem Sweep" - bei 0 Kandidaten
  // (0 Abrufe) also ebenfalls true; die daneben stehenden anfragen=0 pool=0 machen den Fall
  // eindeutig. Bewusst als Zaehler formuliert und nicht als Allquantor ueber der leeren Menge:
  // "nichts Unvollstaendiges beobachtet" ist eine Beobachtung, "alles vollstaendig" waere eine
  // Behauptung (dieselbe Falle wie die leere Pflicht-Menge in classifyRecords).
  // KV2-1 (Kriterium (d)): kanaele= nennt, ueber welche Betreiber-Kanaele die Befunde
  // dieses Sweeps ueberhaupt hinauskaemen. Es ist die Gegenprobe zu der bewusst
  // beibehaltenen Meldeweg-Semantik "kein Mail-Ziel gilt als zugestellt"
  // (outage-report.js#sendeUeberBeideKanaele, Plan 4.9): kanaele=keine heisst, dass jede
  // Meldung dieses Sweeps ausschliesslich im Log und in audit_log steht. Nur Kanal-ARTEN,
  // nie die Ziele.
  function logSweepLine({ trigger, candidateCount, tally, fetchTally, kanaele, buch }) {
    console.log(
      `[cost-truing] sweep trigger=${trigger} kandidaten=${candidateCount} ` +
        `gemessen=${tally.measured} unvollstaendig=${tally.incomplete} ` +
        `ohne_schaetzung=${tally.noEstimate} ` +
        `unbestimmt=${tally.unavailable} uebersprungen=${tally.skippedCalls} ` +
        `anfragen=${fetchTally.requests} seiten=${fetchTally.pages} ` +
        `pool=${fetchTally.records} vollstaendig=${fetchTally.incompletePools === 0} ` +
        `kanaele=${kanaele} ${buch.zeile}`,
    );
  }

  // KE-P8, der Bruchpunkt-Waechter: meldet, wenn EIN Sweep mehr Anfragen zieht als die
  // Betriebsschwelle erlaubt. Die Zahl selbst steht schon in der Sweep-Zeile (anfragen=) -
  // hier kommt KEINE zweite Log-Zeile dazu, nur der entprellte Befund. Gemeldet wird ein
  // VOLUMEN, kein Fehler: der Sweep bleibt korrekt, er waechst nur aus seinem Intervall
  // heraus (Gegenmassnahme: Plan Kap. 3, Stufe 1 - Fenster verschmaelern).
  // Dieselbe Quelle wie das Log (fetchTally), damit Befund und Zeile nie auseinanderlaufen.
  async function reportFetchVolume(fetchTally, nowMs) {
    if (fetchTally.requests <= SWEEP_REQUESTS_WARN_THRESHOLD) return;
    await emitFinding(
      COST_TRUING_FINDING.REQUESTS_ABOVE_THRESHOLD,
      `anfragen=${fetchTally.requests} schwelle=${SWEEP_REQUESTS_WARN_THRESHOLD}`,
      nowMs,
    );
  }

  async function sweepAllCandidates(trigger) {
    const nowMs = now();
    // Kandidaten-Schnappschuss VOR den awaits: ein Call, der waehrend des Sweeps endet,
    // ist ohnehin erst nach COST_TRUING_DELAY_MINUTES faellig und kommt im naechsten Lauf.
    const candidates = store.load().calls.filter((c) => isTruingCandidate(c, nowMs));
    // KE-P9: ab hier arbeitet der Sweep auf den ABRUFBAREN Kandidaten. Sie allein bestimmen
    // Umfang und Zeitschranke des Belegabrufs UND durchlaufen die Buchungsschleife - beide
    // Seiten lesen dieselbe Bedingung (isRetrievable) und dieselben controls, sie koennen
    // nicht auseinanderlaufen. Rein synchron, noch vor jedem await.
    const controls = costRecordControlsFor(candidates);
    const retrievable = candidates.filter((c) => isRetrievable(c, controls.get(c.provider)));
    // Strukturell nie abgleichbar (keine Leg-Referenz / kein belegfaehiger Adapter): kein
    // Abruf, kein Schreibzugriff, kein verbrauchter Versuch. Sie bleiben Kandidaten und
    // erscheinen unveraendert als uebersprungen= (Owner-Entscheidung: nur Abruf-Filter).
    const skippedCalls = candidates.length - retrievable.length;
    // D1: der Abruf ist schleifeninvariant und laeuft EINMAL je Provider - VOR der Schleife.
    // Ab hier bis zur Bilanz kommt kein Netz-await mehr (PM-5): zwei verschraenkte Sweeps
    // koennen sich hier nicht mehr dazwischenschieben.
    // pools ist aus GENAU DIESER retrievable-Liste gebaut, ueber die die Schleife laeuft -
    // deshalb liefert pools.get() hier nie undefined.
    const { pools, fetchTally } = await fetchCostRecordPools(retrievable, controls);
    const tally = { measured: 0, incomplete: 0, noEstimate: 0, unavailable: 0, skippedCalls, failed: 0 };
    const sammler = { tally, ttsWarnungen: [] };
    for (const call of retrievable) trueOneCall(call, pools.get(call.provider), sammler);
    // EIN Breakdown (coverageBreakdown), aus dem SOWOHL die Quote ALS AUCH die drei
    // Nebenzaehler abgeleitet werden (KV-M3, G5) - keine zweite Iteration ueber
    // state.calls, kein zweiter Formel-Ausdruck.
    const coverage = coverageBreakdown(store.load(), nowMs);
    const coveragePercent = percentFromBreakdown(coverage);
    // KV2-6: die zweite, unabhaengige Kennzahl - Deckung JE TRAEGER aus dem Kosten-Buch
    // plus der faelligkeits-unabhaengige Herzschlag. Rein synchron, ohne Netz: sie liest
    // denselben In-Memory-Spiegel und faellt damit nicht unter die PM-5-Zusage.
    const buch =
      kostenBuchBericht({ state: store.load(), billing: config.billing, nowMs, deckungFensterMs: PROVIDER_COST_RECORD_WINDOW_MS });
    const kanaele = alarmKanalZeile(betreiberAlarmKanaele({ billing: config.billing, mail: config.mail }));
    logSweepLine({ trigger, candidateCount: candidates.length, tally, fetchTally, kanaele, buch });
    // Ab hier meldet der Sweep - NACH der Bilanz, also ausserhalb der PM-5-Zusage.
    await reportFetchVolume(fetchTally, nowMs);
    for (const warnung of sammler.ttsWarnungen) await reportTtsQuotaFinding(warnung, nowMs);
    await reportCoverage(coveragePercent, coverage, nowMs);
    for (const befund of buch.befunde) await emitFinding(befund.code, befund.detail, nowMs);
    reportTariffDrift(store.load(), nowMs);
    return {
      skipped: false,
      candidates: candidates.length,
      coveragePercent,
      // KV-M3: eigene, coverage-praefigierte Felder - NICHT noEstimate pur, das existiert
      // bereits in tally (Ergebnis-Bilanz DIESES Sweeps, COST_TRUING_SOURCE.NO_ESTIMATE-
      // Ausgang) und misst etwas anderes als dieser, ueber ALLE beendeten Calls gebildete
      // Denominator-Ausschluss (G11: keine Namenskollision mit zwei Bedeutungen).
      coverageNoEstimate: coverage.noEstimate,
      coverageNeverAnswered: coverage.neverAnswered,
      coverageOutsideWindow: coverage.outsideWindow,
      ...tally,
    };
  }

  async function runCostTruingSweep({ trigger }) {
    if (sweepRunning) {
      console.log(`[cost-truing] Lauf laeuft bereits - trigger=${trigger} verworfen (No-op)`);
      return { skipped: true, reason: SWEEP_RUNNING_REASON };
    }
    sweepRunning = true;
    try {
      return await sweepAllCandidates(trigger);
    } finally {
      sweepRunning = false;
    }
  }

  return { runCostTruingSweep };
}
