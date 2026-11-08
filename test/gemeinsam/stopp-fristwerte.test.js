import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const LESE_SKRIPT = `import { config } from "./src/config.js"; process.stdout.write(String(config.server.shutdownDrainTimeoutMs));`;

function drainFrist(wert) {
  const env = { ...process.env };
  delete env.SHUTDOWN_DRAIN_TIMEOUT_MS;
  if (wert !== undefined) env.SHUTDOWN_DRAIN_TIMEOUT_MS = wert;
  return execFileSync(process.execPath, ["--input-type=module", "-e", LESE_SKRIPT], {
    cwd: WURZEL,
    env,
    encoding: "utf8",
  });
}

function datei(pfad) {
  return readFileSync(new URL(`../../${pfad}`, import.meta.url), "utf8");
}

test("Fristwerte: 110000 wird als Gesamtfrist gelesen", () => {
  assert.equal(drainFrist("110000"), "110000");
});

test("Fristwerte: 110001 wird auf den Deckel 110000 gekuerzt", () => {
  assert.equal(drainFrist("110001"), "110000");
});

test("Fristwerte: ohne Variable bleibt die Gesamtfrist bei 8000", () => {
  assert.equal(drainFrist(undefined), "8000");
});

test("Fristwerte: render.yaml setzt fuer vodafone-agent 25000 und kein maxShutdownDelaySeconds", () => {
  const yaml = datei("render.yaml");
  const dienst = yaml.split(/^ {2}- /m).find((teil) => /^type: .*\n\s+name: vodafone-agent\n/.test(teil));
  assert.ok(dienst, "Dienst vodafone-agent fehlt");
  assert.match(dienst, /key: SHUTDOWN_DRAIN_TIMEOUT_MS\n\s+value: "25000"/);
  assert.equal(yaml.includes("maxShutdownDelaySeconds"), false);
});

test("Fristwerte: .env.example nennt Deckel 110000, Render-Wert 25000 und Default 8000", () => {
  const text = datei(".env.example");
  const zeilen = text.split("\n");
  const index = zeilen.findIndex((z) => z.startsWith("SHUTDOWN_DRAIN_TIMEOUT_MS="));
  assert.ok(index > 0);
  const block = zeilen.slice(Math.max(0, index - 6), index + 1).join("\n");
  assert.match(block, /110000/);
  assert.match(block, /25000/);
  assert.match(block, /8000/);
  assert.doesNotMatch(block, /exit\(0\)/);
});
