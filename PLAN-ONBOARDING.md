# PLAN-ONBOARDING.md — Strategie: End-to-End Registrierung, Payment, Aktivierung & Login

**Stand:** 2026-06-25 · **Status:** Plan (noch nicht umgesetzt) · **Quelle:** Code-Investigation + Council-Synthese (`~/Larry/drafts/2026-06-25_council_unified-signup-login-flow.md`)

Dieses Dokument beschreibt den Ziel-Flow „Kunde registriert sich -> bezahlt -> wird freigeschaltet -> bekommt Nummer -> Agent funktioniert (Web + MCP)" und den Phasen-Plan dorthin. Es ergaenzt `PLAN-SECURITY.md` (Auth/Gates) und `STATUS.md` (offene Punkte).

---

## 1. Kernbefund (eine Wurzel, vier Symptome)

Der gesamte Onboarding-Funnel ist **nie end-to-end verdrahtet**. Ein einziges strukturelles Problem erzeugt alle beobachteten Symptome: Nach dem Signup passiert **nichts mehr** — keine Zahlung, keine Aktivierung, kein Nummernkauf, keine Tenant-Bindung fuer den MCP-Kanal. Dazu kommt eine fragmentierte Branding-/Domain-Topologie (drei fremde Origins im Flow).

| # | Symptom (von Jonas beobachtet) | Wurzel | Evidenz |
|---|---|---|---|
| 1 | URL zeigt WorkOS-Auth statt sundartha.com | `provider=authkit` = **gehostete** AuthKit-Seite auf `api.workos.com` | `src/web-auth.js:224` |
| 2 | Nach Reg landet man auf `vodafone-agent.onrender.com` (fremdes Branding) | Gateway hat **keine** Custom-Domain; `redirect_uri`/Landing = `RENDER_EXTERNAL_URL` | `src/config.js:173`, `src/server.js:180`, `render.yaml` (kein `customDomains`) |
| 3 | "Kein Tenant fuer diese Identitaet" (MCP-Call abgewiesen) | Tenant wird **nur** beim Web-Login gebunden (`idp_subject=sub`); MCP kann keinen Tenant anlegen, nur nachschlagen | `src/server.js:970`, `src/web-auth.js:282`, `src/store/state-ops.js:1149` |
| 4 | Signup fragt nichts ab, keine Nummer gekauft, Abo/Zahlung fehlt | Kein Stripe-Redirect nach Signup; `PAYMENT_ENABLED=false` + `PROVISIONING_ENABLED=false` default; `kycLevel` wird nie gesetzt | `src/config.js:108`, `src/config.js:223`, `src/server.js:1360-1368`, `src/store/state-ops.js:613-618` |

**Fazit:** Symptome 3 + 4 sind **Correctness-Bugs, die heute schon kaputt sind** (nicht Kosmetik). Symptome 1 + 2 sind Branding/Trust und billiger zu fixen. Das Dokument behandelt beide Achsen getrennt, weil sie unterschiedliches Risiko tragen.

---

## 2. Ist-Zustand (verifiziert)

### 2.1 Branding/Domain-Topologie — drei Origins

Zwei getrennte Render-Services, zwei `onrender.com`-Origins, plus WorkOS dazwischen:

```
sundartha.com (NICHT live)
  hermes-web.onrender.com   (Astro Static, "Sundartha"-Branding)
        | Klick "Log in"
        v
  vodafone-agent.onrender.com/auth/login   (Node Gateway)
        | 302
        v
  api.workos.com/user_management/authorize?provider=authkit   (WorkOS-gehostete Login-Seite)
        | callback
        v
  vodafone-agent.onrender.com/auth/callback -> /tenant.html   ("Hermes — Mein Bereich")
```

Der Nutzer durchlaeuft **bis zu drei fremde Brandings/URLs**. Keine Custom-Domain ist gemappt (`render.yaml` hat fuer beide Services kein `customDomains`; Track B in `STATUS.md` offen). `apps/web/src/lib/routes.js` baut `LOGIN_URL` aus `PUBLIC_GATEWAY_URL` (= `https://vodafone-agent.onrender.com`).

### 2.2 Login + Tenant-Bindung — "Kein Tenant fuer diese Identitaet"

- Tenant wird **ausschliesslich** beim Web-Login angelegt: `upsertOnFirstLogin` (`src/web-auth.js:282`) macht `INSERT tenant (..., status 'suspended', idp_subject=sub)`. `idp_subject = sub` ist die Bruecke zwischen Web-Login und MCP-Kanal.
- MCP/REST loest den Tenant nur **lesend** auf: `resolveTenant(sub)` sucht `tenant.idpSubject === sub` (`src/store/state-ops.js:1149`). Kein Treffer -> `TENANT_REJECT` -> `403 "Kein Tenant fuer diese Identitaet."` (`src/server.js:970`).
- **Praezise Fehlbedingung:** Eine MCP-Identitaet (gueltiges OAuth-JWT) ohne vorherigen erfolgreichen Web-Login hat keinen Tenant -> Reject. Da der Web-Login bis vor kurzem an **Bug A** (WorkOS `application_not_found`) scheiterte, lief `upsertOnFirstLogin` nie -> MCP findet nichts.
- **Zusaetzliche Inkonsistenz im Datenmodell:** Es existieren **zwei** Tenant-Erzeugungspfade mit unterschiedlichem Status und ID-Schema:
  - `upsertOnFirstLogin` -> `id = t_<sub>`, `status='suspended'`, `idp_subject` gesetzt (Web-Login).
  - `registerTenant` (`src/store/state-ops.js:573`) -> `id = tenantId` (E-Mail-artig), `status=ACTIVE`, `idp_subject` **nicht** gesetzt (`/api/onboard`-Formular).
  - Folge: Der via Formular angelegte ACTIVE-Tenant ist fuer MCP **unauffindbar** (kein `idp_subject`), der via Login angelegte ist `suspended`. Die Identitaet ist nicht kanonisch.

### 2.3 Payment -> Aktivierung -> KYC -> Provisioning — die Kette reisst an jeder Naht

Soll: Signup -> Stripe-Checkout -> Zahlung -> Aktivierung -> KYC -> Nummer kaufen -> Agent nutzbar. Ist:

| Schritt | Soll | Ist | Evidenz |
|---|---|---|---|
| Signup | Tenant anlegen | OK (Tenant entsteht) | `src/server.js:1284` |
| **-> Stripe-Checkout-Redirect** | nach Signup zu Stripe | **FEHLT** — `/api/onboard` redirected nie; Checkout-Route existiert, ist aber nur manuell ("Zahlungsmethode hinzufuegen") | `src/server.js:1360-1368`, `src/server.js:1230-1249` |
| **-> Payment aktiv** | Hold/Capture | **DISABLED by default** (`PAYMENT_ENABLED=false`) | `src/config.js:108` |
| **-> Nummer kaufen** | echter Provider-Order | **DISABLED by default** (`PROVISIONING_ENABLED=false`); Nummer bleibt `requested` | `src/config.js:223`, `src/server.js:1360-1368` |
| **-> kycLevel setzen** | auf Payment-Erfolg | **NIE gesetzt** im Signup-Flow; Stripe-Webhook setzt Subscription, aber **nicht** `kycLevel` | `src/billing/webhook.js:130-150` |
| **-> Outbound-Call erlaubt** | Gate offen | **BLOCKIERT**: `tenantActiveSubscriber` verlangt `status=ACTIVE` **und** `kycLevel >= CARD` | `src/server.js:472`, `src/store/state-ops.js:613-618` |

Das W5-Gate (`src/server.js:472`, Commit `10193c1`) ist korrekt fail-closed implementiert — aber es haengt an einer Aktivierung (`kycLevel`), die der Funnel nie herstellt. Selbst mit funktionierendem Login bleibt der Tenant `suspended`/ohne KYC.

### 2.4 Dashboard-Inhalt

`public/tenant.html` rendert (in Reihenfolge): Header mit Agent-Nummer-Chip (`:107-113`, **behalten**), Zugang (**behalten**), Einstellungen inkl. **Begruessung**-Dropdown (`:136`, **raus**), **Kalender** (`:151-156`, **raus**), Zahlungsmethode (behalten, payment-gated), **Anrufe** (`:178-183`, **behalten**), **Action Items** (`:185-189`, **raus**). Daten aus `GET /api/self-service/state` (`src/self-service-routes.js:63-84`).

---

## 3. Soll-Zustand (Ziel-Flow)

Ein durchgehender Flow, alles unter `sundartha.com`-Origins, kein sichtbarer `onrender.com`/`workos.com`-Sprung:

```
sundartha.com (Marketing)
   -> "Jetzt starten" / Abo waehlen
   -> auth.sundartha.com   (WorkOS Custom-Domain: Registrierung Vor-/Nachname/E-Mail)
   -> app.sundartha.com/checkout   (Stripe Checkout: Abo z.B. 5 €)
   -> Zahlung erfolgreich (Stripe-Webhook)
        -> Tenant AKTIV + kycLevel=CARD + Subscription gesetzt
        -> Nummer wird automatisch provisioniert (Hold/Capture)
   -> app.sundartha.com   ("Mein Account": NUR zugeteilte Nummer + letzte Anrufe)
   -> MCP-Connector (Claude) findet denselben Tenant ueber idp_subject -> Calls erlaubt
```

Kerneigenschaften:
- **Eine kanonische Identitaet** (`idp_subject = WorkOS sub`) fuer Web **und** MCP — ein Tenant-Record, ein Status-Lebenszyklus.
- **Payment-gated Aktivierung**: Nummer entsteht erst nach Zahlung (Council-Konsens: provision on payment, nicht on signup — vermeidet ~1-2 € Kosten pro Karteileiche).
- **Vor-/Nachname** als Teil der Registrierung persistiert (Feld existiert bereits: `tenant.firstName`/`ownerName`).
- **Dashboard** minimal: Nummer + letzte Anrufe.

---

## 4. Architektur-Entscheidungen (aus Council, 5/5 + Chairman)

| Frage | Entscheidung | Begruendung |
|---|---|---|
| Domain-Topologie | **Custom-Domains auf bestehende Services**, KEIN Merge, KEIN Reverse-Proxy: `sundartha.com`->hermes-web, `app.sundartha.com`->Gateway | Merge kostet Wochen fuer null Trust-Gewinn; Subdomain ist reversibel (DNS loeschen = Rollback) |
| Login-UI | **WorkOS AuthKit Custom-Domain** (`auth.sundartha.com`), KEIN self-hosted Formular | Self-hosted Auth = massive neue Angriffsflaeche (Password-Hashing/Rate-Limiting/Brute-Force), widerspricht fail-closed-Gebot |
| Dashboard | **`public/tenant.html` restylen** (Sundartha-Look), NICHT in Astro ziehen | Eigenstaendig, billig, kein Stack-Merge |
| Provisioning-Timing | **on Payment**, nicht on Signup | Kosten-Gate oben im Funnel sonst strukturell teuer (Churn vor Billing) |
| Reihenfolge | Correctness zuerst, dann reversible Optik/Routing, Irreversibles (WorkOS-Tier, echtes Provisioning) hinter Gate | Failure-Surface minimieren; nichts Irreversibles auf ungepruefter Annahme |

---

## 5. Phasen-Plan

Legende Owner: **C** = Claude (Code, im Repo) · **J** = Jonas (WorkOS-Dashboard, DNS, Render, Stripe — Claude kann das NICHT). Reihenfolge nach Risiko/Reversibilitaet.

### Phase 0 — Tenant-Identitaet vereinheitlichen (Blocker, Correctness) · Owner: C
**Ziel:** "Kein Tenant"-Bug beheben, eine kanonische Identitaet fuer Web + MCP.
- Tenant-Erzeugung konsolidieren: **ein** Pfad, `idp_subject = sub` immer gesetzt, ein konsistentes ID-Schema und Status-Default. Die Divergenz `upsertOnFirstLogin` (suspended/`t_<sub>`) vs `registerTenant` (active/`<email>`, ohne idp_subject) aufloesen.
- `/api/onboard` an die kanonische Identitaet binden (Name auf den per Login erzeugten Tenant schreiben, statt zweiten Record anzulegen).
- **Test (Pflicht):** Web-Login-`sub` und MCP-`sub` derselben Person loesen auf **denselben** Tenant auf; MCP-Call ohne abgeschlossenes Onboarding gibt klare, dokumentierte Ablehnung (kein stiller 403).
- **Verifikation:** `npm test`; lokaler Smoke (`SKIP_TWILIO_SIGNATURE_CHECK=true`, `curl` `/api/calls` mit/ohne Tenant).
- **Vorbedingung:** Web-Login muss live funktionieren (Bug A — WorkOS `OIDC_CLIENT_ID`/Secret korrekt, redirect_uri registriert). **J** muss bestaetigen, dass der WorkOS-Fix deployed ist, sonst ist Phase 0 nicht verifizierbar.

### Phase 1 — Dashboard-Cleanup + Sundartha-Styling (reversibel) · Owner: C
- `public/tenant.html`: Begruessung-Dropdown (`:136`), Kalender-Card (`:151-156`), Action-Items-Card (`:185-189`) entfernen. Nummer-Chip + Anrufe behalten.
- Optional `/api/self-service/state` (`src/self-service-routes.js:63-84`) entschlacken (calendar/actionItems/greeting nicht mehr ausliefern).
- Sundartha-Farben/Schrift inline angleichen (Brand-Konsistenz zum Marketing).
- **Verifikation:** Smoke-Render, `npm test`. Reiner Frontend-Schnitt, kein Auth-/Gate-Risiko.

### Phase 2 — Domain-Cutover (schwer reversibel, J-lastig) · Owner: J (+ C fuer Config)
**Verify-first Gate:** **J** prueft im WorkOS-Dashboard, ob **Custom-Domain im aktuellen Plan-Tier** enthalten ist. Wenn nein -> Phase 2b (auth.sundartha.com) entfaellt/verschiebt, Rest laeuft trotzdem.
- 2a: Render Custom-Domain `app.sundartha.com` -> Gateway-Service; DNS CNAME. **Atomar** WorkOS `redirect_uri` auf `https://app.sundartha.com/auth/callback` nachziehen (sonst HTTP-400-Login-Bruch) und `PUBLIC_URL`/`PUBLIC_GATEWAY_URL` am Service setzen.
- 2b: WorkOS AuthKit Custom-Domain `auth.sundartha.com` aktivieren + DNS. Danach kein `api.workos.com` mehr sichtbar.
- 2c: `sundartha.com` -> hermes-web Custom-Domain; Marketing-Links auf `app.sundartha.com` umstellen.
- **Achtung Deploy-Gotcha:** hermes-web `autoDeploy:false` + render.yaml nicht als living Blueprint — Env/Routes propagieren nicht beim Push (siehe `STATUS.md`/Memory). Aenderungen via Render-Dashboard/Blueprint-Sync.
- **Rollback:** DNS-Record + redirect_uri zuruecksetzen (Minuten). Pre-Mortem-Test vor Cutover (siehe §6).

### Phase 3 — Payment -> Aktivierung -> Provisioning verdrahten (Funktions-Kern) · Owner: C (Code) + J (Stripe/Env)
**Das ist der eigentliche „funktioniert von vorne bis hinten gar nichts"-Fix.**
- Signup-Flow: nach Registrierung **Stripe-Checkout-Redirect** (Abo waehlen) in den Flow ziehen — nicht als manueller Button.
- Stripe-Webhook (`src/billing/webhook.js`) so erweitern, dass Payment-Erfolg **alle drei** Effekte ausloest: `status=ACTIVE` **und** `kycLevel=CARD` setzen **und** Provisioning anstossen. (Heute fehlt das `kycLevel`-Setzen — ohne das bleibt das W5-Gate zu.)
- Provisioning erst **nach** Capture (Hold/Capture-Chain in `src/onboarding.js:42-140` ist vorhanden).
- `PAYMENT_ENABLED=true` als Env (J, Render) — mit Stripe-Keys als Secrets.
- **Safety/Pre-Mortem:** Budget-Gates, Offenlegungssatz, Signaturpruefung unangetastet. Idempotenz der Webhook-Verarbeitung pruefen (kein Doppel-Provisioning bei Webhook-Retries).
- **Verifikation:** Stripe-Testmodus end-to-end (Test-Karte -> Webhook -> Tenant active + kyc=CARD + Nummer-State). `npm test` mit Webhook-Fixture.

### Phase 4 — Provisioning Go-Live (echte Kosten) · Owner: J-Gate + C
- `PROVISIONING_ENABLED=true` erst nach explizitem Jonas-OK — loest **echte Nummern-Kaeufe** aus (Kosten).
- Erst nach Phase 3 grün (Payment-gated), damit nie eine Nummer ohne Zahlung gekauft wird.
- Owner-Number-Seed/Bootstrap-Pfad gegenpruefen (Eigentuemer-Tenant darf nicht versehentlich provisionieren).

---

## 6. Pre-Mortem (ein Jahr spaeter, es ging schief)

| Szenario | Ursache | Gegenmassnahme |
|---|---|---|
| Alle Nutzer aus dem Login geworfen (HTTP 400) | `redirect_uri` nach Domain-Cutover nicht atomar mit DNS nachgezogen | Phase 2a redirect_uri + DNS in einem Wartungsfenster; vorher Staging-Test; Rollback-Runbook |
| Kosten explodieren | `PROVISIONING_ENABLED=true` ohne Payment-Gate -> Nummern fuer Karteileichen | Phase 4 strikt nach Phase 3; provision **nur** on Payment-Capture; pro-Tenant + globaler Budget-Guard bleibt |
| Doppel-Provisioning / Doppelbelastung | Stripe-Webhook-Retry nicht idempotent | Idempotency-Key auf Webhook + Provisioning-Job (vorhanden: `provision_<numberId>`) verifizieren |
| MCP weiter "Kein Tenant" trotz Login | Zwei Tenant-Records (suspended vs active) nicht vereinheitlicht | Phase 0 zuerst; Test der Identitaets-Aufloesung Web==MCP |
| WorkOS-Ausfall = kompletter Login-Ausfall | Single Point of Failure, bei Custom-Domain unveraendert | Bewusst akzeptiertes Risiko dokumentieren; Status-/Error-Page mit Recovery-Hinweis |
| Custom-Domain nicht im WorkOS-Tier | Enterprise-Pricing-Annahme | Verify-first Gate (Phase 2) vor jeder redirect_uri-Aenderung |
| Leeres Dashboard wirkt "kaputt" | Nummer/Anrufe erscheinen nicht zuverlaessig | Webhook-Delivery + Tenant-Resolution + Persistenz vor Phase 1-Launch pruefen; Empty-State-Text ("Nummer wird eingerichtet …") |

---

## 7. Entscheidungen (von Jonas geklaert, 2026-06-25)

1. **WorkOS Custom-Domain (`auth.sundartha.com`):** braucht Plan-Upgrade -> **deferred**, vorerst unwichtig. Wichtig: `app.sundartha.com` aufs Gateway braucht **kein** WorkOS-Upgrade (nur DNS + Render + `redirect_uri`) und entfernt den `onrender.com`-Sprung bereits.
2. **Abo-Modell:** zwei Plaene, bereits in Stripe hinterlegt — **Starter 4,99 €** und **Business 9,99 €** (slugs `starter`/`business`).
3. **Nummer-Land:** **per IP-Geo automatisch** (vor wenigen Tagen gebaut) — Land aus IP erkennen, dann beim Provider die passende Nummer kaufen. Nicht fix DE.
4. **Nummer-Timing:** Kauf **erst nach bezahltem Abo** (Payment-gated, deckt sich mit Phase 3/Council).
5. **Web-Login:** **funktioniert bereits live** -> Phase-0-Vorbedingung erfuellt.
6. **Ausfuehrung:** phasenweise in separaten Sessions (Template-getrieben), nicht in einem Rutsch.
7. **Provider:** **Telnyx** fuer Nummern (ist bereits Provisioning-Default, `src/telephony/registry.js:43`).
8. **Plan -> Nummer:** **beide** Plaene berechtigen zur Nummer (kein plan-basiertes Gate im Code); Freischaltung haengt an Payment -> `kycLevel=CARD`, nicht am Plan. Unterschied starter/business = Preis/Limits.

---

## 8. Autonomie-Matrix (Claude vs Jonas)

Code aller Phasen ist Claude-autonom (schreiben + Tests + lokaler Smoke). **Nicht** autonom ist alles ausserhalb des Repos: DNS, Render-Dashboard/Deploy, WorkOS-Dashboard, Stripe-Dashboard/Secrets, Env-Flag-Flips (Geld-Gates), finale Live-Tests.

| Phase | Claude autonom | Braucht Jonas (Claude kann NICHT) |
|---|---|---|
| P0 Tenant-Unify | Code + Tests + lokaler Smoke | 1× echter Login zur Live-Verifikation (Web-Login laeuft bereits) |
| P1 Dashboard | Komplett (`public/tenant.html`) | Push/Deploy (manual-push-Protokoll) |
| P2 Domains | config/env-Plumbing, `render.yaml`-Eintraege | DNS-Records, Render Custom-Domain, WorkOS `redirect_uri`-Update; `auth.sundartha.com` zusaetzlich Plan-Upgrade |
| P3 Payment-Kette | Code (Checkout-Redirect, Webhook active+KYC+provision), `.env.example` | Stripe Price-IDs (`starter`/`business`) + Webhook-Secret als Render-Secrets, Webhook-Endpoint in Stripe registrieren, `PAYMENT_ENABLED=true` |
| P4 Provisioning-Live | Code-Gates fertig | `PROVISIONING_ENABLED=true` (echtes Geld), Provider-Live-Credentials, finale Test-Zahlung |

**Fazit:** Kein Schritt ist end-to-end ohne Jonas live-fähig — harte Uebergaben bei P2 (DNS), P3 (Stripe-Secrets), P4 (Geld-Flag). P0 + P1 sind mit minimalem Jonas-Aufwand spielbar.

## 9. Handoff — Frontload fuer autonome Ausfuehrung

Ziel: nach diesem Block zieht eine dedizierte Template-Session P0–P3 ohne Jonas-Wartezeit durch. Provider = **Telnyx**. Alle Pfade/Namen aus Code verifiziert (2026-06-25).

### 9.1 Einmalige Browser-/Konsolen-Aktionen (NUR Jonas — Claude kann kein DNS/OAuth/Dashboard)

| # | Aktion | Detail | Phase |
|---|---|---|---|
| 1 | DNS CNAME | `app.sundartha.com` -> Gateway-Service `vodafone-agent` (Frankfurt) | P2 |
| 2 | Render Custom-Domain | `app.sundartha.com` an Service `vodafone-agent` (`srv-d8m0fhflk1mc73bno570`) haengen | P2 |
| 3 | WorkOS redirect_uri | `https://app.sundartha.com/auth/callback` registrieren (zusaetzlich zur onrender-URL — sonst Login-Bruch beim Cutover) | P2 |
| 4 | Stripe Webhook | Endpoint `https://app.sundartha.com/webhooks/stripe`; Events `customer.subscription.*` | P3 |
| 5 | (spaeter) WorkOS Custom-Domain | `auth.sundartha.com` — braucht Plan-Upgrade, deferred | — |

1–3 koennen JETZT erledigt werden; `app.sundartha.com` braucht **kein** WorkOS-Upgrade. 4 erst sinnvoll, wenn 1–2 live (Domain muss erreichbar sein; Webhook gibt 404 solange `PAYMENT_ENABLED=false`).

### 9.2 Env-Vars — wer setzt was

**Secrets — Jonas traegt sie DIREKT in Render ein (`sync:false`, NIE in den Chat — Sicherheitsregel #4):**

| Env | Zweck | config.js |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe API (`sk_…`) | :109 |
| `STRIPE_WEBHOOK_SECRET` | Webhook-Signaturpruefung (`whsec_…`) | :138 |
| `STRIPE_STARTER_PRICE_ID` | Price-ID Starter 4,99 € (`price_…`) | :134 |
| `STRIPE_BUSINESS_PRICE_ID` | Price-ID Business 9,99 € (`price_…`) | :135 |
| `TELNYX_API_KEY` | Telnyx API (Nummernkauf) | :93 |
| `TELNYX_PUBLIC_KEY` | Ed25519 Webhook-Verify | :94 |
| `TELNYX_CONNECTION_ID` | TeXML Connection (Outbound) | :99 |
| `TELNYX_ACCOUNT_SID` | Telnyx Account (Hangup) | :102 |

(`STRIPE_PUBLISHABLE_KEY` wird im Code NICHT genutzt -> unnoetig. `STRIPE_API_BASE`/`TELNYX_API_BASE` haben Defaults.)

**Non-Secret — Claude setzt via Render-MCP (kein Jonas noetig):**

| Env | Wert | Wann |
|---|---|---|
| `PUBLIC_URL` | `https://app.sundartha.com` | nach DNS/Domain live (P2); baut `redirect_uri` = `publicUrl + /auth/callback` (server.js:180) |
| `PAYMENT_ENABLED` | `true` | nach P3-Code + Stripe-Secrets, im Stripe-Testmodus verifiziert |
| `PROVISIONING_ENABLED` | `true` | P4, nach gruenem Test + Geld-Freigabe |

Auf hermes-web zusaetzlich `PUBLIC_GATEWAY_URL=https://app.sundartha.com` (Rebuild noetig, Jonas/Dashboard wegen `autoDeploy:false`).

### 9.3 Code-Luecke, die P3 schliessen MUSS (Claude, autonom)

`setTenantSubscription` (state-ops.js:668) speichert `planSlug`, ruft aber **kein** `setKycLevel` — nach Zahlung bleibt `kycLevel=null`, das Outbound-Gate (`KYC>=CARD`, state-ops.js:613) bleibt zu. **P3-Code:** Stripe-Webhook (`/webhooks/stripe`, server.js:243, Event `customer.subscription.updated`) muss bei Payment-Erfolg atomar: `status=active` **+ `setKycLevel(CARD)` + Provisioning anstossen** (Telnyx, nach Capture). Das ist der Kern-Fix gegen „Signup macht nichts".

### 9.4 Vorab-Freigaben (Jonas ankreuzen — damit Claude nicht wartet)

- [ ] Claude darf `PAYMENT_ENABLED=true` per Render-MCP setzen, sobald P3 im Stripe-**Testmodus** gruen.
- [ ] Claude darf `PROVISIONING_ENABLED=true` setzen (echtes Geld): JA / nur nach Rueckfrage.
- [ ] Push/Deploy generell freigegeben fuers autonome Durchziehen: JA / pro Phase.

---

## 10. Verweise

- Council-Protokoll: `~/Larry/drafts/2026-06-25_council_unified-signup-login-flow.md`
- Auth/Gates-Plan: `PLAN-SECURITY.md` · Offene Punkte: `STATUS.md`
- Bug A (WorkOS `application_not_found`) + Bug B (Funnel 404): Git-History `7fff876`, `b560ff7`, `b661fd1`; Memory `bug-a-workos-um-login`, `bug-b-login-funnel-404`, `hermes-web-deploy-gotchas`.
- W5-Gate (Allowlist an Abo+KYC): Commit `10193c1`.
