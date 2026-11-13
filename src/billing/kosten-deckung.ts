import { MAX_CALL_DURATION_CAP_S } from "../begriffe/anrufe.js";
import { REIFE } from "../begriffe/abrechnung.js";
import { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "../utils/timer.js";
import { kostenprofilFuerAnruf, pflichtTraegerFuerProfil } from "./kostenarten.js";
import {
  type AbschlussAnruf,
  type AbschlussBeleg,
  belegUnbeschaffbarAmAnruf,
  faelligkeitsfensterMs,
  fristAbgelaufen,
  LEERE_LISTE,
  nichtNachreifbar,
} from "./kosten-abschluss.ts";

interface KostenBeleg extends AbschlussBeleg {
  callId: string;
}

interface KostenAnruf extends AbschlussAnruf {
  id: string;
  startedAt?: string | null | undefined;
}

interface KostenZustand {
  calls?: KostenAnruf[] | undefined;
  callCostEvidence?: KostenBeleg[] | undefined;
}

interface KostenAbrechnung {
  costTruingDelayMinutes: number;
  costTruingSweepIntervalMs: number;
  costSettleDeadlineHours: number;
  kostenHeartbeatFensterH: number;
  costTruingMinCoveragePercent: number;
}

interface Fenster {
  von: number;
  bis: number;
}

interface DeckungWerte {
  kandidaten: number;
  belegt: number;
  offen: number;
  unbeschaffbar: number;
}

interface HerzschlagWerte {
  beendet: number;
  angelegt: number;
}

type DeckungEintrag = DeckungWerte & { traeger: string; prozent: number | null };
type HerzschlagEintrag = HerzschlagWerte & { traeger: string };

interface Bericht {
  deckung: DeckungEintrag[];
  herzschlag: HerzschlagEintrag[];
  nieBeendet: number;
  profillos: number;
  fensterH: number;
  herzschlagAktiv: boolean;
  schwelleProzent: number;
}

interface Befund {
  code: string;
  detail: string;
}

interface AnrufMitBelegen {
  call: KostenAnruf;
  zeilen: KostenBeleg[];
}

const kostenprofilVon: (call: KostenAnruf) => string = kostenprofilFuerAnruf;
const pflichtTraegerVon: (profil: string) => string[] = pflichtTraegerFuerProfil;

const PROZENT_BASIS = 100;
const BEFUND_TRENNER = ":";
const HERZSCHLAG_AUS = "aus";

export const KOSTEN_BEFUND = Object.freeze({
  DECKUNG_UNTER_SCHWELLE: "deckung-unter-schwelle",
  ERFASSUNG_TOT: "erfassung-tot",
  PROFIL_FEHLT: "profil-fehlt",
});

const traegerCode = (klasse: string, traeger: string): string =>
  `${klasse}${BEFUND_TRENNER}${traeger}`;
const befundKlasse = (code: string): string | undefined => code.split(BEFUND_TRENNER)[0];

export function istBuchBefundCode(code: string): boolean {
  const klasse = befundKlasse(code);
  return Object.values(KOSTEN_BEFUND).some((wert) => wert === klasse);
}

const istAngelegt = (reife: string | undefined): boolean =>
  reife !== undefined && reife !== REIFE.ERWARTET;
const istBelegt = (reife: string | undefined): boolean => reife === REIFE.BELEGT;
const istUnbeschaffbar = (reife: string | undefined): boolean =>
  reife === REIFE.STRUKTURELL_UNBESCHAFFBAR;

function karenzMs(billing: KostenAbrechnung): number {
  return billing.costTruingDelayMinutes * MS_PER_MINUTE + billing.costTruingSweepIntervalMs;
}

function fenster({
  nowMs,
  laengeMs,
  karenz,
}: {
  nowMs: number;
  laengeMs: number;
  karenz: number;
}): Fenster | null {
  const von = nowMs - laengeMs;
  const bis = nowMs - karenz;
  return bis < von ? null : { von, bis };
}

const imFenster = (iso: string | null | undefined, fen: Fenster): boolean => {
  const ms = Date.parse(iso ?? "");
  return Number.isFinite(ms) && ms >= fen.von && ms <= fen.bis;
};

function belegIndex(zeilen: KostenBeleg[]): Map<string, KostenBeleg[]> {
  const index = new Map<string, KostenBeleg[]>();
  for (const zeile of zeilen) {
    const bisher = index.get(zeile.callId) ?? [];
    bisher.push(zeile);
    index.set(zeile.callId, bisher);
  }
  return index;
}

const traegerVon = (call: KostenAnruf): string[] => pflichtTraegerVon(kostenprofilVon(call));

function istUnbeschaffbarerAnruf({
  call,
  zeilen,
  nowMs,
  deadlineMs,
}: AnrufMitBelegen & { nowMs: number; deadlineMs: number }): boolean {
  return (
    belegUnbeschaffbarAmAnruf({ call, belege: zeilen }) &&
    fristAbgelaufen({ call, nowMs, deadlineMs })
  );
}

function deckungTraegerEintrag({
  zeilen,
  traeger,
  unbeschaffbarerAnruf,
  bisher,
}: {
  zeilen: KostenBeleg[];
  traeger: string;
  unbeschaffbarerAnruf: boolean;
  bisher: DeckungWerte | undefined;
}): DeckungWerte {
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

function anrufeImFenster({
  calls,
  index,
  fen,
}: {
  calls: KostenAnruf[];
  index: Map<string, KostenBeleg[]>;
  fen: Fenster | null;
}): AnrufMitBelegen[] {
  if (!fen) return [];
  const beendet = calls.filter((call) => imFenster(call.endedAt, fen));
  return beendet.map((call) => ({ call, zeilen: index.get(call.id) ?? [] }));
}

interface JeTraegerParameter {
  calls: KostenAnruf[];
  index: Map<string, KostenBeleg[]>;
  fen: Fenster | null;
  nowMs: number;
  deadlineMs: number;
}

function deckungJeTraeger({
  calls,
  index,
  fen,
  nowMs,
  deadlineMs,
}: JeTraegerParameter): Map<string, DeckungWerte> {
  const ergebnis = new Map<string, DeckungWerte>();
  for (const { call, zeilen } of anrufeImFenster({ calls, index, fen })) {
    const unbeschaffbarerAnruf = istUnbeschaffbarerAnruf({ call, zeilen, nowMs, deadlineMs });
    for (const traeger of traegerVon(call)) {
      ergebnis.set(
        traeger,
        deckungTraegerEintrag({
          zeilen,
          traeger,
          unbeschaffbarerAnruf,
          bisher: ergebnis.get(traeger),
        }),
      );
    }
  }
  return ergebnis;
}

function herzschlagJeTraeger({
  calls,
  index,
  fen,
  nowMs,
  deadlineMs,
}: JeTraegerParameter): Map<string, HerzschlagWerte> {
  const ergebnis = new Map<string, HerzschlagWerte>();
  for (const { call, zeilen } of anrufeImFenster({ calls, index, fen })) {
    if (istUnbeschaffbarerAnruf({ call, zeilen, nowMs, deadlineMs })) continue;
    for (const traeger of traegerVon(call)) {
      const eintrag = ergebnis.get(traeger) ?? { beendet: 0, angelegt: 0 };
      eintrag.beendet++;
      if (istAngelegt(zeilen.find((kandidat) => kandidat.traeger === traeger)?.reife))
        eintrag.angelegt++;
      ergebnis.set(traeger, eintrag);
    }
  }
  return ergebnis;
}

function nieBeendetZahl({
  calls,
  nowMs,
  deckungFensterMs,
}: {
  calls: KostenAnruf[];
  nowMs: number;
  deckungFensterMs: number;
}): number {
  const grenzeMs = MAX_CALL_DURATION_CAP_S * MS_PER_SECOND;
  let zahl = 0;
  for (const call of calls) {
    if (call.endedAt) continue;
    const startMs = Date.parse(call.startedAt ?? "");
    if (!Number.isFinite(startMs)) continue;
    const alterMs = nowMs - startMs;
    if (alterMs > deckungFensterMs) continue;
    if (alterMs > grenzeMs) zahl++;
  }
  return zahl;
}

function profillosZahl({ calls, fen }: { calls: KostenAnruf[]; fen: Fenster | null }): number {
  if (!fen) return 0;
  let zahl = 0;
  for (const call of calls) {
    if (!call.endedAt || call.costProfile) continue;
    if (imFenster(call.endedAt, fen)) zahl++;
  }
  return zahl;
}

function quoteVon({ kandidaten, belegt }: DeckungWerte): number | null {
  return kandidaten === 0 ? null : Math.floor((belegt * PROZENT_BASIS) / kandidaten);
}

function renderListe<T>(eintraege: T[], formatEintrag: (eintrag: T) => string): string {
  return eintraege.length === 0 ? LEERE_LISTE : eintraege.map(formatEintrag).join(",");
}

export function deckungsZeile(bericht: Bericht): string {
  const buch = renderListe(
    bericht.deckung,
    (eintrag) =>
      `${eintrag.traeger}(${String(eintrag.kandidaten)}/${String(eintrag.belegt)}/${String(eintrag.offen)}/${String(eintrag.unbeschaffbar)})`,
  );
  const herzschlag = bericht.herzschlagAktiv
    ? renderListe(
        bericht.herzschlag,
        (eintrag) => `${eintrag.traeger}(${String(eintrag.beendet)}/${String(eintrag.angelegt)})`,
      )
    : HERZSCHLAG_AUS;
  return `buch=${buch} herzschlag=${herzschlag} nie_beendet=${String(bericht.nieBeendet)} profillos=${String(bericht.profillos)}`;
}

export function buchBefunde(bericht: Bericht): Befund[] {
  const befunde: Befund[] = [];
  const totTraeger = new Set<string>();
  if (bericht.herzschlagAktiv) {
    for (const eintrag of bericht.herzschlag) {
      if (eintrag.beendet === 0 || eintrag.angelegt > 0) continue;
      totTraeger.add(eintrag.traeger);
      befunde.push({
        code: traegerCode(KOSTEN_BEFUND.ERFASSUNG_TOT, eintrag.traeger),
        detail: `traeger=${eintrag.traeger} fenster_h=${String(bericht.fensterH)} beendet=${String(eintrag.beendet)} angelegt=0`,
      });
    }
  }
  for (const eintrag of bericht.deckung) {
    if (eintrag.prozent === null || eintrag.prozent >= bericht.schwelleProzent) continue;
    if (totTraeger.has(eintrag.traeger)) continue;
    befunde.push({
      code: traegerCode(KOSTEN_BEFUND.DECKUNG_UNTER_SCHWELLE, eintrag.traeger),
      detail:
        `traeger=${eintrag.traeger} deckung=${String(eintrag.prozent)}% schwelle=${String(bericht.schwelleProzent)}% ` +
        `kandidaten=${String(eintrag.kandidaten)} belegt=${String(eintrag.belegt)} offen=${String(eintrag.offen)} ` +
        `unbeschaffbar=${String(eintrag.unbeschaffbar)}`,
    });
  }
  if (bericht.profillos > 0) {
    befunde.push({
      code: KOSTEN_BEFUND.PROFIL_FEHLT,
      detail: `fenster_h=${String(bericht.fensterH)} anrufe=${String(bericht.profillos)}`,
    });
  }
  return befunde;
}

function sortierteEintraege<W, E extends { traeger: string }>(
  map: Map<string, W>,
  projizieren: (werte: W, traeger: string) => E,
): E[] {
  return [...map.entries()]
    .map(([traeger, werte]) => projizieren(werte, traeger))
    .sort((links, rechts) => links.traeger.localeCompare(rechts.traeger));
}

export function kostenBuchBericht({
  state,
  billing,
  nowMs,
  deckungFensterMs,
}: {
  state: KostenZustand | null | undefined;
  billing: KostenAbrechnung;
  nowMs: number;
  deckungFensterMs: number;
}): Bericht & { zeile: string; befunde: Befund[] } {
  const calls = Array.isArray(state?.calls) ? state.calls : [];
  const index = belegIndex(Array.isArray(state?.callCostEvidence) ? state.callCostEvidence : []);
  const karenz = karenzMs(billing);
  const deckungFen = fenster({ nowMs, laengeMs: deckungFensterMs, karenz });
  const fensterH = billing.kostenHeartbeatFensterH;
  const herzschlagFen = fenster({ nowMs, laengeMs: fensterH * MS_PER_HOUR, karenz });
  const herzschlagAktiv = herzschlagFen !== null;
  const deadlineMs = faelligkeitsfensterMs(billing);

  const bericht: Bericht = {
    deckung: sortierteEintraege(
      deckungJeTraeger({ calls, index, fen: deckungFen, nowMs, deadlineMs }),
      (werte, traeger) => ({ traeger, ...werte, prozent: quoteVon(werte) }),
    ),
    herzschlag: sortierteEintraege(
      herzschlagJeTraeger({ calls, index, fen: herzschlagFen, nowMs, deadlineMs }),
      (werte, traeger) => ({ traeger, ...werte }),
    ),
    nieBeendet: nieBeendetZahl({ calls, nowMs, deckungFensterMs }),
    profillos: profillosZahl({ calls, fen: herzschlagFen }),
    fensterH,
    herzschlagAktiv,
    schwelleProzent: billing.costTruingMinCoveragePercent,
  };
  return { ...bericht, zeile: deckungsZeile(bericht), befunde: buchBefunde(bericht) };
}
