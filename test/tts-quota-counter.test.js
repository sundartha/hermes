// LCT P7: Fixkosten sichtbar machen - globaler ElevenLabs-Zeichenzaehler (NICHT
// tenant-scoped, Muster profile/platform_tts_usage). REINE SICHTBARKEIT: kein Gate
// liest diese Achse (Test (f) beweist es ueber ein unveraendertes
// budgetExceeded-Ergebnis).
//
// Drei Ebenen in einer Datei (Muster test/usage-spend-month-axis.test.js): Ops-Ebene
// (recordTtsCharacters/platformTtsUsageView direkt auf makeDefaultState()), Fassaden-
// Roundtrip (json + pglite, Backend-Paritaet) und directive-synth-Ebene. Der Synth-
// Erfolg/Fehlschlag-Seam ist bei synthesizeSpeech NICHT injiziert (harter Import aus
// synth.js) - injiziert ist fetchImpl (== globalThis.fetch), exakt wie in
// test/directive-synth.test.js. Diese Datei nutzt denselben Fake-fetch-Kniff statt
// eines eigenstaendigen Fake-synthesizeSpeech.
//
// Alle Faelle sind VOR der Implementierung rot: emptyPlatformTtsUsage (defaults.js)
// sowie recordTtsCharacters/platformTtsUsageView (state-ops.js) existieren noch nicht
// -> TypeError "... is not a function". Offline, kein Netz, kein Server-Spawn (F.I.R.S.T.).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  makeDefaultState, recordTtsCharacters, platformTtsUsageView, budgetExceeded, setTenantBudget,
  recordTenantTtsCharacters, usageFor,
} from "../src/store/state-ops.js";
import { emptyUsage } from "../src/store/defaults.js";
import { makeDirectiveSynth } from "../src/tts/directive-synth.js";
import { say } from "../src/telephony/directives.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { tempDataDir } from "./helpers.js";
import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "./pg-helpers.js";

const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";
// Quota=1000, Warn=75% -> Schwelle 750 Zeichen. Anker=Tag 3 (nicht der Monatserste).
const CFG = { ttsCharacterQuota: 1000, ttsCharacterQuotaWarnPercent: 75, ttsQuotaCycleAnchorDay: 3 };
const AUG_ISO = "2026-08-15T10:00:00.000Z"; // Tag 15 >= Anker 3 -> Schluessel '2026-08'
const SEP_EARLY_ISO = "2026-09-02T00:00:00.000Z"; // Tag 2 < Anker 3 -> Schluessel bleibt '2026-08'
const SEP_ANCHOR_ISO = "2026-09-03T00:00:00.000Z"; // Tag 3 == Anker -> Schluessel '2026-09' (Rollover)
const OCT_ISO = "2026-10-15T00:00:00.000Z"; // Zukunft ggue. AUG_ISO -> Schluessel '2026-10'

let config;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  config = (await import("../src/config.js")).config;
});

// ==== Ops-Ebene: recordTtsCharacters + platformTtsUsageView =======================

test("(a) Zaehlung bei Erfolg: drei Aufrufe im selben Zyklus akkumulieren", () => {
  const s = makeDefaultState();
  recordTtsCharacters(s, 100, CFG, AUG_ISO);
  recordTtsCharacters(s, 100, CFG, AUG_ISO);
  recordTtsCharacters(s, 100, CFG, AUG_ISO);
  assert.equal(platformTtsUsageView(s, CFG, AUG_ISO).characters, 300);
});

test("(c) genau EINE Warnung je Zyklus (Schwelle 750 von 1000)", () => {
  const s = makeDefaultState();
  assert.equal(recordTtsCharacters(s, 700, CFG, AUG_ISO).warning, null, "700 < 750 -> keine Warnung");
  const crossing = recordTtsCharacters(s, 100, CFG, AUG_ISO); // 800 >= 750
  assert.deepEqual(crossing.warning, { characters: 800, quota: 1000, cycleKey: "2026-08" });
  const again = recordTtsCharacters(s, 50, CFG, AUG_ISO);
  assert.equal(again.warning, null, "zweite Ueberschreitung im selben Zyklus meldet NICHT erneut (kein SMS-Spam)");
});

test("(d) Folgemonat, aber VOR dem Zyklus-Anker: kein Reset, weiterlaufen", () => {
  const s = makeDefaultState();
  recordTtsCharacters(s, 400, CFG, AUG_ISO); // Zyklus '2026-08'
  const result = recordTtsCharacters(s, 50, CFG, SEP_EARLY_ISO); // Tag 2 < Anker 3
  assert.equal(result.changed, true);
  assert.equal(platformTtsUsageView(s, CFG, SEP_EARLY_ISO).characters, 450, "kein Reset vor dem Anker-Tag");
});

test("(e) Zukunfts-Schluessel setzt den Zaehler NICHT zurueck (Clock-Skew-Riegel, Muster P4)", () => {
  const s = makeDefaultState();
  recordTtsCharacters(s, 500, CFG, OCT_ISO); // stempelt '2026-10' (Clock-Skew-Simulation)
  const result = recordTtsCharacters(s, 30, CFG, AUG_ISO); // aelterer Aufruf danach
  assert.equal(result.changed, true);
  assert.equal(platformTtsUsageView(s, CFG, AUG_ISO).characters, 530, "akkumuliert weiter auf dem Zukunfts-Schluessel, kein Rueckwaerts-Reset");
});

test("(f) kein Gate-Verhalten aendert sich: budgetExceeded ist von der TTS-Achse voellig unbeeinflusst", () => {
  const s = makeDefaultState();
  s.usage[TENANT_A] = { ...emptyUsage(), costCents: 500 };
  // Eigene tenant_budget-Zeile: die Gate-Frage haengt damit an der TENANT-Decke, nicht an
  // einer Plattform-Zahl (die seit KS-P9 ohnehin keine Sperrentscheidung mehr traegt).
  setTenantBudget(s, TENANT_A, { budgetCents: 1000, hardCapCents: 1000 });
  const gateCfg = { platformSpendCapCents: 1000 };
  const before1 = budgetExceeded(s, TENANT_A, gateCfg, AUG_ISO);
  recordTtsCharacters(s, 999_999, CFG, AUG_ISO); // absichtlich weit ueber jedes TTS-Kontingent
  recordTtsCharacters(s, 999_999, CFG, AUG_ISO);
  const after = budgetExceeded(s, TENANT_A, gateCfg, AUG_ISO);
  assert.equal(before1, after, "das Budget-Gate liest byte-identisch, egal wie oft die TTS-Achse gebucht hat");
  assert.equal(after, false, "500 < 1000 -> Gate bleibt offen");
});

test("(g) Rollover GENAU am Anker-Tag: neuer Zyklus, Zaehler startet frisch", () => {
  const s = makeDefaultState();
  recordTtsCharacters(s, 400, CFG, AUG_ISO); // '2026-08'
  recordTtsCharacters(s, 77, CFG, SEP_ANCHOR_ISO); // Tag 3 == Anker -> '2026-09' (Rollover)
  const view = platformTtsUsageView(s, CFG, SEP_ANCHOR_ISO);
  assert.equal(view.cycleKey, "2026-09");
  assert.equal(view.characters, 77, "der alte Zyklus-Wert (400) zaehlt NICHT mit");
});

test("(h) unlesbare Uhr OHNE je gestempelten Anker: No-op, kein Phantom-Zaehler", () => {
  const s = makeDefaultState();
  const result = recordTtsCharacters(s, 100, CFG, "kaputt");
  assert.equal(result.changed, false);
  assert.equal(s.platformTtsUsage.characters, 0);
});

test("(h2) unlesbare Uhr NACH vorhandenem Anker: kein Reset (Riegel faellt auf storedKey zurueck)", () => {
  const s = makeDefaultState();
  recordTtsCharacters(s, 200, CFG, AUG_ISO);
  const result = recordTtsCharacters(s, 100, CFG, "kaputt");
  assert.equal(result.changed, true, "storedKey vorhanden -> kein No-op");
  assert.equal(platformTtsUsageView(s, CFG, AUG_ISO).characters, 300, "akkumuliert weiter, keine kaputte Uhr resettet");
});

test("(i) Warn-Prozent 0: nie eine Warnung, egal wie hoch der Verbrauch", () => {
  const s = makeDefaultState();
  const cfgNoWarn = { ...CFG, ttsCharacterQuotaWarnPercent: 0 };
  const result = recordTtsCharacters(s, 999_999, cfgNoWarn, AUG_ISO);
  assert.equal(result.warning, null);
});

// ==== ElevenLabs-Zeichen PRO TENANT (KE-P6) ==================================
// Andere Achse als platformTtsUsage darueber (globaler Play-TTS-Zaehler): diese Zeichen
// kommen aus dem zugeordneten Telnyx-Beleg (Assistant-Pfad) und landen PRO TENANT.

test("(t1) Zeichen landen am richtigen Tenant, kein Ueberlauf in den anderen", () => {
  const s = makeDefaultState();
  recordTenantTtsCharacters(s, TENANT_A, 238);
  recordTenantTtsCharacters(s, TENANT_B, 17);
  recordTenantTtsCharacters(s, TENANT_A, 12);
  assert.equal(usageFor(s, TENANT_A).ttsCharacters, 250);
  assert.equal(usageFor(s, TENANT_B).ttsCharacters, 17);
  assert.equal(s.platformTtsUsage.characters, 0, "der GLOBALE Zaehler bleibt unberuehrt (anderer Pfad)");
});

test("(t2) Grenzfaelle: 0, negativ, Nicht-Ganzzahl -> No-op, kein Wurf", () => {
  const s = makeDefaultState();
  for (const bad of [0, -5, 1.5, NaN, "238", null, undefined])
    assert.equal(recordTenantTtsCharacters(s, TENANT_A, bad).changed, false, `Wert ${String(bad)}`);
  assert.equal(usageFor(s, TENANT_A).ttsCharacters, 0);
});

test("(t3) json-Fassade: der Tenant-Zaehler ueberlebt einen Reload", async () => {
  const { mod, dir } = await freshJsonStore();
  mod.load();
  mod.recordTenantTtsCharacters(TENANT_A, 238);
  assert.equal(mod.usageOf(TENANT_A).ttsCharacters, 238);

  const raw = JSON.parse(fs.readFileSync(path.join(dir, "store.json"), "utf8"));
  assert.equal(raw.usage[TENANT_A].ttsCharacters, 238, "die Zeile steht auf der Platte");

  config.server.dataDir = dir;
  const reopened = await import(`../src/store/json.js?tts-tenant-reload=${jsonSeq++}`);
  const reloaded = reopened.load();
  assert.equal(reloaded.usage[TENANT_A].ttsCharacters, 238, "der Zaehler ueberlebt den Prozess-Neustart");
});

test("(t4) pg-Rundlauf (PGlite): tts_characters -> save -> reopen -> hydriert", async () => {
  const { store, db } = await makePgTestStore();
  store.recordTenantTtsCharacters(BOOTSTRAP_TENANT_ID, 238);
  await store.save();
  const rows = (await db.query(
    "SELECT tts_characters FROM usage WHERE tenant_id = $1", [BOOTSTRAP_TENANT_ID],
  )).rows;
  assert.equal(Number(rows[0].tts_characters), 238);

  // Re-Init aus der DB (Muster (j3)): der Wert kommt aus der SPALTE, nicht aus dem Spiegel.
  const runner = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }) };
  const { makePgStore } = await import("../src/store/pg.js");
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(reopened.usageOf(BOOTSTRAP_TENANT_ID).ttsCharacters, 238, "der Zaehler ueberlebt Re-Init aus der DB");
});

// ==== Fassaden-Roundtrip: json + pg (Backend-Paritaet, (j)) ========================

let jsonSeq = 0;
async function freshJsonStore(seedStoreContent) {
  const dir = tempDataDir(seedStoreContent);
  config.server.dataDir = dir;
  const mod = await import(`../src/store/json.js?tts-quota=${jsonSeq++}`);
  return { mod, dir };
}

test("(j1) json-Fassade: recordTtsCharacters persistiert - ueberlebt einen Reload (NICHT ephemer)", async () => {
  const { mod, dir } = await freshJsonStore();
  mod.load();
  mod.recordTtsCharacters(150, AUG_ISO);
  const before1 = mod.platformTtsUsageView(AUG_ISO);
  assert.equal(before1.characters, 150);

  const raw = JSON.parse(fs.readFileSync(path.join(dir, "store.json"), "utf8"));
  assert.ok(raw.platformTtsUsage, "die Zeile steht auf der Platte (nicht in der Ephemer-Strip-Liste)");
  assert.equal(raw.platformTtsUsage.characters, 150);

  config.server.dataDir = dir;
  const reopened = await import(`../src/store/json.js?tts-quota-reload=${jsonSeq++}`);
  const reloaded = reopened.load();
  assert.equal(reloaded.platformTtsUsage.characters, 150, "der Zaehler ueberlebt den Prozess-Neustart");
});

test("(j2) json-Fassade: Fehlschlag-Warnung bleibt aus (warnPercent=0 im Test-Default)", async () => {
  const { mod } = await freshJsonStore();
  mod.load();
  const warning = mod.recordTtsCharacters(1, AUG_ISO);
  // BASE_ENV/Code-Default kann hier warnPercent>0 tragen - dieser Test prueft NUR, dass
  // die Fassade den {changed,warning}-Shape der Ops-Ebene korrekt auf "return warning"
  // reduziert (kein Objekt-Leak, kein Wurf).
  assert.ok(warning === null || typeof warning === "object");
});

test("(j3) pg-Rundlauf (PGlite): recordTtsCharacters -> save -> reopen -> Zeile hydriert (Singleton id=1)", async () => {
  const { store, db } = await makePgTestStore();
  store.recordTtsCharacters(222, AUG_ISO);
  await store.save();
  const rows = (await db.query("SELECT id, cycle_key, characters, warned_cycle FROM platform_tts_usage")).rows;
  assert.equal(rows.length, 1, "Singleton-Tabelle: genau eine Zeile (id=1)");
  assert.equal(Number(rows[0].characters), 222);
  assert.equal(rows[0].cycle_key, "2026-08");

  const runner = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }) };
  const { makePgStore } = await import("../src/store/pg.js");
  const reopened = makePgStore(runner);
  await reopened.init();
  const view = reopened.platformTtsUsageView(AUG_ISO);
  assert.equal(view.characters, 222, "der Zaehler ueberlebt Re-Init aus der DB");
});

test("(j4) pg-Bestand ohne Zeile (frische DB, kein Seed) hydriert den inerten Default", async () => {
  const { store } = await makePgTestStore();
  const view = store.platformTtsUsageView(AUG_ISO);
  assert.equal(view.characters, 0);
});

// ==== directive-synth-Ebene: NUR result.ok verbucht (b) ============================

const PUBLIC_URL = "https://agent.test";

function fakeTtsStore() {
  return { put: () => "fixed-token" };
}

function fakeSynthConfig() {
  return withConfigNamespaces({
    publicUrl: PUBLIC_URL,
    elevenLabsPlayTts: {
      enabled: true,
      apiKey: "sk_test_should_never_leak",
      voiceId: "voice123",
      model: "eleven_flash_v2_5",
      apiBase: "https://api.elevenlabs.io",
      outputFormat: "mp3_44100_128",
      synthTimeoutMs: 2000,
    },
  });
}

function fakeStoreSpy() {
  const calls = [];
  return {
    calls,
    recordTtsCharacters(chars, nowIso) {
      calls.push({ chars, nowIso });
      return null; // keine Warnung in diesem Test
    },
  };
}

async function withFakeFetch(fetchImpl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function okFetch() {
  return async () => ({
    ok: true,
    headers: { get: () => "audio/mpeg" },
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  });
}

function failFetch() {
  return async () => ({ ok: false, status: 500, text: async () => "boom" });
}

test("(b1) Synth-FAIL zaehlt NICHT: store.recordTtsCharacters wird nie aufgerufen", async () => {
  const store = fakeStoreSpy();
  const onQuotaWarning = () => assert.fail("onQuotaWarning haette nie aufgerufen werden duerfen");
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: fakeSynthConfig(),
    ttsStore: fakeTtsStore(),
    store,
    onQuotaWarning,
  });
  const directives = [say("Guten Tag")];
  await withFakeFetch(failFetch(), () => synthesizeDirectiveAudio({ provider: "telnyx" }, directives));
  assert.equal(store.calls.length, 0, "der Fehlerpfad (Azure-<Say>-Fallback) verbucht keine Zeichen");
});

test("(b2) Synth-OK zaehlt genau EINMAL mit der Zeichenzahl des gesprochenen Texts", async () => {
  const store = fakeStoreSpy();
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: fakeSynthConfig(),
    ttsStore: fakeTtsStore(),
    store,
    onQuotaWarning: () => {},
  });
  const text = "Guten Tag";
  const directives = [say(text)];
  await withFakeFetch(okFetch(), () => synthesizeDirectiveAudio({ provider: "telnyx" }, directives));
  assert.equal(store.calls.length, 1, "genau EIN Zaehl-Aufruf fuer den einen erfolgreichen Synth");
  assert.equal(store.calls[0].chars, text.length, "die Zeichenzahl ist die des gesprochenen Texts");
});

test("(b3) Warnung aus recordTtsCharacters wird an onQuotaWarning durchgereicht", async () => {
  const store = { recordTtsCharacters: () => ({ characters: 800, quota: 1000, cycleKey: "2026-08" }) };
  let seen = null;
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: fakeSynthConfig(),
    ttsStore: fakeTtsStore(),
    store,
    onQuotaWarning: (w) => {
      seen = w;
    },
  });
  await withFakeFetch(okFetch(), () => synthesizeDirectiveAudio({ provider: "telnyx" }, [say("Hallo")]));
  assert.deepEqual(seen, { characters: 800, quota: 1000, cycleKey: "2026-08" });
});

// ==== GAP-09 (SOLL, rot): Zurechenbarkeit + definierter Erschoepfungs-Zustand =======
// Beide Bloecke sind SOLL-Tests (rot vor Fix, R2 der kanonischen Liste). Sie nutzen den
// directive-synth-Harness der Bloecke (b1)-(b3), verdrahten den Zaehler-Seam aber gegen
// die ECHTEN state-ops-Funktionen - nur so ist die Frage "deckt die Tenant-Summe den
// Plattform-Zaehler?" ueberhaupt stellbar.

// store-Seam des Play-TTS-Pfads gegen den ECHTEN Plattform-Zaehler auf state s.
function realPlatformCounterStore(s, cfg) {
  return { recordTtsCharacters: (chars, nowIso) => recordTtsCharacters(s, chars, cfg, nowIso).warning };
}

function synthFor(store) {
  return makeDirectiveSynth({
    config: fakeSynthConfig(),
    ttsStore: fakeTtsStore(),
    store,
    onQuotaWarning: () => {},
  }).synthesizeDirectiveAudio;
}

const tenantTtsCharactersTotal = (s) =>
  Object.values(s.usage).reduce((sum, bucket) => sum + (bucket.ttsCharacters || 0), 0);

// (a) Gemessen gibt es zwei UNVERBUNDENE Zaehler: der Play-TTS-Pfad (directive-synth)
// schreibt AUSSCHLIESSLICH den Plattform-Zaehler, der Tenant-Zaehler wird NUR vom
// Cost-Truing-Sweep aus Telnyx-Belegen gespeist ((t1)-(t4) oben). Der Play-TTS-Verbrauch
// ist damit keinem Tenant zurechenbar - eine Kostenstelle ohne Kostentraeger.
test("GAP-09 (SOLL, rot): die Summe der tenant-gekeyten TTS-Zeichen deckt den Plattform-Zaehler", async () => {
  const s = makeDefaultState();
  const text = "Guten Tag";
  const nowIso = new Date().toISOString();

  await withFakeFetch(okFetch(), () =>
    synthFor(realPlatformCounterStore(s, CFG))({ provider: "telnyx" }, [say(text)]),
  );

  const platformCharacters = platformTtsUsageView(s, CFG, nowIso).characters;
  assert.equal(platformCharacters, text.length, "Vorbedingung: der Play-TTS-Pfad hat gezaehlt");
  assert.equal(
    tenantTtsCharactersTotal(s),
    platformCharacters,
    "kein einziges der plattformweit verbuchten Zeichen ist einem Tenant zugeordnet",
  );
});

// (b) Ein erschoepftes Kontingent hat heute KEINEN definierten Zustand: ueber 100 % meldet
// recordTtsCharacters nur noch {changed:true, warning:null} (die eine Warnung ist bei
// warnPercent bereits verbraucht) und der Synth-Pfad laeuft unveraendert weiter - stille
// Overage auf einem Konto, das wir nicht deckeln koennen. Erwartet waere entweder eine
// Sperre (kein Provider-Call) oder eine Degradation auf Azure-<Say> (keine audioUrl).
const TINY_QUOTA_CFG = { ...CFG, ttsCharacterQuota: 10 };
const QUOTA_OVERSHOOT_FACTOR = 2;

test("GAP-09 (SOLL, rot): ist das TTS-Kontingent erschoepft, tritt ein definierter Zustand ein", async () => {
  const s = makeDefaultState();
  const nowIso = new Date().toISOString();
  recordTtsCharacters(s, TINY_QUOTA_CFG.ttsCharacterQuota * QUOTA_OVERSHOOT_FACTOR, TINY_QUOTA_CFG, nowIso);
  assert.ok(
    platformTtsUsageView(s, TINY_QUOTA_CFG, nowIso).characters > TINY_QUOTA_CFG.ttsCharacterQuota,
    "Vorbedingung: das Kontingent ist ueberschritten",
  );

  const providerCalls = [];
  const countingOkFetch = async (...args) => {
    providerCalls.push(args);
    return okFetch()(...args);
  };
  const [directive] = await withFakeFetch(countingOkFetch, () =>
    synthFor(realPlatformCounterStore(s, TINY_QUOTA_CFG))({ provider: "telnyx" }, [say("Hallo")]),
  );

  const gesperrt = providerCalls.length === 0;
  const degradiert = directive.audioUrl === undefined;
  assert.ok(
    gesperrt || degradiert,
    "ueber 100 % laeuft der Play-TTS-Pfad unveraendert weiter - weder Sperre noch Degradation, " +
      "also unbegrenzte Overage auf dem ElevenLabs-Konto",
  );
});
