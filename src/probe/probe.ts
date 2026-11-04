interface Anruf {
  readonly nummer: string;
}
export function alsAnruf(roh: unknown): Anruf {
  return roh as Anruf;
}
