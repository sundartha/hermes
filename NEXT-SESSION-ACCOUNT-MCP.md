# Handoff — Account/Buchung + Telnyx-Provisioning + MCP-Zugang (Stand 2026-06-27)

> Prompt fuer die naechste Claude-Session. Sprache bewusst ohne Umlaute (Repo-Konvention).
> Diese Session hat Phase A (Single-Origin) live abgeschlossen, den Abo-"passiert-nichts"-Bug
> gefixt und live bewiesen, dass ein Abo bis zum Telnyx-Nummernkauf kommt. Mehrere Folgebugs
> sind exakt diagnostiziert (nicht geraten) und unten als naechste Schritte gelistet.

## ROLLE / MISSION
Funktionierender Buchungs- + Account-Bereich UND der Betreiber soll Hermes via MCP live
nutzen koennen. Methodik pro Schritt: erst Runtime/Code verifizieren (5-Why, "nie raten",
Server-Logs via Render-MCP), Pre-Mortem, dann fixen. Telefonie/Geld/Auth = nicht-trivial.

## ZUERST LESEN (Dateien NEU lesen, nicht auf Zusammenfassungen verlassen)
1. CLAUDE.md, .claude/refs/workflow.md, .claude/refs/clean-code.md
2. PLAN-ACCOUNT-BILLING.md (Strategie A-E), tasks/account-billing-A-todo.md (Phase-A-Beleg)
3. Memories: account-billing-strategy, deploy-repo-split, phase-impl-workflow-args,
   owner-tenant-null-numbers, owner-number-did-vs-personal-403, lean-phase-orchestration
4. Echten Git-/Live-Stand SELBST pruefen (git log; Render-MCP get_service/list_deploys/list_logs).

## HARTE INFRA-FAKTEN (nicht verwirren lassen)
- **Service `vodafone-agent`** (id `srv-d8m0fhflk1mc73bno570`) ist **DASHBOARD-MANAGED**
  (Config via Render-API, NICHT render.yaml/Blueprint). render.yaml ist REFERENZ. Live-Env
  weicht ab: autoDeploy=yes(commit), **MULTI_TENANT=true, SELF_SERVICE_ENABLED=true,
  MCP_AUTH=oauth, PAYMENT_ENABLED=true, PROVISIONING_ENABLED=true** (vom Owner gesetzt),
  WEB_DIST_DIR=apps/web/dist, buildCommand baut apps/web mit.
- **Deploy geht LIVE nur ueber upstream (jonas986)** + autoDeploy auf Commit. Boot-Banner
  `[boot] deployed commit=...` zeigt den Live-Stand. Env-Schreibzugriff per Render-MCP wird
  vom auto-mode-Classifier blockiert -> Owner setzt Env im Dashboard.
- **Render-Postgres direkt-Query (query_render_postgres) scheitert (SSL)** -> DB nicht direkt
  lesbar; ueber Logs + Code arbeiten. Workspace `tea-d8m0b9jeo5us73cvasg0` (vor MCP-Calls
  ggf. select_workspace; Selektion faellt zwischen Turns weg).
- **Chrome-Extension blockt checkout.stripe.com + dashboard.stripe.com** -> Karten-/Stripe-
  Seiten kann nur der Owner bedienen. Karteneingabe ist ohnehin verboten (Testkarte 4242 ok).
- Owner = normaler Tenant + Admin; **Bootstrap-Tenant haelt die aktive Nummer** (Boot-Guard).
  Der OAuth-Self-Service-Tenant des Owners ist NICHT der Bootstrap-Tenant -> hat keine Nummer.

## WAS DIESE SESSION ERLEDIGT HAT
- **Phase A (Single-Origin) LIVE FERTIG + verifiziert.** app.sundartha.com serviert das
  Astro-Build (Gateway, WEB_DIST_DIR + buildCommand baut apps/web), Marketing bleibt Static
  auf sundartha.com. Eingeloggter Netzwerk-Trace: `GET /api/self-service/state -> 403`,
  `.../billing/status -> 200` SAME-ORIGIN -> Dashboard zeigt echten State statt "Something
  went wrong" (W1/S3 weg). Beleg: tasks/account-billing-A-todo.md.
- **Abo-"passiert-nichts"-Bug GEFIXT + LIVE (commit 21b6067, upstream+origin).**
  Wurzel: `createSubscription` sendete kein `default_payment_method` -> Stripe konnte die
  erste Rechnung off_session nicht belasten -> HTTP 400. Fix spiegelt placeHold. Zusaetzlich:
  Stripe-Fehlerbody wird jetzt geloggt (Diagnose). 1160/1160 Tests.
- **Geldpfad live bewiesen:** Abo -> Aktivierung -> Provisioning -> Telnyx `orderNumber`
  (Nummer wird bestellt). Es scheitert erst danach (configureNumber, s.u.).

## OFFENE PUNKTE (exakt diagnostiziert; Reihenfolge = Empfehlung)

1. **Stripe-Idempotenz-Key vergiftet sich.** Key `sub_<tenant>_<plan>` ist 24h stabil; ein
   Fehlversuch (z.B. der alte 400) "verbrennt" ihn -> Retry mit geaenderten Params ->
   `idempotency_error` (HTTP 400). Trifft echte Kunden (abgelehnte Karte sperrt 24h).
   FIX: Key an die Zahlungsmethode binden bzw. versionieren (`sub_<tenant>_<plan>_<pm>`),
   damit ein korrigierter Retry einen frischen Key nimmt. Datei: src/billing/subscribe.js
   (subscribeIdempotencyKey). Test mitziehen.

2. **Telnyx-Provisioning kommt nicht bis "Nummer aktiv".** Zwei Ursachen:
   a) **DE-Nummern brauchen regulatorische Dokumente** -> werden nicht aktiviert ->
      `PATCH /v2/phone_numbers/{id}/voice` -> **404** ([provision-worker] configureNumber).
      Fuer Tests US verwenden (US-DIDs brauchen keine Docs).
   b) **US griff nicht**, weil der Signup das Land **geo-erkennt und am Tenant setzt**
      (tenant.country=DE), und `provision-trigger.js:22` nimmt `tenantGeo().country ||
      fallbackCountry` -> Tenant-Geo schlaegt die `PROVISIONING_COUNTRY`-Env. FIX-Optionen:
      einen FORCE-Override (Env, der Tenant-Geo schlaegt) ODER beim Test das Tenant-Land
      setzen. (Geo-Detektion im Signup-Pfad finden + verifizieren.)
   c) **configureNumber-ID/Async ungeprueft** (numbers.js:62 Kommentar "live UNBESTAETIGT").
      Telnyx `number_orders` ist asynchron; die zurueckgegebene id ist evtl. die Order-Zeilen-
      ID, nicht die `/v2/phone_numbers`-Ressourcen-ID. FIX: gegen die LIVE-Telnyx-API
      verifizieren (mit US, da sofort aktiv) -> echte phone_number-id aufloesen
      (`GET /v2/phone_numbers?filter[phone_number]=...`, ggf. kurz pollen bis aktiv), dann
      configure; ODER `connection_id` direkt beim Order mitgeben (Telnyx unterstuetzt das).
      Telnyx hat KEINEN Sandbox fuer Nummernkauf -> echter (kleiner) Kauf; Owner hat Guthaben.

3. **Stripe-Webhook-Signatur wird abgelehnt** (`[audit] stripe_webhook_rejected ... signature`).
   STRIPE_WEBHOOK_SECRET passt nicht zum Endpoint (oder Raw-Body). Geldpfad laeuft aktuell
   ueber die Subscribe-Route (nicht den Webhook), ABER Lifecycle (Kuendigung/Zahlungsausfall,
   Phase E) braucht den Webhook. Secret gegen den Stripe-Webhook-Endpoint pruefen.

4. **MCP-Zugang fuer den Betreiber.** Live MCP_AUTH=oauth. Der **claude.ai-App-Connector
   (OAuth) scheitert**: `invalid_target` (WorkOS lehnt den RFC-8707-`resource`-Parameter ab,
   den der MCP-OAuth-Flow schickt) + `state: Field required`. WorkOS AuthKit <-> MCP-OAuth
   ist die eigentliche Baustelle fuer claude.ai-App/Phone. **Workaround (Claude Code/Desktop):**
   MCP_AUTH="" (Legacy) + `Authorization: Bearer <MCP_AUTH_TOKEN>` -> identity=null -> Owner-
   Tenant (hat Nummer) -> funktioniert ohne Provisioning/OAuth. (server.js:1643-1644;
   auth.js:85-94. /.well-known/oauth-authorization-server -> 404, protected-resource -> 200.)

5. **server.js:356 SPA-Fallback wirft** "path must be absolute" bei `/app/*`-Deep-Links,
   weil WEB_DIST_DIR relativ ist (`apps/web/dist`). FIX: absoluter Pfad (path.resolve /
   sendFile {root}). Klein, eigener Commit.

6. **Static-Polish:** sundartha.com/app liefert noch das alte, kaputte Frontend (relative
   /api -> 404). Redirect-Regel `/app/*` -> app.sundartha.com/app auf der Static-Site
   (hermes-web, Dashboard Redirects/Rewrites).

## LEITPLANKEN
- Safety-Gates (Allowlist/Denylist/Land/Budget/Max-Dauer/Signatur) + Offenlegungssatz NIE
  anfassen. PAYMENT_ENABLED/PROVISIONING_ENABLED bleiben Gates. Geld als Ganzzahl-Cents.
- Neue config-Var? IMMER BASE_ENV (test/helpers.js) nachziehen (sonst Baseline-Drift).
- Kein pglite + Server-Spawn in EINER Testdatei. Neues Verhalten braucht einen node:test-Test.
- Deploy live nur ueber upstream; Live-Commit per Boot-Banner verifizieren. Push erst nach
  Owner-OK. Secrets nie loggen/committen (Token gibt der Owner selbst ein).
- Scope-Disziplin: nur das jeweilige Thema.
