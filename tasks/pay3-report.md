# Pay3 — tenant.html Karten-UI (Checkout-Redirect)

**Status:** Gate = **PASS** (kein Blocker)
**finalBranch:** `phase/pay3-card-ui`
**Commit:** `014bf2b72db6df891340e10e7ff0fa71799444ee`
**Tests:** 704/704 gruen (fail 0); +7 Pay3-Tests (g1-g7) + 1 Flag-Gate-Assert
**Dependencies:** keine neue npm-Dependency
**Smoke:** PASS (Boot + Gates + UI-Markup bestaetigt; voller Stripe-Checkout-Flow = Owner-Smoke/Pay4)

---

## 1. Plan (gekuerzt)

Ziel: Im Self-Service-Dashboard (`public/tenant.html`) ein Karten-UI mit Checkout-Redirect, damit ein Tenant seine Zahlungsmethode selbst hinterlegen kann.

### Load-bearing Architektur-Entscheidung (Pre-Mortem)

Die Spec ("Button -> `POST /api/billing/setup-checkout`", "`checkout-return` auf 302 umstellen") beschreibt die **Pay1-Admin-Routen**. Diese resolven den Tenant ueber `requireTenant`/`requestTenant`, das `req.tenant` (Web-Session) nur dann liest, wenn `webAuthMw` zuvor lief. Die Pay1-Routen liegen aber ausserhalb des Web-Login-Blocks und haben kein `webAuthMw`.

Pre-Mortem (1 Jahr spaeter, Entscheidung war falsch): Ein remote-Tenant klickt "Karte hinzufuegen". Der POST traegt nur das Session-Cookie. `webAuthMw` laeuft auf `/api/billing/*` nicht -> `req.tenant` unset -> `requestTenant` faellt auf `OWNER_TENANT_ID` zurueck. **Folge: der Tenant bindet seine Karte an den OWNER-Customer** (cross-tenant-Bindung, Geld-Sicherheits-Defekt R4 — exakt die in I9 dokumentierte "Remote-Browser-OAuth funktioniert noch nicht"-Luecke).

Konsequenz (fail-closed, kleinster Blast-Radius): Die Karten-Aktionen des Tenants laufen ueber die **Web-Session-Identitaet** als **zwei neue Routen in `makeSelfServiceRoutes`** hinter `webAuthMw` und zusaetzlich gegated durch `config.paymentEnabled` (404). Die Pay1-Admin-Routen bleiben **byte-identisch** (Admin-/localhost-Pfad). Der Spec-Punkt "302-Umstellung" erfolgt sauber auf der **neuen** Self-Service-Return-Route (`302 -> /tenant.html?card=ok`), nicht auf der Admin-Route.

Dies war der einzige nennenswerte Freiheitsgrad; alles andere folgt zwingend.

### Edits (geplant)

- **`src/self-service-routes.js`** — Factory um `config` + `billing` erweitern (bleibt EIN Objekt-Argument); zwei neue Routen `POST /api/self-service/billing/setup-checkout` (liefert Stripe-URL) und `GET /api/self-service/billing/return` (302 in die UI); `hasCard` additiv in der `/state`-View (abgeleiteter Boolean, KEIN id-Leak), nur bei `paymentEnabled`.
- **`src/self-service.js`** — `hasCardOnFile(stripe)`-Praedikat (IO-frei, eine Quelle der Ableitung; Karte gilt als hinterlegt, sobald `paymentMethodId` gesetzt).
- **`src/server.js`** — Factory-Aufruf um `config` und `billing: stripeBilling` erweitern; Pay1-Admin-Routen unveraendert.
- **`public/tenant.html`** — datengesteuerte Karten-Card (sichtbar nur wenn `hasCard` ein Boolean ist = Flag an); Button-Handler (Redirect zu Stripe-Checkout); `?card=ok|canceled`-Rueckmeldung nach Rueckkehr.
- **Tests** — `i9-self-service.test.js` mit Fake-Billing (in-process, kein Netz) + Fake-Config um ~7 Pay3-Faelle erweitern; `request()`-Helper liefert `location`-Header; `self-service-flag-gate.test.js` +1 Assert.

### Bedingter Folge-Schritt (im Plan offengelassen)

Customer-Idempotenz + Customer-Match-Invariante existieren bereits in den Pay1-Routen. Ob diese ~6 Zeilen in einen gemeinsamen `billing`-Helfer (`ensureCustomer` / `bindCardFromSession`) extrahiert werden, sollte der Implementierer anhand des Clean-Code-Audits entscheiden — empfohlene Default-Linie: extrahieren, weil die Geld-Sicherheits-Invariante (Customer-Match, R4) an EINER Stelle leben sollte.

### Invarianten (vor Merge)

PAYMENT_ENABLED = DER Gate (Flag aus = byte-identisch); Auth fail-closed (webAuthMw -> 401/403); Money-Safety/cross-tenant R4 (Identitaet = `req.tenant.tenantId`, nie Owner-Fallback; Customer-Match fail-closed 403); keine Secret-/id-Leaks (nur `hasCard` Boolean); Disclosure/Safety-Gates unberuehrt; keine neue Dependency; ESM, kein Build-Step; deutsche Kommentare ohne Umlaute.

---

## 2. Implementierungs-Zusammenfassung

Pay3 vollstaendig gemaess Plan umgesetzt:

- **Zwei neue Self-Service-Billing-Routen** hinter `webAuthMw` + `PAYMENT_ENABLED`:
  - `POST /api/self-service/billing/setup-checkout` — legt Customer idempotent an, liefert Stripe-Checkout-URL.
  - `GET /api/self-service/billing/return` — bindet `payment_method` fail-closed an den eigenen Customer und antwortet mit **302 -> `/tenant.html?card=ok`**.
- **Identitaet = `req.tenant.tenantId`** (Web-Session), nie Owner-Fallback -> remote-Tenant bindet seine Karte fail-closed an SEINEN Customer (R4).
- **`hasCardOnFile`-Praedikat** + `hasCard` im `/state` nur bei Flag an; kein `cus_`/`pm_`-Leak (nur Boolean).
- **`public/tenant.html`** — datengesteuerte Karten-Card (`renderBilling`), Redirect zu Stripe, `?card`-Rueckmeldung (`showCardReturn`).
- **Customer-Idempotenz + Customer-Match-Invariante** in neuer Datei `src/billing/card-setup.js` (`ensureCustomer` + `bindCardFromSession`) geteilt; **Pay1-Admin-Routen byte-identisch darauf refaktoriert** (alle 10 Pay1-Tests gruen).

Dateien:
- Neu: `src/billing/card-setup.js`
- Geaendert: `src/self-service-routes.js`, `src/self-service.js`, `src/server.js`, `public/tenant.html`, `test/i9-self-service.test.js`, `test/self-service-flag-gate.test.js`

Verifikation: `node --check` auf allen 4 geaenderten Quelldateien OK; 704/704 Tests gruen; `package.json`/`package-lock` unveraendert. Smoke: Server bootet (PORT=3997, MULTI_TENANT+SELF_SERVICE an), `/healthz` 200, `GET /tenant.html` 200 mit vorhandenem `billingCard`-Markup, `POST /api/self-service/billing/setup-checkout` -> 404 auf json-Backend ohne Web-Login (Wiring-Gate bestaetigt), `POST /api/billing/setup-checkout` mit PAYMENT_ENABLED aus -> 404 (Gate bestaetigt).

### Deviations

1. **Plan-Empfehlung umgesetzt (nicht nur bedingt):** Die Customer-Idempotenz/Match-Logik wurde in `src/billing/card-setup.js` extrahiert UND die Pay1-Admin-Routen darauf refaktoriert (Verhalten byte-identisch). Der Plan liess das als bedingten Folge-Schritt offen; gewaehlt wurde die empfohlene Default-Linie, weil die Geld-Sicherheits-Invariante (Customer-Match, R4) sonst an zwei Stellen gelebt haette (S2-Risiko).
2. **`hasCard` per bedingtem Spread** (`...(config.paymentEnabled ? { hasCard: ... } : {})`) statt als immer vorhandenes Feld. So FEHLT das Feld bei Flag aus komplett (`typeof !== "boolean"`), was die UI-Logik (`renderBilling` versteckt den Block) und der Byte-Identitaets-Test (g7) erwarten — exakt die geplante UI-Semantik, nur sauberer als ein `false`-Wert.
3. **Billing-Card in `tenant.html` als `c12`** (volle Breite) nach der Calendar-Card platziert (Plan: "nach Settings, z.B. c6"). `c12` bricht das 6/6-Layout nicht. Reine Optik, kein Verhaltensunterschied.

---

## 3. Safety-Urteil

**APPROVED.** Tests laufen unabhaengig gruen; Safety-Gates intakt; Disclosure intakt; Auth fail-closed; keine Secrets geleakt; Verhalten wie beabsichtigt; Scope respektiert (7 Dateien, alle Pay3, kein Drive-by, keine neue npm-Dependency).

Kernpunkte:
- **SAFETY-GATES:** kein Gate-Code beruehrt (`numberGateError`/Allowlist/Denylist/Budget/KYC/`placeHold`/`capture`/Provisioning unveraendert). Die neuen Endpunkte bewegen KEIN Geld (`createSetupCheckoutSession` mode:setup), loesen keinen Call/SMS/Charge aus.
- **DISCLOSURE:** `claude.js` + `bridge.js` byte-identisch unberuehrt.
- **AUTH FAIL-CLOSED:** beide neuen Routen hinter `webAuthMw` (401 ohne Session g5, 403 suspendiert g6); Karten-Bindung zusaetzlich durch fail-closed Customer-Match (R4 — fremde `session_id` kann kein fremdes `payment_method` binden, g3).
- **SECRETS:** `hasCard` nur abgeleiteter Boolean (kein `cus_`/`pm_`-Leak); Audit loggt nur action+ip+tenant; `STRIPE_SECRET_KEY` bleibt im `stripe.js`-Port; kein `console.log` in neuen Dateien.
- **PAYMENT_ENABLED aus = byte-identisch** (`hasCard` fehlt im state, beide Routen 404, UI versteckt Block — g7 beweist). Money als Ganzzahl-Cents unveraendert.

Concerns (kein Blocker):
- `STORE_BACKEND=pg` global-flip ergibt 8 Fehler, aber **rein umgebungsbedingt** (kein Postgres in der Sandbox), identisch auf `master`, KEINE der 8 Dateien wird von Pay3 beruehrt. Echte pg-Abdeckung laeuft in-process via pglite (i9-self-service etc.) und ist gruen — das ist die im Repo vorgesehene pg-Testweise.
- `GET .../billing/return` bindet eine Karte und ist same-origin -> theoretisch CSRF-exponiert; entschaerft durch (a) `webAuthMw`-Session und (b) fail-closed Customer-Match. Worst Case eines CSRF ist benign (Opfer bindet eigene Karte). Identisches Muster wie der bereits gemergte Pay1-Pfad.
- Remote-Self-Service haengt weiterhin an `webAuthMw`/OIDC-Browser-Login (laut Memory I9 nur localhost produktiv) — vorbestehende Einschraenkung, nicht durch Pay3 eingefuehrt.

Unabhaengiger Test-Lauf: Default-Backend (json + in-process pglite) 704/704 pass, 0 fail (env-bereinigt). Pay3-Tests g1-g7 gruen gegen echten pglite-pg-Store (gezielter pg-Lauf 48/48). Gate/Disclosure-Tests 26/26.

---

## 4. Clean-Code-Audit (S1-S4)

**Verdict: PASS (kein Blocker).**

- **S1 (Blocker):** keine.
- **S2 (schwer):** 1 Befund, **niedrige Schwere** —
  *S2-1* (`src/self-service-routes.js:71-100` + `src/server.js:867-899`): Die zwei Route-Paare (setup-checkout / return) sind in server.js (Pay1) und self-service-routes.js (Pay3) strukturell parallel (identische Guard-Sequenz: paymentEnabled->404, publicUrl->500, session_id-Validierung->400, bindCardFromSession-Mismatch->audit+403, success->audit). Der **Sicherheitskern** (Customer-Idempotenz + Customer-Match) ist bereits sauber nach `card-setup.js` extrahiert (G5 vorbildlich) — die Restduplikation ist reine Route-Orchestrierung, die sich nur in Identitaetsquelle (`requireTenant` vs `req.tenant.tenantId`), Audit-Namen und Antwortform (JSON vs 302) unterscheidet. Bewusst im Design-Kommentar begruendet. **KEIN Blocker** — der gefaehrliche Teil ist bereits dicht. Optionaler Fix: kleiner Helfer, der session_id validiert + `bindCardFromSession` aufruft + ein `{ok}`-Ergebnis liefert, das jede Route in eigene Antwort/Audit uebersetzt — nur wenn es die Lesbarkeit nicht verschlechtert.
- **S3 (mittel):** PASS — keine Verstoesse. Namen deskriptiv und auf Abstraktionsebene (`ensureCustomer`/`bindCardFromSession` mit Nebeneffekt im Namen N7; `hasCardOnFile` reines Praedikat). Magic-Strings vermieden (`CARD_RETURN_OK`/`CARD_RETURN_CANCELED`, G25). Kommentare praezise, Deutsch ohne Umlaute. `renderBilling`/`showCardReturn` knapp und klar.
- **S4 (niedrig):** PASS — keine Verstoesse. Neue Datei `card-setup.js` (2 kleine Fns) begruendet (von 2 Routen gebraucht, Sicherheits-Invariante genau einmal). Keine Ein-Methoden-Klasse-Dogmatik, keine Indirektion ohne Mehrwert. Alle Argumente EIN Objekt (kein F1); Factory um `config`+`billing` erweitert, bleibt EIN Destrukturierungs-Objekt.

Positiv hervorgehoben: (1) G5/S2 vorbildlich — zuvor inline doppelte Customer-Idempotenz + Customer-Match-Invariante nach `card-setup.js` extrahiert, von Pay1 UND Pay3 geteilt, R4-Invariante lebt genau einmal. (2) DIP/P4 — `config`+`billing` injiziert, Tests nutzen `fakeBilling()` ohne Netz (F.I.R.S.T./Repeatable; eigenes cfg-Objekt statt Singleton-Mutation = Independent). (3) Fail-closed durchgaengig. (4) `hasCardOnFile` leakt keine IDs. (5) G25 benannte Konstanten. (6) N7 Nebeneffekt-Funktionsnamen. (7) `node --check` sauber.

Verifikations-Hinweis: voller Suite-Lauf via npm-test-Glob = 704/704. Ein scheinbarer Fehler bei `test/helpers/ws-openai-shim.mjs` trat NUR bei ungeglobtem `node --test` auf, existiert identisch auf `master` und ist ein Helper-Resolution-Artefakt — KEINE Regression durch Pay3.

Top-Todos (nicht-blockierend):
- Optional: residuale Route-Orchestrierungs-Duplikation der beiden return-Handler (S2-1) per kleinem Validierungs-/Bind-Helfer buendeln — nur wenn es die Lesbarkeit nicht verschlechtert.
- Vor produktivem Live-Gang: Live-Stripe-Pfad (echte Checkout-Session, payment_method-Erfassung) per dokumentiertem Smoke-Test verifizieren — automatisierte Tests decken nur die Fake-Billing-Orchestrierung ab.

---

## 5. Fix-Runden

**0 Fix-Runden.** Gate war im ersten Durchlauf PASS (Safety APPROVED, Clean-Code PASS mit nur 1 niedrig-schwerem nicht-blockierenden S2). Die im Plan offengelassene G5/S2-Extraktion (`card-setup.js`) war bereits in der Implementierung enthalten.

---

## 6. Was fuer echtes Geld noch fehlt (Ausblick Pay4)

Pay3 erfasst ausschliesslich die Karte (Stripe Checkout im `mode:setup` — kein Betrag, kein Charge). Fuer den produktiven Geld-Fluss steht weiterhin aus:

- **Live-Stripe-Smoke (Pay4):** echter Checkout-Flow gegen Stripe-Test-Keys (pg + Web-Login + Testkarte `4242...` -> `?card=ok` -> "Karte hinterlegt"). Die automatisierten Tests decken nur die Fake-Billing-Orchestrierung ab. Laut Memory (Stripe Test-Mode Smoke 2026-06-21) ist "Stripe live" KEIN Env-Flip, sondern eine eigene Phase — die Karten-/Customer-Erfassung beim Onboarding fehlte bisher; genau diese Luecke schliesst Pay3 fuer den Self-Service-Pfad. Der vollstaendige Hold->Capture mit echtem `payment_method` ist erst nach diesem gruenen Smoke produktiv.
- **Remote-Self-Service (vorbestehend, I9):** `webAuthMw`/OIDC-Browser-Login ist laut Memory nur auf localhost produktiv (`req.auth` nur auf `/mcp`). Solange das offen ist, kann ein remote-Tenant die Karten-UI nicht real nutzen — der Geld-Pfad ist damit faktisch noch nicht remote erreichbar.
- **CSRF-Haertung:** `GET .../billing/return` ist same-origin und damit theoretisch CSRF-exponiert (Worst Case benign, weil Opfer nur eigene Karte bindet). Vor produktivem Geld-Fluss bewerten, ob das identische Pay1-Muster ausreicht oder ein CSRF-Token noetig wird.
- **pg in Produktion:** der globale `STORE_BACKEND=pg`-Lauf ist in der Sandbox nur DB-unerreichbar (8 umgebungsbedingte Fehler, identisch auf master). Vor Live-Geld muss der echte pg-Pfad (nicht nur pglite in-process) gegen eine reale Postgres-Instanz verifiziert sein.
