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
