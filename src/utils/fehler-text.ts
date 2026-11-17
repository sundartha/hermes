export function fehlerText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function fehlerStapel(err: unknown): string {
  return err instanceof Error && err.stack ? err.stack : String(err);
}
