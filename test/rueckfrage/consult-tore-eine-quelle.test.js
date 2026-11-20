import assert from "node:assert/strict";
import { test } from "node:test";

import { config } from "../../src/config.js";
import { consultAllowedFor, consultToreFor } from "../../src/consult/gate.js";
import { makeConfigOverrides } from "../helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const FAELLE = [
  { name: "alles offen", master: true, kontext: true, mandant: true, inCall: true },
  { name: "Master zu", master: false, kontext: true, mandant: true, inCall: false },
  { name: "Kontext zu", master: true, kontext: false, mandant: true, inCall: true },
  { name: "Mandant zu", master: true, kontext: true, mandant: false, inCall: false },
  { name: "alles zu", master: false, kontext: false, mandant: false, inCall: false },
];

for (const f of FAELLE) {
  test(`consult-tore: ${f.name} - Tore und Freigabe stammen aus einer Quelle`, () => {
    withConfigOverrides(
      {
        consultEnabled: f.master,
        assistantContextEnabled: f.kontext,
        inCallConsultEnabled: f.inCall,
      },
      () => {
        const profile = { allowConsult: f.mandant };
        assert.deepEqual(consultToreFor(profile), {
          master: f.master,
          kontext: f.kontext,
          mandant: f.mandant,
          in_call: f.inCall,
        });
        assert.equal(consultAllowedFor(profile), f.master && f.kontext && f.mandant);
      },
    );
  });
}

test("consult-tore: ohne Profil ist das Mandanten-Tor zu", () => {
  withConfigOverrides({ consultEnabled: true, assistantContextEnabled: true }, () => {
    assert.equal(consultToreFor(null).mandant, false);
    assert.equal(consultAllowedFor(undefined), false);
  });
});
