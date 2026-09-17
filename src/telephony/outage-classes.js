// IEX-B1: die AUSFALL-KLASSEN des Betreiber-Melders an EINER Stelle. Eine Klasse
// beantwortet genau zwei Fragen: WIE im Zeitfenster gezaehlt wird (zaehlweise) und WELCHE
// Schwellen gelten (schwellen). Die Erkennungsregel selbst (beurteileAusfall,
// meldeErlaubt, die Entprellung, alarmZeile - outage-detection.js) ist fuer BEIDE Klassen
// DIESELBE: keine zweite Fristlogik, keine zweite Body-Formulierung (G5). Rein und IO-frei;
// schwellen(config) liest ausschliesslich Werte aus dem uebergebenen Objekt.
//
// WARUM Inbound eine EIGENE Zaehlweise braucht (der Kern dieser Phase): die
// Outbound-Definition von Erfolg (call.answeredAt) ist fuer eingehende Anrufe FALSCH. Seit
// der Sofortannahme (IEP-P2, EL_DIAL_ANSWER_ON_BRIDGE=false in
// elevenlabs/inbound-rueckfall.js) ist das Anrufer-Bein ab dem TeXML beantwortet - JEDER
// eingehende Anruf traegt answeredAt, auch der, dessen Uebergabe an den Agenten danach
// scheiterte. Mit der Outbound-Zaehlweise haette der Inbound-Melder NIE ausgeloest und
// dabei gruen ausgesehen (Pre-Mortem R1).
import { BRIDGE_STATE, bridgeStateOf } from "../elevenlabs/inbound-bridge-state.js";
import { ZAEHLWEISE_OUTBOUND } from "./outage-detection.js";

// Eigener Namensraum, der mit keinem Bestands-Eimer kollidiert (not-placed*, drift:, hold:,
// self-test:, kosten:) - eigener Marker, eigene Entprellung, eigene Erholung (Pre-Mortem
// R4). openOutageAlert sucht je code; die Tabelle outage_alert bleibt unveraendert (I5).
export const INBOUND_EL_OUTAGE_CODE = "inbound-el:uebergabe";

// Fail-closed: ein Fenster, das keine endliche Zahl ist, schaltet die Klasse AUS statt sie
// auf einem undefinierten Fenster scharf zu stellen. In Produktion liefert config.js immer
// eine validierte Zahl; die Klausel deckt Attrappen-Configs, die nur ihre eigenen Schluessel
// hereinreichen (ohne sie waere windowMs undefined -> nowMs-undefined = NaN -> jeder
// Fenstervergleich falsch, Pre-Mortem R6). Ausdruecklich NICHT in beurteileAusfall gezogen:
// das liesse den Outbound-Pfad fuer eine Eingabe anders urteilen als heute (I1 verlangt
// "fuer KEINE Eingabe").
const MELDER_AUS = 0;
function fensterOderAus(windowMs) {
  return Number.isFinite(windowMs) ? windowMs : MELDER_AUS;
}

// WARTET zaehlt in den NENNER, ist aber KEIN Fehler-Beleg: "Anrufer legt in der Wartephase
// auf" ist von einem gescheiterten Dial mit persistierten Feldern nicht trennbar
// (tasks/iex-spec-a.md 9 F4), und Owner-Entscheidung F10b sagt dazu "nicht benachrichtigen"
// (Pre-Mortem R2). Sichtbar bleibt WARTET trotzdem: versuche - erfolge - fehler ist exakt
// die Wartephasen-Zahl, und alle drei Groessen stehen in jedem Alarm-Body (alarmZeile).
// Auf die Alarm-Bedingung wirkt WARTET nur daempfend - es senkt den K2-Anteil und
// verhindert K1 nie (K1 haengt an erfolge===0 bzw. der Tenant-Zahl, nicht am Nenner). Ein
// Fenster aus lauter Auflegern ergibt fehler=0 und damit "kein-befund"; mangels erfolge>0
// ist es auch keine falsche Entwarnung.
const ZAEHLWEISE_INBOUND_EL = Object.freeze({
  zaehltMit: (call) => bridgeStateOf(call) !== BRIDGE_STATE.KEIN_EL_INBOUND,
  belegtErfolg: (call) => bridgeStateOf(call) === BRIDGE_STATE.GEBUNDEN,
  belegtFehler: (call) => bridgeStateOf(call) === BRIDGE_STATE.RUECKFALL,
});

// debounceMs/retryMs sind BEWUSST geteilt: Entprellung und Wiederholfrist sind
// Eigenschaften des BETREIBER-KANALS (wie oft darf der Empfaenger ueberhaupt gemailt
// werden), nicht der Fehlerklasse. Geteilter Wert, GETRENNTER Marker - entprellt wird je
// Marker-Code (meldeErlaubt liest marker.reportedAt/lastAttemptAt), R4 bleibt vollstaendig
// gedeckt. Zwei weitere Env-Schrauben haetten .env.example, render.yaml und BASE_ENV
// nachgezogen, ohne eine Frage zu beantworten, die jemand stellt.
export const AUSFALL_KLASSE = Object.freeze({
  OUTBOUND: Object.freeze({
    zaehlweise: ZAEHLWEISE_OUTBOUND,
    schwellen: (config) => ({
      windowMs: config.billing.outageAlertWindowMs,
      minFailures: config.billing.outageAlertMinFailures,
      minAttempts: config.billing.outageAlertMinAttempts,
      failSharePercent: config.billing.outageAlertFailSharePercent,
      debounceMs: config.billing.outageAlertDebounceMs,
      retryMs: config.billing.outageAlertRetryMs,
    }),
  }),
  INBOUND_EL: Object.freeze({
    code: INBOUND_EL_OUTAGE_CODE,
    zaehlweise: ZAEHLWEISE_INBOUND_EL,
    schwellen: (config) => ({
      windowMs: fensterOderAus(config.billing.inboundOutageAlertWindowMs),
      minFailures: config.billing.inboundOutageAlertMinFailures,
      minAttempts: config.billing.inboundOutageAlertMinAttempts,
      failSharePercent: config.billing.inboundOutageAlertFailSharePercent,
      debounceMs: config.billing.outageAlertDebounceMs,
      retryMs: config.billing.outageAlertRetryMs,
    }),
  }),
});
