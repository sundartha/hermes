import {
  AT_CAPACITY,
  NOT_PLACED,
  meldetAlsNichtGestartet,
} from "./failure-reason.js";
import { outageBucket, outageWindow, beurteileAusfall, alarmZeile, meldeErlaubt, OUTAGE_VERDICT } from "./outage-detection.ts";
import { AUSFALL_KLASSE, INBOUND_EL_OUTAGE_CODE, OUTBOUND_EL_OUTAGE_CODE } from "./outage-classes.ts";
import { BRIDGE_STATE, bridgeStateOf, istOutboundElProfil } from "../elevenlabs/inbound-bridge-state.js";
import { sendFailSoftAlertSms, platformAlertSender } from "./alert-sms.js";
import { NUMBER_HOLD_REASON } from "../begriffe/nummern-vergabe.js";

async function bereicheVon(store) {
  const { speicherBereiche } = await import("../store.js");
  return speicherBereiche(store);
}

const CHANNEL = Object.freeze({ MAIL: "mail", SMS: "sms" });

const AUDIT_ACTION = Object.freeze({
  [OUTAGE_VERDICT.FIRST]: "outage_detected",
  [OUTAGE_VERDICT.ALERT]: "outage_alert",
  [OUTAGE_VERDICT.RECOVERED]: "outage_recovered",
});

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

function sendSmsChannel({ messaging, store, config, zeile }) {
  sendFailSoftAlertSms({
    messaging,
    to: config.billing.platformAlertSmsTo,
    body: zeile,
    resolveSender: () => platformAlertSender(store),
    onError: (err) => console.error(`[outage] Kanal ${CHANNEL.SMS} fehlgeschlagen:`, err.message),
  });
}

async function sendeUeberBeideKanaele({ store, config, messaging, mailer, code, zeile, nowMs }) {
  const mailResult = await sendMailChannel({ mailer, config, zeile });
  sendSmsChannel({ messaging, store, config, zeile });
  const delivered = mailResult.delivered || !mailResult.hasTarget;
  const bereiche = await bereicheVon(store);
  await bereiche.ausfall.alarmVersendet({ code, nowMs, channels: delivered ? ["mail"] : [] });
}

async function markOnly({ urteil, bucket, zahlen, nowMs, store, audit }) {
  const zeile = `${AUDIT_ACTION[urteil]} klasse=${bucket} fehler=${zahlen.fehler} versuche=${zahlen.versuche}`;
  console.warn(`[outage] ${zeile}`);
  audit(AUDIT_ACTION[urteil], null, zeile);
  const bereiche = await bereicheVon(store);
  if (urteil === OUTAGE_VERDICT.RECOVERED) await bereiche.ausfall.markerSchliessen({ code: bucket, nowMs });
  else await bereiche.ausfall.notizClaimen({ code: bucket, nowMs });
}

export async function meldeBetreiberAlarm({ store, config, audit, messaging, mailer, bucket, aktion, zeile, nowMs }) {
  const bereiche = await bereicheVon(store);
  if (!(await bereiche.ausfall.sendeplatzReserviert({ bucket, nowMs })))
    throw new Error(`meldeBetreiberAlarm: Sendeplatz fuer ${bucket} nicht reserviert`);
  console.warn(`[outage] ${aktion} klasse=${bucket}`);
  audit(aktion, null, zeile);
  await sendeUeberBeideKanaele({ store, config, messaging, mailer, code: bucket, zeile, nowMs });
}

export async function meldeBetreiberNotiz({ store, audit, bucket, aktion, zeile, nowMs }) {
  console.warn(`[outage] ${aktion} klasse=${bucket}`);
  audit(aktion, null, zeile);
  const bereiche = await bereicheVon(store);
  await bereiche.ausfall.notizClaimen({ code: bucket, nowMs });
}

function sendeplatzFrei({ marker, nowMs, config }) {
  if (!marker) return true;
  const { outageAlertDebounceMs: debounceMs, outageAlertRetryMs: retryMs } = config.billing;
  if (marker.lastAttemptAt && nowMs - Date.parse(marker.lastAttemptAt) < retryMs) return false;
  return meldeErlaubt(marker, nowMs, { debounceMs, retryMs });
}

async function reserviereSendeplatz({ store, config, bucket, nowMs }) {
  const bereiche = await bereicheVon(store);
  return bereiche.ausfall.sendeplatzReservieren({
    bucket, nowMs, frei: (marker) => sendeplatzFrei({ marker, nowMs, config }),
  });
}

export async function meldeVollBefund({ store, config, audit, messaging, mailer, bucket, aktion, zeile, nowMs }) {
  if (await reserviereSendeplatz({ store, config, bucket, nowMs })) {
    await meldeBetreiberAlarm({ store, config, audit, messaging, mailer, bucket, aktion, zeile, nowMs });
  } else {
    await meldeBetreiberNotiz({ store, audit, bucket, aktion: `${aktion}_entprellt`, zeile, nowMs });
  }
}

async function sendAlert({ bucket, zahlen, nowMs, store, config, audit, messaging, mailer, schwellen }) {
  const zeile = alarmZeile({ code: bucket, zahlen, regel: OUTAGE_VERDICT.ALERT, windowMs: schwellen.windowMs });
  await meldeBetreiberAlarm({ store, config, audit, messaging, mailer, bucket, aktion: "outage_alert", zeile, nowMs });
}

const VERDICT_HANDLERS = Object.freeze({
  [OUTAGE_VERDICT.FIRST]: markOnly,
  [OUTAGE_VERDICT.RECOVERED]: markOnly,
  [OUTAGE_VERDICT.ALERT]: sendAlert,
});

async function applyOutageVerdict(context) {
  const handler = VERDICT_HANDLERS[context.urteil];
  if (handler) await handler(context);
}

async function claimVerdict({ store, bucket, schwellen, zaehlweise, nowMs }) {
  const bereiche = await bereicheVon(store);
  return bereiche.ausfall.urteilClaimen({
    bucket,
    nowMs,
    beurteile: ({ calls, marker }) => {
      const fenster = outageWindow(calls, { nowMs, windowMs: schwellen.windowMs, bucket, zaehlweise });
      return beurteileAusfall({ fenster, marker, schwellen, nowMs });
    },
    istAlarm: (ergebnis) => ergebnis.urteil === OUTAGE_VERDICT.ALERT,
  });
}

function outboundTrefferAmAnrufEnde(call) {
  if (bridgeStateOf(call) === BRIDGE_STATE.RUECKFALL && istOutboundElProfil(call))
    return { klasse: AUSFALL_KLASSE.OUTBOUND_EL, bucket: OUTBOUND_EL_OUTAGE_CODE };
  return meldetAlsNichtGestartet(call.failureReason)
    ? { klasse: AUSFALL_KLASSE.OUTBOUND, bucket: outageBucket(call.failureReason) }
    : null;
}

function ausfallTrefferAmAnrufEnde(call) {
  if (call.direction === "outbound") return outboundTrefferAmAnrufEnde(call);
  return bridgeStateOf(call) === BRIDGE_STATE.RUECKFALL
    ? { klasse: AUSFALL_KLASSE.INBOUND_EL, bucket: INBOUND_EL_OUTAGE_CODE }
    : null;
}

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

function offeneAusfallMarker(outageAlerts) {
  const offene = outageAlerts.filter((alert) => alert.closedAt === null);
  return offene
    .map((marker) => ({ marker, klasse: ausfallKlasseVonMarker(marker.code) }))
    .filter((eintrag) => eintrag.klasse !== null);
}

export async function runOutageRecoverySweep({ store, config, audit, nowMs = Date.now() }) {
  const bereiche = await bereicheVon(store);
  const state = await bereiche.ausfall.offeneAusfallZustand();
  for (const { marker, klasse } of offeneAusfallMarker(state.outageAlerts)) {
    const schwellen = klasse.schwellen(config);
    const fenster = outageWindow(state.calls, {
      nowMs, windowMs: schwellen.windowMs, bucket: marker.code, zaehlweise: klasse.zaehlweise,
    });
    const { urteil } = beurteileAusfall({ fenster, marker, schwellen, nowMs });
    if (urteil !== OUTAGE_VERDICT.RECOVERED) continue;
    await markOnly({ urteil, bucket: marker.code, zahlen: fenster, nowMs, store, audit });
  }
}

const SELF_TEST_BUCKET = "self-test:alert-channel";

function istFehlergrundEimer(code) {
  return code.startsWith(NOT_PLACED) || code.startsWith(AT_CAPACITY);
}

function ausfallKlasseVonMarker(code) {
  if (code === INBOUND_EL_OUTAGE_CODE) return AUSFALL_KLASSE.INBOUND_EL;
  if (code === OUTBOUND_EL_OUTAGE_CODE) return AUSFALL_KLASSE.OUTBOUND_EL;
  return istFehlergrundEimer(code) ? AUSFALL_KLASSE.OUTBOUND : null;
}

function selfTestFaellig(marker, nowMs, intervalMs) {
  if (intervalMs <= 0) return false;
  if (!marker || !marker.lastAttemptAt) return true;
  return nowMs - Date.parse(marker.lastAttemptAt) >= intervalMs;
}

export async function runAlertChannelSelfTest({ store, config, audit, messaging, mailer, nowMs = Date.now() }) {
  try {
    const intervalMs = config.billing.outageAlertSelfTestIntervalMs;
    const bereiche = await bereicheVon(store);
    const faellig = await bereiche.ausfall.selbsttestClaimen({
      bucket: SELF_TEST_BUCKET,
      nowMs,
      faellig: (marker) => selfTestFaellig(marker, nowMs, intervalMs),
    });
    if (!faellig) return;
    const zeile = "Hermes Betriebsmeldung\nAlarmkanal funktioniert (Selbsttest)";
    console.warn("[outage] alert_channel_self_test");
    audit("alert_channel_self_test", null, zeile);
    await sendeUeberBeideKanaele({ store, config, messaging, mailer, code: SELF_TEST_BUCKET, zeile, nowMs });
  } catch (err) {
    console.error("[outage] Alarmkanal-Selbsttest fehlgeschlagen:", err.message);
  }
}

function platformHoldBucket(numberId) {
  return `hold:${NUMBER_HOLD_REASON.PLATFORM_IN_USE}:${numberId}`;
}

function holdEskalationsZahlen(candidates) {
  return { kuendigungen: new Set(candidates.map((nummer) => nummer.tenantId)).size, nummern: candidates.length };
}

function holdZeile({ kuendigungen, nummern }) {
  return (
    "Hermes Betriebsmeldung\n" +
    `klasse=${NUMBER_HOLD_REASON.PLATFORM_IN_USE} kuendigungen=${kuendigungen} nummern=${nummern} ` +
    "warten seit ueber der Eskalations-Schwelle auf die Freigabe einer Rufnummer"
  );
}

async function meldeHoldEskalation({ store, config, audit, messaging, mailer, numberId, zahlen, nowMs }) {
  const bucket = platformHoldBucket(numberId);
  const bereiche = await bereicheVon(store);
  const zuMelden = await bereiche.ausfall.holdEskalationClaimen({ bucket, nowMs });
  if (!zuMelden) return;
  await meldeBetreiberAlarm({
    store, config, audit, messaging, mailer,
    bucket, aktion: "platform_hold_escalation", zeile: holdZeile(zahlen), nowMs,
  });
}

export async function runPlatformHoldEscalationSweep({ store, config, audit, messaging, mailer, nowMs = Date.now() }) {
  try {
    const maxAgeMs = config.billing.platformHoldEscalationMaxAgeMs;
    if (maxAgeMs <= 0) return;
    const bereiche = await bereicheVon(store);
    const candidates = await bereiche.ausfall.holdKandidaten({ nowMs, maxAgeMs });
    const zahlen = holdEskalationsZahlen(candidates);
    for (const number of candidates)
      await meldeHoldEskalation({ store, config, audit, messaging, mailer, numberId: number.id, zahlen, nowMs });
  } catch (err) {
    console.error("[outage] HOLD-Eskalation fehlgeschlagen:", err.message);
  }
}

export function makeOutageWatch({ store, config, audit, messaging, mailer }) {
  return {
    runRecoverySweep: () => runOutageRecoverySweep({ store, config, audit }),
    runAlertChannelSelfTest: () => runAlertChannelSelfTest({ store, config, audit, messaging, mailer }),
    runHoldEscalationSweep: () => runPlatformHoldEscalationSweep({ store, config, audit, messaging, mailer }),
  };
}
