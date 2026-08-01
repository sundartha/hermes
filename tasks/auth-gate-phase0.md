# PLAN-AUTH-GATE — Phase 0: Re-Baseline (2026-08-01)

Erhoben gegen `master` = `8461b69` im Worktree `.claude/worktrees/auth-gate`,
Branch `phase/auth-gate`. Alle Fundstellen per `grep`/Datei-Lesung ermittelt, keine
Zeilennummer aus dem Plan uebernommen.

## Ergebnis in einem Satz

**Der Plan ist tragfaehig — keine inhaltliche Aussage widerlegt, kein Blocker.** Das
Routen-Inventar stimmt exakt (19 "nur Gate"-Zeilen, 21 Endpunkte), alle tragenden
Behauptungen sind am Code bestaetigt, keine der als tot eingestuften Routen hat einen
Aufrufer bekommen. Vier Abweichungen, alle handwerklich, keine strukturelle.

---

## 1. Routen-Inventar gegen Plan-Abschnitt 3

Erhoben aus der Mount-Reihenfolge in `src/app.js` (`buildApp`). Gate sitzt in
`installAuthGate` (`app.js:269`); alles, was NACH dieser Zeile gemountet wird, liegt
dahinter.

### Hinter dem Gate — deckungsgleich mit der Plan-Tabelle

| Pfad | heutige Fundstelle | Plan sagte | Einstufung |
| --- | --- | --- | --- |
| `express.static(publicDir)` | `app.js:270` | `:265` | (c) |
| `GET /voice/tts/:token` | `routes/voice.js:189` | `:162` | (a) |
| `router.use("/voice")` Sig-MW | `routes/voice.js:200` | `:173` | (a) |
| `POST /voice/incoming\|turn\|outbound\|status` + Call-Control | `voice.js:234,347,416,465,537` | — | (a) |
| `POST /api/calls` | `routes/api-calls.js:107` | `:81` | (b1) |
| `GET /api/calls/:id/consult` | `routes/api-calls.js:306` | `:306` | (b1) |
| `POST /api/calls/:id/consult/answer` | `routes/api-calls.js:331` | `:331` | (b1) |
| `POST /api/calls/:id/cancel` | `routes/api-calls.js:363` | `:264` | (b1) |
| `GET /api/state` | `routes/api-read.js:60` | `:73` | (b1) |
| `GET /api/calls/:id` | `routes/api-read.js:96` | `:111` | (b1) |
| `GET /api/tenant-data/export` | `routes/api-read.js:113` | `:128` | (b1) |
| `POST /api/settings` | `routes/api-tenant-write.js:32` | `:32` | (b2) |
| `POST /api/action-items/:id/toggle` | `routes/api-tenant-write.js:41` | `:41` | (b2) |
| `POST /api/calendar` | `routes/api-tenant-write.js:47` | `:47` | (b2) |
| `GET/POST/DELETE /api/profiles` | `routes/api-profiles.js:26,28,38` | `:26,28,38` | (b2) |
| `POST /api/billing/flush-meters` | `routes/api-billing.js:42` | `:42` | (b1) |
| `POST /api/billing/setup-checkout` | `routes/api-billing.js:56` | `:56` | (b2) |
| `POST /api/billing/cost-truing/sweep` | `routes/api-billing.js:85` | `:85` | (b1) |
| `GET /api/billing/cost-drift` | `routes/api-billing.js:99` | `:99` | (b1) |
| `GET /api/billing/platform-costs` | `routes/api-billing.js:112` | `:112` | (b1) |
| `GET /api/billing/checkout-return` | `routes/api-billing.js:128` | `:128` | (b2) |
| `POST /api/onboard` | `routes/api-onboard.js:84` | `:84` | (b1) |
| `POST /api/onboard/retry` | `routes/api-onboard.js:246` | `:246` | (b1) |
| `POST /mcp` (+ GET/DELETE 405) | `routes/mcp.js:52,129,130` | `:42` | (a) |

**Diff gegen Plan-Abschnitt 3: leer.** Keine Route dazugekommen, keine weggefallen.
Die Zaehlung des Plans (19 Zeilen "nur Gate", 21 HTTP-Endpunkte, weil die
Profiles-Zeile drei Methoden buendelt) stimmt.

### Vor dem Gate (unberuehrt) — ebenfalls deckungsgleich

`/healthz` (`app.js:111`), `GET /api/plans` (`app.js:121`), `/.well-known/*`
(`auth.js:127,128`), `POST /v1/chat/completions` (`app.js:144`), `GET "/"` nur ohne
`webDistDir` (`app.js:154`), `GET /tenant.html` -> 302 (`app.js:177`),
`express.static(webDistDir)` + `/app/*` (`app.js:184,186`), sowie der
`guardedBoot`-Block: `/auth/*` (`web-auth.js:208,242,308,333`), `GET
/api/portal/state` (`wiring/web-login.js:157`), `/api/admin/*`
(`web-auth.js:790,798,817`), 7x `/api/self-service/*`
(`self-service-routes.js:194,263,297,319,341,389,461`), `POST /webhooks/stripe`
(`wiring/web-login.js:206`).

**Vollstaendigkeitsprobe:** `grep` auf `app.(get|post|put|delete|patch)(` /
`router.(...)` ueber ganz `src/` findet ausserhalb von `routes/`, `wiring/`,
`web-auth.js`, `self-service-routes.js` **nur** die oben gelisteten `app.js`- und
`auth.js`-Zeilen. Es gibt keine versteckte Route-Registrierung.

---

## 2. Tragende Behauptungen — am Code nachgeprueft

| Behauptung | Ergebnis | Beleg |
| --- | --- | --- |
| Bootstrap-Fallback bindet fehlende Identitaet an `"owner"` | **bestaetigt**, Zeilen sogar unveraendert | `routes/_tenant.js:151` (`if (!req.auth && !internal) return singleTenantBootstrap();`) und `:132` (`if (!config.tenancy.multiTenant) return singleTenantBootstrap();`); `singleTenantBootstrap` = `BOOTSTRAP_TENANT_ID` (`:103`) |
| Kommentar "Das ist KEIN Leck: ohne Identitaet ist dies der vertraute Owner-/Betreiber-Kanal" | **woertlich vorhanden** | `routes/_tenant.js:144-145` |
| `isTrustedLocalCaller` ist die bestehende, reviewte Vertrauensgrenze | **bestaetigt** | `routes/_tenant.js:44` — echtes Loopback UND kein `X-Forwarded-For` |
| Mount-Reihenfolge: Gate nach WEB_DIST_DIR-Static, vor `express.static(publicDir)` | **bestaetigt** | `app.js:268` (`registerStaticServing`) -> `:269` (`installAuthGate`) -> `:270` (`express.static(publicDir)`) |
| `public/` traegt nur zwei gate-exempte Dateien | **bestaetigt** | `config.server.publicDir` = `<repo>/public` (`config.js:1241`); Inhalt exakt `favicon.ico` + `brand/hermes-icon.png`; exempt in `wiring/auth-gate.js:61` bzw. `:54` -> `express.static(publicDir)` schuetzt **null** Dateien |
| Genau ein lebender Credential-Nutzer ausserhalb der Tests | **bestaetigt** | `scripts/sweep-jetzt.sh:12,19,24` (`curl -u "admin:$PW"` gegen `https://app.sundartha.com/api/billing/cost-truing/sweep`). Die beiden anderen curl-Skripte (`set-anthropic-key.sh`, `set-elevenlabs-key.sh`) rufen Fremd-APIs, nicht uns. |
| `DASHBOARD_PASSWORD`-Fundstellen | **bestaetigt, Zeilen verschoben** | Einlesen `config.js:797` (Plan: `:721`), Boot-Refusal `config.js:1419-1421` (Plan: `:1296-1298`), Gate `wiring/auth-gate.js:35,70`, `.env.example:587` (Plan: `:512`), `render.yaml:261` (Plan: `:257`) |
| Boot-Refusal ist fail-closed (S6/B5) | **bestaetigt** | `config.js:1411` ("fail-closed: jeder Treffer ist fatal"), `productionFootguns` `:1416`, `detectProduction` `:106` |
| P1-Voraussetzung: Auth-Middlewares sind benannte Funktionen | **bestaetigt, Zeilen exakt** | `mcpAuth` `auth.js:95`, `webAuthGateMiddleware` `web-auth.js:729`, `adminOnlyMiddleware` `web-auth.js:765` |
| `createPortalRunner` wird heute direkt importiert (P1 braucht den Seam) | **bestaetigt** | Import `app.js:41`, Uebergabe an `wireWebLogin` `app.js:260`; Web-Login-Block haengt an `app.js:242` (`sessionSecret && storeBackend === "pg"`) |

**Nicht neu gemessen:** die Live-Reproduktion aus Plan-Abschnitt 1 (anonymer
`POST /api/calls` -> 200 + echter Originate) habe ich nicht wiederholt. Der
Mechanismus ist am Code eindeutig — `auth-gate.js:35` gibt ohne Passwort frei,
`_tenant.js:151` bindet die fehlende Identitaet an `"owner"`. Die maschinelle
Wiederholung ist genau das, was P2 baut; sie hier vorwegzunehmen waere doppelte
Arbeit.

---

## 3. Tote Routen — hat eine einen Aufrufer bekommen?

**Nein, keine einzige.** Gesucht wurde in `src/`, `scripts/`, `apps/web/src/`,
`public/`.

| Route | Treffer ausserhalb der eigenen Definition |
| --- | --- |
| `POST /api/settings` | nur Kommentare (`self-service.js:1,19,23`, `self-service-routes.js:11,262`, `store/defaults.js:459,468,479,511`, `store/state-ops.js:3277`, `i18n/greeting-catalog.js:45`, `app.js:357`) |
| `POST /api/action-items/:id/toggle` | nur Kommentare (`app.js:358`) |
| `POST /api/calendar` | nur Kommentare (`claude.js:486`, `app.js:358`, `routes/api-calls.js:326`, `store/defaults.js:451,594`, `_validation.js:7`) |
| `GET/POST/DELETE /api/profiles` | nur Kommentare (`app.js:376`) |
| `POST /api/billing/setup-checkout` | keiner |
| `GET /api/billing/checkout-return` | nur `api-billing.js:63` — die `successUrl` von `setup-checkout`. Genau das geschlossene Legacy-Paar, das der Plan beschreibt. |
| `GET /api/tenant-data/export` | keiner (`store/state-ops.js:402` ist ein Kommentar; der Plan nannte `:366`) |

**Gegenprobe fuer (b1)-1 (`internalOnly`-Kandidaten):** die MCP-Tools rufen genau die
sieben im Plan genannten Routen ueber `api()`/`call()` (`mcp-tools.js:54`,
`resolveGatewayUrl()`):
`POST /api/calls` (`:647`), `GET /api/calls/:id` (`:704,764,816`),
`POST /api/calls/:id/cancel` (`:850`), `GET /api/state` (`:868,896,911,941,980`),
`GET /api/calls/:id/consult` (`:702` via `pollConsult`),
`POST /api/calls/:id/consult/answer` (`:734`).
`apps/web/src/` liefert fuer `api/state`, `consult`, `api/calls`, `tenant-data`,
`api/onboard`, `api/billing` **nur zwei Kommentar-Treffer**
(`lib/api.js:586`, `components/app/SettingsIsland.astro:30`) — kein einziger Aufruf.
Die Einstufung `internalOnly` traegt.

---

## 4. Befunde (Abweichungen vom Plantext)

**F1 — `src/routes/_validation.js` existiert bereits.** P4 formuliert den Umzug von
`validIdentity`/`IDENTITY_MAX_LEN` als "nach `src/routes/_validation.js`
verschieben", als waere die Datei neu. Sie existiert (Kalender-/Kontext-/Mandats-
Validierung, `E164`, `TEXT_LIMITS`, `validateAssistantContext`, ...). Der Umzug wird
also ein Anbau an eine Bestandsdatei. Die Notwendigkeit bleibt: `validIdentity` +
`IDENTITY_MAX_LEN` liegen weiterhin in `routes/api-profiles.js:17-19` und werden von
`routes/api-onboard.js:17` importiert — ohne Umzug bricht der Boot in P4.

**F2 — P7 nennt "18 Dateien unter `test/`", es sind heute 20.** `grep -rl
"DASHBOARD_PASSWORD\|dashboardPassword" test/` liefert 20 Dateien (18 `*.test.js` +
`helpers.js` + `prod-env.js`). H12 hatte 18 exakt gezaehlt; zwei sind seither
dazugekommen. Die exakte P7-Aenderungsmenge wird in P7 neu erhoben, nicht aus dem
Plan uebernommen.

**F3 — Zeilennummern-Drift, wie im Warnkasten angekuendigt.** Verschoben:
`api-read.js` (-13 bis -15), `api-calls.js` (`POST /api/calls` +26, `cancel` +99),
`mcp.js` (+10), `voice.js` (+27), `self-service-routes.js` (-9), `config.js` (+76 bis
+123), `app.js` (+4 bis +5). **Unveraendert** (Zufall, nicht Verlass):
`api-tenant-write.js`, `api-profiles.js`, `api-billing.js`, `api-onboard.js`,
`_tenant.js`, `auth.js:95`, `web-auth.js:729/765`.

**F4 — nichts vorweggenommen.** `src/route-policy.js`,
`test/route-auth-inventory.test.js`, `scripts/probe-auth.sh`,
`docs/RUNBOOK-AUTH-REVIEW.md` existieren nicht. `test/auth-gate-exemption-order.test.js`
(der von P1 zu ersetzende Test) und `scripts/sweep-jetzt.sh` (in P7 zu loeschen)
existieren. P1-P9 starten auf gruener Wiese.

---

## 5. Offener Owner-Entscheid (erst in P7 relevant, kein Blocker jetzt)

Plan-Entscheidung 5 setzt `/login -> /auth/login` und `/dashboard -> /app` fest.
Zusaetzlich **vorgeschlagen, aber ausdruecklich nicht entschieden**: `/signin`,
`/sign-in`, `/account`, `/portal` (-> `/auth/login` bzw. `/app`) und `/admin`
(-> `/app`). Braucht eine Antwort, bevor P7 geschrieben wird — nicht vorher.
