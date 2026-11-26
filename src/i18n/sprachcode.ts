import { fehler, ok, type Ergebnis } from "../utils/ergebnis.ts";

const SPRACHCODE_FORM = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/;

export function sprachcodeOf(wert: unknown): Ergebnis<string> {
  if (typeof wert !== "string") return fehler("kein-text");
  const code = wert.trim().toLowerCase();
  return SPRACHCODE_FORM.test(code) ? ok(code) : fehler("ungueltige-form");
}
