# Security-Plan: Vodafone Agent

Sicherheits-Haertung des Telefon-Agenten in drei Phasen, priorisiert nach Risiko.
Kontext: Der Dienst laeuft oeffentlich erreichbar (Render), nimmt echte Anrufe an,
loest echte Anrufe und SMS aus (Kosten!) und speichert Gespraechs-Transkripte.

## Phase 1 - Kritisch: Authentifizierung & Webhook-Sicherheit ✅ (umgesetzt)

Lücken, die ohne Zugangsdaten von aussen ausnutzbar sind:

1. **Twilio-Signaturpruefung fuer `/voice/*`** ✅
   Problem: Die Webhooks waren komplett ungeschuetzt. Jeder, der die URL kennt,
   konnte gefaelschte Anrufe/Transkripte einspeisen, Gespraechs-Turns ausloesen
   (Claude-API-Kosten!) und Status-Callbacks faelschen.
   Fix: Alle `/voice/*`-Requests werden gegen den `X-Twilio-Signature`-Header
   validiert (HMAC mit `TWILIO_AUTH_TOKEN`, `twilio.validateRequest`).
   Opt-out nur fuer lokale Tests via `SKIP_TWILIO_SIGNATURE_CHECK=true`.

2. **Basic-Auth-Bypass via Header-Spoofing geschlossen** ✅
   Problem: `trust proxy: true` + Localhost-Ausnahme auf Basis von `req.ip`
   bedeutete: Ein Angreifer konnte mit `X-Forwarded-For: 127.0.0.1` den
   kompletten Passwortschutz von Dashboard + API umgehen.
   Fix: `trust proxy` auf `1` begrenzt (genau ein Proxy: Render); die
   Localhost-Ausnahme prueft jetzt die echte Socket-Adresse
   (`req.socket.remoteAddress`), die nicht spoofbar ist.

3. **`/mcp` fail-closed statt fail-open** ✅
   Problem: Ohne gesetztes `MCP_AUTH_TOKEN` war der MCP-Endpunkt oeffentlich -
   jeder konnte damit Anrufe starten (Toll Fraud, begrenzt nur durch Allowlist).
   Fix: Ohne Token ist `/mcp` nur noch von localhost erreichbar. In render.yaml
   wird das Token automatisch generiert (`generateValue: true`).

4. **Timing-sichere Credential-Vergleiche** ✅
   Problem: Basic-Auth-Passwort und MCP-Bearer-Token wurden mit `===`
   verglichen (Timing-Seitenkanal).
   Fix: Vergleich via `crypto.timingSafeEqual`.

## Phase 2 - Wichtig: Missbrauchs- und Eingabe-Haertung (offen)

1. **Rate-Limiting** fuer `/api/*` und `/mcp` (z.B. `express-rate-limit`),
   damit Brute-Force auf Basic-Auth/Token und API-Flooding gebremst werden.
2. **Body-Size-Limits** fuer `express.json()`/`urlencoded()` (z.B. 100 kb).
3. **`/media`-WebSocket absichern**: Pro Call ein zufaelliges Secret als
   Stream-Parameter mitgeben und beim `start`-Event pruefen, damit niemand mit
   geratener `call_id` die Audio-Bridge kapern kann.
4. **Settings-Whitelist**: `POST /api/settings` merged aktuell beliebige Keys
   in den Store (`updateSettings`). Nur bekannte Felder mit Typpruefung zulassen.
5. **Security-Header** (`helmet`): CSP fuers Dashboard, `X-Content-Type-Options`,
   kein Caching fuer API-Responses.
6. **Eingabe-Validierung** der API-Routen (E.164-Format fuer `to`,
   ISO-Datums-Check fuer Kalender, Laengenlimits fuer Freitexte).

## Phase 3 - Ausbau: Betrieb & Datenschutz (offen)

1. **OAuth 2.1 fuer `/mcp`** statt statischem Bearer-Token (MCP-Spec-konform).
2. **Transkript-Retention**: Alte Calls/Transkripte automatisch loeschen
   (DSGVO - Gespraechsdaten sind personenbezogen).
3. **Audit-Logging**: Wer hat wann welchen Outbound-Call ausgeloest (Quelle:
   Dashboard vs. MCP), fehlgeschlagene Auth-Versuche loggen.
4. **Dependency-Scanning**: `npm audit` in CI, Dependabot/Renovate.
5. **Secrets-Hygiene**: `.env`-Rechte pruefen, Token-Rotation dokumentieren,
   Twilio-Subaccount mit minimalen Rechten fuer die Demo.
