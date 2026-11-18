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
const ADAPTER = "src/elevenlabs/convai.ts";
const GROSSE_AUSGABE = 268_435_456;
const ordner = [];

after(() => {
  for (const eintrag of ordner) rmSync(eintrag, { recursive: true, force: true });
});

function relativ(von, ziel) {
  const teile = dirname(von).split("/").length;
  return `${"../".repeat(teile - 1)}${ziel.replace(/^src\//, "")}`;
}

function cruise(wurzel) {
  const lauf = spawnSync(join(WURZEL, "node_modules/.bin/depcruise"), ["src", "--config", ".dependency-cruiser.cjs", "--output-type", "json"], { cwd: wurzel, encoding: "utf8", maxBuffer: GROSSE_AUSGABE });
  return verstoesseAus(JSON.parse(lauf.stdout)).filter((eintrag) => eintrag.startsWith(`${REGEL}: `));
}

function verstoesse(von, ziel) {
  const wurzel = mkdtempSync(join(tmpdir(), "elevenlabs-port-"));
  ordner.push(wurzel);
  mkdirSync(join(wurzel, "tools"));
  copyFileSync(join(WURZEL, ".dependency-cruiser.cjs"), join(wurzel, ".dependency-cruiser.cjs"));
  copyFileSync(join(WURZEL, "tools/bereiche.json"), join(wurzel, "tools/bereiche.json"));
  symlinkSync(join(WURZEL, "node_modules"), join(wurzel, "node_modules"));
  for (const [pfad, inhalt] of [[von, `import "${relativ(von, ziel)}";\n`], [ziel, "export const x = 1;\n"]]) {
    mkdirSync(dirname(join(wurzel, pfad)), { recursive: true });
    writeFileSync(join(wurzel, pfad), inhalt);
  }
  return cruise(wurzel);
}

test("Import des ElevenLabs-Adapters aus src/routes/ ist ein neuer Verstoß gegen elevenlabs-nur-ueber-port", () => {
  assert.deepEqual(verstoesse("src/routes/probe.ts", ADAPTER), [`${REGEL}: src/routes/probe.ts → ${ADAPTER}`]);
});

test("Import des ElevenLabs-Adapters aus src/telephony/ ist ein neuer Verstoß gegen elevenlabs-nur-ueber-port", () => {
  assert.deepEqual(verstoesse("src/telephony/probe.ts", ADAPTER), [`${REGEL}: src/telephony/probe.ts → ${ADAPTER}`]);
});

test("Import des ElevenLabs-Adapters innerhalb von src/elevenlabs/ bleibt erlaubt", () => {
  assert.deepEqual(verstoesse("src/elevenlabs/probe.ts", ADAPTER), []);
});

test("Import der Registry src/elevenlabs/registry.ts aus src/routes/ bleibt erlaubt", () => {
  assert.deepEqual(verstoesse("src/routes/probe.ts", "src/elevenlabs/registry.ts"), []);
});

test("Der Anrufbereich in src/ spricht ElevenLabs nur über die Registry an", () => {
  const lauf = cruise(WURZEL);
  assert.deepEqual(lauf, []);
});

test("Der Konto-Port holt ein Gespräch mit Schlüssel und Frist über die ElevenLabs-API", async () => {
  const aufrufe = [];
  const fetchImpl = async (url, init) => {
    aufrufe.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ conversation_id: "c1" }) };
  };
  const konto = { apiBase: "https://el.test", apiKey: "k-test" };
  const { elevenlabsConvai } = await import("../../src/elevenlabs/registry.ts");
  const antwort = await elevenlabsConvai().fetchConversation({ fetchImpl, account: konto, conversationId: "c 1" });
  assert.deepEqual(antwort, { conversation_id: "c1" });
  assert.equal(aufrufe[0].url, "https://el.test/v1/convai/conversations/c%201");
  const { headers } = aufrufe[0].init;
  assert.equal(headers["xi-api-key"], "k-test");
});

test("Der Konto-Port holt eine Rufnummer über die ElevenLabs-API", async () => {
  const aufrufe = [];
  const fetchImpl = async (url) => {
    aufrufe.push(url);
    return { ok: true, status: 200, json: async () => ({ phone_number_id: "p1" }) };
  };
  const konto = { apiBase: "https://el.test", apiKey: "k-test" };
  const { elevenlabsConvai } = await import("../../src/elevenlabs/registry.ts");
  const antwort = await elevenlabsConvai().fetchPhoneNumber({ fetchImpl, account: konto, phoneNumberId: "p1" });
  assert.deepEqual(antwort, { phone_number_id: "p1" });
  assert.equal(aufrufe[0], "https://el.test/v1/convai/phone-numbers/p1");
});
