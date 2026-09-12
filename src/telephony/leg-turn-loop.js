// IE4 (PLAN-INBOUND-PARITAET.md): fuehrt das GESPRAECH dieses Beins noch unser
// TeXML-Turn-Loop - oder hat ein anderes System es uebernommen? Genau EINE Frage, genau
// EIN Leser: die Ersatzantwort des Wiederholungs-Riegels (routes/voice.js,
// repeatDeliveryXml). Trifft eine Anbieter-Wiederholung nach einem Prozess-Neustart ein
// bereits uebergebenes Bein, riss die bisherige Gather-Antwort die Bruecke ab bzw. setzte
// zwei Systeme auf ein Bein.
//
// DIE QUELLE IST DAS GESETZTE KOSTENPROFIL - und zwar das ROHE Feld, ausdruecklich NICHT
// kostenprofilFuerAnruf(): jene Funktion RAET fuer eine Altzeile ohne Profil ein Soll
// (legacyKostenprofil) und beantwortet damit eine ANDERE Frage - was das Settlement
// fordern muss. Hier ist "nicht belegt" kein Anlass zu raten: ohne belegte Uebergabe
// bleibt die Bestandsantwort stehen.
//
// Das Profil wird an der Engine-Weiche gesetzt, ist set-once und PERSISTIERT - genau
// deshalb traegt es die Antwort auch dann, wenn der Prozess den Wortlaut nicht mehr
// kennt. Ein Env-Schalter waere hier falsch: er kennt den Deploy, nicht das einzelne Bein.
import { KOSTENPROFIL } from "../billing/kostenarten.js";

// Vollstaendige Partition JEDES bekannten Kostenprofils. true = unser TeXML-Turn-Loop
// fuehrt das Gespraech, false = ein anderes System fuehrt es und wir halten nur das
// Carrier-Bein. EINE Tabelle statt zweier Listen (G5); der Inventar-Test faellt, sobald
// ein NEUES Profil hier keine Entscheidung traegt. telnyx_inbound_el_convai steht VOR
// seinem Schreiber (IE5) - genau dafuer muss diese Phase vor IE5 fertig sein, das ist
// Reihenfolge, keine Vorratshaltung.
export const TURN_LOOP_BY_COST_PROFILE = Object.freeze({
  [KOSTENPROFIL.TELNYX_BUDGET]: true,
  [KOSTENPROFIL.TELNYX_INBOUND_BUDGET]: true,
  [KOSTENPROFIL.EL_CONVAI_SIP]: false,
  [KOSTENPROFIL.TELNYX_ASSISTANT]: false,
  [KOSTENPROFIL.TELNYX_INBOUND_REALTIME]: false,
  [KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI]: false,
});

// Reines Praedikat, wirft nie. FAIL-SAFE-RICHTUNG: fehlendes oder unbekanntes Profil ->
// true, also die unveraenderte Bestandsantwort. "Wir wissen es nicht" darf mitten im
// Gespraech niemals zu einer NEUEN Antwort fuehren. Object.hasOwn statt Index-Zugriff ist
// Pflicht, kein Stil (Praezedenz boot-guard.js): ein Prototyp-Schluessel als Profilwert
// wuerde sonst eine Wahrheit erfinden, die kein Anruf-Datensatz hergibt.
export function legRunsOurTurnLoop(call) {
  const profil = call?.costProfile;
  if (!Object.hasOwn(TURN_LOOP_BY_COST_PROFILE, profil)) return true;
  return TURN_LOOP_BY_COST_PROFILE[profil];
}
