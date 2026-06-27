# PLAN-ACCOUNT-BILLING.md — Strategie: Funktionierender Buchungsprozess + Account-Bereich mit Standard-Funktionen

**Stand:** 2026-06-27 · **Status:** Strategie (Analyse-only, KEIN Code) · **Autor:** Session-Investigation (Code-Map + Live-Repro via Chrome + Internet-Recherche SaaS-Standard)

Dieses Dokument konsolidiert und ueberholt die Teil-Plaene `PLAN-ONBOARDING.md` (2026-06-25) und `PLAN-BUCHUNG-PRICING.md` (2026-06-26). Diese beschrieben den Soll-Funnel und einzelne Symptome — aber **keiner wurde gegen das Live-Deployment verifiziert**. Diese Session hat den echten Live-Zustand reproduziert und dabei eine strukturelle Wurzel gefunden, die alle drei vom Owner gemeldeten Symptome erklaert.

> Sprache: bewusst OHNE Umlaute (ue/oe/ae/ss), damit das Dokument 1:1 als `planDoc` von `phase-impl-lean.js` ingestiert werden kann (CLAUDE.md-Konvention). Display-Texte im Produkt duerfen Umlaute haben.

---

## 0. In einem Satz

Der eingeloggte Kunde soll seinen **aktiven Plan, seinen Abo-Status, seine zugewiesene Rufnummer und sein Rest-Kontingent** sehen, seine **Zahlung/Rechnungen/Kuendigung selbst verwalten** koennen, und der Registrierungs- und Buchungs-Flow soll **ohne CSRF-Sackgasse und ohne kaputte API-Aufrufe** durchlaufen — heute scheitert all das an einer einzigen Deployment-Wurzel.

---

## 1. Vom Owner gemeldete Symptome (2026-06-27)

| # | Symptom | Owner-Wortlaut |
|---|---|---|
| S1 | Nach E-Mail-Verifizierung bei der Registrierung -> Fehlerseite | "Ungueltige oder fehlende CSRF-State Pruefung" |
| S2 | Nach Abo-Abschluss kein Hinweis, dass man wirklich eine Nummer hat | "habe keinen hinweis gesehen dass ich wirklich eine nummer habe" |
| S3 | Standard-Account-Funktionen fehlen (aktuelles Abo sehen etc.) | "nicht mal das funktioniert" |

---

## 2. Verifizierte Live-Befunde (diese Session, via Chrome — NICHT geraten)

Reproduziert am 2026-06-27 im echten Chrome gegen die Produktion (ausgeloggt):

1. **`https://vodafone-agent.onrender.com/app` -> `Cannot GET /app`.**
   Der Gateway-Service serviert das Frontend **nicht**. Der Code kann es (single-origin, `src/server.js:329-352`, gegated ueber `WEB_DIST_DIR`) — aber in Produktion ist `WEB_DIST_DIR` **nicht gesetzt**.

2. **`https://sundartha.com/app` -> laedt das Frontend, zeigt aber "Something went wrong".**
   Das Dashboard liegt als **separate statische Site** auf `sundartha.com`.

3. **Der einzige API-Call des Dashboards -> 404.**
   Netzwerk-Trace: `GET https://sundartha.com/api/self-service/state` -> **HTTP 404**.
   Das Frontend (`apps/web/src/lib/api.js:65-83`) nutzt **relative Pfade** (`/api/...`) mit `credentials:"same-origin"` — by design fuer ein **single-origin**-Modell. Auf der statischen Site `sundartha.com` gibt es aber **keine `/api/*`-Routen** (die liegen auf dem Gateway). Also 404, **immer**, egal ob eingeloggt oder nicht.

4. **Falsches Fehler-Mapping verstaerkt das Symptom.**
   `loadAuthState()` (`apps/web/src/lib/api.js:465-477`) mappt nur `401 -> anonym` und `403 -> pending`; **alles andere (inkl. 404) -> ERROR**. Darum sieht der Nutzer das generische "Something went wrong" statt eines sauberen "bitte einloggen".

**Architektur-Diagnose:** Das Produkt ist als **single-origin**-Anwendung programmiert (Frontend + `/api` + `/auth` + Session-Cookie auf EINEM Origin), aber als **zwei getrennte Origins deployt**:

```
sundartha.com            (Render Static Site: nur apps/web/dist, KEIN /api, KEIN /auth)
vodafone-agent.onrender.com  (Node Gateway: /api, /auth, Session-Cookie, aber serviert das Frontend NICHT)
```

`render.yaml:241` leitet nur `/auth/:splat` per **302-Redirect** an den Gateway — `/api/*` wird **gar nicht** weitergeleitet. Damit ist der Bruch strukturell.

---

## 3. Wurzel-Analyse: 3 Symptome -> 1 strukturelle Hauptwurzel + 2 Folgewurzeln

### W1 (Hauptwurzel) — Split-Origin-Deployment bricht das single-origin-Design
- **Erklaert S2 + S3 vollstaendig:** Das Dashboard kann auf `sundartha.com` **niemals** `state` laden (`/api/...` -> 404). Also kein Abo, kein Plan, keine Nummer, kein Kontingent — egal was im Backend-Store steht. "Nicht mal das funktioniert" ist korrekt: es kann strukturell nicht funktionieren.
- **Verstaerkt S1:** Selbst wenn der Login durchlaeuft, faehrt das Session-Cookie (gesetzt auf `vodafone-agent.onrender.com`) bei einem Fetch auf `sundartha.com` nicht mit (anderer Origin). Cross-Origin-Cookies sind zusaetzlich vom Browser-3rd-Party-Cookie-Blocking bedroht.

### W2 (Folgewurzel) — Auth-State/CSRF ueberlebt den E-Mail-Round-Trip nicht
- **Erklaert S1.** Fehlerquelle: `src/web-auth.js:148-154`, String `"Ungueltige oder fehlende CSRF-State-Pruefung"` (`:153`). Der signierte `oauth_state`-Cookie (gesetzt in `/auth/login`, TTL **~10 Min**, `src/web-auth.js:11`) muss vom Login bis zum Callback ueberleben. Bei einer **Registrierung mit E-Mail-Verifizierung** vergeht oft mehr Zeit (Mail oeffnen, Link klicken), und der Link wird ggf. in **anderem Tab/Geraet** geoeffnet -> Cookie fehlt -> 400-Sackgasse. Das ist das in der Recherche dokumentierte Standard-Muster "OAuth-`state`-Verlust ueber Redirect/Tab/Mail".
- **Hypothese, NICHT live bestaetigt:** Ich konnte den Login nicht selbst durchspielen (Eingabe von Passwoertern/Account-Erstellung ist mir verboten). Der exakte Trigger (TTL-Ablauf vs. fehlender Cookie wegen Cross-Origin/Tab) wird in **Phase B** mit eingeloggtem Repro + Server-Log bestaetigt, bevor gefixt wird (CLAUDE.md: "erst Runtime-Output lesen, nie raten").

### W3 (Feature-Luecke) — Standard-Account-Funktionen sind unvollstaendig
Selbst nach W1+W2 fehlen typische SaaS-Account-Funktionen (Recherche, Abschnitt 4): Kuendigung (Self-Service), Plan-Wechsel, Rechnungs-Einsicht, Zahlungsmethoden-Verwaltung, sauberer Post-Checkout-Bestaetigungs-Screen, past_due/SCA-Hinweise, DSGVO-Self-Service-UI.

---

## 4. Soll-Zustand: Standard-Account-/Buchungsbereich (Recherche-gegroundet)

Priorisierte Muss/Soll/Kann-Liste (Quellen: Stripe-Doku Customer Portal / Subscriptions / Checkout-Fulfillment, Auth0/Okta zu OAuth-state, SaaS-Settings-Best-Practices — siehe Recherche-Anhang).

**MUSS (Tier 1 — ohne das nicht launch-faehig):**
1. Login/Signup mit E-Mail-Verifizierung **ohne Sackgasse**; sichere Redirects (single-origin, signierter `state`, kein Verlust ueber Tab/Mail).
2. Aktuelles Abo sichtbar: **Plan + Status-Badge** (`active`/`trialing`/`past_due`/`canceled`) + **naechstes Abrechnungsdatum**.
3. **Zugewiesene Ressource sichtbar**: die Rufnummer prominent ("das hast du jetzt").
4. **Rest-Kontingent**: verbrauchte vs. verbleibende Minuten im Zeitraum.
5. **Post-Checkout-Bestaetigung**: server-seitig verifiziert (`payment_status=paid`), zeigt Nummer + naechsten Schritt; provisioniert NICHT selbst (das macht der Webhook).
6. **Zahlungsmethode + Rechnungen** verwalten (Stripe Customer Portal genuegt).
7. **Kuendigen** (Self-Service, sofort oder zum Periodenende).
8. **Webhook-getriebener Lifecycle, fail-closed**: Provisionierung/Deaktivierung nur ueber signaturgepruefte, idempotente Webhooks — nie ueber den Browser-Redirect.

**SOLL (Tier 2):**
9. Plan **Upgrade/Downgrade** mit korrekter Proration (Upgrade sofort, Downgrade zum Periodenende).
10. **Reactivate** nach Kuendigung; `past_due`/SCA-Banner (`invoice.payment_failed`, `payment_action_required`); `trial_will_end`-Kommunikation; Dunning/Smart-Retries.
11. Welcome-/Onboarding-Mail + In-App-Onboarding-Checkliste.

**KANN (Tier 3):**
12. 2FA, Login-History; Retention-Flow bei Kuendigung; Usage-Charts; mehrere Zahlungsmethoden.

**Architektur-Empfehlung der Recherche (passt 1:1 zum 1-Plan/1-Nummer-Modell):**
**Hybrid** — eigenes Dashboard fuer ressourcenspezifische Anzeige (Nummer + Minuten-Kontingent + Plan-Status), **Stripe Customer Portal** fuer Zahlungsmethode/Rechnungen/Kuendigung/Plan-Wechsel. Minimaler Bauaufwand, maximale Standard-Abdeckung.

---

## 5. Harte Invarianten (unantastbar in JEDER Phase — aus CLAUDE.md)

- **Safety-Gates** (`numberGateError`/`kycGateError`: Allowlist, Denylist/Land/Stundenlimit, Budget global+pro-Tenant, Max-Dauer, Provider-Signatur fail-closed) NIE entfernen/aufweichen. Neue Endpunkte, die Calls/SMS/Geld ausloesen, brauchen dieselben Gates.
- **`PAYMENT_ENABLED` / `PROVISIONING_ENABLED` bleiben DER Gate:** Flag aus = byte-identisches Verhalten; neue Geld-Routen ohne Flag -> 404. Geld immer als Ganzzahl-Cents.
- **Test-Mode in der ganzen Bau-Kette:** kein `sk_live`, kein echter Nummernkauf waehrend der Implementierung (Dry-Run). Echtes Geld = separater Owner-Schritt.
- **Auth fail-closed:** neue Endpunkte standardmaessig hinter Auth; Self-Service hinter `webAuthMw`; timing-sichere Vergleiche; kein PII-/Stripe-Id-Leak in Frontend/MCP (abgeleitete bool/aggregierte Werte).
- **Offenlegungssatz** bei Outbound bleibt fest verdrahtet (nicht Thema dieser Kette, aber nie anfassen).
- **Stack:** ESM, kein Build-Step im Gateway, kein TypeScript, Kommentare deutsch ohne Umlaute; neues Verhalten braucht einen `node:test`-Test (offline, ohne `.env`). Env immer in `src/config.js` + `.env.example` + `render.yaml`.
- **Scope-Disziplin:** NUR die jeweilige Phase. Keine ungefragten Extras. Neue Dependencies nur mit expliziter Spec-Freigabe.

---

## 6. Phasenplan (dependency-geordnet, harte Gates)

Konvention pro Phase: **Ziel · Scope (in/out) · Dateien · Deterministisch erwartetes Ergebnis · Verifikation**. Verifikation IST der Feedback-Loop (Workflow-Regel 7).

> **Gate-Logik:** Phase A ist das Fundament fuer ALLES — ohne single-origin laedt das Dashboard keine Daten, also lassen sich B/C/D nicht ehrlich live verifizieren. A zuerst. B (Auth) und C (Buchung sichtbar) bauen auf A. D (Standard-Funktionen) und E (Lifecycle/DSGVO) danach.

### Phase A — Single-Origin-Deployment herstellen (Fundament; behebt S2+S3 strukturell)
**Owner-kollaborativ** (Deploy/DNS/Env, nicht primaer Code — der Code kann es bereits).
- **Ziel:** Frontend, `/api`, `/auth` und das Session-Cookie laufen unter **EINEM** Origin (der Kunden-Domain).
- **Empfohlener Weg (Option A1):** Den **Gateway** das Astro-Build servieren lassen: `WEB_DIST_DIR=apps/web/dist` setzen, `apps/web` im Gateway-Build bauen (`astro build` mit `PUBLIC_GATEWAY_URL=` relativ/leer, sodass Funnel-Links same-origin werden), Kunden-Domain (`app.sundartha.com` o.ae.) als `customDomain` auf den Gateway-Service mappen, die separate statische Dashboard-Site abschalten/auf Marketing-only reduzieren.
- **Alternative (Option A2):** Split beibehalten, aber `sundartha.com` per **Rewrite** (nicht 302-Redirect) `/api/*` und `/auth/*` auf den Gateway proxien und Cookie-`Domain`/`SameSite=None;Secure` konsistent setzen. **Schlechter** (fragiler bei 3rd-Party-Cookie-Blocking, mehr bewegliche Teile) — nur falls A1 an Render-Static/Domain-Constraints scheitert. **Empfehlung: A1.**
- **Scope OUT:** keine Feature-Aenderung, kein neuer Endpunkt; reine Topologie.
- **Dateien:** `render.yaml` (Build/Env/customDomains/Rewrites), `src/config.js`/`.env.example` (`WEB_DIST_DIR` dokumentieren), `apps/web` Build-Config (PUBLIC_GATEWAY_URL relativ).
- **Erwartet (deterministisch):**
  - `GET https://<domain>/app` wird vom Gateway serviert (kein "Cannot GET /app").
  - `GET https://<domain>/api/self-service/state` **ausgeloggt -> 401** (nicht 404), **eingeloggt -> 200** mit Daten.
  - Netzwerk-Trace zeigt den state-Call **same-origin** (`https://<domain>/api/...`).
- **Verifikation:** `curl -i https://<domain>/api/self-service/state` (erwartet 401, nicht 404) + Chrome-Repro eingeloggt (Dashboard zeigt Daten statt "Something went wrong"). Lokaler Smoke: Gateway mit `WEB_DIST_DIR=apps/web/dist` starten, `/app` + `/api/self-service/state` curlen.

### Phase B — Registrierung/Login ohne CSRF-Sackgasse (behebt S1)
- **Ziel:** Der Signup-mit-E-Mail-Verifizierung-Flow laeuft durch; ein fehlender/abgelaufener `state` ist **kein 400-Dead-End**, sondern startet den Flow sauber neu.
- **Phase-0-Pflicht (zuerst, NICHT raten):** mit eingeloggtem Repro + Server-Log den **exakten** Trigger bestaetigen (TTL-Ablauf vs. fehlender Cookie vs. Cross-Origin-Rest nach A). Erst dann fixen.
- **In:** (1) `state`/PKCE-TTL robust gegen den Mail-Round-Trip (laengeres, aber begrenztes Fenster); (2) `/auth/callback` bei fehlendem `state`/`nonce`/`verifier` -> **302 zurueck nach `/auth/login`** (Flow re-initiieren) mit Erhalt des Ziel-Pfads, statt 400; (3) freundliche Fehlerseite mit "Erneut anmelden"-CTA als Fallback; (4) Cookie-`SameSite`/`Secure`/`Domain` fuer den single-origin-Host korrekt.
- **OUT:** Keine Aufweichung der CSRF-Pruefung selbst — bei vorhandenem, aber **falschem** `state` bleibt es fail-closed (echter Angriff). Nur der **fehlende**/abgelaufene Fall wird zu einem Neustart statt einer Sackgasse.
- **Dateien:** `src/web-auth.js` (TTL, Callback-Recovery, Fehlerseite), ggf. `src/config.js` (TTL-Env).
- **Erwartet:** `node:test`: Callback **ohne** state-Cookie -> 302 nach `/auth/login` (re-initiate); Callback mit **falschem** state -> 400 (fail-closed bleibt); voller frischer Login (Mock-IdP) -> Session + Redirect ins Dashboard.
- **Verifikation:** `npm test` (neue Callback-Tests) + Chrome: echte Registrierung inkl. Mail-Verifizierung laeuft bis ins Dashboard (Owner fuehrt den credential-Schritt, ich verifiziere das Ergebnis).

### Phase C — Buchung sichtbar machen: Post-Checkout-Bestaetigung + Nummer-Anzeige (behebt S2)
- **Ziel:** Nach erfolgreichem Abo sieht der Kunde sofort: "Abo aktiv" + **seine Rufnummer** (oder "wird eingerichtet…" mit Polling, bis provisioniert).
- **Phase-0-Pflicht:** Verifizieren, ob das Auto-Provisioning (Stripe-Webhook -> Nummernkauf) wirklich verdrahtet ist (PLAN-BUCHUNG-PRICING BK3 behauptet es; `src/billing/webhook.js`, `src/billing/activation.js`, `src/billing/provision-trigger.js` lesen) und ob `setTenantSubscription` nach Checkout den Plan im Store setzt. Mit eingeloggtem Repro pruefen, ob der Store nach Buchung wirklich Plan+Nummer haelt (W1 hat das bisher verdeckt).
- **In:** Server-verifizierte Success-Page (`success_url` mit `{CHECKOUT_SESSION_ID}` -> Session laden -> `payment_status==='paid'` pruefen), die Nummer prominent zeigt; Dashboard-Block "Dein Agent" mit Nummer + Status; Polling bis Provisioning fertig.
- **OUT:** kein neues Provisioning-Modell; nur Sichtbarkeit + Bestaetigung. Provisioning bleibt webhook-getrieben.
- **Dateien:** `src/self-service-routes.js` (return/status), `apps/web` (Success-/Dashboard-Komponenten), `apps/web/src/lib/api.js` (Helfer existieren: `agentInfo`, `subscriptionFrom`, `quotaFrom`).
- **Erwartet:** Nach simuliertem aktivem Abo (Test-Mode) zeigt `/app` die Nummer + Plan + "active"-Badge; Success-Page ohne bezahlte Session -> kein "aktiv"-State (fail-closed).
- **Verifikation:** Webhook-/Return-Test (`node:test`, Fake-Billing) + Chrome eingeloggt nach Test-Mode-Buchung.

### Phase D — Standard-Account-Funktionen (das Kern-Ziel "accounts mit standard funktionen")
Sub-Phasen, je ein Lean-Workflow:
- **D1 — Abo-Status-Karte:** Plan + Status-Badge + naechstes Abrechnungsdatum + Rest-Kontingent prominent (Daten sind nach A da; ggf. nur UI). Verifikation: Chrome zeigt korrekten Status pro Lifecycle-Zustand.
- **D2 — Stripe Customer Portal (Hybrid):** `POST /api/self-service/billing/portal` -> `billingPortal.sessions.create` -> Redirect. Deckt **Zahlungsmethode, Rechnungen, Kuendigung, Plan-Wechsel** ab. Gegated ueber `PAYMENT_ENABLED` (Flag aus -> 404). Verifikation: Test-Mode-Portal oeffnet, Kuendigung -> Webhook `subscription.deleted` -> Tenant deaktiviert, Nummer abbestellt.
- **D3 — Profil/Account-Basis:** Name/E-Mail anzeigen, Logout (existiert), klare "abgemeldet"-Zustaende; sauberes 401-Handling (statt "Something went wrong").
- **OUT (Folge-Tickets):** eigene Plan-Wechsel-UI (falls Portal nicht reicht), 2FA.
- **Invarianten:** kein Stripe-Id-Leak; Portal-Session kurzlebig; alle Routen hinter `webAuthMw`.

### Phase E — Lifecycle-Haertung + DSGVO-Self-Service-UI
- **Ziel:** Vollstaendiger, robuster Abo-Lebenszyklus + DSGVO-UI.
- **In:** Webhook-Vollstaendigkeit (`invoice.payment_failed` -> `past_due`-Banner; `subscription.deleted` -> Nummer deaktivieren; `trial_will_end`; `payment_action_required`/SCA-Banner), Idempotenz (verarbeitete Event-Ids), sofort 200 + async. DSGVO-Export/Loeschung als Self-Service-UI (Backend existiert: `exportTenantData`/`eraseTenantData`, Memory I8/P8b — nur UI verdrahten).
- **OUT:** Retention-Coupons, Charts.
- **Verifikation:** `node:test` pro Event (Signatur, Idempotenz, Zustands-Uebergang) + Chrome-Banner-Repro im Test-Mode.

---

## 7. Orchestrierung — Empfehlung (Antwort auf "Agent-Team vs. dynamic workflow")

**Empfehlung: gepinnte Lean-Workflow-Kette (`phase-impl-lean.js`), EIN Workflow pro (Sub-)Phase, duenner Lead, Merge im Lead — NICHT ein einzelner grosser dynamic Workflow und NICHT ein freies Agent-Team.**

Begruendung:
- Jede Phase fasst **Auth oder Billing oder Safety-Gates** an -> automatisch nicht-trivial -> **harter dualer Review-Gate (Safety + Clean-Code, S1/S2 = Blocker)** ist Pflicht. Genau das liefert die etablierte Lean-Kette (Plan -> Impl im Worktree -> dualer Review -> Self-Fix bis PASS -> Report). Diesen Pattern hat das Repo schon vielfach gefahren (I1-I9, Owner-Removal, Pay-Kette).
- Die Phasen sind **sequenziell mit harten Gates** und mit **Live-Verifikations-Schritten, die der Owner mit-anschauen will** (Chrome). Ein einzelner Mega-Workflow, der dutzende Agents fan-out, passt nicht — er nimmt den Owner aus der Schleife und kann Auth/Geld nicht sicher gaten.
- Ausnahme **Phase A**: das ist **Deploy/DNS/Env**, kein Code-Workflow. Die mache ich **interaktiv mit dem Owner** (ich liefere render.yaml/Env-Diff + Verifikations-curl/Chrome; der Owner wendet es im Render-Dashboard an).

Mechanik (wie gehabt): `tasks/account-billing-chain.md` als Driver-Spec (Phase-Specs B/C/D1/D2/D3/E), je ein gepinntes `phase-impl-lean`-Skript, Lead liest nie Code/Diffs, Merge (Stash) im Lead. In **frischer Session** starten.

---

## 8. Owner-Entscheidungen (vor Implementierung zu fixieren — bewusst kurz gehalten)

1. **Single-Origin-Weg (Phase A):** A1 (Gateway serviert alles unter Kunden-Domain — **empfohlen**) oder A2 (Split + Rewrites)?
2. **Kunden-Domain:** `app.sundartha.com` fuer das Produkt, `www.sundartha.com`/`sundartha.com` fuer Marketing? Oder alles unter `sundartha.com`?
3. **Billing-UI-Tiefe:** Stripe Customer Portal fuer Zahlung/Rechnung/Kuendigung/Plan-Wechsel (**empfohlen**, minimaler Bau) — oder eigenes UI bauen?
4. **Kuendigung:** sofort oder zum Periodenende (Default-Empfehlung: zum Periodenende, `cancel_at_period_end`)?
5. **Waehrung final:** Marketing zeigt teils `$`, Stripe-Preise sind EUR (PLAN-BUCHUNG-PRICING 2.2.5). USD oder EUR konsistent? (Memory web-overhaul: "USD" — verifizieren.)
6. **Reichweite jetzt:** Nur Tier-1-Muss bis Launch, oder gleich Tier-2 (Plan-Wechsel/Reactivate/Dunning) mitnehmen?

---

## 9. Pre-Mortem (Risiken — vorab benannt)

- **A1 bricht den Auth-Redirect:** Wenn `redirect_uri`/`PUBLIC_URL` nach dem Domain-Cutover nicht exakt am IdP (WorkOS) hinterlegt sind, scheitert Login mit `redirect_uri_mismatch`. -> Vor Cutover die WorkOS-Redirect-URIs + `PUBLIC_URL`/`PUBLIC_GATEWAY_URL` synchron umstellen; Staging-Check.
- **Cookie-Domain falsch -> alle eingeloggt-Aufrufe 401:** Bei Domain-Wechsel muss das Session-Cookie auf den neuen Host passen. -> Teil der A-Verifikation (eingeloggt -> 200).
- **CSRF-Fix weicht die Sicherung auf:** Wenn Phase B den fehlenden UND den falschen `state` gleich behandelt, oeffnet das ein CSRF-Loch. -> Nur der **fehlende/abgelaufene** Fall wird Neustart; falscher `state` bleibt 400 (Test beweist beides).
- **Provisioning bei Kuendigung nicht zurueckgedreht -> Kosten/Leak:** `subscription.deleted` muss die Nummer deaktivieren, sonst telefoniert ein nicht zahlender Tenant weiter. -> Phase E, fail-closed, idempotent.
- **Doppel-Provisioning bei Webhook-Retry -> doppelte Nummer/Kosten:** -> Idempotenz-Guard (existiert: `tenantHasLiveNumber`, `provision-trigger.js`), in Phase C/E testen.
- **"Live" laeuft auf Owner-Repo (jonas986), nicht origin:** Deploy-Push muss upstream gehen, sonst ist der Fix nicht live (Memory deploy-repo-split). -> bei jedem Deploy beachten.

---

## 10. Quellen-Anhang

- **Code-Map (diese Session):** `apps/web/src/lib/api.js`, `apps/web/src/pages/app/index.astro`, `src/web-auth.js`, `src/self-service-routes.js`, `src/billing/{subscribe,webhook,activation,provision-trigger,stripe,meter}.js`, `src/server.js`, `render.yaml`.
- **Bestehende Plaene (teils ueberholt durch diese Session):** `PLAN-ONBOARDING.md` (Origin-Topologie, Tenant-Bindung), `PLAN-BUCHUNG-PRICING.md` (BK0-BK5: Plan-Katalog, Pricing-Kacheln, Auto-Provisioning, Kontingent), `PLAN-SECURITY.md`, `STATUS.md`.
- **SaaS-Standard-Recherche (extern):** Stripe — Customer Portal (`docs.stripe.com/customer-management`), Subscriptions/Webhooks (`/billing/subscriptions/webhooks`, `/change`, `/prorations`, `/cancel`), Checkout-Fulfillment (`/checkout/fulfillment`, `/payments/checkout/custom-success-page`). OAuth-`state`: Auth0 (`/secure/attack-protection/state-parameters`), Okta (state-parameter-mismatch). SaaS-Settings/DSGVO-Best-Practices (siehe Recherche-Bericht).
- **Live-Repro (diese Session, 2026-06-27, Chrome):** `vodafone-agent.onrender.com/app` -> "Cannot GET /app"; `sundartha.com/app` -> "Something went wrong"; `GET sundartha.com/api/self-service/state` -> **404**.
