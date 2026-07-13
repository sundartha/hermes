// Higgsfield-Job-Builder + Live-Submit. Wandelt ein Format + Inhalt in die
// EXAKTEN Marketing-Studio-Parameter um und schickt sie an den lokalen
// Bridge-Server (server.mjs), der die Higgsfield-CLI mit DEINEM Account
// ausfuehrt. Kein Key im Browser — der Bridge-Server haelt die Verbindung.

import { FORMAT } from "../brand/bibel.js";
import type { FormatInput, StudioFormat } from "./formats.js";

export type HiggsfieldJob = {
  model: "marketing_studio_video";
  prompt: string;
  mode: StudioFormat["higgsfieldMode"];
  duration: number;
  aspect_ratio: typeof FORMAT.aspect;
  resolution: "720p";
  generate_audio: boolean;
  product_ids?: string[];
  avatars?: { id: string; type: "preset" | "custom" }[];
};

/** Baut den abschickbaren Higgsfield-Job (ohne ihn zu senden). */
export function buildJob(
  format: StudioFormat,
  input: FormatInput,
  library?: { productIds?: string[]; avatars?: HiggsfieldJob["avatars"] },
): HiggsfieldJob {
  return {
    model: "marketing_studio_video",
    prompt: format.buildPrompt(input),
    mode: format.higgsfieldMode,
    duration: format.durationSec,
    aspect_ratio: FORMAT.aspect,
    resolution: "720p",
    generate_audio: true,
    product_ids: library?.productIds,
    avatars: library?.avatars,
  };
}

/** Der CLI-Befehl, der diesen Job 1:1 abschickt (zum Kopieren/Skripten). */
export function toCliCommand(job: HiggsfieldJob): string {
  const parts = [
    "higgsfield generate create",
    job.model,
    `--prompt ${JSON.stringify(job.prompt)}`,
    `--mode ${job.mode}`,
    `--duration ${job.duration}`,
    `--aspect_ratio ${job.aspect_ratio}`,
    `--resolution ${job.resolution}`,
    `--generate-audio ${job.generate_audio}`,
    "--wait",
  ];
  return parts.join(" ");
}

/** Login-/Account-Status vom Bridge-Server. */
export async function checkStatus(): Promise<{
  authed: boolean;
  needsWorkspace: boolean;
  reachable: boolean;
}> {
  try {
    const r = await fetch("/api/status");
    if (!r.ok) return { authed: false, needsWorkspace: false, reachable: true };
    const d = (await r.json()) as { authed: boolean; needsWorkspace: boolean };
    return { authed: d.authed, needsWorkspace: d.needsWorkspace, reachable: true };
  } catch {
    return { authed: false, needsWorkspace: false, reachable: false };
  }
}

/**
 * Schickt den Job ab — LIVE, mit deinem Account, ueber den Bridge-Server.
 * Wartet, bis Higgsfield fertig ist, und liefert die Clip-URL.
 */
export async function submitJob(job: HiggsfieldJob): Promise<{ clipUrl: string }> {
  const r = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
    throw new Error(err.detail || err.error || `Bridge-Fehler (${r.status})`);
  }
  return (await r.json()) as { clipUrl: string };
}
