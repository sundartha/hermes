import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OVERRIDE_ALLOWED_LEAF_PATHS,
  OVERRIDE_FIRST_MESSAGE_LEAF_PATHS,
  startOutboundCall,
} from "../src/elevenlabs/convai.js";
import { wertAnPfad } from "../scripts/lib/elevenlabs-besitz.mjs";

const ACCOUNT = Object.freeze({ apiKey: "el-test-geheim-xyz", apiBase: "http://127.0.0.1:1" });
const CALL_ID = "call_whitelist_test_1";
const AGENT_ID = "agent_test_1";
const AGENT_PHONE_NUMBER_ID = "phnum_test_1";
const TO_NUMBER = "+4915000000000";
const CONVERSATION_ID = "conv_test_1";
const ALLOWED_VOICE_ID = "voice_test_1";

function recordingFetch() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ conversation_id: CONVERSATION_ID }) };
  };
  return { fetchImpl, calls };
}

function bodyWithOverride(override) {
  return {
    agent_id: AGENT_ID,
    agent_phone_number_id: AGENT_PHONE_NUMBER_ID,
    to_number: TO_NUMBER,
    conversation_initiation_client_data: {
      dynamic_variables: {},
      ...(override === undefined ? {} : { conversation_config_override: override }),
    },
  };
}

async function captureErrors(fn) {
  const zeilen = [];
  const original = console.error;
  console.error = (...args) => zeilen.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return zeilen;
}

test("EL-OVERRIDE ROTPROBE: ein DRITTES Feld im Override-Objekt wird abgelehnt, kein Netzaufruf", async () => {
  const { fetchImpl, calls } = recordingFetch();
  const body = bodyWithOverride({
    agent: { language: "en" },
    tts: { voice_id: ALLOWED_VOICE_ID },
    asr: { keywords: ["boese"] },
  });

  const fehlerZeilen = await captureErrors(async () => {
    await assert.rejects(
      () => startOutboundCall({ fetchImpl, account: ACCOUNT, body, callId: CALL_ID }),
      /asr\.keywords/,
      "der Anrufstart darf NICHT gelingen, wenn das Override-Objekt einen dritten Pfad traegt",
    );
  });

  assert.equal(calls.length, 0, "kein Netzaufruf - der Waechter muss VOR fetchImpl greifen");

  const geloggt = fehlerZeilen.join("\n");
  assert.match(geloggt, /asr\.keywords/, "der verbotene Pfad muss im Fehlerebene-Log stehen");
  assert.match(geloggt, new RegExp(CALL_ID), "die Anruf-Kennung muss im Log stehen");
  assert.ok(!geloggt.includes(ACCOUNT.apiKey), "der API-Schluessel darf NIE im Log stehen (Regel 4/5)");
});

test("EL-OVERRIDE: nur die zwei erlaubten Pfade -> der Anrufstart geht durch (Positiv-Kontrolle)", async () => {
  const { fetchImpl, calls } = recordingFetch();
  const body = bodyWithOverride({
    agent: { language: "en" },
    tts: { voice_id: ALLOWED_VOICE_ID },
  });

  const { conversationId } = await startOutboundCall({ fetchImpl, account: ACCOUNT, body, callId: CALL_ID });

  assert.equal(conversationId, CONVERSATION_ID);
  assert.equal(calls.length, 1, "genau EIN Netzaufruf bei erlaubtem Override");
});

test("EL-OVERRIDE: nur EINER der zwei erlaubten Pfade gesetzt -> geht ebenfalls durch", async () => {
  const { fetchImpl, calls } = recordingFetch();
  const body = bodyWithOverride({ tts: { voice_id: ALLOWED_VOICE_ID } });

  const { conversationId } = await startOutboundCall({ fetchImpl, account: ACCOUNT, body, callId: CALL_ID });

  assert.equal(conversationId, CONVERSATION_ID);
  assert.equal(calls.length, 1, "die Whitelist verlangt nicht BEIDE Pfade, nur dass es keine dritten gibt");
});

test("EL-OVERRIDE: kein Override-Objekt -> unveraendertes Bestandsverhalten (heutiger Anrufstart)", async () => {
  const { fetchImpl, calls } = recordingFetch();
  const body = bodyWithOverride(undefined);

  const { conversationId } = await startOutboundCall({ fetchImpl, account: ACCOUNT, body, callId: CALL_ID });

  assert.equal(conversationId, CONVERSATION_ID);
  assert.equal(calls.length, 1, "der heutige Anrufstart (kein Override-Objekt) bleibt unveraendert");
});

test("EL-OVERRIDE: ein verbotener Pfad NEBEN einem erlaubten, im selben Zweig verschachtelt, wird abgelehnt", async () => {
  const { fetchImpl, calls } = recordingFetch();
  const body = bodyWithOverride({
    agent: { language: "en", first_message: "Hallo, hier spricht jemand anderes." },
  });

  await assert.rejects(
    () => startOutboundCall({ fetchImpl, account: ACCOUNT, body, callId: CALL_ID }),
    /agent\.first_message/,
  );
  assert.equal(calls.length, 0, "kein Netzaufruf - auch ein verschachtelter dritter Pfad muss abbrechen");
});

test("EL-OVERRIDE: ein Override, das kein Objekt ist, wird abgelehnt statt stillschweigend durchzugehen", async () => {
  const { fetchImpl, calls } = recordingFetch();
  const body = bodyWithOverride("agent_soll_englisch_sprechen");

  await assert.rejects(() => startOutboundCall({ fetchImpl, account: ACCOUNT, body, callId: CALL_ID }));
  assert.equal(calls.length, 0, "eine kaputte Form ist selbst ein Verstoss, kein stilles 'nichts zu pruefen'");
});

test("EL-OVERRIDE: ein leeres Override-Objekt setzt nichts und geht durch", async () => {
  const { fetchImpl, calls } = recordingFetch();
  const body = bodyWithOverride({});

  const { conversationId } = await startOutboundCall({ fetchImpl, account: ACCOUNT, body, callId: CALL_ID });

  assert.equal(conversationId, CONVERSATION_ID);
  assert.equal(calls.length, 1, "ein leeres Objekt setzt keinen Pfad - nichts zu verbieten");
});

const TEMPLATE_PATH = "elevenlabs/agent_configs/outbound-agent.template.json";
const OVERRIDE_KARTE_PFAD = "platform_settings.overrides.conversation_config_override";

function truePfade(wert, prefix = []) {
  if (wert === true) return [prefix.join(".")];
  if (wert === false) return [];
  const istObjekt = wert !== null && typeof wert === "object" && !Array.isArray(wert);
  if (!istObjekt) return [];
  return Object.entries(wert).flatMap(([schluessel, kind]) => truePfade(kind, [...prefix, schluessel]));
}

test("EL-OVERRIDE TEIL 3: die Code-Whitelist und die Besitz-Karte der Vorlage nennen exakt dieselben zwei Pfade", () => {
  const vorlage = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const karte = wertAnPfad(vorlage, OVERRIDE_KARTE_PFAD);
  assert.ok(karte.gefunden, `${OVERRIDE_KARTE_PFAD} fehlt in der Vorlage - die Besitz-Karte ist nicht gebaut`);

  const kartePfade = truePfade(karte.wert).sort();
  const codePfade = [...OVERRIDE_ALLOWED_LEAF_PATHS, ...OVERRIDE_FIRST_MESSAGE_LEAF_PATHS].sort();

  assert.deepEqual(
    kartePfade,
    codePfade,
    `die Vorlage erlaubt ${JSON.stringify(kartePfade)}, der Code (src/elevenlabs/convai.js#OVERRIDE_ALLOWED_LEAF_PATHS + OVERRIDE_FIRST_MESSAGE_LEAF_PATHS) erlaubt ${JSON.stringify(codePfade)} - beide muessen identisch sein, sonst driften Waechter und Besitz-Karte auseinander`,
  );

  assert.ok(
    OVERRIDE_FIRST_MESSAGE_LEAF_PATHS.includes("agent.first_message"),
    "agent.first_message gehoert in die OWNER-Menge - sonst waere die Owner-Eroeffnung gar nicht sendbar",
  );
  assert.ok(
    !OVERRIDE_ALLOWED_LEAF_PATHS.includes("agent.first_message"),
    "agent.first_message darf NIE in der Basis-Menge stehen - sonst koennte ein Fremd-Anruf die Offenlegung uebersteuern",
  );
});
