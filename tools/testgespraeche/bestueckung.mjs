import {
  besesseneFeldNamen,
  vergleicheBesitz,
  wertAnPfad,
} from "../../scripts/lib/elevenlabs-besitz.mjs";

const DARF_ABWEICHEN = new Set(["conversation_config_override_erlaubnisse", "retention_days"]);
const NIE_GESCHRIEBEN = new Set([...DARF_ABWEICHEN, "init_webhook_schalter"]);
const TRENNER = ", ";
const SYSTEM_VARIABLE = "system__";
const WERKZEUGE = "conversation_config.agent.prompt.tools";

export function pushFelder(vorlage) {
  return besesseneFeldNamen(vorlage).filter((feld) => !NIE_GESCHRIEBEN.has(feld));
}

function werkzeugVariablen(wert, gefunden = new Set()) {
  if (wert === null || typeof wert !== "object") return gefunden;
  for (const [schluessel, teil] of Object.entries(wert)) {
    if (schluessel === "dynamic_variable" && teil && !teil.startsWith(SYSTEM_VARIABLE)) {
      gefunden.add(teil);
    } else {
      werkzeugVariablen(teil, gefunden);
    }
  }
  return gefunden;
}

export function pruefeVariablen(live, faelle, variablenVon) {
  const noetig = [...werkzeugVariablen(wertAnPfad(live, WERKZEUGE).wert)];
  const fehlend = faelle.flatMap((fall) => {
    const variablen = variablenVon(fall);
    return noetig
      .filter((name) => !Object.hasOwn(variablen, name))
      .map((name) => `${fall.name}: ${name}`);
  });
  if (fehlend.length > 0) {
    throw new Error(`den Fällen Variablen der Werkzeuge fehlen: ${fehlend.join(TRENNER)}`);
  }
}

export function pruefeBestueckung(vorlage, live) {
  const befund = vergleicheBesitz({ vorlage, live });
  const abweichend = befund.abweichungen
    .map((abweichung) => abweichung.feld)
    .filter((feld) => !DARF_ABWEICHEN.has(feld));
  const gruende = [
    ...abweichend,
    ...befund.fehler,
    ...befund.verletzungen,
    ...befund.nichtPruefbar,
  ];
  if (gruende.length > 0) {
    throw new Error(`der Test-Agent gleicht der Vorlage nicht: ${gruende.join(TRENNER)}`);
  }
}
