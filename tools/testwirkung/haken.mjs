import { builtinModules } from "node:module";

const ATTRAPPE = "testwirkung-attrappe:";
const ZIELE = new Set(["assert", "assert/strict"]);
const KNOTEN = "node:";
const NACHBAU = new URL("attrappe.mjs", import.meta.url).href;

function ziel(specifier) {
  const name = specifier.startsWith(KNOTEN) ? specifier.slice(KNOTEN.length) : specifier;
  return ZIELE.has(name) && builtinModules.includes(name) ? name : undefined;
}

function quelltext(name) {
  const schluessel = Object.keys(process.getBuiltinModule(name));
  const exporte = schluessel.map((eintrag) => `export const ${eintrag} = attrappe[${JSON.stringify(eintrag)}];`);
  return [
    `import { attrappeVon } from ${JSON.stringify(NACHBAU)};`,
    `const attrappe = attrappeVon(${JSON.stringify(name)});`,
    "export default attrappe;",
    ...exporte,
  ].join("\n");
}

export function resolve(specifier, context, nextResolve) {
  const name = ziel(specifier);
  if (name === undefined) return nextResolve(specifier, context);
  return { url: `${ATTRAPPE}${name}`, shortCircuit: true };
}

export function load(url, context, nextLoad) {
  if (!url.startsWith(ATTRAPPE)) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: quelltext(url.slice(ATTRAPPE.length)) };
}
