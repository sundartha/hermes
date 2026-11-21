import assert from "node:assert/strict";
import { test } from "node:test";

import { config, assertConfig } from "../../src/config.ts";
import { makeConfigOverrides, CONFIG_REQUIRED_OK, startServer } from "../helpers.js";
import { fehlerausgabeVon } from "./fehlerausgabe.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const PRODUKTIV_OK = {
  ...CONFIG_REQUIRED_OK,
  storeBackend: "pg",
  databaseUrl: "postgres://x",
  dashboardPassword: "geheim",
  skipTwilioSignatureCheck: false,
  publicUrlExplicit: true,
  platformAlertSmsTo: "",
  platformAlertMailTo: "",
  betterstackAlertUrl: "",
};

const GUELTIGE_URL = "https://in.logs.betterstack.test/geheimes-token-4711";

function produktiv(overrides, aufgabe) {
  const vorher = process.env.RENDER_EXTERNAL_URL;
  process.env.RENDER_EXTERNAL_URL = "https://agent.onrender.test";
  try {
    return withConfigOverrides({ ...PRODUKTIV_OK, ...overrides }, aufgabe);
  } finally {
    if (vorher === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = vorher;
  }
}

function pruefe(overrides) {
  let ergebnis;
  const zeilen = fehlerausgabeVon(() => {
    ergebnis = produktiv(overrides, () => assertConfig());
  });
  return { ergebnis, ausgabe: zeilen.join("\n") };
}

test("Produktiv ohne BETTERSTACK_ALERT_URL: Start verweigert, auch mit SMS und Mail", () => {
  const { ergebnis, ausgabe } = pruefe({
    platformAlertSmsTo: "+15005550006",
    platformAlertMailTo: "ops@example.test",
    brevoApiKey: "x",
  });
  assert.equal(ergebnis, false);
  assert.match(ausgabe, /BETTERSTACK_ALERT_URL/);
});

test("Produktiv mit gueltiger https-URL: Start erlaubt, URL nie in der Ausgabe", () => {
  const { ergebnis, ausgabe } = pruefe({ betterstackAlertUrl: GUELTIGE_URL });
  assert.equal(ergebnis, true);
  assert.doesNotMatch(ausgabe, /geheimes-token-4711/);
});

for (const wert of ["ftp://geheim-4711.test/x", "Muell-4711"]) {
  test(`Produktiv mit ungueltiger URL ${wert}: Start verweigert, Wert nicht in der Ausgabe`, () => {
    const { ergebnis, ausgabe } = pruefe({ betterstackAlertUrl: wert });
    assert.equal(ergebnis, false);
    assert.match(ausgabe, /BETTERSTACK_ALERT_URL/);
    assert.doesNotMatch(ausgabe, /4711/);
  });
}

test("Eingang gesetzt: fehlende SMS ist kein Befund mehr, auch mit Outbound und Ausfallfenster", () => {
  const { ergebnis } = pruefe({
    betterstackAlertUrl: GUELTIGE_URL,
    paymentEnabled: true,
    stripeSecretKey: "x",
    stripeWebhookSecret: "x",
    numberSetupFeeCents: 100,
    platformSpendWarnPercent: 80,
  });
  assert.equal(ergebnis, true);
});

test("Eingang gesetzt, weder SMS noch Mail, Outbound an und Ausfallfenster offen: Start erlaubt", () => {
  const { ergebnis, ausgabe } = pruefe({
    betterstackAlertUrl: GUELTIGE_URL,
    elevenLabsOutbound: { ...config.voice.elevenLabsOutbound, enabled: true },
    outageAlertWindowMs: 600000,
  });
  assert.equal(ergebnis, true);
  assert.doesNotMatch(ausgabe, /PLATFORM_ALERT_SMS_TO/);
});

test("Ohne Eingang, weder SMS noch Mail, Outbound an und Ausfallfenster offen: Start verweigert", () => {
  const { ergebnis, ausgabe } = pruefe({
    elevenLabsOutbound: { ...config.voice.elevenLabsOutbound, enabled: true },
    outageAlertWindowMs: 600000,
  });
  assert.equal(ergebnis, false);
  assert.match(ausgabe, /BETTERSTACK_ALERT_URL/);
});

test("Eingang leer, SMS leer, Zahlung aktiv: Befund gilt wie bisher", () => {
  let ergebnis;
  fehlerausgabeVon(() => {
    ergebnis = withConfigOverrides(
      {
        ...CONFIG_REQUIRED_OK,
        paymentEnabled: true,
        stripeSecretKey: "x",
        stripeWebhookSecret: "x",
        numberSetupFeeCents: 100,
        platformSpendWarnPercent: 80,
        platformAlertSmsTo: "",
        betterstackAlertUrl: "",
      },
      () => assertConfig(),
    );
  });
  assert.equal(ergebnis, false);
});

test("Nicht produktiv ohne Eingang: Start erlaubt", () => {
  let ergebnis;
  fehlerausgabeVon(() => {
    ergebnis = withConfigOverrides(
      { ...CONFIG_REQUIRED_OK, betterstackAlertUrl: "", platformAlertSmsTo: "+15005550006" },
      () => assertConfig(),
    );
  });
  assert.equal(ergebnis, true);
});

test("Start ohne Eingang (nicht produktiv): genau eine Konfig-Warnzeile nennt BETTERSTACK_ALERT_URL", async () => {
  const srv = await startServer({ env: { BETTERSTACK_ALERT_URL: "" } });
  try {
    const treffer = srv.stdout
      .split("\n")
      .filter((zeile) => /\[boot\] Konfig-Warnung: .*BETTERSTACK_ALERT_URL/.test(zeile));
    assert.equal(treffer.length, 1);
  } finally {
    await srv.stop();
  }
});

test("Start mit Eingang: keine Warnzeile, URL nicht im Log", async () => {
  const srv = await startServer({ env: { BETTERSTACK_ALERT_URL: GUELTIGE_URL } });
  try {
    assert.doesNotMatch(srv.stdout, /BETTERSTACK_ALERT_URL/);
    assert.doesNotMatch(srv.stdout, /geheimes-token-4711/);
  } finally {
    await srv.stop();
  }
});

test("Produktiv ohne Eingang: Meldung nennt 'ist leer' und alle Anlaesse, nicht 'keine https-Adresse'", () => {
  const { ausgabe } = pruefe({ betterstackAlertUrl: "" });
  assert.match(ausgabe, /BETTERSTACK_ALERT_URL ist leer/);
  assert.match(ausgabe, /Ausfall, Ausgabenwarnung, Kostenabgleich, TTS-Kontingent, Stripe, Start/);
  assert.doesNotMatch(ausgabe, /keine https-Adresse/);
});

test("Produktiv mit ftp-Adresse: Meldung nennt 'keine https-Adresse', nicht 'ist leer'", () => {
  const { ausgabe } = pruefe({ betterstackAlertUrl: "ftp://x.test/y" });
  assert.match(ausgabe, /BETTERSTACK_ALERT_URL ist keine https-Adresse/);
  assert.doesNotMatch(ausgabe, /ist leer/);
});

test("Start mit Eingang: keine Konfig-Warnzeile ohne Text", async () => {
  const srv = await startServer({ env: { BETTERSTACK_ALERT_URL: GUELTIGE_URL } });
  try {
    assert.doesNotMatch(srv.stdout, /Konfig-Warnung: undefined/);
  } finally {
    await srv.stop();
  }
});
