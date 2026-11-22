export function arbeitGehoertLebenderFremder(besitzer, { eigene, lebende }) {
  if (!besitzer || besitzer === eigene) return false;
  return Array.isArray(lebende) && lebende.includes(besitzer);
}

export function auftragHaltGrund(besitzer, { eigene, lebende }) {
  if (!besitzer || besitzer === eigene) return null;
  if (!Array.isArray(lebende)) return "lebenszeichen_unlesbar";
  return lebende.includes(besitzer) ? "fremd" : null;
}
