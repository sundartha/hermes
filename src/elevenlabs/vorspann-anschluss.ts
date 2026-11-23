import { afterGreeting } from "../i18n/eroeffnung.js";

const AUFFORDERUNG: Readonly<Record<string, string>> = Object.freeze({
  de: "Bitte sprechen Sie.",
  en: "Please go ahead.",
  fr: "Je vous écoute.",
});

export function anschlussSatz({ language, anlass }: { language: string; anlass: string }): string {
  const bereinigt = afterGreeting(anlass.trim()).replace(/[.!?]+$/, "");
  return `${bereinigt.charAt(0).toUpperCase()}${bereinigt.slice(1)}. ${AUFFORDERUNG[language]}`;
}
