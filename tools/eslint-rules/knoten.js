export function alleKnoten(sourceCode) {
  const gefunden = [];
  const offen = sourceCode === undefined ? [] : [sourceCode.ast];
  while (offen.length > 0) {
    const node = offen.pop();
    gefunden.push(node);
    for (const schluessel of sourceCode.visitorKeys[node.type] ?? []) {
      offen.push(...[node[schluessel]].flat().filter(Boolean));
    }
  }
  return gefunden;
}

export function zugriffsName(zugriff) {
  if (!zugriff.computed) return zugriff.property.name;
  return zugriff.property.type === "Literal" ? zugriff.property.value : undefined;
}

export function schluesselName(eigenschaft) {
  if (eigenschaft.type !== "Property" || eigenschaft.computed) return undefined;
  return eigenschaft.key.type === "Identifier" ? eigenschaft.key.name : eigenschaft.key.value;
}
