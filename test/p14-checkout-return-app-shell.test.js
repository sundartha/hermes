// GATES-P14 (PM-6, eigene Abnahmebedingung): (1) public/tenant.html ist geloescht,
// (2) JEDE Stripe-Rueckkehr-Adresse zeigt auf die App-Shell, (3) die App-Shell wertet
// GENAU diese Parameter aus. Der dritte Punkt ist der eigentliche Schutz: eine
// EINSEITIGE Umbenennung (Server-Ziel ODER Shell-Handler) kann diesen Test nicht
// bestehen - dieselbe Pre-Mortem-Mechanik wie der frueher in p15b-... geloeste
// formatLocale-Feldnamen-Test.
//
// Der Altpfad-Redirect /tenant.html -> /app (inkl. Query-Erhalt) braucht hier KEINEN
// eigenen Test: test/single-origin-serving.test.js deckt ihn bereits ab, ein zweiter
// waere Duplizierung (G5).
//
// Reiner Quelltext-/Modul-Test: offline, kein Spawn, kein Build (apps/web/dist ist
// gitignored - gelesen wird apps/web/src/; Praezedenz test/dashboard-i18n-surface.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { APP_PATH, CHECKOUT_RETURN, LEGACY_PORTAL_PATH } from "../src/portal-paths.js";

const BILLING_ISLAND = path.join(ROOT, "apps/web/src/components/app/BillingIsland.astro");
const SRC_DIR = path.join(ROOT, "src");
const SOURCE_EXTENSIONS = [".js", ".mjs"];

// "/app?card=ok" -> { param: "card", value: "ok" }. Reiner Parser, kein Nebeneffekt.
function returnTarget(pathWithQuery) {
  const [pathname, search] = pathWithQuery.split("?");
  const [param, value] = (search || "").split("=");
  return { pathname, param, value };
}

// Alle `const RETURN_X = "y";` der Shell als Map "y" -> "RETURN_X" (die Shell haelt jeden
// Parameternamen und jeden Wert als benannte Konstante - genau das nutzt der Abgleich).
function shellReturnConstants(source) {
  const out = new Map();
  for (const m of source.matchAll(/const (RETURN_\w+) = "([^"]+)";/g)) out.set(m[2], m[1]);
  return out;
}

// Rumpf von returnMessageText(...) - die EINE Stelle, an der die Shell die Parameter
// auswertet (showReturnMessage reicht ihr die beiden Query-Werte herein).
function returnMessageBody(source) {
  const m = source.match(/function returnMessageText\(([^)]*)\)\s*\{([\s\S]*?)\n {2}\}/);
  assert.ok(m, "returnMessageText() nicht in der App-Shell gefunden");
  return { params: m[1].split(",").map((p) => p.trim()), body: m[2] };
}

// Alle Quelldateien unter dir (rekursiv) als {file, source}. Reiner Read.
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
    // (a) der Parametername ist eine benannte Konstante der Shell (RETURN_PARAM_*) ...
    const paramConst = constants.get(param);
    assert.ok(paramConst, `${name}: die Shell kennt den Parameter "${param}" nicht`);
    assert.match(paramConst, /^RETURN_PARAM_/, `${name}: "${param}" ist keine Parameter-Konstante`);
    // ... und wird in showReturnMessage aus der Query gelesen.
    assert.match(
      shell,
      new RegExp(`params\\.get\\(${paramConst}\\)`),
      `${name}: die Shell liest ${paramConst} nicht aus der Query`,
    );
    // (b) der Wert ist eine benannte Konstante ...
    const valueConst = constants.get(value);
    assert.ok(valueConst, `${name}: die Shell kennt den Wert "${value}" nicht`);
    // (c) ... und es gibt einen Zweig, der GENAU diesen Parameter gegen sie prueft.
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
