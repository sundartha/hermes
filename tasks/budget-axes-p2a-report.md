# Phase P2a — Tenant-Achse bindet (Fallback auf Tenant-Default statt geteilten Topf)

**Datum:** 2026-07-19
**Gate:** PASS
**finalBranch:** `phase/ba-p2a-tenant-achse-fix1`
**headCommit:** `270301868727d6704fc9d9ad687cd9b28a7d4293`
**Verifiziert gegen:** `master @ b45d8c4` (P1 bereits gemergt)

---

## 1. Zusammenfassung

P2a schliesst Lücke D3 aus dem Gesamtplan: bisher fiel **jeder** Tenant ohne eigene `tenant_budget`-Zeile in `effectiveCapCents` direkt auf den globalen Plattform-Cap (`globalCapCents`) zurück. Der als "pro-Tenant-Kostendecke" gedachte Konfigurationswert `defaultTenantBudgetCents` wirkte damit nur beim einmaligen Seed neuer Tenants — für den Bestand war die Tenant-Achse faktisch tot, der Cap ein **geteilter Topf** über alle Tenants ohne Zeile.

Die Phase führt eine dritte, mittlere Präzedenzstufe in `effectiveCapCents` ein:

1. existiert eine `tenant_budget`-Zeile → deren `hardCapCents`
2. **NEU:** sonst `cfg.defaultTenantBudgetCents`, aber nur wenn `> 0` (0-Sentinel-Schutz)
3. sonst weiterhin `globalCapCents(cfg)` (Bestandsverhalten)

Der globale Plattform-Cap bleibt **parallel** über `globalBudgetExceeded`/`globalReserveExceedsBudget` bestehen (Schnittmenge, Absolute Regel 1 aus CLAUDE.md) — kein Gate wird entfernt oder ersetzt, es kommt nur eine zusätzliche, engere Decke hinzu.

---

## 2. Plan (gekürzt)

### Zentrale Code-Befunde vor Umsetzung

- **B1:** Keine Signaturänderung nötig — `cfg` ist an allen drei realen Aufrufstellen (`telnyx-llm-shim.js`, `telephony/outbound-gates.js`, `routes/voice.js`) bereits `config.billing`, und `defaultTenantBudgetCents` liegt bereits in diesem Namespace.
- **B2:** Die Bestandssuite bleibt byte-identisch grün, ohne eine Testdatei anzufassen — alle bestehenden Fixturen (`PRICES`, diverse `{ maxBudgetCents: … }`-Objekte) kennen das neue Feld gar nicht; `undefined > 0 === false` fällt auf den alten Zweig zurück.
- **B3:** Der ursprüngliche Plantext-Formulierung für den dritten Rot-vor-Fix-Fall ("Cross-Tenant heute rot") war am Code bereits **grün** — `budgetExceeded`/`reserveExceedsBudget` lesen ausschliesslich den eigenen Bucket/die eigene Reserve des jeweiligen Tenants, nie den eines anderen. Die Formulierung wurde für einen echt roten Test umgeschrieben (siehe Deviations).
- **B4:** `effectiveCapCents` ist modul-privat und bleibt es — kein Export nur für Testbarkeit. Verifikation über Grenzabtastung an den zwei öffentlichen Lesern (`cap-1` frei, `cap` gesperrt).
- **B5:** Deploy ist in beiden möglichen Live-Konstellationen sicher (Live-Default 0 → No-Op; Live-Default > 0 → durch die Schnittmenge mit dem Plattform-Cap nie schwächer als heute).

### Geplante Edits

1. `src/store/state-ops.js` — Kernlogik in `effectiveCapCents` (neue Präzedenzstufe, ausführlicher Sicherheitskommentar zum 0-Sentinel) + zwei veraltete Kommentare (`budgetExceeded`, `seedTenantDefaultBudget`) nachgezogen.
2. `src/config.js` — Kommentar bei `defaultTenantBudgetCents` erweitert (zwei Wirkungen: Seed + Gate-Fallback).
3. `.env.example` — Kommentar präzisiert, **kein Wertwechsel**.
4. `render.yaml` — bewusst unverändert (Owner-Vorgabe: P0 nicht Teil dieser Phase).
5. `test/helpers.js` — bewusst unverändert (`DEFAULT_TENANT_BUDGET_CENTS="0"` bleibt in BASE_ENV).
6. `PLAN-SECURITY.md` — Pflichtergänzung zur Tenant-Achse.
7. Neue Testdatei `test/effective-cap-fallback.test.js` (5 Tests: 0-Sentinel-Regression, Fallback-Effekt, Cross-Tenant-Effekt, Präzedenz, cfg-ohne-Feld-Bestandsschutz).

Ausdrücklich **nicht angefasst:** `src/store/defaults.js`, `src/store/json.js`, `src/store/pg.js`, `src/store.js`, `src/routes/*`, `src/telephony/outbound-gates.js`, `src/db/schema.sql`.

---

## 3. Implementierungs-Zusammenfassung

- `effectiveCapCents` (src/store/state-ops.js) implementiert exakt die geplante dreistufige Präzedenz. Der neue Zweig ist ein einzeiliger Ternary auf derselben Verschachtelungsebene wie der Bestand (Tiefe 1).
- Zwei überholte Kommentare aktualisiert (`budgetExceeded`, `seedTenantDefaultBudget`).
- `src/config.js`-Kommentar bei `defaultTenantBudgetCents` erweitert (Doppelrolle Seed + Gate-Fallback, 0-Sentinel-Warnung).
- `.env.example`-Kommentar präzisiert, kein Wertwechsel bei `MAX_BUDGET_EUR` oder `DEFAULT_TENANT_BUDGET_CENTS`.
- `PLAN-SECURITY.md` um neuen Abschnitt "P2A-TENANTFALLBACK" ergänzt.
- Neue Testdatei `test/effective-cap-fallback.test.js` mit 5 Tests, belegt Rot-vor-Fix und Grün-nach-Fix.
- Runde-1-Fix (auf Review-Blocker G5): neuer privater Helfer `tenantBudgetRow(s, tenantId)` konsolidiert die zuvor dreifach duplizierte `s.tenantBudgets.find(...)`-Suche.

### Ergebniszahlen

- `node --check` auf `src/store/state-ops.js` und `src/config.js`: sauber.
- Volle Suite dreifach reproduziert: **2555/2555**, 0 Fehler (Baseline auf `b45d8c4` selbst gemessen: 2550/2550 → exakt +5 wie geplant).
- Betroffener Bestandsblock (`tenant-budget-cap.test.js` + `outbound-tenant-default-budget` + `outbound-reserve-reconcile` + `reservation-ledger` + `outbound-budget-concurrency` + `config-money-manifest`): unverändert **41/41**.
- `git diff --stat`: genau 5 Dateien (4 geändert + 1 neu) — deckt sich mit dem Plan-Scope-Beweis.
- Ein Zwischenlauf zeigte 2 rote Tests (`cq-p6-mandate-http`, `dial-target-normalization`) — beide isoliert sofort grün; identifiziert als bekannter ~12 %-Voll-Last-Flake (Seed-vor-Boot-Race, Lehre `suite-flake-p5-gate-proof`), nicht durch diese Phase verursacht.

### Deviations gegenüber Plantext

1. **Rot-vor-Fix-Fall 3 umformuliert.** Die wörtliche Plan-Formulierung (`budgetExceeded(B)===false`, `reserveExceedsBudget(B,60)===false` bei A=900 Cent Verbrauch) war am Code bereits vor dem Fix grün, weil beide Gates ausschliesslich Bucket/Reserve des jeweiligen Tenants selbst lesen. Die Formulierung wurde durch eine echt rote Assertion ersetzt (`reserveExceedsBudget(B, TenantDefault+1)`); die ursprüngliche Plan-Formulierung bleibt im selben Test als Isolations-Regressionsanker erhalten.
2. **`test/helpers.js` BASE_ENV bleibt `DEFAULT_TENANT_BUDGET_CENTS="0"`.** Begründet: Ein Nachzug auf 1000 wäre gegen `MAX_BUDGET_EUR="8"` (800 Cent) in derselben BASE_ENV sofort inert (Tenant-Default ≥ Plattform-Cap → Schnittmenge bindet weiter am globalen Cap) und zugleich exakt die Konstellation, die eine künftige P3-Boot-Guard-Klausel als `exit(1)` klassifizieren soll. Kohärent nur zusammen mit P0 (Anhebung von `MAX_BUDGET_EUR`), das nicht Teil dieser Phase ist.
3. **`effectiveCapCents` nicht exportiert.** Verifikation stattdessen über Grenzabtastung an den zwei öffentlichen Lesern (`budgetExceeded`, `reserveExceedsBudget`).
4. **`render.yaml` unverändert** (Owner-Vorgabe: P0 nicht ausgeführt). Offen dokumentierte Inkohärenz: `.env.example`/`render.yaml` versprechen `DEFAULT_TENANT_BUDGET_CENTS=1000` bei `MAX_BUDGET_EUR=8` (800 Cent) — die Tenant-Achse bleibt in dieser Musterkonfiguration inert. Vor einer künftigen P3-Boot-Guard-Phase muss das entweder über P0 oder durch Absenken des Default-Werts aufgelöst werden.
5. **`PLAN-SECURITY.md`-Ergänzung** eigenständig formuliert (Plan gab nur die inhaltliche Pflicht "ein Absatz" vor, keine Textvorlage), nach Muster der bestehenden P7A-Sektion.

---

## 4. Rot-vor-Fix-Beleg

**Vor dem `state-ops.js`-Edit** (Autor, isolierter Lauf der neuen Datei):

```
NODE_ENV=test node --test test/effective-cap-fallback.test.js
ℹ tests 5
ℹ pass 3
ℹ fail 2
```

Rot: *"Fallback (P2a): ohne tenant_budget-Zeile bindet die Tenant-Default-Decke"* (AssertionError: erwartet `true`, tatsächlich `false`) und *"Cross-Tenant (P2a): B wird an SEINER Decke gemessen, nicht am geteilten Topf"* (AssertionError: erwartet `true`, tatsächlich `false`). Grün vor Fix: 0-Sentinel-Test, Präzedenz-Test, cfg-ohne-Feld-Test.

**Nach dem Edit:** dieselbe Datei liefert `tests 5 / pass 5 / fail 0`.

**Unabhängig durch den Safety-Reviewer reproduziert** (nicht nur gelesen): `src/store/state-ops.js` auf `master`-Stand zurückgesetzt, Testdatei erneut gelaufen → identisch 5/3/2 mit denselben beiden roten Tests; anschliessend Arbeitsbaum wiederhergestellt.

---

## 5. Safety-Urteil

**Verdikt: APPROVED.**

Wesentliche Prüfpunkte (vom Reviewer selbst nachgemessen, nicht nur gelesen):

- **0-Sentinel korrekt implementiert:** `tenantDefaultCents > 0 ? tenantDefaultCents : globalCapCents(cfg)` ist nicht bedingungslos. Bei `defaultTenantBudgetCents=0` liefert `effectiveCapCents` exakt `globalCapCents` — durch Grenzabtastung 799/800 gegen die echten Live-Werte (`MAX_BUDGET_EUR=8` → 800 Cent) festgenagelt. Für einen unverbrauchten Tenant: `budgetExceeded=false`, `reserveExceedsBudget(60)=false`, `tryReserveOutboundBudget=true`. Der befürchtete Totalausfall der Telefonie (Outbound gesperrt, kostenloser Inbound abgewiesen, laufende Calls legen auf) tritt nicht ein.
- **Entartete cfg-Werte** (NaN, -1, -1000, null, undefined, "", false) landen alle über `x > 0 === false` auf `globalCapCents` — nie auf einem 0-Cap. Die Abweichung geht immer Richtung Bestandsverhalten.
- **Schnittmenge erhalten:** `globalCapCents` bleibt parallel über `globalBudgetExceeded`/`globalReserveExceedsBudget`; `tryReserveOutboundBudget` prüft weiterhin beide Achsen mit ODER. Ein Tenant mit eigener Zeile `hardCapCents=100000` wird gegen den Plattform-Cap 800 nachweislich gestoppt.
- **Fuzz-Test** über >500 Kombinationen aus Default-Wert und Zwei-Tenant-Verbrauch (ausgewertet auf der kombinierten Entscheidung der drei realen Aufrufer): kein Zustand gefunden, in dem `master` blockt und der neue Code durchlässt.
- **Präzedenz unverändert:** eine `tenant_budget`-Zeile schlägt sowohl Default als auch Plattform-Cap, in beiden Richtungen geprüft.
- **Scope sauber:** kein Backfill, kein SQL, keine Migration, kein Rename bestehender Felder, keine neue Dependency. Disclosure, Auth, Signaturprüfung, Denylist/Land/Stundenlimit/Max-Dauer nicht angefasst.
- **Unabhängige Volltests:** frischer Worktree, volle Suite 2555/2555, 0 Fehler, 78,2 s, kein Flake.

### Concerns (nicht blockierend, Betriebs- statt Code-Blocker)

1. `.env.example` widerspricht sich selbst: die neu eingefügte Regel ("sinnvoll nur echt kleiner als `MAX_BUDGET_EUR*100`") steht neben einem unverändert belassenen Beispielwert, der genau das verletzt (1000 Cent Default gegen 800 Cent Plattform-Cap).
2. Prod-No-Op bis P0/P3: solange der Live-Wert von `DEFAULT_TENANT_BUDGET_CENTS` 0 ist (starkes Indiz laut Plan), ist P2a ein reiner Code-Riegel ohne Live-Wirkung.
3. Plan-Vorbedingung "Abstandsprüfung" ist nicht durch diese Phase abgedeckt: sobald ein positiver Zielwert live gesetzt wird, muss vorher gegen die dann aktuellen Verbrauchszahlen geprüft werden, dass kein Bestands-Tenant sofort gesperrt wird.
4. Kosmetisch: Commit-Präfix des ersten Commits verwendet ein anderes Ketten-Kürzel als der Fix-Commit.
5. Kosmetisch: der Fix-Commit (G5-Konsolidierung) hat einen leeren Commit-Body auf einem Geld-Pfad; inhaltlich als reines verhaltens-erhaltendes Dedup separat geprüft und für unbedenklich befunden.

---

## 6. Clean-Code-Audit (final)

- **S1 (Blocker):** keine
- **S2 (Blocker):** keine
- **S3 (Nitpick):** eine — lokale Variable in `effectiveCapCents` heisst `budget`, hält aber (nach der `tenantBudgetRow`-Extraktion) eine Row/einen Record statt eines Geldbetrags; Umbenennung zu `row`/`tenantRow` empfohlen, nicht blockierend.
- **S4:** keine

**Verdikt: PASS.** Für eine Änderung an einem sicherheitskritischen Budget-Gate ungewöhnlich sauber. G5-Duplizierung wurde im Rahmen des Reviews selbst behoben (Runde 1: `tenantBudgetRow`-Helfer). Das 0-Sentinel-Verhalten ist mit 5 Tests inklusive Grenzabtastung abgesichert. `PLAN-SECURITY.md` wurde aktualisiert, inklusive ehrlich dokumentierter Live-Inkohärenz.

Explizit geprüfte Schwerpunkte:
- **G25 (Magic Numbers/0-Sentinel):** PASS — der bare `0`-Vergleich ist ein im selben Modul etabliertes, wiederkehrendes Idiom (10+ analoge Stellen mit Prosakommentar statt benannter Konstante); eine neue Konstante nur an dieser Stelle wäre eine Inkonsistenz zum Bestand gewesen.
- **N7 (Achsen-Klarheit Tenant vs. Plattform):** PASS — Kommentar-Label, Variablenname `tenantDefaultCents` und Helfername `tenantBudgetRow` machen die Achse an jeder Stelle ohne Nachschlagen erkennbar.

### Top-TODOs (nicht blockierend, für Folgephasen)

1. Die in `PLAN-SECURITY.md` selbst dokumentierte Inkohärenz (Live `MAX_BUDGET_EUR=8` vs. `DEFAULT_TENANT_BUDGET_CENTS=1000`) vor einem Wirkungs-relevanten Deploy auflösen.
2. Variable `budget` in `effectiveCapCents` zu `row`/`tenantRow` umbenennen.
3. Optional: Boot-Log/Config-Assertion, wenn `DEFAULT_TENANT_BUDGET_CENTS` (in Cent) über `MAX_BUDGET_EUR*100` konfiguriert ist, um die "wirkungslos"-Falle operational sichtbar zu machen statt nur in der Doku.

---

## 7. Fix-Runden

- **Runde 1:** einziger gemeldeter Blocker war eine G5-Duplizierung (dreifacher, wortgleicher `s.tenantBudgets.find(...)`-Lookup). Behoben durch neuen privaten Helfer `tenantBudgetRow(s, tenantId)` in `src/store/state-ops.js`, an allen drei Stellen eingesetzt (u. a. `seedTenantDefaultBudget`). Nach dem Fix: Clean-Code-Verdikt PASS, keine weiteren Blocker.

---

## 8. Offene Deploy-Vorbedingungen

Diese Punkte sind **nicht** Teil dieses Commits und müssen vor einer live wirksamen Aktivierung geklärt werden:

1. **Live-Wert setzen:** `DEFAULT_TENANT_BUDGET_CENTS` muss im Render-Dashboard auf einen positiven Wert gesetzt werden, damit die neue Präzedenzstufe überhaupt greift (Indiz: Live-Wert ist aktuell 0, entsprechend 0 gesetzte `tenant_budget`-Zeilen).
2. **Abstand zu `MAX_BUDGET_EUR` einhalten:** der Zielwert muss echt kleiner als `MAX_BUDGET_EUR*100` sein, sonst bindet weiterhin ausschliesslich der globale Plattform-Cap und die Tenant-Achse bleibt wirkungslos (aktuell dokumentierte Inkohärenz: 1000 Cent Beispielwert vs. 800 Cent Live-Plattform-Cap).
3. **Abstandsprüfung gegen aktuelle Verbrauchszahlen:** vor dem Hochsetzen des Live-Werts muss gegen die dann aktuellen Lebenszeit-Verbrauchszahlen aller Tenants geprüft werden (Produktions-DB-Abfrage), dass kein Bestands-Tenant im Deploy-Moment durch den neuen, engeren Cap sofort gesperrt wird (zuletzt bekannter Höchstwert deutlich unter jedem plausiblen Zielwert, aber erneute Prüfung zum Zeitpunkt der Aktivierung nötig).
4. **`.env.example`-Widerspruch auflösen:** entweder den Beispielwert senken oder im Rahmen von P0 `MAX_BUDGET_EUR` anheben, damit Beispieldatei und neu dokumentierte Regel nicht gegeneinander stehen.
5. **Abhängigkeit zu P0/P3:** die volle Wirkung dieser Phase hängt von einer noch ausstehenden P0-Entscheidung (Anhebung `MAX_BUDGET_EUR`) und einer künftigen P3-Boot-Guard-Klausel ab, die genau diese Inkohärenz als Startabbruch behandeln soll.
