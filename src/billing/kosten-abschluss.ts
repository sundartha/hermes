import { REIFE } from "../begriffe/abrechnung.js";
import { MS_PER_HOUR } from "../utils/timer.js";
import { KOSTENPROFIL, kostenprofilFuerAnruf, pflichtTraegerFuerProfil } from "./kostenarten.js";
import { sweepTraegerFuerProfil } from "./sweep-kostenbeleg.ts";

export interface AbschlussAnruf {
  costProfile?: string | null | undefined;
  endedAt?: string | null | undefined;
  elevenlabsConversationId?: string | null | undefined;
  sipCallId?: string | null | undefined;
}

export interface AbschlussBeleg {
  traeger: string;
  reife?: string | undefined;
  nachreifbar?: boolean | undefined;
}

const kostenprofilVon: (call: AbschlussAnruf | null | undefined) => string = kostenprofilFuerAnruf;
const pflichtTraegerVon: (profil: string) => string[] = pflichtTraegerFuerProfil;
const sweepTraegerVon: (profil: string) => string | null | undefined = sweepTraegerFuerProfil;

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

export const LEERE_LISTE = "keine";

export function faelligkeitsfensterMs(billing: { costSettleDeadlineHours: number }): number {
  return billing.costSettleDeadlineHours * MS_PER_HOUR;
}

export function fristAbgelaufen({
  call,
  nowMs,
  deadlineMs,
}: {
  call: AbschlussAnruf | null | undefined;
  nowMs: number;
  deadlineMs: number;
}): boolean {
  const endedMs = Date.parse(call?.endedAt ?? "");
  return Number.isFinite(endedMs) && nowMs - endedMs >= deadlineMs;
}

function zeileFuerTraeger(belege: AbschlussBeleg[], traeger: string): AbschlussBeleg | undefined {
  return belege.find((zeile) => zeile.traeger === traeger);
}

export function belegUnbeschaffbarAmAnruf({
  call,
  belege,
}: {
  call: AbschlussAnruf;
  belege: AbschlussBeleg[];
}): boolean {
  return (
    kostenprofilVon(call) === KOSTENPROFIL.EL_CONVAI_SIP &&
    !!call.endedAt &&
    !!call.elevenlabsConversationId &&
    !call.sipCallId &&
    belege.length === 0
  );
}

export function offeneTraeger({
  call,
  belege,
}: {
  call: AbschlussAnruf | null | undefined;
  belege: AbschlussBeleg[];
}): string[] {
  const pflicht = pflichtTraegerVon(kostenprofilVon(call));
  return pflicht
    .filter((traeger) => zeileFuerTraeger(belege, traeger)?.reife !== REIFE.BELEGT)
    .sort((links, rechts) => links.localeCompare(rechts));
}

export function nichtNachreifbar(zeile: AbschlussBeleg | undefined): boolean {
  return zeile?.nachreifbar === false && zeile.reife !== REIFE.BELEGT;
}

function endzustandVon({
  call,
  belege,
  fehlend,
  frist,
}: {
  call: AbschlussAnruf | null | undefined;
  belege: AbschlussBeleg[];
  fehlend: string[];
  frist: boolean;
}): string {
  if (!call?.costProfile || pflichtTraegerVon(kostenprofilVon(call)).length === 0)
    return ENDZUSTAND.PROFIL_FEHLT;
  if (frist && belegUnbeschaffbarAmAnruf({ call, belege })) return ENDZUSTAND.UNBESCHAFFBAR;
  if (fehlend.length === 0) return ENDZUSTAND.VOLLSTAENDIG;
  if (fehlend.every((traeger) => nichtNachreifbar(zeileFuerTraeger(belege, traeger))))
    return ENDZUSTAND.UNBESCHAFFBAR;
  return ENDZUSTAND.UNVOLLSTAENDIG_FINAL;
}

export function abschlussFuerAnruf({
  call,
  belege,
  nowMs,
  deadlineMs,
  sweepTraegerErledigt,
}: {
  call: AbschlussAnruf;
  belege: AbschlussBeleg[];
  nowMs: number;
  deadlineMs: number;
  sweepTraegerErledigt: boolean;
}):
  | { geschlossen: false }
  | { geschlossen: true; grund: string; endzustand: string; fehlend: string[] } {
  const sweepTraeger = sweepTraegerVon(kostenprofilVon(call));
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

export function zaehlListe(werte: string[]): string {
  if (werte.length === 0) return LEERE_LISTE;
  const zaehler = new Map<string, number>();
  for (const wert of werte) zaehler.set(wert, (zaehler.get(wert) ?? 0) + 1);
  const sortiert = [...zaehler.entries()].sort(([links], [rechts]) => links.localeCompare(rechts));
  const formatiert = sortiert.map(([wert, anzahl]) => `${wert}(${String(anzahl)})`);
  return formatiert.join(",");
}
