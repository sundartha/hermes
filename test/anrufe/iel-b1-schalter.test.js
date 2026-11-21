import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  inboundElPathFor,
  inboundElAccessDefects,
  SIP_PASSWORD_MIN_LENGTH,
  INIT_WEBHOOK_TOKEN_MIN_LENGTH,
  ZUGANG_MANGEL,
} from "../../src/elevenlabs/inbound-path-decision.ts";
import { EL_INBOUND_ACCESS_FINDING } from "../../src/boot-guard.ts";
import {
  BASE_ENV,
  ROOT,
  EL_INBOUND_ACCESS_BOOT_ENV,
  startServerExpectExit,
} from "../helpers.js";
import { gebauteKonfiguration } from "../gemeinsam/gebaute-konfiguration.js";
import { kindUmgebung } from "../gemeinsam/kind-umgebung.mjs";

const GEPINNT = "tenant_iel_gepinnt";
const FREMD = "tenant_iel_fremd";
const SPEC_MINDESTLAENGE = 32;
const SENTINEL_PASSWORT = "ielb1-geheim-pw-".padEnd(SIP_PASSWORD_MIN_LENGTH - 1, "z");
const SENTINEL_TOKEN = "ielb1-geheim-tk-".padEnd(INIT_WEBHOOK_TOKEN_MIN_LENGTH - 1, "z");

function inboundConfig(overrides = {}) {
  return {
    voice: {
      elevenLabsInbound: {
        enabled: true,
        sipUser: "u",
        sipPassword: "p".repeat(SIP_PASSWORD_MIN_LENGTH),
        initWebhookToken: "t".repeat(INIT_WEBHOOK_TOKEN_MIN_LENGTH),
        ...overrides,
      },
    },
  };
}

const PRAEDIKAT_FAELLE = [
  { name: "aus", overrides: { enabled: false }, tenantId: GEPINNT, erwartet: true },
  { name: "enabled als String", overrides: { enabled: "true" }, tenantId: GEPINNT, erwartet: true },
  { name: "Allowlist leer", overrides: { tenantIds: [] }, tenantId: GEPINNT, erwartet: true },
  { name: "nicht gepinnt", overrides: {}, tenantId: FREMD, erwartet: true },
  { name: "tenantId leer", overrides: { tenantIds: [""] }, tenantId: "", erwartet: true },
  { name: "tenantIds kein Array", overrides: { tenantIds: GEPINNT }, tenantId: GEPINNT, erwartet: true },
  { name: "Zugang fehlt", overrides: { sipUser: "" }, tenantId: GEPINNT, erwartet: false },
  {
    name: "Passwort 31 Zeichen",
    overrides: { sipPassword: "p".repeat(SIP_PASSWORD_MIN_LENGTH - 1) },
    tenantId: GEPINNT,
    erwartet: false,
  },
  {
    name: "Token 31 Zeichen",
    overrides: { initWebhookToken: "t".repeat(INIT_WEBHOOK_TOKEN_MIN_LENGTH - 1) },
    tenantId: GEPINNT,
    erwartet: false,
  },
  { name: "alles da, Grenzwert genau 32", overrides: {}, tenantId: GEPINNT, erwartet: true },
];

for (const fall of PRAEDIKAT_FAELLE) {
  test(`IEL-B1-1 Praedikat: ${fall.name}`, () => {
    const config = inboundConfig(fall.overrides);
    assert.equal(inboundElPathFor({ config, tenantId: fall.tenantId }), fall.erwartet);
  });
}

test("IEL-B1-2: die Mindestlaengen sind exakt die Spec-Vorgabe (32)", () => {
  assert.equal(SIP_PASSWORD_MIN_LENGTH, SPEC_MINDESTLAENGE);
  assert.equal(INIT_WEBHOOK_TOKEN_MIN_LENGTH, SPEC_MINDESTLAENGE);
});

test("IEL-B1-3a: Schalter aus liefert keine Maengel", () => {
  assert.deepEqual(inboundElAccessDefects(inboundConfig({ enabled: false }).voice.elevenLabsInbound), []);
});

test("IEL-B1-3b: vollstaendiger Zugang liefert keine Maengel", () => {
  assert.deepEqual(inboundElAccessDefects(inboundConfig().voice.elevenLabsInbound), []);
});

test("IEL-B1-3c: Benutzer leer + Passwort/Token zu kurz - genau ein Sentinel-Befund, kein Wert im Text", () => {
  const defekte = inboundElAccessDefects({
    sipUser: "",
    sipPassword: SENTINEL_PASSWORT,
    initWebhookToken: SENTINEL_TOKEN,
  });
  const ERWARTETE_ENV_KEYS = [
    "ELEVENLABS_INBOUND_SIP_USER",
    "ELEVENLABS_INBOUND_SIP_PASSWORD",
    "ELEVENLABS_INIT_WEBHOOK_TOKEN",
  ];
  assert.equal(defekte.length, ERWARTETE_ENV_KEYS.length);
  assert.deepEqual(
    defekte.map((defekt) => defekt.envKey),
    ERWARTETE_ENV_KEYS,
  );
  assert.equal(defekte[0].mangel, ZUGANG_MANGEL.FEHLT);
  assert.equal(defekte[1].mangel, ZUGANG_MANGEL.ZU_KURZ);
  assert.equal(defekte[2].mangel, ZUGANG_MANGEL.ZU_KURZ);
});

test("IEL-B1-4: Schalter an, Token fehlt - Boot-Refusal nennt genau diesen Schluessel", async () => {
  const { code, output } = await startServerExpectExit({
    env: {
      ELEVENLABS_INBOUND_ENABLED: "true",
      ELEVENLABS_INBOUND_SIP_USER: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_USER,
      ELEVENLABS_INBOUND_SIP_PASSWORD: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD,
      ELEVENLABS_INIT_WEBHOOK_TOKEN: "",
    },
  });
  assert.equal(code, 1);
  assert.match(output, /Start abgebrochen/);
  assert.match(output, /ELEVENLABS_INIT_WEBHOOK_TOKEN fehlt/);
});

test("IEL-B1-5: Schalter an, Passwort 31 Zeichen - Boot-Refusal ohne den Sentinel-Wert im Log", async () => {
  const { code, output } = await startServerExpectExit({
    env: {
      ELEVENLABS_INBOUND_ENABLED: "true",
      ELEVENLABS_INBOUND_SIP_USER: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_USER,
      ELEVENLABS_INBOUND_SIP_PASSWORD: SENTINEL_PASSWORT,
      ELEVENLABS_INIT_WEBHOOK_TOKEN: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN,
    },
  });
  assert.equal(code, 1);
  assert.match(output, /ELEVENLABS_INBOUND_SIP_PASSWORD zu kurz/);
  assert.ok(!output.includes("ielb1-geheim"), "der Sentinel-Wert darf nie im Boot-Log stehen");
});

test("IEL-B1-6: Schalter an, Token 31 Zeichen - Boot-Refusal ohne den Sentinel-Wert im Log", async () => {
  const { code, output } = await startServerExpectExit({
    env: {
      ELEVENLABS_INBOUND_ENABLED: "true",
      ELEVENLABS_INBOUND_SIP_USER: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_USER,
      ELEVENLABS_INBOUND_SIP_PASSWORD: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD,
      ELEVENLABS_INIT_WEBHOOK_TOKEN: SENTINEL_TOKEN,
    },
  });
  assert.equal(code, 1);
  assert.match(output, /ELEVENLABS_INIT_WEBHOOK_TOKEN zu kurz/);
  assert.ok(!output.includes("ielb1-geheim"), "der Sentinel-Wert darf nie im Boot-Log stehen");
});

test("IEL-B1-3c/EL_INBOUND_ACCESS_FINDING: der Befund-Code ist der erwartete Konstanten-Wert", () => {
  assert.equal(EL_INBOUND_ACCESS_FINDING.INCOMPLETE, "el_inbound_access_incomplete");
});

function readBuiltInboundConfig(overrides = {}) {
  const env = kindUmgebung({ ...BASE_ENV, ...overrides, NODE_ENV: "test" });
  const script =
    "import(\"./src/config.ts\").then(({ config }) => " +
    "process.stdout.write(JSON.stringify({ " +
    "sipUserLength: config.voice.elevenLabsInbound.sipUser.length, " +
    "sipPasswordLength: config.voice.elevenLabsInbound.sipPassword.length, " +
    "initWebhookTokenLength: config.voice.elevenLabsInbound.initWebhookToken.length })));";
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  });
  return JSON.parse(out);
}

test("IEL-B1-7a: ohne Zugangswerte baut die Konfiguration Laenge 0 ueberall", () => {
  const built = readBuiltInboundConfig({
    ELEVENLABS_INBOUND_SIP_USER: "",
    ELEVENLABS_INBOUND_SIP_PASSWORD: "",
    ELEVENLABS_INIT_WEBHOOK_TOKEN: "",
  });
  assert.equal(built.sipUserLength, 0);
  assert.equal(built.sipPasswordLength, 0);
  assert.equal(built.initWebhookTokenLength, 0);
});

test("IEL-B1-7b: Passwort mit Whitespace/Newline wird getrimmt", () => {
  const built = readBuiltInboundConfig({
    ELEVENLABS_INBOUND_SIP_PASSWORD: `  ${"p".repeat(SIP_PASSWORD_MIN_LENGTH)}\n`,
  });
  assert.equal(built.sipPasswordLength, SIP_PASSWORD_MIN_LENGTH);
});

const ENV_KOHAERENZ_SCHLUESSEL = [
  "ELEVENLABS_INBOUND_SIP_USER",
  "ELEVENLABS_INBOUND_SIP_PASSWORD",
  "ELEVENLABS_INIT_WEBHOOK_TOKEN",
];

const GEBAUTE_LAENGE_BENUTZER = 3;
const GEBAUTE_LAENGE_PASSWORT = 5;
const GEBAUTE_LAENGE_TOKEN = 7;

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("IEL-B1-8: alle Schluessel stehen kohaerent in config.js, .env.example, render.yaml, BASE_ENV", () => {
  const envExample = readRepoFile(".env.example");
  const renderYaml = readRepoFile("render.yaml");

  assert.deepEqual(
    gebauteKonfiguration({ OWNER_SELF_CALL_TENANT_IDS: "t_eigen" }, ["voice.ownerSelfCallTenantIds"]),
    { "voice.ownerSelfCallTenantIds": ["t_eigen"] },
  );
  assert.match(envExample, /^OWNER_SELF_CALL_TENANT_IDS=\s*(#.*)?$/m);
  assert.match(renderYaml, /key:\s*OWNER_SELF_CALL_TENANT_IDS\s*\n\s*sync:\s*false/);

  assert.deepEqual(
    readBuiltInboundConfig({
      ELEVENLABS_INBOUND_SIP_USER: "u".repeat(GEBAUTE_LAENGE_BENUTZER),
      ELEVENLABS_INBOUND_SIP_PASSWORD: "p".repeat(GEBAUTE_LAENGE_PASSWORT),
      ELEVENLABS_INIT_WEBHOOK_TOKEN: "t".repeat(GEBAUTE_LAENGE_TOKEN),
    }),
    {
      sipUserLength: GEBAUTE_LAENGE_BENUTZER,
      sipPasswordLength: GEBAUTE_LAENGE_PASSWORT,
      initWebhookTokenLength: GEBAUTE_LAENGE_TOKEN,
    },
  );
  for (const key of ENV_KOHAERENZ_SCHLUESSEL) {
    assert.match(envExample, new RegExp(`^${key}=\\s*(#.*)?$`, "m"), `${key} fehlt in .env.example`);
    assert.match(
      renderYaml,
      new RegExp(`key:\\s*${key}\\s*\\n\\s*sync:\\s*false`),
      `${key} fehlt (oder nicht sync:false) in render.yaml`,
    );
    assert.equal(
      BASE_ENV[key],
      EL_INBOUND_ACCESS_BOOT_ENV[key] ?? "",
      `${key} hat nicht den Wert aus EL_INBOUND_ACCESS_BOOT_ENV (leer bei der Allowlist) in test/helpers.js#BASE_ENV`,
    );
  }
});

