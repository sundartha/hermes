import assert from "node:assert/strict";
import { test } from "node:test";
import { waitUntil } from "../helpers.js";
import { geldBootJsonStarten } from "./geld-boot-json-aufbau.mjs";

const FRIST_MS = 10_000;
const RESERVE_CENTS = 40;
const MANDANT = "t_geld_boot_json";

const { store } = await geldBootJsonStarten({});

function beendeterAnrufMitReserve() {
  const call = store.createCall({
    direction: "outbound",
    from: "+4915799990052",
    to: "+4915799990053",
    tenantId: MANDANT,
    provider: "telnyx",
    twilioSid: "CA_reserve_fehler_boot_json",
    reserveCents: RESERVE_CENTS,
  });
  call.status = "completed";
  call.fristReserveAt = "2026-01-01T00:00:00.000Z";
  store.save();
  return call.id;
}

test("Reserve-Frist bleibt gesetzt, solange die Freigabe der Reserve scheitert, und wird nach gelungener Freigabe geleert", async (t) => {
  store.load().reservations[MANDANT] = RESERVE_CENTS;
  const echt = store.budgetReservierung.freigeben;
  let versuche = 0;
  t.mock.method(console, "error", () => {});
  store.budgetReservierung.freigeben = async (anfrage) => {
    versuche += 1;
    if (versuche <= 3) throw new Error("datenbank weg");
    return echt(anfrage);
  };
  const id = beendeterAnrufMitReserve();
  await waitUntil(() => versuche >= 3, { timeoutMs: FRIST_MS });
  assert.notEqual(store.getCall(id).fristReserveAt, null);
  await waitUntil(() => store.getCall(id)?.fristReserveAt === null, { timeoutMs: FRIST_MS });
  assert.ok(versuche >= 4);
  assert.equal(store.getCall(id).reserveReleased, true);
});

test("Anrufende bleibt fehlertolerant: scheitert die Freigabe, loggt releaseReserve ohne Option und wirft nicht", async (t) => {
  const { makeCallFinish } = await import("../../src/telephony/call-finish.js");
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { releaseReserve } = makeCallFinish({
    store,
    budgetReservierung: {
      freigeben: async () => {
        throw new Error("datenbank weg");
      },
    },
  });
  const anruf = store.createCall({ direction: "outbound", from: "+4915799990052", to: "+4915799990053", tenantId: MANDANT, provider: "telnyx", twilioSid: "CA_reserve_fehler_zwei", reserveCents: RESERVE_CENTS });
  await releaseReserve(anruf);
  assert.deepEqual(zeilen, ["[reserve] release: datenbank weg"]);
  await assert.rejects(releaseReserve(anruf, { wirfBeiFehler: true }), /datenbank weg/);
});
