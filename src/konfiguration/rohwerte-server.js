import path from "path";
import { MS_PER_HOUR, MS_PER_MINUTE } from "../utils/timer.js";

export const DEPLOYED_COMMIT_UNKNOWN = "unbekannt";

export function rohwerteServer(env, { numEnv, stripTrailingSlash, detectProduction }, quellOrdner) {
  return {
    port: numEnv("PORT", env.PORT, { fallback: 3000, min: 0 }),
    publicUrl: stripTrailingSlash(env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || ""),
    publicUrlExplicit: Boolean((env.PUBLIC_URL || "").trim()),
    isProduction: detectProduction(),
    deployedCommit: env.RENDER_GIT_COMMIT || DEPLOYED_COMMIT_UNKNOWN,
    openaiAppsChallengeToken: (env.OPENAI_APPS_CHALLENGE_TOKEN || "").trim(),
    shutdownDrainTimeoutMs: numEnv("SHUTDOWN_DRAIN_TIMEOUT_MS", env.SHUTDOWN_DRAIN_TIMEOUT_MS, {
      fallback: 8000,
      min: 0,
      max: 110000,
    }),
    herzschlagUrl: env.HERZSCHLAG_URL || "",
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
    dataDir: env.DATA_DIR || path.join(quellOrdner, "..", "data"),
    publicDir: path.join(quellOrdner, "..", "public"),
    webDistDir: env.WEB_DIST_DIR ? path.resolve(env.WEB_DIST_DIR) : "",
  };
}
