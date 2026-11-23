import { afterGreeting } from "../i18n/eroeffnung.js";

type Sprache = "de" | "en" | "fr";

const AUFFORDERUNG: Readonly<Record<Sprache, string>> = Object.freeze({
  de: "Bitte sprechen Sie.",
  en: "Please go ahead.",
  fr: "Je vous écoute.",
});

const nachGruss: (anlass: string) => string = afterGreeting;

export function anschlussSatz({ language, anlass }: { language: Sprache; anlass: string }): string {
  const bereinigt = nachGruss(anlass.trim()).replace(/[.!?]+$/, "");
  return `${bereinigt.charAt(0).toUpperCase()}${bereinigt.slice(1)}. ${AUFFORDERUNG[language]}`;
}
