// Render-Plan ("Produktionsauftrag"). Buendelt ALLES, was noetig ist, um aus
// einem Higgsfield-Clip ein fertiges Marken-Reel zu rendern: der Roh-Clip, der
// Status-Bogen des Fluegels, die Untertitel-Beats, der Marken-Look, das
// Output-Format. Dieses JSON ist die Schnittstelle zu Phase 3 (Remotion/FFmpeg).

import { BRAND, FORMAT, TYPE, VOICE, WING_LOOK } from "../brand/bibel.js";
import { buildJob, type HiggsfieldJob } from "../generate/higgsfield.js";
import type { FormatInput, StudioFormat } from "../generate/formats.js";

export type CaptionBeat = { at: number; until: number; text: string };

export type RenderPlan = {
  formatId: StudioFormat["id"];
  durationSec: number;
  output: typeof FORMAT;
  brand: {
    gold: string;
    deepBlue: string;
    paper: string;
    font: string;
    signoff: string;
  };
  /** Roh-Clip von Higgsfield (leer bis generiert). */
  clipUrl: string | null;
  /** Der Higgsfield-Job, der den Clip erzeugt(e). */
  higgsfield: HiggsfieldJob;
  /** Anruf-Lebenszyklus als Story-Beats fuer das Fluegel-Overlay. */
  statusArc: StudioFormat["statusArc"];
  wingLook: typeof WING_LOOK;
  /** Untertitel zeitgesteuert. */
  captions: CaptionBeat[];
};

/** Baut Untertitel-Beats aus dem Nutzer-Input ueber die Clip-Dauer. */
function buildCaptions(format: StudioFormat, input: FormatInput): CaptionBeat[] {
  const d = format.durationSec;
  const beats: CaptionBeat[] = [{ at: 0.4, until: d * 0.35, text: input.hook }];
  if (input.message) beats.push({ at: d * 0.38, until: d * 0.78, text: input.message });
  const tail = input.cta ?? VOICE.signoff;
  beats.push({ at: d * 0.8, until: d, text: tail });
  return beats;
}

/** Erzeugt den vollstaendigen Produktionsauftrag. */
export function buildRenderPlan(
  format: StudioFormat,
  input: FormatInput,
  opts?: { clipUrl?: string; productIds?: string[]; avatars?: HiggsfieldJob["avatars"] },
): RenderPlan {
  return {
    formatId: format.id,
    durationSec: format.durationSec,
    output: FORMAT,
    brand: {
      gold: BRAND.gold,
      deepBlue: BRAND.deepBlue,
      paper: BRAND.paper,
      font: TYPE.family,
      signoff: VOICE.signoff,
    },
    clipUrl: opts?.clipUrl ?? null,
    higgsfield: buildJob(format, input, {
      productIds: opts?.productIds,
      avatars: opts?.avatars,
    }),
    statusArc: format.statusArc,
    wingLook: WING_LOOK,
    captions: buildCaptions(format, input),
  };
}

export function planToJson(plan: RenderPlan): string {
  return JSON.stringify(plan, null, 2);
}
