import assert from "node:assert/strict";
import { test } from "node:test";

import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.ts";
import { OHNE_EL_ZUGANG, withConfigNamespaces } from "../config-namespaces-helper.js";
import { legeMandantAn, makePgTestStore } from "../pg-helpers.js";

const MANDANT = "t_vergabe";
const NUMMER = "num_vergabe";
const SETZEN = "UPDATE tenant SET number_provision_skip_reason = $2 WHERE id = $1";
const LESEN = "SELECT number_provision_skip_reason AS grund FROM tenant WHERE id = $1";

const ablehnung = (grund) => () => ({ ok: false, fehler: grund });

async function ausloesen(vergabe, { imSpeicher = null, inDatenbank = null, provisioningEnabled = false } = {}) {
  const { store, db } = await makePgTestStore();
  await legeMandantAn(store, MANDANT);
  await db.query(SETZEN, [MANDANT, inDatenbank]);
  const zustand = store.load();
  zustand.tenants.push({ id: MANDANT, status: "active", numberProvisionSkipReason: imSpeicher });
  const spur = { zustand, audit: [], eingereiht: [] };
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: withConfigNamespaces({ ...OHNE_EL_ZUGANG, paymentEnabled: false, provisioningEnabled, maxNumbers: 5, maxNumbersPerTenant: 1 }),
    queue: { enqueue: async (auftrag) => spur.eingereiht.push(auftrag), drain: async () => {} },
    billing: {},
    metering: {},
    numberProvisioning: () => ({}),
    handleProvisionJob: async () => ({}),
    resolveProvisionRetry: vergabe,
    audit: (aktion, _kennung, detail) => spur.audit.push([aktion, detail]),
    recordProvisioningJob: () => null,
    markProvisioningJob: () => null,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber: () => null,
  });
  spur.ergebnis = await orchestrator.triggerTenantProvisioning(MANDANT);
  await store.drainFlushes();
  await db.query("SELECT set_config('app.current_tenant', $1, false)", [MANDANT]);
  const { rows } = await db.query(LESEN, [MANDANT]);
  spur.vermerk = rows[0].grund;
  return spur;
}

test("Lehnt die Vergabe wegen der Plattformgrenze ab, nennt die Antwort den Grund und der Vermerk wird gespeichert", async () => {
  const spur = await ausloesen(ablehnung("global_cap"), { imSpeicher: "global_cap", inDatenbank: null });

  assert.deepEqual(spur.ergebnis, { ok: false, fehler: "global_cap" });
  assert.equal(spur.vermerk, "global_cap");
  assert.deepEqual(spur.audit, [["webhook_provision_skipped", `tenant=${MANDANT} grund=global_cap`]]);
});

test("Lehnt die Vergabe einen Mandanten ohne Abo ab, wird nichts gespeichert und nichts gekauft", async () => {
  const spur = await ausloesen(ablehnung("tenant_inactive"), { imSpeicher: "tenant_inactive", inDatenbank: null });

  assert.deepEqual(spur.ergebnis, { ok: false, fehler: "tenant_inactive" });
  assert.equal(spur.vermerk, null);
  assert.deepEqual(spur.zustand.numbers, []);
  assert.deepEqual(spur.eingereiht, []);
});

test("Hat der Mandant schon eine Nummer, nennt die Antwort das ohne Pruefprotokoll-Zeile", async () => {
  const spur = await ausloesen(ablehnung("already_provisioned"));

  assert.deepEqual(spur.ergebnis, { ok: false, fehler: "already_provisioned" });
  assert.deepEqual(spur.audit, []);
});

test("Ein haengender Auftrag wird mit seiner Nummer erneut eingereiht", async () => {
  const job = { id: "job_vergabe", numberId: NUMMER, tenantId: MANDANT, idempotencyKey: `provision_${NUMMER}` };
  const wert = { reason: "redrive", numberId: NUMMER, jobId: job.id, job };

  const spur = await ausloesen(() => ({ ok: true, wert }), { provisioningEnabled: true });

  assert.deepEqual(spur.ergebnis, { ok: true, wert: { reason: "redrive", numberId: NUMMER, jobId: job.id } });
  assert.deepEqual(spur.eingereiht, [{ kind: "provision_number", payload: { numberId: NUMMER }, idempotencyKey: job.idempotencyKey }]);
});

test("Eine neue Anfrage ohne Kauffreigabe speichert den geraeumten Vermerk und wird als Probelauf gemeldet", async () => {
  const number = { id: NUMMER, tenantId: MANDANT, provider: "telnyx", status: "requested", country: "US", language: "en" };
  const vergabe = (zustand) => {
    zustand.numbers.push(number);
    return { ok: true, wert: { number } };
  };

  const spur = await ausloesen(vergabe, { imSpeicher: null, inDatenbank: "global_cap" });

  assert.deepEqual(spur.ergebnis, { ok: true, wert: { reason: "dry_run", numberId: NUMMER } });
  assert.equal(spur.vermerk, null);
  assert.deepEqual(spur.zustand.numbers.map((nummer) => nummer.id), [NUMMER]);
});
