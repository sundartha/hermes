import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { starteAgentParallel } from "../../tools/auftrag/agenten.mjs";

const AUSFUEHRBAR = 0o755;
const GRUND = "Deckel erreicht";
const SPAETER_MS = 20_000;
const ERSTE = { input_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 30, output_tokens: 4 };
const ERSTE_GROESSE = 2134;
const ZWEITE = { input_tokens: 5, output_tokens: 600 };
const ZWEITE_GROESSE = 605;
const ERSTE_SPAETER = { ...ERSTE, output_tokens: 900 };
const ERSTE_SPAETER_GROESSE = 3030;
const GROSSER_EINGANG = 4_000_000;

const ERSATZ_CLAUDE = `#!${process.execPath}
import { readFileSync } from "node:fs";
const art = readFileSync(0, "utf8").trim();
const zeile = (wert) => JSON.stringify(wert) + "\\n";
const nachricht = (id, usage, teil) => zeile({ type: "assistant", message: { id, usage, content: [teil] } });
const erste = (teil) => nachricht("m1", ${JSON.stringify(ERSTE)}, teil);
const text = { type: "text", text: "Bericht" };
if (art === "zweizeilig") {
  process.stdout.write(erste({ type: "thinking", thinking: "denkt" }) + erste(text));
  process.stdout.write(zeile({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "w1", content: "x" }] } }));
  process.stdout.write(nachricht("m2", ${JSON.stringify(ZWEITE)}, text) + zeile({ type: "result", result: "fertig" }));
}
if (art === "wachsend") {
  process.stdout.write(erste({ type: "thinking", thinking: "denkt" }) + nachricht("m1", ${JSON.stringify(ERSTE_SPAETER)}, text) + erste(text));
  process.stdout.write(zeile({ type: "result", result: "fertig" }));
}
if (art === "wartet") {
  process.stdout.write(erste(text));
  setTimeout(() => process.stdout.write(zeile({ type: "result", result: "zu spät" })), ${SPAETER_MS});
}
if (art === "schluss") {
  process.stdout.write(erste(text) + zeile({ type: "result", result: "fertig" }));
  setTimeout(() => process.exit(0), 1000);
}
`;

const ORT = mkdtempSync(join(tmpdir(), "waechter-verbrauch-"));
writeFileSync(join(ORT, "claude.mjs"), ERSATZ_CLAUDE, { mode: AUSFUEHRBAR });
process.env.HERMES_CLAUDE = join(ORT, "claude.mjs");
after(() => rmSync(ORT, { recursive: true, force: true }));

async function starte(art, { beende = false } = {}) {
  const meldungen = [];
  const laufend = starteAgentParallel({ rolle: "erkunder", root: ORT }, art, {
    agent: "erkunder",
    argumente: [],
    kontextGrenze: null,
    vollstaendig: true,
    beiNachricht: (groesse, zuvor) => {
      meldungen.push({ groesse, zuvor });
      if (beende) laufend.beende(GRUND);
    },
  });
  return { lauf: await laufend, groessen: meldungen.map(({ groesse }) => groesse), meldungen };
}

test("Wächter: meldet die Usage jeder Nachricht genau einmal, auch wenn sie in mehreren Zeilen steht", async () => {
  const { lauf, groessen } = await starte("zweizeilig");

  assert.deepEqual(groessen, [ERSTE_GROESSE, ZWEITE_GROESSE]);
  assert.equal(lauf.exitCode, 0);
  assert.equal(lauf.volleAntwort, "fertig");
});

test("Wächter: trägt eine spätere Zeile derselben Nachricht mehr Usage, meldet er die neue Größe mit der zuvor gemeldeten, nie weniger", async () => {
  const { lauf, meldungen } = await starte("wachsend");

  assert.deepEqual(meldungen, [
    { groesse: ERSTE_GROESSE, zuvor: 0 },
    { groesse: ERSTE_SPAETER_GROESSE, zuvor: ERSTE_GROESSE },
  ]);
  assert.equal(lauf.exitCode, 0);
});

test("Wächter: beendet den Agenten auf den Befehl beende und meldet die Aktion deckel", { timeout: SPAETER_MS * 2 }, async () => {
  const beginn = Date.now();
  const { lauf, groessen } = await starte("wartet", { beende: true });

  assert.deepEqual(groessen, [ERSTE_GROESSE]);
  assert.deepEqual(lauf.aktion, { art: "deckel", grund: GRUND });
  assert.notEqual(lauf.exitCode, 0);
  assert.ok(Date.now() - beginn < SPAETER_MS, `der Agent lief bis zum Ende: ${Date.now() - beginn} ms`);
  assert.ok(!lauf.volleAntwort.includes("zu spät"), lauf.volleAntwort);
});

test("Wächter: ein beende direkt nach dem Start des Wächters bricht den Agenten mit der Aktion deckel ab", { timeout: SPAETER_MS * 2 }, async () => {
  const laufend = starteAgentParallel({ rolle: "erkunder", root: ORT }, "wartet" + " ".repeat(GROSSER_EINGANG), {
    agent: "erkunder",
    argumente: [],
    kontextGrenze: null,
    vollstaendig: true,
    beiNachricht: () => {},
  });
  laufend.beende(GRUND);
  const lauf = await laufend;

  assert.deepEqual(lauf.aktion, { art: "deckel", grund: GRUND });
  assert.notEqual(lauf.exitCode, 0);
  assert.ok(!lauf.volleAntwort.includes("zu spät"), lauf.volleAntwort);
});

test("Wächter: ein Befehl beende nach dem result-Ereignis ändert das Ergebnis nicht", async () => {
  const { lauf, groessen } = await starte("schluss", { beende: true });

  assert.deepEqual(groessen, [ERSTE_GROESSE]);
  assert.equal(lauf.aktion, null);
  assert.equal(lauf.exitCode, 0);
  assert.equal(lauf.volleAntwort, "fertig");
});
