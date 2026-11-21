import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: WURZEL });

test("process.env außerhalb von src/config.ts: Meldung nennt alle drei Schritte inklusive render.yaml", async () => {
  const [ergebnis] = await eslint.lintText("export const a = process.env.X;\n", {
    filePath: resolve(WURZEL, "src/utils/probe-env.js"),
  });
  const meldung = ergebnis.messages.find((m) => m.ruleId === "no-restricted-properties");
  assert.ok(meldung);
  assert.match(
    meldung.message,
    /Neue Konfiguration braucht drei Schritte: den Schlüssel in rawConfig und im passenden Namensraum von CONFIG_NAMESPACES in src\/config\.js anlegen, die Variable in \.env\.example eintragen und render\.yaml prüfen\.$/,
  );
});
