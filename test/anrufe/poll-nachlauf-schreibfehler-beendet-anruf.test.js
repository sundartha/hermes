import { test } from "node:test";
import assert from "node:assert/strict";

import { CONVERSATION_DONE_WITH_ANALYSIS } from "../fixtures/elevenlabs-conversations.js";
import { waitUntil, withFetch } from "../helpers.js";
import { fehlerausgabeVonAsync } from "../gemeinsam/fehlerausgabe.js";
import { HTTP_OK, baueElMitStore, baueStore, leererZustand, seedAusgehenderElCall } from "../_iel-inbound-harness.js";

const LAUFZEIT_S = 60;

test("Schreibfehler beim Sichern des Anbieter-Ergebnisses im Nachlauf: Fehler wird gemeldet, Anrufende und Leitungsplatz-Freigabe laufen trotzdem", async () => {
  const state = leererZustand();
  const call = seedAusgehenderElCall(state, { answeredVorS: LAUFZEIT_S, mitGespraech: true });
  const freigegeben = [];
  const store = {
    ...baueStore(state, { detektorZaehlungen: [] }),
    recordProviderCallResult: () => {
      throw new Error("db weg 5113");
    },
    leitungsplaetze: { freigeben: (id) => freigegeben.push(id) },
  };
  const el = baueElMitStore(store);
  const unbehandelt = [];
  const zaehler = (grund) => unbehandelt.push(String(grund));
  process.on("unhandledRejection", zaehler);
  let zeilen;
  try {
    zeilen = await fehlerausgabeVonAsync(() =>
      withFetch(
        async () => ({ ok: true, status: HTTP_OK, json: async () => CONVERSATION_DONE_WITH_ANALYSIS }),
        async () => {
          await el.abfrageDurchLauf(call.id);
          await waitUntil(() => freigegeben.length > 0);
        },
      ),
    );
  } finally {
    process.off("unhandledRejection", zaehler);
  }

  assert.ok(zeilen.some((z) => z.includes("[el-nachlauf] Anbieter-Ergebnis nicht gesichert") && z.includes(call.id) && z.includes("db weg 5113")), zeilen.join("\n"));
  assert.equal(call.status, "completed");
  assert.ok(call.endedAt);
  assert.deepEqual(freigegeben, [call.id]);
  assert.deepEqual(unbehandelt, []);
});
