// OUTBOUND-E3b (E-4/F2b): der MELDEWEG des systematischen-Ausfall-Melders - getrennt von
// der reinen Erkennungsregel (outage-detection.js, Clean-Code-Auftrag: "die Frage wird an
// genau einem Ort beantwortet, der Versand ist davon getrennt"). Ausgeloest von JEDEM
// beendeten Anruf, der eine Ausfall-Klasse belegt (outage-classes.js): outbound mit Grund
// not-placed (call-finish.js#reportFailedCall) oder, seit IEX-B1, eine gescheiterte
// EL-Inbound-Uebergabe (call-finish.js, Zweig uebergabeGescheitert).
//
// MELDEWEG, Reihenfolge ist Teil des Vertrags (Plan 4.1): WARN-Log -> Audit -> Mail ->
// SMS. MAIL IST PRIMAER: der heutige einzige Betreiber-Kanal (sendBootstrapAlertSms)
// laeuft ueber DASSELBE Telnyx-Konto und DIESELBE Nummern-Tabelle wie der ausgefallene
// Outbound (PM-4/BA-12) - ein Alarm, den derselbe Defekt mitreisst, ist keiner. Mail haengt
// an keinem Carrier.
//
// FAIL-SOFT, absolut: der komplette Rumpf liegt in try/catch - ein Fehler auf diesem Pfad
// darf NIEMALS einen Anruf-Abschluss (finishCall) abbrechen. Jede Versandstufe traegt
// zusaetzlich ihr eigenes catch mit Kanal-Kennung im Log (PM-16: stumm scheitern ist auf
// diesem Pfad verboten).
import {
  NOT_PLACED,
  failureReasonBase,
} from "./failure-reason.js";
import { outageBucket, outageWindow, beurteileAusfall, alarmZeile, meldeErlaubt, OUTAGE_VERDICT } from "./outage-detection.js";
import { AUSFALL_KLASSE, INBOUND_EL_OUTAGE_CODE } from "./outage-classes.js";
import { BRIDGE_STATE, bridgeStateOf } from "../elevenlabs/inbound-bridge-state.js";
import * as ops from "../store/state-ops.js";
import { sendFailSoftAlertSms, platformAlertSender } from "./alert-sms.js";
import { NUMBER_HOLD_REASON } from "../store/defaults.js";

// Kanal-Kennungen fuer WARN-Zeilen bei einem Sendefehler (PM-16).
const CHANNEL = Object.freeze({ MAIL: "mail", SMS: "sms" });

// Audit-Aktion je Urteil (G23: Dispatch-Tabelle statt paralleler if/else-Kette ueber
// denselben Diskriminator). "kein-befund"/"aus" haben bewusst KEINEN Eintrag - sie loesen
// keinen Meldeweg aus (K0 ist die einzige kostenlose Stufe, "kein-befund"/"aus" sind
// still).
const AUDIT_ACTION = Object.freeze({
  [OUTAGE_VERDICT.FIRST]: "outage_detected",
  [OUTAGE_VERDICT.ALERT]: "outage_alert",
  [OUTAGE_VERDICT.RECOVERED]: "outage_recovered",
});

// Mail-Versand: PRIMAERER Kanal (s. Modul-Kopf). Kein Ziel konfiguriert -> nichts zu tun,
// "delivered" bleibt false, aber es gibt auch nichts zu WIEDERHOLEN (der Aufrufer setzt
// reportedAt in diesem Fall trotzdem, s. applyOutageVerdict). Ziel wird NIE geloggt.
async function sendMailChannel({ mailer, config, zeile }) {
  const to = config.mail.platformAlertMailTo;
  if (!to) return { hasTarget: false, delivered: false };
  try {
    await mailer.sendMail({ to, subject: "Hermes Betriebsmeldung", text: zeile });
    return { hasTarget: true, delivered: true };
  } catch (err) {
    console.error(`[outage] Kanal ${CHANNEL.MAIL} fehlgeschlagen:`, err.message);
    return { hasTarget: true, delivered: false };
  }
}

// SMS-Versand: der bestehende, fail-soft Baustein (alert-sms.js) - EINE Quelle (G5), kein
// zweiter Versand-Codepfad. Absender kommt aus der Plattform-Bindung (PM-17), nicht aus
// einer Laufzeit-Suche.
function sendSmsChannel({ messaging, store, config, zeile }) {
  sendFailSoftAlertSms({
    messaging,
    to: config.billing.platformAlertSmsTo,
    body: zeile,
    resolveSender: () => platformAlertSender(store),
    onError: (err) => console.error(`[outage] Kanal ${CHANNEL.SMS} fehlgeschlagen:`, err.message),
  });
}

// G5-Fix (Review-Blocker Runde 3): der Versand-und-Buchen-Block war BYTE-IDENTISCH in
// sendAlert und runAlertChannelSelfTest formuliert - Mail senden, SMS senden, delivered
// aus dem Mail-Ergebnis ableiten, Marker im selben withStoreLock-Abschnitt fortschreiben.
// EINE Formulierung (G5): beide Aufrufer unterscheiden sich nur im Marker-Code.
async function sendeUeberBeideKanaele({ store, config, messaging, mailer, code, zeile, nowMs }) {
  const mailResult = await sendMailChannel({ mailer, config, zeile });
  sendSmsChannel({ messaging, store, config, zeile });
  const delivered = mailResult.delivered || !mailResult.hasTarget;
  await store.withStoreLock(() => {
    const state = store.load();
    ops.claimOutageAlert(state, { code, nowMs, sent: true, channels: delivered ? ["mail"] : [] });
  });
  store.save();
}

// K0/Erholung: WARN + Audit, KEIN Versand (kostenlos). Der Marker wird trotzdem
// fortgeschrieben (firstSeenAt/lastSeenAt bzw. closedAt) - Daempfung: ein zweiter K0-Fund
// derselben Klasse feuert nicht erneut (die Zeile ist dann schon offen).
async function markOnly({ urteil, bucket, zahlen, nowMs, store, audit }) {
  const zeile = `${AUDIT_ACTION[urteil]} klasse=${bucket} fehler=${zahlen.fehler} versuche=${zahlen.versuche}`;
  console.warn(`[outage] ${zeile}`);
  audit(AUDIT_ACTION[urteil], null, zeile);
  await store.withStoreLock(() => {
    const state = store.load();
    if (urteil === OUTAGE_VERDICT.RECOVERED) ops.closeOutageAlert(state, { code: bucket, nowMs });
    else ops.claimOutageAlert(state, { code: bucket, nowMs });
  });
  store.save();
}

// OUTBOUND-E4: EIN Meldeweg (G5). Bisher stand diese Formulierung nur privat als Rumpf
// von sendAlert; der Drift-Waechter braucht exakt sie - ein zweiter Kanal waere genau der
// Fehler, den PM-4 beschreibt. Reservierung ATOMAR im Lock VOR jedem Versand bleibt beim
// jeweiligen Aufrufer (G26-Muster, s. claimVerdict/meldeHoldEskalation/laufeDrift).
export async function meldeBetreiberAlarm({ store, config, audit, messaging, mailer, bucket, aktion, zeile, nowMs }) {
  console.warn(`[outage] ${aktion} klasse=${bucket}`);
  audit(aktion, null, zeile);
  await sendeUeberBeideKanaele({ store, config, messaging, mailer, code: bucket, zeile, nowMs });
}

// Die kostenlose Stufe (K0-Bauform, markOnly ohne Versand): WARN + Audit + Marker. Fuer
// Befunde, die LAUT sein muessen, aber keinen Alarm rechtfertigen (Drift-Waechter-Klassen
// unknown/warn). Anders als markOnly (K0/RECOVERED, s.u.) kennt diese Funktion kein
// urteil - sie CLAIMT immer (nie close); der Aufrufer entscheidet selbst, wann ein Befund
// wieder verschwunden ist (outbound-drift-watch.js#closeVerschwundeneBefunde).
export async function meldeBetreiberNotiz({ store, audit, bucket, aktion, zeile, nowMs }) {
  console.warn(`[outage] ${aktion} klasse=${bucket}`);
  audit(aktion, null, zeile);
  await store.withStoreLock(() => {
    const state = store.load();
    ops.claimOutageAlert(state, { code: bucket, nowMs });
  });
  store.save();
}

// UMGEZOGEN aus outbound-drift-watch.js (KV2-1): der aufrufer-seitige Entprell-Riegel VOR
// jedem Alarm-Versand gehoert in das Meldeweg-Modul, nicht in einen seiner Verbraucher -
// seit KV2-1 hat er zwei (Drift-Waechter und Kostenpfad, Plan 4.9). Verhalten unveraendert.
//
// BLOCKER 3 (Review Runde 2, Drift-Waechter): OHNE diese Entprellung feuert JEDER Lauf bei
// unveraendertem Befund erneut den VOLLEN Meldeweg (Mail+SMS) - gemessen: 24 Sweeps bei
// unveraendertem Ausfall -> 3 Mails + 9 Audit-Zeilen; im Stundentakt 24 Mails/Tag.
// Dieselbe Regel (meldeErlaubt) und dieselben Schwellen wie der Ausfall-Melder.
// ENTSCHEIDET NUR UEBER DEN VERSAND: false heisst NICHT "dieser Lauf tut nichts" - der
// Aufrufer faellt auf meldeBetreiberNotiz zurueck, die den Marker trotzdem beansprucht.
function alarmErlaubt({ store, bucket, config, nowMs }) {
  const marker = ops.openOutageAlert(store.load(), bucket);
  if (!marker) return true;
  return meldeErlaubt(marker, nowMs, {
    debounceMs: config.billing.outageAlertDebounceMs,
    retryMs: config.billing.outageAlertRetryMs,
  });
}

// Ein entprellter VOLL-Befund darf den Marker NICHT unangetastet lassen - genau das liess
// marker.lastSeenAt einfrieren, obwohl der Befund bei jedem Lauf neu gemessen wird.
// Entprellt wird NUR der Versand (Mail/SMS): meldeBetreiberNotiz claimt den Marker OHNE
// sent:true (lastAttemptAt/reportedAt bleiben unveraendert, die naechste
// Faelligkeitspruefung damit auch) und schreibt selbst WARN+Audit fort - "nie stumm" gilt
// fuer JEDEN Lauf, nicht nur fuer den, der tatsaechlich sendet.
export async function meldeVollBefund({ store, config, audit, messaging, mailer, bucket, aktion, zeile, nowMs }) {
  if (alarmErlaubt({ store, bucket, config, nowMs })) {
    await meldeBetreiberAlarm({ store, config, audit, messaging, mailer, bucket, aktion, zeile, nowMs });
  } else {
    await meldeBetreiberNotiz({ store, audit, bucket, aktion: `${aktion}_entprellt`, zeile, nowMs });
  }
}

// Alarm: der volle Meldeweg (WARN -> Audit -> Mail -> SMS). Der Marker haelt fest, DASS
// ein Versand versucht wurde (S3-1) und ob er nachweislich zugestellt war (S3-2) - kein
// Mail-Ziel gesetzt gilt als "nichts zu wiederholen" (Audit/SMS sind dann das Beste, was
// es gibt), ein WERFENDER Mailversand dagegen NICHT: der naechste not-placed-Abschluss
// wiederholt die Meldung nach retryMs.
// Der Sendeplatz ist an dieser Stelle BEREITS reserviert (claimVerdict, VOR jedem
// Versand, s.u.) - hier wird nur noch gesendet und danach reportedAt/deliveredChannels
// nachgezogen (S3-2). Kein zweiter Reservierungsschritt hier, sonst waere die
// Entprellung wieder an genau der Stelle geloest, die die Reservierung schliesst.
// IEX-B1: windowMs kommt aus den Schwellen der URTEILENDEN Klasse statt aus einem festen
// Config-Blatt - sonst traegt der Inbound-Alarm das Outbound-Fenster in fenster_min und
// luegt ueber den Zeitraum, auf den sich seine Zahlen beziehen (Pre-Mortem R7). Fuer
// Outbound ist der Wert derselbe (AUSFALL_KLASSE.OUTBOUND.schwellen liest genau dieses
// Blatt) - der Body bleibt dort byte-identisch (I1/I2).
async function sendAlert({ bucket, zahlen, nowMs, store, config, audit, messaging, mailer, schwellen }) {
  const zeile = alarmZeile({ code: bucket, zahlen, regel: OUTAGE_VERDICT.ALERT, windowMs: schwellen.windowMs });
  await meldeBetreiberAlarm({ store, config, audit, messaging, mailer, bucket, aktion: "outage_alert", zeile, nowMs });
}

// Dispatch-Tabelle (G23): EIN Eintrag je meldepflichtigem Urteil, kein if/else ueber
// denselben Diskriminator. "kein-befund"/"aus" fehlen absichtlich - fuer sie gibt es
// nichts zu tun.
const VERDICT_HANDLERS = Object.freeze({
  [OUTAGE_VERDICT.FIRST]: markOnly,
  [OUTAGE_VERDICT.RECOVERED]: markOnly,
  [OUTAGE_VERDICT.ALERT]: sendAlert,
});

async function applyOutageVerdict(context) {
  const handler = VERDICT_HANDLERS[context.urteil];
  if (handler) await handler(context);
}

// G26-Fix (Race): Urteil UND Reservierung laufen ATOMAR im SELBEN withStoreLock-
// Abschnitt, VOR jedem Versand. Ohne das lesen zwei GLEICHZEITIG endende not-placed-
// Anrufe denselben, noch nicht geclaimten Marker, urteilen beide "alarm" und senden
// beide - der einzige Daempfer des Melders (meldeErlaubt/retryMs) waere im Ernstfall
// wirkungslos, weil er auf einem lastAttemptAt urteilt, das erst NACH dem Versand
// gesetzt wird. Die Reservierung setzt lastAttemptAt sofort (claimOutageAlert
// sent:true, channels:[]) - jeder Parallellauf, der DANACH in denselben Lock kommt,
// sieht die Sperre bereits und urteilt nicht mehr "alarm". Der Versand selbst (Mail/
// SMS, sendAlert) bleibt ausserhalb des Locks - reines IO gehoert nicht in eine
// Store-Sperre.
async function claimVerdict({ store, bucket, schwellen, zaehlweise, nowMs }) {
  const result = await store.withStoreLock(() => {
    const state = store.load();
    const fenster = outageWindow(state.calls, { nowMs, windowMs: schwellen.windowMs, bucket, zaehlweise });
    const marker = ops.openOutageAlert(state, bucket);
    const urteilResult = beurteileAusfall({ fenster, marker, schwellen, nowMs });
    if (urteilResult.urteil === OUTAGE_VERDICT.ALERT) {
      ops.claimOutageAlert(state, { code: bucket, nowMs, sent: true, channels: [] });
    }
    return urteilResult;
  });
  store.save();
  return result;
}

// IEX-B1: WELCHE Ausfall-Klasse dieser BEENDETE Anruf belegt - oder keine. REIN, total und
// an EINER Stelle; der Ausloeser darunter kennt danach nur noch Klasse + Marker-Code.
// Outbound: unveraendert NUR die Basis-Klasse not-placed (Schuld bei uns/Anbieter) - ein
// Erfolg oder ein unreachable/no-answer/result-unknown-Abschluss ergibt null (K2 wird davon
// nur "gesuender", nie "kaputter": ein Erfolg senkt jeden Anteil und macht "erfolge===0"
// nur falscher). Inbound: NUR der vermerkte Rueckfall - GEBUNDEN ist der Erfolgsfall und
// WARTET ist kein Fehler-Beleg (Owner-Entscheidung F10b), beide ergeben null und der Melder
// laeuft fuer sie gar nicht erst an. Ein Outbound-Anruf kann nie RUECKFALL sein:
// bridgeStateOf verlangt das EL-Inbound-Kostenprofil.
function ausfallTrefferAmAnrufEnde(call) {
  if (call.direction === "outbound")
    return failureReasonBase(call.failureReason) === NOT_PLACED
      ? { klasse: AUSFALL_KLASSE.OUTBOUND, bucket: outageBucket(call.failureReason) }
      : null;
  return bridgeStateOf(call) === BRIDGE_STATE.RUECKFALL
    ? { klasse: AUSFALL_KLASSE.INBOUND_EL, bucket: INBOUND_EL_OUTAGE_CODE }
    : null;
}

// Der EINE Ausloeser: JEDER beendete Anruf fragt die Regel, fuer BEIDE Klassen ueber
// denselben Rumpf (G5 - keine zweite Urteils-/Meldefolge). Welche Klasse (falls ueberhaupt
// eine) er belegt, entscheidet das reine Praedikat darueber.
// Vollstaendig fail-soft: ein Fehler HIER darf niemals finishCall abbrechen (das ist der
// Zweck des umschliessenden try/catch - kein Wurf verlaesst diese Funktion je).
export async function reportSystematicOutage({ store, config, call, audit, messaging, mailer }) {
  try {
    const treffer = ausfallTrefferAmAnrufEnde(call);
    if (!treffer) return;
    const { klasse, bucket } = treffer;
    const nowMs = Date.parse(call.endedAt) || Date.now();
    const schwellen = klasse.schwellen(config);
    const { urteil, zahlen } = await claimVerdict({ store, bucket, schwellen, zaehlweise: klasse.zaehlweise, nowMs });
    await applyOutageVerdict({ urteil, bucket, zahlen, schwellen, nowMs, store, config, audit, messaging, mailer });
  } catch (err) {
    console.error("[outage] Ausfall-Melder fehlgeschlagen:", err.message);
  }
}

// D9 (Deviation): der Erholungs-Uebergang laeuft im Stunden-Sweep, nicht am Anruf-Ende -
// der Ausloeser oben sieht NUR not-placed-Anrufe, "fehler===0" kann dort nie eintreten.
// Schliesst JEDE offene Zeile, deren Fenster JETZT fehler===0 zeigt (eine Audit-Zeile je
// Uebergang; eine bereits geschlossene Zeile wird nicht erneut angefasst, weil sie gar
// nicht mehr in state.outageAlerts als OFFEN erscheint). Fail-soft wie der Ausloeser: ein
// Fehler hier darf den restlichen Sweep (costTruing/provisioning/costCrossCheck) nie
// beruehren (Isolation kommt vom eigenen .catch() des Aufrufers, boot.js#runSweepTick).
// nowMs injizierbar (Default Date.now(), Muster runAlertChannelSelfTest unten) - ein Test
// braucht eine deterministische Uhr, um ein LEERES Fenster von einem GESUNDEN zu
// unterscheiden (Blocker "falsche Entwarnung bei Null-Verkehr").
// B1-Fix (Review-Blocker Runde 3), IEX-B1 verallgemeinert: die offenen Marker, hinter denen
// eine Ausfall-KLASSE steht - je Marker gleich mit seiner Klasse gepaart, damit der Sweep
// darunter nur noch urteilt. Die Whitelist bleibt POSITIV formuliert: der Selbsttest-Marker
// (SELF_TEST_BUCKET, s.u.), der HOLD-Marker, die kosten:-Marker und jeder KUENFTIGE
// Nicht-Ausfall-Marker haben keine Klasse und duerfen outageWindow() nie befragen - fuer sie
// liefert es konstruktionsbedingt IMMER fehler=0, beurteileAusfall() urteilte bei JEDEM
// Sweep-Tick "erholt", der Sweep schloesse den Marker sofort wieder, und der Selbsttest
// faende beim naechsten Tick keinen offenen Marker mehr -> feuerte bei JEDEM Tick statt
// einmal je Periode.
function offeneAusfallMarker(outageAlerts) {
  const offene = outageAlerts.filter((alert) => alert.closedAt === null);
  return offene
    .map((marker) => ({ marker, klasse: ausfallKlasseVonMarker(marker.code) }))
    .filter((eintrag) => eintrag.klasse !== null);
}

export async function runOutageRecoverySweep({ store, config, audit, nowMs = Date.now() }) {
  const state = store.load();
  // Die Schwellen kommen JE Klasse (ein Inbound-Marker wird mit dem Inbound-Fenster
  // bewertet, nicht mit dem Outbound-Fenster).
  for (const { marker, klasse } of offeneAusfallMarker(state.outageAlerts)) {
    const schwellen = klasse.schwellen(config);
    const fenster = outageWindow(state.calls, {
      nowMs, windowMs: schwellen.windowMs, bucket: marker.code, zaehlweise: klasse.zaehlweise,
    });
    // E3B-02-Fix: EINE Urteilsstelle (beurteileAusfall) statt einer zweiten,
    // parallel formulierten RECOVERED-Klausel hier - sonst umgeht der Sweep den
    // Rollback-Hebel OUTAGE_VERDICT.OFF (windowMs=0) vollstaendig.
    const { urteil } = beurteileAusfall({ fenster, marker, schwellen, nowMs });
    if (urteil !== OUTAGE_VERDICT.RECOVERED) continue;
    await markOnly({ urteil, bucket: marker.code, zahlen: fenster, nowMs, store, audit });
  }
}

// C8b (Review-Blocker Runde 2, Plan-Abschnitt "Meldeweg und Alarm-Body"): "ein Kanal, der
// zwoelf Monate lang nie ausgeloest wurde, ist kein bewiesener Kanal". Der Selbsttest laeuft
// UEBER DENSELBEN Meldeweg (WARN -> Audit -> Mail -> SMS, sendMailChannel/sendSmsChannel von
// oben) - kein zweiter Versand-Codepfad (G5). Der Marker liegt im SELBEN durablen
// outageAlerts-Speicher wie ein echter Ausfall-Marker, unter einem eigenen, mit keinem
// echten Fehlergrund-Eimer kollidierenden Code - PM-23 gilt unveraendert: die Faelligkeit
// haengt an lastAttemptAt (durabel), nicht an einem In-Memory-Zaehler, und ueberlebt damit
// jeden Neustart. outageAlertSelfTestIntervalMs=0 schaltet den Selbsttest komplett ab
// (Rollback-Hebel, Muster outageAlertWindowMs).
const SELF_TEST_BUCKET = "self-test:alert-channel";

// B1-Fix (Review-Blocker Runde 3) + Review-Blocker Runde 2 (C8-HOLD-Marker faellt in den
// Erholungs-Sweep): das Praedikat "ist ein Fehlergrund-Eimer" an EINER Stelle statt als
// verstreuter Namensvergleich (G26/P16-Auftrag: "per Konstruktion", nicht ad hoc). POSITIV
// formuliert (Whitelist), nicht als Ausschlussliste: ein echter Fehlergrund-Eimer traegt
// IMMER das NOT_PLACED-Praefix (reportSystematicOutage/claimVerdict bauen den Marker-Code
// ausschliesslich aus outageBucket(call.failureReason), NACHDEM failureReasonBase(...) ===
// NOT_PLACED geprueft wurde - s. reportSystematicOutage oben). Jeder andere Marker-Code in
// state.outageAlerts (der Selbsttest SELF_TEST_BUCKET, der HOLD-Eskalationsmarker
// "hold:<grund>:<id>" unten) ist KEIN Fehlergrund und darf outageWindow() nie befragen -
// fuer sie liefert outageWindow() konstruktionsbedingt IMMER fehler=0 (kein echter
// call.failureReason bildet je auf einen dieser Codes ab), und der alte Ausschluss-Ansatz
// (nur SELF_TEST_BUCKET benannt) uebersah GENAU DESHALB den neuen HOLD-Marker: ein
// beantworteter Anruf im Fenster urteilte "erholt" auf einem Marker, der nie einen
// Fehlschlag gezaehlt hat, und schloss ihn faelschlich - die Eskalation (C8) wiederholte
// sich dann bei jedem Sweep, weil kein offener Marker mehr gefunden wurde. Eine Whitelist
// ist die richtige Bauform, weil jeder KUENFTIGE Nicht-Fehlergrund-Marker automatisch
// ausgeschlossen bleibt, ohne dass dieses Praedikat je wieder angefasst werden muss.
function istFehlergrundEimer(code) {
  return code.startsWith(NOT_PLACED);
}

// IEX-B1: die Klasse hinter einem offenen Marker-Code, oder null fuer jeden Marker, der
// KEIN Ausfall ist. Zwei Zeilen, EINE Stelle - der Erholungs-Sweep fragt nur hier (G23-
// Geist: ein Diskriminator, eine Aufloesung, kein verstreuter Namensvergleich). Die beiden
// Zweige sind disjunkt: INBOUND_EL_OUTAGE_CODE traegt kein not-placed-Praefix.
function ausfallKlasseVonMarker(code) {
  if (code === INBOUND_EL_OUTAGE_CODE) return AUSFALL_KLASSE.INBOUND_EL;
  return istFehlergrundEimer(code) ? AUSFALL_KLASSE.OUTBOUND : null;
}

// Reine Faelligkeits-Frage (Muster meldeErlaubt/outage-detection.js): kein Marker oder nie
// versucht -> faellig; sonst faellig, sobald seit dem letzten Versuch mindestens
// intervalMs vergangen sind. intervalMs<=0 haelt den Selbsttest fuer immer aus.
function selfTestFaellig(marker, nowMs, intervalMs) {
  if (intervalMs <= 0) return false;
  if (!marker || !marker.lastAttemptAt) return true;
  return nowMs - Date.parse(marker.lastAttemptAt) >= intervalMs;
}

// Fail-soft wie reportSystematicOutage: ein Fehler hier darf den Stunden-Sweep (der
// Selbsttest teilt sich dessen Takt) niemals abbrechen. Reservierung ZUERST (G26-Muster):
// lastAttemptAt sperrt sofort jeden Parallellauf, danach erst der eigentliche Versand.
export async function runAlertChannelSelfTest({ store, config, audit, messaging, mailer, nowMs = Date.now() }) {
  try {
    const intervalMs = config.billing.outageAlertSelfTestIntervalMs;
    // G26-Muster: Faelligkeits-Urteil UND Reservierung ATOMAR im SELBEN Lock, VOR jedem
    // Versand - sonst lesen zwei gleichzeitige Sweep-Ticks denselben, noch nicht
    // geclaimten Marker, urteilen BEIDE "faellig" und senden beide.
    const faellig = await store.withStoreLock(() => {
      const state = store.load();
      const marker = ops.openOutageAlert(state, SELF_TEST_BUCKET);
      const istFaellig = selfTestFaellig(marker, nowMs, intervalMs);
      if (istFaellig) ops.claimOutageAlert(state, { code: SELF_TEST_BUCKET, nowMs, sent: true, channels: [] });
      return istFaellig;
    });
    store.save();
    if (!faellig) return;
    // PII-frei (Regel 10): keine Fehlerklasse, keine Zahlen noetig - reiner Funktionsnachweis.
    const zeile = "Hermes Betriebsmeldung\nAlarmkanal funktioniert (Selbsttest)";
    console.warn("[outage] alert_channel_self_test");
    audit("alert_channel_self_test", null, zeile);
    await sendeUeberBeideKanaele({ store, config, messaging, mailer, code: SELF_TEST_BUCKET, zeile, nowMs });
  } catch (err) {
    console.error("[outage] Alarmkanal-Selbsttest fehlgeschlagen:", err.message);
  }
}

// ---- OUTBOUND-E3b (C8, F-8): HOLD-Eskalation ueber DENSELBEN Meldeweg -------------------
// Owner-Frage F-8 (Plan-Abschnitt 9): "Darf eine Kuendigung wegen einer Plattform-Bindung
// haengen bleiben? Ja, mit HOLD + Audit + 24-h-Eskalation. Artikel 17 ist unabhaengig davon
// erfuellt." Kein zweiter Kanal, keine zweite Entprellung (G5): derselbe WARN -> Audit ->
// Mail -> SMS-Weg wie der Ausfall-Alarm, derselbe durable Marker-Speicher
// (state.outageAlerts) wie der C8b-Selbsttest. Anders als dort ist die Entprellung hier
// PERMANENT statt zeitbasiert (kein retryMs/debounceMs): "der naechste Sweep wiederholt ihn
// NICHT" gilt fuer immer, nicht nur fuer eine Frist - einmal eskaliert ist der HOLD ein an
// den Betreiber uebergebener Vorgang, keine wiederkehrende Meldung. Der Marker-Code traegt
// die interne Nummern-ID (kein e164, keine PII, Regel 10 - dieselbe Konvention wie jede
// did-release-Audit-Zeile, release-reconcile.js#recordDidAudit "number=${number.id}").
function platformHoldBucket(numberId) {
  return `hold:${NUMBER_HOLD_REASON.PLATFORM_IN_USE}:${numberId}`;
}

// ZUSATZAUFTRAG B (E3b-Nachbesserung): reine ANZAHLEN, kein Bezug. Ohne sie weiss der
// Empfaenger nicht, ob EINE oder FUENF Kuendigungen haengen - und damit nicht, wie
// dringend der Vorgang ist. KEINE Rufnummer, KEINE Tenant-Identitaet, KEINE Nummern-ID
// (Regel 10, C8-PII-Test gilt weiter) - kuendigungen zaehlt DISTINKTE Tenants (ein Tenant
// mit mehreren gehaltenen Nummern ist EINE Kuendigung), nummern zaehlt die Zeilen selbst.
function holdEskalationsZahlen(candidates) {
  return { kuendigungen: new Set(candidates.map((nummer) => nummer.tenantId)).size, nummern: candidates.length };
}

// Muster der Bestands-Alarmzeile (fehler=/versuche=, outage-detection.js#alarmZeile):
// benannte Zahlen statt Prosa ("eine Kuendigung wartet"). zahlen kommt vom AUFRUFER
// (runPlatformHoldEscalationSweep) - EINMAL aus candidates berechnet und in JEDEN Aufruf
// desselben Sweeps durchgereicht: alle Zeilen dieses Sweeps tragen dieselben Gesamtzahlen,
// nicht die des jeweils EINEN Kandidaten (gewollt - der Empfaenger soll den GESAMTumfang
// des Vorgangs sehen, nicht nur die eine Nummer, die diese Zeile ausgeloest hat).
function holdZeile({ kuendigungen, nummern }) {
  return (
    "Hermes Betriebsmeldung\n" +
    `klasse=${NUMBER_HOLD_REASON.PLATFORM_IN_USE} kuendigungen=${kuendigungen} nummern=${nummern} ` +
    "warten seit ueber der Eskalations-Schwelle auf die Freigabe einer Rufnummer"
  );
}

// Ein Kandidat: Faelligkeits-Urteil UND Reservierung ATOMAR im SELBEN Lock (G26-Muster,
// Vorbild runAlertChannelSelfTest) - ein bereits offener Marker fuer GENAU diese Nummer
// heisst "schon eskaliert", kein zweiter Versand, auch nicht bei zwei parallelen Sweeps.
async function meldeHoldEskalation({ store, config, audit, messaging, mailer, numberId, zahlen, nowMs }) {
  const bucket = platformHoldBucket(numberId);
  const zuMelden = await store.withStoreLock(() => {
    const state = store.load();
    if (ops.openOutageAlert(state, bucket)) return false;
    ops.claimOutageAlert(state, { code: bucket, nowMs, sent: true, channels: [] });
    return true;
  });
  store.save();
  if (!zuMelden) return;
  await meldeBetreiberAlarm({
    store, config, audit, messaging, mailer,
    bucket, aktion: "platform_hold_escalation", zeile: holdZeile(zahlen), nowMs,
  });
}

// Fail-soft wie die uebrigen Sweep-Zweige. nowMs injizierbar (Muster runOutageRecoverySweep/
// runAlertChannelSelfTest). maxAgeMs<=0 haelt die Eskalation komplett aus (Rollback-Hebel,
// Muster outageAlertWindowMs/outageAlertSelfTestIntervalMs).
export async function runPlatformHoldEscalationSweep({ store, config, audit, messaging, mailer, nowMs = Date.now() }) {
  try {
    const maxAgeMs = config.billing.platformHoldEscalationMaxAgeMs;
    if (maxAgeMs <= 0) return;
    const candidates = ops.platformHoldEscalationCandidates(store.load(), { nowMs, maxAgeMs });
    const zahlen = holdEskalationsZahlen(candidates);
    for (const number of candidates)
      await meldeHoldEskalation({ store, config, audit, messaging, mailer, numberId: number.id, zahlen, nowMs });
  } catch (err) {
    console.error("[outage] HOLD-Eskalation fehlgeschlagen:", err.message);
  }
}

// Fabrik fuer den vierten (Erholungs-Sweep), fuenften (Selbsttest, C8b) und sechsten
// (HOLD-Eskalation, C8) Zweig des Stunden-Sweeps (boot.js#runSweepTick, Muster
// makeCostTruing/makeCostCrossCheck: EINMAL beim Boot verdrahtet, INV-7). messaging/mailer
// sind dieselben Instanzen wie beim echten Ausfall-Melder (DIP, kein zweiter Versandzugang).
export function makeOutageWatch({ store, config, audit, messaging, mailer }) {
  return {
    runRecoverySweep: () => runOutageRecoverySweep({ store, config, audit }),
    runAlertChannelSelfTest: () => runAlertChannelSelfTest({ store, config, audit, messaging, mailer }),
    runHoldEscalationSweep: () => runPlatformHoldEscalationSweep({ store, config, audit, messaging, mailer }),
  };
}
