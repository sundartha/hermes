// KV2-6 (tasks/PLAN-KOSTEN-V2.md): die Deckung JE TRAEGER im Kosten-Buch
// (call_cost_evidence) und der faelligkeits-unabhaengige HERZSCHLAG. Reines Regelwerk:
// keine Store-Mutation, kein Netz-IO, kein console, kein await. Import-Richtung ist
// strikt einseitig - diese Datei kennt cost-truing.js NICHT (das waere der Zyklus, s.
// dessen Kopfkommentar); die einzige Groesse von dort (das Belegfenster in ms) wird als
// Parameter hereingereicht.
//
// ZWEI Fragen, ZWEI Bedingungen (nie auf dieselbe gelegt, s. istAngelegt/istBelegt):
//   - Deckung  = "ist die Erfassung fuer diesen Traeger VOLLSTAENDIG" (Quote ueber
//     belegbaren Kandidaten).
//   - Herzschlag = "sammelt fuer diesen Traeger UEBERHAUPT noch jemand" (angelegt ja/nein,
//     unabhaengig von Faelligkeit/costTruedAt) - genau die Klasse, die den Ausfall vom
//     19.08. binnen Stunden gemeldet haette, waehrend die Deckungsquote strukturell erst
//     misst, wenn ein Call ueberhaupt Kandidat wird.
// Auslegung A2 (Plan Abschnitt 0.4): feuert der Herzschlag fuer einen Traeger, schweigt
// die Deckungsmeldung DESSELBEN Traegers - sonst zwei Alarme fuer einen Sachverhalt.
import { MAX_CALL_DURATION_CAP_S, REIFE } from "../store/defaults.js";
import { MS_PER_MINUTE, MS_PER_SECOND } from "../utils/timer.js";
import { kostenprofilFuerAnruf, pflichtTraegerFuerProfil } from "./kostenarten.js";

// ---- Konstanten (G25; kein Literal in einem Operator-Ausdruck) -------------------------
const MINUTEN_JE_STUNDE = 60;
const MS_PER_HOUR = MINUTEN_JE_STUNDE * MS_PER_MINUTE;
const PROZENT_BASIS = 100;
const BEFUND_TRENNER = ":";
const LEERE_LISTE = "keine"; // Muster kanaele=keine (KV2-1)
const HERZSCHLAG_AUS = "aus"; // sichtbar statt still (Rollback-Hebel)

// Die drei Alarmklassen (Plan 4.9). Der Eimer-Praefix "kosten:" kommt vom Aufrufer
// (cost-truing.js#kostenBucket) - hier steht nur die KLASSE.
export const KOSTEN_BEFUND = Object.freeze({
  DECKUNG_UNTER_SCHWELLE: "deckung-unter-schwelle",
  ERFASSUNG_TOT: "erfassung-tot",
  PROFIL_FEHLT: "profil-fehlt",
});

// ---- Praedikate (rein) ------------------------------------------------------------------
const traegerCode = (klasse, traeger) => `${klasse}${BEFUND_TRENNER}${traeger}`;
const befundKlasse = (code) => code.split(BEFUND_TRENNER)[0];

// Erkennt einen KV2-6-Befund-Code an seiner Klasse (Muster VOLL_BEFUND_CODES-Vergleich,
// cost-truing.js#emitFinding) - die drei Klassen tragen den Traeger hinter dem Trenner
// und koennen deshalb nicht als feste Strings in einer Menge stehen.
export function istBuchBefundCode(code) {
  return Object.values(KOSTEN_BEFUND).includes(befundKlasse(code));
}

// "gibt es UEBERHAUPT eine Zeile" vs. "ist sie FERTIG" - zwei verschiedene Fragen an
// dieselbe Reife (Herzschlag vs. Deckung). 'erwartet' ist im Buch angelegt, zaehlt aber
// NIE als angelegt fuer den Herzschlag (Kriterium g: der Platzhalter der Weiche ist kein
// Beweis, dass gesammelt wird) - deshalb der explizite Ausschluss.
const istAngelegt = (reife) => reife !== undefined && reife !== REIFE.ERWARTET;
const istBelegt = (reife) => reife === REIFE.BELEGT;
const istUnbeschaffbar = (reife) => reife === REIFE.STRUKTURELL_UNBESCHAFFBAR;

// ---- Zeit ---------------------------------------------------------------------------------

// Die KARENZ ist der Grund, warum der Herzschlag kein Dauer-Alarm wird: ein Anruf, der
// gerade erst endete, KANN noch keinen Provider-Beleg haben - sein Einsammler laeuft
// fruehestens nach costTruingDelayMinutes und dann erst im naechsten Sweep. ABGELEITET aus
// genau diesen zwei Bestandswerten, KEIN neuer Knopf.
function karenzMs(billing) {
  return billing.costTruingDelayMinutes * MS_PER_MINUTE + billing.costTruingSweepIntervalMs;
}

// Das Beobachtungsfenster EINER Frage: [now-laengeMs, now-karenz]. Ein Fenster, dessen
// Ende vor seinem Anfang liegt (laengeMs <= karenz, eingeschlossen laengeMs === 0 - der
// Rollback-Hebel), ist KEIN Fenster - null statt eines leeren, aber gueltigen Intervalls,
// damit der Aufrufer den Unterschied zu "Fenster ohne Treffer" sehen kann.
function fenster({ nowMs, laengeMs, karenz }) {
  const von = nowMs - laengeMs;
  const bis = nowMs - karenz;
  return bis < von ? null : { von, bis };
}

const imFenster = (iso, fen) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms >= fen.von && ms <= fen.bis;
};

// ---- Index: EINE Ablesung des Kosten-Buchs fuer beide Fragen (G5) -----------------------
function reifeIndex(zeilen) {
  const index = new Map();
  for (const zeile of zeilen) {
    if (!index.has(zeile.callId)) index.set(zeile.callId, new Map());
    index.get(zeile.callId).set(zeile.traeger, zeile.reife);
  }
  return index;
}

// Die Pflicht-Traeger EINES Anrufs, ueber sein (gesetztes oder legacy-abgeleitetes) Profil.
// openai_realtime faellt bereits in pflichtTraegerFuerProfil heraus (kein Einsammler) -
// diese Funktion muss das nicht ein zweites Mal wissen.
const traegerVon = (call) => pflichtTraegerFuerProfil(kostenprofilFuerAnruf(call));

// ---- Messungen (je EINE Aufgabe) ---------------------------------------------------------

// Deckung je Traeger: kandidaten/belegt/offen/unbeschaffbar ueber alle Anrufe, deren
// endedAt im Fenster liegt und die diesen Traeger als Pflicht fuehren. unbeschaffbar
// faellt aus Zaehler UND Nenner (eigener Zaehler, Kriterium c) - nur 'belegt' zaehlt als
// erfuellt, 'vorlaeufig' und eine fehlende Zeile bleiben 'offen'.
function deckungJeTraeger({ calls, index, fen }) {
  const ergebnis = new Map();
  if (!fen) return ergebnis;
  for (const call of calls) {
    if (!imFenster(call.endedAt, fen)) continue;
    const reifen = index.get(call.id);
    for (const traeger of traegerVon(call)) {
      const eintrag = ergebnis.get(traeger) ?? { kandidaten: 0, belegt: 0, offen: 0, unbeschaffbar: 0 };
      const reife = reifen?.get(traeger);
      if (istUnbeschaffbar(reife)) {
        eintrag.unbeschaffbar++;
      } else {
        eintrag.kandidaten++;
        if (istBelegt(reife)) eintrag.belegt++;
        else eintrag.offen++;
      }
      ergebnis.set(traeger, eintrag);
    }
  }
  return ergebnis;
}

// Herzschlag je Traeger: beendet/angelegt ueber alle Anrufe, deren endedAt im Fenster
// liegt und die diesen Traeger als Pflicht fuehren - UNABHAENGIG von Faelligkeit/
// costTruedAt (der Sachverhalt "sammelt ueberhaupt noch jemand" kennt keine Faelligkeit).
function herzschlagJeTraeger({ calls, index, fen }) {
  const ergebnis = new Map();
  if (!fen) return ergebnis;
  for (const call of calls) {
    if (!imFenster(call.endedAt, fen)) continue;
    const reifen = index.get(call.id);
    for (const traeger of traegerVon(call)) {
      const eintrag = ergebnis.get(traeger) ?? { beendet: 0, angelegt: 0 };
      eintrag.beendet++;
      if (istAngelegt(reifen?.get(traeger))) eintrag.angelegt++;
      ergebnis.set(traeger, eintrag);
    }
  }
  return ergebnis;
}

// "Nie beendet": ein Anruf ohne endedAt, dessen Alter die absolute Obergrenze der
// Notbremse (MAX_CALL_DURATION_CAP_S) bereits ueberschritten hat - ein Anruf, der gerade
// telefoniert, ist juenger als diese Grenze und zaehlt nicht. Bezugsgroesse ist das
// Deckungsfenster in seiner ROHEN Laenge (ohne Karenz-Abzug): die Karenz ist eine Regel
// ueber BELEGE, nicht ueber laufende Gespraeche - ein zu alter Zombie faellt trotzdem
// irgendwann aus dem Fenster heraus, statt fuer immer zu zaehlen.
function nieBeendetZahl({ calls, nowMs, deckungFensterMs }) {
  const grenzeMs = MAX_CALL_DURATION_CAP_S * MS_PER_SECOND;
  let zahl = 0;
  for (const call of calls) {
    if (call.endedAt) continue;
    const startMs = Date.parse(call.startedAt);
    if (!Number.isFinite(startMs)) continue;
    const alterMs = nowMs - startMs;
    if (alterMs > deckungFensterMs) continue; // zu alt, faellt aus dem Fenster
    if (alterMs > grenzeMs) zahl++;
  }
  return zahl;
}

// Beendete Anrufe im Herzschlag-Fenster ohne gesetztes costProfile (Klasse 3, 4.9). Das
// Fenster ist der Riegel gegen den Dauer-Alarm: eine Altzeile von vor der Kette faellt
// binnen kostenHeartbeatFensterH von selbst heraus.
function profillosZahl({ calls, fen }) {
  if (!fen) return 0;
  let zahl = 0;
  for (const call of calls) {
    if (!call.endedAt || call.costProfile) continue;
    if (imFenster(call.endedAt, fen)) zahl++;
  }
  return zahl;
}

// ---- Rendern + Urteilen (rein) -----------------------------------------------------------

// Die Quote aus kandidaten/belegt: NENNER 0 -> null (keine Aussage, nie "0%" - dieselbe
// Konvention wie an anderer Stelle "kein Freispruch", nur in die andere Richtung: hier
// gibt es schlicht nichts zu bewerten).
function quoteVon({ kandidaten, belegt }) {
  return kandidaten === 0 ? null : Math.floor((belegt * PROZENT_BASIS) / kandidaten);
}

// Eine sortierte Liste als "traeger(a/b/...)"-Kette, oder LEERE_LISTE. Gemeinsamer
// Renderer fuer buch= und herzschlag= (G5) - unterschiedliche Formatierer je Zweig.
function renderListe(eintraege, formatEintrag) {
  return eintraege.length === 0 ? LEERE_LISTE : eintraege.map(formatEintrag).join(",");
}

// Die Sweep-Zeile: haengt HINTEN an die Bestandszeile (Muster kanaele=, KV2-1).
// buch=<traeger>(kandidaten/belegt/offen/unbeschaffbar), herzschlag=<traeger>(beendet/
// angelegt); herzschlagAktiv:false -> herzschlag=aus (sichtbar, nicht still).
export function deckungsZeile(bericht) {
  const buch = renderListe(
    bericht.deckung,
    (eintrag) => `${eintrag.traeger}(${eintrag.kandidaten}/${eintrag.belegt}/${eintrag.offen}/${eintrag.unbeschaffbar})`,
  );
  const herzschlag = bericht.herzschlagAktiv
    ? renderListe(bericht.herzschlag, (eintrag) => `${eintrag.traeger}(${eintrag.beendet}/${eintrag.angelegt})`)
    : HERZSCHLAG_AUS;
  return `buch=${buch} herzschlag=${herzschlag} nie_beendet=${bericht.nieBeendet} profillos=${bericht.profillos}`;
}

// Die Befunde aus einem fertigen Bericht (PII-frei: nur Traegernamen, Zahlen, Prozente).
// Reihenfolge: Herzschlag zuerst (er bestimmt, welche Traeger die Deckungsmeldung wegen
// Auslegung A2 NICHT mehr bekommen), dann Deckung, dann profil-fehlt.
export function buchBefunde(bericht) {
  const befunde = [];
  const totTraeger = new Set();
  if (bericht.herzschlagAktiv) {
    for (const eintrag of bericht.herzschlag) {
      if (eintrag.beendet === 0 || eintrag.angelegt > 0) continue;
      totTraeger.add(eintrag.traeger);
      befunde.push({
        code: traegerCode(KOSTEN_BEFUND.ERFASSUNG_TOT, eintrag.traeger),
        detail: `traeger=${eintrag.traeger} fenster_h=${bericht.fensterH} beendet=${eintrag.beendet} angelegt=0`,
      });
    }
  }
  for (const eintrag of bericht.deckung) {
    if (eintrag.kandidaten === 0 || eintrag.prozent >= bericht.schwelleProzent) continue;
    if (totTraeger.has(eintrag.traeger)) continue; // A2: derselbe Sachverhalt, EIN Alarm
    befunde.push({
      code: traegerCode(KOSTEN_BEFUND.DECKUNG_UNTER_SCHWELLE, eintrag.traeger),
      detail:
        `traeger=${eintrag.traeger} deckung=${eintrag.prozent}% schwelle=${bericht.schwelleProzent}% ` +
        `kandidaten=${eintrag.kandidaten} belegt=${eintrag.belegt} offen=${eintrag.offen} ` +
        `unbeschaffbar=${eintrag.unbeschaffbar}`,
    });
  }
  if (bericht.profillos > 0) {
    befunde.push({
      code: KOSTEN_BEFUND.PROFIL_FEHLT,
      detail: `fenster_h=${bericht.fensterH} anrufe=${bericht.profillos}`,
    });
  }
  return befunde;
}

// Sortiert eine Map<traeger, werte> als Array {traeger, ...werte}, alphabetisch nach
// traeger (deterministische Form, wie state-ops.js#callCostEvidence es fuer Belegzeilen
// tut).
function sortierteEintraege(map, projizieren = (werte) => werte) {
  return [...map.entries()]
    .map(([traeger, werte]) => ({ traeger, ...projizieren(werte) }))
    .sort((links, rechts) => links.traeger.localeCompare(rechts.traeger));
}

// ---- Komposition: EIN Aufruf, zwei Sichten -----------------------------------------------
// Nimmt die BEREITS aufgeloeste Belegfenster-Laenge (deckungFensterMs) als Parameter
// entgegen - diese Datei importiert PROVIDER_COST_RECORD_WINDOW_MS bewusst NICHT aus
// cost-truing.js (Zyklus-Freiheit, s. Kopfkommentar).
export function kostenBuchBericht({ state, billing, nowMs, deckungFensterMs }) {
  const calls = Array.isArray(state?.calls) ? state.calls : [];
  const index = reifeIndex(Array.isArray(state?.callCostEvidence) ? state.callCostEvidence : []);
  const karenz = karenzMs(billing);
  const deckungFen = fenster({ nowMs, laengeMs: deckungFensterMs, karenz });
  const fensterH = billing.kostenHeartbeatFensterH;
  const herzschlagFen = fenster({ nowMs, laengeMs: fensterH * MS_PER_HOUR, karenz });
  const herzschlagAktiv = herzschlagFen !== null;

  const bericht = {
    deckung: sortierteEintraege(
      deckungJeTraeger({ calls, index, fen: deckungFen }),
      (werte) => ({ ...werte, prozent: quoteVon(werte) }),
    ),
    herzschlag: sortierteEintraege(herzschlagJeTraeger({ calls, index, fen: herzschlagFen })),
    nieBeendet: nieBeendetZahl({ calls, nowMs, deckungFensterMs }),
    profillos: profillosZahl({ calls, fen: herzschlagFen }),
    fensterH,
    herzschlagAktiv,
    schwelleProzent: billing.costTruingMinCoveragePercent,
  };
  bericht.zeile = deckungsZeile(bericht);
  bericht.befunde = buchBefunde(bericht);
  return bericht;
}
