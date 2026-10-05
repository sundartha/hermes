import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { gespraechVergleichen } from "../../tools/deploy-weg/abdruck.mjs";
import { REPO_ROOT, commitAll, isolatedEnvironment, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const ABDRUCK_MODUL = join(REPO_ROOT, "tools/deploy-weg/abdruck.mjs");
const AUSGABE_MARKE = "ATTRAPPE-INHALT";
const UNBEKANNTER_COMMIT = "0000000000000000000000000000000000000000";
const JSON_EINRUECKUNG = 2;

const ANRUFSTART = `export function makeElevenLabsOutbound({ store, config, consultAllowedForCall }) {
  return {
    async originateCall(call) {
      console.log("${AUSGABE_MARKE} auf stdout");
      console.error("${AUSGABE_MARKE} auf stderr");
      process.stdout.write("${AUSGABE_MARKE} direkt auf stdout\\n");
      process.stderr.write("${AUSGABE_MARKE} direkt auf stderr\\n");
      const antwort = await fetch(config.voice.elevenLabsOutbound.apiBase + "/v1/start", {
        method: "POST",
        body: JSON.stringify({
          an: call.to,
          sprache: call.language ?? null,
          consult: consultAllowedForCall(call),
          zeitpunkt: new Date().toISOString(),
          inhaber: store.tenantContext(call.tenantId).ownerName,
        }),
      });
      store.recordElevenlabsConversationId(call.id, (await antwort.json()).conversation_id);
    },
  };
}
`;

const EINGANGSSTART = `export function buildInitiationResponse({ call }) {
  return { dynamic_variables: { today: String(process.hrtime.bigint()), sprache: call.language } };
}
`;

const PROMPT_DE = `export const PROMPT_DE = Object.freeze({
  persona: (name) => \`Ich bin \${name}.\`,
  goalLabel: "DEIN AUFTRAG:",
});
`;

const LOCALES = `import { PROMPT_DE } from "./prompts/de.js";
export const LOCALES = Object.freeze({
  de: Object.freeze({ openingQuestion: "Wie sieht es damit aus?", prompt: PROMPT_DE, mcp: { hinweis: "nie gesprochen" } }),
});
`;

const STIMMEN = `export const ELEVENLABS_VOICE_ID_BY_PROFILE = Object.freeze({ "de-female-neural": "stimme-de" });
`;

const VORLAGE = `${JSON.stringify(
  {
    _besitz: { felder: [{ feld: "prompt", art: "wert", vorlage: ["agent.prompt"] }] },
    agent: { prompt: "Sei freundlich." },
  },
  null,
  JSON_EINRUECKUNG,
)}\n`;

const ATTRAPPE = {
  "package.json": '{ "type": "module" }\n',
  "README.md": "Wegwerf-Repo\n",
  "src/elevenlabs/outbound.js": ANRUFSTART,
  "src/elevenlabs/inbound-initiation.js": EINGANGSSTART,
  "src/i18n/prompts/de.js": PROMPT_DE,
  "src/i18n/locales.js": LOCALES,
  "src/telephony/adapters/telnyx/elevenlabs-voice.js": STIMMEN,
  "elevenlabs/agent_configs/outbound-agent.template.json": VORLAGE,
};

function kopf(repo) {
  const lauf = runIn(repo, "git", ["rev-parse", "HEAD"]);
  assert.equal(lauf.status, 0, lauf.stderr);
  return lauf.stdout.trim();
}

function folgeCommit(repo, dateien) {
  writeFiles(repo, dateien);
  commitAll(repo, "Folge");
  return kopf(repo);
}

function attrappenRepo(context) {
  const repo = probeRepository(context, ATTRAPPE);
  return { repo, basis: kopf(repo) };
}

function assertAufgeraeumt(repo) {
  const liste = runIn(repo, "git", ["worktree", "list", "--porcelain"]);
  assert.equal(liste.status, 0, liste.stderr);
  const baeume = liste.stdout.split("\n").filter((zeile) => zeile.startsWith("worktree "));
  assert.equal(baeume.length, 1, `zurueckgebliebene Arbeitsbaeume: ${baeume.join(", ")}`);
  const ablage = join(repo, ".pruefung/abdruck");
  assert.deepEqual(existsSync(ablage) ? readdirSync(ablage) : [], []);
}

test("Abdruck: eine Aenderung ausserhalb des Gespraechs laesst den Abdruck gleich", async (kontext) => {
  const { repo, basis } = attrappenRepo(kontext);
  const neu = folgeCommit(repo, { "README.md": "Wegwerf-Repo, zweite Fassung\n" });

  const ergebnis = await gespraechVergleichen({ repoDir: repo, alt: basis, neu });

  assert.deepEqual(ergebnis, { geaendert: false, teile: [] });
  assertAufgeraeumt(repo);
});

test("Abdruck: ein geaenderter Prompttext meldet genau diesen Teil", async (kontext) => {
  const { repo, basis } = attrappenRepo(kontext);
  const neu = folgeCommit(repo, {
    "src/i18n/prompts/de.js": PROMPT_DE.replace("Ich bin", "Hier spricht"),
  });

  const ergebnis = await gespraechVergleichen({ repoDir: repo, alt: basis, neu });

  assert.deepEqual(ergebnis, { geaendert: true, teile: ["prompts/de/PROMPT_DE.persona"] });
  assertAufgeraeumt(repo);
});

test("Abdruck: geaenderter Anrufstart, Stimme und Vorlage melden je ihren Teil", async (kontext) => {
  const { repo, basis } = attrappenRepo(kontext);
  const neu = folgeCommit(repo, {
    "src/elevenlabs/outbound.js": ANRUFSTART.replace("sprache: call.language ?? null", "sprache: call.language ?? \"de\""),
    "src/telephony/adapters/telnyx/elevenlabs-voice.js": STIMMEN.replace("stimme-de", "stimme-de-neu"),
    "elevenlabs/agent_configs/outbound-agent.template.json": VORLAGE.replace("Sei freundlich.", "Sei knapp."),
  });

  const ergebnis = await gespraechVergleichen({ repoDir: repo, alt: basis, neu });

  assert.equal(ergebnis.geaendert, true);
  assert.ok(ergebnis.teile.includes("anrufstart/de-nach-fr/fremd/consult-aus"), ergebnis.teile.join(", "));
  assert.ok(ergebnis.teile.includes("stimmen"));
  assert.ok(ergebnis.teile.includes("vorlage/prompt"));
  assert.ok(!ergebnis.teile.some((teil) => teil.startsWith("anrufstart/de/")), ergebnis.teile.join(", "));
  assert.ok(!ergebnis.teile.some((teil) => teil.startsWith("fehler:")));
  assertAufgeraeumt(repo);
});

test("Abdruck: wirft ein Modul auf dem neuen Commit, meldet der Vergleich fehler:neu", async (kontext) => {
  const { repo, basis } = attrappenRepo(kontext);
  const neu = folgeCommit(repo, {
    "src/elevenlabs/outbound.js": `throw new Error("${AUSGABE_MARKE} im Fehlertext");\n`,
  });

  const ergebnis = await gespraechVergleichen({ repoDir: repo, alt: basis, neu });

  assert.equal(ergebnis.geaendert, true);
  assert.ok(ergebnis.teile.includes("fehler:neu"), ergebnis.teile.join(", "));
  assert.ok(!ergebnis.teile.includes("fehler:alt"));
  assert.ok(!ergebnis.teile.some((teil) => teil.includes(AUSGABE_MARKE)));
  assertAufgeraeumt(repo);
});

test("Abdruck: bricht der Erzeuger auf dem neuen Commit ganz ab, bleibt nur fehler:neu", async (kontext) => {
  const { repo, basis } = attrappenRepo(kontext);
  const neu = folgeCommit(repo, { "src/i18n/locales.js": "process.exit(3);\n" });

  const ergebnis = await gespraechVergleichen({ repoDir: repo, alt: basis, neu });

  assert.deepEqual(ergebnis, { geaendert: true, teile: ["fehler:neu"] });
  assertAufgeraeumt(repo);
});

test("Abdruck: ein unbekannter alter Commit meldet fehler:alt", async (kontext) => {
  const { repo, basis } = attrappenRepo(kontext);

  const ergebnis = await gespraechVergleichen({ repoDir: repo, alt: UNBEKANNTER_COMMIT, neu: basis });

  assert.deepEqual(ergebnis, { geaendert: true, teile: ["fehler:alt"] });
  assertAufgeraeumt(repo);
});

test("Abdruck: der Erzeuger bekommt keine geerbten Zugangsdaten", async (kontext) => {
  const { repo } = attrappenRepo(kontext);
  const alt = folgeCommit(repo, {
    "src/i18n/prompts/umgebung.js": 'export const UMGEBUNG = Object.freeze({ zugang: "", modus: "test" });\n',
  });
  const neu = folgeCommit(repo, {
    "src/i18n/prompts/umgebung.js": [
      "export const UMGEBUNG = Object.freeze({",
      '  zugang: Object.keys(process.env).filter((name) => /TOKEN|KEY|SECRET/i.test(name)).sort().join(","),',
      "  modus: process.env.NODE_ENV,",
      "});",
      "",
    ].join("\n"),
  });
  const vorher = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, RENDER_API_KEY: process.env.RENDER_API_KEY };
  kontext.after(() => {
    for (const [name, wert] of Object.entries(vorher)) {
      if (wert === undefined) delete process.env[name];
      else process.env[name] = wert;
    }
  });
  process.env.GITHUB_TOKEN = "probe-github-token";
  process.env.RENDER_API_KEY = "probe-render-key";

  const ergebnis = await gespraechVergleichen({ repoDir: repo, alt, neu });

  assert.deepEqual(ergebnis, { geaendert: false, teile: [] });
  assertAufgeraeumt(repo);
});

test("Abdruck: der Vergleich gibt keine Inhalte auf stdout oder stderr aus", async (kontext) => {
  const { repo, basis } = attrappenRepo(kontext);
  const neu = folgeCommit(repo, {
    "src/i18n/prompts/de.js": PROMPT_DE.replace("DEIN AUFTRAG:", "DEINE AUFGABE:"),
  });
  const skript = [
    `import { gespraechVergleichen } from ${JSON.stringify(ABDRUCK_MODUL)};`,
    `const ergebnis = await gespraechVergleichen(${JSON.stringify({ repoDir: repo, alt: basis, neu })});`,
    "process.stdout.write(JSON.stringify(ergebnis));",
  ].join("\n");
  const kind = spawn(process.execPath, ["--input-type=module", "-e", skript], { env: isolatedEnvironment() });
  let stdout = "";
  let stderr = "";
  kind.stdout.on("data", (stueck) => (stdout += stueck));
  kind.stderr.on("data", (stueck) => (stderr += stueck));
  const status = await new Promise((fertig) => kind.on("close", fertig));

  assert.equal(status, 0, stderr);
  assert.equal(stderr, "");
  assert.ok(!stdout.includes(AUSGABE_MARKE));
  assert.ok(!stdout.includes("DEINE AUFGABE"));
  assert.deepEqual(JSON.parse(stdout), { geaendert: true, teile: ["prompts/de/PROMPT_DE.goalLabel"] });
  assertAufgeraeumt(repo);
});
