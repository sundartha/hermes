import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";

import { Linter } from "eslint";

const COMMONJS = /\.cjs$/;
const RELATIV = /^\.{1,2}\//;
const ANHANG = /[?#].*$/s;
const NACH_OBEN = /^\.\.(?:\/|$)/;
const MAX_TIEFE = 8;
const DYNAMISCHER_IMPORT = "import(";

export function syntaxknoten(datei, text) {
  const linter = new Linter();
  const sourceType = COMMONJS.test(datei) ? "commonjs" : "module";
  const meldungen = linter.verify(text, { languageOptions: { ecmaVersion: "latest", sourceType } });
  if (meldungen.some(({ fatal }) => fatal)) return undefined;
  const { ast, visitorKeys } = linter.getSourceCode();
  const gefunden = [];
  const offen = [ast];
  while (offen.length > 0) {
    const knoten = offen.pop();
    gefunden.push(knoten);
    for (const schluessel of visitorKeys[knoten.type] ?? []) {
      offen.push(...[knoten[schluessel]].flat().filter(Boolean));
    }
  }
  return gefunden;
}

function konstanten(knoten) {
  const bindungen = new Map();
  const deklarationen = knoten.filter(({ type }) => type === "VariableDeclaration");
  for (const { kind, declarations } of deklarationen) {
    for (const { id, init } of declarations) {
      if (id.type !== "Identifier") continue;
      const eindeutig = kind === "const" && init && !bindungen.has(id.name);
      bindungen.set(id.name, eindeutig ? init : null);
    }
  }
  return bindungen;
}

function vorTeil(text) {
  return text.replace(ANHANG, "");
}

function vorlage({ quasis, expressions }) {
  const [erster] = quasis;
  const roh = erster.value.cooked ?? "";
  if (expressions.length === 0) return roh;
  const ende = roh.search(ANHANG);
  return ende === -1 ? undefined : roh.slice(0, ende);
}

function istImportMetaUrl(knoten) {
  return (
    knoten?.type === "MemberExpression" &&
    knoten.object.type === "MetaProperty" &&
    knoten.object.meta.name === "import" &&
    knoten.object.property.name === "meta" &&
    !knoten.computed &&
    knoten.property.name === "url"
  );
}

function eigenschaftsname(knoten) {
  if (!knoten.computed && knoten.property.type === "Identifier") return knoten.property.name;
  if (knoten.property.type === "Literal") return String(knoten.property.value);
  return undefined;
}

function objektLiteral(knoten, bindungen, tiefe) {
  if (tiefe > MAX_TIEFE || !knoten) return undefined;
  if (knoten.type === "ObjectExpression") return knoten;
  if (knoten.type === "Identifier") {
    return objektLiteral(bindungen.get(knoten.name), bindungen, tiefe + 1);
  }
  const eingefroren =
    knoten.type === "CallExpression" &&
    knoten.callee.type === "MemberExpression" &&
    knoten.callee.object.name === "Object" &&
    eigenschaftsname(knoten.callee) === "freeze";
  return eingefroren ? objektLiteral(knoten.arguments[0], bindungen, tiefe + 1) : undefined;
}

function eigenschaft(objekt, name) {
  return objekt.properties.find(
    (feld) =>
      feld.type === "Property" &&
      feld.kind === "init" &&
      !feld.computed &&
      (feld.key.name ?? String(feld.key.value)) === name,
  )?.value;
}

function urlZiel(knoten, bindungen, tiefe) {
  const [ziel, basis] = knoten.arguments;
  if (knoten.callee.name !== "URL" || !istImportMetaUrl(basis)) return undefined;
  const pfad = aufgeloest(ziel, bindungen, tiefe + 1)?.pfad;
  return pfad === undefined ? undefined : { pfad, relativ: true };
}

function neueUrl(knoten, bindungen) {
  const wert = knoten.type === "Identifier" ? bindungen.get(knoten.name) : knoten;
  return wert?.type === "NewExpression" ? wert : undefined;
}

function mitglied(knoten, bindungen, tiefe) {
  const name = eigenschaftsname(knoten);
  if (name === undefined) return undefined;
  const url = neueUrl(knoten.object, bindungen);
  if (url && name === "href") return urlZiel(url, bindungen, tiefe);
  const objekt = objektLiteral(knoten.object, bindungen, tiefe + 1);
  return objekt ? aufgeloest(eigenschaft(objekt, name), bindungen, tiefe + 1) : undefined;
}

function aufgeloest(knoten, bindungen, tiefe = 0) {
  if (tiefe > MAX_TIEFE || !knoten) return undefined;
  const pfad = (text) => (text === undefined ? undefined : { pfad: vorTeil(text), relativ: false });
  switch (knoten.type) {
    case "Literal":
      return typeof knoten.value === "string" ? pfad(knoten.value) : undefined;
    case "TemplateLiteral":
      return pfad(vorlage(knoten));
    case "Identifier":
      return aufgeloest(bindungen.get(knoten.name), bindungen, tiefe + 1);
    case "MemberExpression":
      return mitglied(knoten, bindungen, tiefe);
    case "NewExpression":
      return urlZiel(knoten, bindungen, tiefe);
    default:
      return undefined;
  }
}

function zielDatei(datei, { pfad, relativ }) {
  if (!relativ && !RELATIV.test(pfad)) return undefined;
  const ziel = posix.normalize(posix.join(posix.dirname(datei), pfad));
  return NACH_OBEN.test(ziel) || !existsSync(ziel) ? undefined : ziel;
}

export function dynamischeZiele(datei) {
  if (!existsSync(datei)) return [];
  const text = readFileSync(datei, "utf8");
  if (!text.includes(DYNAMISCHER_IMPORT)) return [];
  const knoten = syntaxknoten(datei, text) ?? [];
  const bindungen = konstanten(knoten);
  const importe = knoten.filter(({ type }) => type === "ImportExpression");
  const pfade = importe.map(({ source }) => aufgeloest(source, bindungen)).filter(Boolean);
  const ziele = pfade.map((ziel) => zielDatei(datei, ziel)).filter(Boolean);
  return [...new Set(ziele)].sort();
}
