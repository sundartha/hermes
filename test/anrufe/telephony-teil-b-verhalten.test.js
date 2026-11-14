import { test } from "node:test";
import assert from "node:assert/strict";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { TURN_LOOP_BY_COST_PROFILE, legRunsOurTurnLoop } from "../../src/telephony/leg-turn-loop.js";
import { EMERGENCY_SHORT_CODES, deniedPrefix, isDenied } from "../../src/telephony/number-denylist.js";
import { isTelnyxSipCallId } from "../../src/telephony/sip-call-id.ts";
import { SPRECHPFAD, armedInboundSprechpfad, classifySprechpfad } from "../../src/telephony/sprechpfad.ts";
import { DEFAULT_STT_PROFILE, STT_PROFILE, isSttProfile } from "../../src/telephony/stt-profile.js";
import { sttLocaleForVoiceProfile } from "../../src/telephony/voice-locale.ts";
import {
  OUTAGE_VERDICT,
  MIN_TENANTS_SHARED_FAULT,
  ZAEHLWEISE_OUTBOUND,
  alarmZeile,
  beurteileAusfall,
  meldeErlaubt,
  outageBucket,
  outageWindow,
} from "../../src/telephony/outage-detection.ts";
import {
  AUSFALL_KLASSE,
  INBOUND_EL_OUTAGE_CODE,
  OUTBOUND_EL_OUTAGE_CODE,
} from "../../src/telephony/outage-classes.ts";

function tabelle(name, faelle, fn) {
  for (const [eingabe, erwartet] of faelle) {
    test(`${name}: ${JSON.stringify(eingabe)}`, () => assert.deepEqual(fn(eingabe), erwartet));
  }
}

tabelle(
  "Notruf und Premium-Ziele sind gesperrt und nennen den Treffer",
  [
    ...EMERGENCY_SHORT_CODES.map((c) => [c, c]),
    ["+8701234567", "+870"], ["+8811234567", "+881"], ["+8821234567", "+882"], ["+8831234567", "+883"],
    ["+9791234567", "+979"], ["+499001234567", "+49900"], ["+4909001234567", "+490900"],
    ["+491371234567", "+49137"], ["+491801234567", "+49180"], ["+491181234567", "+49118"],
    ["+497001234567", "+49700"], ["+441181234567", "+44118"], ["+447012345678", "+4470"],
    ["+449123456789", "+449"], ["+448431234567", "+44843"], ["+448441234567", "+44844"],
    ["+448451234567", "+44845"], ["+448701234567", "+44870"], ["+448711234567", "+44871"],
    ["+331181234567", "+33118"], ["+338991234567", "+33899"], ["+338921234567", "+33892"],
    ["+338101234567", "+33810"], ["+338201234567", "+33820"], ["+19001234567", "+1900"],
    ["+19761234567", "+1976"],
    ["+18091234567", "+1809"], ["+18291234567", "+1829"], ["+18491234567", "+1849"],
    ["+18761234567", "+1876"], ["+12681234567", "+1268"], ["+12841234567", "+1284"],
    ["+14731234567", "+1473"], ["+16491234567", "+1649"], ["+16641234567", "+1664"],
    ["+17671234567", "+1767"],
  ],
  deniedPrefix,
);

tabelle(
  "Nahe, aber nicht gesperrte Ziele passieren",
  [
    ["1100", null], ["1120", null], ["91", null], ["+1120", null], ["+8691234567", null],
    ["+8841234567", null], ["+499011234567", null], ["+491381234567", null], ["+441191234567", null],
    ["+4471123456", null], ["+448461234567", null], ["+12025550123", null], ["+18771234567", null],
  ],
  deniedPrefix,
);

test("isDenied folgt deniedPrefix", () => {
  assert.equal(isDenied("112"), true);
  assert.equal(isDenied("+8701234567"), true);
  assert.equal(isDenied("+4915112345678"), false);
});

test("Kostenprofile bestimmen, ob unsere Gespraechsschleife laeuft", () => {
  assert.deepEqual(
    { ...TURN_LOOP_BY_COST_PROFILE },
    {
      [KOSTENPROFIL.TELNYX_BUDGET]: true,
      [KOSTENPROFIL.TELNYX_INBOUND_BUDGET]: true,
      [KOSTENPROFIL.EL_CONVAI_SIP]: false,
      [KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI]: false,
      [KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI]: false,
    },
  );
  assert.ok(Object.isFrozen(TURN_LOOP_BY_COST_PROFILE));
  for (const [profil, laeuft] of Object.entries(TURN_LOOP_BY_COST_PROFILE))
    assert.equal(legRunsOurTurnLoop({ costProfile: profil }), laeuft, profil);
  for (const call of [undefined, null, {}, { costProfile: "neu_unbekannt" }, { costProfile: "toString" }])
    assert.equal(legRunsOurTurnLoop(call), true, JSON.stringify(call));
});

tabelle(
  "Telnyx-SIP-Call-ID erkennen",
  [
    ["otb_12345678", true], ["OTB_12345678", true], ["Otb_abcdefgh1", true], ["otb_1234567", false],
    ["otb_", false], ["xotb_12345678", false], ["otb12345678", false], ["", false],
    [undefined, false], [null, false], [12345678, false], [["otb_12345678"], false],
  ],
  isTelnyxSipCallId,
);

tabelle(
  "Sprechpfad aus TeXML klassifizieren",
  [
    ["<Response><Play>https://a</Play></Response>", SPRECHPFAD.PLAY_TTS],
    ['<Say voice="Azure.de-DE-KatjaNeural">Hi</Say>', SPRECHPFAD.AZURE_SAY],
    ['<Say voice="ElevenLabs.flash.v1">Hi</Say>', SPRECHPFAD.TELNYX_RELAY],
    ['<Play>x</Play><Say voice="Azure.de-DE-KatjaNeural">Hi</Say>', SPRECHPFAD.PLAY_TTS],
    ['<Say voice="Azure.a">x</Say><Say voice="ElevenLabs.b">y</Say>', SPRECHPFAD.AZURE_SAY],
    ["Play", null], ["<Playback>", null], ['<Say voice="AzureX">x</Say>', null],
    ['<Say voice="Polly.Marlene">x</Say>', null], ['<Say voice="ElevenLabsX">x</Say>', null], ["", null],
  ],
  classifySprechpfad,
);

test("Inbound-Sprechpfad folgt dem Play-TTS-Schalter", () => {
  assert.equal(armedInboundSprechpfad({ enabled: true }), "play_tts");
  assert.equal(armedInboundSprechpfad({ enabled: false }), "azure_say");
  assert.deepEqual({ ...SPRECHPFAD }, { PLAY_TTS: "play_tts", AZURE_SAY: "azure_say", TELNYX_RELAY: "telnyx_relay" });
  assert.ok(Object.isFrozen(SPRECHPFAD));
});

test("STT-Profil: einziges Profil ist accurate und Standard", () => {
  assert.deepEqual({ ...STT_PROFILE }, { ACCURATE: "accurate" });
  assert.ok(Object.isFrozen(STT_PROFILE));
  assert.equal(DEFAULT_STT_PROFILE, "accurate");
  assert.equal(isSttProfile("accurate"), true);
  for (const v of ["fast", "ACCURATE", "", undefined, null, "ACCURATE_"]) assert.equal(isSttProfile(v), false, String(v));
});

test("Stimmprofil bestimmt die STT-Sprache; Unbekanntes wirft", () => {
  assert.equal(sttLocaleForVoiceProfile("de-female-neural"), "de-DE");
  assert.equal(sttLocaleForVoiceProfile("fr-female-neural"), "fr-FR");
  assert.equal(sttLocaleForVoiceProfile("en-female-neural"), "en-GB");
  assert.throws(() => sttLocaleForVoiceProfile("xx-neural"), { message: "unbekanntes voiceProfile: xx-neural" });
  assert.throws(() => sttLocaleForVoiceProfile(undefined), { message: "unbekanntes voiceProfile: undefined" });
});

const JETZT = Date.parse("2026-01-01T12:00:00.000Z");
const FENSTER = 600000;
const vor = (ms) => new Date(JETZT - ms).toISOString();
const anruf = (extra) => ({ direction: "outbound", tenantId: "t1", endedAt: vor(1000), ...extra });
const fensterVon = (calls, bucket = "failed") => outageWindow(calls, { nowMs: JETZT, windowMs: FENSTER, bucket });

test("Ausfallfenster zaehlt Versuche, Erfolge, Fehler und betroffene Tenants", () => {
  const calls = [
    anruf({ answeredAt: vor(5000) }),
    anruf({ failureReason: "failed" }),
    anruf({ failureReason: "failed-D12", tenantId: "t2" }),
    anruf({ failureReason: "failed", tenantId: "t2" }),
    anruf({ failureReason: "busy" }),
  ];
  assert.deepEqual(fensterVon(calls), { fehler: 3, versuche: 5, erfolge: 1, tenants: 2 });
  assert.deepEqual(fensterVon(calls, "busy"), { fehler: 1, versuche: 5, erfolge: 1, tenants: 1 });
  assert.deepEqual(fensterVon([]), { fehler: 0, versuche: 0, erfolge: 0, tenants: 0 });
});

test("Ausfallfenster: Grenzen des Zeitfensters und ausgeschlossene Anrufe", () => {
  const fehler = { failureReason: "failed" };
  const drin = [anruf({ ...fehler, endedAt: vor(FENSTER) }), anruf({ ...fehler, endedAt: vor(0) })];
  assert.equal(fensterVon(drin).versuche, 2);
  const draussen = [
    anruf({ ...fehler, endedAt: vor(FENSTER + 1) }),
    anruf({ ...fehler, endedAt: vor(-1) }),
    anruf({ ...fehler, endedAt: undefined }),
    anruf({ ...fehler, endedAt: "kein-datum" }),
    anruf({ ...fehler, direction: "inbound" }),
  ];
  assert.deepEqual(fensterVon(draussen), { fehler: 0, versuche: 0, erfolge: 0, tenants: 0 });
});

test("Ausfallfenster nutzt die uebergebene Zaehlweise", () => {
  const zaehlweise = { zaehltMit: (c) => c.x === 1, belegtErfolg: (c) => c.ok === true, belegtFehler: (c, b) => b === "b" };
  const calls = [{ x: 1, ok: true, endedAt: vor(1) }, { x: 1, tenantId: "a", endedAt: vor(1) }, { x: 2, endedAt: vor(1) }];
  const f = outageWindow(calls, { nowMs: JETZT, windowMs: FENSTER, bucket: "b", zaehlweise });
  assert.deepEqual(f, { fehler: 1, versuche: 2, erfolge: 1, tenants: 1 });
  assert.equal(ZAEHLWEISE_OUTBOUND.zaehltMit({ direction: "inbound" }), false);
  assert.equal(outageBucket("failed-D12"), "failed");
  assert.equal(outageBucket(undefined), null);
});

const SCHWELLEN = { windowMs: FENSTER, minFailures: 3, minAttempts: 10, failSharePercent: 50, debounceMs: 1000, retryMs: 500 };
const urteil = (fenster, marker) => beurteileAusfall({ fenster, marker, schwellen: SCHWELLEN, nowMs: JETZT }).urteil;
const zahlen = (fehler, versuche, erfolge) => ({ fehler, versuche, erfolge, tenants: 1 });
const zweiTenants = (z) => ({ ...z, tenants: 2 });

test("Ausfall-Urteil: aus, kein Befund, erholt, Erstbefund", () => {
  const f = zahlen(0, 4, 4);
  const aus = beurteileAusfall({ fenster: f, marker: {}, schwellen: { ...SCHWELLEN, windowMs: 0 }, nowMs: JETZT });
  assert.deepEqual(aus, { urteil: "aus", zahlen: f });
  assert.equal(urteil(f, null), "kein-befund");
  assert.equal(urteil(zahlen(0, 0, 0), {}), "kein-befund");
  assert.equal(urteil(f, {}), "erholt");
  assert.equal(urteil(zahlen(1, 4, 3), null), "erstbefund");
  assert.deepEqual(OUTAGE_VERDICT, { OFF: "aus", NONE: "kein-befund", FIRST: "erstbefund", ALERT: "alarm", RECOVERED: "erholt" });
  assert.equal(MIN_TENANTS_SHARED_FAULT, 2);
});

tabelle(
  "Ausfall-Urteil bei bestehendem Marker",
  [
    [zahlen(3, 5, 0), "alarm"], [zahlen(2, 5, 0), "kein-befund"], [zahlen(3, 5, 2), "kein-befund"],
    [zweiTenants(zahlen(3, 5, 2)), "alarm"], [zahlen(3, 10, 0), "kein-befund"], [zahlen(5, 10, 5), "alarm"],
    [zahlen(4, 10, 6), "kein-befund"], [zahlen(5, 9, 4), "kein-befund"], [zahlen(6, 12, 6), "alarm"],
    [zahlen(5, 12, 7), "kein-befund"],
  ],
  (f) => urteil(f, {}),
);

test("Ausfall-Urteil: Entprellung und Wiederholsperre gelten", () => {
  const f = zahlen(3, 5, 0);
  assert.equal(urteil(f, { reportedAt: vor(999) }), "kein-befund");
  assert.equal(urteil(f, { reportedAt: vor(1000) }), "alarm");
  assert.equal(urteil(f, { lastAttemptAt: vor(499) }), "kein-befund");
  assert.equal(urteil(f, { lastAttemptAt: vor(500) }), "alarm");
});

test("Meldung erlaubt: reportedAt geht vor lastAttemptAt, ohne beides frei", () => {
  const g = { debounceMs: 1000, retryMs: 500 };
  assert.equal(meldeErlaubt({}, JETZT, g), true);
  assert.equal(meldeErlaubt({ reportedAt: vor(1000) }, JETZT, g), true);
  assert.equal(meldeErlaubt({ reportedAt: vor(999) }, JETZT, g), false);
  assert.equal(meldeErlaubt({ reportedAt: vor(999), lastAttemptAt: vor(5000) }, JETZT, g), false);
  assert.equal(meldeErlaubt({ reportedAt: vor(5000), lastAttemptAt: vor(1) }, JETZT, g), true);
  assert.equal(meldeErlaubt({ lastAttemptAt: vor(500) }, JETZT, g), true);
  assert.equal(meldeErlaubt({ lastAttemptAt: vor(499) }, JETZT, g), false);
});

test("Alarmzeile nennt Klasse, Zahlen, gerundetes Fenster und Regel", () => {
  const z = zweiTenants(zahlen(3, 7, 2));
  assert.equal(
    alarmZeile({ code: "outbound:x", zahlen: z, regel: "skala", windowMs: 600000 }),
    "Hermes Betriebsmeldung\nklasse=outbound:x fehler=3 versuche=7 erfolge=2 tenants=2 fenster_min=10 regel=skala",
  );
  assert.match(alarmZeile({ code: "c", zahlen: z, regel: "r", windowMs: 90000 }), /fenster_min=2 /);
  assert.match(alarmZeile({ code: "c", zahlen: z, regel: "r", windowMs: 80000 }), /fenster_min=1 /);
});

const EL = KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI;
const EL_OUT = KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI;
const zaehlt = (klasse, call) => {
  const z = AUSFALL_KLASSE[klasse].zaehlweise;
  return [z.zaehltMit(call), z.belegtErfolg(call), z.belegtFehler(call)];
};

test("Ausfallklassen: Codes und Zaehlweisen der Elevenlabs-Uebergabe", () => {
  assert.equal(INBOUND_EL_OUTAGE_CODE, "inbound-el:uebergabe");
  assert.equal(OUTBOUND_EL_OUTAGE_CODE, "outbound-el:uebergabe");
  assert.equal(AUSFALL_KLASSE.INBOUND_EL.code, INBOUND_EL_OUTAGE_CODE);
  assert.equal(AUSFALL_KLASSE.OUTBOUND_EL.code, OUTBOUND_EL_OUTAGE_CODE);
  assert.equal(AUSFALL_KLASSE.OUTBOUND.code, undefined);
  assert.equal(AUSFALL_KLASSE.OUTBOUND.zaehlweise, ZAEHLWEISE_OUTBOUND);
  assert.ok(Object.isFrozen(AUSFALL_KLASSE) && Object.isFrozen(AUSFALL_KLASSE.INBOUND_EL));
  const inb = { costProfile: EL, direction: "inbound" };
  assert.deepEqual(zaehlt("INBOUND_EL", inb), [true, false, false]);
  assert.deepEqual(zaehlt("INBOUND_EL", { ...inb, elevenlabsConversationId: "c1" }), [true, true, false]);
  assert.deepEqual(zaehlt("INBOUND_EL", { ...inb, elFallbackAt: vor(1) }), [true, false, true]);
  assert.deepEqual(zaehlt("INBOUND_EL", { costProfile: EL }), [true, false, false]);
  assert.deepEqual(zaehlt("INBOUND_EL", { costProfile: KOSTENPROFIL.TELNYX_BUDGET }), [false, false, false]);
  assert.deepEqual(zaehlt("INBOUND_EL", { ...inb, direction: "outbound" }), [false, false, false]);
  assert.deepEqual(zaehlt("INBOUND_EL", undefined), [false, false, false]);
});

test("Ausfallklassen: ausgehende Elevenlabs-Uebergabe zaehlt nur beantwortete Anrufe", () => {
  const out = { costProfile: EL_OUT, answeredAt: vor(5) };
  assert.deepEqual(zaehlt("OUTBOUND_EL", out), [true, false, false]);
  assert.deepEqual(zaehlt("OUTBOUND_EL", { ...out, elevenlabsConversationId: "c1" }), [true, true, false]);
  assert.deepEqual(zaehlt("OUTBOUND_EL", { ...out, elFallbackAt: vor(1) }), [true, false, true]);
  assert.deepEqual(zaehlt("OUTBOUND_EL", { costProfile: EL_OUT }), [false, false, false]);
  assert.deepEqual(zaehlt("OUTBOUND_EL", { costProfile: EL, elevenlabsConversationId: "c" }), [false, true, false]);
  assert.deepEqual(zaehlt("OUTBOUND_EL", undefined), [false, false, false]);
});

const BILLING = {
  outageAlertWindowMs: 11, outageAlertMinFailures: 12, outageAlertMinAttempts: 13,
  outageAlertFailSharePercent: 14, outageAlertDebounceMs: 15, outageAlertRetryMs: 16,
  inboundOutageAlertWindowMs: 21, inboundOutageAlertMinFailures: 22, inboundOutageAlertMinAttempts: 23,
  inboundOutageAlertFailSharePercent: 24,
};

test("Ausfallklassen: Schwellen kommen aus der Billing-Konfiguration", () => {
  const aus = { windowMs: 11, minFailures: 12, minAttempts: 13, failSharePercent: 14, debounceMs: 15, retryMs: 16 };
  const config = { billing: BILLING };
  assert.deepEqual(AUSFALL_KLASSE.OUTBOUND.schwellen(config), aus);
  assert.deepEqual(AUSFALL_KLASSE.OUTBOUND_EL.schwellen(config), aus);
  assert.deepEqual(AUSFALL_KLASSE.INBOUND_EL.schwellen(config), {
    windowMs: 21, minFailures: 22, minAttempts: 23, failSharePercent: 24, debounceMs: 15, retryMs: 16,
  });
  for (const kaputt of [undefined, NaN, Infinity, "21"]) {
    const s = AUSFALL_KLASSE.INBOUND_EL.schwellen({ billing: { ...BILLING, inboundOutageAlertWindowMs: kaputt } });
    assert.equal(s.windowMs, 0, String(kaputt));
  }
  assert.equal(AUSFALL_KLASSE.INBOUND_EL.schwellen({ billing: { ...BILLING, inboundOutageAlertWindowMs: 0 } }).windowMs, 0);
});
