import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const E164 = "+4915005550001";

async function speicherMitNummer() {
  const { store, db } = await makePgTestStore();
  await store.bootstrapTenant(E164, BOOTSTRAP_TENANT_ID, "telnyx");
  await store.drainFlushes();
  const { numbers } = store.load();
  const { id: nummernId } = numbers.find((nummer) => nummer.e164 === E164);
  const kennungInDatenbank = async () => {
    const { rows } = await db.query(
      "SELECT provider_agent_phone_number_id AS kennung FROM number WHERE e164 = $1",
      [E164],
    );
    const [zeile] = rows;
    return zeile.kennung;
  };
  return { store, nummernId, kennungInDatenbank };
}

test("registrierungAnhaengen: eine neue Kennung steht an der Nummer und in der Datenbank", async () => {
  const { store, nummernId, kennungInDatenbank } = await speicherMitNummer();
  store.registrierungAnhaengen(nummernId, "phnum_neu");
  await store.drainFlushes();
  assert.equal(await kennungInDatenbank(), "phnum_neu");
});

test("registrierungAnhaengen: eine vorhandene andere Kennung bleibt in Speicher und Datenbank", async () => {
  const { store, nummernId, kennungInDatenbank } = await speicherMitNummer();
  store.registrierungAnhaengen(nummernId, "phnum_alt");
  await store.drainFlushes();
  store.registrierungAnhaengen(nummernId, "phnum_neu");
  await store.drainFlushes();
  const { numbers } = store.load();
  assert.equal(numbers.find((nummer) => nummer.id === nummernId).providerAgentPhoneNumberId, "phnum_alt");
  assert.equal(await kennungInDatenbank(), "phnum_alt");
});
