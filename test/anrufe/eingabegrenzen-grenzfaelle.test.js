import assert from "node:assert/strict";
import { test, before, after } from "node:test";

import { startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TO = "+4915112345678";
const lang = (n) => "x".repeat(n);

let srv;

before(async () => {
  srv = await startServer({ env: { ASSISTANT_CONTEXT_ENABLED: "true", ALLOWED_NUMBERS: TO } });
});

after(async () => {
  await srv.stop();
});

async function placeCall(body) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren", ...body }),
  });
  return { status: res.status, error: res.status === 400 ? (await res.json()).error : null };
}

const TEXTE = [
  ["context", "summary", "context.summary", 1000],
  ["context", "recipient_relationship", "context.recipient_relationship", 200],
  ["context", "desired_outcome", "context.desired_outcome", 500],
  ["mandate", "decide_freely", "mandate.decide_freely", 1000],
  ["mandate", "fallback_order", "mandate.fallback_order", 500],
];

for (const [objekt, feld, name, grenze] of TEXTE) {
  test(`eingabegrenzen-grenzfaelle: ${name} genau ${String(grenze)} Zeichen kommt durch, eines mehr gibt 400`, async () => {
    const genau = await placeCall({ [objekt]: { [feld]: lang(grenze) } });
    assert.notEqual(genau.status, 400);
    const zuLang = await placeCall({ [objekt]: { [feld]: lang(grenze + 1) } });
    assert.equal(zuLang.status, 400);
    assert.equal(zuLang.error, `${name} ist zu lang (max. ${String(grenze)} Zeichen)`);
  });
}

const LISTEN = [
  ["key_facts", "context.key_facts", 10, 200],
  ["open_questions", "context.open_questions", 10, 300],
];

for (const [feld, name, maxItems, maxLen] of LISTEN) {
  test(`eingabegrenzen-grenzfaelle: ${name} genau an den Listengrenzen`, async () => {
    const genau = Array.from({ length: maxItems }, () => lang(maxLen));
    assert.notEqual((await placeCall({ context: { [feld]: genau } })).status, 400);
    const zuViele = await placeCall({ context: { [feld]: [...genau, "x"] } });
    assert.equal(zuViele.status, 400);
    assert.equal(zuViele.error, `${name} hat zu viele Eintraege (max. ${String(maxItems)})`);
    const zuLang = await placeCall({ context: { [feld]: [lang(maxLen + 1)] } });
    assert.equal(zuLang.status, 400);
    assert.equal(zuLang.error, `${name}: Eintrag zu lang (max. ${String(maxLen)} Zeichen)`);
  });
}
