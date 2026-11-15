export function fehlerText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
