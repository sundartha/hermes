export function arbeitGehoertLebenderFremder(besitzer, { eigene, lebende }) {
  if (!besitzer || besitzer === eigene) return false;
  return Array.isArray(lebende) && lebende.includes(besitzer);
}
