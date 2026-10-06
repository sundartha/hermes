const RETRYABLE_STATUS = new Set([408, 409, 429]);
const SERVER_ERROR_MIN = 500;
const TRANSIENT_CODES = new Set([
  "ERR_STREAM_PREMATURE_CLOSE",
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
]);
const PREMATURE_CLOSE_MESSAGE = "Premature close";

export function makeTransientClassifier(isProviderConnectionError = () => false) {
  return function isTransient(err) {
    if (!err) return false;
    if (isProviderConnectionError(err)) return true;
    if (typeof err.status === "number")
      return RETRYABLE_STATUS.has(err.status) || err.status >= SERVER_ERROR_MIN;
    if (err.code && TRANSIENT_CODES.has(err.code)) return true;
    if (err.message === PREMATURE_CLOSE_MESSAGE) return true;
    if (err.cause && err.cause !== err) return isTransient(err.cause);
    return false;
  };
}
