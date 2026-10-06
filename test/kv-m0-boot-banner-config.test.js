import { test } from "node:test";
import assert from "node:assert/strict";
import { costConfigBannerLines, UNSET_LABEL } from "../src/boot.js";
import { startServer, PLAN_PRICE_BOOT_ENV } from "./helpers.js";

function bannerConfig({ billing = {}, llm = {}, voice = {} } = {}) {
  return {
    billing: {
      paymentEnabled: false,
      smsCostCents: 0,
      flushEpochIso: null,
      costTruingRequiredRecordTypes: [],
      ...billing,
    },
    llm: { claudeModel: "claude-haiku-4-5", briefingModel: "claude-sonnet-5", ...llm },
    voice: { elevenLabsPlayTts: { enabled: false, ...voice.elevenLabsPlayTts } },
  };
}

test("KV-M0-1: costConfigBannerLines folgt der aufgeloesten Config, NICHT process.env (Muster AL-P16-7)", () => {
  const opposite = {
    PAYMENT_ENABLED: "false",
    SMS_COST_CENTS: "999",
    CLAUDE_MODEL: "opposite-claude-model",
    PRECALL_BRIEFING_MODEL: "opposite-briefing-model",
    ELEVENLABS_PLAY_TTS_ENABLED: "false",
    BILLING_FLUSH_EPOCH: "2099-01-01T00:00:00.000Z",
    COST_TRUING_REQUIRED_RECORD_TYPES: "opposite-record-type",
  };
  const savedEnv = Object.fromEntries(Object.keys(opposite).map((k) => [k, process.env[k]]));
  Object.assign(process.env, opposite);
  try {
    const config = bannerConfig({
      billing: {
        paymentEnabled: true,
        smsCostCents: 2,
        flushEpochIso: null,
        costTruingRequiredRecordTypes: [],
      },
      voice: { elevenLabsPlayTts: { enabled: true } },
    });
    const lines = costConfigBannerLines(config).join("\n");

    assert.match(lines, /AKTIV \(PAYMENT_ENABLED=true\)/);
    assert.match(lines, /SMS_COST_CENTS=2 ct/);
    assert.match(lines, /CLAUDE_MODEL=claude-haiku-4-5/);
    assert.match(lines, /PRECALL_BRIEFING_MODEL=claude-sonnet-5/);
    assert.match(lines, /AKTIV \(ELEVENLABS_PLAY_TTS_ENABLED=true\)/);

    assert.doesNotMatch(lines, /999/);
    assert.doesNotMatch(lines, /opposite-claude-model/);
    assert.doesNotMatch(lines, /opposite-briefing-model/);
    assert.doesNotMatch(lines, /opposite-record-type/);
    assert.doesNotMatch(lines, /2099-01-01/);
    assert.doesNotMatch(lines, /aus \(PAYMENT_ENABLED=false\)/);
    assert.doesNotMatch(lines, /aus \(ELEVENLABS_PLAY_TTS_ENABLED=false\)/);
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("KV-M0-2: BILLING_FLUSH_EPOCH und COST_TRUING_REQUIRED_RECORD_TYPES zeigen bei null/leer denselben Literal-String", () => {
  const config = bannerConfig({ billing: { flushEpochIso: null, costTruingRequiredRecordTypes: [] } });
  const [paymentLine, costTruingLine] = costConfigBannerLines(config);
  assert.match(paymentLine, new RegExp(`BILLING_FLUSH_EPOCH=${UNSET_LABEL}$`));
  assert.equal(costTruingLine, `Cost-Truing-Typen: COST_TRUING_REQUIRED_RECORD_TYPES=${UNSET_LABEL}`);
});

test("KV-M0-3: die fuenf nicht-nullbaren Felder zeigen NIE UNSET_LABEL, auch auf ihrem Fallback-Wert (Gegenprobe zu KV-M0-2)", () => {
  const config = bannerConfig({
    billing: {
      paymentEnabled: false,
      smsCostCents: 0,
      flushEpochIso: "2026-08-03T00:00:00.000Z",
      costTruingRequiredRecordTypes: ["sip-trunking"],
    },
    voice: { elevenLabsPlayTts: { enabled: false } },
  });
  const lines = costConfigBannerLines(config);
  for (const line of lines) {
    assert.doesNotMatch(line, new RegExp(UNSET_LABEL), `Zeile darf "${UNSET_LABEL}" nicht zeigen: ${line}`);
  }
  assert.match(lines[0], /SMS_COST_CENTS=0 ct/);
});

const ALL_SEVEN_SET_ENV = {
  PAYMENT_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test_x",
  NUMBER_SETUP_FEE_CENTS: "500",
  SMS_COST_CENTS: "2",
  BILLING_FLUSH_EPOCH: "2026-08-03T00:00:00Z",
  COST_TRUING_REQUIRED_RECORD_TYPES:
    "sip-trunking,call-control,speech-to-text,text-to-speech,recording,ai-voice-assistant",
  ELEVENLABS_PLAY_TTS_ENABLED: "true",
  ...PLAN_PRICE_BOOT_ENV,
};

async function startAllSevenSetServer() {
  const srv = await startServer({
    env: {
      ...ALL_SEVEN_SET_ENV,
      ANTHROPIC_API_KEY: "sk-ant-kv-m0-secret-darf-nirgends-auftauchen",
      TELNYX_API_KEY: "kv-m0-telnyx-key-darf-nirgends-auftauchen",
    },
  });
  const res = await fetch(`${srv.localUrl}/healthz`);
  assert.equal(res.status, 200);
  return srv;
}

test("KV-M0-4: der echte Boot druckt alle drei Zeilen genau einmal (BASE_ENV-Defaults, Muster AL-P16-8)", async () => {
  const srv = await startServer({ env: { SMS_COST_CENTS: "0" } });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    for (const label of ["Zahlungsabwicklung", "Cost-Truing-Typen", "Modelle"]) {
      const hits = srv.stdout.match(new RegExp(`${label}: `, "g"));
      assert.equal(hits ? hits.length : 0, 1, `erwartet genau eine ${label}-Zeile:\n${srv.stdout}`);
    }
    assert.match(
      srv.stdout,
      /Zahlungsabwicklung: aus \(PAYMENT_ENABLED=false\) \| SMS_COST_CENTS=0 ct \| BILLING_FLUSH_EPOCH=nicht gesetzt/,
    );
    assert.match(
      srv.stdout,
      /Cost-Truing-Typen: COST_TRUING_REQUIRED_RECORD_TYPES=sip-trunking,call-control/,
    );
    assert.match(
      srv.stdout,
      /Modelle: CLAUDE_MODEL=claude-haiku-4-5 \| PRECALL_BRIEFING_MODEL=claude-sonnet-5 \| aus \(ELEVENLABS_PLAY_TTS_ENABLED=false\)/,
    );
  } finally {
    await srv.stop();
  }
});

test("KV-M0-5: alle sieben Werte gesetzt - das Banner zeigt sie und leakt keines der STRIPE-Secrets", async () => {
  const srv = await startAllSevenSetServer();
  try {
    const stdout = srv.stdout;
    assert.match(stdout, /AKTIV \(PAYMENT_ENABLED=true\)/);
    assert.match(stdout, /SMS_COST_CENTS=2 ct/);
    assert.match(stdout, /BILLING_FLUSH_EPOCH=2026-08-03T00:00:00\.000Z/);
    assert.match(
      stdout,
      /COST_TRUING_REQUIRED_RECORD_TYPES=sip-trunking,call-control,speech-to-text,text-to-speech,recording,ai-voice-assistant/,
    );
    assert.match(stdout, /AKTIV \(ELEVENLABS_PLAY_TTS_ENABLED=true\)/);
    assert.doesNotMatch(stdout, /sk_test_x/);
    assert.doesNotMatch(stdout, /whsec_test_x/);
  } finally {
    await srv.stop();
  }
});

const SECRET_LEAK_PATTERNS = [
  { name: "sk_-Praefix", pattern: /sk_/ },
  { name: "sk--Praefix", pattern: /sk-/ },
  { name: "Bearer-Header", pattern: /Bearer /i },
  { name: "KEY=-Zuweisung", pattern: /KEY=/ },
  { name: "SECRET=-Zuweisung", pattern: /SECRET=/ },
  { name: "TOKEN=-Zuweisung", pattern: /TOKEN=/ },
  { name: "PASSWORD=-Zuweisung", pattern: /PASSWORD=/i },
  { name: "lange Hex-Zeichenkette (>64)", pattern: /[0-9a-f]{65,}/i },
  { name: "lange Base64-Zeichenkette (>=40)", pattern: /[A-Za-z0-9+/]{40,}={0,2}/ },
];

function bannerSectionFrom(stdout) {
  const start = stdout.indexOf("Hermes Gateway laeuft auf");
  assert.ok(start >= 0, "Banner-Startmarke 'Hermes Gateway laeuft auf' nicht im Boot-Log gefunden");
  return stdout.slice(start);
}

test("KV-M0-6: kein Secret-Muster in der GESAMTEN Boot-Banner-Ausgabe (bleibender Wert der Phase)", async () => {
  const srv = await startAllSevenSetServer();
  try {
    const bannerSection = bannerSectionFrom(srv.stdout);
    for (const { name, pattern } of SECRET_LEAK_PATTERNS) {
      assert.doesNotMatch(bannerSection, pattern, `Secret-Muster "${name}" im Boot-Banner gefunden`);
    }
  } finally {
    await srv.stop();
  }
});
