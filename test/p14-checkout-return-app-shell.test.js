import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { APP_PATH, CHECKOUT_RETURN, LEGACY_PORTAL_PATH } from "../src/portal-paths.js";

const BILLING_ISLAND = path.join(ROOT, "apps/web/src/components/app/BillingIsland.astro");
const SRC_DIR = path.join(ROOT, "src");
const SOURCE_EXTENSIONS = [".js", ".mjs"];

function returnTarget(pathWithQuery) {
  const [pathname, search] = pathWithQuery.split("?");
  const [param, value] = (search || "").split("=");
  return { pathname, param, value };
}

function shellReturnConstants(source) {
  const out = new Map();
  for (const m of source.matchAll(/const (RETURN_\w+) = "([^"]+)";/g)) out.set(m[2], m[1]);
  return out;
}

function returnMessageBody(source) {
  const m = source.match(/function returnMessageText\(([^)]*)\)\s*\{([\s\S]*?)\n {2}\}/);
  assert.ok(m, "returnMessageText() nicht in der App-Shell gefunden");
  return { params: m[1].split(",").map((p) => p.trim()), body: m[2] };
}

function sourceFilesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFilesUnder(full));
    else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name)))
      out.push({ file: full, source: fs.readFileSync(full, "utf8") });
  }
  return out;
}

test("P14: public/tenant.html existiert nicht mehr", () => {
  assert.equal(
    fs.existsSync(path.join(ROOT, "public/tenant.html")),
    false,
    "das alte Kunden-Dashboard ist geloescht (Owner-Entscheidung 2026-07-27)",
  );
});

test("P14: jede Stripe-Rueckkehr-Adresse zeigt auf die App-Shell", () => {
  const targets = Object.entries(CHECKOUT_RETURN);
  assert.ok(targets.length > 0, "CHECKOUT_RETURN darf nicht leer sein");
  for (const [name, target] of targets) {
    const { pathname, param, value } = returnTarget(target);
    assert.equal(pathname, APP_PATH, `${name} zeigt nicht auf die App-Shell`);
    assert.match(param, /^(card|sub)$/, `${name}: unerwarteter Parametername "${param}"`);
    assert.ok(value, `${name}: Rueckkehr-Adresse ohne Wert`);
  }
});

test("P14: die App-Shell wertet jeden Rueckkehr-Parameter aus (PM-6)", () => {
  const shell = fs.readFileSync(BILLING_ISLAND, "utf8");
  const constants = shellReturnConstants(shell);
  const { params, body } = returnMessageBody(shell);

  for (const [name, target] of Object.entries(CHECKOUT_RETURN)) {
    const { param, value } = returnTarget(target);
    const paramConst = constants.get(param);
    assert.ok(paramConst, `${name}: die Shell kennt den Parameter "${param}" nicht`);
    assert.match(paramConst, /^RETURN_PARAM_/, `${name}: "${param}" ist keine Parameter-Konstante`);
    assert.match(
      shell,
      new RegExp(`params\\.get\\(${paramConst}\\)`),
      `${name}: die Shell liest ${paramConst} nicht aus der Query`,
    );
    const valueConst = constants.get(value);
    assert.ok(valueConst, `${name}: die Shell kennt den Wert "${value}" nicht`);
    const arg = params[param === "card" ? 0 : 1];
    assert.match(
      body,
      new RegExp(`${arg} === ${valueConst}\\b`),
      `${name}: kein Zweig "${arg} === ${valueConst}" - der Fall bleibt fuer den Kunden stumm`,
    );
  }
});

test("P14: kein Server-Ziel zeigt mehr auf das geloeschte Dashboard", () => {
  const hits = sourceFilesUnder(SRC_DIR)
    .flatMap(({ file, source }) =>
      [...source.matchAll(/"\/tenant\.html[^"]*"/g)].map(() => path.relative(ROOT, file)),
    );
  assert.deepEqual(
    hits,
    ["src/portal-paths.js"],
    `das Pfad-Literal "${LEGACY_PORTAL_PATH}" darf NUR als LEGACY_PORTAL_PATH vorkommen (Altpfad-Redirect)`,
  );
});
