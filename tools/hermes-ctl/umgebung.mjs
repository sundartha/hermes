import { generateKeyPairSync, randomBytes } from "node:crypto";

import pg from "pg";

import { BENCH_EXA_API_KEY } from "../../scripts/convo-bench/exa-fake.mjs";
import { PLAN_PRICE_BOOT_ENV } from "../../test/helpers.js";

const ANBIETER = "telnyx";
const AGENT_ID = "agent_hermes_ctl";
const ED25519_ROHSCHLUESSEL_LAENGE = 32;
const GEHEIMNIS_BYTES = 24;
const ERGEBNIS_ABRUF_MS = "200";
const ANLEGEGEBUEHR_CENT = "100";

export async function poolgroesseHermes() {
  const pool = new pg.Pool();
  await pool.end();
  return pool.options.max;
}

const geheimnis = () => randomBytes(GEHEIMNIS_BYTES).toString("hex");

export function schluesselErzeugen() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    telnyxOeffentlich: publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-ED25519_ROHSCHLUESSEL_LAENGE)
      .toString("base64"),
    telnyxPrivatPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    werkzeugToken: geheimnis(),
    statusToken: geheimnis(),
    initToken: geheimnis(),
    stripeGeheimnis: `whsec_${geheimnis()}`,
    sitzungsGeheimnis: geheimnis(),
    bestaetigungsGeheimnis: geheimnis(),
  };
}

export function hermesUmgebung({ schluessel, urls, pgUrl, eigentuemerNummer }) {
  return {
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: schluessel.telnyxOeffentlich,
    TELNYX_API_BASE: urls.anbieterOhneAntwort,
    STRIPE_API_BASE: urls.anbieterOhneAntwort,
    SESSION_SECRET: schluessel.sitzungsGeheimnis,
    PAYMENT_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_hermes_ctl",
    STRIPE_WEBHOOK_SECRET: schluessel.stripeGeheimnis,
    NUMBER_SETUP_FEE_CENTS: ANLEGEGEBUEHR_CENT,
    ...PLAN_PRICE_BOOT_ENV,
    STORE_BACKEND: "pg",
    BOOTSTRAP_E164: eigentuemerNummer,
    BOOTSTRAP_PROVIDER: ANBIETER,
    PROVISIONING_ENABLED: "true",
    ELEVENLABS_NUMBER_REGISTRATION_ENABLED: "true",
    TELNYX_SIP_TRUNK_USERNAME: "hermes-ctl",
    TELNYX_SIP_TRUNK_PASSWORD: "hermes-ctl-attrappe",
    DATABASE_URL: pgUrl,
    ELEVENLABS_OUTBOUND_ENABLED: "true",
    ELEVENLABS_AGENT_ID: AGENT_ID,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_hermes_ctl",
    ELEVENLABS_API_KEY: "hermes-ctl-attrappe",
    ELEVENLABS_API_BASE: urls.elevenLabs,
    ELEVENLABS_RESULT_POLL_MS: ERGEBNIS_ABRUF_MS,
    ELEVENLABS_TOOL_TOKEN: schluessel.werkzeugToken,
    ELEVENLABS_INIT_WEBHOOK_TOKEN: schluessel.initToken,
    HERMES_STATUS_TOKEN: schluessel.statusToken,
    CONSULT_ENABLED: "true",
    ASSISTANT_CONTEXT_ENABLED: "true",
    IN_CALL_CONSULT_ENABLED: "true",
    LOOKUP_ENABLED: "true",
    EXA_API_KEY: BENCH_EXA_API_KEY,
    EXA_API_BASE: urls.exa,
    ANTHROPIC_BASE_URL: urls.anthropic,
    MCP_UI_ENABLED: "true",
    CALL_CONFIRMATION_SECRET: schluessel.bestaetigungsGeheimnis,
  };
}
