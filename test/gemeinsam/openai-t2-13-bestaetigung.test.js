import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { MCP_TEXTS } from "../../src/i18n/mcp-texts.js";
import { MCP_BASE_INSTRUCTIONS } from "../../src/mcp-server-info.js";
import { startServer, stdioServerTransport } from "../helpers.js";

const TARGET = "+4915112340099";
const OBJECTIVE = "Termin vereinbaren";

test("(h) stdio (echter Kindprozess): place_call Rundlauf ueber einen echten tools/call", async () => {
  const gateway = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      ALLOWED_COUNTRY_CODES: "*",
    },
  });
  const { transport, stderr } = stdioServerTransport({ GATEWAY_URL: gateway.localUrl, MCP_UI_ENABLED: "true" });
  const client = new Client({ name: "hermes-t2-13-stdio-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    const before = gateway.readStore().calls.length;
    const placed = await client.callTool({
      name: "place_call",
      arguments: { to: TARGET, objective: OBJECTIVE },
    });
    assert.notEqual(placed.isError, true, `place_call ueber stdio (stderr: ${stderr.text})`);
    assert.ok(placed.structuredContent.call_id, "call_id vorhanden");
    assert.equal(gateway.readStore().calls.length, before + 1, "genau EIN Anruf entstanden");
  } finally {
    await client.close();
    await gateway.stop();
  }
});

const SELF_CONFIRMATION_PATTERNS = {
  de: [/\bCode\b[^.;]*\b(pruefen|ablesen|lesen|abschreiben|uebernehmen)\b/i, /\b(pruefe|lies)\b[^.;]*\bCode\b/i],
  en: [/\b(check|read|look at|copy|take)\b[^.;]*\bcode\b/i, /\breveals?\b[^.;]*\bcode\b/i],
  fr: [/\b(vérifiez|lisez|copiez|relevez)\b[^.;]*\bcode\b/i],
};
const OLD_CARD_HINTS = {
  de: "Vorschau erstellt. Zum Bestaetigen den Code in der Hermes-Karte pruefen und mit place_call (gleiche Angaben) erneut aufrufen.",
  en: "Preview created. To confirm, check the code in the Hermes card and call place_call again with the same arguments.",
  fr: "Aperçu créé. Pour confirmer, vérifiez le code dans la carte Hermes puis rappelez place_call avec les mêmes arguments.",
};

function selfConfirmationHits(language, text) {
  return SELF_CONFIRMATION_PATTERNS[language].filter((pattern) => pattern.test(text));
}

test("Modelltexte: Server-Instruktionen leiten nicht zur Selbstbestaetigung an (Positiv-Kontrolle: alter Text wird erkannt)", () => {
  const languages = Object.keys(MCP_TEXTS);
  assert.deepEqual(languages.sort(), Object.keys(SELF_CONFIRMATION_PATTERNS).sort(), "jede Sprache hat Muster");
  for (const language of languages) {
    assert.ok(selfConfirmationHits(language, OLD_CARD_HINTS[language]).length > 0, `${language}: alter Text wird erkannt`);
  }
  assert.deepEqual(selfConfirmationHits("en", MCP_BASE_INSTRUCTIONS), [], "Server-Instruktionen");
});
