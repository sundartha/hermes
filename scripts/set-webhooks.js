#!/usr/bin/env node
// Setzt PUBLIC_URL in .env und konfiguriert die Twilio-Webhooks automatisch per API.
// Aufruf: node scripts/set-webhooks.js https://abc123.ngrok-free.app
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import twilio from "twilio";
import { config } from "../src/config.js";
import * as store from "../src/store.js";
import { findActiveNumber } from "../src/store/views.js";
import { OWNER_TENANT_ID, PROVIDER } from "../src/store/defaults.js";

const url = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https:\/\/[a-z0-9.-]+/i.test(url)) {
  console.error("Aufruf: node scripts/set-webhooks.js <https://deine-ngrok-url>");
  process.exit(1);
}

// 1. .env aktualisieren
const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
let env = fs.readFileSync(envPath, "utf8");
env = env.replace(/^PUBLIC_URL=.*/m, `PUBLIC_URL=${url}`);
fs.writeFileSync(envPath, env);
console.log("✓ .env: PUBLIC_URL =", url);

// 2. Twilio-Webhooks setzen
// Owner-Twilio-Nummer aus dem Store (Owner = Tenant Null, keine TWILIO_NUMBER-Env mehr).
const ownerTwilioNumber =
  findActiveNumber(store.load(), OWNER_TENANT_ID, PROVIDER.TWILIO)?.e164 || "";
if (!ownerTwilioNumber) {
  console.error(
    "✗ Keine aktive Owner-Twilio-Nummer im Store. Erst: npm run seed-owner-number -- <e164> twilio",
  );
  process.exit(1);
}
const c = twilio(config.twilioSid, config.twilioToken);
const nums = await c.incomingPhoneNumbers.list({ limit: 20 });
const norm = (n) => (n || "").replace(/[\s\-()]/g, "");
const mine = nums.find((n) => norm(n.phoneNumber) === norm(ownerTwilioNumber));
if (!mine) {
  console.error("✗ Owner-Twilio-Nummer", ownerTwilioNumber, "nicht im Account gefunden");
  process.exit(1);
}
await c.incomingPhoneNumbers(mine.sid).update({
  voiceUrl: `${url}/voice/incoming`,
  voiceMethod: "POST",
  statusCallback: `${url}/voice/status`,
  statusCallbackMethod: "POST",
});
console.log("✓ Twilio Voice-Webhook:", `${url}/voice/incoming`);
console.log("✓ Twilio Status-Callback:", `${url}/voice/status`);
console.log("\nFertig. Gateway neu starten (npm start), dann: npm run check");
