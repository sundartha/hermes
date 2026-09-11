# Phase GP-P2 — Eignung der Zahlungsmethode statt blosser Existenz

**Gate:** PASS
**finalBranch:** `gp/p2`
**headCommit:** `bfd6a92c3082c3770393c5b40f2c00a7a8f4e868`

## Kontext

Vorfall 11.09.2026: ein `payment_method` vom Typ `link` trug die Abo-Zahlung (4,99 EUR) und
lehnte sechs Sekunden spaeter den 92-Cent-Hold ab. Das bisherige Gate (`requireTenantCard`)
prueft nur, ob ueberhaupt eine Zahlungsmethode hinterlegt ist — nicht, ob sie eine getrennte
Autorisierung (Hold) traegt. GP-P2 schliesst diese Luecke.

## Plan (gekuerzt)

Basis: `master` (`7996283`). Autoritativ: `PLAN-GELDPFAD.md` Abschnitt „GP-P2", Owner-Antworten
3/4/5/7, Pre-Mortem 1-3. Groesse **L**, `highStakes: true`.

**Kernentscheidungen:**
- **E1** — Der Typ wird gespeichert, die Eignung wird EINMAL entschieden: `isHoldCapablePaymentMethodType`
  in `src/billing/payment-method-eligibility.js` ist die einzige Stelle, die ueber Eignung urteilt.
  ALLOWLIST (nur `"card"`), nie Denylist — falsch-negativ ist billiger als falsch-positiv.
- **E2** — Referenz und Typ sind eine Einheit, erzwungen durch Konstruktion: alle vier Schreibstellen
  laufen ueber `bindPaymentMethodOnTenant` (`src/billing/card-setup.js`), die `undefined -> null`
  normalisiert (verhindert stale Typen bei selektivem Store-Patch).
- **E3** — Webhook-Pfad braucht einen Lese-Call: Stripe-Webhooks liefern `default_payment_method`
  immer unexpandiert, also ohne Typ. Neue rein lesende Port-Methode `retrievePaymentMethodType`
  (`GET /v1/payment_methods/{id}`), fail-soft (Fehler -> `null`, kein Wurf, damit Stripe-Retries
  nicht ausgeloest werden).
- **E4** — `getCheckoutSessionResult` MUSS auf `paymentMethodIdOf` umgestellt werden: der vertiefte
  Expand liefert ein Objekt statt einer String-Id; ohne Umstellung waere ein Stripe-Objekt als Id
  in die DB geschrieben worden.
- **E5** — kein neues Env, kein neuer Config-Key; Allowlist ist eine Modul-Konstante, kein Schalter.
- **E6** — `hasCardOnFile` bleibt unangetastet (rein referenzbasiert); Divergenz „Karte hinterlegt,
  aber nicht hold-faehig" ist bewusst getragen (Sichtbarkeit GP-P0, Rueckweg GP-P3).

**Neue Dateien:** `src/billing/payment-method-eligibility.js` (Allowlist-Praedikat),
`src/billing/provider-enum.js` (Enum-Form-Pruefung aus `decline.js` herausgezogen, geteilt).

**Geaenderte Dateien:** `decline.js` (Enum-Import statt Kopie), `webhook.js`
(`paymentMethodTypeOf`, `resolvePaymentMethodType`, Bindung im ACTIVATE-Zweig), `card-setup.js`
(`bindPaymentMethodOnTenant`, `clearTenantPaymentMethod`), `subscribe.js` (beide Schreibstellen),
`stripe.js` (Expand vertieft, `retrievePaymentMethodType` neu), `ports.js` (JSDoc),
`state-ops.js`/`schema.sql`/`pg.js` (drittes Feld `stripe_payment_method_type`, additiv nullable,
kein Backfill), `onboarding.js` (zweiter Ablehnungsgrund mit Enum in der Fehlermeldung),
`scripts/smoke-stripe-payment.mjs`.

**Tests:** neue Datei `test/gp-p2-zahlungsmethode-eignung.test.js` (21 Faelle: Adapter-Fixtures,
Bindepfade, pglite-Persistenz-Roundtrip, Provisionierungspfad inkl. GAP-05-Befreiung und
Allowlist-vs-Denylist-Negativtest) plus Fixture-Anpassungen (`paymentMethodType: "card"`) in
13 Bestandsdateien.

**Abgrenzung:** kein `payment_method_types`, keine Denylist gegen `link`, keine Aenderung an
`settleSetupFeeHold`/`captureHold`/`cancelHold`, kein Backfill, kein Sofortbuchungs-Zweig, keine
Aenderung an Kapazitaets-/Budget-Gates, kein Eingriff in GP-P5-Kommentarblock.

## Impl-Zusammenfassung

- `headCommit`: `bfd6a92c3082c3770393c5b40f2c00a7a8f4e868`, `committed: true`
- `node --check`: PASS (10 geaenderte src-Dateien)
- Tests: 212 pass, 1 fail (siehe Deviations)
- Smoke: PASS (Server mit `BASE_ENV` + `SKIP_TWILIO_SIGNATURE_CHECK=true` auf Port 39914,
  `GET /healthz` -> 200, `GET /api/plans` -> 200, zweimal gefahren)

Vollstaendig gemaess Plan umgesetzt: Allowlist-Praedikat, geteilte Enum-Form-Pruefung, die eine
Bind-Funktion an allen vier Schreibstellen, Webhook-Typ-Nachschlag fail-soft, vertiefter Expand
mit `paymentMethodIdOf` statt Direktlesung, additiv-nullable Store-Feld ueber alle drei Ebenen
(Schema/pg.js SELECT+rowToTenant+flushTenants), Eignungs-Gate in `onboarding.js` mit eigener
Fehlermeldung fuer „kein Zahlungsmittel" vs. „ungeeignetes Zahlungsmittel". Struktur-Kontrolle
`grep -rn payment_method_types src/ scripts/` -> 0 Treffer; `npm run lint` exit 0.

### Deviations

1. **1 roter Test, vorbestehend:** `GAP-05 SOLL: allow_promotion_codes darf nicht bedingungslos
   gesetzt sein` (`test/gap-05-number-hold.test.js`) ist bereits auf `master` identisch rot
   (`allow_promotion_codes:'true'` unveraendert) — Katalog-Praefix `GAP-0` routet ihn ohnehin in
   `test:gates`, nicht in `npm test`. Keine Regression dieser Phase.
2. `grep -rn "link" src/billing/` liefert 5 statt der geplanten 0 Treffer — alle fuenf stehen in
   Kommentaren/JSDoc, die der Plan selbst woertlich vorschreibt (Vorfall-Erklaerung, Enum-Beispielwerte).
   Keine Denylist im Code; die Kontrolle war im Plan nicht praezise genug formuliert.
3. Zusaetzliche Datei ausserhalb der Plan-Liste: `eslint-legacy-exceptions.json` — der
   pre-commit-Hook verlangte angepasste Zahlen bestehender Eintraege (kein neuer Eintrag):
   `webhook.js applyStripeWebhook` 29 -> 25 (GESENKT, Folge der Extraktion), `pg.js flushTenants`
   33 -> 34 und `rowToTenant` 32 -> 33 (ANGEHOBEN, vorhergesagte +1-je-Feld-Kurve).
4. Zuschnitts-Verbesserung: der geplante Inline-Bindezweig in `applyStripeWebhook` haette die
   Funktion auf 101 Zeilen wachsen lassen (Limit 100) — stattdessen als eigene Funktion
   `bindPaymentMethodFromEventIfMissing` herausgezogen (G30), Komplexitaet 29 -> 25, Verhalten
   identisch.
5. Lint-Zwang im neuen Test: Variablen heissen `zustand` statt `s`, Helfer nehmen ein Objekt statt
   vier Argumente (Repo-Regeln `id-length`/`max-params` als harte Fehler) — nur im neuen Code, nicht
   in Bestandsfaellen.
6. Umgebungs-Befund: der vorgegebene `node_modules`-Symlink zeigte auf sich selbst (ELOOP) und liess
   Lint-Aufrufe still mit leerer Ausgabe abbrechen; nach Korrektur meldete der Linter 15 echte Fehler
   im neuen Test, die behoben wurden.
7. `test/store-pg.test.js`, `test/billing-subscribe.test.js`, `test/fw1-webhook-haertung.test.js`
   wurden zur Verifikation mitgefahren, inhaltlich aber nicht geaendert.

## Safety-Urteil

**verdict: PASS**, `approved: true`, keine Blocker. Alle Pruefpunkte einzeln nachgeprueft:
SAFETY-GATES (outbound-gates.js/config.js/boot-guard.js/telephony/ unberuehrt, keine neue
Call/SMS/Geld-Route, neues Praedikat ist rein und fail-closed), OFFENLEGUNG (claude.js/bridge.js
nicht im Diff), AUTH FAIL-CLOSED (route-policy.js/server.js/routes/ unberuehrt, Webhook-Typ-Nachschlag
haengt hinter bestehendem Signatur-Gate), SECRETS (Adapter gibt ausschliesslich den Enum-Typ heraus,
`billing_details` bleibt im Adapter; `enumOrNull` verengt alle vier Schreibwege), SCOPE (keine neue
Dependency, keine Denylist, keine Aenderung an Capture/Cancel/Kapazitaets-Gates), Verhalten wie
spezifiziert (alle vier Abnahmeteile getestet und gruen).

**Concerns (keine Blocker, aber vor Merge zu kennen):**
1. **Bestands-Sperre:** jeder vor GP-P2 gebundene Mandant hat `paymentMethodType===null` und faellt
   ab jetzt bei `requireTenantCard` durch. Der Webhook-Race-Bindepfad repariert ihn NICHT
   (`hasCardOnFile` prueft nur `paymentMethodId`, kehrt frueh zurueck). Reparatur erst mit GP-P3.
   Bewusst akzeptiertes Fenster laut `PLAN-GELDPFAD.md` Zeile 683.
2. **Unverifizierte Anbieter-Annahme:** der vertiefte Doppel-Expand
   (`expand[]=setup_intent&expand[]=setup_intent.payment_method`) ist nur gegen Fixtures getestet,
   nicht gegen echtes Stripe — erster realer Checkout-Return ist der Rauchtest.
3. **Neuer Anbieter-Roundtrip im Webhook-Lock:** `resolvePaymentMethodType` laeuft ohne
   Timeout/AbortSignal innerhalb von `webhookLock` — Bestandsmuster, aber neu auf einem von Stripe
   wiederholten Pfad.
4. Zwei Extraktionen ueber den woertlichen Auftrag hinaus (`provider-enum.js`,
   `bindPaymentMethodFromEventIfMissing`) — beide von G5/G30 bzw. dem Suppressions-Hook erzwungen,
   nicht als Scope-Drift gewertet.

**Unabhaengiger Testlauf** (frischer Worktree, eigener Branch): neues Testfile allein 21/21 gruen;
14 geaenderte Testdateien gemeinsam 152/153 (derselbe eine vorbestehende Rote, auf `master` identisch
reproduziert); 16 zusaetzliche, nicht geaenderte aber betroffene Testdateien 182/182 gruen.

## Clean-Code-Audit (S1-S4)

**verdict: PASS**, `blocker: false`.

- **S1:** keine Befunde.
- **S2:** keine Befunde.
- **S3:** ein kosmetischer, nicht flaggenswerter Fall — `bindPaymentMethodFromEventIfMissing`
  benennt den Parameter `event`, obwohl es ein Auszug aus `interpretStripeEvent` ist (im
  Aufruf-Kontext verstaendlich, keine Aenderung noetig).
- **S4:** keine nennenswerten Befunde — neue Funktionen sind je eine Aufgabe (G30-konform), der
  eslint-complexity-Pin fuer `webhook.js` sank sogar (29 -> 25).

G5 tatsaechlich befolgt (Enum-Pruefung und Bind-Logik je einmal, nicht kopiert), fail-closed bei
unbekanntem Typ, fail-soft nur beim Webhook-Nachschlag (verhindert Stripe-Retry-Loop, begruendet).
Kein `payment_method_types`, keine Denylist gegen `link`, `invoiceTotal===0`-Befreiung unangetastet
— alle drei Owner-Verbote grep-geprueft eingehalten. Die eine rote Testdatei ist nachweislich
bereits auf `master` identisch rot, keine Regression dieser Phase.

`eslint-legacy-exceptions.json` ehrlich gepflegt: Pin fuer `webhook.js` gesenkt (29 -> 25), Pin fuer
`pg.js` minimal angehoben (+1 je `flushTenants`/`rowToTenant`, dieselbe seit Wochen dokumentierte
lineare Kurve).

`topTodos`: keine.

## Fix-Runden

Keine — beide finalen Reviews (Safety und Clean-Code) kamen ohne Blocker durch; es gab keine
Fix-Runde in dieser Kette.
