const AGENT_NAME = "Hermes";

const TEXTE = Object.freeze({
  de: Object.freeze({
    gruss: "Hallo,",
    kiKern: "der KI-Assistent von",
    kiHinweis: (kern, name) => `ich bin ${AGENT_NAME}, ${kern} ${name}`,
    zusammenfassung: (fuer) => `ich fasse das Gespräch für ${fuer} zusammen`,
    auftraggeber: "meinen Auftraggeber",
    verbinder: "und",
    besitzer: `Hey, hier ist ${AGENT_NAME}, dein KI-Assistent.`,
    besitzerFrage: "Wie kann ich dir helfen?",
  }),
  en: Object.freeze({
    gruss: "Hello,",
    kiKern: "the AI assistant of",
    kiHinweis: (kern, name) => `I am ${AGENT_NAME}, ${kern} ${name}`,
    zusammenfassung: (fuer) => `I will summarise this conversation for ${fuer}`,
    auftraggeber: "the person I represent",
    verbinder: "and",
    besitzer: `Hey, it's ${AGENT_NAME}, your AI assistant.`,
    besitzerFrage: "How can I help you?",
  }),
  fr: Object.freeze({
    gruss: "Bonjour,",
    kiKern: "l'assistant IA de",
    kiHinweis: (kern, name) => `je suis ${AGENT_NAME}, ${kern} ${name}`,
    zusammenfassung: (fuer) => `je résume cette conversation pour ${fuer}`,
    auftraggeber: "mon mandant",
    verbinder: "et",
    besitzer: `Salut, c'est ${AGENT_NAME}, ton assistant IA.`,
    besitzerFrage: "Comment je peux t'aider ?",
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

export function afterGreeting(reason) {
  if (!reason) return reason;
  return /^I\b/.test(reason) ? reason : `${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
}

export function besitzerEroeffnung({ language }) {
  return TEXTE[language].besitzer;
}

export function besitzerFrage(language) {
  return TEXTE[language].besitzerFrage;
}

export function drittEroeffnung({ language, ownerName, firstName, reason }) {
  const texte = TEXTE[language];
  const anlass = afterGreeting(reason).replace(/[.!]+$/, "");
  const kopf = `${texte.gruss} ${anlass} ${GEDANKENSTRICH} `;
  const pflichtsatz = `${kopf}${kiHinweisFor(language, ownerName)}`;
  const fuer = firstName || texte.auftraggeber;
  return { text: `${pflichtsatz}, ${texte.verbinder} ${texte.zusammenfassung(fuer)}.`, pflichtsatz };
}
