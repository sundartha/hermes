#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const url = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https:\/\/[a-z0-9.-]+/i.test(url)) {
  console.error("Aufruf: node scripts/set-public-url.js <https://deine-ngrok-url>");
  process.exit(1);
}

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
let env = fs.readFileSync(envPath, "utf8");
env = env.replace(/^PUBLIC_URL=.*/m, `PUBLIC_URL=${url}`);
fs.writeFileSync(envPath, env);
console.log("✓ .env: PUBLIC_URL =", url);
console.log("Telnyx-TeXML-App voice_url auf", `${url}/voice/incoming`, "stellen (Portal).");
console.log("\nFertig. Gateway neu starten (npm start), dann: npm run check");
