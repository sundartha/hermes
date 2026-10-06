import { MAX_CALL_DURATION_CAP_S, REIFE } from "../store/defaults.js";
import { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "../utils/timer.js";
import { kostenprofilFuerAnruf, pflichtTraegerFuerProfil } from "./kostenarten.js";
import {
  belegUnbeschaffbarAmAnruf,
  faelligkeitsfensterMs,
  fristAbgelaufen,
  LEERE_LISTE,
  nichtNachreifbar,
} from "./kosten-abschluss.js";

const PROZENT_BASIS = 100;
const BEFUND_TRENNER = ":";
const HERZSCHLAG_AUS = "aus";

export const KOSTEN_BEFUND = Object.freeze({
  DECKUNG_UNTER_SCHWELLE: "deckung-unter-schwelle",
  ERFASSUNG_TOT: "erfassung-tot",
  PROFIL_FEHLT: "profil-fehlt",
});

const traegerCode = (klasse, traeger) => `${klasse}${BEFUND_TRENNER}${traeger}`;
const befundKlasse = (code) => code.split(BEFUND_TRENNER)[0];

export function istBuchBefundCode(code) {
  return Object.values(KOSTEN_BEFUND).includes(befundKlasse(code));
}

const istAngelegt = (reife) => reife !== undefined && reife !== REIFE.ERWARTET;
const istBelegt = (reife) => reife === REIFE.BELEGT;
const istUnbeschaffbar = (reife) => reife === REIFE.STRUKTURELL_UNBESCHAFFBAR;

function karenzMs(billing) {
  return billing.costTruingDelayMinutes * MS_PER_MINUTE + billing.costTruingSweepIntervalMs;
}

function fenster({ nowMs, laengeMs, karenz }) {
  const von = nowMs - laengeMs;
  const bis = nowMs - karenz;
  return bis < von ? null : { von, bis };
}

const imFenster = (iso, fen) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms >= fen.von && ms <= fen.bis;
};

function belegIndex(zeilen) {
  const index = new Map();
  for (const zeile of zeilen) {
    if (!index.has(zeile.callId)) index.set(zeile.callId, []);
    index.get(zeile.callId).push(zeile);
  }
  return index;
}

const traegerVon = (call) => pflichtTraegerFuerProfil(kostenprofilFuerAnruf(call));

function istUnbeschaffbarerAnruf({ call, zeilen, nowMs, deadlineMs }) {
  return belegUnbeschaffbarAmAnruf({ call, belege: zeilen }) && fristAbgelaufen({ call, nowMs, deadlineMs });
}

function deckungTraegerEintrag({ zeilen, traeger, unbeschaffbarerAnruf, bisher }) {
  const eintrag = bisher ?? { kandidaten: 0, belegt: 0, offen: 0, unbeschaffbar: 0 };
  const zeile = zeilen.find((kandidat) => kandidat.traeger === traeger);
  if (istUnbeschaffbar(zeile?.reife) || nichtNachreifbar(zeile) || unbeschaffbarerAnruf) {
    eintrag.unbeschaffbar++;
  } else {
    eintrag.kandidaten++;
    if (istBelegt(zeile?.reife)) eintrag.belegt++;
    else eintrag.offen++;
  }
  return eintrag;
}

function deckungJeTraeger({ calls, index, fen, nowMs, deadlineMs }) {
  const ergebnis = new Map();
  if (!fen) return ergebnis;
  for (const call of calls) {
    if (!imFenster(call.endedAt, fen)) continue;
    const zeilen = index.get(call.id) ?? [];
    const unbeschaffbarerAnruf = istUnbeschaffbarerAnruf({ call, zeilen, nowMs, deadlineMs });
    for (const traeger of traegerVon(call)) {
      ergebnis.set(traeger, deckungTraegerEintrag({ zeilen, traeger, unbeschaffbarerAnruf, bisher: ergebnis.get(traeger) }));
    }
  }
  return ergebnis;
}

function herzschlagJeTraeger({ calls, index, fen, nowMs, deadlineMs }) {
  const ergebnis = new Map();
  if (!fen) return ergebnis;
  for (const call of calls) {
    if (!imFenster(call.endedAt, fen)) continue;
    const zeilen = index.get(call.id) ?? [];
    if (istUnbeschaffbarerAnruf({ call, zeilen, nowMs, deadlineMs })) continue;
    for (const traeger of traegerVon(call)) {
      const eintrag = ergebnis.get(traeger) ?? { beendet: 0, angelegt: 0 };
      eintrag.beendet++;
      if (istAngelegt(zeilen.find((kandidat) => kandidat.traeger === traeger)?.reife)) eintrag.angelegt++;
      ergebnis.set(traeger, eintrag);
    }
  }
  return ergebnis;
}

function nieBeendetZahl({ calls, nowMs, deckungFensterMs }) {
  const grenzeMs = MAX_CALL_DURATION_CAP_S * MS_PER_SECOND;
  let zahl = 0;
  for (const call of calls) {
    if (call.endedAt) continue;
    const startMs = Date.parse(call.startedAt);
    if (!Number.isFinite(startMs)) continue;
    const alterMs = nowMs - startMs;
    if (alterMs > deckungFensterMs) continue;
    if (alterMs > grenzeMs) zahl++;
  }
  return zahl;
}

function profillosZahl({ calls, fen }) {
  if (!fen) return 0;
  let zahl = 0;
  for (const call of calls) {
    if (!call.endedAt || call.costProfile) continue;
    if (imFenster(call.endedAt, fen)) zahl++;
  }
  return zahl;
}

function quoteVon({ kandidaten, belegt }) {
  return kandidaten === 0 ? null : Math.floor((belegt * PROZENT_BASIS) / kandidaten);
}

function renderListe(eintraege, formatEintrag) {
  return eintraege.length === 0 ? LEERE_LISTE : eintraege.map(formatEintrag).join(",");
}

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
    if (totTraeger.has(eintrag.traeger)) continue;
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

function sortierteEintraege(map, projizieren = (werte) => werte) {
  return [...map.entries()]
    .map(([traeger, werte]) => ({ traeger, ...projizieren(werte) }))
    .sort((links, rechts) => links.traeger.localeCompare(rechts.traeger));
}

export function kostenBuchBericht({ state, billing, nowMs, deckungFensterMs }) {
  const calls = Array.isArray(state?.calls) ? state.calls : [];
  const index = belegIndex(Array.isArray(state?.callCostEvidence) ? state.callCostEvidence : []);
  const karenz = karenzMs(billing);
  const deckungFen = fenster({ nowMs, laengeMs: deckungFensterMs, karenz });
  const fensterH = billing.kostenHeartbeatFensterH;
  const herzschlagFen = fenster({ nowMs, laengeMs: fensterH * MS_PER_HOUR, karenz });
  const herzschlagAktiv = herzschlagFen !== null;
  const deadlineMs = faelligkeitsfensterMs(billing);

  const bericht = {
    deckung: sortierteEintraege(
      deckungJeTraeger({ calls, index, fen: deckungFen, nowMs, deadlineMs }),
      (werte) => ({ ...werte, prozent: quoteVon(werte) }),
    ),
    herzschlag: sortierteEintraege(herzschlagJeTraeger({ calls, index, fen: herzschlagFen, nowMs, deadlineMs })),
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
