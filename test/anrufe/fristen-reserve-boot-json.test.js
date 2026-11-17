import assert from "node:assert/strict";
import { test } from "node:test";
import { waitUntil } from "../helpers.js";
import { geldBootJsonStarten } from "./geld-boot-json-aufbau.mjs";

const FRIST_BIS_FREIGABE_MS = 10_000;
const MINUTE_MS = 60_000;
const RESERVE_CENTS = 40;
const MANDANT = "t_geld_boot_json";

const { store } = await geldBootJsonStarten({});

function beendeterAnrufMitReserve({ fristInMinuten }) {
  const call = store.createCall({
    direction: "outbound",
    from: "+4915799990052",
    to: "+4915799990053",
    tenantId: MANDANT,
    provider: "telnyx",
    twilioSid: `CA_reserve_boot_json_${String(fristInMinuten)}`,
    reserveCents: RESERVE_CENTS,
  });
  call.status = "completed";
  call.fristReserveAt = new Date(Date.now() + fristInMinuten * MINUTE_MS).toISOString();
  store.save();
  return call.id;
}

test("Kriterium 4: im JSON-Speicher gibt der Boot-Takt die Reserve eines Anrufs frei, dessen Reserve-Frist abgelaufen ist, und leert die Frist; die Reserve eines Anrufs mit Frist in der Zukunft bleibt", async () => {
  store.load().reservations[MANDANT] = 2 * RESERVE_CENTS;
  const faellig = beendeterAnrufMitReserve({ fristInMinuten: -1 });
  const spaeter = beendeterAnrufMitReserve({ fristInMinuten: 60 });
  await waitUntil(() => store.getCall(faellig)?.fristReserveAt === null, { timeoutMs: FRIST_BIS_FREIGABE_MS });
  assert.equal(store.getCall(faellig).reserveReleased, true);
  assert.equal(store.reservationOf(MANDANT), RESERVE_CENTS);
  assert.equal(store.getCall(spaeter).reserveReleased, false);
  assert.notEqual(store.getCall(spaeter).fristReserveAt, null);
});

test("Kriterium 4: eine zweite Freigabe derselben Reserve aendert den Stand nicht", async () => {
  store.load().reservations[MANDANT] = RESERVE_CENTS;
  const id = beendeterAnrufMitReserve({ fristInMinuten: -1 });
  await waitUntil(() => store.getCall(id)?.fristReserveAt === null, { timeoutMs: FRIST_BIS_FREIGABE_MS });
  assert.equal(store.reservationOf(MANDANT), 0);
  await store.setzeReserveFrist({ callId: id, tenantId: MANDANT, faelligAt: new Date(Date.now() - MINUTE_MS).toISOString() });
  store.load().reservations[MANDANT] = 7;
  await waitUntil(() => store.getCall(id)?.fristReserveAt === null, { timeoutMs: FRIST_BIS_FREIGABE_MS });
  assert.equal(store.reservationOf(MANDANT), 7);
});
