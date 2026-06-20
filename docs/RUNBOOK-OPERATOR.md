# Operator-Runbook: Live-/Account-Gates

> Stand 2026-06-19. Diese Schritte kann **nur ein Mensch mit Account/Geld/Live-Zugang**
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

   | Beobachtung | Diagnose | Fix |
   |---|---|---|
   | **kein** `[turn-recv]` + ein **403** | Signatur weist Telnyx-POST ab | Telnyx-Verifier provider-korrekt machen — NIE abschalten (Regel 1/3) |
   | **kein** `[turn-recv]`, **kein** 403 | action-URL falsch aufgeloest, POST kommt nie an | action absolut (`04549c4` — sollte schon drin sein) |
   | `[turn-recv]` mit `callId=FEHLT` | Query-String verloren | dito, action absolut |
   | `[turn-recv]` mit `callId=…` aber **leerem** `SpeechResult` | Deepgram liefert nichts (Add-on/Modell/Sprache) | → **Gate 3** |

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
3. **Staging → Production:** eigene authkit.app-Domain, `OAUTH_ISSUER_URL` darauf umstellen.

**Bekannte Luecke (nicht Gate, FYI):** Remote-Browser-OAuth fuer Self-Service fehlt noch
(`req.auth` liegt nur auf `/mcp`) → Self-Service funktioniert remote noch nicht, nur localhost.
Das ist die eine offene **Code**-Aufgabe (Plan-Doc 1d), bewusst aus I9 deferred.

**Akzeptanz:** Login-Happy-Path gegen echten IdP + Postgres (Staging-Smoke) gruen;
unautorisiert → 401, suspendiert → 403.

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

- Secrets NUR ueber Render-Dashboard / lokale `.env` — nie committen, nie loggen, nie in
  API-/MCP-Antworten leaken (Regel 4).
- Token-Rotation dokumentieren; Twilio-/Telnyx-Subaccount mit minimalen Rechten.
- `openssl rand -hex 32` fuer `MCP_AUTH_TOKEN` / `SESSION_SECRET`.

---

## Anhang A — "Scharfe Schalter" (fail-closed Defaults, NIE per Default an)

| Env-Var | Default | Schaltet scharf | Fundstelle |
|---|---|---|---|
| `TELNYX_NUMBER` | leer | Telnyx-Outbound/Inbound + Provider-Routing | `config.js:53`, `server.js:627` |
| `PROVISIONING_ENABLED` | false | echter Nummern-Kauf (Geld), gedeckelt durch `MAX_NUMBERS` | `config.js:127`, `server.js:954` |
| `PAYMENT_ENABLED` | false | Stripe Hold/Capture | `config.js:69`, Pflichtfelder `:220-242` |
| `MULTI_TENANT` | false | Request-Tenant-Aufloesung aus `req.auth.sub` | `config.js` |
| `SELF_SERVICE_ENABLED` | false | Self-Service-Routen + Tenant-Dashboard | `config.js` |
| `MCP_AUTH` | leer | `oauth` = claude.ai-Login; leer = localhost-only | `.env.example:127-134` |
| `STORE_BACKEND` | json | `pg` = Postgres + RLS (braucht F5-Rolle) | `.env.example:143-148` |
| `VOICE_ENGINE` | budget | `realtime` = OpenAI (teuer; Gate 2 zuerst) | `.env.example:165-169` |

**Nie abschaltbar (hardcoded, kein Env):** Allowlist als letztes Outbound-Gate (`ALLOWED_NUMBERS`
leer = gesperrt), Budget-Guard (`MAX_BUDGET_EUR`), Max-Dauer (`MAX_CALL_DURATION_S`, Max 300),
Twilio/Telnyx-Signaturpruefung, Notruf-/Premium-Nummern-Sperre, fest verdrahteter
Offenlegungssatz bei Outbound.

## Anhang B — Vorhandenes Tooling

| Zweck | Befehl |
|---|---|
| Setup-Check (Env-Vollstaendigkeit) | `npm run check` |
| Twilio-Webhooks setzen | `node scripts/set-webhooks.js <https://url>` |
| Telnyx WS-Echo (Gate 2) | `node scripts/telnyx-ws-echo.mjs` |
| Tenant-Daten loeschen (DSGVO Art. 17) | `node scripts/erase-tenant.js <tenantId>` |
| Tests (offline, kein Netz/.env) | `npm test` |

## Anhang C — Bewusst vertagt (kein "jetzt")

- **pg-boss** Queue-Backend → P8 (Stub wirft; `QUEUE_BACKEND=memory` bleiben).
- **EU-AI-Act Art. 50(2)** (maschinenlesbare KI-Markierung der Stimme) → Compliance-Phase ab 08/2026;
  ersetzt den gesprochenen Offenlegungssatz NIE.
- **P8 Scale-Infra** (PgBouncer-Tuning/Read-Replicas/Partitionierung) → erst bei echter Last.
- **Allowlist-Lockerung** (Phase 0.6) → Owner-Entscheidung 2026-06-13: auf Phase 2 vertagt;
  bis dahin bleibt die Allowlist das harte letzte Gate.
- **Tech-Debt TD-1…TD-11** → `STATUS.md`.
