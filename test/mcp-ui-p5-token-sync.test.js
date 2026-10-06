import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";

import { checkTokens, writeTokenLock } from "../scripts/check-token-sync.js";

const TOKEN_DIR_REL = "apps/web/src/styles/tokens";
const COPY_DIR_REL = "design-system/tokens";
const SHARED_DIR_REL = "design-system/_shared";
const MOCKUP_DIR_REL = "design-system/mcp";
const WIDGET_DIR_REL = "src/ui/widgets";
const LOCK_REL = `${SHARED_DIR_REL}/tokens.lock`;
const MOCKUP_REL = `${MOCKUP_DIR_REL}/x.html`;
const WIDGET_REL = `${WIDGET_DIR_REL}/w.html`;
const PRIMITIVES_REL = `${TOKEN_DIR_REL}/primitives.css`;
const COPY_PRIMITIVES_REL = `${COPY_DIR_REL}/primitives.css`;

let tmpDirs = [];

function writeFile(root, rel, content) {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

function makeSyncedFixture() {
  const root = mkdtempSync(join(tmpdir(), "token-sync-"));
  tmpDirs.push(root);
  writeFile(root, PRIMITIVES_REL, ":root{--c:#fff;}\n");
  writeFile(root, `${TOKEN_DIR_REL}/semantic.css`, ":root{--a:var(--c);}\n");
  writeFile(root, `${TOKEN_DIR_REL}/hero.css`, ":root{--h:#000;}\n");
  writeFile(root, COPY_PRIMITIVES_REL, ":root{--c:#fff;}\n");
  writeFile(root, `${COPY_DIR_REL}/semantic.css`, ":root{--a:#fff;}\n");
  writeFile(root, `${COPY_DIR_REL}/dark.css`, ".on-dark{--h:#000;}\n");
  writeFile(root, MOCKUP_REL, "<!-- @dsCard name=\"x\" -->\n<div>x</div>\n");
  writeFile(root, WIDGET_REL, "<style>.w{color:#fff;}</style>\n");
  writeTokenLock({ rootDir: root });
  return root;
}

afterEach(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

describe("check-token-sync gate", () => {
  it("(a) echtes Repo ist baseline-gruen (read-only)", () => {
    const { ok, problems } = checkTokens({});
    assert.equal(ok, true, `unerwartete Probleme: ${problems.join(" | ")}`);
  });

  it("(a') synchrone Fixture ist gruen", () => {
    const root = makeSyncedFixture();
    assert.equal(checkTokens({ rootDir: root }).ok, true);
  });

  it("(b) verfaelschte Kopie -> Drift nennt die Katalog-Kopie", () => {
    const root = makeSyncedFixture();
    writeFile(root, COPY_PRIMITIVES_REL, ":root{--c:#fff;}\nx");
    const { ok, problems } = checkTokens({ rootDir: root });
    assert.equal(ok, false);
    assert.ok(
      problems.some(
        (p) => p.includes(COPY_PRIMITIVES_REL) && p.includes("driftet"),
      ),
    );
  });

  it("(b') verfaelschte Quelle -> Drift nennt die Quell-Datei", () => {
    const root = makeSyncedFixture();
    writeFile(root, PRIMITIVES_REL, ":root{--c:#000;}\n");
    const { ok, problems } = checkTokens({ rootDir: root });
    assert.equal(ok, false);
    assert.ok(
      problems.some((p) => p.includes(PRIMITIVES_REL) && p.includes("driftet")),
    );
  });

  it("(c) @import im Widget -> Problem nennt Datei + @import", () => {
    const root = makeSyncedFixture();
    writeFile(root, WIDGET_REL, "@import url('x.css');\n<style></style>\n");
    const { ok, problems } = checkTokens({ rootDir: root });
    assert.equal(ok, false);
    assert.ok(problems.some((p) => p.includes("w.html") && p.includes("@import")));
  });

  it("(c') @dsCard nicht in Zeile 1 -> Marker-Problem", () => {
    const root = makeSyncedFixture();
    writeFile(root, MOCKUP_REL, "<div>kein marker</div>\n<!-- @dsCard -->\n");
    const { ok, problems } = checkTokens({ rootDir: root });
    assert.equal(ok, false);
    assert.ok(problems.some((p) => p.includes("x.html") && p.includes("@dsCard")));
  });

  it("(d) Pflichtdatei fehlt -> fail-closed", () => {
    const root = makeSyncedFixture();
    rmSync(join(root, COPY_PRIMITIVES_REL));
    assert.equal(existsSync(join(root, COPY_PRIMITIVES_REL)), false);
    assert.equal(checkTokens({ rootDir: root }).ok, false);
  });

  it("(d') fehlende Kopie -> einheitliche fail-closed-Meldung", () => {
    const root = makeSyncedFixture();
    rmSync(join(root, COPY_PRIMITIVES_REL));
    const { ok, problems } = checkTokens({ rootDir: root });
    assert.equal(ok, false);
    assert.ok(
      problems.some(
        (p) =>
          p.includes("Datei fehlt (fail-closed)") &&
          p.includes(COPY_PRIMITIVES_REL),
      ),
      `erwartete fail-closed-Meldung fehlt: ${problems.join(" | ")}`,
    );
  });

  it("(e) Lock fehlt -> fail-closed", () => {
    const root = makeSyncedFixture();
    rmSync(join(root, LOCK_REL));
    assert.equal(checkTokens({ rootDir: root }).ok, false);
  });
});
