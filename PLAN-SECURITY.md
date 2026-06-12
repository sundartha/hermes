# Plan: Sicherheits-Schichten für den Vodafone Agent

Ziel: Die grobe Allowlist schrittweise durch mehrschichtige Kontrollen ersetzen, damit
der Agent perspektivisch beliebige Nummern anrufen darf (Produkt-Use-Case „Ruf beim
Friseur an"), ohne dass der offene `/mcp`-Endpunkt ein Scheunentor bleibt.

**Status: Plan, noch nichts implementiert.** Reihenfolge unbedingt einhalten —
Phase 0 hat keine externen Abhängigkeiten und bringt sofort Nutzen; Phase 1 braucht
eine Entscheidung + einen Account (siehe „Offene Entscheidungen").

## Ist-Zustand (Kurzfassung)

- `/mcp` ist **ohne Auth** öffentlich (claude.ai-Connector-UI kann kein statisches
  Bearer-Token senden, daher ist `MCP_AUTH_TOKEN` praktisch ungenutzt).
- Einzige Outbound-Bremsen: `ALLOWED_NUMBERS`-Allowlist (`src/server.js` →
  `allowlistError()`), Budget-Guard, `MAX_CALL_DURATION_S`, Disclosure-Satz.
- **Architektur-Glück:** Dashboard UND MCP-Tools starten Calls beide über
  `POST /api/calls` (`src/server.js`, die MCP-Tools rufen die REST-API via
  `GATEWAY_URL` auf). Alle neuen Gates gehören an genau diese eine Stelle.
- Permissions (`allowCalendar`, `allowBooking`, …) liegen global in
  `store.js → settings` — noch nicht pro Nutzer.

## Phase 0 — Sofortmaßnahmen ohne Auth (~2–4 h, keine Abhängigkeiten)

Alles rein additiv (schränkt nur weiter ein), kann die laufende Demo nicht brechen.

### 0.1 Nummern-Regeln (Schicht 3)

`allowlistError()` in `src/server.js` zu `numberGateError(to)` ausbauen, Prüfreihenfolge:

1. **E.164-Syntax:** `^\+[1-9]\d{6,14}$` — sonst ablehnen (fängt Halluzinationen).
2. **Fest eingebaute Denylist** (hardcoded, kein Env): Notrufe (110/112/911/999),
   deutsche Premium-/Service-Nummern (`+49900`, `+49137`, `+49180`, `+49118`),
   Satellit/International Premium (`+870`, `+881`, `+882`, `+883`, `+979`).
3. **Länder-Gate:** neue Env `ALLOWED_COUNTRY_CODES` (kommasepariert, Default `+49`,
   `*` = alle). Achtung: bestehende `ALLOWED_NUMBERS`-Einträge müssen dazu passen —
   Check in `scripts/check-setup.js` ergänzen, der Widersprüche meldet.
4. **Bestehende Allowlist** unverändert als letztes Gate (fällt erst in Phase 2
   pro Nutzer weg).

### 0.2 Rate-Limit (Schicht 4)

- In-Memory Sliding Window über Call-Start-Zeitstempel in `src/server.js`
  (Array reicht; Reset bei Deploy ist für den Prototyp okay).
- Neue Env `MAX_CALLS_PER_HOUR` (Default 6). Bei Überschreitung: HTTP 429 mit
  klarer Meldung (taucht dann als Tool-Fehler in Claude auf).

### 0.3 Twilio-Webhook-Signatur (Bonus, steht schon in ONBOARDING.md)

- `X-Twilio-Signature` auf allen `/voice/*`-Routen validieren —
  Twilio-SDK-Middleware `twilio.webhook()` nutzt `TWILIO_AUTH_TOKEN` + `PUBLIC_URL`.
- Env-Flag `TWILIO_VALIDATE` (Default `true`; lokal ohne Tunnel ggf. `false`).

### Akzeptanztests Phase 0

```bash
# 0900 → 403 trotz (hypothetischem) Allowlist-Eintrag
curl -X POST $URL/api/calls -d '{"to":"+49900123456","objective":"x"}' -H 'Content-Type: application/json'
# 7. Call innerhalb 1 h → 429
# Nicht-E.164 ("0173...") → 403 mit Hinweis auf +49-Format
# Gefälschter POST /voice/status ohne gültige Signatur → 403
npm run check   # neu: warnt bei Allowlist/Länder-Widerspruch
```

## Phase 1 — OAuth 2.1 auf /mcp (Schicht 1, ~0,5–1 Tag inkl. IdP-Setup)

### Architektur

Das Gateway wird **nur Resource Server** — wir bauen keinen eigenen Login.
Identity Provider (IdP) extern, Anforderung: **Dynamic Client Registration (DCR)**
+ PKCE, denn claude.ai registriert sich als OAuth-Client selbst.

Ablauf nach Umbau: claude.ai → `POST /mcp` → 401 mit `WWW-Authenticate`-Header, der
auf `/.well-known/oauth-protected-resource` zeigt → claude.ai findet dort den IdP →
DCR + Authorization-Code-Flow mit PKCE (Nutzer sieht Login-Seite) → Access Token →
jede weitere Anfrage mit `Authorization: Bearer <JWT>` → Gateway prüft Signatur
(JWKS des IdP), `aud`/`resource` und Ablaufzeit.

### Schritte

1. **IdP einrichten** (manuell, siehe Entscheidung unten): Tenant anlegen,
   DCR aktivieren, Team-Nutzer (Jonas + Kollegen) anlegen. Liefert: Issuer-URL.
2. **Neue Datei `src/auth.js`:**
   - `GET /.well-known/oauth-protected-resource` → `{ resource, authorization_servers: [<issuer>] }`
   - Bearer-Middleware: JWT gegen JWKS des Issuers verifizieren (`aud` = unsere
     `/mcp`-URL). SDK-Baustein nutzen (`requireBearerAuth` aus
     `@modelcontextprotocol/sdk/server/auth/…`) oder schlank mit `jose` (eine
     kleine Dependency).
3. **`src/server.js`:** Middleware vor `POST /mcp`; 401 immer mit
   `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.
   Wichtig: die Well-known-Route von der Basic-Auth-Middleware ausnehmen
   (wie `/healthz`).
4. **Feature-Flag** `MCP_AUTH=off|token|oauth` in `src/config.js`
   (Default `off` = heutiges Verhalten; `token` = bestehendes statisches Token für
   curl/Tests; `oauth` = scharf). Umschalten erst NACH erfolgreichem Test, damit
   keine Demo platzt.
5. Neue Envs: `MCP_AUTH`, `OAUTH_ISSUER_URL` (+ ggf. `OAUTH_AUDIENCE`) →
   `.env.example`, `render.yaml`, README, ONBOARDING aktualisieren.
6. **Connector in claude.ai neu hinzufügen** (alte Verbindung löschen) → es muss
   ein Login-Fenster erscheinen, danach Tools sichtbar.

### Akzeptanztests Phase 1

- `POST /mcp` ohne Token → 401 + `WWW-Authenticate` mit `resource_metadata`.
- `GET /.well-known/oauth-protected-resource` → gültiges JSON, ohne Basic-Auth.
- Token mit falscher `aud` / abgelaufen / falscher Issuer → 401.
- End-to-End: Connector-Anlage in claude.ai inkl. Login, dann `get_agent_status`.
- `MCP_AUTH=off` verhält sich exakt wie heute (Regressionstest für Demos).

## Phase 2 — Pro-Nutzer-Rechte (Schicht 2, ~0,5 Tag, braucht Phase 1)

1. **Nutzer-Registry:** `sub`/`email` aus dem Token → Rechteprofil. Für den
   Prototyp als Env-JSON oder `data/users.json`:
   `{ "jonas@…": { role: "admin" }, "antonio.…@gmail.com": { countryCodes: ["+49"], maxCallsPerHour: 3, allowBooking: true } }`
   Unbekannte (aber authentifizierte) Nutzer: Default-Profil **ohne** Outbound.
2. **Gates pro Nutzer:** `numberGateError()` + Rate-Limit lesen das Profil;
   globale `ALLOWED_NUMBERS` wird zum Fallback für Nutzer ohne eigenes Profil
   und kann für vertrauenswürdige Nutzer entfallen (`allowedNumbers: "*"` im Profil
   = Länder-Gate + Denylist + Rate-Limit greifen weiterhin).
3. **Audit:** `requestedBy` (E-Mail) am Call-Record in `store.js → createCall`,
   Anzeige im Dashboard.
4. Die globalen Permission-Toggles im Dashboard bleiben als Override („Not-Aus").

### Akzeptanztests Phase 2

- Nutzer ohne Profil: authentifiziert, aber `place_call` → 403 mit Erklärung.
- Profil mit `maxCallsPerHour: 1`: zweiter Call in der Stunde → 429.
- `requestedBy` erscheint am Call im Dashboard.

## Offene Entscheidungen (vor Phase 1 klären!)

| # | Frage | Empfehlung |
|---|---|---|
| 1 | **Welcher IdP?** | WorkOS AuthKit (gratis bis 1 M Nutzer, DCR + MCP dokumentiert). Alternativen: Auth0 (DCR aktivierbar), Keycloak (self-host, mehr Aufwand). Jemand muss den Account anlegen und die Werte in Render eintragen. |
| 2 | Wann `MCP_AUTH=oauth` scharf schalten? | Erst nach grünem End-to-End-Test, außerhalb von Demo-Terminen. |
| 3 | Wer bekommt Zugang? | Nur Team-Accounts im IdP anlegen; öffentliche Self-Signup-Registrierung im IdP deaktivieren. |

## Bewusst NICHT in diesem Plan

- Datenbank statt `store.json` (eigene Aufgabe, s. ONBOARDING.md) — die Nutzer-
  Registry ist so geschnitten, dass sie später 1:1 in eine DB wandern kann.
- Google/Outlook-Kalender, CAMARA, Billing.
- Entfernen der Allowlist: erfolgt erst, wenn Phase 1 + 2 nachweislich laufen.
