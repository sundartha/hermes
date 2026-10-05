import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { gespraechVergleichen } from "../../tools/deploy-weg/abdruck.mjs";
import { REPO_ROOT, commitAll, runIn } from "./probe-repo.js";

const VORLAGE = "elevenlabs/agent_configs/outbound-agent.template.json";
const VORLAGE_PROMPT_ELTERN = ["agent", "conversation_config", "agent", "prompt"];
const JSON_EINRUECKUNG = 2;
const FREMDZIEL_DEUTSCH = "anrufstart/de/fremd/consult-an";
const MISCHSPRACHE = "anrufstart/de-nach-fr/fremd/consult-aus";

const GESPRAECHSDATEIEN = [
  { datei: VORLAGE, teil: "vorlage/prompt", jsonEltern: VORLAGE_PROMPT_ELTERN, jsonFeld: "prompt", ersatz: " Probe." },
  { datei: "src/i18n/prompts/de.js", teil: "prompts/de/PROMPT_DE.goalLabel", anker: '"DEIN AUFTRAG:"', ersatz: '"DEIN AUFTRAG (Probe):"' },
  { datei: "src/i18n/prompts/en.js", teil: "prompts/en/PROMPT_EN.goalLabel", anker: '"YOUR TASK:"', ersatz: '"YOUR TASK (probe):"' },
  { datei: "src/i18n/prompts/fr.js", teil: "prompts/fr/PROMPT_FR.goalLabel", anker: '"TA MISSION :"', ersatz: '"TA MISSION (sonde) :"' },
  {
    datei: "src/i18n/locales.js",
    teil: "locales/de.openingQuestion",
    anker: 'openingQuestion: "Wie sieht es damit aus?"',
    ersatz: 'openingQuestion: "Wie sieht es damit aus, bitte?"',
  },
  {
    datei: "src/telephony/adapters/telnyx/elevenlabs-voice.js",
    teil: "stimmen",
    anker: '"cqPdIo76zSHFDcSZpFov"',
    ersatz: '"cqPdIo76zSHFDcSZpFoX"',
  },
  {
    datei: "src/elevenlabs/outbound.js",
    teil: FREMDZIEL_DEUTSCH,
    anker: 'const GATE_AVAILABLE = "available";',
    ersatz: 'const GATE_AVAILABLE = "available-probe";',
  },
  {
    datei: "src/elevenlabs/call-locale.js",
    teil: MISCHSPRACHE,
    anker: "language: gespraech.language,",
    ersatz: "language: offenlegung.language,",
  },
  {
    datei: "src/store/state-ops.js",
    teil: MISCHSPRACHE,
    anker: "numberRecord?.language || tenant?.defaultLanguage || DEFAULT_LANGUAGE",
    ersatz: "numberRecord?.language || DEFAULT_LANGUAGE",
  },
  {
    datei: "src/elevenlabs/opening-line.js",
    teil: FREMDZIEL_DEUTSCH,
    anker: "`${reason} ${locale.openingQuestion}`",
    ersatz: "`${reason} - ${locale.openingQuestion}`",
  },
  {
    datei: "src/elevenlabs/time-context.js",
    teil: FREMDZIEL_DEUTSCH,
    anker: "const ownerZone = resolveTimezone(tenantTimezone);",
    ersatz: 'const ownerZone = resolveTimezone("Asia/Tokyo");',
  },
  {
    datei: "src/elevenlabs/convai.js",
    teil: FREMDZIEL_DEUTSCH,
    anker: 'const OUTBOUND_CALL_PATH = "/v1/convai/sip-trunk/outbound-call";',
    ersatz: 'const OUTBOUND_CALL_PATH = "/v1/convai/sip-trunk/outbound-call-probe";',
  },
  {
    datei: "src/elevenlabs/inbound-initiation.js",
    teil: "eingangsstart/de/fremd",
    anker: 'voicemail_line: "",',
    ersatz: 'voicemail_line: "Probe",',
  },
  {
    datei: "src/i18n/inbound-opening.js",
    teil: "fehler:neu",
    anker: 'return soll === "" || !text.startsWith(soll);',
    ersatz: 'return soll === "" || text.startsWith(soll);',
  },
];

const ANDERE_DATEIEN = [
  { datei: "README.md", anker: "", ersatz: "Probe-Zeile ohne Wirkung auf das Gespraech.\n" },
  { datei: "src/elevenlabs/outbound.js", anker: "", ersatz: "// Probe-Kommentar ohne Wirkung auf das Gespraech\n" },
];

function git(verzeichnis, argumente) {
  const lauf = runIn(verzeichnis, "git", argumente);
  assert.equal(lauf.status, 0, `git ${argumente.join(" ")}: ${lauf.stderr}`);
  return lauf.stdout.trim();
}

function tempKlon(context) {
  const ordner = mkdtempSync(join(tmpdir(), "abdruck-rotprobe-"));
  context.after(() => rmSync(ordner, { recursive: true, force: true }));
  const klon = join(ordner, "klon");
  git(ordner, ["clone", "--quiet", "--shared", REPO_ROOT, klon]);
  const module = join(REPO_ROOT, "node_modules");
  if (existsSync(module)) symlinkSync(module, join(klon, "node_modules"));
  return { klon, basis: git(klon, ["rev-parse", "HEAD"]) };
}

function aendern(klon, probe) {
  const pfad = join(klon, probe.datei);
  const inhalt = readFileSync(pfad, "utf8");
  if (probe.jsonEltern) {
    const daten = JSON.parse(inhalt);
    const eltern = probe.jsonEltern.reduce((knoten, schluessel) => knoten[schluessel], daten);
    eltern[probe.jsonFeld] = `${eltern[probe.jsonFeld]}${probe.ersatz}`;
    writeFileSync(pfad, `${JSON.stringify(daten, null, JSON_EINRUECKUNG)}\n`);
    return;
  }
  if (probe.anker === "") {
    writeFileSync(pfad, `${probe.ersatz}${inhalt}`);
    return;
  }
  assert.ok(inhalt.includes(probe.anker), `Anker fehlt in ${probe.datei}, die Rot-Probe muss nachgezogen werden`);
  writeFileSync(pfad, inhalt.replace(probe.anker, probe.ersatz));
}

async function vergleicheMitAenderung({ klon, basis }, probe) {
  git(klon, ["checkout", "--quiet", "--detach", basis]);
  aendern(klon, probe);
  commitAll(klon, `Probe ${probe.datei}`);
  const neu = git(klon, ["rev-parse", "HEAD"]);
  return gespraechVergleichen({ repoDir: klon, alt: basis, neu });
}

test("Abdruck-Rot-Probe: jede Aenderung an einer gespraechsrelevanten Datei wird gemeldet", async (kontext) => {
  const stand = tempKlon(kontext);

  const ohneAenderung = await gespraechVergleichen({ repoDir: stand.klon, alt: stand.basis, neu: stand.basis });
  assert.deepEqual(ohneAenderung, { geaendert: false, teile: [] });

  for (const probe of GESPRAECHSDATEIEN) {
    const ergebnis = await vergleicheMitAenderung(stand, probe);
    assert.equal(ergebnis.geaendert, true, `${probe.datei}: Aenderung nicht gemeldet`);
    assert.ok(ergebnis.teile.includes(probe.teil), `${probe.datei}: erwartet ${probe.teil}, gemeldet ${ergebnis.teile.join(", ")}`);
    if (probe.teil !== "fehler:neu") {
      assert.ok(!ergebnis.teile.some((teil) => teil.startsWith("fehler:")), `${probe.datei}: ${ergebnis.teile.join(", ")}`);
    }
  }
});

test("Abdruck-Rot-Probe: Aenderungen ohne Wirkung auf das Gespraech bleiben stumm", async (kontext) => {
  const stand = tempKlon(kontext);

  for (const probe of ANDERE_DATEIEN) {
    const ergebnis = await vergleicheMitAenderung(stand, probe);
    assert.deepEqual(ergebnis, { geaendert: false, teile: [] }, `${probe.datei}: ${ergebnis.teile.join(", ")}`);
  }
});
