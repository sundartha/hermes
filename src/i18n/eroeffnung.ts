const AGENT_NAME = "Hermes";

const TEXTE = Object.freeze({
  de: Object.freeze({
    gruss: "Hallo,",
    kiKern: "der KI-Assistent von",
    kiHinweis: (kern: string, name: string) => `ich bin ${AGENT_NAME}, ${kern} ${name}`,
    zusammenfassung: (fuer: string) => `ich fasse das Gespräch für ${fuer} zusammen`,
    auftraggeber: "meinen Auftraggeber",
    verbinder: "und",
    besitzer: `Hey, hier ist ${AGENT_NAME}, dein KI-Assistent.`,
    besitzerFrage: "Wie kann ich dir helfen?",
  }),
  en: Object.freeze({
    gruss: "Hello,",
    kiKern: "the AI assistant of",
    kiHinweis: (kern: string, name: string) => `I am ${AGENT_NAME}, ${kern} ${name}`,
    zusammenfassung: (fuer: string) => `I will summarise this conversation for ${fuer}`,
    auftraggeber: "the person I represent",
    verbinder: "and",
    besitzer: `Hey, it's ${AGENT_NAME}, your AI assistant.`,
    besitzerFrage: "How can I help you?",
  }),
  fr: Object.freeze({
    gruss: "Bonjour,",
    kiKern: "l'assistant IA de",
    kiHinweis: (kern: string, name: string) => `je suis ${AGENT_NAME}, ${kern} ${name}`,
    zusammenfassung: (fuer: string) => `je résume cette conversation pour ${fuer}`,
    auftraggeber: "mon mandant",
    verbinder: "et",
    besitzer: `Salut, c'est ${AGENT_NAME}, ton assistant IA.`,
    besitzerFrage: "Comment je peux t'aider ?",
  }),
});

const TEXTE_NACH_SPRACHE = new Map(Object.entries(TEXTE));

const GEDANKENSTRICH = "–";
const NAME_PLATZHALTER = "\u0000";

function texteFor(language: string) {
  const texte = TEXTE_NACH_SPRACHE.get(language);
  if (texte === undefined) throw new TypeError(`Unbekannte Sprache: ${language}`);
  return texte;
}

function kiHinweisFor(language: string, ownerName: string) {
  const texte = texteFor(language);
  return texte.kiHinweis(texte.kiKern, ownerName);
}

export function kiHinweisKernFor(language: string): string {
  return texteFor(language).kiKern;
}

export function kiHinweisRahmenFor(language: string): { pre: string; post: string } {
  const [pre = "", post = ""] = kiHinweisFor(language, NAME_PLATZHALTER).split(NAME_PLATZHALTER);
  return { pre, post };
}

export function afterGreeting(reason: string): string {
  if (!reason) return reason;
  return /^I\b/.test(reason) ? reason : `${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
}

export const PLACEHOLDER_OPENER = "{{";

export function besitzerEroeffnung({ language, firstName }: { language: string; firstName?: unknown }): string {
  const vorname = typeof firstName === "string" ? firstName.trim() : "";
  if (!vorname || vorname.includes(PLACEHOLDER_OPENER)) return "";
  return texteFor(language).besitzer;
}

export function besitzerFrage(language: string): string {
  return texteFor(language).besitzerFrage;
}

export function drittEroeffnung({ language, ownerName, firstName, reason }: { language: string; ownerName: string; firstName?: string | null; reason: string }): { text: string; pflichtsatz: string } {
  const texte = texteFor(language);
  const anlass = afterGreeting(reason).replace(/[.!]+$/, "");
  const kopf = `${texte.gruss} ${anlass} ${GEDANKENSTRICH} `;
  const pflichtsatz = `${kopf}${kiHinweisFor(language, ownerName)}`;
  const fuer = (firstName ?? "") || texte.auftraggeber;
  return { text: `${pflichtsatz}, ${texte.verbinder} ${texte.zusammenfassung(fuer)}.`, pflichtsatz };
}
