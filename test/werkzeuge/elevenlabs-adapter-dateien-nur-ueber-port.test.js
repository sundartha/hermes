import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { verstoesseAus } from "../../tools/pruefen.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const REGEL = "elevenlabs-nur-ueber-port";
const GROSSE_AUSGABE = 268_435_456;
const ordner = [];

after(() => {
  for (const eintrag of ordner) rmSync(eintrag, { recursive: true, force: true });
});

function verstoesse(von, ziel) {
  const wurzel = mkdtempSync(join(tmpdir(), "elevenlabs-adapter-"));
  ordner.push(wurzel);
  mkdirSync(join(wurzel, "tools"));
  copyFileSync(join(WURZEL, ".dependency-cruiser.cjs"), join(wurzel, ".dependency-cruiser.cjs"));
  copyFileSync(join(WURZEL, "tools/bereiche.json"), join(wurzel, "tools/bereiche.json"));
  symlinkSync(join(WURZEL, "node_modules"), join(wurzel, "node_modules"));
  const hoch = "../".repeat(dirname(von).split("/").length - 1);
  for (const [pfad, inhalt] of [[von, `import "${hoch}${ziel.replace(/^src\//, "")}";\n`], [ziel, "export const x = 1;\n"]]) {
    mkdirSync(dirname(join(wurzel, pfad)), { recursive: true });
    writeFileSync(join(wurzel, pfad), inhalt);
  }
  const lauf = spawnSync(join(WURZEL, "node_modules/.bin/depcruise"), ["src", "--config", ".dependency-cruiser.cjs", "--output-type", "json"], { cwd: wurzel, encoding: "utf8", maxBuffer: GROSSE_AUSGABE });
  return verstoesseAus(JSON.parse(lauf.stdout)).filter((eintrag) => eintrag.startsWith(`${REGEL}: `));
}

for (const [datei, ziel] of [
  ["src/routes/probe.ts", "src/elevenlabs/outbound.js"],
  ["src/telephony/probe.js", "src/elevenlabs/outbound-vorspann.js"],
  ["src/worker/probe.js", "src/elevenlabs/nummern-registrierung.ts"],
]) {
  test(`SG-ELEVENLABS-PORT Import von ${ziel} aus ${datei} ist ein Verstoß gegen elevenlabs-nur-ueber-port`, () => {
    assert.deepEqual(verstoesse(datei, ziel), [`${REGEL}: ${datei} → ${ziel}`]);
  });
}

test("Import von outbound.js innerhalb von src/elevenlabs/ bleibt erlaubt", () => {
  assert.deepEqual(verstoesse("src/elevenlabs/probe.ts", "src/elevenlabs/outbound.js"), []);
});

test("Der Nummern-Port liefert Registrar und Trunk-Schreiber nur bei eingeschalteter Bereitstellung", async () => {
  const { elevenlabsNummern } = await import("../../src/elevenlabs/nummern-port.ts");
  const port = elevenlabsNummern();
  assert.equal(port.sipRegistrarWennAktiv({ provisioning: { provisioningEnabled: false } }), undefined);
  assert.equal(typeof port.inboundTrunkSchreiberWennErlaubt, "function");
});

test("Der Outbound-Port reicht Konstante, Sprachwahl und Ende-Schreiber des Anrufstarts durch", async () => {
  const { elevenlabsOutbound } = await import("../../src/elevenlabs/registry.ts");
  const port = elevenlabsOutbound();
  assert.equal(port.ANSWERED_REASON_NOT_ANSWERED, "call_duration_secs_zero_not_answered");
  assert.equal(typeof port.ELEVENLABS_PROVIDER_MAX_DURATION_S, "number");
  assert.equal(typeof port.callLocaleOf, "function");
  assert.equal(typeof port.endeSchreiberFuer, "function");
});
