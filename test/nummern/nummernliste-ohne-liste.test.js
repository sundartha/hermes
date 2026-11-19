import { test } from "node:test";
import assert from "node:assert/strict";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.js";
import { makeMemoryQueue } from "../../src/queue/adapters/memory/queue.ts";
import { findNumber, makeDefaultState, markProvisioningJob, recordProvisioningJob } from "../../src/store/state-ops.js";
import { NUMBER_STATUS } from "../../src/begriffe/nummern.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { withFetch } from "../helpers.js";

const EL_OUTBOUND = Object.freeze({ apiKey: "xi_test_key", apiBase: "https://api.elevenlabs.io", agentId: "agent_x" });
const HTTP_OK = 200;
const E164 = "+18643028341";
const FEHLERTEXT = "ElevenLabs Nummernliste: Antwort ohne Liste";
const NUMMER = "num_liste_1";
const TENANT = "t_liste";

async function sipRegistrarAusDrain() {
  const state = makeDefaultState();
  state.numbers = [{ id: NUMMER, tenantId: TENANT, status: NUMBER_STATUS.REQUESTED, e164: null, country: "DE" }];
  const erfasst = [];
  const orchestrator = makeProvisioningOrchestrator({
    store: { load: () => state, save: () => {}, withStoreLock: async (arbeit) => arbeit() },
    config: withConfigNamespaces({
      provisioningEnabled: true,
      paymentEnabled: false,
      telnyxSipTrunkUsername: "trunk_user",
      telnyxSipTrunkPassword: "trunk_pw",
      elevenLabsOutbound: EL_OUTBOUND,
      elevenLabsInbound: { enabled: false },
    }),
    queue: makeMemoryQueue(),
    billing: {},
    metering: {},
    numberProvisioning: () => ({}),
    handleProvisionJob: (_state, _job, deps) => {
      erfasst.push(deps);
      return { number: null };
    },
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob,
    markProvisioningJob,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber,
  });
  await orchestrator.queueProvisioning(NUMMER, TENANT);
  await orchestrator.runProvisioningDrainExclusive();
  return erfasst[0].sipRegistrar;
}

function antwortMit(inhalt) {
  return async (_url, init = {}) => ({
    ok: true,
    status: HTTP_OK,
    json: async () => (init.method === "POST" ? { phone_number_id: "phnum_new" } : inhalt),
  });
}

for (const [name, antwort] of [
  ["null", null],
  ["Objekt", { phone_numbers: [] }],
  ["Text", "keine Liste"],
]) {
  test(`Nummernliste: Antwort ${name} wirft Fehler mit Ursache statt TypeError`, async () => {
    const registrar = await sipRegistrarAusDrain();
    await withFetch(antwortMit(antwort), () =>
      assert.rejects(
        registrar.ensureRegistration({ e164: E164, numberId: NUMMER }),
        (fehler) => fehler instanceof Error && !(fehler instanceof TypeError) && fehler.message === FEHLERTEXT,
      ),
    );
  });
}

test("Nummernliste: Antwort mit leerer Liste legt die Nummer an", async () => {
  const registrar = await sipRegistrarAusDrain();
  const ergebnis = await withFetch(antwortMit([]), () => registrar.ensureRegistration({ e164: E164, numberId: NUMMER }));
  assert.deepEqual(ergebnis, { phoneNumberId: "phnum_new", angelegt: true });
});
