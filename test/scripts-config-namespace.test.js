import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config, CONFIG_NAMESPACES } from "../src/config.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = [
  "scripts/telnyx-call-latency.mjs",
  "scripts/smoke-stripe-payment.mjs",
  "scripts/el-nummern-registrierung.mjs",
];
const NESTED_GROUPS = new Set(["telnyxElevenLabs", "elevenLabsPlayTts"]);
const NAMESPACES = new Set(Object.keys(CONFIG_NAMESPACES));

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}
const ACCESS_RE = /(?<![\w/])config\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g;

for (const rel of SCRIPTS) {
  test(`config-Zugriffe in ${rel} zeigen auf gueltige Namespace-Pfade`, () => {
    const code = stripComments(readFileSync(join(REPO, rel), "utf8"));
    let checked = 0;
    for (const m of code.matchAll(ACCESS_RE)) {
      const [, first, second] = m;
      if (NESTED_GROUPS.has(first)) {
        assert.doesNotThrow(() => config[first][second], `${rel}: config.${first}.${second}`);
        checked++;
        continue;
      }
      assert.ok(NAMESPACES.has(first), `${rel}: nicht-migrierter/falscher Zugriff config.${first}`);
      assert.ok(second, `${rel}: config.${first} ohne Blatt (erwartet config.${first}.<leaf>)`);
      assert.doesNotThrow(() => config[first][second], `${rel}: config.${first}.${second} existiert nicht`);
      checked++;
    }
    assert.ok(checked > 0, `${rel}: kein config-Zugriff gefunden (Datei-Liste veraltet?)`);
  });
}

test("ACCESS_RE-Iteration mutiert bei einem Abbruch nicht den geteilten Regex-Zustand", () => {
  assert.equal(ACCESS_RE.lastIndex, 0, "Vorbedingung: ACCESS_RE ist zwischen Testfaellen unbenutzt (lastIndex 0)");

  const snippetWithAbort = "config.telnyx.apiKey config.stripe.secretKey config.broken.leaf";
  assert.throws(() => {
    for (const m of snippetWithAbort.matchAll(ACCESS_RE)) {
      if (m[2] === "leaf") throw new Error("simulierter Assertion-Abbruch mitten im Scan");
    }
  });
  assert.equal(
    ACCESS_RE.lastIndex,
    0,
    "ACCESS_RE.lastIndex darf nach einem Abbruch nicht auf einem Byte-Offset > 0 stehen bleiben",
  );

  const nextSnippet = "config.claude.model config.smsCap.perDay";
  const found = [...nextSnippet.matchAll(ACCESS_RE)].map((m) => `${m[1]}.${m[2]}`);
  assert.deepEqual(found, ["claude.model", "smsCap.perDay"]);
});
