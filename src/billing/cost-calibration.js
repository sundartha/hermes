// LCT P5 (Drift-Waechter): misst den IST-Minutensatz je Ziel-Praefix gegen den
// KONFIGURIERTEN Reserve-Tarif und meldet die Abweichung. JUSTIERT NICHTS -
// Owner-Entscheidung 3 (2026-07-20): keine rollende Selbstkalibrierung. Ein Tarif,
// der sich aus Anrufen speist, die das Gate durchgelassen hat, ist die Rueckkopplung
// aus PM-2; ein dummer, aber vorhersagbarer Wert ist hier die bessere Eigenschaft.
// tariffCentsPerMin (src/telephony/outbound-gates.js) wird von dieser Phase NICHT
// importiert und NICHT beruehrt. Seit P5 wird nur das reine Praefix-Praedikat
// hasCountryPrefix aus demselben Modul geteilt (EINE Praefix-Frage, kein Tarif-Lookup).
import {
  MICRO_CENTS_PER_CENT,
  PROVIDER_RATE_SCALE,
  isProviderMicroCents,
  istBeweisendeHerkunft,
} from "../store/defaults.js";
import { hasCountryPrefix } from "../telephony/outbound-gates.js";
import { voiceMinutesOf } from "./metering.js";
// KV2-10: Route = Kostenprofil der Engine-Weiche; EINE Quelle (G5), keine hier gepflegte
// zweite Routen-Liste. Beide Importe sind zyklus-frei (kostenarten.js ist importfrei,
// kosten-projektion.js importiert cost-calibration.js nicht).
import { KOSTENPROFIL, kostenprofilFuerAnruf } from "./kostenarten.js";
import { settlementProjektion } from "./kosten-projektion.js";
import { LEERE_LISTE } from "./kosten-abschluss.js";

// Groesse des rollenden Fensters: die juengsten N abgeglichenen Calls je Praefix.
// KEINE Env (G35): der Operator steuert die Aussagekraft ueber die Mindest-Stichprobe,
// nicht ueber die Fensterlaenge; eine zweite Zahl mit fast gleicher Bedeutung liefe beim
// ersten Nachziehen auseinander. 100 = fuenffache Default-Mindeststichprobe, damit eine
// echte Tarifaenderung innerhalb von rund 100 Calls je Praefix sichtbar wird.
export const DRIFT_SAMPLE_WINDOW = 100;

// Nearest-Rank-Perzentil, GANZZAHLIG (kein Interpolieren, keine Floats auf dem
// Geld-Pfad). p95 und NICHT Mittelwert: der Mittelwert verduennt genau den ersten
// teuren Anruf einer neuen Destination (PM-5). p95 und NICHT max: ein einzelner
// Ausreisser darf den Waechter nicht dauerhaft schreien lassen.
const DRIFT_PERCENTILE = 95;
const PERCENT_BASE = 100;

export const TARIFF_DRIFT_FINDING = Object.freeze({
  UNDERESTIMATE: "underestimate", // Tarif UNTER dem gemessenen p95 - Reserve deckt den Anruf nicht
  OVERESTIMATE: "overestimate", // Tarif ueber p95 um > warnPercent - die Vorfalls-Richtung
  INSUFFICIENT_SAMPLES: "insufficient_samples", // zu wenig Daten - KEIN Alarm, aber sichtbar
  // Die Stichprobe LAG VOR, aber die Waehrungs-Umrechnung verliess den sicheren
  // Integer-Bereich (providerMicroCentsToBucketCents -> null). EIGENER Code und ALARMIERBAR:
  // faellt er mit insufficient_samples zusammen, verstummt der Waechter lautlos genau in dem
  // Extremfall, den er entdecken soll (ein absurder actualCostMicroCents), und sieht dabei
  // aus wie harmlose Datenknappheit. Ein Rechenfehler auf dem Geld-Pfad ist ein Befund,
  // kein Nicht-Ereignis.
  CONVERSION_ERROR: "conversion_error",
});

// Die EINE Stelle, an der steht, WELCHE Befunde alarmieren (G27: Struktur statt verstreuter
// if-Bedingungen). null ("im Band") und insufficient_samples stehen bewusst NICHT drin -
// sonst wird der Kanal taub trainiert.
const ALERTABLE_DRIFT_CODES = Object.freeze([
  TARIFF_DRIFT_FINDING.UNDERESTIMATE,
  TARIFF_DRIFT_FINDING.OVERESTIMATE,
  TARIFF_DRIFT_FINDING.CONVERSION_ERROR,
]);

// Nur BEWIESEN vollstaendig abgeglichene Calls sind Stichproben - seit KV2-8 zwei
// Herkunftswerte (Bestandszeilen 'telnyx_detail_records', neue Settlements
// 'kostenbuch_vollbeleg'), abgefragt ueber die EINE Quelle in defaults.js statt ueber eine
// hier gepflegte zweite Liste (G5). 'kostenbuch_teilbeleg' ist wie 'incomplete'
// systematisch ZU NIEDRIG und bleibt draussen - sonst alarmierte der Waechter gegen seine
// eigene Datenluecke.
// 'incomplete' ist systematisch ZU NIEDRIG - liesse man es zu,
// erzeugte die lueckenhafte Messung selbst den Befund 'overestimate' und der Waechter
// alarmierte gegen seine eigene Datenluecke (P4-Risiko/PM-8).
// Praefix an BEIDEN Enden (P5, Herkunfts-Achse): Stichprobe ist nur, was auch zum
// Inlandssatz tarifiert WURDE. Ein Leg von einer auslaendischen DID trifft den
// Default-Satz - es gegen voiceTariffDomesticCents zu messen, verglich zwei
// verschiedene Groessen.
function isDriftSample(call, prefix) {
  return (
    istBeweisendeHerkunft(call.costTruedSource) &&
    hasCountryPrefix(call.to, prefix) &&
    hasCountryPrefix(call.from, prefix)
  );
}

// Ist-Satz EINES Calls in PROVIDER-Mikro-Cent je Minute (heute USD - hier wird NICHT
// umgerechnet, das passiert an genau einer Stelle, s. providerMicroCentsToBucketCents).
// Aufrunden: der gemessene Wert treibt den Vergleich, und ein hoeherer Messwert macht den
// GEFAEHRLICHEN Befund (underestimate) wahrscheinlicher - im Zweifel die Richtung, die
// mehr sieht. Minuten kommen aus voiceMinutesOf (EINE Minuten-Quelle, G5, dieselbe, gegen
// die reconcileVoiceBudget gebucht hat). null bei 0 Minuten / unsicherem Integer.
function providerMicroCentsPerMinOf(call) {
  const minutes = voiceMinutesOf(call);
  if (minutes <= 0) return null;
  if (!Number.isSafeInteger(call.actualCostMicroCents) || call.actualCostMicroCents < 0) return null;
  return Math.ceil(call.actualCostMicroCents / minutes);
}

// Nearest-Rank-Perzentil EINES aufsteigend sortierten Ganzzahl-Feldes (KV2-10, G5: EIN
// Idiom fuer den Praefix- UND den Routen-Waechter, vorher stand der Rang-Ausdruck nur in
// measuredCentsPerMinByPrefix). werte MUSS aufsteigend sortiert sein; n <= 20 liefert fuer
// p95 den Hoechstwert (Rank ceil(0,95*8) = 8) - ein einzelner Ausreisser traegt dann allerdings
// auch den ganzen Wert; das ist die bekannte p95-Eigenschaft, keine neue.
export function nearestRankWert(werte, percent) {
  const rank = Math.ceil((werte.length * percent) / PERCENT_BASE) - 1;
  return werte[rank];
}

// REINE Funktion, KEIN Zeitzugriff im Rumpf (Muster voiceMinutesUsedSince: was nach
// "zuletzt" aussieht, kommt aus den Daten - endedAt -, nie aus der Uhr).
// Liefert { samples, p95ProviderMicroCentsPerMin } - die EINHEIT steht im Feldnamen,
// weil die Funktion einen Datensatz und keinen nackten Skalar liefert.
// samples === 0 -> p95 ist null (nie 0: "nicht gemessen" ist nicht "kostet nichts", PM-4).
export function measuredCentsPerMinByPrefix(calls, prefix) {
  const rates = calls
    .filter((c) => isDriftSample(c, prefix))
    .slice() // Kopie: der Aufrufer-State wird NIE sortiert
    .sort((a, b) => (a.endedAt < b.endedAt ? 1 : -1)) // juengste zuerst
    .slice(0, DRIFT_SAMPLE_WINDOW)
    .map(providerMicroCentsPerMinOf)
    .filter((r) => r !== null)
    .sort((a, b) => a - b); // aufsteigend fuer den Rang
  if (rates.length === 0) return { samples: 0, p95ProviderMicroCentsPerMin: null };
  return { samples: rates.length, p95ProviderMicroCentsPerMin: nearestRankWert(rates, DRIFT_PERCENTILE) };
}

// WAEHRUNGSRICHTUNG, explizit - in der Planungsphase zweimal die Wurzel eines Befundes:
//   LINKS  = actualCostMicroCents = PROVIDER-Waehrung (USD), Mikro-Cent
//   RECHTS = voiceTariffDomesticCents = BUCKET-Waehrung (EUR), GANZE Cent
// rateMicro = PROVIDER_TO_BUCKET_RATE_MICRO = wie viel Bucket-Waehrung auf eine Einheit
// Provider-Waehrung entfaellt, in Mikro-Einheiten (920000 = 0,92 EUR je USD). Also
// MULTIPLIZIEREN, nie dividieren: 100 USD-ct -> 92 EUR-ct. Die falsche Richtung machte
// aus 100 USD-ct 108,7 EUR-ct und meldete Unterschaetzung, wo keine ist. Aufgerundet
// (Math.ceil) - dieselbe Richtung wie oben.
export function providerMicroCentsToBucketCents(providerMicroCents, rateMicro) {
  const product = providerMicroCents * rateMicro;
  if (!Number.isSafeInteger(product)) return null; // zweite Linie, nie stillschweigend 0
  return Math.ceil(product / (MICRO_CENTS_PER_CENT * PROVIDER_RATE_SCALE));
}

// Klassifikation, Ganzzahl-Arithmetik, keine Division:
// configured < measured -> underestimate (OHNE Toleranz - die gefaehrliche Richtung wird
// nicht wegtoleriert). (configured - measured) * 100 > measured * warnPercent -> overestimate.
// sonst null ("im Band").
function classifyDrift(configuredCentsPerMin, measuredCentsPerMin, warnPercent) {
  if (configuredCentsPerMin < measuredCentsPerMin) return TARIFF_DRIFT_FINDING.UNDERESTIMATE;
  if ((configuredCentsPerMin - measuredCentsPerMin) * PERCENT_BASE > measuredCentsPerMin * warnPercent)
    return TARIFF_DRIFT_FINDING.OVERESTIMATE;
  return null;
}

// Ein Eintrag EINES Praefixes: misst, entscheidet insufficient_samples VOR jeder
// Tarif-Aussage, konvertiert dann in die Bucket-Waehrung und klassifiziert. F1 (<=3
// Argumente): die vier Konfig-Groessen reisen als EIN params-Objekt (sie gehoeren
// zusammen - derselbe Aufruf braucht immer alle vier). Beide Ausstiege OHNE Messwert
// setzen measuredCentsPerMin auf null, nie auf 0 (PM-4), unterscheiden sich aber im Code -
// samples reist in JEDEM Fall mit und trennt "keine Daten" von "Daten, aber Rechenfehler".
function driftEntryForPrefix(prefix, calls, params) {
  const { configuredCentsPerMin, providerToBucketRateMicro, minSamples, warnPercent } = params;
  const { samples, p95ProviderMicroCentsPerMin } = measuredCentsPerMinByPrefix(calls, prefix);
  const base = { prefix, samples, configuredCentsPerMin, measuredCentsPerMin: null };
  if (samples < minSamples) return { ...base, code: TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES };
  const measuredCentsPerMin = providerMicroCentsToBucketCents(p95ProviderMicroCentsPerMin, providerToBucketRateMicro);
  if (measuredCentsPerMin === null) return { ...base, code: TARIFF_DRIFT_FINDING.CONVERSION_ERROR };
  return { ...base, code: classifyDrift(configuredCentsPerMin, measuredCentsPerMin, warnPercent), measuredCentsPerMin };
}

// Eintraege: { prefix, code, samples, measuredCentsPerMin, configuredCentsPerMin }
// code === null heisst "im Band". insufficient_samples und conversion_error ->
// measuredCentsPerMin === null, samples IMMER gesetzt: "kein Alarm", "zu wenig Daten" und
// "Umrechnung gescheitert" duerfen nicht dieselbe Beobachtung sein - P4b haengt sein
// Abnahmekriterium genau daran.
export function tariffDriftReport({ calls, prefixes, ...params }) {
  return prefixes.map((prefix) => driftEntryForPrefix(prefix, calls, params));
}

// EINE Stelle, die config -> reine Argumente uebersetzt (G5): Boot-Guard, Sweep und
// Lese-Endpunkt bauen den Aufruf NICHT je selbst zusammen. configuredCentsPerMin ist
// voiceTariffDomesticCents, weil ALLE bewerteten Praefixe aus voiceTariffDomesticPrefixes
// stammen und der Inlandssatz genau fuer die Legs gilt, die diesen Praefix an BEIDEN Enden
// tragen (P5) - genau die filtert isDriftSample. Legs OHNE diesen doppelten Treffer werden
// bewusst NICHT bewertet (sie fallen auf voiceTariffDefaultCents, den harten Worst-Case-
// Deckel, PM-5) und keinem Praefix zugeschlagen. warnPercent teilt sich
// costDriftWarnPercent mit dem P3-Kosten-Drift-Log (dieselbe Toleranzschwelle, EINE Quelle).
export function tariffDriftReportFromConfig(calls, billing) {
  return tariffDriftReport({
    calls,
    prefixes: billing.voiceTariffDomesticPrefixes,
    configuredCentsPerMin: billing.voiceTariffDomesticCents,
    providerToBucketRateMicro: billing.providerToBucketRateMicro,
    minSamples: billing.costCalibrationMinSamples,
    warnPercent: billing.costDriftWarnPercent,
  });
}

// Der Filter gegen ALERTABLE_DRIFT_CODES, nicht gegen verstreute if-Bedingungen. Die
// Entprellung des Aufrufers greift je Praefix UND Code, also auch fuer conversion_error.
export function alertableDriftFindings(report) {
  return report.filter((e) => ALERTABLE_DRIFT_CODES.includes(e.code));
}

// Eine PII-freie Zeile je Eintrag (Praefix wie "+49" ist keine Rufnummer). Nennt
// IMMER stichproben=; bei insufficient_samples zusaetzlich fenster= (laut, nicht still -
// eine Fehlkonfiguration wie minSamples > DRIFT_SAMPLE_WINDOW bleibt sichtbar statt
// als stiller Dauer-Alarm-Ausfall). conversion_error nennt KEIN fenster= (die Daten waren
// da) und behauptet auch keinen Messwert - "gemessen=null" laese sich als 0 lesen.
export function driftLine(entry) {
  const head = `praefix=${entry.prefix} stichproben=${entry.samples}`;
  if (entry.code === TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES)
    return `${head} fenster=${DRIFT_SAMPLE_WINDOW} befund=${entry.code}`;
  const configured = `konfiguriert=${entry.configuredCentsPerMin}ct`;
  const befund = `befund=${entry.code ?? "im_band"}`;
  if (entry.code === TARIFF_DRIFT_FINDING.CONVERSION_ERROR) return `${head} ${configured} ${befund}`;
  return `${head} ${configured} gemessen=${entry.measuredCentsPerMin}ct ${befund}`;
}

// ---- KV2-10 (Plan 5/KV2-10, Owner-Entscheidungen 5+6): Tarifpaar-Waechter je Route ----
// Misst - justiert NICHT (Owner-Entscheidung 6, 2026-08-30: der Waechter misst und
// alarmiert, die Zahl setzt ein Mensch; der Kopfkommentar dieser Datei bleibt Wahrheit).
// Der Tarif ist ZWEITEILIG (Owner-Entscheidung 5): Grundbetrag je ANRUF plus Minutensatz,
// je Route (Kostenprofil der Engine-Weiche) - die EL-Kosten haben einen grossen fixen
// Anteil je Anruf, und Telnyx rundet immer auf die volle Minute auf; ein einzelner
// Minutensatz muesste den 8-Sekunden-Anruf decken und ueberzahlte jeden langen.
//
// VOLLKOSTEN je Anruf = Belegsumme (alle Traeger, Provider-Mikro -> Bucket ueber DIE EINE
// Kursfunktion) PLUS Eigen-Cent (Katalogzeilen #4 ai_token und #5 research_fee - sie fallen
// auch auf dem EL-Weg an, AUFTRAG B2/R9-2). Fuer die Eigen-Achsen existiert KEINE
// je-Anruf-Quelle: bookTokenUsage schreibt usage_event nur mit callId fuer die
// Zusammenfassung (Briefing/Eroeffnungssatz buchen callId:null, sie laufen VOR
// store.createCall), research_fee schreibt gar kein usage_event. Der Waechter nimmt sie
// deshalb als INJIZIERTE Quelle entgegen (eigenCentJeAnruf, Default null); null heisst
// benannt "keine je-Anruf-Quelle": JEDER Anruf wird als Stichprobe verweigert und der
// Report meldet tarifpaar_zu_wenig_proben - laut, nicht alarmierend, in jeder Sweep- und
// Boot-Zeile sichtbar. Kein geratener Zuschlag, keine tenant-weite Mittelung (Fabrikation),
// kein toter Bauform-Zweig hinter einem Flag. Der Waechter misst runtime erst, wenn diese
// Quelle existiert (per-Call-Erfassung der Eigen-Achsen - eigene Phase nach KV2-10); bis
// dahin ist er sichtbar-wartend, nie scheinbar-messend.

export const TARIFPAAR_FINDING = Object.freeze({
  // konfiguriertes Paar deckt die p95-Stichprobe nicht - die geldrelevante Richtung
  UNTERSCHAETZT: "tarifpaar_unterschaetzt",
  // sichtbar, NICHT alarmierbar (Muster insufficient_samples)
  ZU_WENIG_PROBEN: "tarifpaar_zu_wenig_proben",
});

// Ausschluss-Gruende EINES Anrufs aus der Stichprobe (nur Zaehler, keine zweite Meinung -
// dieselbe Regel wie COVERAGE_BUCKET in cost-truing.js).
export const TARIFPAAR_FEHLGRUND = Object.freeze({
  // kein beweisender costTruedSource (istBeweisendeHerkunft) - auch jeder laufende Anruf
  HERKUNFT: "herkunft",
  // Kriterium (b): Profil-SOLL nicht erfuellt (settlementProjektion.vollBelegt === false)
  BELEG_UNVOLLSTAENDIG: "beleg_unvollstaendig",
  // R9-2: keine je-Anruf-Quelle fuer #4/#5 -> KEIN Sample (systematisch zu niedrig)
  EIGEN_ACHSEN: "eigen_achsen",
  // Belegsumme unbrauchbar oder Kurs-Umrechnung verliess den sicheren Integer-Bereich
  UEBERLAUF: "ueberlauf",
  // voiceMinutesOf <= 0 (keine bewertbare Menge)
  MINUTEN: "minuten",
});

// Vollkosten EINES Anrufs in BUCKET-Cent (EUR): Belegsumme (Provider-Mikro -> Bucket ueber
// DIE EINE Kursfunktion) + Eigen-Cent. null bei unbrauchbarer Belegsumme oder Ueberlauf -
// nie still 0 (PM-4/G26: "nicht berechenbar" ist nicht "kostet nichts").
export function vollkostenCentsJeAnruf({ belegMikroCents, eigenCent }, rateMicro) {
  if (!isProviderMicroCents(belegMikroCents)) return null;
  const belegCents = providerMicroCentsToBucketCents(belegMikroCents, rateMicro);
  if (belegCents === null) return null;
  const vollkostenCents = belegCents + eigenCent;
  return Number.isSafeInteger(vollkostenCents) ? vollkostenCents : null;
}

// Die Eigen-Cent je Anruf aus der injizierten Quelle. null heisst "kein Wert fuer DIESEN
// Anruf" - die Quelle existiert prozessweit nicht (null) oder fuer diesen Call nicht;
// beides ist R9-2 und verweigert die Stichprobe, statt sie zu niedrig zu messen.
function eigenCentOf(eigenCentJeAnruf, callId) {
  const wert = eigenCentJeAnruf?.get(callId);
  return Number.isSafeInteger(wert) && wert >= 0 ? wert : null;
}

// Belegzeilen eines States nach callId gruppiert (EIN Durchlauf statt eines Lookups je
// Anruf; Muster belegSummeJeTraegerFuerMonat in kosten-projektion.js).
function belegzeilenJeCall(zeilen) {
  const jeCall = new Map();
  for (const zeile of Array.isArray(zeilen) ? zeilen : []) {
    if (!jeCall.has(zeile.callId)) jeCall.set(zeile.callId, []);
    jeCall.get(zeile.callId).push(zeile);
  }
  return jeCall;
}

// Bewertet EINEN Anruf als Stichprobe ODER nennt den Ausschlussgrund - genau einer von
// beiden Ausgaengen. Die Reihenfolge ist eine Aussage (beweisende Herkunft ist die
// billigste Pruefung am Call selbst, die Kurs-Arithmetik kommt zuletzt): ein Anruf, der
// an MEHREREN Bedingungen krankt, zaehlt bei der aussagekraeftigsten, naechstliegenden.
// EIGEN_ACHSEN steht bewusst VOR MINUTEN: die Quelle ist die globale Luecke dieser Phase,
// ohne sie waere jede andere Aussage eine am unvollstaendigen Material.
function stichprobeOderFehlgrund({ call, belege, eigenCentJeAnruf, rateMicro }) {
  if (!istBeweisendeHerkunft(call.costTruedSource)) return { fehlgrund: TARIFPAAR_FEHLGRUND.HERKUNFT };
  const projektion = settlementProjektion({ call, belege });
  if (!projektion.vollBelegt) return { fehlgrund: TARIFPAAR_FEHLGRUND.BELEG_UNVOLLSTAENDIG };
  const eigenCent = eigenCentOf(eigenCentJeAnruf, call.id);
  if (eigenCent === null) return { fehlgrund: TARIFPAAR_FEHLGRUND.EIGEN_ACHSEN };
  const minuten = voiceMinutesOf(call);
  if (minuten <= 0) return { fehlgrund: TARIFPAAR_FEHLGRUND.MINUTEN };
  const vollkostenCents = vollkostenCentsJeAnruf({ belegMikroCents: projektion.summeMikroCents, eigenCent }, rateMicro);
  if (vollkostenCents === null) return { fehlgrund: TARIFPAAR_FEHLGRUND.UEBERLAUF };
  return { stichprobe: { route: kostenprofilFuerAnruf(call), minuten, vollkostenCents } };
}

// Alle Stichproben je Route. Liefert { jeRoute: Map<route, stichproben[]>, ausgeschlossen:
// Map<fehlgrund, anzahl> } mit stichprobe = { route, minuten, vollkostenCents }. jeRoute
// startet mit LEERER Liste je bekannter Route (eine Route ohne Anrufe ist eine Aussage,
// keine Abwesenheit - Muster prefixes im Praefix-Waechter). Der Waechter hat KEIN
// rollendes Fenster (DRIFT_SAMPLE_WINDOW passt nicht: der Grundbetrag braucht die
// KURZEN Anrufe, ein Fenster ueber die juengsten N wuerde sie proportional verduennen).
export function vollkostenStichprobenJeRoute({ state, eigenCentJeAnruf, rateMicro }) {
  const jeRoute = new Map(Object.values(KOSTENPROFIL).map((route) => [route, []]));
  const ausgeschlossen = new Map();
  const belegeNachCall = belegzeilenJeCall(state?.callCostEvidence);
  for (const call of Array.isArray(state?.calls) ? state.calls : []) {
    const ergebnis = stichprobeOderFehlgrund({
      call,
      belege: belegeNachCall.get(call.id) ?? [],
      eigenCentJeAnruf,
      rateMicro,
    });
    if (ergebnis.fehlgrund !== undefined) {
      ausgeschlossen.set(ergebnis.fehlgrund, (ausgeschlossen.get(ergebnis.fehlgrund) ?? 0) + 1);
      continue;
    }
    jeRoute.get(ergebnis.stichprobe.route).push(ergebnis.stichprobe);
  }
  return { jeRoute, ausgeschlossen };
}

// Der VORSCHLAG aus den Stichproben EINER Route: grundbetragCents = p95 der Vollkosten je
// Anruf; minutensatzCents = p95 von ceil(vollkosten/minuten). Beweisbar deckend: der
// Grundbetrag allein deckt bereits die p95 der Je-Anruf-Kosten (Minutensatz >= 0 addiert).
// null bei 0 Stichproben - kein Paar aus dem Nichts (PM-4).
export function tarifpaarVorschlag(stichproben) {
  if (stichproben.length === 0) return null;
  const vollkostenAufsteigend = stichproben
    .map((stichprobe) => stichprobe.vollkostenCents)
    .sort((links, rechts) => links - rechts);
  const jeMinuteAufsteigend = stichproben
    .map((stichprobe) => Math.ceil(stichprobe.vollkostenCents / stichprobe.minuten))
    .sort((links, rechts) => links - rechts);
  return {
    grundbetragCents: nearestRankWert(vollkostenAufsteigend, DRIFT_PERCENTILE),
    minutensatzCents: nearestRankWert(jeMinuteAufsteigend, DRIFT_PERCENTILE),
  };
}

// Deckt das KONFIGURIERTE Paar die p95-Stichprobe? p95 der Restwerte
// (vollkosten - (grundbetrag + minutensatz * minuten)) <= 0 -> true. Paar null oder keine
// Stichprobe -> false ("keine Aussage" wird nie als "gedeckt" gelesen, PM-4).
export function tarifpaarDecktStichproben(paar, stichproben) {
  if (paar === null || stichproben.length === 0) return false;
  const restAufsteigend = stichproben
    .map((stichprobe) => stichprobe.vollkostenCents - (paar.grundbetragCents + paar.minutensatzCents * stichprobe.minuten))
    .sort((links, rechts) => links - rechts);
  return nearestRankWert(restAufsteigend, DRIFT_PERCENTILE) <= 0;
}

// Der Ausschluss-Zaehler als Zeilen-Fragment (Muster zaehlListe): feste Reihenfolge nach
// der TARIFPAAR_FEHLGRUND-Deklaration, nur Zaehler > 0, nie gerundet. LEERE_LISTE
// ("keine") heisst: fuer diese Messung wurde NIEMAND ausgeschlossen - die Route hat
// schlicht keine Anrufe (proben=0 daneben nennt denselben Sachverhalt).
function fehlgrundZeile(ausgeschlossen) {
  const teile = Object.values(TARIFPAAR_FEHLGRUND)
    .filter((grund) => (ausgeschlossen.get(grund) ?? 0) > 0)
    .map((grund) => `${grund}(${ausgeschlossen.get(grund)})`);
  return teile.length > 0 ? teile.join(",") : LEERE_LISTE;
}

// Ein Eintrag EINER Route: entscheidet zu_wenig_proben VOR jeder Paar-Aussage (Muster
// driftEntryForPrefix - unter der Mindestprobe gibt es KEINE Tarif-Aussage), bildet dann
// Vorschlag und Klassifikation. fehlgrund ist das GERENDERTE Fragment aus
// vollkostenStichprobenJeRoute (global, nicht je Route: die EIGEN_ACHSEN-Quelle ist eine
// prozessweite Luecke, kein Routen-Merkmal). minSamples teilt sich bewusst mit dem
// Praefix-Waechter (costCalibrationMinSamples, G5): dieselbe Frage - ab wann ist eine
// Stichprobe eine Aussage - hat eine Antwort.
export function tarifpaarEintrag({ route, stichproben, konfiguriert, minSamples, fehlgrund }) {
  const base = { route, proben: stichproben.length, konfiguriert, fehlgrund };
  if (stichproben.length < minSamples)
    return { ...base, vorschlag: null, code: TARIFPAAR_FINDING.ZU_WENIG_PROBEN };
  return {
    ...base,
    vorschlag: tarifpaarVorschlag(stichproben),
    code: tarifpaarDecktStichproben(konfiguriert, stichproben) ? null : TARIFPAAR_FINDING.UNTERSCHAETZT,
  };
}

// Routen, deren konfigurierter Minutensatz der INBOUND-Satz ist (voiceTariffInboundCents
// statt voiceTariffDomesticCents). EINE benannte Stelle: die Richtung eines Profils steht
// im Katalog bewusst nicht als Feld (KV2-10 ruehrt die Registry nicht an), ein zweiter
// verstreuter Vergleich liefe beim ersten neuen Inbound-Profil auseinander (G5/G27).
const INBOUND_KOSTENPROFILE = new Set([
  KOSTENPROFIL.TELNYX_INBOUND_BUDGET,
  KOSTENPROFIL.TELNYX_INBOUND_REALTIME,
  // IE3: das dritte Inbound-Profil - genau der Fall, den der Kommentar oben angekuendigt
  // hat. Die LIVE-Buchung waehlt den Satz nach call.direction (metering.js), nicht nach
  // Profil; ohne diesen Eintrag verglich der Tarif-Waechter die Vollkosten eines
  // INBOUND-Anrufs gegen den OUTBOUND-Satz. Keine Tarifaenderung, eine Einordnung.
  KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
]);

// Das KONFIGURIERTE Paar EINER Route. Grundbetrag 0 = "noch nicht gesetzt" - genau die
// heutige Reserve-Wahrheit: der Grundbetrag geht in KEINE Reserve-Rechnung (KV2-10
// Scope-Riegel), der Waechter prueft ihn trotzdem, damit eingesetzte Werte sofort wirken.
// Object.hasOwn statt Roh-Index: die echte Config ist ein guardedConfig-PROXY, dessen
// get-Trap bei einem unbekannten Schluessel wirft (Tippfehler-Riegel) - ein Routen-Lookup
// in der Karte ist aber KEIN Tippfehler, sondern der Normalfall "Route noch nicht
// gesetzt". Object.hasOwn laeuft ueber [[GetOwnProperty]], keinen Trap (Praezedenz
// unpricedModels in boot-guard.js, dasselbe Muster fuer modelPricesUsd).
function konfiguriertesPaar(route, billing) {
  const grundbetragJeRoute = billing.voiceTariffGrundbetragCentsJeRoute ?? {};
  return {
    grundbetragCents: Object.hasOwn(grundbetragJeRoute, route) ? grundbetragJeRoute[route] : 0,
    minutensatzCents: INBOUND_KOSTENPROFILE.has(route) ? billing.voiceTariffInboundCents : billing.voiceTariffDomesticCents,
  };
}

// config -> Argumente an EINER Stelle (Muster tariffDriftReportFromConfig): Boot, Sweep
// und Tests bauen den Aufruf NICHT je selbst zusammen. tariffCentsPerMin wird bewusst
// NICHT importiert (P5-12) - die konfigurierten Saetze reisen als Argumente.
export function tarifpaarReport({ state, eigenCentJeAnruf, billing }) {
  const { jeRoute, ausgeschlossen } = vollkostenStichprobenJeRoute({
    state,
    eigenCentJeAnruf,
    rateMicro: billing.providerToBucketRateMicro,
  });
  const fehlgrund = fehlgrundZeile(ausgeschlossen);
  return [...jeRoute.entries()].map(([route, stichproben]) =>
    tarifpaarEintrag({
      route,
      stichproben,
      konfiguriert: konfiguriertesPaar(route, billing),
      minSamples: billing.costCalibrationMinSamples,
      fehlgrund,
    }),
  );
}

// Nur UNTERSCHAETZT ist alarmierbar (Muster ALERTABLE_DRIFT_CODES: zu_wenig_proben ist
// sichtbar, aber nie Kanal-Laerm - sonst wird der Kanal gegen Datenknappheit trainiert).
export function alertbareTarifpaarBefunde(report) {
  return report.filter((eintrag) => eintrag.code === TARIFPAAR_FINDING.UNTERSCHAETZT);
}

// Eine PII-freie Zeile je Eintrag: Routen-/Profilnamen und Cent-Betraege, keine Call-ID,
// keine Rufnummer, keine Tenant-Kennung (testgepinnt). Nennt IMMER proben=; bei
// zu_wenig_proben zusaetzlich fehlgrund= (laut, nicht still), KEINEN vorschlag (null
// laese sich als 0 ct lesen - dieselbe Regel wie "gemessen=null" in driftLine).
export function tarifpaarZeile(eintrag) {
  const head = `route=${eintrag.route} proben=${eintrag.proben}`;
  const befund = `befund=${eintrag.code ?? "im_band"}`;
  if (eintrag.code === TARIFPAAR_FINDING.ZU_WENIG_PROBEN) return `${head} fehlgrund=${eintrag.fehlgrund} ${befund}`;
  const vorschlag = `${eintrag.vorschlag.grundbetragCents}ct+${eintrag.vorschlag.minutensatzCents}ct/min`;
  const konfiguriert = `${eintrag.konfiguriert.grundbetragCents}ct+${eintrag.konfiguriert.minutensatzCents}ct/min`;
  return `${head} vorschlag=${vorschlag} konfiguriert=${konfiguriert} ${befund}`;
}
