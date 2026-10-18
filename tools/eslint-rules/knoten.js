export function knotenUnter(start, visitorKeys, steigtAb = () => true) {
  const gefunden = [];
  const offen = [start];
  while (offen.length > 0) {
    const node = offen.pop();
    gefunden.push(node);
    if (!steigtAb(node)) continue;
    for (const schluessel of visitorKeys[node.type] ?? []) {
      offen.push(...[node[schluessel]].flat().filter(Boolean));
    }
  }
  return gefunden;
}

export function alleKnoten(sourceCode) {
  return sourceCode === undefined ? [] : knotenUnter(sourceCode.ast, sourceCode.visitorKeys);
}

export function zugriffsName(zugriff) {
  if (!zugriff.computed) return zugriff.property.name;
  return zugriff.property.type === "Literal" ? zugriff.property.value : undefined;
}

export function schluesselName(eigenschaft) {
  if (eigenschaft.type !== "Property" || eigenschaft.computed) return undefined;
  return eigenschaft.key.type === "Identifier" ? eigenschaft.key.name : eigenschaft.key.value;
}
