export const MAX_CALL_DURATION_CAP_S = 1800;

export const MANDATE_OUT_OF_SCOPE = Object.freeze({
  TAKE_MESSAGE: "take_message",
  DECLINE: "decline",
  ACCEPT_BEST: "accept_best",
});

export const KEY_FACTS_LIMITS = Object.freeze({ maxItems: 10, maxLen: 200 });

export const MANDATE_OUT_OF_SCOPE_DEFAULT = MANDATE_OUT_OF_SCOPE.TAKE_MESSAGE;
