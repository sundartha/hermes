const RETRYABLE_STATUS = new Set<unknown>([408, 409, 429]);
const SERVER_ERROR_MIN = 500;
const TRANSIENT_CODES = new Set<unknown>([
  "ERR_STREAM_PREMATURE_CLOSE",
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
]);
const PREMATURE_CLOSE_MESSAGE = "Premature close";

function lies(wert: unknown, schluessel: string): unknown {
  if ((typeof wert === "object" && wert !== null) || typeof wert === "function") return Reflect.get(wert, schluessel);
  return undefined;
}

export function makeTransientClassifier(isProviderConnectionError: (err: unknown) => boolean = () => false) {
  return function isTransient(err: unknown): boolean {
    if (!err) return false;
    if (isProviderConnectionError(err)) return true;
    const status: unknown = lies(err, "status");
    if (typeof status === "number") return RETRYABLE_STATUS.has(status) || status >= SERVER_ERROR_MIN;
    const code: unknown = lies(err, "code");
    if (code && TRANSIENT_CODES.has(code)) return true;
    if (lies(err, "message") === PREMATURE_CLOSE_MESSAGE) return true;
    const cause: unknown = lies(err, "cause");
    if (cause && cause !== err) return isTransient(cause);
    return false;
  };
}
