import { test } from "node:test";
import assert from "node:assert/strict";

import { waitUntil, withFetch } from "../helpers.js";
import { fehlerausgabeVonAsync } from "../gemeinsam/fehlerausgabe.js";
import { HTTP_OK, baueHarness, beendeAktiveCalls, leererZustand, seedAusgehenderElCall } from "../_iel-inbound-harness.js";

const LAUFZEIT_S = 60;
const GESPRAECH = {
  conversation_id: "conv_poll_fristabbruch_5113",
  status: "done",
  transcript: [{ role: "agent", message: "Goodbye." }],
  analysis: {
    call_successful: "success",
    transcript_summary: "Done.",
    data_collection_results: { next_steps: { data_collection_id: "next_steps", value: "Bring the vehicle registration to the appointment on March 3." } },
  },
  metadata: { call_duration_secs: LAUFZEIT_S, termination_reason: "Client disconnected: 1000", error: null },
};

test("Fristabbruch beim Sichern des Anbieter-Ergebnisses im Nachlauf wird nicht gefangen: kein Ende, keine Abrechnung, keine Freigabe, keine Fehlermeldung", async () => {
  const state = leererZustand();
  const call = seedAusgehenderElCall(state, { answeredVorS: LAUFZEIT_S, mitGespraech: true });
  const freigegeben = [];
  const { el, store, gebucht } = baueHarness(state);
  store.addActionItem = () => {
    throw Object.assign(new Error("webhook_zustellung: Zugriffsfrist abgelaufen"), { frist: true });
  };
  store.leitungsplaetze = { freigeben: (id) => freigegeben.push(id) };
  const abgelehnt = [];
  const zaehler = (grund) => abgelehnt.push(String(grund));
  const laeuferListener = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", zaehler);
  let zeilen;
  let statusNachFrist;
  try {
    zeilen = await fehlerausgabeVonAsync(() =>
      withFetch(
        async () => ({ ok: true, status: HTTP_OK, json: async () => GESPRAECH }),
        async () => {
          await el.abfrageDurchLauf(call.id);
          await waitUntil(() => abgelehnt.length > 0);
        },
      ),
    );
  } finally {
    statusNachFrist = call.status;
    beendeAktiveCalls(state);
    process.off("unhandledRejection", zaehler);
    for (const listener of laeuferListener) process.on("unhandledRejection", listener);
  }

  assert.equal(abgelehnt[0], "Error: webhook_zustellung: Zugriffsfrist abgelaufen");

  assert.deepEqual(freigegeben, []);
  assert.deepEqual(gebucht, []);
  assert.equal(statusNachFrist, "active");
  assert.equal(zeilen.some((z) => z.includes("[el-nachlauf] Anbieter-Ergebnis nicht gesichert")), false, zeilen.join("\n"));
});

test("Ein Schreibfehler, dessen Text von einer Frist spricht, aber kein Fristabbruch ist, wird im Nachlauf gemeldet; Anrufende und Freigabe laufen", async () => {
  const state = leererZustand();
  const call = seedAusgehenderElCall(state, { answeredVorS: LAUFZEIT_S, mitGespraech: true });
  const freigegeben = [];
  const { el, store, gebucht } = baueHarness(state);
  store.addActionItem = () => {
    throw new Error("Zugriffsfrist abgelaufen, aber nur im Text");
  };
  store.leitungsplaetze = { freigeben: (id) => freigegeben.push(id) };
  const zeilen = await fehlerausgabeVonAsync(() =>
    withFetch(
      async () => ({ ok: true, status: HTTP_OK, json: async () => GESPRAECH }),
      async () => {
        await el.abfrageDurchLauf(call.id);
        await waitUntil(() => freigegeben.length > 0);
      },
    ),
  );

  assert.ok(zeilen.some((z) => z.includes("[el-nachlauf] Anbieter-Ergebnis nicht gesichert") && z.includes(`call=${call.id}`)), zeilen.join("\n"));
  assert.equal(call.status, "completed");
  assert.deepEqual(freigegeben, [call.id]);
  assert.deepEqual(gebucht, [1]);
});

for (const [name, ablehnen] of [["null", () => Promise.reject(null)], ["undefined", () => Promise.reject(undefined)]]) {
  test(`Scheitert das Sichern im Nachlauf mit ${name}, wird es gemeldet; Anrufende und Freigabe laufen`, async () => {
    const state = leererZustand();
    const call = seedAusgehenderElCall(state, { answeredVorS: LAUFZEIT_S, mitGespraech: true });
    const freigegeben = [];
    const { el, store, gebucht } = baueHarness(state);
    store.addActionItem = ablehnen;
    store.leitungsplaetze = { freigeben: (id) => freigegeben.push(id) };
    const zeilen = await fehlerausgabeVonAsync(() =>
      withFetch(
        async () => ({ ok: true, status: HTTP_OK, json: async () => GESPRAECH }),
        async () => {
          await el.abfrageDurchLauf(call.id);
          await waitUntil(() => freigegeben.length > 0);
        },
      ),
    );

    assert.ok(zeilen.some((z) => z.includes("[el-nachlauf] Anbieter-Ergebnis nicht gesichert") && z.includes(`call=${call.id}`)), zeilen.join("\n"));
    assert.equal(call.status, "completed");
    assert.deepEqual(freigegeben, [call.id]);
    assert.deepEqual(gebucht, [1]);
  });
}
