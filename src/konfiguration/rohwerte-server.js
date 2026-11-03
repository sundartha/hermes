import { detectProduction, stripTrailingSlash } from "./umgebung.js";

export const DEPLOYED_COMMIT_UNKNOWN = "unbekannt";

export function serverRohwerte(umgebung, beigaben) {
  const { env, numEnv } = umgebung;
  return {
    port: numEnv("PORT", env.PORT, { fallback: 3000, min: 0 }),
    publicUrl: stripTrailingSlash(env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || ""),
    publicUrlExplicit: Boolean((env.PUBLIC_URL || "").trim()),
    isProduction: detectProduction(env),
    deployedCommit: env.RENDER_GIT_COMMIT || DEPLOYED_COMMIT_UNKNOWN,
    openaiAppsChallengeToken: (env.OPENAI_APPS_CHALLENGE_TOKEN || "").trim(),
    dataDir: beigaben.dataDir,
    publicDir: beigaben.publicDir,
    webDistDir: beigaben.webDistDir,
    shutdownDrainTimeoutMs: numEnv("SHUTDOWN_DRAIN_TIMEOUT_MS", env.SHUTDOWN_DRAIN_TIMEOUT_MS, {
      fallback: 8000,
      min: 0,
      max: 30000,
    }),
  };
}
