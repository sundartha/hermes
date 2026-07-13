# Report: Phase checkout-stale-stripe-customer

**Datum:** 2026-07-13
**Gate:** PASS
**finalBranch:** `fix/checkout-stale-stripe-customer-fix1`
**Plan:** `PLAN-CHECKOUT-STALE-STRIPE-CUSTOMER.md`

## Kontext

Bug: Neue Tenants (bestaetigt bei ZWEI unabhaengigen, frischen Accounts —
unterschiedliche Emails, unterschiedliche Customer-Ids) bekamen beim
Checkout-Start `Couldn't start checkout.` Root Cause (im Plan-Dokument
verifiziert, kein Rateversuch): `ensureCustomer()` (`src/billing/card-setup.js`)
liest eine bereits gespeicherte `stripe_customer_id` ungeprueft weiter; existiert
der Customer im aktiven Stripe-Live-Account nicht (mehr) — sei es durch
Sichtbarkeits-Verzoegerung zwischen `createCustomer` und dem naechsten API-Call,
Dashboard-Cleanup oder Account-/Key-Wechsel — lehnt Stripe mit `resource_missing`
ab, der `asyncBilling`-Wrapper antwortet 502, das Frontend zeigt die generische
Meldung. Gleiches Muster war am 2026-07-04 schon einmal aufgetreten und nur
manuell per SQL-`UPDATE` umschifft worden (Ebene A, kein Code-Fix) — die
eigentliche Luecke blieb offen.

Gewaehlte Loesung: **Fix B** — struktureller Self-Heal statt wiederholtem
manuellem Patch. Plan + Implementierung + Runde-1-Review-Fix waren bereits
**vor diesem Lauf committet** (Commits `5b571b0`, `9b407ac` auf
`fix/checkout-stale-stripe-customer-fix1`). Dieser Lauf deckte den
abschliessenden dualen Review (Safety + Clean-Code) samt Verifikation ab.
Lokale Suite zum Abschluss: **2187/2187 gruen** (reproduzierbarer
Vorlauf-Flake auf `master`-Baseline separat bestaetigt, keine Regression durch
diesen Diff — Details unten unter Safety).

## Umfang des Diffs (14 Dateien, inkl. Review-Fix-Commit)

| Datei | Rolle |
|---|---|
| `src/billing/card-setup.js` | `startCheckoutWithStaleCustomerHeal` — Orchestrierung: `ensureCustomer` -> try -> bei `CustomerMissingError` genau EINMAL heilen (stale Referenz nullen, neuer Customer) -> retry. Kein Loop, zweiter Fehlschlag propagiert unveraendert (502 wie bisher). |
| `src/billing/errors.js` | `CustomerMissingError` — neue Fehlerklasse, klassifiziert nach Aufrufer-Sicht (Muster identisch zu `LlmUnavailableError`). |
| `src/billing/stripe.js` | Praezise Klassifikation von Stripes `resource_missing`/`param=customer` gegen benannte Konstanten (`RESOURCE_MISSING_CODE`, `CUSTOMER_PARAM`) statt Magic-Strings; `isMissingCustomerDetail()` defensiv (kaputtes JSON -> kein Match, kein Raten). |
| `src/billing/subscribe.js` | `checkoutSessionIdempotencyKey` um `customerId` erweitert — verhindert, dass der Heal-Retry mit frischem Customer unter demselben Idempotency-Key laeuft (sonst Stripe `idempotency_error` / 24h-Lockout, exakt die Bugklasse der frueheren Idempotency-Key-Fix-Lesson vom 2026-07-04). |
| `src/config.js` | `STRIPE_CUSTOMER_RETRY_DELAY_MS` zentralisiert (numEnv, Min 0, Fallback 2000). |
| `.env.example`, `render.yaml` | Env-Doku fuer `STRIPE_CUSTOMER_RETRY_DELAY_MS` (Runde-1-Nachtrag, s.u.). |
| `src/self-service-routes.js`, `src/server.js` | Beide Checkout-Start-Routen auf den Self-Heal-Wrapper umgestellt; Audit-Event `stripe_customer_self_heal` bei erfolgter Heilung. |
| Testdateien (6) | Siehe Test-Abdeckung unten. |

Keine neuen npm-Dependencies (`package.json`/`package-lock.json` 0 Diff-Zeilen).
Keine neuen Endpunkte. `claude.js`/`bridge.js` (Disclosure) 0 Diff-Zeilen.

## Fix-Runden

1. **Runde 1 (vor diesem Lauf, Commit `5b571b0`):** Plan + Implementierung
   von Fix B — Kernfix (`card-setup.js`, `errors.js`, `stripe.js`,
   `subscribe.js`), `STRIPE_CUSTOMER_RETRY_DELAY_MS` in `src/config.js`
   zentralisiert, beide Checkout-Routen umgestellt, Tests ergaenzt.
2. **Review-Blocker Runde 1 (vor diesem Lauf, Commit `9b407ac`):**
   `STRIPE_CUSTOMER_RETRY_DELAY_MS` war zentralisiert, aber weder in
   `.env.example` noch in `render.yaml` dokumentiert (verletzt Repo-Konvention:
   Env-Variablen muessen zentralisiert UND in `.env.example` dokumentiert sein,
   fuer Render zusaetzlich `render.yaml`). Nachgetragen in beiden Dateien
   (Default 2000, Min 0, Zweck-Erklaerung, Precedent-Format wie
   `ELEVENLABS_SYNTH_TIMEOUT_MS`/`PROVISIONING_REDRIVE_MAX_AGE_MS`) plus
   Regressionstest `test/checkout-stale-stripe-customer-env-docs.test.js`
   (prueft beide Dateien auf die Doku dieser Variable — faengt kuenftige
   Doku-Drift fuer genau diesen Blocker ab).
3. **Dieser Lauf:** finaler dualer Review (Safety + Clean-Code) auf dem
   kompletten Diff `master..fix/checkout-stale-stripe-customer-fix1`, inkl.
   unabhaengiger Testverifikation. Keine weiteren Fix-Runden noetig — beide
   Reviews PASS ohne Blocker (`=== FIXES ===` leer).

## Safety-Urteil (final) — APPROVED

| Kriterium | Ergebnis |
|---|---|
| `approved` | true |
| `testsPassIndependently` | true |
| `safetyGatesIntact` | true |
| `disclosureIntact` | true |
| `authFailClosedIntact` | true |
| `noSecretsLeaked` | true |
| `scopeRespected` | true |
| `behaviorAsIntended` | true |
| `blockers` | keine |

**Unabhaengiger Test-Lauf:** `npm test` deckt in einem Lauf beide Backends ab
(json-default Unit-Tests + pglite-in-process Integration-Tests via
`makePgTestStore`, kein separater `STORE_BACKEND`-Toggle noetig).
Fix-B-relevante Dateien isoliert: **72/72 gruen**
(`test/billing-card-setup.test.js`, `test/stripe-setup-checkout.test.js`,
`test/billing-subscribe.test.js`, `test/bk2-checkout-return-plan.test.js`,
`test/checkout-stale-stripe-customer-env-docs.test.js`). Voller Suite-Lauf 1:
2187 Tests, 2 Fails (`test/api-read-parity.test.js`,
`test/telnyx-event-ingest-route.test.js` — beide Dateien unveraendert im
Diff). Voller Suite-Lauf 2 (Wiederholung, identischer Branch): **2187/2187
gruen**. Zum Regressionsausschluss: `master`-Baseline separat gelaufen ->
ebenfalls 1 Flake (anderer Test, `test/finishcall-billing-once.test.js`) —
bestaetigt vorbestehende Parallel-Suite-Flakiness, nicht durch diesen Diff
verursacht.

**Concern (kein Blocker):** theoretische Race bei ZWEI gleichzeitigen
Requests desselben Tenants, die beide im selben Moment auf `resource_missing`
treffen — beide koennten die stale Referenz nullen und je einen eigenen
frischen Customer anlegen (unterschiedliche Idempotency-Keys -> zwei
Checkout-Sessions). Kein Geld-/Doppel-Abo-Risiko: Checkout-**Session**-
Erstellung bewegt kein Geld; die spaetere Subscription-Aktivierung bleibt
ueber die bestehende `customerMatches`-Invariante fail-closed gegated,
unveraendert durch diesen Diff. Spiegelt exakt das bereits vorbestehende
Race-Muster in `ensureCustomer` beim allerersten Checkout eines Tenants
(noch keine Id gespeichert) — keine neue Bug-Klasse.

**Begruendung (Auszug):** Fix B haelt den Plan-Scope strikt ein —
Selbstheilung heilt GENAU EINMAL (try/catch, kein Loop, zweiter Fehlschlag
propagiert unveraendert -> 502 wie bisher), Idempotency-Key korrekt um
`customerId` erweitert (verhindert `idempotency_error` beim Retry mit neuem
Customer; TOCTOU-Schutz fuer echte Doppelklicks bleibt erhalten, da derselbe
gespeicherte Customer denselben Key liefert), stale `paymentMethodId` wird
konsequent mitgeloescht. Kein Doppel-Charge-/Doppel-Abo-Risiko: die geheilte
Operation ist Checkout-Session-Erstellung (kein Geldfluss), die tatsaechliche
Abo-Aktivierung bleibt unveraendert hinter der bestehenden
`customerMatches`-Sicherheitsinvariante. `claude.js`/`bridge.js`
(Offenlegungssatz) 0 Diff-Zeilen. Keine neuen Endpunkte, bestehende
Auth-Wrapper (`requireTenant`/Basic-Auth, `webAuthPendingMw`) unveraendert —
fail-closed intakt. Keine Safety-Gates (Allowlist/Denylist/Land/
Stundenlimit/Budget/Max-Dauer) beruehrt. Keine neuen npm-Dependencies.
`CustomerMissingError`-Message identisch zum bestehenden generischen
Fehlerpfad, per Test explizit gegen Secret-Leak (`sk_`/`Bearer`) geprueft.
Review-Blocker Runde 1 (Env-Doku fehlte) wurde in einem separaten
Nachfolge-Commit sauber behoben inkl. Regressionstest.

## Clean-Code-Audit (final) — PASS, kein Blocker

| Kategorie | Findings |
|---|---|
| S1 | keine |
| S2 | keine |
| S3 | keine |
| S4 | keine |
| `blocker` | false |

**Verdict:** "PASS — kein S1/S2-Blocker. Sauberer, gut getesteter Self-Heal-
Fix (Fix B) fuer stale Stripe-Customer beim Checkout-Start."

**PassNotes (Auszug):**

- **P4/DIP:** `card-setup.js` bleibt reine Orchestrierung ueber injizierte
  Ports (store/billing), kein direkter Stripe-Zugriff. `startCheckout` ist
  ein reiner Callback, Mode-Wahl bleibt beim Aufrufer.
- **P9:** `CustomerMissingError` klassifiziert nach Aufrufer-Sicht
  (Self-Heal faengt genau diesen Typ), Muster identisch zu
  `LlmUnavailableError`.
- **G25:** `RESOURCE_MISSING_CODE`/`CUSTOMER_PARAM` als benannte Konstanten
  statt Magic-Strings; `isMissingCustomerDetail()` defensiv (kaputtes JSON
  -> kein Match, kein Raten, G26).
- **G34/G30:** `startCheckoutWithStaleCustomerHeal` ist eine kohaerente
  Aufgabe (ensure -> try -> heal-once -> retry), kein Loop, sauber
  dokumentiert (bei zweitem Fehlschlag bleibt die Route bei 502).
- **Store-Op `setTenantStripe`:** `customerId !== undefined`-Check
  bestaetigt, dass explizites `null` beide Felder (`customerId`,
  `paymentMethodId`) korrekt nullt, ohne `subscriptionId` anzufassen.
- **Idempotency-Key-Erweiterung** um `customerId` ist korrekt und noetig
  (sonst wuerde der Heal-Retry mit frischem Customer unter demselben Key mit
  geaenderten Params laufen -> Stripe `idempotency_error`/24h-Lockout, exakt
  die Bugklasse der frueheren IDEMP-KEY-FIX-Lesson). Alle Caller
  (`self-service-routes.js`, `test/billing-subscribe.test.js`) korrekt auf
  die neue Objekt-Signatur umgestellt.
- **`STRIPE_CUSTOMER_RETRY_DELAY_MS`** zentral in `config.js` (numEnv, Min
  0, Fallback 2000) UND in `.env.example` UND `render.yaml` dokumentiert —
  der Review-Fix-Commit (`9b407ac`) hat genau diese Doku-Luecke aus Runde 1
  selbst nachgetragen samt Regressionstest.
- `sleep` injizierbar (Muster `defaultSleep` wie `llm.js`) -> Tests warten
  nie echt (F.I.R.S.T./T9).
- Deutsche Kommentare ohne Umlaute durchgehend eingehalten.
- **Testabdeckung ungewoehnlich gruendlich:** 6 dedizierte Unit-Tests fuer
  `startCheckoutWithStaleCustomerHeal` (Happy-Path, Heal von
  gespeichertem/frischem Customer, Doppel-Fehlschlag ohne Loop, fremder
  Fehler ohne Heal-Versuch, `retryDelayMs=0`-Grenzfall), 3 neue
  Stripe-Adapter-Tests (inkl. Negativ-Test auf anderes `param`), 1
  Integrationstest (bk2 Case 17) inkl. Audit-Event-Pruefung.

**Verifikation:** `node --check` auf allen 7 geaenderten `src/`-Dateien
sauber. Volle Testsuite (2187 Tests): 2185 gruen, 2 rote Tests NICHT im
Diff-Scope (`test/outbound-reconcile-finishcall.test.js`,
`test/telnyx-p5-gate-proof.test.js` — letzterer ein Netzwerk-Timeout, wirkt
flaky, unabhaengig vom Billing-Code). Gezielter Lauf der 5 diff-relevanten
Testdateien: **72/72 gruen**.

**topTodos (optional, kein Blocker):**

1. Regressionstest ergaenzen fuer den Fall, dass der ZWEITE
   `ensureCustomer`-Call waehrend des Heals selbst fehlschlaegt (z.B.
   Stripe-Ausfall bei `createCustomer`) — der Store bleibt dann bewusst auf
   `customerId:null` stehen (im Kommentar begruendet), aber dieses
   spezifische Verhalten ist aktuell nicht direkt getestet.
2. Beobachtung, kein Fix noetig: das 2-zeilige
   `if (healed) audit("stripe_customer_self_heal", ...)`-Muster ist
   wortgleich in `server.js` UND `self-service-routes.js` — bei dieser
   Groesse (1 Zeile, 2 Stellen, unterschiedliche Aufrufer-Variablen) waere
   Extraktion eher Indirektion als Klarheitsgewinn (Lesbarkeits-Vorrang),
   bewusst nicht als S2 geflaggt.
3. Nach Live-Rollout: gehaeufte `stripe_customer_self_heal`-Audit-Events wie
   im Code-Kommentar vorgesehen beobachten (Signal fuer ein tieferliegendes
   Stripe-Account-Problem).

## Fixes in diesem Lauf

Keine — beide finalen Reviews (Safety + Clean-Code) kamen ohne Blocker
durch, `=== FIXES ===`-Sektion der Quelle ist leer.

## Offene Punkte (ausserhalb dieser Phase, laut Plan-Dokument)

- **Ebene A** (SQL-`UPDATE` zum Nullen der stale Customer-Id fuer den
  urspruenglich betroffenen Tenant `t_user_01KW2FCC46GZVQ2CN1HZD4EH5W`) ist
  ein operativer Sofort-Fix, kein Teil dieses Code-Diffs — braucht separat
  Jonas' Freigabe fuer einen Produktions-DB-Write.
- **Ursachenfrage offen:** ob das urspruengliche Auftreten Stripe-seitige
  Sichtbarkeits-Verzoegerung oder ein Account-/Key-Problem war, wurde laut
  Plan nicht abschliessend geklaert (Stripe-Dashboard-Check stand bei Jonas
  aus). Fix B deckt beide moeglichen Ursachen strukturell ab
  (`STRIPE_CUSTOMER_RETRY_DELAY_MS` ueberbrueckt Fall 1, Self-Heal behebt
  Fall 2 dauerhaft).
