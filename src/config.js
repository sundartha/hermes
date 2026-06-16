import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  claudeModel: process.env.CLAUDE_MODEL || "claude-haiku-4-5",
  maxBudgetEur: parseFloat(process.env.MAX_BUDGET_EUR || "8"),

  twilioSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioToken: process.env.TWILIO_AUTH_TOKEN || "",
  twilioNumber: process.env.TWILIO_NUMBER || "",

  // ---- Telnyx (zweiter Provider, P5; alle optional) ----
  telnyxNumber: process.env.TELNYX_NUMBER || "", // config-derived Seed (idempotent, Owner-Tenant)
  telnyxApiKey: process.env.TELNYX_API_KEY || "", // SECRET - nie loggen/leaken
  telnyxPublicKey: process.env.TELNYX_PUBLIC_KEY || "", // Ed25519-Public-Key des Telnyx-Accounts (verify)
  telnyxApiBase: (process.env.TELNYX_API_BASE || "https://api.telnyx.com").replace(/\/$/, ""),
  // TeXML-Application/Connection-ID: haelt die Voice-URL beim Provider, Pflicht fuer
  // Telnyx-Outbound (originateCall POST /v2/texml/calls/{connection_id}). Leer ->
  // Telnyx-Outbound wirft (fail-closed), Twilio-Outbound unberuehrt.
  telnyxConnectionId: process.env.TELNYX_CONNECTION_ID || "",
  // Telnyx-Account-ID (Mission-Control-Portal): Pflicht fuer den Telnyx-Hangup
  // (POST /v2/texml/Accounts/{account_sid}/Calls/{call_sid}). Leer -> endCall wirft.
  telnyxAccountSid: process.env.TELNYX_ACCOUNT_SID || "",

  // ---- Payment/Billing (Stripe Hold/Capture, P6b1; alle optional) ----
  // Master-Flag: Geld halten -> erst dann provisionieren -> capturen -> aktivieren.
  // DEFAULT AUS (fail-closed): die Onboard-Route reicht KEINEN Billing-Client herein
  // -> kein Hold/Capture, requested->provisioning->active wie bisher (byte-identisch).
  paymentEnabled: (process.env.PAYMENT_ENABLED || "false") === "true",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "", // SECRET - nie loggen/leaken
  stripeApiBase: (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/$/, ""),
  // Einmalige Setup-Gebuehr pro Nummer in GANZZAHL Cents (Geld nie als Float, G26).
  // Bei PAYMENT_ENABLED Pflicht > 0 (assertConfig); 0 = kein Magic-Default.
  numberSetupFeeCents: parseInt(process.env.NUMBER_SETUP_FEE_CENTS || "0", 10),
  paymentCurrency: (process.env.PAYMENT_CURRENCY || "eur").toLowerCase(),

  ownerName: process.env.OWNER_NAME || "Jonas",
  ownerNumber: process.env.OWNER_NUMBER || "",

  // ---- Store-Backend ----
  // "json" (Default) = Datei-Persistenz (data/store.json). "pg" = Postgres.
  // Im json-Pfad wird KEINE DB-Verbindung erzeugt; DATABASE_URL ist dann nicht noetig.
  storeBackend: (process.env.STORE_BACKEND || "json").toLowerCase(),
  // Postgres-Connection-String (NUR bei STORE_BACKEND=pg). Secret -> nie loggen.
  databaseUrl: process.env.DATABASE_URL || "",
  // ---- Queue-Backend (async Provisioning-Worker, P6b2) ----
  // "memory" (Default, fail-closed) = deterministische In-Memory-Queue (drain-on-
  // demand, kein Timer). "pgboss" ist vorbereitet, aber deferred nach P8 (wirft).
  queueBackend: (process.env.QUEUE_BACKEND || "memory").toLowerCase(),

  port: parseInt(process.env.PORT || "3000", 10),
  // Render setzt RENDER_EXTERNAL_URL automatisch -> kein ngrok noetig
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, ""),
  // Passwort-Schutz fuer Dashboard + API im oeffentlichen Hosting (User: admin). Leer = offen (nur lokal ok).
  dashboardPassword: process.env.DASHBOARD_PASSWORD || "",
  sendSmsSummary: (process.env.SEND_SMS_SUMMARY || "true") === "true",

  // ---- Safety-Gates ----
  // Outbound NUR an diese Nummern (kommasepariert, E.164). Leer = alle Outbound-Calls verweigern.
  allowedNumbers: (process.env.ALLOWED_NUMBERS || "")
    .split(",").map((n) => n.replace(/[\s\-()]/g, "")).filter(Boolean),
  // Erlaubte Laendervorwahlen fuer Outbound (kommasepariert, E.164-Prefix wie +49).
  // Default +49 (nur Deutschland). "*" = alle Laender erlaubt (Gate effektiv aus).
  allowedCountryCodes: (process.env.ALLOWED_COUNTRY_CODES || "+49")
    .split(",").map((c) => c.trim()).filter(Boolean),
  // Max. Outbound-Calls pro gleitender Stunde (eigenes Gate, NICHT der Per-IP-Limiter
  // aus rateLimitPerMin). Bremse gegen Toll-Fraud/Kosten-Explosion, falls die Allowlist
  // spaeter gelockert wird. Default 6; 0 = jeder Outbound-Call gesperrt (Not-Aus).
  maxCallsPerHour: parseInt(process.env.MAX_CALLS_PER_HOUR || "6", 10),
  // Notbremse fuer das (zahlungsfreie) Onboarding: harte Obergrenze, wie viele
  // Nummern die Plattform INSGESAMT provisionieren darf. Jede echte Nummer kostet
  // beim Provider Geld -> ohne Cap koennte ein offener Self-Service-Pfad das
  // Provider-Guthaben leeren (R4 Toll-Fraud). Kein Payment-Gate, nur Blast-Radius.
  // 0 = Provisioning gesperrt (Not-Aus). Default bewusst klein.
  maxNumbers: parseInt(process.env.MAX_NUMBERS || "5", 10),
  // Wie viele AKTIVE Nummern ein einzelner Tenant haben darf (zusaetzliches Gate).
  maxNumbersPerTenant: parseInt(process.env.MAX_NUMBERS_PER_TENANT || "1", 10),
  // Self-Service-Provisioning (echter Nummern-Kauf beim Provider). DEFAULT AUS
  // (fail-closed): die Onboarding-Route registriert + fragt dann nur an (Nummer
  // bleibt 'requested', KEIN Geld). Erst true -> echte Kaeufe (gedeckelt durch
  // maxNumbers). Bewusst global statt pro-Order: Blast-Radius ist durch die Caps
  // + Auth + Allowlist bereits winzig (Owner-Phase). NIE per Default an.
  provisioningEnabled: (process.env.PROVISIONING_ENABLED || "false") === "true",
  // Multi-Tenant-Identitaets-/Laufzeit-Schicht (I4-I7). DEFAULT AUS (fail-closed):
  // requestTenant === OWNER_TENANT_ID -> Owner byte-identisch, kein Tenant-Scoping.
  // Erst true (nach allen dichten Scope-Gates I5/I6/I7) loest die Auth-Achse den
  // Request-Tenant auf. EIN gemeinsames Flag fuer I4-I7 (kein separates Login-Flag;
  // Self-Service kommt spaeter unter eigenem Reife-Flag).
  multiTenant: (process.env.MULTI_TENANT || "false") === "true",
  // Self-Service-Schicht (I9): getrenntes Tenant-Dashboard + Self-Service-Settings-
  // Route hinter eigenem Reife-Flag. DEFAULT AUS (fail-closed): die Self-Service-
  // Routen sind nicht erreichbar (404), die getrennte Seite bleibt hinter Basic-Auth
  // -> heutiges Admin-Dashboard + /api/* byte-identisch. Getrennt von MULTI_TENANT
  // (groesste Angriffsflaeche: oeffentlicher Tenant-Login + Self-Service-Schreiben).
  selfServiceEnabled: (process.env.SELF_SERVICE_ENABLED || "false") === "true",
  // ISO-Laendercode fuer die Nummernsuche (DE-only Launch, Plan-Entscheidung #3).
  provisioningCountry: process.env.PROVISIONING_COUNTRY || "DE",
  // Rechteprofile (Phase 2) als JSON {"<email|idp-sub>": {<Profil-Felder>}}. Beim
  // Start in den Store geseedet (store.js). Noetig, weil Render (free plan) ein
  // fluechtiges Dateisystem hat -> per-API angelegte Profile ueberleben keinen
  // Neustart, ueber diese Env-Var gesetzte schon. Leer = keine Seed-Profile.
  profilesSeed: process.env.PROFILES_JSON || "",
  maxCallDurationS: Math.min(parseInt(process.env.MAX_CALL_DURATION_S || "180", 10), 300),
  // Rate-Limit pro IP und Minute fuer alle Nicht-Twilio-Routen (localhost-Socket
  // ausgenommen). Default 120: Dashboard pollt alle 2,5s (~24/min) plus Interaktionen.
  rateLimitPerMin: parseInt(process.env.RATE_LIMIT_PER_MIN || "120", 10),
  // NUR fuer lokale Tests ohne Twilio (z.B. curl gegen /voice/*). Niemals im Hosting setzen!
  skipTwilioSignatureCheck: (process.env.SKIP_TWILIO_SIGNATURE_CHECK || "false") === "true",

  // ---- Datenschutz ----
  // Beendete Calls (samt Transkript) und Notifications aelter als RETENTION_DAYS
  // werden geloescht (DSGVO-Datenminimierung). 0 = Retention aus.
  retentionDays: parseInt(process.env.RETENTION_DAYS || "30", 10),

  // ---- MCP ueber HTTP ----
  // Optionales statisches Bearer-Token fuer /mcp (Prototyp-Abweichung von OAuth, s. README)
  mcpAuthToken: process.env.MCP_AUTH_TOKEN || "",
  // Auth-Modus fuer /mcp:
  //   "" (leer, Default) = Legacy/fail-closed: mit MCP_AUTH_TOKEN gilt Bearer-Token,
  //                        ohne Token ist /mcp nur von localhost erreichbar.
  //   "token"            = statisches Bearer-Token erzwingen (curl/Tests; claude.ai kann das NICHT).
  //   "oauth"            = OAuth 2.1 Resource Server (Produktion, claude.ai-Login-Flow).
  //   "off"              = offen ohne jede Pruefung (nur lokale Demos!).
  mcpAuth: (process.env.MCP_AUTH || "").toLowerCase(),
  // OAuth-Issuer (IdP, z.B. WorkOS AuthKit). Das Gateway findet JWKS selbst ueber
  // <issuer>/.well-known/openid-configuration.
  oauthIssuerUrl: (process.env.OAUTH_ISSUER_URL || "").replace(/\/$/, ""),
  // Erwartete Audience im Access-Token. Leer -> `${publicUrl}/mcp` (kanonische MCP-URL).
  oauthAudience: process.env.OAUTH_AUDIENCE || "",

  // ---- Voice-Engine ----
  // "budget"  = Twilio STT/TTS + Claude Haiku (quasi gratis, Default)
  // "realtime"= OpenAI Realtime API (Speech-to-Speech, Barge-in, ~0,30-0,50 EUR/min)
  voiceEngine: process.env.VOICE_ENGINE || "budget",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  realtimeModel: process.env.REALTIME_MODEL || "gpt-realtime",
  realtimeVoice: process.env.REALTIME_VOICE || "alloy",
  twilioEdge: process.env.TWILIO_EDGE || "frankfurt",

  // Preise pro 1M Tokens in USD (Claude Haiku 4.5). Nur fuer den Budget-Guard.
  priceInPerMTokUsd: 1.0,
  priceOutPerMTokUsd: 5.0,
  usdToEur: 0.93,

  // DATA_DIR-Override, damit Tests nicht das echte data/store.json anfassen
  dataDir: process.env.DATA_DIR || path.join(__dirname, "..", "data"),
  publicDir: path.join(__dirname, "..", "public"),
};

export function assertConfig() {
  const missing = [];
  if (!config.anthropicApiKey) missing.push("ANTHROPIC_API_KEY");
  if (!config.twilioSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!config.twilioToken) missing.push("TWILIO_AUTH_TOKEN");
  if (!config.twilioNumber) missing.push("TWILIO_NUMBER");
  if (!config.publicUrl || config.publicUrl.includes("CHANGE-ME"))
    missing.push("PUBLIC_URL");
  if (config.mcpAuth === "oauth" && !config.oauthIssuerUrl)
    missing.push("OAUTH_ISSUER_URL (weil MCP_AUTH=oauth)");
  if (config.storeBackend === "pg" && !config.databaseUrl)
    missing.push("DATABASE_URL (weil STORE_BACKEND=pg)");
  if (config.paymentEnabled && !config.stripeSecretKey)
    missing.push("STRIPE_SECRET_KEY (weil PAYMENT_ENABLED=true)");
  // Number.isInteger faengt auch NaN (nicht-numerisches NUMBER_SETUP_FEE_CENTS):
  // NaN <= 0 ist false -> ohne diesen Guard wuerde die >0-Geldsicherung still umgangen.
  if (config.paymentEnabled && (!Number.isInteger(config.numberSetupFeeCents) || config.numberSetupFeeCents <= 0))
    missing.push("NUMBER_SETUP_FEE_CENTS (weil PAYMENT_ENABLED=true, muss ganzzahlig > 0 sein)");
  if (missing.length) {
    console.error(
      "\n[Konfiguration unvollstaendig] Bitte in .env setzen: " +
        missing.join(", ") +
        "\n(.env.example kopieren: cp .env.example .env)\n"
    );
  }
  if (process.env.RENDER_EXTERNAL_URL && !config.dashboardPassword)
    console.error("[Sicherheit] DASHBOARD_PASSWORD fehlt - Dashboard und API sind oeffentlich zugaenglich!");
  if (config.skipTwilioSignatureCheck)
    console.error("[Sicherheit] SKIP_TWILIO_SIGNATURE_CHECK=true - /voice-Webhooks ungeprueft (nur lokal ok)!");
  if (config.paymentEnabled && !config.provisioningEnabled)
    console.error("[Konfiguration] PAYMENT_ENABLED ohne PROVISIONING_ENABLED ist wirkungslos (kein echter Kauf -> kein Capture).");
  return missing.length === 0;
}
