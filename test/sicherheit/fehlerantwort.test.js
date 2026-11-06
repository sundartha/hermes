import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { aufbauUndAbbau } from "../gemeinsam/aufbau-und-abbau.mjs";

const HTTP_SERVER_ERROR = 500;
const PHONE = "+4915112345678";
const SUBSCRIBER_DIGITS = "15112345678";
const BROKEN_ESCAPE = "%E0%A4%A";
const SECRETS = {
  ANTHROPIC_API_KEY: "sk-ant-sg13-schluessel-darf-nie-raus",
  ELEVENLABS_TOOL_TOKEN: "sg13-werkzeug-token-darf-nie-raus",
  CALL_CONFIRMATION_SECRET: "sg13-bestaetigungs-geheimnis-darf-nie-raus",
};

const hermes = {};

aufbauUndAbbau(
  async () => {
    hermes.srv = await startServer({ env: SECRETS });
  },
  async () => {
    await hermes.srv?.stop();
  },
);

test("SG-13 Fehlerantwort enthält weder Schlüssel noch volle Telefonnummer", async () => {
  const res = await abrufMitFrist(`${hermes.srv.localUrl}/api/calls/${PHONE}${BROKEN_ESCAPE}`);
  const body = await res.text();

  for (const secret of [SUBSCRIBER_DIGITS, ...Object.values(SECRETS)]) {
    assert.equal(body.includes(secret), false, secret);
  }
  assert.equal(res.status, HTTP_SERVER_ERROR);
  assert.deepEqual(JSON.parse(body), { error: "internal error" });
});
