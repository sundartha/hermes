import { test } from "node:test";
import assert from "node:assert/strict";
import { elevenlabsNummern } from "../../src/elevenlabs/nummern-port.ts";

const STATUS_NICHT_GEFUNDEN = 404;
const STATUS_BAD_GATEWAY = 502;
const EL = { apiKey: "xi_test_key", apiBase: "https://api.elevenlabs.io", agentId: "agent_x" };
const INBOUND = {
  sipUser: "sip_user_test",
  sipPassword: "p".repeat(32),
  initWebhookToken: "t".repeat(32),
  scope: "x",
};
const KONFIG = {
  provisioning: { provisioningEnabled: true },
  voice: { elevenLabsOutbound: EL, elevenLabsInbound: INBOUND },
};
const NUMMER = { id: "n_1", e164: "+493012345678", providerAgentPhoneNumberId: "phnum_1" };

function mitFetch(t, ersatz) {
  const zeilen = [];
  t.mock.method(globalThis, "fetch", ersatz);
  t.mock.method(console, "warn", (zeile) => zeilen.push(zeile));
  return zeilen;
}

test("Loeschversuch scheitert mit Anbieterstatus: die Warnung nennt genau diesen Status", async (t) => {
  const zeilen = mitFetch(t, async () => new Response("", { status: STATUS_NICHT_GEFUNDEN }));
  const registrar = elevenlabsNummern().sipRegistrarWennAktiv(KONFIG);
  const ergebnis = await registrar.removeRegistration("phnum_9");
  assert.deepEqual(ergebnis, { accepted: false, status: STATUS_NICHT_GEFUNDEN });
  assert.equal(zeilen.length, 1);
  assert.match(zeilen[0], /phone_number_id=phnum_9 status=404 - Waise/);
});

test("Loeschversuch ohne Antwort des Anbieters: die Warnung nennt status=unbekannt", async (t) => {
  const zeilen = mitFetch(t, async () => {
    throw new Error("Netz weg");
  });
  const registrar = elevenlabsNummern().sipRegistrarWennAktiv(KONFIG);
  await registrar.removeRegistration("phnum_9");
  assert.match(zeilen[0], /phone_number_id=phnum_9 status=unbekannt - Waise/);
});

test("Loeschversuch angenommen: keine Warnung", async (t) => {
  const zeilen = mitFetch(t, async () => new Response("", { status: 200 }));
  const registrar = elevenlabsNummern().sipRegistrarWennAktiv(KONFIG);
  assert.deepEqual(await registrar.removeRegistration("phnum_9"), { accepted: true, status: 200 });
  assert.deepEqual(zeilen, []);
});

test("Trunk-Schreiben scheitert ohne Anbieterstatus (Netzfehler): die Warnung nennt status=unbekannt", async (t) => {
  const zeilen = mitFetch(t, async () => {
    throw new Error("Netz weg");
  });
  const schreiber = elevenlabsNummern().inboundTrunkSchreiberWennErlaubt(KONFIG);
  await schreiber.ensureInboundTrunk(NUMMER);
  assert.ok(zeilen.includes("[el-trunk] schreiben_fehlgeschlagen nummer_id=n_1 status=unbekannt"));
});

test("Trunk-Schreiben scheitert mit Anbieterstatus: die Warnung nennt genau diesen Status", async (t) => {
  const zeilen = mitFetch(t, async (url, init) =>
    init.method === "PATCH" ? new Response("{}", { status: STATUS_BAD_GATEWAY }) : new Response("{}", { status: 200 }),
  );
  const schreiber = elevenlabsNummern().inboundTrunkSchreiberWennErlaubt(KONFIG);
  await schreiber.ensureInboundTrunk(NUMMER);
  assert.ok(zeilen.includes("[el-trunk] schreiben_fehlgeschlagen nummer_id=n_1 status=502"));
});
