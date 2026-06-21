# Sundartha - Offene Punkte (Status)

> Das EINZIGE Status-/Offene-Punkte-Doc. Abgeschlossene Phasen stehen in der Git-History
> und in der Memory, nicht hier. Lebende Referenz-Docs (bleiben separat):
> `PLAN-SECURITY.md` (Security-Plan), `docs/RUNBOOK-OPERATOR.md` (Betrieb/Live-Gates),
> `docs/RELEASE-GATE-killer-test.md` (Release-Gate), `tasks/rebrand-sundartha.md` (Rebrand-Task),
> `tasks/lessons.md` (Lehren).
>
> **Stand:** 2026-06-21 - HEAD lokal = `8d148a8` (= origin/master, in sync; A2/A3/A4/A6 gemergt);
> upstream/jonas986 (= Live, Render) = `2ceb344`, haengt zurueck. **Tests: 679/679 gruen.**

## Erledigt (Kontext, nicht offen)

Vollstaendig gemergt + (bis auf den origin-Rueckstand) live: Multi-Tenant-Identitaet **I0-I9**,
Telnyx-Multi-Tenant **P0-P8** (Adapter/Ports/pg/Budget/Onboarding/Payment-Code/KYC/Realtime-Port/DSGVO),
Auth-Foundation **+ Fixes F1-F5**, Crash-Hotspots **P0-P4**, P3b-R LLM-Resilienz **CP1-CP7**,
sowie der **Inbound/Outbound-STT-Fix** (de-DE + `speechTimeout="auto"` + defensives `extractSpeech`).
Der **Outbound-Dialog laeuft seit 2026-06-20 erstmals live end-to-end** (Disclosure -> Anlass -> Dialog).

---

## 1. Live-/Betreiber-Gates (nicht autonom: Mensch / Account / Geld / echter Call)

1. **STT-Live-Abschluss + Premature-close-Re-Check** - Outbound laeuft live (`7b0d877`);
   offen ist nur die formale Akzeptanz (sauberer Re-Test mit `role:caller` + Folge-Turn) und die
   Bestaetigung, dass unter `@anthropic-ai/sdk` 0.105 (CP7) kein "Premature close" mehr auftritt.
2. **Telnyx-Realtime scharf schalten** - blockiert bis Live-WS-Echo-Test gruen (Payload-Format
   mu-law vs. RTP). Code ist dormant; Live laeuft auf `VOICE_ENGINE=budget`.
3. **`TELNYX_NUMBER` produktiv setzen** - **lokal in `.env` jetzt gesetzt** (`+18643028341`,
   Stand 2026-06-21) -> lokaler MCP-Telnyx-Outbound damit scharf (Schalter `server.js`).
   Produktion (Render-Env) ist davon getrennt -> dort vom Owner zu bestaetigen. **ACHTUNG /
   zu klaeren:** weicht von der bisherigen "leer/fail-closed bis gruener Live-Smoke"-Vorgabe ab,
   und es ist eine US-Nummer (`+1`) - passt nicht zum DE-Launch (`PROVISIONING_COUNTRY=DE`). Bewusst?
4. **Stripe live** - **Test-Keys liegen jetzt vor** (`STRIPE_SECRET_KEY=sk_test_...` lokal in
   `.env`, gitignored/nicht committet). `PAYMENT_ENABLED` bleibt `false` -> System weiter
   fail-closed/unveraendert. Isolierte Test-Mode-Smoke 2026-06-21 (direkter `placeHold`-Aufruf
   gegen Stripe, KEIN Telnyx / kein Nummernkauf):
   - **GRUEN:** Key authentifiziert (PaymentIntent angelegt, HTTP 200). Voller Hold->Capture mit
     Stripe-Test-Zahlungsmethode (`pm_card_visa`, `capture_method=manual`, `confirm=true`):
     `requires_capture` -> Capture -> `succeeded`. Die FORM unseres Codes (`src/billing/stripe.js`)
     ist also korrekt.
   - **ROT:** unser heutiges `placeHold` (`confirm=true` OHNE `payment_method`) -> HTTP 400
     ("must provide a `return_url` ... or set `automatic_payment_methods[allow_redirects]=never`").
   - **WURZEL/OFFEN:** Es fehlt die **Karten-/Customer-Erfassung beim Onboarding**. Ohne eine
     gespeicherte `payment_method` (Stripe-Customer pro Tenant) kann der Hold fuer einen ECHTEN
     Tenant nie durchlaufen - Test 3 nutzte nur eine Labor-Testkarte. Das ist eine **eigene Phase**
     (Stripe Checkout/Elements/SetupIntent -> Customer + payment_method speichern), **kein reiner
     Env-Flip**. Deckt zugleich die in P6b3 bewusst ausgelassene `stripe_customer_id`-Bindung ab.
   - **DANACH:** `placeHold` um `payment_method` (bzw. `automatic_payment_methods[allow_redirects]=never`)
     erweitern; dann `PAYMENT_ENABLED=true` + `NUMBER_SETUP_FEE_CENTS>0` setzen und Hold/Capture im
     echten Onboard-Flow verifizieren (nur sinnvoll mit `PROVISIONING_ENABLED=true`); zuletzt
     Test->Live (`sk_live_...`, nur via Render-Dashboard, nie committen) + die 3 Meter
     (`voice_minutes`/`ai_tokens`/`number_months`) im Stripe-Dashboard anlegen.
5. **WorkOS invite-only scharf + Staging->Production**; **Prod-Postgres** mit non-superuser/
   NOBYPASSRLS-Rolle + pgBouncer (transaction mode); **Killer-Test** fahren
   (`docs/RELEASE-GATE-killer-test.md`) VOR `MULTI_TENANT=true` in Produktion.
6. **`MCP_AUTH=oauth`** end-to-end gegen claude.ai im Dauerbetrieb; **Secrets-Hygiene**
   (Token-Rotation dokumentieren, Twilio-Subaccount auf minimale Rechte).
7. **Crash-Hotspots P3 Real-Call-Smoke** (5 Szenarien, HEIKLE STELLE in `bridge.js`) als Gate
   VOR `VOICE_ENGINE=realtime`-Aktivierung.
8. **upstream/Live nachziehen** - origin = lokal = `8d148a8` (in sync, Stand 2026-06-21, "origin
   nachziehen" damit erledigt); ABER upstream/jonas986 = `2ceb344` haengt zurueck, und Render
   deployt von **upstream** ([[deploy-repo-split]]) -> der Live-Stand laeuft HINTER lokal/origin.
   `git push upstream master` noetig (Owner-/Deploy-Entscheidung), sonst gehen lokale Aenderungen nie live.

> Hinweis: Deepgram-STT und Azure-NTTS sind im Telnyx-Account bereits aktiv/abgerechnet -
> das ist KEIN offenes Gate mehr (per Account-Records 2026-06-20 verifiziert).

## 2. Autonome Code-Follow-ups

> Diese Items mit Vorgehen pro Item + Workflow-Einschaetzung (ist phase-impl noetig?):
> siehe **`AUTONOM.md`**.

> **Stand 2026-06-21 (2. Abgleich):** A1, A3, A4 + Rebrand-Track-A sind GEMERGT (origin `8d148a8`,
> 679/679). Offen bleiben hier nur noch A5 (sequenziell) und A2 (in Arbeit).

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

## 3. Bewusst vertagt (nur Tracking, kein akuter Task)

- Allowlist-Lockerung -> Phase 2 / Rechteprofile
- pg-boss als Queue-Backend -> P8 (Stub vorhanden, Default `QUEUE_BACKEND=memory`)
- EU-AI-Act Art. 50(2) maschinenlesbare KI-Markierung -> Compliance-Phase 08/2026
- P8 Scale-Infra (PgBouncer / Read-Replicas / Partitionierung) -> bei echter Last
- P3b-R CP5/CP6 (Metrik-Seam / Breaker-Tuning) -> W4 uebersprungen; **Path B** (undici als Dep
  + expliziter Dispatcher) nur falls "Premature close" unter 0.105 erneut auftritt
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
