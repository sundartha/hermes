function vorOderGleich(links, rechts) {
  return links.line < rechts.line || (links.line === rechts.line && links.column <= rechts.column);
}

export function enthaelt(aussen, innen) {
  return vorOderGleich(aussen.start, innen.start) && vorOderGleich(innen.end, aussen.end);
}
