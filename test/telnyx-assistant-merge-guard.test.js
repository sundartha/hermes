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
//
// 2. Review-Runde (MAJOR-2/MAJOR-3, PLAN-CONVERSATION-OPTIMIZATION.md):
// - MAJOR-2: die K1/K2-Verifikation (fieldsNotApplied) stand komplett im existingId-Zweig -
//   ein Create-Lauf (kein existingId) meldete smokePass=true, OHNE K1/K2 je gegengeprueft zu
//   haben. sendAssistantConfig macht jetzt IMMER einen GET-nach-Update/-Create; nur der
//   fieldsLostOnUpdate-Merge-Check bleibt Update-only (er braucht ein "Vorher").
// - MAJOR-3: APPLIED_FIELDS_TO_VERIFY trug bisher background_audio als GANZES Objekt,
//   fieldsNotApplied verglich per JSON.stringify - reihenfolge-sensitiv und intolerant gegen
//   Zusatzfelder, die Telnyx an anderer Stelle im selben Objekt ergaenzen koennte (z.B.
//   media_url:null aus der oneOf-Union). Jetzt werden nur noch die SKALAREN Blaetter
//   (background_audio_value, background_audio_volume) mit === verglichen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import {
  sendAssistantConfig,
  fieldsLostOnUpdate,
  preservedFieldSnapshot,
  fieldsNotApplied,
  appliedFieldSnapshot,
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

// MAJOR-2-Fix (2. Review-Runde): Create macht KEINEN Vorher-GET (kein existingId, nichts zu
// verlieren -> KEIN Merge-Check), aber SEHR WOHL einen Nachher-GET - die K1/K2-Verifikation
// (fieldsNotApplied) laeuft jetzt auch beim Create. calls.length ist deshalb 2 (POST+GET),
// nicht mehr 1 (Bestand vor MAJOR-2 - s. die beiden dedizierten Tests unten).
test("sendAssistantConfig: Create (kein existingId) macht POST + Nachher-GET, KEIN Merge-Check", async () => {
  config.telephony.telnyxApiBase = "https://telnyx.test";
  config.telephony.telnyxApiKey = "test-key";
  await withQueuedFetch([{ json: { data: { id: "asst_new" } } }], async (calls) => {
    const id = await sendAssistantConfig(MINIMAL_CONFIG, "");
    assert.equal(id, "asst_new");
    assert.deepEqual(
      calls.map((c) => c.method),
      ["POST", "GET"],
      "Create macht keinen Vorher-GET (nichts zu verlieren), aber einen Nachher-GET (K1/K2)",
    );
    assert.ok(
      calls[1].url.endsWith("/v2/ai/assistants/asst_new"),
      "Nachher-GET zielt auf die frische ID",
    );
  });
});

test("sendAssistantConfig: Update, Sicherheitsfelder unveraendert -> GET/POST/GET, id kommt durch", async () => {
  config.telephony.telnyxApiBase = "https://telnyx.test";
  config.telephony.telnyxApiKey = "test-key";
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
  config.telephony.telnyxApiBase = "https://telnyx.test";
  config.telephony.telnyxApiKey = "test-key";
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
          assert.ok(
            !/transcription/.test(err.message),
            "transcription blieb unveraendert -> kein Verlust",
          );
          return true;
        },
      );
    },
  );
});

// S3-5 (Review-Befund, PLAN-CONVERSATION-OPTIMIZATION.md K1/K2): interrupt_prediction_threshold
// fehlt in der oeffentlichen Telnyx-OpenAPI-Spec - der wahrscheinlichste Fehlermodus ist ein
// STILLER Drop beim Schreiben (POST bleibt 200, das Feld verschwindet einfach). Diese Tests
// bilden genau dieses Risiko nach: derselbe GET-nach-Update-Ablauf wie oben, jetzt zusaetzlich
// gegen die gesendeten K1/K2-Werte geprueft.
const K_CONFIG = {
  telephony_settings: { user_idle_reply_secs: 4 },
  interruption_settings: { enable: true, interrupt_prediction_threshold: 0.4 },
  voice_settings: {
    voice: "ElevenLabs.Default.voice_xyz",
    background_audio: { type: "predefined_media", value: "office", volume: 0.3 },
  },
};

// MAJOR-3-Fix (2. Review-Runde): background_audio ist jetzt als ZWEI SKALARE Blaetter
// eingetragen (background_audio_value/-_volume), nicht mehr als verschachteltes Objekt -
// appliedFieldSnapshot liest ueber readByPath weiterhin generisch, liefert fuer die tieferen
// Pfade jetzt aber Zahl/String statt eines Objekts.
// AL-P3: K_CONFIG hat kein start_speaking_plan -> undefined ist der korrekte Snapshot-Wert;
// ein Weglassen im Snapshot wuerde den Drop-Guard fuer die vier neuen Blaetter blind machen.
test("appliedFieldSnapshot: liest interrupt_prediction_threshold + background_audio_value/-_volume ueber den vollen Pfad", () => {
  const snapshot = appliedFieldSnapshot(K_CONFIG);
  assert.deepEqual(snapshot, {
    interrupt_prediction_threshold: 0.4,
    background_audio_value: "office",
    background_audio_volume: 0.3,
    start_speaking_wait_seconds: undefined,
    endpointing_on_punctuation_seconds: undefined,
    endpointing_on_no_punctuation_seconds: undefined,
    endpointing_on_number_seconds: undefined,
  });
});

test("fieldsNotApplied: abweichender/fehlender Wert -> im Ergebnis; identisch -> leer", () => {
  assert.deepEqual(
    fieldsNotApplied(
      { interrupt_prediction_threshold: 0.4 },
      { interrupt_prediction_threshold: undefined },
    ),
    ["interrupt_prediction_threshold"],
  );
  assert.deepEqual(
    fieldsNotApplied(
      { interrupt_prediction_threshold: 0.4 },
      { interrupt_prediction_threshold: 0.4 },
    ),
    [],
  );
});

// MAJOR-3 (2. Review-Runde, der eigentliche Regressionsschutz): beweist, dass der Guard NICHT
// wirft, wenn Telnyx' GET-Antwort zusaetzliche Felder enthaelt (media_url:null aus der
// oneOf-Union, die WIR nicht gesendet haben) oder die Keys in ANDERER Reihenfolge liefert als
// K_CONFIG (dort: type, value, volume - hier: media_url, volume, value, type). Der alte
// JSON.stringify-Deep-Equal (Bestand vor MAJOR-3) haette in genau diesem, realistischen Fall
// GEWORFEN, obwohl der POST erfolgreich war.
test("MAJOR-3: fieldsNotApplied/appliedFieldSnapshot tolerieren Telnyx-Zusatzfelder und andere Key-Reihenfolge in background_audio", () => {
  const sentSnapshot = appliedFieldSnapshot(K_CONFIG);
  const liveWithExtraFieldAndReorderedKeys = {
    interruption_settings: { interrupt_prediction_threshold: 0.4 },
    voice_settings: {
      background_audio: {
        media_url: null, // Zusatzfeld aus der oneOf-Union, das WIR nicht gesendet haben
        volume: 0.3,
        value: "office", // andere Reihenfolge als K_CONFIG (dort: type, value, volume)
        type: "predefined_media",
      },
    },
  };
  const liveSnapshot = appliedFieldSnapshot(liveWithExtraFieldAndReorderedKeys);
  assert.deepEqual(fieldsNotApplied(sentSnapshot, liveSnapshot), []);
});

test("sendAssistantConfig: K1/K2-Felder live bestaetigt (GET-nachher matcht den gesendeten Wert) -> kein Fehler", async () => {
  config.telephony.telnyxApiBase = "https://telnyx.test";
  config.telephony.telnyxApiKey = "test-key";
  const before = { data: assistantWithSafetyFields() };
  const after = {
    data: assistantWithSafetyFields({
      interruption_settings: { enable: true, interrupt_prediction_threshold: 0.4 },
      voice_settings: {
        background_audio: { type: "predefined_media", value: "office", volume: 0.3 },
      },
    }),
  };
  await withQueuedFetch(
    [{ json: before }, { json: { data: { id: "asst_1" } } }, { json: after }],
    async (calls) => {
      const id = await sendAssistantConfig(K_CONFIG, "asst_1");
      assert.equal(id, "asst_1");
      assert.equal(
        calls.length,
        3,
        "kein zusaetzlicher GET - derselbe GET-nachher deckt beide Pruefungen ab",
      );
    },
  );
});

test("sendAssistantConfig: Telnyx verwirft interrupt_prediction_threshold still (GET-nachher fehlt das Feld) -> wirft, K1 NICHT live", async () => {
  config.telephony.telnyxApiBase = "https://telnyx.test";
  config.telephony.telnyxApiKey = "test-key";
  const before = { data: assistantWithSafetyFields() };
  const after = {
    data: assistantWithSafetyFields({
      // interrupt_prediction_threshold fehlt (still verworfen), enable bleibt allein uebrig;
      // background_audio kam korrekt an - nur EIN Feld darf im Fehler genannt werden.
      interruption_settings: { enable: true },
      voice_settings: {
        background_audio: { type: "predefined_media", value: "office", volume: 0.3 },
      },
    }),
  };
  await withQueuedFetch(
    [{ json: before }, { json: { data: { id: "asst_1" } } }, { json: after }],
    async () => {
      await assert.rejects(
        () => sendAssistantConfig(K_CONFIG, "asst_1"),
        (err) => {
          assert.match(err.message, /K1\/K2-Verifikation fehlgeschlagen/);
          assert.match(err.message, /interrupt_prediction_threshold/);
          assert.ok(
            !/background_audio/.test(err.message),
            "background_audio kam korrekt an -> kein Verlust",
          );
          return true;
        },
      );
    },
  );
});

// MAJOR-2 (2. Review-Runde, der eigentliche Regressionsschutz): VORHER stand die K1/K2-
// Verifikation komplett im existingId-Zweig - ein Create-Lauf (keine TELNYX_ASSISTANT_ID, z.B.
// Disaster-Recovery/Neuanlage) meldete smokePass=true, OHNE je gegengeprueft zu haben, ob
// Telnyx die gesendeten Felder wirklich uebernommen hat. Diese beiden Tests beweisen, dass die
// Verifikation jetzt AUCH ohne existingId aktiv ist (Erfolg UND Fehlschlag) - spiegelbildlich
// zu den beiden K1/K2-Update-Tests oben, nur mit existingId="".
test("sendAssistantConfig: Create, K1/K2-Felder live bestaetigt -> kein Fehler (MAJOR-2)", async () => {
  config.telephony.telnyxApiBase = "https://telnyx.test";
  config.telephony.telnyxApiKey = "test-key";
  const after = { data: { id: "asst_new", ...K_CONFIG } };
  await withQueuedFetch(
    [{ json: { data: { id: "asst_new" } } }, { json: after }],
    async (calls) => {
      const id = await sendAssistantConfig(K_CONFIG, "");
      assert.equal(id, "asst_new");
      assert.equal(
        calls.length,
        2,
        "POST + genau ein Nachher-GET, kein Vorher-GET (kein existingId)",
      );
    },
  );
});

test("sendAssistantConfig: Create, Telnyx verwirft interrupt_prediction_threshold still -> wirft AUCH ohne existingId (MAJOR-2)", async () => {
  config.telephony.telnyxApiBase = "https://telnyx.test";
  config.telephony.telnyxApiKey = "test-key";
  const after = {
    data: {
      id: "asst_new",
      interruption_settings: { enable: true }, // interrupt_prediction_threshold fehlt (still verworfen)
      voice_settings: {
        background_audio: { type: "predefined_media", value: "office", volume: 0.3 },
      },
    },
  };
  await withQueuedFetch([{ json: { data: { id: "asst_new" } } }, { json: after }], async () => {
    await assert.rejects(
      () => sendAssistantConfig(K_CONFIG, ""),
      (err) => {
        assert.match(err.message, /K1\/K2-Verifikation fehlgeschlagen/);
        assert.match(err.message, /interrupt_prediction_threshold/);
        return true;
      },
    );
  });
});

// AL-P3: K_CONFIG + start_speaking_plan (K_CONFIG selbst bleibt unangetastet -> minimale
// Churn an den Bestandstests oben).
const AL_P3_CONFIG = {
  ...K_CONFIG,
  interruption_settings: {
    ...K_CONFIG.interruption_settings,
    start_speaking_plan: {
      wait_seconds: 0.4,
      transcription_endpointing_plan: {
        on_punctuation_seconds: 0.1,
        on_no_punctuation_seconds: 0.8,
        on_number_seconds: 0.5,
      },
    },
  },
};

test("AL-P3: appliedFieldSnapshot liest die vier Endpointing-Blaetter ueber den vollen Pfad", () => {
  const snapshot = appliedFieldSnapshot(AL_P3_CONFIG);
  assert.deepEqual(snapshot, {
    interrupt_prediction_threshold: 0.4,
    background_audio_value: "office",
    background_audio_volume: 0.3,
    start_speaking_wait_seconds: 0.4,
    endpointing_on_punctuation_seconds: 0.1,
    endpointing_on_no_punctuation_seconds: 0.8,
    endpointing_on_number_seconds: 0.5,
  });
});

// AL-P3 (der eigentliche Regressionsschutz, Abnahme 4): Telnyx laesst start_speaking_plan
// still auf null (undokumentiertes Feld, wahrscheinlichster Fehlermodus ist der stille Drop) -
// sendAssistantConfig muss werfen, statt smokePass=true zu melden, obwohl das Endpointing live
// gar nicht wirkt. background_audio kam korrekt an -> darf NICHT im Fehler stehen.
test("AL-P3: Telnyx laesst start_speaking_plan still auf null -> sendAssistantConfig wirft, kein falsch-gruener Lauf", async () => {
  config.telephony.telnyxApiBase = "https://telnyx.test";
  config.telephony.telnyxApiKey = "test-key";
  const before = { data: assistantWithSafetyFields() };
  const after = {
    data: assistantWithSafetyFields({
      interruption_settings: {
        enable: true,
        interrupt_prediction_threshold: 0.4,
        start_speaking_plan: null,
      },
      voice_settings: {
        background_audio: { type: "predefined_media", value: "office", volume: 0.3 },
      },
    }),
  };
  await withQueuedFetch(
    [{ json: before }, { json: { data: { id: "asst_1" } } }, { json: after }],
    async () => {
      await assert.rejects(
        () => sendAssistantConfig(AL_P3_CONFIG, "asst_1"),
        (err) => {
          assert.match(err.message, /K1\/K2-Verifikation fehlgeschlagen/);
          assert.match(err.message, /start_speaking_wait_seconds/);
          assert.match(err.message, /endpointing_on_punctuation_seconds/);
          assert.match(err.message, /endpointing_on_no_punctuation_seconds/);
          assert.match(err.message, /endpointing_on_number_seconds/);
          assert.ok(
            !/background_audio/.test(err.message),
            "background_audio kam korrekt an -> kein Verlust",
          );
          return true;
        },
      );
    },
  );
});
