import path from "path";
import { MS_PER_HOUR, MS_PER_MINUTE } from "../utils/timer.ts";
import type { umgebungMit } from "./umgebung.ts";

export const DEPLOYED_COMMIT_UNKNOWN = "unbekannt";

export function rohwerteServer(
  env: {
    PORT?: string | undefined;
    PUBLIC_URL?: string | undefined;
    RENDER_EXTERNAL_URL?: string | undefined;
    RENDER_GIT_COMMIT?: string | undefined;
    OPENAI_APPS_CHALLENGE_TOKEN?: string | undefined;
    SHUTDOWN_DRAIN_TIMEOUT_MS?: string | undefined;
    HERZSCHLAG_URL?: string | undefined;
    HERZSCHLAG_TAKT_MS?: string | undefined;
    HERZSCHLAG_VERZUG_GRENZE_MS?: string | undefined;
    HERZSCHLAG_FRIST_MS?: string | undefined;
    DATA_DIR?: string | undefined;
    WEB_DIST_DIR?: string | undefined;
  },
  {
    numEnv,
    stripTrailingSlash,
    detectProduction,
    textEnv,
  }: Pick<ReturnType<typeof umgebungMit>, "numEnv" | "stripTrailingSlash" | "detectProduction" | "textEnv">,
  quellOrdner: string,
): {
  port: number | undefined;
  publicUrl: string;
  publicUrlExplicit: boolean;
  isProduction: boolean;
  deployedCommit: string;
  openaiAppsChallengeToken: string;
  shutdownDrainTimeoutMs: number | undefined;
  herzschlagUrl: string;
  herzschlagTaktMs: number | undefined;
  herzschlagVerzugGrenzeMs: number | undefined;
  herzschlagFristMs: number | undefined;
  dataDir: string;
  publicDir: string;
  webDistDir: string;
} {
  return {
    port: numEnv("PORT", env.PORT, { fallback: 3000, min: 0 }),
    publicUrl: stripTrailingSlash(textEnv(env.PUBLIC_URL, textEnv(env.RENDER_EXTERNAL_URL, ""))),
    publicUrlExplicit: Boolean((env.PUBLIC_URL ?? "").trim()),
    isProduction: detectProduction(),
    deployedCommit: textEnv(env.RENDER_GIT_COMMIT, DEPLOYED_COMMIT_UNKNOWN),
    openaiAppsChallengeToken: (env.OPENAI_APPS_CHALLENGE_TOKEN ?? "").trim(),
    shutdownDrainTimeoutMs: numEnv("SHUTDOWN_DRAIN_TIMEOUT_MS", env.SHUTDOWN_DRAIN_TIMEOUT_MS, {
      fallback: 8000,
      min: 0,
      max: 110000,
    }),
    herzschlagUrl: env.HERZSCHLAG_URL ?? "",
    herzschlagTaktMs: numEnv("HERZSCHLAG_TAKT_MS", env.HERZSCHLAG_TAKT_MS, {
      fallback: MS_PER_MINUTE,
      min: 10,
      max: MS_PER_HOUR,
    }),
    herzschlagVerzugGrenzeMs: numEnv("HERZSCHLAG_VERZUG_GRENZE_MS", env.HERZSCHLAG_VERZUG_GRENZE_MS, {
      fallback: 2000,
      min: 5,
      max: MS_PER_MINUTE,
    }),
    herzschlagFristMs: numEnv("HERZSCHLAG_FRIST_MS", env.HERZSCHLAG_FRIST_MS, {
      fallback: 5000,
      min: 10,
      max: MS_PER_MINUTE,
    }),
    dataDir: textEnv(env.DATA_DIR, path.join(quellOrdner, "..", "data")),
    publicDir: path.join(quellOrdner, "..", "public"),
    webDistDir: env.WEB_DIST_DIR ? path.resolve(env.WEB_DIST_DIR) : "",
  };
}
