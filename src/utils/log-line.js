export function formatLogLine(prefix, kind, payload) {
  return `${prefix} ${kind} ${JSON.stringify(payload)}`;
}
