// PA-19-Gate: scripts/*.mjs laufen NICHT unter npm test und sprechen echte Telnyx-/
// Stripe-APIs an. Dieser Test verifiziert AUSFUEHRUNGS-verifiziert (nicht nur per grep),
// dass jeder config-Zugriff in den migrierten Ops-Skripten auf einen gueltigen
// Namespace-Pfad zeigt: guardedConfig wirft bei falschem Blatt/Namespace TypeError.
// Zusaetzlich: 0 verbliebener flacher config.<flatKey>-Zugriff (die vor PA-12 bereits
// verschachtelten Gruppen telnyxElevenLabs/telnyxAssistant/elevenLabsPlayTts ausgenommen).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config, CONFIG_NAMESPACES } from "../src/config.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
// Die einzigen scripts/*.mjs, die src/config.js importieren (komment-bereinigter grep).
const SCRIPTS = [
  "scripts/telnyx-ws-echo.mjs",
  "scripts/telnyx-call-latency.mjs",
  "scripts/smoke-stripe-payment.mjs",
  "scripts/telnyx-assistant-provision.mjs",
];
// Vor PA-12 bereits verschachtelte Gruppen - in PA-19 bewusst flach adressiert belassen.
const NESTED_GROUPS = new Set(["telnyxElevenLabs", "telnyxAssistant", "elevenLabsPlayTts"]);
const NAMESPACES = new Set(Object.keys(CONFIG_NAMESPACES));

// Entfernt Block- und Zeilenkommentare (schuetzt "://"), damit Prosa-Erwaehnungen von
// config.<x> (z.B. "// config.claudeModel") nicht als Code-Zugriff gezaehlt werden.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}
// Lookbehind (?<![\w/]) schliesst Importpfade (src/config.js) und output_config.* aus.
const ACCESS_RE = /(?<![\w/])config\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g;

for (const rel of SCRIPTS) {
  test(`config-Zugriffe in ${rel} zeigen auf gueltige Namespace-Pfade`, () => {
    const code = stripComments(readFileSync(join(REPO, rel), "utf8"));
    let m;
    let checked = 0;
    while ((m = ACCESS_RE.exec(code))) {
      const [, first, second] = m;
      if (NESTED_GROUPS.has(first)) {
        assert.doesNotThrow(() => config[first][second], `${rel}: config.${first}.${second}`);
        checked++;
        continue;
      }
      // Jeder andere Zugriff MUSS namespaced sein: config.<ns>.<leaf>.
      assert.ok(NAMESPACES.has(first), `${rel}: nicht-migrierter/falscher Zugriff config.${first}`);
      assert.ok(second, `${rel}: config.${first} ohne Blatt (erwartet config.${first}.<leaf>)`);
      // guardedConfig wirft, falls <leaf> nicht in CONFIG_NAMESPACES[<ns>] -> falsches Blatt fliegt auf.
      assert.doesNotThrow(() => config[first][second], `${rel}: config.${first}.${second} existiert nicht`);
      checked++;
    }
    assert.ok(checked > 0, `${rel}: kein config-Zugriff gefunden (Datei-Liste veraltet?)`);
  });
}
