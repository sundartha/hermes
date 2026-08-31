// KV2-7 (tasks/kostenv2/spec-kv2-7.md): Schliessregel, Faelligkeit, Verfall,
// Endzustaende. Reines Regelwerk: kein Store, kein Netz-IO, kein console, kein await.
//
// IMPORT-RICHTUNG strikt einseitig (Muster kosten-deckung.js): diese Datei kennt NUR
// store/defaults.js, billing/kostenarten.js, billing/sweep-kostenbeleg.js und
// utils/timer.js. cost-truing.js und kosten-deckung.js importieren AUS dieser Datei,
// nie umgekehrt - sonst ein Zyklus.
//
// DIE REGEL (Plan Abschnitt 0): ein Anruf wird geschlossen, wenn (A) jeder Pflicht-
// Traeger seines Profils *erledigt* ist, oder (B) COST_SETTLE_DEADLINE_HOURS seit
// endedAt abgelaufen ist. *Erledigt* ist ein Traeger, wenn seine Belegzeile
// reife=belegt traegt - ODER wenn er der SWEEP-Traeger des Profils ist und der Sweep
// fuer ihn in diesem Lauf fertig ist (measured !== null || Versuche erschoepft). Fuer
// die vier Ein-Traeger-Profile faellt das WORTGLEICH auf den Bestandsausdruck zusammen
// (Abnahme (a)); fuer el_convai_sip schliesst allein die telnyx_sip-Zeile nicht mehr.
import { REIFE } from "../store/defaults.js";
import { MS_PER_HOUR } from "../utils/timer.js";
import { KOSTENPROFIL, kostenprofilFuerAnruf, pflichtTraegerFuerProfil } from "./kostenarten.js";
import { sweepTraegerFuerProfil } from "./sweep-kostenbeleg.js";

// Endzustaende (abgeleitet, nicht persistiert - reine Funktion ueber Anruf + Belegzeilen
// + Frist, kein neues Anruf-Feld). UNBESCHAFFBAR teilt sich EINE Quelle mit dem
// gleichnamigen terminalen Reifegrad (G5): derselbe Sachverhalt, hier am ANRUF statt an
// der Belegzeile.
export const ENDZUSTAND = Object.freeze({
  VOLLSTAENDIG: "vollstaendig",
  UNVOLLSTAENDIG_FINAL: "unvollstaendig_final",
  UNBESCHAFFBAR: REIFE.STRUKTURELL_UNBESCHAFFBAR,
  PROFIL_FEHLT: "profil_fehlt",
});

export const ABSCHLUSS_GRUND = Object.freeze({
  BELEGSAMMLUNG: "belegsammlung",
  FRIST: "frist",
});

// Muster kanaele=keine (KV2-1) - EINE Quelle statt eines zweiten, lokal getippten
// Strings je Aufrufer (kosten-deckung.js importiert diese Konstante).
export const LEERE_LISTE = "keine";

// Faelligkeitsfenster in ms (Owner-Entscheidung 3, 2026-08-30: 48 h). EIN Aufrufer-Ort
// fuer die Umrechnung (G5) - der Sweep UND die Deckungsrechnung teilen sich diese
// Funktion statt je einer eigenen Multiplikation.
export function faelligkeitsfensterMs(billing) {
  return billing.costSettleDeadlineHours * MS_PER_HOUR;
}

// Ist die Faelligkeitsfrist eines Anrufs abgelaufen? Ein unbrauchbarer/fehlender
// endedAt ist FAIL-CLOSED nie abgelaufen (kein Date.parse(undefined) -> NaN, das
// staendig "abgelaufen" waere).
export function fristAbgelaufen({ call, nowMs, deadlineMs }) {
  const endedMs = Date.parse(call?.endedAt ?? "");
  return Number.isFinite(endedMs) && nowMs - endedMs >= deadlineMs;
}

// Die Belegzeile EINES Traegers, oder undefined. EINE Fundstelle-Regel (G5) fuer die
// drei Leser unten.
function zeileFuerTraeger(belege, traeger) {
  return belege.find((zeile) => zeile.traeger === traeger);
}

// (h) "Deploy mitten im Gespraech" (6.10) - EIN Praedikat, zwei Aufrufer (Sweep +
// Deckung). ZEITFREI: die Faelligkeit prueft der Aufrufer separat (fristAbgelaufen),
// damit das Millisekunden-Fenster zwischen Gespraechsende und persistProviderResult nie
// in diese Menge faellt.
export function belegUnbeschaffbarAmAnruf({ call, belege }) {
  return (
    kostenprofilFuerAnruf(call) === KOSTENPROFIL.EL_CONVAI_SIP && // 1 (Legacy-Zuordnung eingeschlossen)
    !!call.endedAt && // 2
    !!call.elevenlabsConversationId && // 3
    !call.sipCallId && // 4 (einziger Schreiber: recordSipCallId in persistProviderResult)
    belege.length === 0 // 5 (keine Zeile, in KEINEM Zustand)
  );
}

// Die Pflicht-Traeger eines Anrufs, die NOCH NICHT mit reife=belegt dastehen (sortiert,
// deterministische Form fuer Log/Test).
export function offeneTraeger({ call, belege }) {
  const pflicht = pflichtTraegerFuerProfil(kostenprofilFuerAnruf(call));
  return pflicht
    .filter((traeger) => zeileFuerTraeger(belege, traeger)?.reife !== REIFE.BELEGT)
    .sort((links, rechts) => links.localeCompare(rechts));
}

// Der Abbruchweg (KV2-4): eine Zeile, die dauerhaft nicht mehr auf 'belegt' steigen
// KANN. nachreifbar=false an einer bereits belegten Zeile ist irrelevant - die Zeile ist
// fertig, keine Rueckstufung noetig.
export function nichtNachreifbar(zeile) {
  return zeile?.nachreifbar === false && zeile.reife !== REIFE.BELEGT;
}

// Reihenfolge ist eine Aussage (fail-closed zuerst):
//  1. kein costProfile          -> PROFIL_FEHLT  (Zielbild 4: eine unbekannte Pflicht-
//                                  menge ist NIEMALS Vollstaendigkeit; Matrix 4.6)
//  2. (h) UND Frist abgelaufen  -> UNBESCHAFFBAR (nie waehrend laufender Frist)
//  3. fehlend leer              -> VOLLSTAENDIG
//  4. alle fehlenden Traeger nicht nachreifbar -> UNBESCHAFFBAR (Abbruchweg, (e))
//  5. sonst                     -> UNVOLLSTAENDIG_FINAL mit fehlend
function endzustandVon({ call, belege, fehlend, frist }) {
  if (!call?.costProfile) return ENDZUSTAND.PROFIL_FEHLT;
  if (frist && belegUnbeschaffbarAmAnruf({ call, belege })) return ENDZUSTAND.UNBESCHAFFBAR;
  if (fehlend.length === 0) return ENDZUSTAND.VOLLSTAENDIG;
  if (fehlend.every((traeger) => nichtNachreifbar(zeileFuerTraeger(belege, traeger)))) return ENDZUSTAND.UNBESCHAFFBAR;
  return ENDZUSTAND.UNVOLLSTAENDIG_FINAL;
}

// DIE Schliessregel. sweepTraegerErledigt sagt, ob der SWEEP-Traeger dieses Profils in
// DIESEM Lauf fertig ist (measured !== null || Versuche erschoepft) - der Aufrufer
// (cost-truing.js) kennt diesen Sachverhalt, diese Funktion bleibt store-frei.
export function abschlussFuerAnruf({ call, belege, nowMs, deadlineMs, sweepTraegerErledigt }) {
  const sweepTraeger = sweepTraegerFuerProfil(kostenprofilFuerAnruf(call));
  const fehlend = offeneTraeger({ call, belege });
  const alleErledigt = fehlend.every((traeger) => traeger === sweepTraeger && sweepTraegerErledigt);
  const frist = fristAbgelaufen({ call, nowMs, deadlineMs });
  if (!alleErledigt && !frist) return { geschlossen: false };
  return {
    geschlossen: true,
    grund: alleErledigt ? ABSCHLUSS_GRUND.BELEGSAMMLUNG : ABSCHLUSS_GRUND.FRIST,
    endzustand: endzustandVon({ call, belege, fehlend, frist }),
    fehlend,
  };
}

// Renderer (G5): eine Liste roher Werte zu "wert(anzahl),wert(anzahl)" verdichtet,
// alphabetisch sortiert, oder LEERE_LISTE. Fuer die Sweep-Bilanz (abschluesse=).
export function zaehlListe(werte) {
  if (werte.length === 0) return LEERE_LISTE;
  const zaehler = new Map();
  for (const wert of werte) zaehler.set(wert, (zaehler.get(wert) ?? 0) + 1);
  // Drei eigene Schritte statt einer verketteten Pipeline (G36, Gesetz von Demeter) -
  // dieselbe Rechnung, aber ohne vier verschachtelte Zugriffe in EINEM Ausdruck.
  const sortiert = [...zaehler.entries()].sort(([links], [rechts]) => links.localeCompare(rechts));
  const formatiert = sortiert.map(([wert, anzahl]) => `${wert}(${anzahl})`);
  return formatiert.join(",");
}
