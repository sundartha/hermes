import { attachNamespaces, CONFIG_NAMESPACES } from "../src/config.js";

export function withConfigNamespaces(flatConfig) {
  const config = { ...flatConfig };
  attachNamespaces(config, CONFIG_NAMESPACES);
  return config;
}

export function fakeTelnyxShimConfig({
  enabled = true,
  claudeModel = "claude-haiku-4-5",
  telnyxShimMaxTurnsPerMin = 100,
  telnyxShimSharedSecret = "shim-secret",
  telnyxShimDebugShape = false,
  telnyxShimTokenStreaming = false,
  telnyxShimSupersedeExtendedTurn = true,
  telnyxShimIgnoreProviderNudge = true,
  telnyxMaxConsecutiveFailedTurns = 3,
  telnyxFailedTurnFarewellText = "",
  telnyxShimExtendHoldMs = 0,
} = {}) {
  return withConfigNamespaces({
    claudeModel,
    telnyxAssistant: {
      enabled,
      shimMaxTurnsPerMin: telnyxShimMaxTurnsPerMin,
      shimSharedSecret: telnyxShimSharedSecret,
      shimDebugShape: telnyxShimDebugShape,
      shimTokenStreaming: telnyxShimTokenStreaming,
      shimSupersedeExtendedTurn: telnyxShimSupersedeExtendedTurn,
      shimIgnoreProviderNudge: telnyxShimIgnoreProviderNudge,
      maxConsecutiveFailedTurns: telnyxMaxConsecutiveFailedTurns,
      failedTurnFarewellText: telnyxFailedTurnFarewellText,
      shimExtendHoldMs: telnyxShimExtendHoldMs,
    },
  });
}
