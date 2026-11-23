const SPRACHCODE_FORM = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/;

export function sprachcodeOf(wert: unknown): string | null {
  if (typeof wert !== "string") return null;
  const code = wert.trim().toLowerCase();
  return SPRACHCODE_FORM.test(code) ? code : null;
}
