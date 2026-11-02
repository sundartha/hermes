import { probeRepository, writeFiles } from "./probe-repo.js";

const KOPF = "export function seite(eintraege, offset, tenant, besitzer) {";
export const TENANT = "  if (tenant !== besitzer) return { status: 403 };";
export const OFFSET = '  if (!/^\\d+$/.test(offset)) return { status: 400, fehler: "offset" };';
export const ALTE_SEITE = "  return { status: 200, eintraege: eintraege.slice(offset) };";
export const NEUE_SEITE = "  return { status: 200, eintraege: eintraege.slice(Number(offset)) };";
export const NORMAL = 'test("normal", () => assert.deepEqual(seite(L, "1", "t", "t").eintraege, ["b", "c"]));';
export const NEGATIV = 'test("negatives offset ist 400", () => assert.equal(seite(L, "-1", "t", "t").status, 400));';
export const OHNE_WIRKUNG = 'test("[NIE1] offset 1.5 liefert keine Seite", () => assert.notDeepEqual(seite(L, "1.5", "t", "t").eintraege, "a"));';
export const MIT_WIRKUNG = 'test("[NIE1] offset x20 ist 400", () => assert.equal(seite(L, "x20", "t", "t").status, 400));';
export const FREMDER_TENANT = 'test("[NIE1] fremder Tenant bekommt 403", () => assert.equal(seite(L, "0", "t", "u").status, 403));';
export const FREMDE_EINTRAEGE = 'test("[NIE1] fremder Tenant sieht keine Einträge", () => assert.equal(seite(L, "0", "t", "u").eintraege, undefined));';

export const ZWEITE_OHNE_WIRKUNG = 'test("[NIE3] offset 2.5 liefert keine Seite", () => assert.notDeepEqual(seite(L, "2.5", "t", "t").eintraege, "a"));';
export const ZWEITE_MIT_WIRKUNG = 'test("[NIE2] offset a ist 400", () => assert.equal(seite(L, "a", "t", "t").status, 400));';
const ZWEISTELLIG = 'test("zweistelliges offset", () => assert.deepEqual(seite(L, "10", "t", "t").eintraege, []));';
const ZEICHEN_VOR = 'test("Zeichen vor der Zahl", () => assert.deepEqual(seite(L, "x1", "t", "t"), { status: 400, fehler: "offset" }));';
const ZEICHEN_NACH = 'test("Zeichen nach der Zahl", () => assert.equal(seite(L, "1x", "t", "t").status, 400));';
export const ALLGEMEIN = [NEGATIV, ZWEISTELLIG, ZEICHEN_VOR, ZEICHEN_NACH];

export function quelle(...zeilen) {
  return [KOPF, ...zeilen, "}", ""].join("\n");
}

export function seitentest(...faelle) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { seite } from "../src/seite.js";',
    'const L = ["a", "b", "c"];',
    ...faelle,
    "",
  ].join("\n");
}

export function geaendert(context, quelltext, ...faelle) {
  const repo = probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    "src/seite.js": quelle(TENANT, ALTE_SEITE),
    "test/seite.test.js": seitentest(NORMAL),
  });
  writeFiles(repo, { "src/seite.js": quelltext, "test/seite.test.js": seitentest(NORMAL, ...faelle) });
  return repo;
}

export const UNVERAENDERTE_MANDANTENZEILE = 3;
export const GEAENDERTE_OFFSET_ZEILE = 2;
