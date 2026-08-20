// P8/FMT-28, Gegenmassnahme (3)/O10: KEIN Gate-Modul liest die Tenant-Zeitzone. Das
// Anrufzeit-Gate ist ausdruecklich ABGELEHNT (LAW-07). Strukturelle Absicherung statt
// Kommentar: ein rekursiver Quelltext-Scan nach /timezone|timeZone/ ueber src/ +
// src/db/schema.sql muss EXAKT der Allowlist der Module entsprechen, die die Zeitzone
// legitim beruehren (Datenmodell, Store, Prompt-Konsum). Ein neuer Treffer ausserhalb
// dieser Liste laesst den Test rot werden, statt still ein Gate zu bekommen.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.join(dir, "../src");
const TZ_PATTERN = /timezone|timeZone/;

// Relativ zu src/. Reihenfolge alphabetisch (Lesbarkeit).
const ALLOWED_FILES = [
  // 312k-Phase 5: reine Anzeige-Formatierung (Europe/Berlin) fuer die zwei Datums-
  // angaben in der Kuendigungsbestaetigungs-Mail - KEIN Anrufzeit-Gate, keine
  // Tenant-Zeitzone gelesen (billing/cancellation-mail.js nutzt Intl.DateTimeFormat
  // mit einer FESTEN Zeitzone, nicht store.tenantTimezone).
  "billing/cancellation-mail.js",
  "claude.js",
  "db/schema.sql",
  // ElevenLabs-Anrufweg (T7): dort spricht der Agent DES ANBIETERS und weiss nur, was der
  // Anrufstart ihm mitgibt - die Zeitzone reist deshalb als dynamische Variable mit
  // (outbound.js: owner_timezone/callee_timezone) und wird in time-context.js abgeleitet.
  // Reine ANZEIGE wie claude.js, kein Gate: keins der beiden Module entscheidet etwas,
  // sie beschreiben nur. Genau darum steht die Ableitung hier und nicht im Aufrufer -
  // routes/api-calls.js fuehrt die Gegenprobe unten (LAW-07).
  //
  // nanp-area-codes.js (T8) ist die Vorwahl-Tabelle, aus der bei +1 eine VERMUTETE Zone des
  // Angerufenen entsteht - reine Daten plus eine Nachschlage-Funktion, ohne Store, ohne
  // Config, ohne Entscheidung. Sie bestimmt nur, WIE sicher der Satz klingt, den der Agent
  // mitbekommt; kein Anruf wird davon zugelassen oder abgelehnt.
  "elevenlabs/nanp-area-codes.js",
  "elevenlabs/outbound.js",
  "elevenlabs/time-context.js",
  "geo/resolve.js",
  "store/defaults.js",
  "store/json.js",
  "store/pg.js",
  "store/state-ops.js",
  "web-auth.js",
].sort();

// Gate-nahe Module, die die Zeitzone explizit NICHT beruehren duerfen (Gegenprobe -
// falls eine dieser Dateien je einen Treffer bekommt, ist das der Anfang eines
// Anrufzeit-Gates, das der Owner abgelehnt hat).
const FORBIDDEN_FILES = [
  "telephony/outbound-gates.js",
  "routes/api-calls.js",
  "call-duration.js",
  "turn-budget.js",
  "telephony/call-finish.js",
];

function walk(root) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".sql")))
      out.push(full);
  }
  return out;
}

test("nur die erlaubten Module in src/ erwaehnen timezone/timeZone (LAW-07: kein Anrufzeit-Gate)", () => {
  const files = walk(SRC_ROOT);
  const hits = files
    .filter((file) => TZ_PATTERN.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC_ROOT, file))
    .sort();
  assert.deepEqual(
    hits,
    ALLOWED_FILES,
    "Ein neues Modul erwaehnt timezone/timeZone - Absichts-Pruefung noetig: reine Anzeige " +
      "(dann in ALLOWED_FILES ergaenzen) oder der Anfang eines Anrufzeit-Gates (LAW-07 " +
      "verbietet das, Owner-Auflage 7.6)",
  );
});

test("Gate-nahe Module bleiben zeitzonenfrei (Gegenprobe)", () => {
  for (const rel of FORBIDDEN_FILES) {
    const full = path.join(SRC_ROOT, rel);
    assert.ok(fs.existsSync(full), `erwartete Datei fehlt: src/${rel}`);
    assert.ok(
      !TZ_PATTERN.test(fs.readFileSync(full, "utf8")),
      `src/${rel} darf KEIN timezone/timeZone-Token tragen (LAW-07)`,
    );
  }
});
