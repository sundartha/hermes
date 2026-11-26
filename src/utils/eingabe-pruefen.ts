import type { ZodType, ZodTypeDef } from "zod";
import { lehneEingabeAb } from "./http.ts";

const UNGUELTIGE_EINGABE = "invalid_body";

interface Pruefregel<T> {
  schema: ZodType<T, ZodTypeDef, unknown>;
  meldung?: string;
}

type Antwort = Parameters<typeof lehneEingabeAb>[0];

export function pruefeKoerper<T>(
  res: Antwort,
  { schema, meldung = UNGUELTIGE_EINGABE }: Pruefregel<T>,
  koerper: unknown,
): T | undefined {
  const ergebnis = schema.safeParse(koerper);
  if (lehneEingabeAb(res, !ergebnis.success, meldung)) return undefined;
  return ergebnis.data;
}

export function pruefeAbfrage<T>(res: Antwort, regel: Pruefregel<T>, werte: unknown): T | undefined {
  return pruefeKoerper(res, regel, werte);
}
