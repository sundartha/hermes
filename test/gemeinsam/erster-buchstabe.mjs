export function beginntBisAufErstenBuchstaben(text, erwartet) {
  if (!erwartet) return false;
  return (
    text.charAt(0).toLowerCase() === erwartet.charAt(0).toLowerCase() &&
    text.slice(1).startsWith(erwartet.slice(1))
  );
}

export function enthaeltBisAufErstenBuchstaben(text, erwartet) {
  if (!erwartet) return false;
  const rest = erwartet.slice(1);
  const erster = erwartet.charAt(0).toLowerCase();
  for (let i = text.indexOf(rest); i !== -1; i = text.indexOf(rest, i + 1)) {
    if (i > 0 && text.charAt(i - 1).toLowerCase() === erster) return true;
  }
  return false;
}
