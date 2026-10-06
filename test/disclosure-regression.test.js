import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import {
  BOOTSTRAP_TENANT_ID,
  DEFAULT_LANGUAGE,
  setWorldDefaultLanguageEnabled,
} from "../src/store/defaults.js";
import { LOCALES } from "../src/i18n/locales.js";

const DISCLOSURE_PREFIX = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von ";
const DISCLOSURE_TAIL = "wird für meinen Auftraggeber zusammengefasst";
const NO_REPEAT_CLAUSE = "Wiederhole sie NICHT";

const OWNER_NAME = "Jonas Beispiel";

let systemPrompt, disclosureSentence;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER_NAME }],
    }),
  );
  await import("../src/config.js");
  setWorldDefaultLanguageEnabled(true);
  ({ systemPrompt, disclosureSentence } = await import("../src/claude.js"));
});

test("T-P2-09: disclosureSentence - fester Wortlaut + Tenant-ownerName (callerName ignoriert, G1)", () => {
  const sentence = disclosureSentence({
    callerName: "Klaus",
    tenantId: BOOTSTRAP_TENANT_ID,
    language: "de",
  });
  assert.ok(sentence.startsWith(DISCLOSURE_PREFIX), `Wortlaut-Praefix fehlt: ${sentence}`);
  assert.ok(
    !sentence.includes("Klaus"),
    "callerName darf NICHT eingesetzt werden (Identitaets-Bindung)",
  );
  assert.ok(sentence.includes(OWNER_NAME), "ownerName muss eingesetzt sein");
  assert.ok(sentence.includes(DISCLOSURE_TAIL), `Zusammenfassungs-Hinweis fehlt: ${sentence}`);
});

test("P10-S1-1: disclosureSentence ohne language faellt auf den Weltdefault (DEFAULT_LANGUAGE) zurueck", () => {
  const sentence = disclosureSentence({ tenantId: BOOTSTRAP_TENANT_ID });
  assert.equal(sentence, LOCALES[DEFAULT_LANGUAGE].disclosure(OWNER_NAME));
  assert.ok(
    sentence.startsWith("Hello, this is an AI assistant"),
    `EN-Weltdefault-Wortlaut fehlt: ${sentence}`,
  );
});

test("T-P2-10: Outbound-Prompt weist den LLM an, die LLM-frei gesprochene Offenlegung NICHT zu wiederholen (G2)", () => {
  const call = seedCall({ direction: "outbound", goal: "Termin", tenantId: BOOTSTRAP_TENANT_ID });
  const prompt = systemPrompt(call);
  assert.ok(
    prompt.includes(NO_REPEAT_CLAUSE),
    "Nicht-wiederholen-Klausel muss im Outbound-Prompt stehen",
  );
  assert.ok(
    prompt.includes(call.goal),
    "der Outbound-Prompt muss das Anliegen nennen (Anknuepfung)",
  );
});

test("T-P2-10b: Inbound-Prompt traegt die Outbound-Klausel NICHT (Gegenprobe)", () => {
  const call = seedCall({ direction: "inbound", tenantId: BOOTSTRAP_TENANT_ID });
  const prompt = systemPrompt(call);
  assert.ok(
    !prompt.includes(NO_REPEAT_CLAUSE),
    "Inbound darf die Outbound-Klausel nicht enthalten",
  );
});
