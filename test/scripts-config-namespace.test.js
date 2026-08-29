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
  // OUTBOUND-E4: ohne diesen Eintrag erfasst dieses Gate das neue Skript GAR NICHT und
  // bliebe gruen, ohne etwas zu pruefen (Plan-Auftrag, woertlich).
  "scripts/check-outbound-drift.mjs",
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
    let checked = 0;
    // matchAll() iteriert auf einem internen Klon von ACCESS_RE (die Regex wird bei jedem
    // Aufruf per String.prototype.matchAll kopiert) - ein throw waehrend der Iteration
    // (z.B. eine fehlschlagende Assertion) mutiert daher NIE das geteilte Modul-Regex-Objekt.
    // Mit dem alten ACCESS_RE.exec()-while-Loop bliebe lastIndex bei einem Abbruch auf dem
    // Abbruch-Offset stehen und der naechste, unabhaengige Testfall wuerde ab dieser Stelle
    // statt ab Dateianfang scannen (F.I.R.S.T./Independence-Verstoss).
    for (const m of code.matchAll(ACCESS_RE)) {
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

// Regression fuer P12-Blocker (Runde 1): das modulweite ACCESS_RE darf durch einen
// Abbruch (throw) mitten in einer Iteration nicht beschaedigt werden - sonst wuerde ein
// scheiternder Test in der Schleife oben den lastIndex-Zustand an den naechsten,
// unabhaengigen test()-Fall durchreichen (geteilter Mutable-State zwischen Faellen).
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

  // Ein nachfolgender, unabhaengiger Scan (wie der naechste test()-Fall in der Suite)
  // muss trotz des vorherigen Abbruchs wieder vollstaendig ab Dateianfang funktionieren.
  const nextSnippet = "config.claude.model config.smsCap.perDay";
  const found = [...nextSnippet.matchAll(ACCESS_RE)].map((m) => `${m[1]}.${m[2]}`);
  assert.deepEqual(found, ["claude.model", "smsCap.perDay"]);
});
