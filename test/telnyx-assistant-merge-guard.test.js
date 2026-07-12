// afix-p1 Regressionstest (Review-Blocker G26/G11, Runde 1): der Kommentar in
// buildAssistantConfig behauptete unhedged, der Update-POST sei ein Deep-Merge, sodass NUR
// telephony_settings.user_idle_reply_secs gesendet werden darf und PRESERVED_SAFETY_FIELDS
// (allen voran der assistant-seitige Sicherheits-Cap time_limit_secs, Absolute Regel 1)
// unveraendert ueberleben. Diese Annahme ist live UNBESTAETIGT - sendAssistantConfig
// verifiziert sie deshalb jetzt aktiv per GET vor/nach dem Update, statt ihr blind zu
// vertrauen. Rein offline: global.fetch gestubbt (Muster test/telnyx-messaging.test.js),
// pro Test gespeichert/wiederhergestellt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { sendAssistantConfig, fieldsLostOnUpdate } from "../scripts/telnyx-assistant-provision.mjs";

const MINIMAL_CONFIG = { telephony_settings: { user_idle_reply_secs: 4 } };

// Liefert der Reihe nach die uebergebenen Antworten (ein Eintrag pro erwartetem fetch-Call);
// zeichnet URL+Methode fuer Assertions auf. fetch wird nach dem Test wiederhergestellt.
function withQueuedFetch(responses, fn) {
  const original = global.fetch;
  const calls = [];
  let next = 0;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET" });
    const r = responses[Math.min(next, responses.length - 1)];
    next += 1;
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.json ?? {},
      text: async () => r.text ?? JSON.stringify(r.json ?? {}),
    };
  };
  return Promise.resolve(fn(calls)).finally(() => {
    global.fetch = original;
  });
}

test("fieldsLostOnUpdate: verschwundenes Feld -> im Ergebnis; unveraendert -> leer; nie-vorhandenes Feld ist kein Verlust", () => {
  assert.deepEqual(fieldsLostOnUpdate({ time_limit_secs: 900 }, {}), ["time_limit_secs"]);
  assert.deepEqual(fieldsLostOnUpdate({ time_limit_secs: 900 }, { time_limit_secs: 900 }), []);
  assert.deepEqual(fieldsLostOnUpdate({ time_limit_secs: 900 }, { time_limit_secs: 600 }), [
    "time_limit_secs",
  ]);
  // Feld, das VORHER schon fehlte, ist kein "Verlust" (nie konfiguriert -> kein Merge-Beweis noetig).
  assert.deepEqual(fieldsLostOnUpdate({}, { recording_settings: { type: "all" } }), []);
});

test("sendAssistantConfig: Create (kein existingId) macht GENAU EINEN POST, KEIN Merge-Check", async () => {
  config.telnyxApiBase = "https://telnyx.test";
  config.telnyxApiKey = "test-key";
  await withQueuedFetch([{ json: { data: { id: "asst_new" } } }], async (calls) => {
    const id = await sendAssistantConfig(MINIMAL_CONFIG, "");
    assert.equal(id, "asst_new");
    assert.equal(calls.length, 1, "Create braucht keinen Vorher/Nachher-GET (nichts zu verlieren)");
    assert.equal(calls[0].method, "POST");
  });
});

test("sendAssistantConfig: Update, Sicherheitsfelder unveraendert -> GET/POST/GET, id kommt durch", async () => {
  config.telnyxApiBase = "https://telnyx.test";
  config.telnyxApiKey = "test-key";
  const stableSnapshot = {
    data: { id: "asst_1", time_limit_secs: 900, recording_settings: { type: "all" } },
  };
  await withQueuedFetch(
    [
      { json: stableSnapshot }, // GET vorher
      { json: { data: { id: "asst_1" } } }, // POST-Update-Antwort
      { json: stableSnapshot }, // GET nachher - identisch
    ],
    async (calls) => {
      const id = await sendAssistantConfig(MINIMAL_CONFIG, "asst_1");
      assert.equal(id, "asst_1");
      assert.deepEqual(
        calls.map((c) => c.method),
        ["GET", "POST", "GET"],
      );
      assert.ok(
        calls[0].url.endsWith("/v2/ai/assistants/asst_1"),
        "GET vorher zielt auf die bestehende ID",
      );
      assert.ok(
        calls[1].url.endsWith("/v2/ai/assistants/asst_1"),
        "Update-POST zielt auf die bestehende ID",
      );
      assert.ok(
        calls[2].url.endsWith("/v2/ai/assistants/asst_1"),
        "GET nachher zielt auf die bestehende ID",
      );
    },
  );
});

test("sendAssistantConfig: Update loescht time_limit_secs -> wirft (Merge-Annahme widerlegt), KEIN falsch-gruener Erfolg", async () => {
  config.telnyxApiBase = "https://telnyx.test";
  config.telnyxApiKey = "test-key";
  await withQueuedFetch(
    [
      { json: { data: { id: "asst_1", time_limit_secs: 900 } } }, // GET vorher: Cap gesetzt
      { json: { data: { id: "asst_1" } } }, // POST-Update-Antwort
      { json: { data: { id: "asst_1" } } }, // GET nachher: Cap verschwunden
    ],
    async () => {
      await assert.rejects(
        () => sendAssistantConfig(MINIMAL_CONFIG, "asst_1"),
        (err) => {
          assert.match(err.message, /Merge-Annahme widerlegt/);
          assert.match(err.message, /time_limit_secs/);
          return true;
        },
      );
    },
  );
});
