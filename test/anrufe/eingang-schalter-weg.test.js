import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  seedWithTelnyxNumber,
  startServer,
  startServerExpectExit,
  waitForLog,
} from "../helpers.js";

const ALTE_SCHALTER_FAELLE = [
  { name: "gueltige alte Werte", env: { ELEVENLABS_INBOUND_SCOPE: "registrierte_dids", ELEVENLABS_INBOUND_TENANT_IDS: "t_x" } },
  { name: "unbekannter alter Scope", env: { ELEVENLABS_INBOUND_SCOPE: "gibt-es-nicht" } },
];

for (const fall of ALTE_SCHALTER_FAELLE) {
  test(`Start mit ${fall.name}: kein Abbruch, Banner ohne scope und ohne Tenant-Zahl`, async () => {
    const srv = await startServer({
      env: { ...EL_INBOUND_ACCESS_BOOT_ENV, ...fall.env },
      seed: seedWithTelnyxNumber({ language: "de" }),
    });
    try {
      await waitForLog(srv, /Status-Callback:/);
      assert.match(srv.stdout, /Inbound-Sprechpfad/);
      assert.doesNotMatch(srv.stdout, /scope=/);
      assert.doesNotMatch(srv.stdout, /Inbound-EL: /);
      assert.doesNotMatch(srv.stdout, /Inbound-EL-Allowlist/);
      assert.doesNotMatch(srv.stdout, /el_inbound_scope_unknown|ELEVENLABS_INBOUND_SCOPE ist unbekannt/);
    } finally {
      await srv.stop();
    }
  });
}

test("Start mit unvollstaendigem EL-Zugang und alten Schluesseln bricht weiter ab", async () => {
  const { code, output } = await startServerExpectExit({
    env: {
      ELEVENLABS_INBOUND_SCOPE: "registrierte_dids",
      ELEVENLABS_INBOUND_TENANT_IDS: "t_x",
      ELEVENLABS_INIT_WEBHOOK_TOKEN: "",
    },
  });
  assert.equal(code, 1);
  assert.match(output, /Start abgebrochen: Der Zugang des EL-Inbound-Wegs ist unvollstaendig: ELEVENLABS_INIT_WEBHOOK_TOKEN fehlt/);
});
