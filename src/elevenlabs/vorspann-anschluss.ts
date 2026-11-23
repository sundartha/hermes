import { PLACEHOLDER_OPENER, afterGreeting } from "../i18n/eroeffnung.js";

const AUFFORDERUNG: Readonly<Record<string, string>> = Object.freeze({
  de: "Bitte sprechen Sie.",
  en: "Please go ahead.",
  fr: "Je vous écoute.",
});

interface AnschlussEingabe {
  language: string;
  anlass: unknown;
}

function anlassSatz(anlass: unknown): string {
  if (typeof anlass !== "string") return "";
  const bereinigt = afterGreeting(anlass.trim()).replace(/[.!?]+$/, "");
  if (!bereinigt || bereinigt.includes(PLACEHOLDER_OPENER)) return "";
  return `${bereinigt.charAt(0).toUpperCase()}${bereinigt.slice(1)}.`;
}

export function anschlussSatz({ language, anlass }: AnschlussEingabe): string {
  const aufforderung = AUFFORDERUNG[language] ?? "";
  return [anlassSatz(anlass), aufforderung].filter(Boolean).join(" ");
}
