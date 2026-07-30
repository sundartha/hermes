# KS-P6 — Detailbericht: Tarif-Fallback im Code nachziehen (300 -> 30 ct/min)

- **Gate:** PASS
- **finalBranch:** `phase/ks-p6-tarif-fallback-fix1`

---

## 1. Plan (gekuerzt)

**Auftrag:** Fallback `voiceTariffDefaultCents` in `src/config.js`, `.env.example`, `render.yaml` von 300 auf 30 ct/min senken (der Live-Dienst faehrt bereits 30 seit E1 — die Phase holt nur das Repo nach), inklusive Nachzug aller Herleitungs-Kommentare, die „300 * 5 = 1500" ausschreiben.

**Nicht in dieser Phase:** `DEFAULT_TENANT_BUDGET_CENTS` (Wert bleibt 1500), `MAX_BUDGET_EUR`, `VOICE_TARIFF_DOMESTIC_CENTS`, jede Untergrenze fuer den Worst-Case-Satz (eigene Aufgabe seit KS-P0), Live-Env/Deploy, `STATUS.md`.

**Edits laut Plan:**
- `src/config.js` — Fallback-Wert 300 -> 30 (die eigentliche Verhaltensaenderung) + Herleitungs-Kommentar bei `defaultTenantBudgetCents` nachgezogen (300*5=1500 -> 30*5=150), inkl. Korrektur der veralteten Klausel-A-Aussage (in `boot-guard.js` bereits durch KS-P9/E10 entfallen)
- `.env.example` — Wert + Kontext-Kommentar bei `VOICE_TARIFF_DEFAULT_CENTS`, Herleitungskommentar bei `DEFAULT_TENANT_BUDGET_CENTS`
- `render.yaml` — dieselben zwei Stellen
- `src/telephony/outbound-gates.js` — Zahlenbeispiel im Kommentar (300 -> 30 ct/min)
- `src/billing/cost-calibration.js` — veraltete Zahl aus Kommentar entfernt statt nachgezogen (verrottet sonst beim naechsten Satzwechsel wieder)
- `test/ks-p5a-plan-cap-carries-sold-minutes.test.js` — nur Kommentar, Array-Inhalt `[300, 30]` unveraendert (Bandbreite ist der Testwert)
- `PLAN-SECURITY.md` — historische Zahl auf „Stand vor KS-P6" umformuliert + neuer Abschnitt „KS-P6" mit Wirkungsrichtung, Boot-Guard-Nachrechnung, Restrisiko

**Neuer Test (Mutationsprobe):** `test/env-docs-spend-cap-coherence.test.js` — pinnt den konkreten ausgelieferten Wert 30 ct/min an allen drei Quellen (Code-Fallback, `.env.example`, `render.yaml`) mittels der bestehenden Datei-Read-Helfer (`readEnvValue`/`readRenderValue`/`readCodeFallback`), kein neuer Parser. Auf `master` (300/300/300) rot vor der Aenderung, gruen danach — echte Mutationsprobe, kein reiner Konsistenzcheck.

**Verifikationsplan V1-V8:** Basis-Check, Mutationsprobe rot-vor-Edit, `node --check` auf allen geaenderten JS-Dateien, gezielter Testlauf, Boot-Smoke mit Default und mit `VOICE_TARIFF_DEFAULT_CENTS=300`-Override (beide gruen), Grep auf verbliebene alte Zahl (keine Treffer), volle Regressionssuite, `test:gates` (darf rot sein).

**Pre-Mortem (Kernpunkte):** Satz deckt Kosten evtl. nicht (30 ct ist 3,7x des gemessenen Ist 8,18 ct/min; keine Untergrenze im Code — bestehendes, benanntes Restrisiko); Boot-Guard-Refusal durch Klausel B — nachgerechnet: wird lockerer, nicht strenger; Plan-Decke sinkt fuer Kunden — beabsichtigt und bereits live; Rollback nach KS-P3-Merge wird zum Boot-Refusal, nicht zum reinen Revert.

---

## 2. Impl-Zusammenfassung

- **headCommit:** `eb8aa00de70d99c5ff909e300b83298450180d4a` (vor Fix-Runde r1)
- **Branch:** `phase/ks-p6-tarif-fallback` -> nach Fix-Runde `phase/ks-p6-tarif-fallback-fix1`
- `node --check` auf allen 5 geaenderten JS-Dateien: **gruen**
- Regressionssuite: **3558 / 3558 pass, 0 fail** (via direktem `node --test`-Aufruf verifiziert, da der `npm test`-Wrapper lokal mit nicht-inhaltlichem Exitcode 194 endete — nicht auf den Test-Inhalt zurueckgefuehrt)
- **Blast-Radius laut Diff:** genau **eine** Verhaltensaenderung im Produktionscode (`fallback: 300` -> `fallback: 30` in `src/config.js`); alles Uebrige in `src/` ist Kommentarpflege (config.js `defaultTenantBudgetCents`-Kommentar, outbound-gates.js, cost-calibration.js). Keine neue Dependency (package.json/package-lock.json 0 Byte Diff), kein neuer Endpunkt, kein neuer Env-Schluessel.
- **Geaenderte/erstellte Dateien:**
  - `src/config.js`, `.env.example`, `render.yaml` — der Wert + Herleitungskommentare
  - `src/telephony/outbound-gates.js`, `src/billing/cost-calibration.js` — Kommentar-Nachzug
  - `test/env-docs-spend-cap-coherence.test.js` — neuer Mutationsproben-Test
  - `test/ks-p5a-plan-cap-carries-sold-minutes.test.js` — nur Kommentar
  - `PLAN-SECURITY.md` — Zahl korrigiert + neuer KS-P6-Abschnitt
  - `tasks/ks-p6-report.md` — Liefergegenstand (Impl-Report, Vorgaenger dieses Dokuments)
- **Smoke-Test (V5):** Server gebootet mit unveraendertem Fallback — Boot-Banner „Kosten-Decken: Tenant-Default 1500 ct | Plattform-Warnschwelle 3000 ct | Worst-Case-Tarif 30 ct/min", kein Boot-Refusal, `/healthz` -> 200. Zweiter Lauf mit `VOICE_TARIFF_DEFAULT_CENTS=300` gesetzt — Banner zeigt 300 ct/min, `/healthz` -> 200. Beweist: nur der Fallback wurde geaendert, Env-Override greift unveraendert.

### Deviations (aus dem Impl-Report)

1. **`npm run test:gates` zeigte 4 statt der geplanten 3 roten Tests.** Die vierte, neue Rot-Meldung war `test/orig-01-05-cost-origin.test.js` (Charakterisierung ORIG-05): importiert `config` direkt (kein Spawn-Test, kein `BASE_ENV`-Schutz) und pinnte woertlich `reserveCents === 1500` sowie `defaultTenantBudgetCents === 1500`. Mit dem neuen Fallback 30 liefert die Reserve-Rechnung 150 — eine im Plan-Abschnitt 3.3 nicht erfasste Luecke (die Datei fehlte dort in der „abgesichert"-Liste). Der urspruengliche Plan autorisierte keine Aenderung an dieser Testdatei; **in Fix-Runde r1 wurde die gepinnte Zahl auf 150 nachgezogen** (siehe Abschnitt 5).
2. `npm test` (Wrapper `test/i18n-catalog-run.mjs`) lieferte lokal beim direkten Aufruf mit Ausgabe-Redirect Exitcode 194 statt eines regulaeren Ergebnisses — Ursache vermutlich eine Sandbox-/Redirect-Eigenheit des Wrapper-Spawns, nicht inhaltlich. Als Ersatz wurde die identische zugrundeliegende Invocation direkt gefahren (3558/3558/0).
3. Der vorgegebene Setup-Schritt `ln -s "./node_modules" node_modules` erzeugt einen selbstreferenzierenden Symlink; fuer den lokalen Server-Smoke-Test wurde er lokal auf den absoluten Pfad des Haupt-Repo-`node_modules` umgebogen — nicht committet, reines Ausfuehrungsdetail.

---

## 3. Safety-Urteil

**APPROVED.** Kernaussagen des unabhaengigen Reviews:

- Regressionslauf unabhaengig nachgefahren: 3558/3558 pass, 0 fail (98s), inkl. beider Store-Backends (json + pg via pglite).
- `test:gates`: 129 Tests im Katalog, 126 pass / 3 fail — Baseline-Gegenprobe auf `master` (7c3d651) im selben Worktree ergab **dieselben drei roten IDs** (GAP-05, GAP-15 x2). Keine Regression.
- **Mutationsprobe selbst nachgefahren** (nicht dem Report geglaubt): Fallback per `perl` zurueck auf 300 gesetzt -> neuer Test faellt mit `300 !== 30`. Restauriert, `git status --porcelain` leer danach. Der Test faengt die Regression wirklich.
- Boot-Guard direkt gegen die echte Funktion nachgerechnet: `spendCapCoherence({tenantDefaultCents:1500, platformCapCents:3000, maxTariffCents:30, maxCallDurationS:300})` -> `[]` (kein Befund); mit `maxTariffCents:300` ebenfalls `[]`; Gegenprobe mit `tenantDefaultCents:100` -> `{code:"worst_case_unaffordable", fatal:true}`. Klausel B bleibt scharf und `fatal:true`, kein Abschwaechen (`fatal: true -> false` nirgends).
- Scope-Messung: `git diff master..fix1 -- src/` enthaelt genau **eine** nicht-Kommentar-Zeile (`+ fallback: 30,`). Kein Diff in `claude.js`, `bridge.js`, `auth.js`, `web-auth.js`, `middleware.js`, `server.js` oder Signatur-/Voice-Adaptern; `disclosureSentence` unangetastet (3x claude.js, 2x bridge.js).
- Sekret-Scan auf diesen Report: 0 Treffer.
- Konsistenz der drei Wertequellen per grep verifiziert (30 / 30 / "30"); restliche 300-Nennungen im Repo sind ausschliesslich historische Narrative oder bewusste Test-Fixtures.

**Concerns (dokumentiert, kein Blocker):**
1. *Stale-Report-Befund aus der Erstpruefung* — der zu diesem Zeitpunkt committete `tasks/ks-p6-report.md` (Vorgaengerfassung) war auf dem Stand von `eb8aa00` und behauptete noch „4 rot"/„ORIG-05 nicht behoben", obwohl Fix-Runde r1 das bereits korrigiert hatte. **Dieser Bericht ersetzt jene Fassung und traegt den aktuellen Stand.**
2. **Restrisiko (bewusst getragen, ausserhalb der Phase):** `VOICE_TARIFF_DEFAULT_CENTS` hat weiterhin `min:0` und keine Untergrenze im Boot-Guard — `spendCapCoherence` prueft nur nach oben, `voiceTariffFloorFindings` bewacht ausschliesslich `VOICE_TARIFF_DOMESTIC_CENTS`. Ein versehentlich zu niedriger Satz unterreserviert still und verkuerzt zugleich die Plan-Decke. In `src/config.js` und `PLAN-SECURITY.md` explizit als offene Aufgabe benannt.
3. **Umgebungsabhaengiger Test (vorbestehendes Muster):** `test/orig-01-05-cost-origin.test.js` importiert `config` direkt (kein Spawn, kein `BASE_ENV`) und pinnt jetzt `reserveCents === 150` — an den Code-Fallback gebunden, wird rot auf einer Maschine mit gesetzter `.env`. Keine neue Schuld, aber zum zweiten Mal von Hand nachgezogen.
4. **Zweitwirkung (vom Plan gedeckt, nur Merkposten):** Plan-Kostendecke fällt bei Code-Defaults von 15000/45000 auf 1500/4500 ct — Richtung STRENGER, Live-Dienst faehrt 30 bereits seit E1, fuer Produktion aendert der Merge nichts. Beim Deploy den Boot-Banner „Worst-Case-Tarif 30 ct/min" gegenlesen.

**Verdict-Kernsatz:** „Der gesamte Produktionscode-Diff ist EINE Zeile (`fallback: 30`), der Rest ist Kommentar-, Doku- und Testpflege. Keine der absoluten Regeln ist beruehrt." Der Mechanismus (Reserve-Gate, `spendCapCoherence` Klausel B, exit 1) ist unveraendert und feuert in der Gegenprobe weiterhin fatal — geaendert wurde ein durch 21 Live-Belege gedeckter Kalibrierungs-Eingang (8,18 ct/min Ist, 30 ist das 3,7-Fache), vom Owner als E1 entschieden und live bereits gesetzt. Beide Zweitwirkungen zeigen in die strenge Richtung.

---

## 4. Clean-Code-Audit (S1-S4)

- **s1:** [] (keine Blocker-Befunde)
- **s2:** []
- **s3:** []
- **s4:** []
- **blocker:** false

**Verdict:** PASS — sauberer, eng begrenzter Diff. Der Fallback von `VOICE_TARIFF_DEFAULT_CENTS` wird an allen drei synchron gehaltenen Quellen einheitlich geaendert; die abgeleitete Boot-Guard-Rechnung (Klausel B) und alle betroffenen Kommentare korrekt nachgezogen. `node --check` auf allen 3 geaenderten `src`-Dateien gruen; die 3 geaenderten/neuen Testdateien gruen in einem frischen Worktree-Checkout; breiterer Lauf ueber 16 potenziell betroffene Tests zeigt 109/110 gruen — der eine Fehlschlag (`finishcall-billing-once.test.js`) reproduziert in Isolation nicht (bekannter Last-Flake, keine Regression dieser Phase).

Die vermeintliche zweite Boot-Guard-Schranke (Klausel A / TENANT_DEFAULT_INERT), die Kommentare als „durch KS-P9/E10 entfallen" beschreiben, wurde gegen den tatsaechlichen Branch-Stand von `boot-guard.js` verifiziert: bereits vor KS-P6 entfernt (KS-P9 ist Ahnenschaft von `master`) — Kommentare sind sachlich korrekt, keine Luecken-Behauptung.

Kein Magic-Number-Verstoss (G25/G26): Zahl 30 nur an dokumentierten Stellen mit Herleitung, plus dedizierter Koharenztest, der alle drei Quellen gegeneinander pinnt. Kein toter Code, kein auskommentierter Code, keine abgeschalteten Sicherungen, keine Scope-Ausweitung. Der fehlende Untergrenzen-Schutz (`min:0`) ist als bewusstes, dokumentiertes Restrisiko festgehalten, nicht verschwiegen — daher keine S1-Flag, korrekt ausserhalb des Phasen-Scopes belassen.

**topTodos:** Keine Blocker. Optional/spaeter (bereits als eigene Aufgabe vermerkt): Untergrenze fuer `VOICE_TARIFF_DEFAULT_CENTS` im Boot-Guard ergaenzen (analog `voiceTariffFloorFindings`), da `min:0` aktuell 0 zulaesst.

---

## 5. Fix-Runden

### r1

Einzigen genannten Blocker aus dem ersten Review behoben: `test/orig-01-05-cost-origin.test.js` pinnte die Reserve-Charakterisierung noch auf 1500 ct; seit KS-P6/E1 (Worst-Case-Tarif 300 -> 30 ct/min, live gemessen) liefert `tariffCentsPerMin` jetzt 150 ct (30 ct/min * 5 Kappungsminuten). Inhaltliche Aussage des Charakterisierungstests (Reserve <= Tenant-Decke) bleibt erhalten und haelt jetzt mit groesserem Abstand — reiner mechanischer Nachzug der gepinnten Zahl plus Begruendungskommentar, kein Verhaltens-Fix. Ergebnis nach r1: `test:gates` zeigt 3 rot (identisch zur `master`-Baseline), kein ungedeckter Nebeneffekt mehr offen.

---

## 6. Merge-Hinweis

Solange KS-P3 nicht gemergt ist, ist ein Rollback von KS-P6 ein reiner Werte-Revert. Ab gemergtem KS-P3 wird ein Zurueknehmen von KS-P6 zu einem Boot-Refusal, kein einfacher Rollback mehr (siehe `PLAN-KOSTEN-STEUERUNG.md`, „Ausnahme mit Begruendung").
