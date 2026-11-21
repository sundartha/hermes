import assert from "node:assert/strict";
import { test } from "node:test";

const { KOSTENPROFIL } = await import("../../src/billing/kostenarten.ts");
const { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } = await import("../pg-helpers.js");

const ABSENDER = "+4930555000330";
const ZIEL = "+4915112349941";

function eigenerAnruf(store) {
  const call = store.createCall({
    direction: "outbound",
    from: ABSENDER,
    to: ZIEL,
    goal: "Test",
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
  });
  return Object.assign(call, {
    status: "active",
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    answeredAt: "2026-01-01T00:00:00.000Z",
  });
}

function schreibtNachDerAktivenAbfrage(runner, schreibe) {
  const zustand = { aktiveGelesen: false, geschrieben: false };
  const huelle = {
    zustand,
    withClient: async (fn) => {
      if (zustand.aktiveGelesen && !zustand.geschrieben) {
        zustand.geschrieben = true;
        await schreibe();
      }
      return runner.withClient((client) =>
        fn({
          query: async (text, werte) => {
            const antwort = await client.query(text, werte);
            if (String(text).includes("status = 'active'")) zustand.aktiveGelesen = true;
            return antwort;
          },
        }),
      );
    },
  };
  return huelle;
}

async function zeileLoeschen(runner, id) {
  await runner.withClient(async (client) => {
    await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
    await client.query("DELETE FROM call WHERE id = $1", [id]);
  });
}

async function aufbau() {
  const { runner } = await makePgTestStore();
  const hook = { schreibe: async () => {} };
  const huelle = schreibtNachDerAktivenAbfrage(runner, () => hook.schreibe());
  const a = makePgStore(huelle);
  await a.init();
  const call = eigenerAnruf(a);
  await a.drainFlushes();
  await zeileLoeschen(runner, call.id);
  Object.assign(huelle.zustand, { aktiveGelesen: false, geschrieben: false });
  return { a, call, hook, runner };
}

test("5271-1: ein eigener Anruf, der zwischen den beiden Abfragen als active geschrieben wird, bleibt in aktiveAnrufeAlle", async () => {
  const { a, call, hook } = await aufbau();
  hook.schreibe = async () => {
    await a.persistCall(call.id);
  };
  assert.deepEqual(
    (await a.aktiveAnrufeAlle()).map((eintrag) => eintrag.id),
    [call.id],
  );
});

test("5271-2: ein eigener Anruf, den die Datenbank als beendet kennt, fällt aus aktiveAnrufeAlle heraus", async () => {
  const { a, call, hook } = await aufbau();
  hook.schreibe = async () => {
    call.status = "completed";
    await a.persistCall(call.id);
  };
  assert.deepEqual(await a.aktiveAnrufeAlle(), []);
});

test("5271-3: ein eigener Anruf ohne Zeile bleibt in aktiveAnrufeAlle", async () => {
  const { a, call } = await aufbau();
  assert.deepEqual(
    (await a.aktiveAnrufeAlle()).map((eintrag) => eintrag.id),
    [call.id],
  );
});
