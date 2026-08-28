// OUTBOUND-E4: der Takt des Waechters. KEIN neuer Timer, KEINE neue Ressource:
// (1) einmal beim Boot (fire-and-forget, nach app.listen), (2) als SIEBTER Zweig des
// bestehenden Stunden-Sweeps (boot.js#runSweepTick), (3) extern ueber den
// GitHub-Actions-Workflow, der dieselbe Pruefung als CLI faehrt.
// AUSDRUECKLICH NICHT vor jedem Waehlen (Plan E-6): Anbieter-Latenz auf dem Anrufstart,
// unbeschraenkte Anbieter-Last bei Skala, und ein Falsch-Positiv verhinderte einen
// bezahlten Kundenanruf.
import { messeAnbieterWirklichkeit } from "./outbound-config-probe.js";
import { beurteileDrift, DRIFT_KLASSE } from "./outbound-config-drift.js";
import { meldeBetreiberAlarm, meldeBetreiberNotiz } from "./outage-report.js";
import { sollAusConfig as sollAusConfigGeteilt, schwellenAusConfig as schwellenAusConfigGeteilt } from "./outbound-config-soll.js";
import * as ops from "../store/state-ops.js";
import { PLATFORM_NUMBER_PURPOSE } from "../store/defaults.js";
import { MS_PER_MINUTE } from "../utils/timer.js";

const MINUTEN_PRO_STUNDE = 60;
const STUNDEN_PRO_TAG = 24;
const MS_PRO_TAG = STUNDEN_PRO_TAG * MINUTEN_PRO_STUNDE * MS_PER_MINUTE;

const LAUF_MARKER = "drift:lauf"; // lastSeenAt = letzter beanspruchter Lauf (Single-Flight)
const MESSUNG_OK_MARKER = "drift:messung-ok"; // lastSeenAt = letzte ERFOLGREICHE Messung
const DRIFT_BUCKET_PREFIX = "drift:";
// EXPORTIERT: der ANI-Riegel (outbound-gates.js) liest den ownership_lost-Marker unter
// GENAU demselben Bucket-Namen - eine zweite, dort getippte Zusammensetzung koennte von
// dieser abdriften, ohne dass ein Test es merkt (G5).
export const befundBucket = (code) => `${DRIFT_BUCKET_PREFIX}${code}`;
const istBefundMarkerCode = (code) => code.startsWith(DRIFT_BUCKET_PREFIX) && code !== LAUF_MARKER && code !== MESSUNG_OK_MARKER;

// Befundklasse -> Meldestufe (das einzige Dispatch-Table dieser Etappe, Plan E4 Tabelle):
// ownership/config/watchdog_stale melden VOLL (WARN->Audit->Mail->SMS), warn/unknown nur
// NOTIZ (WARN->Audit, kein Versand) - "nie stumm" ist trotzdem erfuellt, weil beide Stufen
// eine durable Audit-Zeile hinterlassen.
const VOLL_KLASSEN = new Set([DRIFT_KLASSE.OWNERSHIP, DRIFT_KLASSE.CONFIG, DRIFT_KLASSE.STALE]);

// Pruefung 8: der 24-h-Verbrauch ist KEINE Anbieter-Abfrage, sondern eine Store-Query
// (echte Carrier-Kosten, schema.sql#actualCostMicroCents) - deshalb hier, nicht im Probe.
function verbrauch24hMicroCents(calls, nowMs) {
  const vonMs = nowMs - MS_PRO_TAG;
  let summe = 0;
  for (const call of calls) {
    const endedMs = Date.parse(call.endedAt || "");
    if (Number.isNaN(endedMs) || endedMs < vonMs || endedMs > nowMs) continue;
    if (Number.isSafeInteger(call.actualCostMicroCents) && call.actualCostMicroCents >= 0)
      summe += call.actualCostMicroCents;
  }
  return summe;
}

function driftZeile(befund) {
  return `Hermes Betriebsmeldung\nklasse=${befund.klasse} befund=${befund.code} ${befund.detail}`;
}

// SINGLE-FLIGHT + MINDESTFRIST in EINEM atomaren Schritt (PM-26). Der CLAIM-MARKER statt
// pg_try_advisory_lock (der Plan laesst beides zu): der Marker liegt in outage_alert,
// einer bereits durablen, global sichtbaren Tabelle - ein advisory lock braeuchte neue
// Store-Methoden in json.js UND pg.js, und makePgStore traegt eine gepinnte Zeilenzahl
// (eslint-legacy-exceptions.json), die kein Bau-Agent ohne Owner-Freigabe anheben darf.
// Innerhalb eines Prozesses ist der Claim durch withStoreLock atomar; zwischen Instanzen
// wirkt die Mindestfrist ueber den hydrierten Marker. RESTRISIKO (bewusst getragen, Plan
// Abschnitt 8): zwei Instanzen, die im selben Flush-Fenster booten, laufen beide - das
// sind 2x9 GETs gegen ein 4-req/s-Limit, kein Rate-Limit-Sturm.
async function beanspruchen({ store, nowMs, minIntervalMs }) {
  const beansprucht = await store.withStoreLock(() => {
    const state = store.load();
    const marker = ops.openOutageAlert(state, LAUF_MARKER);
    if (marker && marker.lastSeenAt && nowMs - Date.parse(marker.lastSeenAt) < minIntervalMs) return false;
    ops.claimOutageAlert(state, { code: LAUF_MARKER, nowMs });
    return true;
  });
  store.save();
  return beansprucht;
}

// Offene drift:-Marker, die im AKTUELLEN Lauf keinen Befund mehr haben -> schliessen (eine
// Audit-Zeile drift_recovered je Uebergang). Damit alarmiert eine Wiederholung spaeter
// erneut (kein dauerhaft "erledigt" auf einem Befund, der wiederkommt).
//
// REVIEW-BLOCKER (falsche Entwarnung waehrend eines laufenden Ausfalls): "im aktuellen
// Lauf keinen Befund mehr" ist NUR dann eine echte Entwarnung, wenn dieser Lauf ueberhaupt
// ein Urteil faellen konnte. Ein reiner Anbieterfehler (429/Timeout) macht aus
// "ownership_lost" ein "unbekannt:pruefung3" - der Marker waere sonst geschlossen worden,
// obwohl der Ausfall unveraendert fortbesteht (PM-16, eine Ebene hoeher als der Kern).
// Dieselbe Bedingung wie beim MESSUNG_OK_MARKER (zaehler.unknown === 0): kann der Lauf
// auch nur EINE Pruefung nicht beurteilen, wird in diesem Lauf GAR NICHTS geschlossen -
// lieber ein Marker, der laenger offen bleibt, als eine geloeschte Warnung waehrend eines
// laufenden Ausfalls.
function schliesseVerschwundeneBefunde({ store, audit, befunde, zaehler, nowMs }) {
  if (zaehler.unknown > 0) return;
  const aktuelle = new Set(befunde.map((befund) => befundBucket(befund.code)));
  const state = store.load();
  const offene = state.outageAlerts.filter(
    (alert) => alert.closedAt === null && istBefundMarkerCode(alert.code) && !aktuelle.has(alert.code),
  );
  if (offene.length === 0) return;
  for (const marker of offene) {
    ops.closeOutageAlert(state, { code: marker.code, nowMs });
    audit("drift_recovered", null, `Hermes Betriebsmeldung\nbefund=${marker.code} nicht mehr gemessen`);
  }
  store.save();
}

function sollAusConfig({ config, store, verbrauch24hMs }) {
  const alertBinding = ops.openPlatformBindingByPurpose(store.load(), PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER);
  const messungOk = ops.openOutageAlert(store.load(), MESSUNG_OK_MARKER);
  return {
    ...sollAusConfigGeteilt(config),
    alertSenderE164: alertBinding?.e164 || "",
    verbrauch24hMicroCents: verbrauch24hMs,
    letzteErfolgreicheMessungMs: messungOk ? Date.parse(messungOk.lastSeenAt) : null,
  };
}

// Vollstaendig fail-soft: ein Fehler HIER darf niemals den Boot oder den Stunden-Sweep
// abbrechen (Muster reportSystematicOutage/runPlatformHoldEscalationSweep).
async function laufeDrift({ store, config, audit, messaging, mailer, telnyxRead, elRead, anlass }) {
  try {
    const minIntervalMs = config.billing.outboundDriftMinIntervalMs;
    // Rollback-Hebel (Muster outageAlertWindowMs=0): 0 haelt den Waechter komplett aus.
    if (minIntervalMs <= 0) return;
    const nowMs = Date.now();
    if (!(await beanspruchen({ store, nowMs, minIntervalMs }))) return;

    const state = store.load();
    const soll = sollAusConfig({ config, store, verbrauch24hMs: verbrauch24hMicroCents(state.calls, nowMs) });
    const schwellen = schwellenAusConfigGeteilt(config);

    const messung = await messeAnbieterWirklichkeit({ telnyxRead, elRead, soll });
    const { befunde, zaehler, gemessen, soll: sollAnzahl } = beurteileDrift({ messung, soll, schwellen, nowMs });

    // Umfangs-Zeile IMMER loggen, auch im gruenen Fall (Betriebs-Positiv-Kontrolle,
    // Lehre pruefkommando-ohne-positiv-kontrolle): ein Waechter, der nichts findet, muss
    // von einem, der nichts sucht, unterscheidbar bleiben.
    console.log(`[drift] anlass=${anlass} gemessen=${gemessen} von ${sollAnzahl} befunde=${befunde.length} unbekannt=${zaehler.unknown}`);

    for (const befund of befunde) {
      if (befund.ausgenommen) continue;
      const bucket = befundBucket(befund.code);
      const zeile = driftZeile(befund);
      if (VOLL_KLASSEN.has(befund.klasse)) {
        await meldeBetreiberAlarm({ store, config, audit, messaging, mailer, bucket, aktion: `drift_${befund.code}`, zeile, nowMs });
      } else {
        await meldeBetreiberNotiz({ store, audit, bucket, aktion: `drift_${befund.code}`, zeile, nowMs });
      }
    }
    schliesseVerschwundeneBefunde({ store, audit, befunde, zaehler, nowMs });

    if (zaehler.unknown === 0) {
      await store.withStoreLock(() => {
        ops.claimOutageAlert(store.load(), { code: MESSUNG_OK_MARKER, nowMs });
      });
      store.save();
    }
  } catch (err) {
    console.error("[drift-watch]", err.message);
  }
}

// Fabrik (Muster makeOutageWatch): EINMAL beim Boot verdrahtet (INV-7). telnyxRead/elRead
// sind der rein lesende Read-Port (registry.js#providerConfigRead, elevenlabs/convai.js#
// fetchPhoneNumber ueber eine schmale account-Closure) - server.js injiziert sie.
export function makeDriftWatch({ store, config, audit, messaging, mailer, telnyxRead, elRead }) {
  return {
    runDriftSweep: () => laufeDrift({ store, config, audit, messaging, mailer, telnyxRead, elRead, anlass: "sweep" }),
    runBootProbe: () => laufeDrift({ store, config, audit, messaging, mailer, telnyxRead, elRead, anlass: "boot" }),
  };
}
