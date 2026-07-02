# Sundartha - Offene Punkte (Status)

> Das EINZIGE Status-/Offene-Punkte-Doc. Abgeschlossene Phasen stehen in der Git-History
> und in der Memory, nicht hier. Lebende Referenz-Docs (bleiben separat):
> `PLAN-SECURITY.md` (Security-Plan), `docs/RUNBOOK-OPERATOR.md` (Betrieb/Live-Gates),
> `docs/RELEASE-GATE-killer-test.md` (Release-Gate), `tasks/rebrand-sundartha.md` (Rebrand-Task),
> `tasks/lessons.md` (Lehren).
>
> **Stand:** 2026-06-23 - HEAD lokal = `4e5d4e9` = **origin/master = upstream/master** (alle in
> sync). Der Render-Deploy von `4e5d4e9` ist **live** (gesund hochgekommen) - der Frontend-Track
> **w0-w5** und das **f2-Inbound-SMS-Datenmodell** sind damit **deployt/live**
> (auto-sync-Hook + Render-autoDeploy). **Tests: 846/846 gruen.**

## Erledigt (Kontext, nicht offen)

Vollstaendig gemergt (in origin/master): Multi-Tenant-Identitaet **I0-I9**,
Telnyx-Multi-Tenant **P0-P8** (Adapter/Ports/pg/Budget/Onboarding/Payment-Code/KYC/Realtime-Port/DSGVO),
Auth-Foundation **+ Fixes F1-F5**, Crash-Hotspots **P0-P4**, P3b-R LLM-Resilienz **CP1-CP7**,
Geo-Location **f1-P1..P9** (Sprache/Land-Gate +49/+33/+44, maxmind lokal), **f2-P0..P4**
(Inbound-SMS-Datenmodell + `private_number`-Facades + Onboard-Wiring), der **Produkt-Frontend-Track
w0-w5** (Marketing-SSG + Design-Token, OIDC-Login-Roundtrip, Billing-Insel setup-mode, Read-only
Datensicht, Settings-/Whitelist-Editor; duenner Client gegen die bestehende API), sowie der
**Inbound/Outbound-STT-Fix** (de-DE + `speechTimeout="auto"` + defensives `extractSpeech`).
Der **Outbound-Dialog laeuft seit 2026-06-20 erstmals live end-to-end** (Disclosure -> Anlass -> Dialog).
Die **Stripe-Karten-/Customer-Erfassung beim Onboarding (Pay1-Pay4)** ist gemergt: Checkout
`setup`-Mode + `off_session`-`placeHold`; Hold->Capture laeuft end-to-end im **Test-Mode** gruen
(PaymentIntent `succeeded`, `livemode=false`). Memory [[pay-chain-design-decisions]],
[[f1-geo-p4-p9-decisions]]. (Die fruehere Detail-Report-Sammlung unter `tasks/*-report.md` wurde
2026-06-23 entfernt - die Historie steht in der Git-History + Memory.)

Das **Token-Sync-Gate** (MCP-UI P5) ist verankert: `npm run check:tokens` (`scripts/check-token-sync.js`) erkennt fail-closed Drift zwischen `apps/web/src/styles/tokens/` und `design-system/_shared/tokens.css` (Hash-Manifest `tokens.lock`) und prueft @import-Verbot + @dsCard-Marker. Lokal, nicht gepusht.

---

## 1. Live-/Betreiber-Gates (nicht autonom: Mensch / Account / Geld / echter Call)

1. **STT-Live-Abschluss + Premature-close-Re-Check** - Outbound laeuft live (`7b0d877`);
   offen ist nur die formale Akzeptanz (sauberer Re-Test mit `role:caller` + Folge-Turn) und die
   Bestaetigung, dass unter `@anthropic-ai/sdk` 0.105 (CP7) kein "Premature close" mehr auftritt.
2. **Telnyx-Realtime scharf schalten** - blockiert bis Live-WS-Echo-Test gruen (Payload-Format
   mu-law vs. RTP). Code ist dormant; Live laeuft auf `VOICE_ENGINE=budget`.
3. ~~**`TELNYX_NUMBER` produktiv setzen**~~ - **STRUKTURELL AUFGELOEST (2026-06-21):** Es gibt
   keine `TWILIO_NUMBER`/`TELNYX_NUMBER`-Env-Var mehr. Der Owner ist Tenant Null und haelt seine
   Absendernummer(n) wie jeder Tenant im Store; `outboundFrom` liest fuer ALLE Tenants via
   `findActiveNumber`, ein Boot-Guard verlangt fail-closed eine aktive Owner-Nummer.
   **Owner-Aktion:** Bestandsnummer setzen - lokal per
   `npm run seed-owner-number -- <e164> <twilio|telnyx>` gegen `data/store.json`; in Prod
   genuegt jetzt die Env (`OWNER_NUMBER` + `OWNER_NUMBER_PROVIDER`, in `render.yaml` gesetzt), die
   beim Boot idempotent geseedet wird (s.u.). **Offen (Owner):** passt die hinterlegte Nummer
   (Provider/Land) zum DE-Launch (`PROVISIONING_COUNTRY=DE`)?

   > **DEPLOY-RISIKO AUFGELOEST (2026-06-23, `f0f7fe0`):** Der Boot seedet die Owner-Nummer jetzt
   > wieder **config-derived idempotent** aus `OWNER_NUMBER`/`OWNER_NUMBER_PROVIDER`
   > (`state-ops.seedOwnerNumberFromConfig`, Provider fail-closed gegen die Provider-Liste validiert).
   > Damit ueberlebt der fluechtige Render-Free-FS-Reset bei `STORE_BACKEND=json`, ohne dass der
   > Boot-Guard den Start verweigert. Beide Render-Env-Keys stehen in `render.yaml`. (Mit `pg` ist
   > der Seed ohnehin persistent.)

4. **Stripe live** - **Karten-Erfassung + Test-Mode-Hold/Capture ERLEDIGT** (Pay1-Pay4, gemergt +
   live-deployt, 708/708): Checkout `setup`-Mode (Stripe-Customer + `payment_method` pro Tenant) +
   `off_session`-`placeHold` -> die fruehere 400-Wurzel (`confirm` ohne `payment_method`) ist weg;
   Hold->Capture gegen echtes Stripe-Test gruen (`succeeded`, `livemode=false`). Deckt auch die in
   P6b3 ausgelassene `stripe_customer_id`-Bindung. `PAYMENT_ENABLED` bleibt `false` (Gate aus =
   byte-identisch). Details: Memory [[pay-chain-design-decisions]]. **Offen fuer ECHTES Geld:**
   - `PAYMENT_ENABLED=true` + `NUMBER_SETUP_FEE_CENTS>0` + `PROVISIONING_ENABLED=true` im echten
     Onboard-Flow verifizieren (echter Nummernkauf statt Fake-Provisioner).
   - Test->Live: `sk_live_...` nur via Render-Dashboard (nie committen).
   - Die 3 Meter (`voice_minutes`/`ai_tokens`/`number_months`) im Stripe-Dashboard anlegen.
   - SCA/3DS-Recovery: `off_session`-Charge kann bei echten Karten `authentication_required` werfen
     (`pm_card_visa` nie) -> der Capture-Pfad braucht dann einen Recovery-Flow.
5. **WorkOS invite-only scharf + Staging->Production**; **Prod-Postgres** mit non-superuser/
   NOBYPASSRLS-Rolle + pgBouncer (transaction mode); **Killer-Test** fahren
   (`docs/RELEASE-GATE-killer-test.md`) VOR `MULTI_TENANT=true` in Produktion.
6. **`MCP_AUTH=oauth`** end-to-end gegen claude.ai im Dauerbetrieb; **Secrets-Hygiene**.
   - **Secrets-Hygiene ERLEDIGT (2026-06-21, Doku):** Secrets-Inventar (Blast-Radius pro Secret),
     Token-Rotations-Prozedur (Ueberlappung/Zero-Downtime + Besonderheiten pro Secret) und
     Twilio-Subaccount-/Telnyx-Scoped-Key-Minimalrechte-Checkliste stehen jetzt vollstaendig in
     `docs/RUNBOOK-OPERATOR.md` Gate 7. Der OAuth-Code ist test-gedeckt (`test/oauth.test.js`).
   - **Live-Infra VERIFIZIERT (2026-06-21):** Render-Env steht auf `MCP_AUTH=oauth`; gegen
     `https://vodafone-agent.onrender.com` sind Gate-5b-Steps 1-2 gruen - Protected-Resource-Metadata
     (beide Pfade) zeigt `resource=…/mcp` + WorkOS-Issuer, unautorisierter `POST /mcp` -> `401` +
     `WWW-Authenticate`-Wegweiser. WorkOS-Issuer erreichbar (openid-configuration + AS-Metadata +
     JWKS 1 Key) -> Token-Verify-Kette greift live.
   - **OFFEN (nur interaktiv/Operator):** Gate-5b-Steps 3-5 - claude.ai-Connector verbinden +
     einloggen + Dauerbetrieb (silent Refresh ueber einen Token-Ablauf). ACHTUNG: Issuer ist noch
     eine **Staging**-AuthKit-Domain (`…-staging.authkit.app`) -> vor echtem Prod-Dauerbetrieb
     Staging->Production-Cutover (Runbook Gate 5, Schritt 3).
7. **Crash-Hotspots P3 Real-Call-Smoke** (5 Szenarien, HEIKLE STELLE in `bridge.js`) als Gate
   VOR `VOICE_ENGINE=realtime`-Aktivierung.
8. **Frontend w0-w5 + f2-Datenmodell sind LIVE deployt** (Render-Deploy `4e5d4e9` gesund). Offen
   ist nur noch die **manuelle Live-Abnahme der Kundensicht**: Auth-/Login-Roundtrip, Billing-Insel
   (setup-mode), Read-only-Datensicht und Settings-/Whitelist-Editor gegen die Live-Env durchklicken
   (das Frontend hat die bisherige `express.static`-Kundensicht abgeloest - same-origin, kein CORS;
   `docs/strategy/hermes-frontend.md`). **f2 ist das Datenmodell (P0-P4) + der Self-Service-Write
   P5** (`POST /api/self-service/private-number`, gemergt `f3cef86`, 854/854) - die eigentliche
   **Inbound-SMS-Zusammenfassung an die private Tenant-Nummer** (das Versenden selbst) ist noch
   nicht gebaut.

> Hinweis: Deepgram-STT und Azure-NTTS sind im Telnyx-Account bereits aktiv/abgerechnet -
> das ist KEIN offenes Gate mehr (per Account-Records 2026-06-20 verifiziert).

## 2. Autonome Code-Follow-ups

> Diese Items mit Vorgehen pro Item + Workflow-Einschaetzung (ist phase-impl noetig?):
> siehe **`AUTONOM.md`**.

> **Stand 2026-06-23:** A1, A3, A4 + Rebrand-Track-A sind GEMERGT. Offen bleiben hier nur noch
> A5 (sequenziell) und A2 (in Arbeit, inkrementell).

1. **A5 - TEMP-DIAGNOSE-Logs entfernen** - **OFFEN (bewusst sequenziell).** `[turn-recv]`/`[turn-ok]`
   (`src/server.js`) + `[boot]` (`src/boot-guard.js`). ERST nach Abschluss von Gate 1.1 entfernen -
   bis dahin fuer die Live-Tests noch nuetzlich.
2. **Azure TTS `speak_failed`** (intermittent) - **TEILS adressiert.** `/voice/status` loggt den
   Fehlschlag jetzt PII-frei als `[voice/speak] FAILED` (durch A1) -> die Stoerung ist nun
   diagnostizierbar. OFFEN bleibt die eigentliche Abfang-/Recovery-Strategie (nur per echtem Call
   verifizierbar). Freie Stimmen-/Modellwahl bleibt (kein Voice-Swap als Fix).
3. ~~**`/voice/status` Telnyx-Lifecycle parsen** (A1)~~ - **ERLEDIGT (gemergt).** Provider-bewusst:
   `extractLifecycleEvent` + `extractSpeakOutcome`, PII-frei, `CallDuration`/Status sichtbar.
4. ~~**Remote-Browser-OAuth fuer Self-Service** (A4)~~ - **ERLEDIGT (gemergt).** REST-Pfad liest
   `req.tenant` aus der Web-Session VOR `req.auth`, fail-closed (`routes/_tenant.js`; `web-auth.js`
   setzt `req.tenant`). Remote-Self-Service damit nutzbar - der Identitaets-Gap ist zu.
5. ~~**`bridge.js handleOpenAiEvent` extrahieren** (A3)~~ - **ERLEDIGT (gemergt).** Charakterisierungs-
   Test (A3-P1) + Extraktion (A3-P2) + Unit-Tests (A3-P3). Nur bei Realtime-Aktivierung relevant.
6. **A2 - `server.js`-Decomposition (TD-4)** - **IN ARBEIT.** ~1130 -> 1059 LOC; extrahiert:
   `routes/api-profiles.js`, `routes/api-read.js`, `routes/_tenant.js`, `routes/_validation.js`.
   Weitere `/api`-Gruppen koennen inkrementell folgen (verhaltens-erhaltend).
7. **A6 - Call-State ueberlebt Instanzwechsel nicht (S1, 2026-07-02, Runde 2 Anrufqualitaet)** -
   **OFFEN.** Zero-Downtime-Deploy toetet laufende Calls: neue Instanz kennt den in-memory-Call
   nicht -> `/voice/turn` legt fail-closed auf (seit Runde 2 wenigstens GELOGGT statt still),
   und der Reconcile-Flush der neuen Instanz LOESCHT den Call-Row aus pg (deleteMissing) -
   nachgewiesen am Owner-Testanruf `call_mr3lg2g7t9zg` (14:22:33Z, Deploy dep-d9377ui).
   Fix = eigener Store-Schnitt: read-through-Rehydrate im Webhook-Pfad + Reconcile-Schutz fuer
   aktive Calls + Deploy-Draining. Bei Skala PFLICHT (jeder Deploy trifft laufende Calls).
   Details: `tasks/call-quality-2-report.md` (Diagnose S-A).

## 3. Bewusst vertagt (nur Tracking, kein akuter Task)

- Allowlist-Lockerung -> Phase 2 / Rechteprofile
- pg-boss als Queue-Backend -> P8 (Stub vorhanden, Default `QUEUE_BACKEND=memory`)
- EU-AI-Act Art. 50(2) maschinenlesbare KI-Markierung -> Compliance-Phase 08/2026
- P8 Scale-Infra (PgBouncer / Read-Replicas / Partitionierung) -> bei echter Last
- P3b-R CP5/CP6 (Metrik-Seam / Breaker-Tuning) -> W4 uebersprungen; **Path B** (undici als Dep
  - expliziter Dispatcher) nur falls "Premature close" unter 0.105 erneut auftritt
- TD-8 MCP-sub-Threading (I5; aktuell fail-closed, kein Leak)

## 4. Rebrand: "Hermes" (Produkt) / "Sundartha" (Firma)

**Track A (Code/Doku-Rename) ERLEDIGT** (A6-P1..P4, gemergt, Stand 2026-06-21): kein `vodafone`
mehr in `src/`; `agentName`-Default + `package.json` + MCP-Name + Banner + Dashboards inkl. Badge
auf **Hermes**; die String-pinnenden Tests nachgezogen (679/679 gruen). Details:
`tasks/rebrand-sundartha.md`. Verbleibende `vodafone`-Treffer sind BEWUSST Track B bzw. kosmetisch:

- **Track B (OFFEN, owner-koordiniert/hoch-Risiko):** `render.yaml` Service-Name, Brand-URL/Domain,
  Twilio/Telnyx/WorkOS/claude.ai-Cutover, **GitHub-Repo-Rename** (origin + upstream heissen weiter
  `vodafone-agent` - per `gh` 2026-06-21 bestaetigt), lokaler Ordnerpfad. Schritte + Pre-Mortem:
  `tasks/rebrand-sundartha.md` Track B.
- **Kleine Track-A-Reste (nachzuziehen, niedrig):** README/ONBOARDING nennen noch
  "Vodafone Verified"-Badge / "Vodafone-Design" (reine Produktnamen, KEINE URLs) + Test-Fixture
  `admin@vodafone.de`.
