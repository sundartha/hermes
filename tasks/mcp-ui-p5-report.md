# Phase P5 — Token-Pull-Disziplin + Restschuld

**Gate:** PASS
**finalBranch:** `phase/mcp-ui-p5-token-gate-fix1`
**headCommit (Impl):** `8d66ac93af59ef9c297169148fce9a3758f98f96`
**Tests:** 1116 pass / 0 fail (Baseline 1108 + 8 neue)

---

## Plan (gekuerzt)

Baseline `master` (HEAD `6b39217`). Reiner Build-/Check-/Doku-Scope: KEIN `src/`-Laufzeit-Code, keine Safety-Gates, kein Call-Pfad, kein neuer npm-Dep, kein Build-Step. Nur additive Tests + Doku.

**Deliverable 1 — Empirische Sync-Beziehung (abgeleitet, nicht geraten):** Die kanonische Kopie `design-system/_shared/tokens.css` ist NICHT deterministisch 1:1 aus der Quelle (`apps/web/src/styles/tokens/{primitives,semantic,hero}.css`) reproduzierbar:
- `:root` der Kopie ist Konkatenation von primitives + semantic, aber Kommentare entfernt, neu gruppiert/umgeordnet.
- `.on-dark` ist eine manuelle Transformation von `hero.css` (`:root`→`.on-dark` umgeschrieben, `--hero-*`-Alias-Ketten teil-inlined, viele Rohnamen fehlen in der Kopie).
- `index.css` (nur `@import` + Reset, keine Token-Werte) ist in der Kopie nicht repraesentiert.

**Folge:** kein 1:1-Repro → **Hash-/Manifest-Ansatz**. Lock-File friert die Soll-Hashes der Token-Quelle (primitives/semantic/hero) UND der kanonischen Kopie ein. Der Check vergleicht Ist gegen Soll und nennt die driftende Datei → faengt Drift auf BEIDEN Seiten (Quelle geaendert ohne Kopie nachzuziehen, oder Kopie hand-editiert), ohne die manuelle Transformation reproduzieren zu muessen. Ist-Zustand wird als Soll festgeschrieben.

`index.css` bewusst NICHT im Manifest (Pre-Mortem): null Token-Werte, nicht Teil der Kopie. Pinnen wuerde den Gate „cry wolf" lassen (jede Reset-Aenderung = Falsch-Drift), Disziplin verrottet. Restrisiko per Konvention abgedeckt (Datei-Header verbietet Token-Werte).

**Bausteine:**
1. `scripts/check-token-sync.js` (ESM, nur Node-Builtins `fs`/`crypto`/`path`/`url`, kein Dep): reine seiteneffektfreie Pruef-Funktionen (`hashFile`, `listHtmlRels`, `readLock`, `checkHashDrift`, `assertNoImport`, `assertDsCardLine1`, `checkTokens`, `writeTokenLock`), CLI hinter is-main-Guard (`--write` → Lock neu freezen; sonst Check → exit 0/1; aeusserer try/catch → exit 1 fail-closed). Benannte Konstanten fuer alle Pfade/Algo/Marker.
2. `design-system/_shared/tokens.lock` (generiert via `--write`): `{ _comment, algo: sha256, hashes: {rel→hex} }`.
3. `package.json`: npm-Script `check:tokens`. `dependencies` unveraendert.
4. `test/mcp-ui-p5-token-sync.test.js` (node:test, offline, Temp-Fixtures via `mkdtempSync`, echte Repo-Dateien nie zerstoerend).
5. Doku-Restschuld: `docs/mcp-ui-strategy.md` (Q6 Status UMGESETZT), `tasks/mcp-ui-chain.md` (§P5 Status), `STATUS.md` (Gate verankert).

Zusaetzlich geprueft: `--write` macht ausschliesslich Hash-Neufreezung; Struktur-Invarianten (`@import`-Verbot, `@dsCard`-Zeile-1) bleiben rein live-geprueft, nie gepinnt.

---

## Impl-Zusammenfassung

MCP-UI P5 exakt gemaess Plan umgesetzt.

**Neu:**
- `scripts/check-token-sync.js` — fail-closed Pruef-Funktionen + CLI hinter main-Guard, nur Node-Builtins, kein Dep. Hash-Manifest faengt Drift beidseitig (Quelle + nicht-1:1-reproduzierbare Kopie). Plus `@import`-Verbot (tokens.css + mcp-Mockups + `src/ui/widgets`) und `@dsCard`-Zeile-1-Marker (mcp-Mockups).
- `design-system/_shared/tokens.lock` — Soll-Hashes aus dem konsistenten Ist-Zustand.
- `test/mcp-ui-p5-token-sync.test.js` — 8 additive Tests: (a) real read-only Baseline-gruen, (a') synced Fixture, (b) Kopie-Drift, (b') Quelle-Drift, (c) `@import`, (c') `@dsCard`, (d) Pflichtdatei fehlt, (e) Lock fehlt.

**Editiert:** `package.json` (1 Script-Zeile), `docs/mcp-ui-strategy.md` (Q6), `tasks/mcp-ui-chain.md` (§P5), `STATUS.md`.

**Verifikation:** `node --check` gruen; Suite 1116 pass / 0 fail (genau 1108 Baseline + 8); `npm run check:tokens` Exit 0 („OK — Tokens synchron"); Negativ-Drift-Beweis: ein Byte an `_shared/tokens.css` → Exit 1 mit „… tokens.css driftet …", danach `git checkout` → wieder Exit 0.

### Deviations

- **STALE-BASE (vgl. Memory [[phase-impl-workflow-args]]):** Worktree wurde vom veralteten `master` `6b39217` abgezweigt. Der Plan nennt `6b39217` als Baseline, referenziert aber `design-system/_shared/tokens.css`, die mcp-Mockups und `docs/mcp-ui-strategy.md` + `tasks/mcp-ui-chain.md` als bereits committete Dateien. Diese existieren erst ab `b9796c1` (`docs(active): MCP-UI-Strategie…`), direkter Nachfahre von `6b39217` und aktueller `master` des Haupt-Repos. Branch per `git reset --hard b9796c1` auf die reale Baseline gesetzt → `design-system` ist die committete Version, der Impl-Commit enthaelt genau die 7 geplanten Dateien. Ohne Rebase waere das Gate ueber nicht-getrackte Dateien gelaufen und auf sauberem Checkout sinnlos/rot.
- Vor dem Rebase-Befund kurz die nicht-getrackte `design-system`-WIP aus dem Haupt-Arbeitsbaum in den Worktree kopiert (read-only, Haupt-Baum unveraendert); nach Erkennen von `b9796c1` wieder entfernt und durch die committete Version ersetzt. Nutzer-Arbeitsbaum nie angefasst.
- Plan-Baseline-Testzahl 1108 verifiziert: nach 8 neuen Tests = 1116, fail 0.
- Setup-vorgegebener Symlink `ln -s ./node_modules node_modules` war zirkulaer („Too many levels of symbolic links"); ersetzt durch absoluten Symlink auf `node_modules` des Haupt-Repos. Symlink gitignored, nicht committet.

---

## Safety-Urteil

**APPROVED.** Reine CI-/Tooling-Scheibe (Token-Sync-Drift-Gate) ohne jede Aenderung an `src/`, Telefonie, `claude.js`, `bridge.js`, Auth oder Store.

- `testsPassIndependently`: true — JSON-Backend kanonische Suite 1117/1117 pass, Exit 0; `npm run check:tokens` Exit 0; P5-eigene Suite voll gruen.
- `safetyGatesIntact` / `disclosureIntact` / `authFailClosedIntact`: true — alle byte-identisch (nicht angefasst).
- `noSecretsLeaked`: true — Script liest nur lokale CSS/HTML, loggt nur Pfade.
- `scopeRespected` / `behaviorAsIntended`: true.
- Keine neue npm-Dependency (nur Node-Builtins; `package.json` nur Script-Eintrag).
- Skript selbst fail-closed (Exit 1 bei Drift, fehlender Datei, kaputtem Lock).

**Concerns (kein Blocker):**
- 12 pg-Backend-Failures (`STORE_BACKEND=pg`: 1049 pass / 12 fail) sind umgebungsbedingt — identische Wurzel „[store] FATAL: pg-Backend nicht initialisierbar … DB unerreichbar (AggregateError)", kein Postgres in dieser Umgebung. P5 fasst KEINE `src/`/store-Datei an, kann sie kategorisch nicht verursachen. Empfehlung: vor Live-Push einmal mit echter pg/pglite-DB gegenpruefen.
- `scripts/check-token-sync.js` ist lokales CLI-Tool, noch nicht in CI/GitHub-Actions verdrahtet — Gate wirkt erst nach Einhaengen in automatischen CI-Schritt (in der Phase als „lokal, nicht gepusht" deklariert, bekannt/akzeptiert).

---

## Clean-Code-Audit

**Verdict: PASS** (blocker: false)

- **S1:** keine.
- **S2:** keine. (Der urspruengliche G5/S2-Blocker wurde in Fix-Runde r1 behoben — siehe Fix-Runden.)
- **S3:**
  - IMP-1 · `scripts/check-token-sync.js` · `@import`-Pruefung nutzt nackten Substring-Match `content.includes("@import")`; matcht auch `@import` in HTML-Kommentar/Text. Fehl-Alarm waere fail-closed (sichere Richtung), unkritisch. Optional praeziser auf Zeilenanfang/CSS-Kontext.
  - IMP-2 · `scripts/check-token-sync.js` · Variable `soll` (checkHashDrift) gemischtsprachig; im Kontext der dt. Kommentare lesbar, Belassen vertretbar.
- **S4:**
  - GAP-1 · `SOURCE_TOKEN_RELS` ist fest verdrahtete 3er-Liste statt Glob ueber `apps/web/src/styles/tokens/`. Eine kuenftig NEU hinzugefuegte Token-Datei entgeht still dem Sync-Gate. Bewusster Tradeoff (index.css soll ausgeschlossen bleiben, Header dokumentiert das) → akzeptabel, aber zu beobachten. Fix-Option: Verzeichnis globben mit expliziter Ausschlussliste.
  - ARG-1 · mehrere Helfer (checkHashDrift/assertNoImport/assertDsCardLine1/readTextOrProblem/listHtmlRels) fuehren je 3 Args (rootDir, rel, problems) — am Richtwert-Limit, aber idiomatisch und klar; kein Handlungsbedarf.

**passNotes:** Reines Tooling + Docs, beruehrt KEINE Absolute-Regeln. Selbst verifiziert: `node --check` ok, `check:tokens` Exit 0, Suite gruen. Neues Verhalten umfassend getestet (Baseline-gruen real+Fixture, Drift Quelle UND Kopie, `@import`-Verbot, `@dsCard`-Zeile-1, fehlende Pflichtdatei, fehlendes Lock, Dedup-Regression). Sauber: benannte Konstanten statt Magic Numbers/Strings, CLI-Seiteneffekte hinter main-Guard von reinen Pruef-Funktionen getrennt (P15), import-seiteneffektfrei. Durchgehend fail-closed. Duplizierung vermieden (`fileMissingProblem` + `readTextOrProblem` geteilt). Manifest-Ansatz im Header begruendet, index.css-Ausschluss erklaert. Kein toter/auskommentierter Code.

**Top-Todos (kein Blocker):**
- Optional (S4): `SOURCE_TOKEN_RELS` auf Verzeichnis-Glob mit expliziter index.css-Ausschlussliste umstellen.
- Phase ist mergebar; S3/S4 sind Nice-to-have.

---

## Fix-Runden

**r1** — G5/S2-Blocker behoben: Der byte-identische 5-Zeilen fail-closed Lese-/Fehler-Block in `assertNoImport` und `assertDsCardLine1` wurde in den Helper `readTextOrProblem(rootDir, rel, problems) → string|null` extrahiert (null = Datei fehlt → Aufrufer return). Die wiederholte „Datei fehlt (fail-closed)"-Meldung dedupliziert. Danach Gate = PASS. finalBranch `phase/mcp-ui-p5-token-gate-fix1`.
