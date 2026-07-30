# KS-P6 — Tarif-Fallback im Code auf den gemessenen Wert (30 statt 300 ct/min)

Basis: `master` = `7c3d651` (identisch mit `git rev-parse HEAD` vor dem ersten Edit,
verifiziert per `git rev-parse HEAD` / `git rev-parse master`).

---

## 1. Was geaendert wurde

Genau **eine** Verhaltensaenderung: der `numEnv`-Fallback von `VOICE_TARIFF_DEFAULT_CENTS`
faellt von 300 auf 30 ct/min (`src/config.js`). Gleichgezogen: `.env.example`,
`render.yaml` (dieselbe Zahl an drei Stellen, von `test/env-docs-spend-cap-coherence.test.js`
geprueft). Alle uebrigen Edits sind reine Kommentarpflege (Herleitungs-Kommentare, die noch
"300 * 5 = 1500" ausschrieben, nachgezogen auf "30 * 5 = 150"):

- `src/config.js`: Kommentar an `voiceTariffDefaultCents` (neu, KS-P6/E1) und an
  `defaultTenantBudgetCents` (Klausel-B-Rechnung nachgezogen; zusaetzlich die laengst
  veraltete Klausel-A-Behauptung entfernt, die seit KS-P9/E10 bereits in `boot-guard.js`
  nicht mehr existiert — reiner Kommentar-C2-Fix, kein Verhalten).
- `.env.example`, `render.yaml`: Werte 300 -> 30 + Herleitungs-Kommentare.
- `src/telephony/outbound-gates.js`: Zahlenbeispiel im Kommentar ("20 statt 300 ct/min" ->
  "20 statt 30 ct/min").
- `src/billing/cost-calibration.js`: veraltetes Zahlenbeispiel im Kommentar entfernt
  (`voiceTariffDefaultCents = 300 ct` -> `voiceTariffDefaultCents` ohne Zahl — C2, die Zahl
  hatte keinen Erklaerwert ueber den Symbolnamen hinaus und waere beim naechsten
  Satzwechsel wieder verrottet).
- `test/ks-p5a-plan-cap-carries-sold-minutes.test.js`: nur der Kommentar ueber
  `BOOKING_RATES_CENTS_PER_MIN` (der Array-Inhalt `[300, 30]` bleibt unveraendert — die
  Bandbreite ist der Wert dieses Tests).
- `PLAN-SECURITY.md`: `KS-P5a`-Abschnitt korrigiert ("heutiger Code-Fallback" ->
  "Stand vor KS-P6", da 300 nach dieser Phase nicht mehr der Code-Fallback ist) + neuer
  Abschnitt `## KS-P6` am Dateiende.
- `test/env-docs-spend-cap-coherence.test.js`: neuer Test (Mutationsprobe, siehe unten).

Keine Produktionsdatei neu angelegt (ein reiner Default-Wert-Wechsel rechtfertigt kein
neues Modul).

---

## 2. Mutationsprobe (V2, vor den Werte-Edits gefahren)

Der neue Test pinnt die konkrete Zahl 30 an allen drei Quellen (nicht nur "alle drei
stimmen untereinander ueberein" — das waere auf `master` bei 300/300/300 bereits gruen
gewesen und haette nichts bewiesen).

Ablauf: Testcode zuerst eingefuegt, dann per `git stash push -- src/config.js .env.example
render.yaml` die drei Wertequellen auf den `master`-Stand (300) zurueckgesetzt und
`node --test test/env-docs-spend-cap-coherence.test.js` gefahren:

```
✖ KS-P6: der ausgelieferte Worst-Case-Tarif ist 30 ct/min - dieselbe Zahl in allen drei Quellen
  AssertionError [ERR_ASSERTION]: src/config.js numEnv-Fallback
  300 !== 30
ℹ tests 5
ℹ pass 4
ℹ fail 1
```

**ROT** wie erwartet. Anschliessend `git stash pop` (alle drei Werte-Edits wiederhergestellt,
`git status` danach identisch zum Stand vor dem Stash) und derselbe Testlauf: alle 5 gruen
(siehe V4 unten).

---

## 3. Verifikationstabelle

| # | Befehl | Ergebnis |
|---|---|---|
| V1 | `git rev-parse HEAD` / `git rev-parse master` | identisch, `7c3d6510db5792fae40a963ae71b47cdfc3cc7e5` |
| V2 | Mutationsprobe (s. oben) | ROT vor, GRUEN nach — Protokoll oben wörtlich |
| V3 | `node --check` auf allen 3 geaenderten `.js`-Produktionsdateien | keine Ausgabe |
| V4 | `node --test test/env-docs-spend-cap-coherence.test.js test/ks-p5a-plan-cap-carries-sold-minutes.test.js` | `pass 9, fail 0` (5 + 4) |
| V5a | `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start` (+ Owner-Nummer geseedet, `COST_TRUING_REQUIRED_RECORD_TYPES` lokal gesetzt) | Banner `Kosten-Decken: Tenant-Default 1500 ct \| Plattform-Warnschwelle 3000 ct \| Worst-Case-Tarif 30 ct/min`, kein Boot-Refusal, `/healthz` -> 200 |
| V5b | dieselbe Konfiguration + `VOICE_TARIFF_DEFAULT_CENTS=300` | Banner `… Worst-Case-Tarif 300 ct/min`, `/healthz` -> 200 — Fallback UND Env-Override booten beide gruen |
| V6 | `grep -rn "300 ct/min\|300 \* 5\|VOICE_TARIFF_DEFAULT_CENTS(300)\|voiceTariffDefaultCents = 300" src/ .env.example render.yaml` | keine Treffer |
| V7 | `npm test` (Regressionslauf) | Wrapper-Skript (`test/i18n-catalog-run.mjs`) endete lokal mit einem Nicht-Test-Exitcode (194) beim Redirect ueber `npm test > log`; die IDENTISCHE zugrundeliegende Invocation direkt gefahren (`node --test --test-reporter=tap --test-skip-pattern=<Katalogmuster> test/*.test.js`) lief sauber durch: **3558 Tests, pass 3558, fail 0** (vgl. Baseline 3044 zum Zeitpunkt der letzten dokumentierten Messung + seither gewachsene Suite; die neue Zahl inkludiert bereits den einen neuen KS-P6-Test). Ursache des Wrapper-Exitcodes nicht weiter untersucht (ausserhalb des Scopes dieser Phase, kein Testinhalt betroffen) |
| V8 | `npm run test:gates` | **4 rot** statt der erwarteten 3 (GAP-05, GAP-15 x2) — die vierte Rot-Meldung ist ein echter Befund dieser Phase, siehe Abschnitt 4 |

---

## 4. Abweichung von der Plan-Erwartung: 4. rote Gates-Meldung

`npm run test:gates` zeigt zusaetzlich zu den erwarteten drei (GAP-05, GAP-15 x2):

```
not ok - Charakterisierung ORIG-05: US-Tenant ruft +1 (DID-Land == Ziel-Land) -
         Reserve 1500 ct kommt seit P7 durch die Tenant-Decke 1500 ct
```

`test/orig-01-05-cost-origin.test.js` importiert `config` direkt aus `src/config.js` (kein
Spawn-Test, keine `BASE_ENV`-Absicherung) und pinnt wörtlich `reserveCents === 1500` sowie
`config.billing.defaultTenantBudgetCents === 1500`. Mit dem neuen Fallback 30 ct/min liefert
`tariffCentsPerMin(...) * ceil(MAX_CALL_DURATION_CAP_S/60)` jetzt 150 statt 1500 — die
Vorbedingungs-Assertion in Zeile 30 schlaegt fehl, der Test ist ROT.

Das ist eine echte Luecke in Abschnitt 3.3 des Plans (Tabelle "Warum die Bestandssuite sonst
reicht"): diese Datei wurde dort nicht gelistet und ist NICHT durch `BASE_ENV`,
Datei-Kopf-`process.env`-Zuweisung oder Fixture-Konstruktion vor dem Fallback-Wechsel
geschuetzt. Sie steht im `test:gates`-Lauf (Katalog-ID `ORIG-05` am Namensanfang, dort darf
Rot per Konvention stehen) — kein Regressionsfang in `npm test` ist betroffen.

**Nicht behoben in dieser Phase**: der Plan autorisiert ausschliesslich die unter 2.1-2.8
benannten Datei-Edits; eine Wert-Aenderung an `test/orig-01-05-cost-origin.test.js` (die
Charakterisierung von 1500 auf 150 nachzuziehen) steht dort nicht und waere eine
Bestandstest-Anpassung ohne Plan-Begruendung. Der Befund wird hier gemeldet, damit er beim
naechsten Gates-Durchlauf/Merge nicht als neue Ueberraschung auftaucht.

---

## 5. Node-Modules-Symlink-Hinweis (nur Ausfuehrungsdetail, kein Liefergegenstand)

Der vorgegebene Schritt `ln -s "./node_modules" node_modules` erzeugt im Worktree-Root
einen selbstreferenzierenden Symlink (Ziel relativ zur eigenen Datei). `node --test`
funktioniert trotzdem, weil Node beim Modul-Resolve bei ELOOP an der lokalen Kette einfach
in Elternverzeichnissen weitersucht und dort das echte `node_modules` des Haupt-Repos
findet. Fuer `npm start`/den lokalen Smoke-Test reicht dieser Fallback-Pfad nicht (das
Skript wird direkt im Worktree ausgefuehrt); dort wurde der Symlink lokal (nur fuer die
Smoke-Sitzung, nicht committet — `node_modules/` ist gitignored) auf den absoluten Pfad des
Haupt-Repo-`node_modules` umgebogen. Reines Ausfuehrungsdetail ohne Code-Auswirkung.

---

## 6. Merge-Hinweis

Laut Plan (Pre-Mortem Punkt 4): ab gemergtem `KS-P3` ist ein Zuruecknehmen von KS-P6 ein
Boot-Refusal, kein reiner Rollback (`PLAN-KOSTEN-STEUERUNG.md`, "Ausnahme mit Begruendung").
Solange `KS-P3` nicht gemergt ist, ist der Rollback dieser Phase ein reiner Werte-Revert
(300 zurueck in `src/config.js`/`.env.example`/`render.yaml`). Diese Session hat den
KS-P3-Merge-Status nicht selbst geprueft — vor einem Rollback von KS-P6 den aktuellen
`master`-Stand gegen `PLAN-KOSTEN-STEUERUNG.md` abgleichen.

---

## 7. Nicht angefasst (Scope-Treue)

`DEFAULT_TENANT_BUDGET_CENTS` (Wert bleibt 1500), `MAX_BUDGET_EUR`,
`VOICE_TARIFF_DOMESTIC_CENTS`, jede Untergrenze fuer `VOICE_TARIFF_DEFAULT_CENTS` (weiterhin
`min: 0`, kein Boot-Guard nach unten — bewusst getragenes Restrisiko, in `PLAN-SECURITY.md`
und im Config-Kommentar benannt), `test/prod-env.js`, Live-Env/Deploy, `STATUS.md`, die
Befund-Tabelle in `PLAN-KOSTEN-STEUERUNG.md`.
