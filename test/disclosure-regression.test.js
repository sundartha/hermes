// P2/OT-4 AC6: Regressions-/Lock-Test fuer CLAUDE.md Absolute Regel 2 (Offenlegung).
// claude.js bleibt UNVERAENDERT - dieser Test nagelt den Bestand fest, damit ein
// kuenftiges Refactor den fest verdrahteten Offenlegungssatz nicht still droppen,
// umordnen oder vom ersten Satz verdraengen kann (Commit 0fefd5d musste ihn im
// Fehlerpfad schon einmal reparieren). Reine Unit gegen die exportierten Funktionen;
// DATA_DIR im before vor dem ersten config-Import (Repo-Regel, wie claude-identity).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { OWNER_TENANT_ID } from "../src/store/defaults.js";

const DISCLOSURE_PREFIX = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von ";
const DISCLOSURE_TAIL = "wird fuer meinen Auftraggeber zusammengefasst";
const FIRST_SENTENCE_CLAUSE = "Dein allererster Satz muss exakt lauten";

let systemPrompt, disclosureSentence;
before(async () => {
  process.env.DATA_DIR = tempDataDir(seedState({ calls: [] }));
  await import("../src/config.js");
  ({ systemPrompt, disclosureSentence } = await import("../src/claude.js"));
});

test("T-P2-09: disclosureSentence - fester Wortlaut + callerName eingesetzt", () => {
  const sentence = disclosureSentence({ callerName: "Jonas", tenantId: OWNER_TENANT_ID });
  assert.ok(sentence.startsWith(DISCLOSURE_PREFIX), `Wortlaut-Praefix fehlt: ${sentence}`);
  assert.ok(sentence.includes("Jonas"), "callerName muss eingesetzt sein");
  assert.ok(sentence.includes(DISCLOSURE_TAIL), `Zusammenfassungs-Hinweis fehlt: ${sentence}`);
});

test("T-P2-10: Outbound-Prompt verdrahtet Disclosure als PFLICHT-ersten-Satz (Regel 2)", () => {
  const call = seedCall({ direction: "outbound", goal: "Termin", callerName: "Jonas", tenantId: OWNER_TENANT_ID });
  const prompt = systemPrompt(call);
  assert.ok(prompt.includes(disclosureSentence(call)), "exakter Offenlegungssatz muss im Prompt stehen");
  assert.ok(prompt.includes(FIRST_SENTENCE_CLAUSE), "Pflicht-erster-Satz-Klausel muss im Prompt stehen");
});

test("T-P2-10b: Inbound-Prompt traegt die Outbound-Offenlegung NICHT (Gegenprobe)", () => {
  const call = seedCall({ direction: "inbound", callerName: "Jonas", tenantId: OWNER_TENANT_ID });
  const prompt = systemPrompt(call);
  assert.ok(!prompt.includes(FIRST_SENTENCE_CLAUSE), "Inbound darf die Outbound-Offenlegungsklausel nicht enthalten");
});
