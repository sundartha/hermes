// afix-p1 Regressionstest (Review-Blocker G26/G11, Runde 1; Fixture-Shape korrigiert in
// Runde 2): der Kommentar in buildAssistantConfig behauptete unhedged, der Update-POST sei
// ein Deep-Merge, sodass NUR telephony_settings.user_idle_reply_secs gesendet werden darf und
// PRESERVED_SAFETY_FIELDS (allen voran der assistant-seitige Sicherheits-Cap time_limit_secs,
// Absolute Regel 1) unveraendert ueberleben. Diese Annahme ist live UNBESTAETIGT -
// sendAssistantConfig verifiziert sie deshalb jetzt aktiv per GET vor/nach dem Update, statt
// ihr blind zu vertrauen. Rein offline: global.fetch gestubbt (Muster
// test/telnyx-messaging.test.js), pro Test gespeichert/wiederhergestellt.
//
// Runde 2: die GET-Fixtures unten bilden die REAL per GET verifizierte Telnyx-Objektform ab
// (tasks/assistant-fix-spec.md, Bestandsaufnahme) - time_limit_secs, recording_settings und
// default_texml_app_id liegen VERSCHACHTELT unter telephony_settings, NUR transcription liegt
// top-level. Eine top-level-Fixture (wie in Runde 1) haette den Guard nie wirklich pruefen
// koennen: preservedFieldSnapshot() haette fuer die drei verschachtelten Felder immer ein
// leeres Snapshot geliefert und fieldsLostOnUpdate() waere immer leer geblieben, ganz gleich
// was der Code tut (falscher gruener Test, Lehre rca-lessons-timezone-and-fixtures).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import {
  sendAssistantConfig,
  fieldsLostOnUpdate,
  preservedFieldSnapshot,
} from "../scripts/telnyx-assistant-provision.mjs";

const MINIMAL_CONFIG = { telephony_settings: { user_idle_reply_secs: 4 } };

// Realistische Assistant-Objektform (Bestandsaufnahme-Werte, s. Kopf-Kommentar): drei der
// vier Sicherheitsfelder unter telephony_settings, transcription top-level.
function assistantWithSafetyFields(overrides = {}) {
  return {
    id: "asst_1",
    telephony_settings: {
      user_idle_reply_secs: 10,
      time_limit_secs: 1800,
      recording_settings: { enabled: true, channels: "dual", format: "mp3" },
      default_texml_app_id: "texml_app_1",
    },
    transcription: { model: "deepgram/flux", language: "multi" },
    ...overrides,
  };
}

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

// Regressionstest fuer Review-Blocker Runde 2: preservedFieldSnapshot() muss die drei
// verschachtelten Felder ueber telephony_settings lesen (NICHT assistant[field] top-level),
// sonst liefert sie fuer diese immer {} und der Guard in sendAssistantConfig ist wirkungslos.
test("preservedFieldSnapshot: liest time_limit_secs/recording_settings/default_texml_app_id VERSCHACHTELT unter telephony_settings, transcription top-level", () => {
  const snapshot = preservedFieldSnapshot(assistantWithSafetyFields());
  assert.deepEqual(snapshot, {
    time_limit_secs: 1800,
    recording_settings: { enabled: true, channels: "dual", format: "mp3" },
    default_texml_app_id: "texml_app_1",
    transcription: { model: "deepgram/flux", language: "multi" },
  });
});

test("preservedFieldSnapshot: fehlendes telephony_settings-Objekt -> kein Crash, leeres Snapshot fuer die verschachtelten Felder", () => {
  assert.deepEqual(preservedFieldSnapshot({ id: "asst_1" }), {});
  assert.deepEqual(preservedFieldSnapshot(undefined), {});
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
  const stableSnapshot = { data: assistantWithSafetyFields() };
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

// Bildet das genaue Runde-2-Risiko nach: der Update-POST sendet NUR
// telephony_settings.user_idle_reply_secs (MINIMAL_CONFIG); ersetzt Telnyx telephony_settings
// dabei als Ganzes statt es zu mergen, verschwinden time_limit_secs (Absolute Regel 1),
// recording_settings und default_texml_app_id gleichzeitig - alle drei muessen im Fehler
// benannt werden, transcription (top-level, unveraendert) NICHT.
test("sendAssistantConfig: Update ersetzt telephony_settings als Ganzes -> wirft mit allen 3 verschachtelten Feldern (Merge-Annahme widerlegt), KEIN falsch-gruener Erfolg", async () => {
  config.telnyxApiBase = "https://telnyx.test";
  config.telnyxApiKey = "test-key";
  await withQueuedFetch(
    [
      { json: { data: assistantWithSafetyFields() } }, // GET vorher: alle Sicherheitsfelder gesetzt
      { json: { data: { id: "asst_1" } } }, // POST-Update-Antwort
      {
        json: {
          data: assistantWithSafetyFields({
            // telephony_settings komplett ersetzt: NUR das gesendete Feld ueberlebt.
            telephony_settings: { user_idle_reply_secs: 4 },
          }),
        },
      },
    ],
    async () => {
      await assert.rejects(
        () => sendAssistantConfig(MINIMAL_CONFIG, "asst_1"),
        (err) => {
          assert.match(err.message, /Merge-Annahme widerlegt/);
          assert.match(err.message, /time_limit_secs/);
          assert.match(err.message, /recording_settings/);
          assert.match(err.message, /default_texml_app_id/);
          assert.ok(!/transcription/.test(err.message), "transcription blieb unveraendert -> kein Verlust");
          return true;
        },
      );
    },
  );
});
