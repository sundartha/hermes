// Feste Video-Formate ("Sendungen"). Statt Freitext-Prompts waehlst du ein
// Format und fuellst nur den Inhalt. Jedes Format kennt sein Higgsfield-Modell,
// seine Dauer, seine Prompt-Vorlage und den Status-Bogen des Fluegels.

import type { HermesStatus } from "../../../hermes-animation-lab/src/types.js";

/** Inhalt, den der Nutzer pro Video liefert (alles optional ausser hook). */
export type FormatInput = {
  /** Aufhaenger / erster Satz. Pflicht. */
  hook: string;
  /** Kernaussage / was der Agent kann. */
  message?: string;
  /** Call-to-Action. */
  cta?: string;
};

/** Ein Status-Beat im Video: ab Sekunde `at` zeigt der Fluegel `status`. */
export type StatusBeat = { at: number; status: HermesStatus };

export type StudioFormat = {
  id: "founder_talk" | "problem_solution" | "live_demo";
  label: string;
  description: string;
  /** Higgsfield Marketing-Studio Modus. */
  higgsfieldMode: "ugc" | "product_review" | "product_showcase";
  durationSec: number;
  /** Baut den Higgsfield-Prompt aus dem Nutzer-Input. */
  buildPrompt: (input: FormatInput) => string;
  /** Status-Bogen des Fluegels = Anruf-Lebenszyklus als Story. */
  statusArc: StatusBeat[];
};

export const FORMATS: readonly StudioFormat[] = [
  {
    id: "founder_talk",
    label: "Founder Talk",
    description: "Presenter spricht in die Kamera. Ein Gedanke pro Video.",
    higgsfieldMode: "ugc",
    durationSec: 15,
    buildPrompt: (i) =>
      `UGC selfie video, founder speaking confidently to camera, natural light. ` +
      `He says: "${i.hook}". ${i.message ?? ""} Authentic, vertical 9:16.`,
    statusArc: [
      { at: 0, status: "connecting" },
      { at: 3, status: "working" },
      { at: 12, status: "success" },
    ],
  },
  {
    id: "problem_solution",
    label: "Problem → Lösung",
    description: "Nerviges Telefon-Problem, Schnitt, Hermes löst es.",
    higgsfieldMode: "product_review",
    durationSec: 18,
    buildPrompt: (i) =>
      `Short ad: frustrated person stuck on hold on the phone. Cut. ` +
      `Calm relief as an AI agent handles the call. Hook: "${i.hook}". ` +
      `${i.message ?? ""} ${i.cta ?? ""} Vertical 9:16, punchy cuts.`,
    statusArc: [
      { at: 0, status: "error" },
      { at: 5, status: "connecting" },
      { at: 8, status: "working" },
      { at: 15, status: "success" },
    ],
  },
  {
    id: "live_demo",
    label: "Live-Demo",
    description: "Der Agent tätigt sichtbar einen echten Anruf, Ergebnis zurück.",
    higgsfieldMode: "product_showcase",
    durationSec: 20,
    buildPrompt: (i) =>
      `Clean product demo: a phone UI where an AI agent places a real call. ` +
      `Soundwaves, a transcript appears, task done. Hook: "${i.hook}". ` +
      `${i.message ?? ""} Polished, vertical 9:16.`,
    statusArc: [
      { at: 0, status: "idle" },
      { at: 2, status: "connecting" },
      { at: 6, status: "working" },
      { at: 17, status: "success" },
    ],
  },
];

export function getFormat(id: StudioFormat["id"]): StudioFormat {
  const f = FORMATS.find((x) => x.id === id);
  if (!f) throw new Error(`Unbekanntes Format: ${id}`);
  return f;
}
