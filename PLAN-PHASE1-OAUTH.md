# Detailplan Phase 1: OAuth 2.1 auf /mcp

Ausarbeitung von Phase 1 aus `PLAN-SECURITY.md`. Ziel: Nur angemeldete Team-Mitglieder
können den MCP-Endpunkt nutzen — über den normalen „Connector hinzufügen → Login-Fenster"-
Flow von claude.ai. Aufwand: ~0,5–1 Tag inkl. IdP-Einrichtung und End-to-End-Test.

> **Status (Stand dieser Branch):** Der Code-Anteil (**Schritt B**) ist umgesetzt
> und automatisiert verifiziert — `src/auth.js` (Middleware `mcpAuth` mit den Modi
> off/token/oauth + Legacy-Fallback, RFC-9728 Well-known), `MCP_AUTH`-Flag in
> `config.js`, Verdrahtung in `src/server.js`, Tests in `test/oauth.test.js`
> (lokaler Mini-IdP, C1-Matrix grün). Die Hinweise auf konkrete Zeilennummern
> unten beziehen sich noch auf den ursprünglichen Code-Stand und sind als
> Orientierung zu lesen. **Offen bleibt nur der Betreiber-Teil:** Schritt A
> (IdP-Account), Schritt C3 (End-to-End gegen claude.ai) und Schritt D (Rollout,
> `MCP_AUTH=oauth` scharf schalten).

## Einordnung: Wo stehen wir im Gesamtplan?

Der `/mcp`-Endpunkt der Produktion (https://vodafone-agent.onrender.com) ist heute
**ohne Auth offen**; einzige Bremsen sind die `ALLOWED_NUMBERS`-Allowlist, der
Budget-Deckel und die Max-Gesprächsdauer. `PLAN-SECURITY.md` ersetzt das in drei
Phasen durch mehrschichtige Kontrollen:

| Phase | Inhalt | Abhängigkeit | Status |
|---|---|---|---|
| 0 | Nummern-Regeln (E.164, Premium-/Notruf-Denylist, Länder-Gate), Rate-Limit, Twilio-Webhook-Signatur | keine — jederzeit umsetzbar, auch nach Phase 1 | offen |
| 1 | **OAuth 2.1 auf /mcp — dieses Dokument** | IdP-Account (Schritt A, macht ein Mensch) | offen |
| 2 | Rechteprofile pro Nutzer (wer darf welche Länder, wie viele Calls/h, Kalender ja/nein), Audit `requestedBy` am Call | baut auf `req.auth` aus Phase 1 auf | offen |

Die Phasen sind unabhängig genug, dass 0 und 1 in beliebiger Reihenfolge laufen
können. Erst wenn 1 + 2 nachweislich funktionieren, darf die starre Allowlist für
vertrauenswürdige Nutzer gelockert werden — vorher nicht. Wer eine Phase abschließt:
Status-Spalte hier und in `PLAN-SECURITY.md` aktualisieren.

**Leitplanken:**
- Das Gateway wird **nur Resource Server** (prüft Tokens). Kein eigener Login, keine
  Passwörter, keine Sessions bei uns.
- Alles hinter Feature-Flag `MCP_AUTH` — Default bleibt das heutige Verhalten,
  scharf geschaltet wird erst nach grünem End-to-End-Test.
- stdio-Variante (`src/mcp-server.js`, Claude Desktop) ist NICHT betroffen — sie
  läuft lokal und spricht die REST-API über localhost an.

## Funktionsweise nach dem Umbau

```
claude.ai                    Gateway (Render)                IdP (WorkOS AuthKit)
   │  POST /mcp (ohne Token)      │                               │
   │ ◄─ 401 + WWW-Authenticate ───┤                               │
   │  GET /.well-known/oauth-protected-resource                   │
   │ ◄─ { authorization_servers: [<issuer>] }                     │
   │  DCR (registriert sich selbst als Client) ──────────────────►│
   │  Auth-Code-Flow + PKCE (Nutzer sieht Login-Fenster) ────────►│
   │ ◄──────────────────────────────────────── Access Token (JWT) │
   │  POST /mcp + Authorization: Bearer <JWT>                     │
   │                              ├─ Signatur via JWKS, iss, exp, │
   │                              │  aud prüfen → req.auth        │
   │ ◄─ MCP-Antwort ──────────────┤                               │
```

## Schritt A — IdP einrichten (manuell, ~30 min, braucht einen Menschen)

Empfehlung **WorkOS AuthKit** (gratis bis 1 Mio. Nutzer, Dynamic Client Registration
für MCP offiziell dokumentiert). claude.ai registriert sich per DCR selbst als
OAuth-Client — deshalb ist DCR-Support das harte Auswahlkriterium.

1. Account auf workos.com anlegen → AuthKit aktivieren, Subdomain wählen
   (z. B. `vodafone-agent.authkit.app`). Diese URL ist der **Issuer**.
2. Dashboard → Applications → Configuration → **Dynamic Client Registration: aktivieren**.
3. Sign-ups auf **invite-only** stellen (sonst kann sich jeder selbst registrieren —
   das wäre Schicht 1 mit offener Tür!). Team-Mitglieder per Invite anlegen.
4. Notieren: Issuer-URL. Mehr braucht das Gateway nicht (JWKS findet es selbst über
   `<issuer>/.well-known/openid-configuration`).

Fallback, falls WorkOS nicht gewollt: Auth0 (DCR muss aktiviert und Connections
tenant-weit freigegeben werden — fummeliger) oder Keycloak self-host (deutlich mehr Aufwand).

## Schritt B — Code (alles in einem PR umsetzbar)

### B1: Dependency

```bash
npm install jose        # JWT-Verifikation + Remote-JWKS mit Cache, keine Sub-Dependencies
```

### B2: `src/config.js` erweitern

```js
// ---- MCP-Auth ----
// off   = offen (heutiges Verhalten, nur fuer lokale Demos)
// token = statisches Bearer-Token MCP_AUTH_TOKEN (curl/Tests, claude.ai kann das NICHT)
// oauth = OAuth 2.1 Resource Server (Produktion)
mcpAuth: process.env.MCP_AUTH || "off",
oauthIssuerUrl: (process.env.OAUTH_ISSUER_URL || "").replace(/\/$/, ""),
// Erwartete Audience im Token. Default: kanonische MCP-URL.
oauthAudience: process.env.OAUTH_AUDIENCE || "",   // leer -> `${publicUrl}/mcp`
```

In `assertConfig()`: bei `MCP_AUTH=oauth` ohne `OAUTH_ISSUER_URL` → Fehler.

### B3: Neue Datei `src/auth.js`

```js
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";

let jwks = null; // lazy + von jose gecacht

const audience = () => config.oauthAudience || `${config.publicUrl}/mcp`;
const metadataUrl = () => `${config.publicUrl}/.well-known/oauth-protected-resource`;

async function discoverJwks() {
  if (jwks) return jwks;
  const r = await fetch(`${config.oauthIssuerUrl}/.well-known/openid-configuration`);
  const { jwks_uri } = await r.json();
  jwks = createRemoteJWKSet(new URL(jwks_uri));
  return jwks;
}

function deny(res, error, description) {
  res.set("WWW-Authenticate",
    `Bearer resource_metadata="${metadataUrl()}", error="${error}", error_description="${description}"`);
  return res.status(401).json({ error: description });
}

// Express-Middleware fuer POST /mcp
export async function mcpAuth(req, res, next) {
  if (config.mcpAuth === "off") return next();
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (config.mcpAuth === "token")
    return token === config.mcpAuthToken && token ? next() : deny(res, "invalid_token", "Token ungueltig");
  if (!token) return deny(res, "invalid_token", "Kein Token");
  try {
    const { payload } = await jwtVerify(token, await discoverJwks(), {
      issuer: config.oauthIssuerUrl,
      audience: audience(),
      clockTolerance: 30,
    });
    req.auth = { sub: payload.sub, email: payload.email || null, claims: payload };
    next();
  } catch (e) {
    deny(res, "invalid_token", "Token-Pruefung fehlgeschlagen: " + e.code);
  }
}

// RFC 9728: Protected Resource Metadata
export function registerWellKnown(app) {
  const doc = () => ({
    resource: audience(),
    authorization_servers: [config.oauthIssuerUrl],
    bearer_methods_supported: ["header"],
  });
  // Beide Pfade bedienen: generisch UND pfadbezogen (RFC-9728-Pfadeinfuegung fuer /mcp),
  // weil Clients hier unterschiedlich raten.
  app.get("/.well-known/oauth-protected-resource", (_q, res) => res.json(doc()));
  app.get("/.well-known/oauth-protected-resource/mcp", (_q, res) => res.json(doc()));
}
```

**Achtung `aud`-Claim:** Ob der IdP die Audience exakt als `https://…/mcp` ausstellt,
hängt von dessen Resource-Indicator-Support (RFC 8707) ab. Beim Implementieren als
Erstes mit dem MCP Inspector (s. u.) ein echtes Token ziehen und die Claims prüfen;
falls der IdP eine andere/keine Audience setzt → Wert in `OAUTH_AUDIENCE` übernehmen
bzw. WorkOS-Doku zu „resource" konsultieren. **Niemals Tokens loggen.**

### B4: `src/server.js` (3 kleine Änderungen)

1. Basic-Auth-Middleware: `/.well-known` zu den Ausnahmen hinzufügen
   (Zeile mit `req.path.startsWith("/voice") || …`).
2. Direkt nach den Imports: `import { mcpAuth, registerWellKnown } from "./auth.js";`
   und vor den Routen `registerWellKnown(app);`.
3. `app.post("/mcp", …)` → `app.post("/mcp", mcpAuth, …)`; den bisherigen
   Inline-Token-Check (Zeilen mit `config.mcpAuthToken`) entfernen — der lebt
   jetzt als Modus `token` in der Middleware.
   Bonus fürs Log: `console.log("[mcp]", req.auth?.email || "anonym", req.body?.method)`.

### B5: Doku & Konfig-Dateien

- `.env.example`: Block „MCP-Auth" mit `MCP_AUTH=off`, `OAUTH_ISSUER_URL=`,
  `OAUTH_AUDIENCE=` + Kommentaren.
- `render.yaml`: `MCP_AUTH` (value: `off` — Umschalten passiert im Dashboard),
  `OAUTH_ISSUER_URL` (`sync: false`).
- `README.md` Abschnitt 5 + ONBOARDING.md: Connector-Anleitung um Login-Schritt
  ergänzen; Hinweis, dass `MCP_AUTH_TOKEN` nur noch für curl-Tests taugt.
- `scripts/check-setup.js`: bei `MCP_AUTH=oauth` prüfen: (a) Issuer erreichbar und
  liefert `openid-configuration` mit `jwks_uri`, (b) Gateway liefert
  `/.well-known/oauth-protected-resource` mit passendem Issuer, (c) `POST /mcp`
  ohne Token → 401 mit `WWW-Authenticate`-Header.

## Schritt C — Testen (in dieser Reihenfolge)

**C1 — Unit-Niveau per curl (lokal, `MCP_AUTH=oauth`):**

| Test | Erwartung |
|---|---|
| `POST /mcp` ohne Token | 401, `WWW-Authenticate` enthält `resource_metadata="…"` |
| `GET /.well-known/oauth-protected-resource` | 200 JSON, korrekte `authorization_servers`, OHNE Basic-Auth-Prompt |
| `POST /mcp` mit Müll-Token (`Bearer abc`) | 401 |
| `MCP_AUTH=off` (Regressionstest) | Verhalten exakt wie heute, initialize klappt ohne Token |
| `MCP_AUTH=token` + korrektem Token | initialize klappt |

**C2 — OAuth-Flow ohne claude.ai:** `npx @modelcontextprotocol/inspector` gegen die
lokale ngrok-URL bzw. Render — der Inspector beherrscht den kompletten DCR+PKCE-Flow
und zeigt Token-Claims an (hier `aud` verifizieren, siehe B3-Achtung).

**C3 — End-to-End mit claude.ai (gegen Render, `MCP_AUTH=oauth`):**
1. Alten Connector in claude.ai löschen, neu hinzufügen
   (`https://vodafone-agent.onrender.com/mcp`).
2. Erwartung: Login-Fenster des IdP erscheint → anmelden → Tools sichtbar.
3. `get_agent_status` aufrufen → Antwort kommt, im Render-Log steht die E-Mail.
4. Negativtest: Nicht eingeladener Account kann sich nicht anmelden (invite-only).

## Schritt D — Rollout (Reihenfolge schützt die Demo)

1. Code mergen & deployen mit `MCP_AUTH=off` → **null Verhaltensänderung**, Connector
   läuft weiter wie bisher.
2. Schritt A (IdP) erledigen, `OAUTH_ISSUER_URL` in Render eintragen (Flag bleibt off).
3. C1+C2 gegen Render fahren (geht auch bei `off` für die Well-known-Routen; für den
   Flow kurz `MCP_AUTH=oauth` setzen — außerhalb von Demo-Terminen!).
4. `MCP_AUTH=oauth` dauerhaft setzen, C3 durchführen, alle Team-Mitglieder verbinden
   sich einmal neu.
5. ONBOARDING.md-Satz „aktuell offen" streichen; Punkt „OAuth 2.1 für /mcp" aus der
   Aufgabenliste entfernen.

## Stolpersteine

- **Render-Kaltstart:** Der OAuth-Discovery-Tanz macht mehrere Requests — schläft der
  Free-Dienst, bricht claude.ai ab. Vorher aufwecken (`/healthz`) oder dauerhaft per
  Ping-Dienst (UptimeRobot o. ä., alle 5–10 min) wachhalten.
- **`aud`-Mismatch** ist der häufigste Fehler bei MCP-OAuth — deshalb zwingend C2 vor C3.
- **Uhrzeit-Drift** auf Render ist unwahrscheinlich, `clockTolerance: 30` fängt Reste ab.
- **`MCP_AUTH=off` nicht vergessen zu entfernen**, wenn alles läuft — sonst war alles
  umsonst. `npm run check` soll bei `off` + öffentlicher URL eine Warnung ausgeben.

## Definition of Done

- [ ] Alle Tests aus C1–C3 grün, dokumentiert im PR
- [ ] `MCP_AUTH=oauth` in Render aktiv, Team neu verbunden
- [ ] `npm run check` deckt die neuen Prüfungen ab und warnt bei offenem /mcp
- [ ] README + ONBOARDING aktualisiert
- [ ] Anschluss: Phase 2 (`req.auth` → Rechteprofile) kann auf `req.auth.email` aufsetzen
