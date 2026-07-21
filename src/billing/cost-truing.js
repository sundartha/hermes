// Kosten-Abgleich im Beobachtungsmodus (LCT P3): misst die Ist-Kosten JEDES beendeten
// Outbound-Calls gegen den Provider und schreibt AUSSCHLIESSLICH die vier P2-Felder, die
// publicCall (src/store/views.js) bereits strippt und die kein Gate, kein Meter und keine
// Projektion liest. Muster makeMetering (store+config im Closure, keine Telefonie-Logik
// im Server, kein Netz-IO im Store).
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
import { COST_TRUING_SOURCE, MICRO_CENTS_PER_CENT, isBookableCents } from "../store/defaults.js";
import { nextCostTruingAttempt } from "../store/state-ops.js";
import { sendBootstrapAlertSms } from "../telephony/alert-sms.js";
import { tariffDriftReportFromConfig, alertableDriftFindings, driftLine } from "./cost-calibration.js";

// Sweep-Kadenz (Muster RETENTION_SWEEP_INTERVAL_MS, src/boot.js). Exportiert: boot.js
// registriert das Intervall selbst (der Job macht Provider-IO und laeuft NICHT beim
// Boot, s. Modul-Kommentar dort) - EINE Quelle statt einer zweiten, unabhaengig
// gepflegten Zahl.
export const COST_TRUING_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Zwei Ausloeser (Intervall + manueller Endpunkt), EIN benannter Grund je. Exportiert:
// boot.js und api-billing.js teilen sich diese eine Quelle statt zweier Magic-Strings.
export const SWEEP_TRIGGER = Object.freeze({ INTERVAL: "interval", MANUAL: "manual" });

const OUTBOUND_DIRECTION = "outbound"; // dieselbe Achse wie metering.js, hier 2x gebraucht -> benannt
const PERCENT_BASE = 100;
const MS_PER_MINUTE = 60 * 1000;
const SWEEP_RUNNING_REASON = "sweep_running";
// Grund fuer einen Pool, der zwar geantwortet hat, dessen Menge aber nachweislich
// unvollstaendig ist (pool.complete === false, ab KE-P3 erreichbar).
const POOL_INCOMPLETE_REASON = "pool_incomplete";
const COST_TRUING_FINDING = Object.freeze({
  COVERAGE_BELOW_THRESHOLD: "coverage_below_threshold",
  COVERAGE_STALLED: "coverage_stalled",
});
const COST_TRUING_AUDIT_EVENT = "cost_truing_befund";
// LCT P5 (Drift-Waechter): eigenes Audit-Ereignis + eigener SMS-Praefix, getrennt von
// COST_TRUING_AUDIT_EVENT (verschiedene Aussage: Deckungsquote vs. Tarif-Abweichung).
const TARIFF_DRIFT_AUDIT_EVENT = "tarif_drift_befund";
const DRIFT_ALERT_SMS_PREFIX = "[hermes] Tarif-Drift: ";

const isEndedOutbound = (call) => call.direction === OUTBOUND_DIRECTION && !!call.endedAt;
const providerLegIdOf = (call) => call.twilioSid || call.callControlId || null;

// Anteil der beendeten Outbound-Calls mit beweisbar vollstaendiger Datenlage. Zaehler:
// costTruedSource === 'telnyx_detail_records' (dieser Wert wird unten NUR bei kompletter
// Typ-Menge gesetzt - EINE Quelle der Vollstaendigkeits-Aussage, kein zweites Praedikat).
// Nenner: alle beendeten Outbound-Calls. NENNER 0 -> 0, kein Freispruch: die 0-Zeilen-
// Antwort ist die fail-open-Variante genau der Zahl, die ab P4/P4b den Flip freigibt.
// Abgerundet (floor) - die Abweichung geht Richtung "zu wenig Deckung", nie Richtung
// vorgetaeuschter Reife. Nicht persistiert: live aus dem geladenen Spiegel gerechnet.
// Aufrufer reichen store.load() herein (P4- und P4b-Boot-Guard rufen DIESE Funktion,
// statt die Rechnung ein zweites Mal zu erfinden).
export function costTruingCoveragePercent(state) {
  const ended = Array.isArray(state?.calls) ? state.calls.filter(isEndedOutbound) : [];
  if (ended.length === 0) return 0;
  const proven = ended.filter((c) => c.costTruedSource === COST_TRUING_SOURCE.DETAIL_RECORDS).length;
  return Math.floor((proven * PERCENT_BASE) / ended.length);
}

// messaging ist der Alarmkanal (LCT P5, Drift-Waechter-SMS), kein Abgleich-Pfad - der
// Provider-Kosten-Abgleich selbst laeuft ausschliesslich ueber voiceControl.
export function makeCostTruing({ store, config, voiceControl, audit, messaging, now = Date.now }) {
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

  // Entprellfenster je Befund-Code (COST_ALERT_DEBOUNCE_MS, Default 24 h). Ohne sie
  // meldete der 6-h-Sweep denselben Befund viermal am Tag und trainierte den Kanal taub.
  // Ein Schluessel, zwei Nutzer: P3 entprellt je Befund-Code, P5 keyt zusaetzlich auf den
  // Praefix ("<praefix> <code>"). BEWUSST DIESELBE Map und DIESELBE Regel - eine zweite
  // Entprellung mit eigenem Fenster liefe beim ersten Nachziehen auseinander.
  const lastFindingMs = new Map();
  let sweepsBelowThreshold = 0;

  // Kandidaten-Praedikat (persistierter Versuchszaehler, kein In-Memory). COST_TRUING_
  // MAX_ATTEMPTS gegen den PERSISTIERTEN Zaehler (P2): ein prozess-lokaler Zaehler wird
  // auf dem Render-Free-Tier bei jedem Restart genullt, erreicht die Obergrenze nie und
  // liesse den Job unbegrenzt gegen tote Calls laufen.
  function isTruingCandidate(call, nowMs) {
    if (!isEndedOutbound(call) || call.costTruedAt !== null) return false;
    if (nextCostTruingAttempt(call) > config.billing.costTruingMaxAttempts) return false;
    const endedMs = Date.parse(call.endedAt);
    if (!Number.isFinite(endedMs)) return false; // unbrauchbarer Zeitstempel != "faellig"
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
      // LCT P4: zweiter Beleg des Vollstaendigkeits-Praedikats. Nicht-ganzzahlige oder
      // fehlende billedSec zaehlen als 0 (fail-closed) - Summe 0 heisst "nichts
      // abgerechnet" und verbietet jede Rueckerstattung.
      billedSecTotal: records.reduce((sum, r) => sum + (Number.isSafeInteger(r?.billedSec) && r.billedSec > 0 ? r.billedSec : 0), 0),
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

  function emitFinding(code, coveragePercent, nowMs) {
    if (!shouldEmitFinding(code, nowMs)) return;
    const detail =
      `grund=${code} deckung=${coveragePercent}% ` +
      `schwelle=${config.billing.costTruingMinCoveragePercent}% sweeps=${sweepsBelowThreshold}`;
    console.warn(`[cost-truing] Befund ${detail}`);
    audit(COST_TRUING_AUDIT_EVENT, null, detail); // req=null -> ip=system (Plattform-Ereignis)
  }

  // Die Quote wird am Ende JEDES Sweeps ausgegeben - nur rechnen und nicht melden ist der
  // Zustand, in dem "dann flippen wir halt trotzdem" unbemerkt bleibt (Risiko: stiller
  // Ausfall des Jobs im schlafenden Free-Tier-Dyno, PM-4). PII-frei: keine Rufnummer,
  // keine Tenant-Klarnamen, keine Transkript-Fragmente.
  function reportCoverage(coveragePercent, nowMs) {
    const min = config.billing.costTruingMinCoveragePercent;
    console.log(`[cost-truing] deckung=${coveragePercent}% schwelle=${min}%`);
    if (coveragePercent >= min) {
      sweepsBelowThreshold = 0;
      return;
    }
    sweepsBelowThreshold++;
    emitFinding(COST_TRUING_FINDING.COVERAGE_BELOW_THRESHOLD, coveragePercent, nowMs);
    // Terminierungsregel: bleibt die Quote ueber COST_TRUING_COVERAGE_STALL_SWEEPS
    // aufeinanderfolgende Sweeps unter der Schwelle, ist eine Owner-Entscheidung faellig
    // (Ursache beheben oder Abbruch nach P3/P5). Die SCHWELLE WIRD DABEI NIE GESENKT, um
    // die Vorbedingung zu erfuellen - das waere die Sicherung an ihre eigene Verletzung
    // angepasst. AKZEPTIERTES RESTRISIKO: dieser Zaehler ist prozess-lokal und wird von
    // einem Restart genullt; die tragende, bei jedem Sweep neu aus Daten abgeleitete
    // Meldung ist coverage_below_threshold, die Stillstands-Meldung ist nur die
    // Eskalationsstufe darueber.
    if (sweepsBelowThreshold >= config.billing.costTruingCoverageStallSweeps)
      emitFinding(COST_TRUING_FINDING.COVERAGE_STALLED, coveragePercent, nowMs);
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
  function refundProven(call, measured) {
    return (
      measured.source === COST_TRUING_SOURCE.DETAIL_RECORDS &&
      measured.billedSecTotal > 0 &&
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

  // Bucht die Korrektur EINES abgeglichenen Calls. Kein Estimate -> gar keine Korrektur
  // (Bestandszeile von vor P2, beide Richtungen). Die Asymmetrie selbst liegt eine
  // Schicht tiefer in applyCostCorrectionCents - hier steht nur der BEWEIS.
  function bookCorrectionFor(call, measured) {
    if (!isBookableCents(call.estimatedCostCents)) return;
    const { booked, deltaCents } = store.applyCostCorrectionCents(call.tenantId, {
      actualCostMicroCents: measured.actualCostMicroCents,
      estimatedCostCents: call.estimatedCostCents,
      providerToBucketRateMicro: config.billing.providerToBucketRateMicro,
      dataComplete: refundProven(call, measured),
    });
    console.log(`[cost-truing] korrektur call=${call.id} delta_eur_cent=${deltaCents} gebucht=${booked}`);
  }

  // "Kein Abgleich moeglich": unbekannter Provider (die Registry wirft fail-closed) oder ein
  // Adapter ohne die beiden Beleg-Methoden (Twilio). EINE Entscheidung an EINER Stelle (G5) -
  // die Buchungsschleife kennt danach nur noch control===null (sauberes No-op) und pool.ok.
  const NO_COST_RECORDS = Object.freeze({ control: null, pool: null });

  // Nur ein VOLLSTAENDIGER Pool darf Geld bewegen: gegen eine bewiesene Untermenge erstattet
  // die Korrektur real ausgegebenes Geld zurueck - die fail-OPEN-Richtung im Geldpfad.
  // complete:false ist deshalb dasselbe wie ok:false, uebersetzt an genau EINER Stelle.
  function bookablePool(pool) {
    if (!pool?.ok) return pool ?? { ok: false };
    return pool.complete === false ? { ok: false, reason: POOL_INCOMPLETE_REASON } : pool;
  }

  // Der Belegabruf EINES Providers - genau EINMAL je Sweep (D1: der Abruf ist
  // schleifeninvariant, die Query kennt weder legId noch Zeitfenster).
  async function fetchCostRecordPoolFor(provider) {
    let control;
    try {
      control = voiceControl(provider);
    } catch {
      return NO_COST_RECORDS; // unbekannter Provider -> pick() wirft fail-closed
    }
    if (typeof control.fetchCostRecordPool !== "function" || typeof control.assignCostRecords !== "function")
      return NO_COST_RECORDS;
    try {
      return { control, pool: bookablePool(await control.fetchCostRecordPool()) };
    } catch {
      return { control, pool: { ok: false } }; // der Port WIRFT NIE - zweite Linie
    }
  }

  // Ein Pool je VORKOMMENDEM Provider, jeder Provider genau einmal. Die Kandidatenliste
  // bestimmt die Menge - kein Providername im Billing-Pfad (DIP). Ohne Kandidaten kein Abruf.
  async function fetchCostRecordPools(candidates) {
    const pools = new Map();
    for (const call of candidates) {
      if (!pools.has(call.provider)) pools.set(call.provider, await fetchCostRecordPoolFor(call.provider));
    }
    return pools;
  }

  // SYNCHRON (KE-P2/PM-5): zwischen Pool-Abruf und Buchungsschleife liegt strukturell kein
  // Netz-await mehr. Provideraufloesung und Faehigkeitspruefung sind in
  // fetchCostRecordPoolFor gewandert (EINE Entscheidung, EINE Stelle).
  function trueOneCall(call, { control, pool }, tally) {
    // Adapter ohne die Beleg-Methoden (Twilio: price deckt nur Connectivity) und Call ohne
    // aufloesbare Leg-Referenz sind SAUBERE No-ops: kein Wurf, KEIN Feld-Schreiben, KEIN
    // verbrauchter Versuch. Fehlende Faehigkeit ist der konservative Fall - der Call bleibt
    // im Nenner der Deckungsquote und drueckt sie, statt sie zu beschoenigen.
    const legId = providerLegIdOf(call);
    if (!control || !legId) {
      tally.skippedCalls++;
      return;
    }

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
      ? classifyRecords(result.records, config.billing.costTruingRequiredRecordTypes)
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
    if (measured) bookCorrectionFor(call, measured);
    countOutcome(tally, truedSource, closed);
  }

  // Versand ueber den geteilten Bootstrap-Alarm-Baustein (G5, EINE Quelle mit der
  // ElevenLabs-Kontingent-Warnung LCT P7): Empfaenger-Riegel, Bootstrap-Absender (die
  // eigene Betreiber-Nummer, NIE die DID eines Kunden), try/catch und fire-and-forget
  // liegen alle dort. Ein Alarm darf einen Sweep nie abbrechen. Das Ziel (platformAlertSmsTo)
  // wird NIE geloggt.
  function sendDriftAlertSms(detail) {
    sendBootstrapAlertSms({ messaging, config, store, prefix: DRIFT_ALERT_SMS_PREFIX, detail, logTag: "cost-truing" });
  }

  // Der SMS-Versand ist ECHT und KOSTENPFLICHTIG. Die Kostenklemme ist die Entprellung:
  // hoechstens EINE Meldung je Praefix und Befund-Code je COST_ALERT_DEBOUNCE_MS (24 h) ->
  // bei 3 Praefixen x 3 alarmierenden Codes (ALERTABLE_DRIFT_CODES) maximal 9 SMS am Tag,
  // statt 4 Meldungen je Befund und Tag aus dem 6-h-Sweep. Der Schluessel traegt den Code,
  // conversion_error entprellt also getrennt von under-/overestimate.
  function alertDrift(entry, nowMs) {
    if (!shouldEmitFinding(`${entry.prefix} ${entry.code}`, nowMs)) return;
    const detail = driftLine(entry);
    console.warn(`[cost-truing] Tarif-Drift ${detail}`);
    audit(TARIFF_DRIFT_AUDIT_EVENT, null, detail); // req=null -> ip=system
    sendDriftAlertSms(detail);
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

  async function sweepAllCandidates(trigger) {
    const nowMs = now();
    // Kandidaten-Schnappschuss VOR den awaits: ein Call, der waehrend des Sweeps endet,
    // ist ohnehin erst nach COST_TRUING_DELAY_MINUTES faellig und kommt im naechsten Lauf.
    const candidates = store.load().calls.filter((c) => isTruingCandidate(c, nowMs));
    // D1: der Abruf ist schleifeninvariant und laeuft EINMAL je Provider - VOR der Schleife.
    // Ab hier bis zur Bilanz kommt kein Netz-await mehr (PM-5): zwei verschraenkte Sweeps
    // koennen sich hier nicht mehr dazwischenschieben.
    const pools = await fetchCostRecordPools(candidates);
    const tally = { measured: 0, incomplete: 0, noEstimate: 0, unavailable: 0, skippedCalls: 0, failed: 0 };
    for (const call of candidates) trueOneCall(call, pools.get(call.provider), tally);
    const coveragePercent = costTruingCoveragePercent(store.load());
    console.log(
      `[cost-truing] sweep trigger=${trigger} kandidaten=${candidates.length} ` +
        `gemessen=${tally.measured} unvollstaendig=${tally.incomplete} ` +
        `ohne_schaetzung=${tally.noEstimate} ` +
        `unbestimmt=${tally.unavailable} uebersprungen=${tally.skippedCalls}`,
    );
    reportCoverage(coveragePercent, nowMs);
    reportTariffDrift(store.load(), nowMs);
    return { skipped: false, candidates: candidates.length, coveragePercent, ...tally };
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
