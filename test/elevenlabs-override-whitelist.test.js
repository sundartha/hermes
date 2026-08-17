// ---- Weisse Liste conversation_config_override: Rotprobe + Bestandsschutz ------------
// Owner-Entscheidung 16.08.2026 (ersetzt den bisherigen Wortlaut "conversation_config_
// override wird nicht benutzt"): pro Anruf duerfen am Agenten AUSSCHLIESSLICH zwei Dinge
// gesetzt werden - die Sprache (conversation_config_override.agent.language) und die
// Stimme (conversation_config_override.tts.voice_id). Jede andere Ueberschreibung ist
// verboten. Die geschuetzte EIGENSCHAFT ist nicht der Pfad, sondern: niemand darf den
// Agenten pro Anruf unbemerkt umbauen (Systemprompt, Werkzeuge, ASR-Keywords,
// Text-only-Modus, ...).
//
// GEPRUEFT WIRD DIREKT AN DER STELLE, DIE "VOR DEM EINZIGEN NETZZUGRIFF DIESES WEGS"
// SITZT: src/elevenlabs/convai.js#startOutboundCall (s. Modulkopf dort). fetchImpl bleibt
// eine reine Attrappe (DIP, dasselbe Muster wie src/tts/synth.js) - ein echter
// Netzzugriff ist hier unabhaengig vom Testausgang unmoeglich; die Laenge von calls[]
// (der Aufrufzaehler DIESER Attrappe) ist der Beweis "kein Netzzugriff", nicht ein
// beobachteter HTTP-Server.
//
// NUR DER WAECHTER, NICHT DIE FUNKTION: dieses Modul waehlt keine Sprache/Stimme (kein
// Feature, ein separates Paket) - der Anrufstart schickt heute GAR KEIN Override-Objekt
// (src/elevenlabs/outbound.js#dynamicVariables baut keins). Dieser Waechter greift
// trotzdem VOR jedem kuenftigen Aufrufer.
//
// FAIL-CLOSED, NICHT FILTERND (Owner-Wortlaut): "Ein stiller Filter ist genau der
// Fehler, der bei context.open_questions schon einmal passiert ist." Ein verbotener Pfad
// bricht den Anrufstart deshalb GANZ ab statt ihn zu entfernen und trotzdem zu senden.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { OVERRIDE_ALLOWED_LEAF_PATHS, startOutboundCall } from "../src/elevenlabs/convai.js";
import { wertAnPfad } from "../scripts/lib/elevenlabs-besitz.mjs";

const ACCOUNT = Object.freeze({ apiKey: "el-test-geheim-xyz", apiBase: "http://127.0.0.1:1" });
const CALL_ID = "call_whitelist_test_1";
const AGENT_ID = "agent_test_1";
const AGENT_PHONE_NUMBER_ID = "phnum_test_1";
const TO_NUMBER = "+4915000000000";
const CONVERSATION_ID = "conv_test_1";
const ALLOWED_VOICE_ID = "voice_test_1";

// EIN fetchImpl, das jeden Aufruf mitschreibt statt je ans Netz zu gehen. Die LAENGE von
// calls ist der Beweis "kein Netzzugriff" - stabiler als ein beobachteter HTTP-Server,
// weil kein Zeitfenster/Race dazwischenliegen kann.
function recordingFetch() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ conversation_id: CONVERSATION_ID }) };
  };
  return { fetchImpl, calls };
}

// override === undefined -> das Feld fehlt ganz im Rumpf (heutiges Bestandsverhalten).
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

// console.error mitschreiben, ohne test/helpers.js anzufassen (captureConsole dort
// faengt nur log/warn ab, nicht error - die Ablehnung hier ist bewusst Fehlerebene).
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

  const conversationId = await startOutboundCall({ fetchImpl, account: ACCOUNT, body, callId: CALL_ID });

  assert.equal(conversationId, CONVERSATION_ID);
  assert.equal(calls.length, 1, "genau EIN Netzaufruf bei erlaubtem Override");
});

test("EL-OVERRIDE: nur EINER der zwei erlaubten Pfade gesetzt -> geht ebenfalls durch", async () => {
  const { fetchImpl, calls } = recordingFetch();
  const body = bodyWithOverride({ tts: { voice_id: ALLOWED_VOICE_ID } });

  const conversationId = await startOutboundCall({ fetchImpl, account: ACCOUNT, body, callId: CALL_ID });

  assert.equal(conversationId, CONVERSATION_ID);
  assert.equal(calls.length, 1, "die Whitelist verlangt nicht BEIDE Pfade, nur dass es keine dritten gibt");
});

test("EL-OVERRIDE: kein Override-Objekt -> unveraendertes Bestandsverhalten (heutiger Anrufstart)", async () => {
  const { fetchImpl, calls } = recordingFetch();
  const body = bodyWithOverride(undefined);

  const conversationId = await startOutboundCall({ fetchImpl, account: ACCOUNT, body, callId: CALL_ID });

  assert.equal(conversationId, CONVERSATION_ID);
  assert.equal(calls.length, 1, "der heutige Anrufstart (kein Override-Objekt) bleibt unveraendert");
});

test("EL-OVERRIDE: ein verbotener Pfad NEBEN einem erlaubten, im selben Zweig verschachtelt, wird abgelehnt", async () => {
  const { fetchImpl, calls } = recordingFetch();
  // agent.language ist erlaubt, agent.first_message NICHT - beide im selben Unterobjekt:
  // ein Filter, der nur auf Ebene der TOP-LEVEL-Schluessel (agent/tts/asr/...) prueft,
  // liesse das durch. Die Whitelist muss bis zum BLATT-Pfad hinabsehen.
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

  const conversationId = await startOutboundCall({ fetchImpl, account: ACCOUNT, body, callId: CALL_ID });

  assert.equal(conversationId, CONVERSATION_ID);
  assert.equal(calls.length, 1, "ein leeres Objekt setzt keinen Pfad - nichts zu verbieten");
});

// ---- TEIL 3: die Whitelist des Codes und die Besitz-Karte der Vorlage koennen nicht -----
// auseinanderlaufen ---------------------------------------------------------------------
// Zwei getippte Kopien derselben zwei Pfade (der Waechter hier im Code, die EIGENE weisse
// Liste des Anbieters in der Vorlage - elevenlabs/agent_configs/outbound-agent.template.
// json, platform_settings.overrides.conversation_config_override, s. dort _besitz.felder
// [feld=conversation_config_override_erlaubnisse]) sind ein zweiter, schwaecherer
// Wahrheitsstand: dreht jemand nur die eine um, faellt es sonst niemandem auf. Dieser Test
// haelt beide DIREKT gegeneinander - keine dritte, gepflegte Liste dazwischen.
const TEMPLATE_PATH = "elevenlabs/agent_configs/outbound-agent.template.json";
const OVERRIDE_KARTE_PFAD = "platform_settings.overrides.conversation_config_override";

// Alle Pfade, an denen die Besitz-Karte true traegt (= "der Anbieter darf diesen Wert per
// Anruf annehmen"). false ist kein Blatt-Pfad in diesem Sinn - nur true zaehlt als
// "erlaubt", exakt symmetrisch zu OVERRIDE_ALLOWED_LEAF_PATHS im Code (eine erlaubte Liste,
// keine verbotene).
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
  const codePfade = [...OVERRIDE_ALLOWED_LEAF_PATHS].sort();

  assert.deepEqual(
    kartePfade,
    codePfade,
    `die Vorlage erlaubt ${JSON.stringify(kartePfade)}, der Code (src/elevenlabs/convai.js#OVERRIDE_ALLOWED_LEAF_PATHS) erlaubt ${JSON.stringify(codePfade)} - beide muessen identisch sein, sonst driften Waechter und Besitz-Karte auseinander`,
  );
});
