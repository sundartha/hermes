import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  inboundElPathFor,
  inboundElAccessDefects,
  inboundElPinnedTenantCount,
  inboundElAllowlistProbeLine,
  SIP_PASSWORD_MIN_LENGTH,
  INIT_WEBHOOK_TOKEN_MIN_LENGTH,
  ZUGANG_MANGEL,
} from "../src/elevenlabs/inbound-path-decision.js";
import { INBOUND_EL_SCOPE } from "../src/elevenlabs/inbound-scope.js";
import { EL_INBOUND_ACCESS_FINDING } from "../src/boot-guard.js";
import { inboundElBannerLine } from "../src/boot.js";
import { NUMBER_STATUS, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  BASE_ENV,
  ROOT,
  EL_INBOUND_ACCESS_BOOT_ENV,
  startServer,
  startServerExpectExit,
  seedWithTelnyxNumber,
  waitForLog,
  TELNYX_TEST_TENANT_NUMBER,
} from "./helpers.js";
import { gebauteKonfiguration } from "./gemeinsam/gebaute-konfiguration.js";

const GEPINNT = "tenant_iel_gepinnt";
const FREMD = "tenant_iel_fremd";
const SPEC_MINDESTLAENGE = 32;
const SENTINEL_PASSWORT = "ielb1-geheim-pw-".padEnd(SIP_PASSWORD_MIN_LENGTH - 1, "z");
const SENTINEL_TOKEN = "ielb1-geheim-tk-".padEnd(INIT_WEBHOOK_TOKEN_MIN_LENGTH - 1, "z");
const DID = "+493000001188";

function inboundConfig(overrides = {}) {
  return {
    voice: {
      elevenLabsInbound: {
        enabled: true,
        tenantIds: [GEPINNT],
        scope: INBOUND_EL_SCOPE.ALLOWLIST,
        sipUser: "u",
        sipPassword: "p".repeat(SIP_PASSWORD_MIN_LENGTH),
        initWebhookToken: "t".repeat(INIT_WEBHOOK_TOKEN_MIN_LENGTH),
        ...overrides,
      },
    },
  };
}

const PRAEDIKAT_FAELLE = [
  { name: "aus", overrides: { enabled: false }, tenantId: GEPINNT, erwartet: false },
  { name: "enabled als String", overrides: { enabled: "true" }, tenantId: GEPINNT, erwartet: false },
  { name: "Allowlist leer", overrides: { tenantIds: [] }, tenantId: GEPINNT, erwartet: false },
  { name: "nicht gepinnt", overrides: {}, tenantId: FREMD, erwartet: false },
  { name: "tenantId leer", overrides: { tenantIds: [""] }, tenantId: "", erwartet: false },
  { name: "tenantIds kein Array", overrides: { tenantIds: GEPINNT }, tenantId: GEPINNT, erwartet: false },
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
  const env = { PATH: process.env.PATH, ...BASE_ENV, ...overrides, NODE_ENV: "test" };
  const script =
    "import(\"./src/config.js\").then(({ config }) => " +
    "process.stdout.write(JSON.stringify({ " +
    "tenantIds: config.voice.elevenLabsInbound.tenantIds, " +
    "scope: config.voice.elevenLabsInbound.scope, " +
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

test("IEL-B1-7a: BASE_ENV (neutral) baut eine leere Allowlist und Laenge 0 ueberall", () => {
  const built = readBuiltInboundConfig();
  assert.deepEqual(built.tenantIds, []);
  assert.equal(built.sipUserLength, 0);
  assert.equal(built.sipPasswordLength, 0);
  assert.equal(built.initWebhookTokenLength, 0);
});

test("IEL-B1-7b: Kommaliste wird gesplittet/getrimmt, Passwort mit Whitespace/Newline wird getrimmt", () => {
  const built = readBuiltInboundConfig({
    ELEVENLABS_INBOUND_TENANT_IDS: " t_a , ,t_b ",
    ELEVENLABS_INBOUND_SIP_PASSWORD: `  ${"p".repeat(SIP_PASSWORD_MIN_LENGTH)}\n`,
  });
  assert.deepEqual(built.tenantIds, ["t_a", "t_b"]);
  assert.equal(built.sipPasswordLength, SIP_PASSWORD_MIN_LENGTH);
});

test("IEX-A9-8: Scope-Parsing - Default allowlist, getrimmt, unbekannter Wert bleibt (Pruefung im Boot)", () => {
  assert.equal(readBuiltInboundConfig().scope, INBOUND_EL_SCOPE.ALLOWLIST);
  assert.equal(
    readBuiltInboundConfig({ ELEVENLABS_INBOUND_SCOPE: " registrierte_dids \n" }).scope,
    INBOUND_EL_SCOPE.REGISTRIERTE_DIDS,
  );
  assert.equal(readBuiltInboundConfig({ ELEVENLABS_INBOUND_SCOPE: "alle" }).scope, "alle");
});

const ENV_KOHAERENZ_SCHLUESSEL = [
  "ELEVENLABS_INBOUND_TENANT_IDS",
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

test("IEL-B1-8: alle vier Schluessel stehen kohaerent in config.js, .env.example, render.yaml, BASE_ENV", () => {
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
      ELEVENLABS_INBOUND_TENANT_IDS: "t_kohaerent",
      ELEVENLABS_INBOUND_SIP_USER: "u".repeat(GEBAUTE_LAENGE_BENUTZER),
      ELEVENLABS_INBOUND_SIP_PASSWORD: "p".repeat(GEBAUTE_LAENGE_PASSWORT),
      ELEVENLABS_INIT_WEBHOOK_TOKEN: "t".repeat(GEBAUTE_LAENGE_TOKEN),
    }),
    {
      tenantIds: ["t_kohaerent"],
      scope: INBOUND_EL_SCOPE.ALLOWLIST,
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
    assert.equal(BASE_ENV[key], "", `${key} fehlt oder ist nicht leer in test/helpers.js#BASE_ENV`);
  }
});

test("IEX-A9-9: ELEVENLABS_INBOUND_SCOPE steht kohaerent in config.js, .env.example, render.yaml, BASE_ENV", () => {
  const envExample = readRepoFile(".env.example");
  const renderYaml = readRepoFile("render.yaml");

  assert.deepEqual(gebauteKonfiguration({ STT_PROFILE: "profil-probe" }, ["voice.sttProfile"]), {
    "voice.sttProfile": "profil-probe",
  });

  assert.equal(
    readBuiltInboundConfig({ ELEVENLABS_INBOUND_SCOPE: INBOUND_EL_SCOPE.REGISTRIERTE_DIDS }).scope,
    INBOUND_EL_SCOPE.REGISTRIERTE_DIDS,
  );
  assert.match(envExample, /^ELEVENLABS_INBOUND_SCOPE=allowlist\s*$/m);
  assert.match(renderYaml, /key:\s*ELEVENLABS_INBOUND_SCOPE\s*\n\s*value:\s*"allowlist"/);
  assert.equal(BASE_ENV.ELEVENLABS_INBOUND_SCOPE, "");
});

test("IEL-B1-9: leere Allowlist, keine Nummern - keine aktive DID", () => {
  const zeile = inboundElAllowlistProbeLine({ state: { numbers: [] }, tenantIds: [] });
  assert.equal(zeile, "Inbound-EL-Allowlist: 0 Tenants, keine aktive DID");
});

test("IEL-B1-10: eine aktive DID beim gepinnten Tenant - nur die letzten 4 Ziffern, keine Tenant-ID", () => {
  const zeile = inboundElAllowlistProbeLine({
    state: { numbers: [{ tenantId: GEPINNT, status: NUMBER_STATUS.ACTIVE, e164: DID }] },
    tenantIds: [GEPINNT],
  });
  assert.ok(zeile.endsWith("…1188"));
  assert.ok(!zeile.includes(DID));
  assert.ok(!zeile.includes(GEPINNT));
  assert.ok(zeile.startsWith("Inbound-EL-Allowlist: 1 Tenants, aktive DIDs "));
});

test("IEL-B1-11: eine aktive DID bei einem NICHT gepinnten Tenant taucht nicht auf", () => {
  const zeile = inboundElAllowlistProbeLine({
    state: {
      numbers: [
        { tenantId: FREMD, status: NUMBER_STATUS.ACTIVE, e164: "+493000002222" },
        { tenantId: GEPINNT, status: NUMBER_STATUS.ACTIVE, e164: DID },
      ],
    },
    tenantIds: [GEPINNT],
  });
  assert.ok(!zeile.includes("2222"));
});

test("IEL-B1-12: gepinnter Tenant nur mit SUSPENDED/RELEASED - keine aktive DID", () => {
  const zeile = inboundElAllowlistProbeLine({
    state: {
      numbers: [
        { tenantId: GEPINNT, status: NUMBER_STATUS.SUSPENDED, e164: DID },
        { tenantId: GEPINNT, status: NUMBER_STATUS.RELEASED, e164: "+493000003333" },
      ],
    },
    tenantIds: [GEPINNT],
  });
  assert.equal(zeile, "Inbound-EL-Allowlist: 1 Tenants, keine aktive DID");
});

test("IEL-B1-13: doppelter Allowlist-Eintrag zaehlt einmal", () => {
  const zeile = inboundElAllowlistProbeLine({ state: { numbers: [] }, tenantIds: [GEPINNT, GEPINNT] });
  assert.equal(inboundElPinnedTenantCount([GEPINNT, GEPINNT]), 1);
  assert.ok(zeile.startsWith("Inbound-EL-Allowlist: 1 Tenants, "));
});

test("IEL-B1-14: Banner-Zeile - aus/an, Anzahl, Scope (IEX-A9), nie eine Tenant-ID", () => {
  assert.equal(
    inboundElBannerLine({ enabled: false, tenantIds: [], scope: INBOUND_EL_SCOPE.ALLOWLIST }),
    "Inbound-EL: aus, 0 Tenants, scope=allowlist",
  );
  const zeileAn = inboundElBannerLine({
    enabled: true,
    tenantIds: [GEPINNT, FREMD],
    scope: INBOUND_EL_SCOPE.REGISTRIERTE_DIDS,
  });
  assert.equal(zeileAn, "Inbound-EL: an, 2 Tenants, scope=registrierte_dids");
  assert.ok(!zeileAn.includes(GEPINNT));
});

test("IEL-B1-15: die Allowlist-Sondenzeile ist unabhaengig vom Schalter byte-gleich, Banner unterscheidet sich", async () => {
  const seed = seedWithTelnyxNumber();
  const srvAus = await startServer({
    env: { ELEVENLABS_INBOUND_TENANT_IDS: BOOTSTRAP_TENANT_ID },
    seed,
  });
  const srvAn = await startServer({
    env: {
      ELEVENLABS_INBOUND_ENABLED: "true",
      ELEVENLABS_INBOUND_TENANT_IDS: BOOTSTRAP_TENANT_ID,
      ...EL_INBOUND_ACCESS_BOOT_ENV,
    },
    seed,
  });
  try {
    await waitForLog(srvAus, /Inbound-EL-Allowlist: /);
    await waitForLog(srvAn, /Inbound-EL-Allowlist: /);

    const sondeAus = (srvAus.stdout.match(/Inbound-EL-Allowlist: .*/g) || []).filter(Boolean);
    const sondeAn = (srvAn.stdout.match(/Inbound-EL-Allowlist: .*/g) || []).filter(Boolean);
    assert.equal(sondeAus.length, 1, "genau eine Sonden-Zeile (Server aus)");
    assert.equal(sondeAn.length, 1, "genau eine Sonden-Zeile (Server an)");
    assert.equal(sondeAus[0].trim(), sondeAn[0].trim(), "Schalter aendert die Sondenzeile nicht");
    assert.equal(sondeAus[0].trim(), "Inbound-EL-Allowlist: 1 Tenants, aktive DIDs …5555");

    assert.ok(!srvAus.stdout.includes(TELNYX_TEST_TENANT_NUMBER), "keine volle Nummer im Log");
    assert.ok(!srvAn.stdout.includes(TELNYX_TEST_TENANT_NUMBER), "keine volle Nummer im Log");

    assert.ok(srvAus.stdout.includes("Inbound-EL: aus, 1 Tenants"));
    assert.ok(srvAn.stdout.includes("Inbound-EL: an, 1 Tenants"));

    assert.ok(!srvAn.stdout.includes(EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_USER));
    assert.ok(!srvAn.stdout.includes(EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD));
  } finally {
    await srvAus.stop();
    await srvAn.stop();
  }
});
