# Phase P2b — Rename `maxBudgetCents` -> `platformSpendCapCents` (rein mechanisch)

**Gate: PASS**
**finalBranch:** `phase/ba-p2b-rename-platform-cap`
**headCommit:** `4ae5e531059cb4541496ac9099836f62b43ffcc8` (kurz `4ae5e53`)
**Basis:** `master` @ `32843a5` (P1 + P2a bereits gemergt)
**Commits:** genau 1
**Umfang:** 20 Dateien (4 `src/`, 16 `test/`), 40 geaenderte Zeilen, 0 Netto-Zeilenaenderung (40 `+` / 40 `-`)

---

## 1. Ziel der Phase

Reiner Bezeichner-Rename des internen Config-Keys `maxBudgetCents` -> `platformSpendCapCents`. Zweck: den Namen der Achse "Betreiber-Notaus" (globaler, geteilter Budget-Topf ueber alle Tenants) klar von der Achse "Nutzer-Kontingent" (`defaultTenantBudgetCents`/`tenantBudgets`) zu trennen — beide Konzepte teilten sich zuvor eine irrefuehrend generische Bezeichnung. Kein Verhaltens-, kein Wert-, kein Env-Wechsel.

---

## 2. Plan (gekuerzt)

### Trefferliste (eigener grep, vor Umsetzung verifiziert)

`grep -rn 'maxBudgetCents' src test` -> 40 Treffer in 20 Dateien.

**`src/` (4 Dateien, 12 Treffer):**

| Datei | Zeile(n) | Art |
| --- | --- | --- |
| `src/config.js` | 108, 379 | Kommentar |
| `src/config.js` | **133** | **Code — rawConfig-Key (die Wurzel)** |
| `src/config.js` | **867** | **Code — `CONFIG_NAMESPACES.billing[0]`** |
| `src/store/defaults.js` | 181, 182, 190 | Kommentar |
| `src/store/defaults.js` | **186, 193** | **Code — zwei Lesestellen (`globalCapEur`, `globalCapCents`)** |
| `src/store/state-ops.js` | 76, 1697 | Kommentar (kein Code-Treffer) |
| `src/db/schema.sql` | 351 | SQL-Kommentar (kein DDL, keine Spalte) |

Genau **zwei** Lesestellen des Keys im Produktivcode existieren (`defaults.js:186`, `:193`). Alle Gate-/Anzeige-Pfade laufen ausschliesslich ueber `globalCapEur`/`globalCapCents`.

**`test/` (16 Dateien, 28 Treffer):** u.a. `_prices.js` (geteilte Fixture, groesster Blast-Radius), `config-money-manifest.test.js` (`MONEY_CONFIG_KEYS`), `config-namespaces.test.js`/`config-shape.test.js` (`removedFlatKeys`-Listen), sowie diverse Gate-/Fixture-Tests (`tenant-budget-cap`, `outbound-reserve-reconcile`, `effective-cap-fallback`, `outbound-budget-concurrency`, `reservation-ledger`, `reservation-json-ephemeral`, `outbound-gates-order`, `budget-nan-fail-closed`, `api-read-parity`, `outbound-tenant-default-budget`, `outbound-tenant`, `config-failclosed`).

### Abgleich gegen den urspruenglichen Plantext

1. **20 statt 18 Dateien.** Zusaetzlich betroffen: `test/budget-nan-fail-closed.test.js` (aus P1) und `test/effective-cap-fallback.test.js` (aus P2a) — beide existierten beim Verfassen des urspruenglichen Plantextes noch nicht. Die 18 Plan-Dateien blieben ansonsten vollstaendig bestaetigt.
2. Der urspruengliche Zeilennummern-Nachtrag des Plantextes war veraltet (verwies auf laengst umgeschriebene Kommentare); im finalen Plan wurden alle Zeilen selbst neu verifiziert.
3. **`maxBudgetEur` ist explizit NICHT Scope dieser Phase** (Treffer in `src/routes/api-read.js`, `src/mcp-tools.js`, `src/ui/widgets/agent-status.html`, diversen Tests) — dem Anhang zufolge Sache einer spaeteren Phase (P5a, `tenantCapEur`/`maxBudgetEur`).
4. `globalCapEur`/`globalCapCents` behalten ihre Funktionsnamen — nur ihre Rumpfe (Objekt-Zugriff) werden angefasst.
5. Planungs-/Historiendokumente (`PLAN-BUDGET-AXES.md`, `PLAN-CLEAN-CODE.md`, `PLAN-FRAGILITY-REMEDIATION.md`, `tasks/*.md`) bleiben unangetastet — datierte Aufzeichnung, ausserhalb des Diff-Scopes.
6. `.env.example` und `render.yaml` bekommen **null** Edits — Name und Wert von `MAX_BUDGET_EUR` bleiben unveraendert (P0 nicht ausgefuehrt).

### Kritische Kopplung (guardedConfig-Falle)

`config.js:133` (rawConfig-Key) und `config.js:867` (`CONFIG_NAMESPACES.billing[0]`) mussten **im selben Commit** geaendert werden: `guardedConfig` wirft bei jedem `get` auf eine Property, die nicht im Zielobjekt existiert. Ein Auseinanderfallen der beiden Stellen haette bedeutet: `config.billing.<key>` wirft `TypeError` bei **jedem** `/api/state`- und `/voice/incoming`-Aufruf.

### Deterministisch pruefbares Ergebnis (Plan-Vorgabe)

```bash
grep -rn 'maxBudgetCents' src test | wc -l          # ERWARTET: 0
grep -rn 'platformSpendCapCents' src test | wc -l   # ERWARTET: 40
grep -rln 'platformSpendCapCents' src test | wc -l  # ERWARTET: 20
git diff -U0 -- src test | grep -E '^[+-]' | grep -Ev '^(\+\+\+|---)' \
  | grep -v 'maxBudgetCents\|platformSpendCapCents'  # ERWARTET: leer
git diff --stat -- .env.example render.yaml         # ERWARTET: leer
```

Plus Boot-Smoke (echter Serverstart, `/healthz`, `/api/state`, `/voice/incoming`) zur Absicherung der guardedConfig-Falle, da `test/api-read-parity.test.js` einen flachen Hand-Mock ohne echten Proxy nutzt.

---

## 3. Impl-Zusammenfassung

Phase exakt gemaess Plan umgesetzt. Trefferliste per eigenem grep bestaetigt: 40 Vorkommen in 20 Dateien (4 `src/`, 16 `test/`), alle Zeilennummern deckungsgleich mit dem Plan. Token-Substitution in zwei Stufen (erst `src/`, dann `test/`), dazwischen `redBeforeFixProof` erhoben.

- **Ein** Commit auf `phase/ba-p2b-rename-platform-cap`, HEAD `4ae5e53`.
- `node --check` auf allen 3 relevanten src-Dateien: PASS.
- `npm test`: **2555/2555** gruen, 0 Fehlschlaege.
- `config.js:133` + `config.js:867` + `defaults.js:186/:193` + `MONEY_CONFIG_KEYS:19` wie geplant atomar im selben Commit (guardedConfig-Falle + Manifest-Gate).
- ENV `MAX_BUDGET_EUR` unangetastet: `.env.example:6` (`=8`), `render.yaml:236` (`value: "8"`), `config.js` 2x (Kommentar + `numEnv`-Fallback).
- Null-Semantik-Beweise bestanden: Diff enthaelt ausschliesslich die beiden Tokens; 40 `-maxBudgetCents` / 40 `+platformSpendCapCents`; 20-Dateien-Stat mit 0 Netto-Zeilenaenderung.
- Boot-Smoke nach vollstaendigem Rename: `/healthz` -> `{"ok":true}`; `/api/state` -> `"maxBudgetEur": 8` (deckt `defaults.js` `globalCapEur` ueber den echten `guardedConfig`-Proxy, kein `TypeError`, kein `null`); `/voice/incoming` mit passender Zielnummer -> 200 mit TwiML-Gather (deckt `globalCapCents`/`globalBudgetExceeded` auf dem Inbound-Pfad). Server danach gestoppt; der scratchpad-Store hat `data/store.json` zu keinem Zeitpunkt beruehrt.

### Deviations

1. **Keine inhaltliche Abweichung vom Plan.** Ein zusaetzlicher, vom Plan mechanisch vorhergesagter (aber nicht explizit tabellierter) Befund im `redBeforeFixProof`: `test/store-pg-tenant-budget.test.js` und `test/store-pg.test.js` gingen in Stufe 1 ebenfalls rot (3 Faelle), obwohl beide den String `maxBudgetCents` nicht direkt enthalten — sie konsumieren die Fixture `PRICES` aus `test/_prices.js` als cfg-artiges Objekt in `ops.budgetExceeded`/`globalBudgetExceeded`. Kein Plan-Fehler, sondern eine Praezisierung des im Plan bereits benannten fail-open-Mechanismus (Pre-Mortem-Punkt b).
2. Vor-existierende, im Plan bereits explizit als Nicht-Scope benannte veraltete Kommentare (`test/outbound-tenant-default-budget.test.js:3` mit dem nicht mehr existierenden Symbol `effectiveCapEur`; `src/routes/api-calls.js:18`) wurden wie vorgegeben **nicht** angefasst.
3. Zusaetzliche Dateien `test/budget-nan-fail-closed.test.js` und `test/effective-cap-fallback.test.js` gegenueber der urspruenglichen 18-Dateien-Planliste — beides Artefakte der zwischenzeitlich gemergten Phasen P1/P2a, korrekt vom grep-Ansatz eingefangen (siehe Plan-Abschnitt).

---

## 4. Rot-vor-Fix-Beleg (redBeforeFixProof)

Zweistufiges Protokoll im Worktree erhoben (nicht committet):

**Stufe 1** — nur die 4 `src/`-Dateien umbenannt, `test/` unangetastet: `npm test` -> 2555 Tests, **2535 pass, 20 fail** in 11 Dateien.

Rote Faelle im Einzelnen:
- `test/config-money-manifest.test.js` — **2 Faelle, der beabsichtigte Manifest-Gate**: "jedes Cents-Feld ist im Manifest erfasst" (`platformSpendCapCents` matcht `/Cents$/`, steht noch nicht in `MONEY_CONFIG_KEYS`) und "kein gelistetes Feld wurde stillschweigend entfernt" (`maxBudgetCents` steht nicht mehr in `CONFIG_NAMESPACES`).
- `test/api-read-parity.test.js` — 1 Fall: Fake-Config traegt weiter den alten Key -> `globalCapEur` liefert `NaN`/`null` statt `8`.
- `test/tenant-budget-cap.test.js`, `test/outbound-reserve-reconcile.test.js`, `test/effective-cap-fallback.test.js`, `test/outbound-gates-order.test.js`, `test/budget-nan-fail-closed.test.js` — zusammen mehrere Faelle: cfg-Fixture traegt den alten Key -> `globalCapCents(cfg)` liefert `undefined` -> das Budget-Gate faellt **fail-OPEN** (`total >= undefined` ist `false`).
- Ueber die gemeinsame Fixture `test/_prices.js`: `test/reservation-ledger.test.js` (4), `test/outbound-budget-concurrency.test.js` (2), `test/store-pg-tenant-budget.test.js` (2), `test/store-pg.test.js` (1) — letztere zwei enthalten den String nicht direkt, sind aber ueber die Fixture betroffen (siehe Deviation 1). Isoliert erneut mit `node --test test/store-pg-tenant-budget.test.js test/store-pg.test.js` bestaetigt: 3 fail, reproduzierbar, kein Flake.

Nicht rot, aber Pflicht-Edit (im Plan explizit benannt, damit nichts als "vergessen" gilt): `test/config-namespaces.test.js:146`, `test/config-shape.test.js:110` — beide behaupten nur, der Key sei auf der flachen Oberflaeche nicht zugreifbar, was fuer alten wie neuen Namen gilt; Edit noetig, damit die Regression weiter auf den lebenden Key statt ein totes Symbol zeigt.

**Stufe 2** — alle 16 geplanten Testdateien nachgezogen: `npm test` -> **2555/2555**, 0 Fehlschlaege.

Vollstaendigkeits-Beweise (selbst ausgefuehrt): `grep 'maxBudgetCents' src test` = 0; `grep 'platformSpendCapCents' src test` = 40 Treffer / 20 Dateien; `git diff -U0 -- src test | grep -E '^[+-]' | grep -Ev '^(\+\+\+|---)' | grep -v 'maxBudgetCents\|platformSpendCapCents'` = leer; je 40 `-maxBudgetCents` und 40 `+platformSpendCapCents`-Zeilen; `.env.example`/`render.yaml`-Diff leer; `MAX_BUDGET_EUR=8` unveraendert; 2x `MAX_BUDGET_EUR` in `config.js`.

---

## 5. Safety-Urteil (final)

**APPROVED** — keine Blocker.

- `testsPassIndependently`: true — eigener `npm test`-Lauf im frischen Worktree: 2555/2555, 0 Fail, 0 cancelled, 0 skipped, 75.4s, erster Lauf gruen (kein Flake aufgetreten).
- **Boot ausfuehrbar belegt** (nicht nur Test-gruen): echter Kindprozess auf freiem Port, `SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-Env, Temp-Datenverzeichnis. `GET /healthz` -> 200; `POST /voice/incoming` -> 200 TwiML (laeuft durch `budgetExceeded -> effectiveCapCents -> globalCapCents(cfg) -> cfg.platformSpendCapCents` — liest den umbenannten Key zur Laufzeit). Kein FATAL/TypeError im Boot-Log.
- `guardedConfig`-Proxy direkt geprueft: `config.billing.platformSpendCapCents === 800` bei `MAX_BUDGET_EUR=8`; `globalCapCents(cfg)=800`, `globalCapEur(cfg)=8`; `config.billing.maxBudgetCents` wirft korrekt `TypeError` — der alte Name ist tot, der Proxy ist scharf.
- Rot-vor-Fix selbst reproduziert: master-Versionen der drei Money-Manifest-/Namespace-Testdateien gegen umbenannte `src` gelaufen -> 24 Tests, 22 pass, **2 fail** (exakt die beiden Money-Manifest-Faelle) — der beabsichtigte Reibungspunkt ist real, nicht aufgeweicht.
- `disclosureIntact`, `authFailClosedIntact`, `behaviorAsIntended`, `noSecretsLeaked`, `scopeRespected`: alle true. `src/claude.js`, `src/auth.js`, `src/web-auth.js`, `src/routes/`, `src/telephony/` sind nicht im Diff.
- Null-Verhaltensaenderung mechanisch bewiesen (haertester Punkt): Branch-Versionen aller 20 Dateien zurueckuebersetzt (`platformSpendCapCents` -> `maxBudgetCents`) und gegen `master` gedifft -> **Restdiff leer ueber alle 20 Dateien**. Damit strukturell ausgeschlossen, dass sich neben dem Bezeichner irgendein Byte Semantik geaendert hat.

**Concerns (nicht blockierend):**
1. Guard-Netz duenner als der urspruengliche Plan annahm: nur `config-money-manifest.test.js` wird beim Rename tatsaechlich rot; `config-namespaces.test.js`/`config-shape.test.js` bleiben gruen (ihre `removedFlatKeys`-Behauptung gilt fuer alten wie neuen Namen gleichermassen). Aenderung an diesen beiden Dateien bleibt trotzdem korrekt (sie pinnen jetzt den lebenden statt eines toten Namens) — aber kuenftige Renames sind primaer durch das Money-Manifest gedeckt, nicht durch drei Gates.
2. Alter Name lebt in 16 Treffern historischer Planungsdokumente weiter (`PLAN-FRAGILITY-REMEDIATION.md`, `PLAN-CLEAN-CODE.md`, `PLAN-BUDGET-AXES.md`, `tasks/todo.md`, u.a.) — Akzeptanzkriterium war explizit auf `src test` begrenzt und ist erfuellt; `PLAN-BUDGET-AXES.md` beschreibt an einer Stelle den jetzt aktuellen Zustand noch mit dem toten Bezeichner — Kosmetik fuer eine spaetere Doku-Runde, kein Blocker.
3. `test/effective-cap-fallback.test.js` und `test/budget-nan-fail-closed.test.js` standen nicht auf der urspruenglichen 18-Dateien-Planliste (Artefakte der zwischenzeitlich gemergten Phasen P1/P2a) — korrekt vom grep-Ansatz erfasst.

---

## 6. Clean-Code-Audit (final)

**Verdict: PASS — sauberer, rein mechanischer Rename.**

- **s1 (Blocker):** — leer
- **s2:** — leer
- **s3:** — leer
- **s4:** — leer
- **blocker:** false

**passNotes:** Vollstaendigkeits-Check per `git grep -n maxBudgetCents` auf dem Branch-Tree (`src/`, `test/`, `public/`) liefert 0 Treffer — keine halbfertigen Renames, kein vergessener Kommentar/Testname. Verbleibende Vorkommen liegen ausschliesslich in bereits vor dieser Phase committeten, unveraenderten Planungs-/Historiendokumenten (ausserhalb des Diff-Scopes, Regel 5 des Plans).

Namensgebung (N1/N2): `platformSpendCapCents` trennt die beiden zuvor konflierten Achsen sauber — "platform" signalisiert eindeutig den Betreiber-/Notaus-Scope, im Gegensatz zur unveraendert tenant-scoped benannten Gegenseite `defaultTenantBudgetCents`/`tenantBudgets`.

C2 (veraltete Kommentare): keine neuen datei:zeile-Referenzen in den 20 geaenderten Dateien eingefuehrt; vorhandene Muster im Repo sind vorbestehend und ausserhalb dieses Diffs.

ENV-Name `MAX_BUDGET_EUR` bewusst unveraendert (Begruendung: Env-Rename auf dem Dashboard-managed Dienst ohne Shell wuerde zwei Cap-Quellen erzeugen). Externer API-/MCP-Kontrakt (Feld `maxBudgetEur`) bewusst unangetastet, wie im Plan als Akzeptanzkriterium festgehalten.

Verifikation vom Auditor selbst durchgefuehrt (nicht nur Commit-Behauptung uebernommen): Branch in separatem detached Worktree ausgecheckt, `node --check` auf alle 3 src-Dateien gruen, volle Suite `npm test` gelaufen -> 2555/2555 gruen.

**topTodos:**
- Kein Muss-To-do fuer diese Phase selbst (Diff ist vollstaendig und verhaltensneutral).
- Optional/spaeter: `tasks/todo.md`-P2-Eintrag traegt noch den alten Zwischennamen als Ziel-Bezeichnung und ein leeres Ergebnis-Feld — beim naechsten Phasen-Abschluss-Update nachziehen (keine Blocker, reine Doku-Pflege).
- Bei P2c/Folgephasen: den in P2b etablierten Vollstaendigkeits-Check (`grep -rn '<alter Name>' src test` -> 0 Treffer) weiterhin als Akzeptanzkriterium fuer jeden Rename uebernehmen.

---

## 7. Fix-Runden

**Keine.** Impl -> Safety-Review -> Clean-Code-Audit liefen alle im ersten Anlauf gruen (PASS ohne Blocker in beiden Reviews); der `=== FIXES ===`-Abschnitt des Workflows blieb leer. Kein Self-Fix-Zyklus noetig.

---

## 8. Offene Deploy-Vorbedingungen

- Phase steht auf dem eigenstaendigen Branch `phase/ba-p2b-rename-platform-cap` (HEAD `4ae5e53`), Basis `master @ 32843a5`. **Noch nicht auf `master` gemergt** — vor jedem Deploy zunaechst Merge in `master` erforderlich.
- Da Render (`hermes-web`/Live-Dienst) laut bestehendem Deploy-Split ueber ein separates `upstream`-Remote deployt (nicht `origin`): nach dem Merge zusaetzlich `git push upstream master` noetig, sonst bleibt die Aenderung ohne Live-Wirkung. Live-Commit nach Deploy per `[boot]`-Banner im Server-Log verifizieren.
- **Keine Render-Dashboard-Env-Aenderung noetig** — `MAX_BUDGET_EUR` bleibt Name und Wert (`8`) unangetastet; kein Config-Drift zwischen Code und Dashboard-Env zu erwarten.
- Keine Schema-/DB-Migration noetig — `src/db/schema.sql`-Aenderung ist ein reiner Kommentar, kein DDL.
- Da die Phase ein beweisbar reiner, verhaltensneutraler Bezeichner-Rename ist (Restdiff nach Rueckuebersetzung leer), besteht kein erhoehtes Rollout-Risiko gegenueber vorangegangenen Phasen; ein gesonderter Canary- oder Feature-Flag-Rollout ist nicht vorgesehen und nicht erforderlich.
