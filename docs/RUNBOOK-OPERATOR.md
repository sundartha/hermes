# Operator-Runbook: Live-/Account-Gates

> Stand 2026-06-21. Diese Schritte kann **nur ein Mensch mit Account/Geld/Live-Zugang**
> fahren — sie sind bewusst NICHT autonom automatisierbar. Code-seitig ist alles fertig
> (P0-P8, I1-I9, REST-P6, F1-F5); offen sind ausschliesslich Aktivierungs- und Live-Smokes.
> Quelle der Liste: `STATUS.md`. Konvention: Deutsch ohne Umlaute.

---

## 0. ZUERST LESEN: Deploy-Realitaet (Repo-Split)

**Render deployt `upstream` (jonas986/vodafone-agent), NICHT `origin` (Antonio20045).**

- `git push origin master` macht **NICHTS** live.
- Live deployen = zusaetzlich `git push upstream master` (Owner-Entscheidung, eigener Schritt).
- Live-Stand verifizieren: `gh api repos/jonas986/vodafone-agent/commits/master --jq .sha`
  bzw. nach Deploy im Render-Log das `[boot]`-Banner gegen den erwarteten Commit pruefen.
- Vor jeder Aussage ueber "Live": `git fetch --all` und origin vs. upstream **getrennt** vermessen
  (`git rev-list --left-right --count master...upstream/master`). origin und upstream divergieren aktiv.

Reihenfolge-Empfehlung der Gates unten: **1 → 2 → 3** (STT-Pfad zuerst, sonst stummer Agent),
dann **4/5/6 unabhaengig**. Gate 7 (Secrets) laeuft begleitend.

---

## Gate 1 — Inbound-STT Live-Test ("Die KI hoert mich nicht")

**Status:** Fix ist auf origin (`04549c4`: provider-bewusster `extractSpeech` + absolute
action-URL), aber **unverifiziert**. Hartes Gate aus dem Pre-Mortem: kein Fix gilt als
bestaetigt, bevor der echte Telnyx-POST-Body beobachtet ist. Details:
`STATUS.md` Abschnitt 1.

**Voraussetzung:** Fix muss live sein → erst `git push upstream master` (Abschnitt 0),
Deploy abwarten, `[boot]`-Banner pruefen.

**Schritte:**

1. Render-Dashboard → Service (Region Frankfurt) → **Logs** offen lassen.
2. Echter Test-Anruf von einer **Allowlist-Nummer** auf die Telnyx-Nummer. Kurz halten
   (Kosten-/Max-Dauer-Gates bleiben unangetastet). In den Hoerer sprechen.
3. Im Log die `[turn-recv]`-Zeile suchen (`src/server.js:456`). Sie trennt die drei Aeste:

   | Beobachtung                                                 | Diagnose                                        | Fix                                                                  |
   | ----------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
   | **kein** `[turn-recv]` + ein **403**                        | Signatur weist Telnyx-POST ab                   | Telnyx-Verifier provider-korrekt machen — NIE abschalten (Regel 1/3) |
   | **kein** `[turn-recv]`, **kein** 403                        | action-URL falsch aufgeloest, POST kommt nie an | action absolut (`04549c4` — sollte schon drin sein)                  |
   | `[turn-recv]` mit `callId=FEHLT`                            | Query-String verloren                           | dito, action absolut                                                 |
   | `[turn-recv]` mit `callId=…` aber **leerem** `SpeechResult` | Deepgram liefert nichts (Add-on/Modell/Sprache) | → **Gate 3**                                                         |

**Akzeptanz:** Transkript enthaelt **>=1 Zeile `role:caller`** UND der Agent antwortet
inhaltlich (kein Re-Greet nach Stille).

**Danach (Pflicht, sonst dauerhaftes PII-Logging):** temporaeres `[turn-recv]`-Diagnose-Log
(`src/server.js:456` + `:462`) wieder entfernen, Tests gruen, neu deployen.

---

## Gate 2 — Telnyx-Realtime scharf schalten (P7)

**Status:** blockiert bis WS-Echo-Test gruen. Das exakte Media-Payload-Format (rohe u-law
base64 vs. RTP-gewrappt) ist live unbestaetigt. **Live laeuft ohnehin auf `VOICE_ENGINE=budget`**
— dieses Gate ist nur noetig, wenn auf Realtime umgestellt werden soll.

**Schritte:**

1. Live-Zugang/Env setzen: `TELNYX_NUMBER`, `TELNYX_CONNECTION_ID`, `OPENAI_API_KEY`, `PUBLIC_URL`.
2. Harness laufen lassen (kein Teil von `npm test`, braucht Netz):
   ```
   node scripts/telnyx-ws-echo.mjs
   ```
   Prueft: start-Frame (`stream_id` + `<Parameter>`), media-Frame-Format, outbound
   media/clear ohne `stream_id`, clear/mark/stop/dtmf end-to-end.

**Akzeptanz:** `smokePass=true`, alle vier Checklist-Punkte bestaetigt.

**Erst danach:** `TELNYX_NUMBER` produktiv setzen (`config.js:53` seedet idempotent zum
Owner-Tenant; Provider-Routing `server.js:627`). Bis dahin leer lassen → fail-closed,
kein Leck. Twilio-Realtime bleibt davon unberuehrt.

---

## Gate 3 — Telnyx-Portal: STT/TTS-Add-ons freischalten

**Warum:** Telnyx reicht STT-Parameter **ungeprueft** an die Engine durch — eine nicht
freigeschaltete/falsche Kombi scheitert **still** (leeres `SpeechResult`) → stummer Agent.
Minutenkosten dieser Add-ons laufen **ausserhalb** des `MAX_BUDGET_EUR`-Guards.

**Schritte (Telnyx Mission-Control-Portal):**

1. **Deepgram-STT** freischalten (Premium-Add-on). Falls weiter leer:
   `transcriptionEngine="Telnyx"` oder `"Google"` testen, bzw. `model="deepgram/nova-2"`
   statt `nova-3`, bzw. `language="de-DE"` statt `de`.
2. **Azure-NTTS** (TTS) freischalten, falls die Stimme fehlt.
3. TeXML-App: `voice_url = <PUBLIC_URL>/voice/incoming` gesetzt (`TELNYX_CONNECTION_ID`).

**Akzeptanz:** koppelt direkt an Gate 1 (>=1 `role:caller`).

---

## Gate 4 — Stripe Hold/Capture: Test-Mode-Smoke → Live (P6)

**Status:** nur Test-Fakes; keine Stripe-Keys. `PAYMENT_ENABLED=false` (byte-identisch aus).

**Voraussetzungen (sonst Boot-Refusal per `assertConfig`, `config.js:220-242`):**

- `PAYMENT_ENABLED=true` braucht `STRIPE_SECRET_KEY` gesetzt UND
  `NUMBER_SETUP_FEE_CENTS` als Ganzzahl **> 0**.
- Nur wirksam mit `PROVISIONING_ENABLED=true` (sonst kein echter Kauf → kein Capture;
  `config.js:241` warnt).

**Schritte:**

1. **Test-Mode zuerst:** `STRIPE_SECRET_KEY=sk_test_...`, `PAYMENT_ENABLED=true`,
   `PROVISIONING_ENABLED=true`, `NUMBER_SETUP_FEE_CENTS=<z.B. 100>`, `MAX_NUMBERS` klein lassen.
2. Onboarding ausloesen (`POST /api/onboard`, `server.js:954/988-1008`): Hold → Provision
   → Capture → active. Stripe-Dashboard (Test-Mode) prueft den PaymentIntent.
3. Rollback testen: Provisioning absichtlich scheitern lassen → Hold muss **released** werden.

**Akzeptanz:** Hold/Capture/Rollback im Stripe-Test-Dashboard nachvollziehbar; Nummer wird
nur bei erfolgreichem Capture `active`.

**Erst danach:** `sk_live_...` einsetzen. `STRIPE_API_BASE` bleibt gleich (Test/Live nur per Key).

> Hinweis: pg-boss als Queue-Backend ist bewusst auf P8 vertagt (`QUEUE_BACKEND=memory`
> bleiben; pgboss-Adapter wirft). Async-Worker laeuft drain-on-demand.

---

## Gate 5 — WorkOS / OAuth in Produktion

**Status:** Code fertig (F1-F5), offen = Betrieb.

**Env in Render setzen:**

- `MCP_AUTH=oauth` (claude.ai-Login-Flow; statisches Token kann claude.ai NICHT senden).
- `OAUTH_ISSUER_URL=<WorkOS-AuthKit-Issuer>` (JWKS findet das Gateway selbst via
  `/.well-known/openid-configuration`). Wird mit dem Web-Login geteilt.
- Web-Login/Self-Service: `SESSION_SECRET` (langer Zufallswert), `OIDC_CLIENT_ID`,
  `OIDC_CLIENT_SECRET`, `ADMIN_EMAILS` (wer approven/suspenden darf).
- Self-Service-Schicht: `MULTI_TENANT=true` + `SELF_SERVICE_ENABLED=true`
  (beide Default false/fail-closed; NIE per Default an).

**Schritte:**

1. WorkOS-AuthKit-Account + OIDC-Client anlegen, **Redirect-URI** = `<PUBLIC_URL>/auth/callback`.
2. **Invite-only scharf:** in WorkOS "Sign up" deaktivieren, Team-Mitglieder per Invite.
3. **Staging → Production-Cutover** (eigener, bewusster Schritt — aktuell laeuft OAuth gegen die
   **Staging**-Domain `…-staging.authkit.app`; funktional ok zum Testen, aber NICHT der finale
   Prod-Issuer). WorkOS trennt Staging und Production in **zwei separaten Umgebungen** mit eigenen
   Nutzern/Clients/Schluesseln — nichts wird automatisch migriert. Cutover:
   1. In WorkOS oben auf **Production**-Umgebung umschalten.
   2. OIDC-Client + **Redirect-URI** (`<PUBLIC_URL>/auth/callback`) in Production **neu** anlegen
      (Staging-Werte ziehen NICHT mit).
   3. Invite-only auch in Production scharf (Self-Signup aus).
   4. Eigene Auth-Domain whitelabeln (z.B. `login.sundartha.com`) ODER die Prod-`….authkit.app`
      ohne `-staging` verwenden.
   5. In **Render-Env** tauschen: `OAUTH_ISSUER_URL` → Prod-Domain, `OIDC_CLIENT_ID` /
      `OIDC_CLIENT_SECRET` → die **neuen** Production-Werte. Re-Deploy.
   6. Gate-5b-Steps 1-2 erneut fahren (Metadata zeigt jetzt den Prod-Issuer; JWKS erreichbar),
      dann Steps 3-5 (claude.ai-Login) gegen Production.

**Bekannte Luecke (nicht Gate, FYI):** Remote-Browser-OAuth fuer Self-Service fehlt noch
(`req.auth` liegt nur auf `/mcp`) → Self-Service funktioniert remote noch nicht, nur localhost.
Das ist die eine offene **Code**-Aufgabe (Plan-Doc 1d), bewusst aus I9 deferred.

**Akzeptanz:** Login-Happy-Path gegen echten IdP + Postgres (Staging-Smoke) gruen;
unautorisiert → 401, suspendiert → 403.

### Gate 5b — `MCP_AUTH=oauth` end-to-end gegen claude.ai (STATUS §1.6, Teil A)

**Status:** Code fertig + test-gedeckt (`src/auth.js`; `test/oauth.test.js`, 13 Faelle: JWKS-
Discovery inkl. WorkOS-`oauth-authorization-server`-Fallback, Audience/Signatur/Expiry, fail-closed
Boot ohne `OAUTH_ISSUER_URL`). **Live-Infra verifiziert 2026-06-21:** Render-Env auf `MCP_AUTH=oauth`,
Steps 1-2 unten gruen (Metadata + 401-Challenge), WorkOS-Issuer
`momentous-dune-52-staging.authkit.app` erreichbar (openid-configuration + AS-Metadata + JWKS).
Offen ist **nur** der reale claude.ai-Connector-Flow (Steps 3-5) — reiner Account-/Live-Schritt,
nicht autonom fahrbar. **Hinweis:** Issuer ist noch eine **Staging**-AuthKit-Domain → vor echtem
Prod-Dauerbetrieb Staging→Production-Cutover (Gate 5, Schritt 3).

**Voraussetzung:** Gate 5 (WorkOS-AuthKit + OIDC-Client + Env) steht; Deploy live (Abschnitt 0).

**Schritte:**

1. **Metadata pruefen** (ohne Login, von aussen):
   ```
   curl -s <PUBLIC_URL>/.well-known/oauth-protected-resource | jq .
   ```
   Erwartet: `resource` = `<PUBLIC_URL>/mcp`, `authorization_servers` = `[<OAUTH_ISSUER_URL>]`.
   Beide Pfade (`/.well-known/oauth-protected-resource` **und** `…/mcp`) muessen 200 liefern.
2. **Unautorisiert = 401 mit Wegweiser** (Pre-Mortem: fail-closed):
   ```
   curl -si -X POST <PUBLIC_URL>/mcp -H 'content-type: application/json' -d '{}' | grep -i 'www-authenticate'
   ```
   Erwartet: `401` + `WWW-Authenticate: Bearer resource_metadata="…/oauth-protected-resource", …`.
3. **claude.ai-Connector hinzufuegen:** claude.ai → Settings → Connectors → Custom Connector →
   URL `<PUBLIC_URL>/mcp`. claude.ai folgt der Protected-Resource-Metadata zum WorkOS-Issuer und
   startet den OAuth-Login. Mit einer **invite-only** zugelassenen Identitaet einloggen.
4. **Tool-Liste + ein Read-Tool** in claude.ai aufrufen (z.B. Status/Calls lesen — kein Outbound).
   Im Render-Log erscheint **kein** `auth_failed`-Audit fuer `/mcp`; der Call traegt `req.auth.sub`.
5. **Dauerbetrieb (der eigentliche Gate-Punkt):** nach Ablauf des ersten Access-Tokens erneut ein
   Tool aufrufen — claude.ai muss **silent** ueber den Refresh-Token ein neues Token holen, ohne
   erneuten interaktiven Login. Ueber mehrere Stunden/Tage stichprobenhaft wiederholen.

**Akzeptanz:** Schritte 1-4 gruen UND Schritt 5 ueber mind. einen Token-Ablauf hinweg ohne
Re-Login. Negativ-Gegenprobe: ein **suspendierter**/nicht-eingeladener Account → 401/403,
kein Tool-Zugriff. Danach `MCP_AUTH_TOKEN` aus der Render-Env entfernen (im `oauth`-Modus ungenutzt,
s. Gate 7.3).

---

## Gate 6 — Postgres-Produktion + Killer-Test

**Status:** F5-Rollen-Assertion umgesetzt (`src/portal-pool.js`, fail-closed beim Start),
Killer-Test als manuelles Release-Gate dokumentiert.

**Harte Deployment-Anforderung:**

- `STORE_BACKEND=pg`, `DATABASE_URL` = **non-superuser UND NOBYPASSRLS**-Rolle (sonst greift
  FORCE-RLS nicht — Superuser umgeht RLS). `createPortalRunner()` prueft das beim Start;
  Superuser/`rolbypassrls` → `[F5]`-Error, Prozess startet **nicht** (fail-closed).
- Postgres mit **pgBouncer** im `pool_mode = transaction`, EU/DE-Region.

**Schritte:** echten Killer-Test gegen die **reale** Render-Topologie fahren —
Prozedur + Akzeptanz stehen vollstaendig in **`docs/RELEASE-GATE-killer-test.md`**
(2 Tenants, 50 parallele Requests, injizierte Txn-Fehler).

**Akzeptanz:** 100% sauber. Ein einziger Cross-Tenant-Treffer → Deploy blockiert.

> pglite (CI) ist single-connection und kann pgBouncer-Transaction-Pooling NICHT
> reproduzieren — deshalb ist dies ein **manuelles** Gate vor jedem Prod-Deploy.

---

## Gate 7 — Secrets-Hygiene (begleitend)

**Grundregeln (Regel 4):** Secrets NUR ueber Render-Dashboard / lokale `.env` — nie committen,
nie loggen, nie in API-/MCP-Antworten oder MCP-Tool-Ausgaben leaken. Selbst-erzeugte Secrets
mit `openssl rand -hex 32` (gilt fuer `MCP_AUTH_TOKEN`, `SESSION_SECRET`, `DASHBOARD_PASSWORD`).

### 7.1 Secrets-Inventar (was leakt was)

| Secret (Env)         | Anbieter / Quelle               | Gewaehrt bei Leak                                              | Blast-Radius                                     |
| -------------------- | ------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `ANTHROPIC_API_KEY`  | console.anthropic.com           | LLM-Calls auf deine Kosten                                     | Kosten (kein Daten-Leak)                         |
| `TWILIO_AUTH_TOKEN`  | Twilio Console                  | Voice/SMS-API **und** Webhook-HMAC-Schluessel                  | Calls/SMS auf deine Kosten + Signatur-Faelschung |
| `TELNYX_API_KEY`     | Telnyx Portal                   | Voice/SMS-API (Telnyx)                                         | Calls/SMS auf deine Kosten                       |
| `TELNYX_PUBLIC_KEY`  | Telnyx Portal                   | **KEIN Secret** (Ed25519-Verify), aber falsch = Inbound bricht | Verfuegbarkeit (kein Leak)                       |
| `OPENAI_API_KEY`     | platform.openai.com             | Realtime-API (nur `VOICE_ENGINE=realtime`)                     | Kosten                                           |
| `STRIPE_SECRET_KEY`  | Stripe Dashboard                | Hold/Capture, Charges (**echtes Geld** bei `sk_live`)          | Geld + Kundendaten                               |
| `MCP_AUTH_TOKEN`     | selbst (`openssl rand -hex 32`) | `/mcp`-Zugang (Legacy-Bearer); bei `MCP_AUTH=oauth` ungenutzt  | Voller MCP-Tool-Zugriff                          |
| `SESSION_SECRET`     | selbst (`openssl rand -hex 32`) | Faelschung von Browser-Session-Cookies                         | Account-Uebernahme im Portal                     |
| `OIDC_CLIENT_SECRET` | WorkOS AuthKit                  | OIDC-Auth-Code-Tausch (Browser-Login)                          | Login-Flow-Kompromittierung                      |
| `DASHBOARD_PASSWORD` | selbst gesetzt                  | Owner-Dashboard (Basic-Auth)                                   | Voller Owner-Dashboard-Zugriff                   |
| `DATABASE_URL`       | Render Postgres                 | DB-Passwort (in der URL)                                       | Voller DB-Zugriff (alle Tenants)                 |

> Es gibt **kein** `STRIPE_WEBHOOK_SECRET` (Stripe-Integration ist reines Outbound-`fetch`,
> kein verifizierter Inbound-Webhook) und **keinen** separaten WorkOS-API-Key (nur OIDC-Client +
> AuthKit-Issuer). Stand bei Aenderung der Billing-/IdP-Integration neu pruefen.

### 7.2 Token-Rotation — Standard-Prozedur (Ueberlappung = Zero-Downtime)

Generisches 5-Schritt-Muster fuer jedes Secret oben:

1. **Neuen Wert erzeugen** beim Anbieter — der **alte bleibt zunaechst gueltig** (Ueberlappung).
2. **Render-Dashboard → Service → Environment** → Wert ersetzen → speichern (loest Re-Deploy aus).
3. **Verifizieren:** `/healthz` gruen, `[boot]`-Banner = erwarteter Commit, betroffene Route
   testen (z.B. Test-Call fuer Twilio/Telnyx, Login fuer OIDC).
4. **Alten Wert widerrufen/loeschen** beim Anbieter — erst NACH bestaetigter Verifikation.
5. **Rotation protokollieren** (Datum + welches Secret + Anlass) im privaten Rotation-Log
   (nie ins Repo). Anlass = Quartals-Routine **oder** Verdacht/Personalwechsel.

**Empfohlene Kadenz:** vierteljaehrlich routinemaessig; **sofort** bei Verdacht auf Leak,
ausgeschiedenem Teammitglied oder kompromittiertem Geraet.

### 7.3 Rotation — Besonderheiten pro Secret

| Secret                                 | Rotations-Besonderheit                                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TWILIO_AUTH_TOKEN`                    | Twilio fuehrt **Primary + Secondary Auth Token**. Secondary erzeugen → in Env eintragen → Primary "promote/regenerate". Echtes Zero-Downtime, da kurzzeitig beide gueltig sind. Achtung: derselbe Token validiert auch die Webhook-HMAC — nach Rotation Test-Inbound pruefen. |
| `STRIPE_SECRET_KEY`                    | Im Stripe-Dashboard **"Roll key"** mit Ablauf-Frist (alter Key laeuft kontrolliert aus) statt Sofort-Widerruf. Test- (`sk_test`) und Live-Key (`sk_live`) **getrennt** rotieren.                                                                                              |
| `SESSION_SECRET`                       | Rotation **invalidiert alle aktiven Browser-Sessions** (User muessen neu einloggen). Geplant ausserhalb der Stosszeit, ggf. ankuendigen. Kein Ueberlappungs-Mechanismus.                                                                                                      |
| `DATABASE_URL`                         | Postgres-Passwort in Render rotieren (Render Postgres → Rotate) → URL in der Env des Web-Service nachziehen. Kurzer Reconnect; Pool baut neu auf.                                                                                                                             |
| `MCP_AUTH_TOKEN`                       | Bei `MCP_AUTH=oauth` **nicht in Benutzung** — dann ganz aus der Env nehmen statt rotieren. Im Legacy-/`token`-Modus: Client (z.B. curl-Skripte) und Env **gleichzeitig** umstellen (keine Ueberlappung moeglich).                                                             |
| `OIDC_CLIENT_SECRET`                   | In WorkOS AuthKit ein neues Client-Secret erzeugen (WorkOS erlaubt Ueberlappung) → Env tauschen → altes in WorkOS loeschen.                                                                                                                                                   |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Zweiten Key erstellen → Env tauschen → ersten widerrufen. Ueberlappung trivial.                                                                                                                                                                                               |

### 7.4 Twilio-/Telnyx-Subaccount auf minimale Rechte

**Ziel:** Hermes laeuft nie mit Master-/Account-weiten Vollrechten — ein geleaktes Token
darf nur den Hermes-Kontext betreffen, nicht den ganzen Provider-Account.

**Twilio:**

- [ ] **Subaccount** anlegen (Twilio Console → Account → Subaccounts); Hermes nutzt **nur** dessen
      `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`. Master-Auth-Token nie in Hermes.
- [ ] Im Subaccount **nur** die genutzten Produkte aktiv: **Voice** + **Messaging**. Ungenutzte
      (Verify, Lookup, etc.) nicht freischalten.
- [ ] **Usage-Trigger / Spend-Limit** auf dem Subaccount setzen (zweite Kostenbremse zusaetzlich
      zum app-internen `MAX_BUDGET_EUR`-Guard — die Provider-Add-on-Minuten laufen ausserhalb).
- [ ] Geo-Permissions auf die benoetigten Laender beschraenken (passt zum `PROVISIONING_COUNTRY`).

**Telnyx:**

- [ ] **Scoped API Key** (V2, least-privilege) statt Account-weitem Key; nur die fuer Voice/SMS
      noetigen Scopes. Pro Umgebung (Staging/Prod) eigener Key.
- [ ] API-Key/TeXML-App an die **eine** genutzte Connection/Nummerngruppe binden.
- [ ] Outbound-Voice-/Messaging-Profile mit Land-/Ziel-Restriktionen (Notruf-/Premium-Sperre
      bleibt zusaetzlich app-seitig hardcoded, s. Anhang A).
- [ ] Spend-/Concurrency-Limits im Telnyx-Portal als zweite Bremse.

**Akzeptanz Gate 7:** Inventar oben stimmt mit der gesetzten Render-Env ueberein; fuer jedes
Secret ist die Rotations-Besonderheit verstanden; Twilio-Subaccount + Telnyx-Scoped-Key sind
mit Spend-Limit aktiv und Master-Credentials nirgends in Hermes-Env.

---

## Anhang A — "Scharfe Schalter" (fail-closed Defaults, NIE per Default an)

| Env-Var                | Default | Schaltet scharf                                           | Fundstelle                               |
| ---------------------- | ------- | --------------------------------------------------------- | ---------------------------------------- |
| `TELNYX_NUMBER`        | leer    | Telnyx-Outbound/Inbound + Provider-Routing                | `config.js:53`, `server.js:627`          |
| `PROVISIONING_ENABLED` | false   | echter Nummern-Kauf (Geld), gedeckelt durch `MAX_NUMBERS` | `config.js:127`, `server.js:954`         |
| `PAYMENT_ENABLED`      | false   | Stripe Hold/Capture                                       | `config.js:69`, Pflichtfelder `:220-242` |
| `MULTI_TENANT`         | false   | Request-Tenant-Aufloesung aus `req.auth.sub`              | `config.js`                              |
| `SELF_SERVICE_ENABLED` | false   | Self-Service-Routen + Tenant-Dashboard                    | `config.js`                              |
| `MCP_AUTH`             | leer    | `oauth` = claude.ai-Login; leer = localhost-only          | `.env.example:127-134`                   |
| `STORE_BACKEND`        | json    | `pg` = Postgres + RLS (braucht F5-Rolle)                  | `.env.example:143-148`                   |
| `VOICE_ENGINE`         | budget  | `realtime` = OpenAI (teuer; Gate 2 zuerst)                | `.env.example:165-169`                   |

**Nie abschaltbar (hardcoded, kein Env):** Allowlist als letztes Outbound-Gate (`ALLOWED_NUMBERS`
leer = gesperrt), Budget-Guard (`MAX_BUDGET_EUR`), Max-Dauer (`MAX_CALL_DURATION_S`, Max 300),
Twilio/Telnyx-Signaturpruefung, Notruf-/Premium-Nummern-Sperre, fest verdrahteter
Offenlegungssatz bei Outbound.

## Anhang B — Vorhandenes Tooling

| Zweck                                 | Befehl                                       |
| ------------------------------------- | -------------------------------------------- |
| Setup-Check (Env-Vollstaendigkeit)    | `npm run check`                              |
| Twilio-Webhooks setzen                | `node scripts/set-webhooks.js <https://url>` |
| Telnyx WS-Echo (Gate 2)               | `node scripts/telnyx-ws-echo.mjs`            |
| Tenant-Daten loeschen (DSGVO Art. 17) | `node scripts/erase-tenant.js <tenantId>`    |
| Tests (offline, kein Netz/.env)       | `npm test`                                   |

## Anhang C — Bewusst vertagt (kein "jetzt")

- **pg-boss** Queue-Backend → P8 (Stub wirft; `QUEUE_BACKEND=memory` bleiben).
- **EU-AI-Act Art. 50(2)** (maschinenlesbare KI-Markierung der Stimme) → Compliance-Phase ab 08/2026;
  ersetzt den gesprochenen Offenlegungssatz NIE.
- **P8 Scale-Infra** (PgBouncer-Tuning/Read-Replicas/Partitionierung) → erst bei echter Last.
- **Allowlist-Lockerung** (Phase 0.6) → Owner-Entscheidung 2026-06-13: auf Phase 2 vertagt;
  bis dahin bleibt die Allowlist das harte letzte Gate.
- **Tech-Debt TD-1…TD-11** → `STATUS.md`.
