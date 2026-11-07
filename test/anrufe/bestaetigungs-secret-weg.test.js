import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer } from "../helpers.js";

const VARIABLE = "CALL_CONFIRMATION_SECRET";
const KURZER_WERT = "zu-kurz-3265";

async function bootLogs(env) {
  const srv = await startServer({ env: { FAKE_ORIGINATE: "true", ...env } });
  try {
    return srv.stdout + srv.stderr;
  } finally {
    await srv.stop();
  }
}

test("K-4a Serverstart mit zu kurzem, leerem und ohne Bestaetigungs-Geheimnis schreibt keinen Befund dazu", async () => {
  for (const env of [{ [VARIABLE]: KURZER_WERT }, { [VARIABLE]: "" }, {}]) {
    const logs = await bootLogs(env);
    assert.ok(!logs.includes(VARIABLE), `kein Logeintrag mit ${VARIABLE} bei ${JSON.stringify(env)}`);
    assert.ok(!logs.includes(KURZER_WERT), "der Wert steht in keiner Logzeile");
  }
});
