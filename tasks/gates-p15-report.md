# Phase GATES-P15 — Deploy-Filter (GAP-37)

**Spec:** Abschnitt "P15" in `tasks/gates-fix-chain.md` (Umsetzungsdetail: PLAN-GATES.md Abschnitt 7)
**Abnahme:** GAP-37 gruen via `npm run test:gates`, `npm test` mit fail=0, Diff beruehrt `render.yaml`
**Auflage:** In `render.yaml` AUSSCHLIESSLICH `buildFilter.ignoredPaths` aendern — jede weitere Zeile ist ein Blocker. Zulaessige Testaenderung: NUR der W0-Test laut PLAN-GATES.md Abschnitt 7.

**Gate: PASS**
**finalBranch:** `phase/gates-p15-deploy-filter`
**headCommit:** `0803474dba3f7e15ab8b22e18b1e44f12810ae83`
**Base:** `master` = `504bde1`

---

## 1. Plan (gekuerzt)

Diff-Umfang exakt 2 Dateien: `render.yaml` + `test/render-buildfilter.test.js`. Kein `src/`-Code, kein neues Modul, keine neue Dependency.

- **Bindender Rahmen:** `render.yaml` fuehrt `MULTI_TENANT=false` / `SELF_SERVICE_ENABLED=false` (live steht beides auf `true`); ein Edit ausserhalb `buildFilter.ignoredPaths` waere gefaehrlich, weil ein spaeterer Blueprint-Apply Multi-Tenancy/Self-Service abschalten koennte. Deshalb harte Diff-Grenze.
- **Gemessener Live-Kontext:** Gateway `autoDeploy: "no"` / `autoDeployTrigger: "off"`; `buildFilter` wirkt nur auf Auto-Deploys → wirkt live derzeit **gar nicht**. Der Fix ist reine Blueprint-Kohaerenz, kein Live-Effekt.
- **Baseline vorab zu messen:** `node --test test/render-buildfilter.test.js` (erwartet 6/5 pass/1 fail = GAP-37), `npm test` (fail muss 0 sein), `npm run test:gates` (Referenz P14: 129/125 pass/4 fail: GAP-05, GAP-15 x2, GAP-37).
- **Edit 1 (`render.yaml`):** im Gateway-Service (`vodafone-agent`) den Eintrag `- "apps/web/**"` aus `buildFilter.ignoredPaths` entfernen (der Service baut UND serviert dieses Verzeichnis selbst — ein Filter darauf verhindert, dass Frontend-Commits je deployen). `docs/**` bleibt gefiltert. Erklaerender Kommentar **innerhalb** des `ignoredPaths`-Blocks erlaubt (einzige zulaessige Stelle fuer Prosa in dieser Auflage), bewusst frei von den Tokens `apps/web/**`/`src/`, damit die W0-Regex (`doesNotMatch`) nicht durch den Kommentar selbst kippt.
- **Edit 2 (`test/render-buildfilter.test.js`):** nur der W0-Test (Kopfkommentar Punkt 1 + Testkoerper, vorher "ignoriert apps/web/** im buildFilter") wird auf den neuen Gegenstand `docs/**` umgefasst. Der GAP-37-Test (Name, Assertions, Kommentar) bleibt **byte-identisch** — ein Gate darf nicht durch Umschreiben gruen werden. Tests 2–5 (kein `src/`-Filter, keine `paths:`-Whitelist am Gateway, hermes-web-Whitelist) unangetastet.
- **Kein neuer Test:** GAP-37 selbst beweist den Fix (rot→gruen inkl. Praemissen-Assertion `buildsWeb && servesWeb`, verhindert stilles Gruenwerden durch Wegfall des Gegenstands); der neu gefasste W0-Test haelt den verbleibenden `docs/**`-Schutz fest. Ein zusaetzlicher Test waere Doppelung (G5/S2).
- **Blocker-Regeln:** (a) ein roter Regressionstest ausserhalb des erlaubten W0-Tests; (b) jede Zeile in `render.yaml` ausserhalb `buildFilter.ignoredPaths`; (c) jede Testdatei ausser `test/render-buildfilter.test.js`; (d) GAP-37 gruen ohne `render.yaml` im Diff.
- **Pre-Mortem:** (1) `autoDeploy` wird spaeter eingeschaltet → Frontend-Commits SIGTERMen den telefonierenden Container mitten im Anruf; Gegenmittel ist strukturell `autoDeploy:false` + manueller Deploy, nicht der Filter — Owner-Entscheidung PM-7, akzeptiertes Risiko. (2) `render.yaml` wird angewendet und schaltet Multi-Tenancy/Self-Service ab → Gegenmittel ist die Diff-Auflage selbst (Beweis via `git diff -- render.yaml`). (3) Gate wird gruen ohne echte Aenderung → Gegenmittel: GAP-37-Test bleibt byte-identisch, Diff muss `render.yaml` beruehren.
- **Bewusst nicht gefixte Befunde (fuer Bericht, nicht Diff):** zwei jetzt stale Kommentarbloecke in `render.yaml` ausserhalb `ignoredPaths` (ueber `buildFilter` und vor dem `hermes-web`-Service) sowie eine stale Doku-Zeile in `docs/subscription-checkout-strategy.md` — alle drei liegen ausserhalb des in dieser Phase erlaubten Aenderungsbereichs.

---

## 2. Impl-Zusammenfassung

- `render.yaml`: im Gateway-Service ausschliesslich `buildFilter.ignoredPaths` geaendert — `- "apps/web/**"` entfernt, `docs/**` bleibt gefiltert, erklaerender Kommentar innerhalb des Blocks ergaenzt (4 neue Kommentarzeilen).
- `test/render-buildfilter.test.js`: Kopfkommentar Punkt (1) + der W0-Test selbst (vorher Zeile ~30, "ignoriert apps/web/** im buildFilter") auf `docs/**` umgefasst, Testname neu "filtert reine Doku-Commits ueber buildFilter.ignoredPaths". GAP-37-Test byte-identisch belassen.
- **Baseline vorher:** `render-buildfilter.test.js` 6/5 pass/1 fail (GAP-37 rot); `npm test` 3326/3326 pass/0 fail; `test:gates` 129/125 pass/4 fail (GAP-05, GAP-15 x2, GAP-37).
- **Nachher:** `render-buildfilter.test.js` 6/6 pass/0 fail (alle gruen); `npm test` unveraendert 3326/3326/0; `test:gates` 129/126 pass/3 fail (nur noch GAP-05 + GAP-15 x2) — genau Baseline minus 1, keine neue rote ID.
- Diff beruehrt exakt `render.yaml` + `test/render-buildfilter.test.js`; `git diff -- render.yaml` zeigt nur Zeilen innerhalb `buildFilter.ignoredPaths`. Kein `src/`-Code, kein neues Modul, keine neue Dependency.

### Deviations
- Smoke-Test (Server-Start bis `/healthz`) konnte nicht durchlaufen: Boot-Guard verlangt eine geseedete Owner-Nummer im Store, unabhaengig von dieser Phase (keine `src/`-Aenderung im Diff enthalten). Laut Spec best-effort, kein Blocker. `smokePass=false`.
- `node_modules`-Symlink im Worktree war selbstreferenzierend/broken (vorgeschlagene `ln -s ./node_modules node_modules`); stattdessen auf `../../../node_modules` des Hauptrepos verlinkt, damit `npm test`/`node --test` lauffaehig waren. Nicht committed, reine lokale Test-Infrastruktur.

---

## 3. Safety-Urteil

**approved: true** — alle Einzelkriterien true (testsPassIndependently, safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended), **blockers: []**.

Unabhaengige Verifikation (separater Worktree, Branch `review-gates-p15` aus `phase/gates-p15-deploy-filter`, merge-base geprueft = sauberer Einzel-Commit auf master-Tip):
- `npm test`: EXIT 0, roh 3346/3346 pass/0 fail, korrigiert (Katalog-Split) 3326/3326 pass/0 fail.
- `npm run test:gates`: EXIT 1, roh 512 (509/3), korrigiert 129 (126 pass/3 fail) — die 3 roten sind exakt GAP-05 (dokumentiert offen, "So lassen") und GAP-15 x2 (Rechtstexte, "Zurueckgestellt"), keiner von diesem Branch beruehrt. GAP-37 gruen.
- Rot-vor-Fix selbst reproduziert (mit `master:render.yaml` faellt GAP-37 auf 5/1 zurueck, mit Branch-Stand 6/6 gruen) — Test bleibt fail-closed, Praemisse (`buildsWeb && servesWeb`) per `assert.ok` gesichert.
- `git diff --name-only master..branch` beruehrt weder `src/` noch `public/` noch `apps/` noch `scripts/` noch `package.json`/`package-lock.json` — Safety-Gates (Denylist/Allowlist/Land/Stundenlimit/Budget/Max-Dauer), Signaturpruefung, Basic-/MCP-Auth, Offenlegungssatz sind byte-identisch zu master.

### Concerns (kein Blocker, Owner-/Lead-Nachfuehrung empfohlen)
1. Zwei jetzt sachlich falsche Kommentarbloecke bleiben im Blueprint stehen (ausserhalb `ignoredPaths`, daher spec-induziert nicht anfassbar in dieser Phase): `render.yaml` ~Zeile 36-38 (behauptet weiterhin, Frontend-Commits wuerden den Gateway nicht redeployen) und ~Zeile 455-456 im `hermes-web`-Block (behauptet, ein Frontend-Commit loese "NICHT am Gateway" einen Deploy aus). Beides gilt nach dem Fix nicht mehr.
2. `docs/subscription-checkout-strategy.md:42` verweist noch auf den alten Filter-Zustand — stale, aber ausserhalb Dateiumfang dieser Phase.
3. Wirkungsgrad ungeprueft: der Gateway-Service ist laut `render.yaml` DASHBOARD-MANAGED, der Blueprint nur Referenz/Doku. Die Phase schliesst das Gate, behebt den Live-Defekt aber nur, wenn derselbe Filter im Render-Dashboard nachgezogen wird — offene Ops-Aufgabe.
4. Bewusst eingetauschtes Restrisiko: der urspruengliche Grund fuer den `apps/web/**`-Filter (Blast-Radius: Frontend-Commit SIGTERMt den Container mitten im Anruf) faellt fuer Frontend-Commits weg, bleibt nur noch fuer `docs/**`. Owner-Entscheidung (PLAN-GATES.md:239), kein Blocker; Empfehlung: Frontend-Pushes in Schwachlastzeiten, solange live `autoDeploy` an ist.

---

## 4. Clean-Code-Audit

- **s1:** []
- **s2:** []
- **s3:** ["C2 · render.yaml:32-34 · Kommentarblock ueber `buildFilter` behauptet weiterhin generisch, Frontend-/Doku-Commits duerften den Prozess nicht neu deployen — nach dem Fix fuer den Frontend-Fall nicht mehr wahr (der GAP-37-Kommentar 8 Zeilen darunter sagt es korrekt). Fix-Vorschlag: Zeile 32-34 auf 'rein-Doku-Commits' verengen, analog zum bereits angepassten Testkommentar."]
- **s4:** []
- **blocker: false**

**Verdict:** Kein Blocker. Sehr kleiner, praeziser Diff, der GAP-37 tatsaechlich aufloest statt den Test zu entschaerfen. Test lokal verifiziert: alle 6 Tests gruen, GAP-37 kippt korrekt von rot auf gruen. Einziger Fund ist der liegen gebliebene, jetzt widerspruechliche Kommentarblock (S3/C2) direkt ueber der geaenderten Stelle.

**passNotes:** Fix ist die im GAP-37-Testkommentar selbst verlangte Aufloesung ("Build herausnehmen ODER ignoredPaths kuerzen") — keine Testverwaesserung, echte Config-Korrektur. Testneufassung deckt weiterhin dieselbe Invariante (Doku-Commits filtern) ab, ohne GAP-37 zu duplizieren. `src/**`-Nicht-Filterung und hermes-web-Whitelist unangetastet. Keine Duplizierung, keine Magic Numbers, keine deaktivierten Sicherungen, keine fehlende Testabdeckung.

**topTodos:**
- `render.yaml` Zeile 32-34: Kommentar auf "rein-Doku-Commits" verengen, damit er nicht mehr behauptet, Frontend-Commits wuerden den Gateway nicht redeployen.

---

## 5. Fix-Runden

Keine. Erste Umsetzung erreichte PASS in beiden Reviews (Safety: approved ohne Blocker; Clean-Code: blocker=false), keine Nacharbeit erforderlich.

---

## 6. Offene Nachfuehrung (nicht Teil dieser Phase, fuer eine gemeinsame Kohaerenz-Runde nach P15)

1. `render.yaml` ~Zeile 36-38: Kommentar ueber `buildFilter` auf "rein-Doku-Commits" verengen (C2, S3).
2. `render.yaml` ~Zeile 455-456 (hermes-web-Block): stale Aussage ueber den Gateway-Filter korrigieren.
3. `docs/subscription-checkout-strategy.md:42`: Verweis auf `apps/web/**` im Gateway-`ignoredPaths` aktualisieren.
4. GAP-37-Testname/-Kommentar ("SOLL, rot") beschreibt nach dem Fix einen erledigten Befund — Owner-Entscheidung noetig, ob/wann angepasst wird (nicht von PLAN-GATES.md Abschnitt 7 gedeckt).
5. Ops-Nachfuehrung: derselbe `ignoredPaths`-Filter muss im Render-Dashboard (nicht nur im Blueprint) nachgezogen werden, damit der Fix live wirkt.
