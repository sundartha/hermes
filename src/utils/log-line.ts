export function formatLogLine(prefix: string, kind: string, payload: unknown): string {
  return `${prefix} ${kind} ${JSON.stringify(payload)}`;
}
