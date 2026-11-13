import assert from "node:assert/strict";
import { test } from "node:test";

import { validateAssistantContext, validateMandate } from "../../src/routes/_validation.js";

const lang = (n) => "x".repeat(n);

const TEXTE = [
  ["context", validateAssistantContext, "summary", "context.summary", 1000],
  ["context", validateAssistantContext, "recipient_relationship", "context.recipient_relationship", 200],
  ["context", validateAssistantContext, "desired_outcome", "context.desired_outcome", 500],
  ["mandate", validateMandate, "decide_freely", "mandate.decide_freely", 1000],
  ["mandate", validateMandate, "fallback_order", "mandate.fallback_order", 500],
];

for (const [, pruefe, feld, name, grenze] of TEXTE) {
  test(`eingabegrenzen-grenzfaelle: ${name} genau ${String(grenze)} Zeichen ist erlaubt, eines mehr nicht`, () => {
    assert.deepEqual(pruefe({ [feld]: lang(grenze) }), { value: { [feld]: lang(grenze) } });
    assert.deepEqual(pruefe({ [feld]: lang(grenze + 1) }), {
      error: `${name} ist zu lang (max. ${String(grenze)} Zeichen)`,
    });
  });
}

const LISTEN = [
  ["key_facts", "context.key_facts", 10, 200],
  ["open_questions", "context.open_questions", 10, 300],
];

for (const [feld, name, maxItems, maxLen] of LISTEN) {
  test(`eingabegrenzen-grenzfaelle: ${name} genau an den Listengrenzen`, () => {
    const genau = Array.from({ length: maxItems }, () => lang(maxLen));
    assert.deepEqual(validateAssistantContext({ [feld]: genau }), { value: { [feld]: genau } });
    assert.deepEqual(validateAssistantContext({ [feld]: [...genau, "x"] }), {
      error: `${name} hat zu viele Eintraege (max. ${String(maxItems)})`,
    });
    assert.deepEqual(validateAssistantContext({ [feld]: [lang(maxLen + 1)] }), {
      error: `${name}: Eintrag zu lang (max. ${String(maxLen)} Zeichen)`,
    });
  });
}
