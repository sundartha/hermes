import { afterGreeting } from "./locales.js";

const AGENT_NAME = "Hermes";

const TEXTE = Object.freeze({
  de: Object.freeze({
    gruss: "Hallo,",
    kiKern: "der KI-Assistent von",
    kiHinweis: (kern, name) => `ich bin ${AGENT_NAME}, ${kern} ${name}`,
    zusammenfassung: (fuer) => `ich fasse das Gespräch für ${fuer} zusammen`,
    auftraggeber: "meinen Auftraggeber",
    verbinder: "und",
  }),
  en: Object.freeze({
    gruss: "Hello,",
    kiKern: "the AI assistant of",
    kiHinweis: (kern, name) => `I am ${AGENT_NAME}, ${kern} ${name}`,
    zusammenfassung: (fuer) => `I will summarise this conversation for ${fuer}`,
    auftraggeber: "the person I represent",
    verbinder: "and",
  }),
  fr: Object.freeze({
    gruss: "Bonjour,",
    kiKern: "l'assistant IA de",
    kiHinweis: (kern, name) => `je suis ${AGENT_NAME}, ${kern} ${name}`,
    zusammenfassung: (fuer) => `je résume cette conversation pour ${fuer}`,
    auftraggeber: "mon mandant",
    verbinder: "et",
  }),
});

const GEDANKENSTRICH = "–";
const NAME_PLATZHALTER = "\u0000";

function kiHinweisFor(language, ownerName) {
  const texte = TEXTE[language];
  return texte.kiHinweis(texte.kiKern, ownerName);
}

export function kiHinweisKernFor(language) {
  return TEXTE[language].kiKern;
}

export function kiHinweisRahmenFor(language) {
  const [pre, post] = kiHinweisFor(language, NAME_PLATZHALTER).split(NAME_PLATZHALTER);
  return { pre, post };
}

export function drittEroeffnung({ language, ownerName, firstName, reason }) {
  const texte = TEXTE[language];
  const anlass = afterGreeting(reason).replace(/[.!]+$/, "");
  const kopf = `${texte.gruss} ${anlass} ${GEDANKENSTRICH} `;
  const pflichtsatz = `${kopf}${kiHinweisFor(language, ownerName)}`;
  const fuer = firstName || texte.auftraggeber;
  return { text: `${pflichtsatz}, ${texte.verbinder} ${texte.zusammenfassung(fuer)}.`, pflichtsatz };
}
