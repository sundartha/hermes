import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { messeProtokoll } from "../../tools/auftrag/planung/messung.mjs";
import { REPO_ROOT, probeDirectory, runIn } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");

function zeilen(saetze) {
  return `${saetze.map((satz) => JSON.stringify(satz)).join("\n")}\nkein json\n`;
}

function antwort(id, zeit, { usage, inhalt = [{ type: "text", text: "t" }] }) {
  return { type: "assistant", timestamp: zeit, sessionId: "s1", message: { id, usage, content: inhalt } };
}

function ergebnis(id, zeit, text) {
  return { type: "user", timestamp: zeit, sessionId: "s1", message: { content: [{ type: "tool_result", tool_use_id: id, content: text }] } };
}

const HAUPT = [
  antwort("m1", "2026-10-12T10:00:00.000Z", { usage: { input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 5 }, inhalt: [{ type: "tool_use", id: "w1", name: "Read", input: {} }] }),
  antwort("m1", "2026-10-12T10:00:01.000Z", { usage: { input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 7 } }),
  ergebnis("w1", "2026-10-12T10:00:02.000Z", "abcdef"),
  antwort("m2", "2026-10-12T10:01:30.000Z", { usage: { input_tokens: 20, cache_creation_input_tokens: 3000, output_tokens: 9 } }),
  { type: "user", timestamp: "2026-10-12T10:01:31.000Z", message: { content: [{ type: "tool_result", tool_use_id: "w2", content: [{ type: "text", text: "1234" }] }] } },
];

const UNTERAGENT = [
  { ...antwort("u1", "2026-10-12T10:00:10.000Z", { usage: { input_tokens: 500, output_tokens: 1 } }), agentId: "a7" },
  { ...ergebnis("w9", "2026-10-12T10:00:11.000Z", "xyz"), agentId: "a7" },
  { ...ergebnis("w9", "2026-10-12T10:00:11.000Z", "xyz"), agentId: "a7" },
];

function protokoll(context) {
  const ordner = probeDirectory(context, {
    "s1.jsonl": zeilen(HAUPT),
    "s1/subagents/agent-a7.jsonl": zeilen(UNTERAGENT),
    "s1/subagents/agent-a7.meta.json": JSON.stringify({ agentType: "erkunder" }),
  });
  return join(ordner, "s1.jsonl");
}

const ERWARTET = [
  { rolle: "haupt", sitzung: "s1", dauerMs: 91_000, schritte: 2, groessterKontext: 3020, token: 1010 + 7 + 3020 + 9, werkzeugZeichen: 10 },
  { rolle: "erkunder", sitzung: "a7", dauerMs: 1000, schritte: 1, groessterKontext: 500, token: 501, werkzeugZeichen: 3 },
];

test("die Messung entdoppelt Antworten nach Nachrichten-ID und rechnet je Beteiligtem", (context) => {
  assert.deepEqual(messeProtokoll(protokoll(context)), ERWARTET);
});

test("eine Antwort ohne Nachrichten-ID zählt als eigener Schritt, ein leeres Protokoll bricht ab", (context) => {
  const ordner = probeDirectory(context, {
    "s2.jsonl": zeilen([{ type: "assistant", timestamp: "2026-10-12T10:00:00.000Z", sessionId: "s2", message: { usage: { input_tokens: 7 } } }, antwort("m1", "2026-10-12T10:00:01.000Z", { usage: { input_tokens: 5 } })]),
    "leer.jsonl": "kein json\n",
  });
  const [haupt] = messeProtokoll(join(ordner, "s2.jsonl"));
  assert.deepEqual([haupt.schritte, haupt.groessterKontext, haupt.token], [2, 7, 12]);
  assert.throws(() => messeProtokoll(join(ordner, "leer.jsonl")), /Protokoll ohne lesbare Zeilen: .*leer\.jsonl/);
});

test("Schritte, Kontext und Token folgen einer Zählregel: eine wiederholte Nachrichten-ID behält die letzte Nutzung, eine Antwort ohne Nutzung zählt nicht", (context) => {
  const ordner = probeDirectory(context, {
    "s3.jsonl": zeilen([
      antwort("m1", "2026-10-12T10:00:00.000Z", { usage: { input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 5 } }),
      antwort("m1", "2026-10-12T10:00:01.000Z", {}),
      antwort("m2", "2026-10-12T10:00:02.000Z", {}),
      antwort("m3", "2026-10-12T10:00:03.000Z", { usage: { input_tokens: 4, cache_creation_input_tokens: 200, output_tokens: 1 } }),
    ]),
  });
  const [haupt] = messeProtokoll(join(ordner, "s3.jsonl"));
  assert.deepEqual([haupt.schritte, haupt.groessterKontext, haupt.token], [2, 1010, 1015 + 205]);
});

test("messung gibt dieselben Zahlen über die Befehlszeile aus und bricht bei fehlendem Protokoll ab", (context) => {
  const datei = protokoll(context);
  const json = runIn(REPO_ROOT, process.execPath, [EINSTIEG, "messung", datei, "--json"]);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), ERWARTET);
  const text = runIn(REPO_ROOT, process.execPath, [EINSTIEG, "messung", datei]);
  assert.deepEqual(text.stdout.trimEnd().split("\n"), [
    "haupt\ts1\t91 s\t2 Schritte\tKontext 3020\t4046 Token\t10 Werkzeugzeichen",
    "erkunder\ta7\t1 s\t1 Schritte\tKontext 500\t501 Token\t3 Werkzeugzeichen",
  ]);
  const fehlt = runIn(REPO_ROOT, process.execPath, [EINSTIEG, "messung", join(datei, "..", "fehlt.jsonl")]);
  assert.equal(fehlt.status, 1);
  assert.match(fehlt.stderr, /Abbruch: Protokoll fehlt: /);
});
