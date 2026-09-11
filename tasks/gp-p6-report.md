# GP-P6 — Preis-Waechter Katalog gegen Stripe

Status: **Gate = PASS** | finalBranch = `gp/p6` | headCommit = `8d54d9f`

## Ueberblick

Zwei Sicherungen mit getrennter Schwere gegen einen unbepreisten oder abweichenden Preis-Katalog:

| | Was | Wo | Schwere |
|---|---|---|---|
| (a) | Katalog-Slug ohne Stripe-Price-Id bei `PAYMENT_ENABLED=true` | reines Praedikat `src/boot-guard.js` + `assertPricedPlans` in `src/boot.js` | **FATAL, exit(1) vor `app.listen()`**, netzfrei |
| (b) | Katalog-Betrag/Waehrung gegen `GET /v1/prices/{id}` | neues Modul `src/billing/price-drift-watch.js` (Boot-Sonde + 10. Sweep-Zweig) | Abweichung -> entprellte Voll-Meldung; Netzfehler -> gezaehlter `unbekannt`-Befund |

Ausdruecklich nicht gebaut (Spec-Abgrenzung): kein Netz in der Boot-Sequenz, kein Einfrieren von `PAYMENT_ENABLED`, keine Aenderung an `PLAN_CATALOG`/Preisen, kein neuer Befundtyp in `outbound-drift-watch.js`.

## Plan (gekuerzt)

Grundlage: `PLAN-GELDPFAD.md` Abschnitt "GP-P6", `.claude/refs/clean-code.md`, Code-Stand `master` (`4e483f7`). Groesse **M** -> `maxFixRounds: 2`, `highStakes: true`.

**Neue Dateien**
- `src/billing/price-drift-watch.js` — reiner Urteilskern `beurteilePreis(plan, messung)` + `PREIS_URTEIL` (ok/abweichung/unbekannt); atomarer Single-Flight/Mindestfrist-Claim (`beanspruchen`, byte-gleiches Muster `outbound-drift-watch#beanspruchen`); `pruefeTarife`; `meldeAbweichungen`; `schliesseBehobene` (Entwarnung nur aus einem Lauf mit vollstaendigem Urteil); `behandleUnwissenheit` (Zaehler = Anzahl offener Slot-Marker, kein neues Store-Feld); `runPriceDriftSweep`/`makePriceDriftWatch`.
- `test/gp-p6-preis-waechter.test.js`.

**Edits (Kernpunkte)**
- `src/billing/stripe.js`: neuer, rein lesender Adapter-Zweig `retrievePriceAmount(priceId)` (`GET /v1/prices/{id}`), liefert nur `{unitAmountCents, currency}`; fehlendes/nicht-ganzzahliges `unit_amount` -> `null`. JSDoc-Ergaenzung in `ports.js`.
- `src/boot-guard.js`: `unpricedPlanSlugs(slugs, priceIdOf)` — reines Praedikat, `priceIdOf` injiziert (Muster `unpricedModels`).
- `src/boot.js`: `assertPricedPlans(config)` als **zehntes** exit(1)-faehiges Gate, direkt nach `assertPricedModels`, nur bei `PAYMENT_ENABLED=true`; zehnter Sweep-Zweig in `runSweepTick`; Boot-Sonde im `app.listen`-Callback.
- `src/server.js`: `makePriceDriftWatch`-Fabrik EINMAL beim Boot verdrahtet (INV-7), `lesePreis` an den Stripe-Adapter gebunden, `durableAudit`, bestehende `messaging`/`mailer`-Instanzen.
- `src/config.js`: zwei neue Env-Werte im `billing`-Namespace — `priceDriftMinIntervalMs` (Default 24h, 0=aus), `priceDriftUnknownEscalateAfter` (Default 3, 0=aus); Korrektur einer jetzt falschen Zusage am `STRIPE_WEBHOOK_SECRET`-Eintrag (Price-Ids sind seit GP-P6 Boot-Pflicht bei aktivem Payment).
- `.env.example`, `render.yaml`: dokumentiert, inkl. Warnzeile ueber den `sync: false`-Price-Keys.

**Tests**: `PLAN_PRICE_BOOT_ENV` als EINE Fixture-Quelle (`test/helpers.js`) statt fuenf Kopien; sechs Bestandstestdateien mussten die neue Boot-Pflicht (Price-Ids) einbinden; `test/ausfall-server-wiring.test.js`, `test/kv-m4-monthly-cross-check.test.js`, `test/sweep-fabrik-vertrag.test.js` um den zehnten Zweig erweitert; neuer Test `test/gp-p6-preis-waechter.test.js` mit 9 benannten Abnahmefaellen (P6-0 bis P6-8), reine Fake-/Injektions-Tests ohne echten Anbieter-Call ausser zwei Boot-Spawn-Faellen.

**Pre-Mortem-Risiken aus dem Plan** (bewusst getragen): Boot-Guard kann den Live-Dienst stillegen, falls eine Render-Price-Id-Env fehlt; ein fortbestehender Preis-Drift meldet sich taeglich neu (24h-Takt > 6h-Entprellung); gestaffelte/metered Stripe-Prices zaehlen als `unbekannt`; Laufzeit-Senkung der Eskalationsgrenze kann den Waechter bis zum naechsten erfolgreichen Lauf verstummen lassen (fail-quiet, dokumentiert).

## Impl-Zusammenfassung

Vollstaendig gemaess Plan umgesetzt, auf Branch `gp/p6` committet (`8d54d9f`). 119 Tests gruen, 0 rot. 20 Dateien beruehrt (2 neu, 18 editiert), keine neue npm-Dependency.

(a) FATAL, netzfrei: `unpricedPlanSlugs` + `assertPricedPlans` wie geplant, Kopfkommentar von `assertBootGates` fortgeschrieben.

(b) BEOBACHTUNG, fail-soft: `price-drift-watch.js` (250 Zeilen), Marker-Namensraum `"price-drift:"` disjunkt von `"drift:"` und dem `NOT_PLACED`-Fehlergrund-Eimer (im Test gepinnt). Verdrahtung wie geplant (zehnter Sweep-Zweig, Boot-Sonde, EINMAL-Fabrik in `server.js`).

### Deviations vom Plan

1. **P6-2 (Abnahme 2)** fuhr mit Mindestfrist 1h statt der 24h-Produktionsfrist — Grund: die Entprellung des geteilten Meldewegs betraegt 6h, ein Lauf 24h spaeter wuerde laut Pre-Mortem 2 ohnehin erneut senden; der Fall misst bewusst innerhalb des Entprell-Fensters.
2. Mehrfach-Lauf-Faelle (P6-2, P6-3, P6-3b, P6-3c) nutzen explizit gestellte Uhr (`nowMs`) statt zurueckdatiertem Lauf-Marker — zwei Laeufe im selben Millisekunden-Tick waren am Marker nicht unterscheidbar (Erstfassung rot). Fabrik-Methoden bleiben in P6-0/P6-1/P6-2b/P6-6 sowie Z-A7 abgedeckt.
3. Zusaetzlich zum Plan musste `test/config-namespaces.test.js` angepasst werden (gepinnte Key-Zahlen: billing 53->55, Gesamt 190->192, primitive Blaetter 178->180) — uebliche Buchfuehrung fuer neue Env-Werte, im Plan nicht aufgefuehrt.
4. Ein selbstreferenzieller Symlink (`ln -s ./node_modules node_modules`) liess `npm run lint`/den pre-commit-Hook mit Exit 194 ohne Ausgabe abbrechen und verdeckte fuenf echte Lint-Fehler. Symlink entfernt, Lint-Fehler behoben (id-length, Demeter-Kette, zwei Magic Numbers). Volles `npx eslint .`: 0 Fehler.
5. `PLAN-SECURITY.md` wurde NICHT angefasst — die Phase entfernt/lockert kein Sicherheits-Gate, sie fuegt eines hinzu (Boot-Refusal) plus einen rein lesenden Beobachter.

### Smoke-Test

Zwei Smokes, kein echter Anbieter-Call: (1) im Testfall selbst — Boot-Refusal bei fehlender `STRIPE_BUSINESS_PRICE_ID` (`exit 1`, keine Listener-Zeile) und normaler Start bei Payment aus (`/healthz` 200). (2) manueller Boot-Smoke gegen `STRIPE_API_BASE=http://127.0.0.1:9` — Server startet normal, Log zeigt fail-soft Fehlerbehandlung und `anlass=boot geprueft=2 abweichungen=0 unbekannt=2`.

## Safety-Urteil

**approved = true**, alle Kern-Flags gruen (Tests unabhaengig reproduziert, Safety-Gates intakt, Offenlegung intakt, Auth fail-closed intakt, keine Secrets geleakt, Scope eingehalten, Verhalten wie spezifiziert). Unabhaengig nachgefahren im frischen Worktree: 126 pass / 0 fail ueber alle betroffenen Testbaenke plus angrenzende Baenke (`ausfall-boot-guard`, `route-auth-inventory`, `plans-catalog`).

**Verdikt: FREIGABE mit Auflage.** Diff-Beleg: `git diff master gp/p6` gegen `src/claude.js`, `src/bridge.js`, `src/route-policy.js`, `src/telephony/`, `src/auth.js`, `src/web-auth.js`, `src/middleware.js`, `src/outbound-gates.js`, `src/number-gate.js`, `src/activation.js`, `src/store/`, `src/routes/`, `src/self-service-routes.js`, `src/callee-is-owner.js`, `src/plans.js`, `apps/` ergibt NULL Zeilen — Offenlegungssatz, Provider-Signaturpruefung, Auth-Middleware, Denylist/Land-Gate/Stundenlimit/Kostendecke/Max-Dauer, Plan-Katalog unberuehrt. Kein neuer Endpunkt, kein `payment_method_types`, keine Denylist-Aenderung, kein Antasten von `invoiceTotal===0`.

**Concerns (keine Blocker):**
1. **DEPLOY-RISIKO (hoechstes der Phase):** `assertPricedPlans` ist FATAL und nicht per Env abschaltbar; haengt allein an `PAYMENT_ENABLED=true`. Fehlt im Render-Dashboard eine `STRIPE_*_PRICE_ID`, verweigert der Live-Dienst nach dem Deploy den Start — Rollback ist ein Code-Revert, kein Env-Flip. **Vor dem Deploy beide Keys im Render-Dashboard sichten.**
2. Kosten-Kanal: ein fortbestehender Preis-Drift meldet sich taeglich neu (bis zu 2 Mails + 2 SMS/Tag) — vom Plan gewollt (Pre-Mortem 2), aber ein kostenpflichtiger Ausgangskanal.
3. `offeneUnbekanntSlots()`/`alarmErlaubt()` lesen `store.load()` ausserhalb `withStoreLock` — nur-lesend, identisch zum Bestandsmuster in `outage-report.js`, kein neuer Defekt.
4. Laufzeit-Senkung von `PRICE_DRIFT_UNKNOWN_ESCALATE_AFTER` kann fail-quiet fuehren — im Modulkopf dokumentiert, akzeptiertes Restrisiko.

## Clean-Code-Audit (S1-S4)

**Verdikt: PASS**, `blocker = false`. S1 = [], S2 = [], S3 = [], S4 = [] — keine Verstoesse.

Begruendung (Kernpunkte): Testabdeckung vollstaendig (16 neue Faelle, gruen isoliert gefahren); keine Duplizierung (`schliesseMarker()` als EINE gemeinsame Formulierung statt zweier `withStoreLock`-Bloecke, `priceIdForPlan()` als EINE Slug->Price-Quelle, `PLAN_PRICE_BOOT_ENV` als einzige Test-Fixture); ausdrucksstarke deutsche Funktionsnamen, G25 (`ERSTER_SLOT` statt nacktem `+1`) und G26 (`UNBEKANNT` statt geratenem Urteil) beachtet; schlanke Struktur mit klar getrennten kleinen Funktionen (SRP), durchgehendes DIP (store/config/audit/messaging/mailer/lesePreis injiziert, P15 erfuellt), kein Zyklus. Fail-soft-Vertrag eingehalten, Boot-Gate zu Recht fatal (rein lokal, kein Netz). Rollback-Hebel vorhanden und getestet. Keine der drei Owner-Blocker-Zonen (`payment_method_types`, Denylist gegen `link`, `invoiceTotal===0`) angefasst. Kein auskommentierter Code, keine TODO/FIXME, keine abgeschalteten Sicherungen.

**Top-TODOs:** keine Blocker offen, mergefaehig. Zwei reine Beobachtungen (kein Fix noetig): Single-Flight/Mindestfrist-Praedikat ist nur innerhalb eines Prozesses hart atomar (uebernommenes Muster); fail-quiet-Restrisiko bei Laufzeit-Senkung der Eskalationsgrenze im Hinterkopf behalten.

## Fix-Runden

Keine Fix-Runden noetig — Impl-Ergebnis ging direkt mit `testsPass=true`, `approved=true` und Clean-Code `PASS` durch. `FIXES`-Abschnitt der Quelle war leer.
