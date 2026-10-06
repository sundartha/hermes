import { REIFE } from "../store/defaults.js";
import { MS_PER_HOUR } from "../utils/timer.js";
import { KOSTENPROFIL, kostenprofilFuerAnruf, pflichtTraegerFuerProfil } from "./kostenarten.js";
import { sweepTraegerFuerProfil } from "./sweep-kostenbeleg.js";

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

export function faelligkeitsfensterMs(billing) {
  return billing.costSettleDeadlineHours * MS_PER_HOUR;
}

export function fristAbgelaufen({ call, nowMs, deadlineMs }) {
  const endedMs = Date.parse(call?.endedAt ?? "");
  return Number.isFinite(endedMs) && nowMs - endedMs >= deadlineMs;
}

function zeileFuerTraeger(belege, traeger) {
  return belege.find((zeile) => zeile.traeger === traeger);
}

export function belegUnbeschaffbarAmAnruf({ call, belege }) {
  return (
    kostenprofilFuerAnruf(call) === KOSTENPROFIL.EL_CONVAI_SIP &&
    !!call.endedAt &&
    !!call.elevenlabsConversationId &&
    !call.sipCallId &&
    belege.length === 0
  );
}

export function offeneTraeger({ call, belege }) {
  const pflicht = pflichtTraegerFuerProfil(kostenprofilFuerAnruf(call));
  return pflicht
    .filter((traeger) => zeileFuerTraeger(belege, traeger)?.reife !== REIFE.BELEGT)
    .sort((links, rechts) => links.localeCompare(rechts));
}

export function nichtNachreifbar(zeile) {
  return zeile?.nachreifbar === false && zeile.reife !== REIFE.BELEGT;
}

function endzustandVon({ call, belege, fehlend, frist }) {
  if (!call?.costProfile || pflichtTraegerFuerProfil(kostenprofilFuerAnruf(call)).length === 0)
    return ENDZUSTAND.PROFIL_FEHLT;
  if (frist && belegUnbeschaffbarAmAnruf({ call, belege })) return ENDZUSTAND.UNBESCHAFFBAR;
  if (fehlend.length === 0) return ENDZUSTAND.VOLLSTAENDIG;
  if (fehlend.every((traeger) => nichtNachreifbar(zeileFuerTraeger(belege, traeger)))) return ENDZUSTAND.UNBESCHAFFBAR;
  return ENDZUSTAND.UNVOLLSTAENDIG_FINAL;
}

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

export function zaehlListe(werte) {
  if (werte.length === 0) return LEERE_LISTE;
  const zaehler = new Map();
  for (const wert of werte) zaehler.set(wert, (zaehler.get(wert) ?? 0) + 1);
  const sortiert = [...zaehler.entries()].sort(([links], [rechts]) => links.localeCompare(rechts));
  const formatiert = sortiert.map(([wert, anzahl]) => `${wert}(${anzahl})`);
  return formatiert.join(",");
}
