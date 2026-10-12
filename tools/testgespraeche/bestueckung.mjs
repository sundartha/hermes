import { besesseneFeldNamen, vergleicheBesitz } from "../../scripts/lib/elevenlabs-besitz.mjs";

const DARF_ABWEICHEN = new Set(["conversation_config_override_erlaubnisse", "retention_days"]);
const NIE_GESCHRIEBEN = new Set([...DARF_ABWEICHEN, "init_webhook_schalter"]);
const TRENNER = ", ";

export function pushFelder(vorlage) {
  return besesseneFeldNamen(vorlage).filter((feld) => !NIE_GESCHRIEBEN.has(feld));
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
