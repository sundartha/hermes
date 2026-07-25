# 15 - Welle W1 umgesetzt (Bericht)

Stand: 2026-07-25 | Basis: `57b1040` (GAP-33) | Ergebnis: `ef74835`
Umsetzung in zwei Wellen ueber sechs Bloecke, je Block ein Impl-Agent im eigenen Worktree,
zwei unabhaengige Reviews (Scope/Safety und Katalogtreue/Clean-Code), Self-Fix bei Blockern,
Merge nach eigener Pruefung im Lead.

---

## 1. Ergebnis

| | vorher (`57b1040`) | nachher (`ef74835`) |
| --- | --- | --- |
| Tests gesamt | 2941 | **3044** |
| gruen | 2939 | **2959** |
| rot | 2 | **85** |

**Alle 85 roten Tests tragen eine Katalog-ID.** Kein Bestandstest ist gebrochen - die
Gruen-Zahl ist gestiegen, und die Bilanz geht exakt auf: 103 neue Tests = 83 rot + 20 gruen.

Rot ist hier das Arbeitsergebnis, nicht ein Fehler: `PLAN-I18N-TESTS.md` 4.1 - "Kein roter
Test in diesem Katalog ist ein Regressionsfang; alle sind Launch-Gates."

**Kein Produktionscode wurde angefasst.** `git diff 57b1040..ef74835 --name-only` liefert
ausschliesslich Pfade unter `test/`. Das war die haerteste Auflage an alle Agenten und wurde
in jedem Block per `--stat` gegengeprueft, nicht per Stichprobe.

---

## 2. Umfang

**78 kanonische W1-Tests** (P0 + offline), abgeleitet aus der Schnittmenge von
`00-kanonische-liste.md` (Duplikat-Aufloesung), `PLAN-I18N-TESTS.md` 4.2 (Prio/Modus) und den
Owner-Entscheidungen 7.0/7.12. Alle 78 sind belegt: 74 durch neu gebaute Tests, 4 durch
Bestandstests, die den Katalogfall bereits exakt pinnen (VOICE-02, VOICE-03, VOICE-08,
LANG-06 - Referenz-Kommentar nachgetragen, kein Duplikat gebaut, G5).

| Block | Inhalt | IDs |
| --- | --- | --- |
| B1 | Sprach-Kern, Locale-Bundles | 14 |
| B2 | Prompts, Greeting, Telefonie-Render | 14 |
| B3 | MCP-Schicht und Widgets | 12 |
| B4 | Land-Gate, Wahlziel-Normalisierung | 9 |
| B5 | Geld, Tarif-Herkunft, Boot-/Ops-Gates | 15 |
| B6 | Web/Auth, Rechtstexte, E2E-Ketten | 14 |

---

## 3. Korrekturen an den Katalogdateien

Diese drei Befunde stammen aus der Umsetzung und korrigieren die Quelldokumente. Die
Dateien selbst bleiben unveraendert - Korrektur hier, damit die Beleglage nachvollziehbar
bleibt.

### K1 - Abschnitt 5 des Plans taugt nur noch fuer die Gruppenreihenfolge

Die dort genannten "106 Tests" sind ein Stand VOR der Duplikat-Aufloesung und VOR den
Owner-Entscheidungen. Die Gruppen 1-5 fuehren **26 IDs**, die entweder als Duplikat entfallen
oder zurueckgestellt sind: OUT-01, OUT-13, LANG-08, PAY-13, PAY-14, LAW-04, LANG-01, LANG-10,
WEB-22, WEB-23, FMT-07, FMT-08, FMT-10, LANG-03, LANG-04, WEB-20, WEB-21, PROMPT-04, WEB-05,
PAY-05, PAY-07, GAP-02, LAW-06, LAW-07, GAP-12, GAP-13. Verbindlich ist
`00-kanonische-liste.md`.

### K2 - Zaehlfehler in der kanonischen Liste

Die entfallen-Spalte in Abschnitt 2 enthaelt **109** IDs, nicht 108 (ausgezaehlt, keine
Doppelnennung). Damit sind es **322 - 109 = 213** kanonische Tests statt 214; die
Folgezahlen 219 und 217 sind entsprechend um eins zu hoch (richtig: 218 bzw. **216**).

### K3 - Drei Polaritaeten in der Quelle sind falsch

Gemessen statt behauptet:

| Test | Quelle sagt | gemessen | Grund |
| --- | --- | --- | --- |
| PAY-04 | rot (D25) | **gruen** | Die Spezifikation verlangt die Assertion `reserveExceedsBudget(...) === true` - genau das liefert der Code heute. Der Mechanismus stimmt (R3), der Defekt sitzt im Wert. |
| ORIG-05 | rot | **gruen** | identische Rechnung, identische Begruendung |
| MCP-05 | rot | **gruen** | s. Block-B3-Report |

Der Sollzustand "der Auslandsanruf soll durchkommen" wird bereits von GAP-33 getragen
(`test/prod-config-smoke.test.js`, heute rot mit 402). Die drei Tests sind deshalb als
**gruene Charakterisierung** gebaut, mit Verweis auf den SOLL-Traeger - nicht als
stillschweigend gedrehte Erwartung. Cluster D25 in `00-kanonische-liste.md` sollte
entsprechend korrigiert werden.

---

## 4. Was beim Lauf schiefging (und warum es gut ausging)

### W1 - Worktrees von einem veralteten Commit

In Welle A standen **zwei von drei** Worktrees auf `566ccd6` - dem Commit VOR `deb0c8c`, der
den Plan ueberhaupt erst anlegt. In deren Arbeitsverzeichnis existierten `PLAN-I18N-TESTS.md`
und `tasks/i18n-tests/` nicht. Ein Agent bemerkte es selbst und zweigte von `master` ab, die
anderen lasen ueber den absoluten Repo-Pfad.

Gegenmassnahme ab Welle B: Regel 0 im Agenten-Prompt - Basis-Commit pruefen, ausdruecklich
`git checkout -b <branch> master`, und abbrechen, wenn die Plandateien fehlen. In Welle B
stand danach jeder Branch korrekt auf `master`.

### W2 - Ein Fix-Agent konnte seinen eigenen Branch nicht auschecken

Der B1-Branch war zum Zeitpunkt des Self-Fix bereits in einem anderen Worktree ausgecheckt;
git verweigert das doppelt. Der Agent legte korrekt `phase/i18n-w1-b1-sprach-kern-review-fix`
auf demselben Tip an und committete dort. Vor dem Merge verifiziert:
`git merge-base --is-ancestor` bestaetigt, dass der Fix-Branch den Original-Tip enthaelt -
gemergt wurde nur der Fix-Branch.

### W3 - Ein Blockreport meldete eine Suite von 73 Tests

Block B6 meldete "73 gesamt / 53 gruen / 20 rot" - das ist offensichtlich nicht die volle
Suite (~3000). Der Lead hat die Zahl deshalb nicht uebernommen, sondern nach dem Merge selbst
`npm test` gefahren. **Lehre: Suite-Zahlen aus Agentenreports sind Hinweise, keine Belege.**

### W4 - Ein Scoping-Agent schlug einen Produktionscode-Eingriff vor

Der Blockschnitt empfahl fuer B1, `DEFAULT_LANGUAGE` von `de` auf `en` zu kippen und zwei
Bestandstests zu loeschen. Beides ist der spaetere FIX, nicht der Testbau, und haette das
Sprachverhalten fuer jeden Bestandstenant veraendert. Im Impl-Prompt ausdruecklich untersagt;
die Scope-Reviews haben es zusaetzlich geprueft. Ergebnis: null Zeilen ausserhalb `test/`.

---

## 5. Offene Punkte

1. **`npm test` ist dauerhaft rot** (85 Tests). Das ist gewollt, macht aber den
   Bestands-Gruen-Check unlesbar - zusammen mit dem bekannten `p5-gate-proof`-Flake (~12 %).
   Vor Welle W2 zu entscheiden, ob Launch-Gate-Tests eine eigene Lauf-Kennung bekommen.
2. **K1-K3 in die Quelldateien einarbeiten** (Abschnitt 5 des Plans, Zaehlung und Cluster D25
   der kanonischen Liste).
3. **Vier Achsen sind weiter nicht live-belegt** (aus dem GAP-33-Bericht): `BUDGET_MONTH_ENABLED`,
   `MULTI_TENANT`, `SELF_SERVICE_ENABLED`, `PLATFORM_ALERT_SMS_TO`. Nur der Owner kann sie im
   Render-Dashboard ablesen.
4. **W1 gruen heisst NICHT launchfaehig.** Die fuenf zurueckgestellten Tests (GAP-02 Steuer,
   LAW-06/GAP-12/GAP-13 Consent/Opt-out, LAW-07 Anrufzeitfenster) sind aus dem Vorrat, nicht
   aus der Welt. Bei weltweitem Start mit live offenem Land-Gate (`*`) beweist ein vollstaendig
   gruenes W1 keine TCPA-/PECR-/Steuer-Konformitaet - getragenes Risiko nach 7.13.

---

## 6. Stand des Katalogs

| | |
| --- | --- |
| Arbeitsvorrat | 216 kanonische Tests (nach K2) |
| umgesetzt | **79** (GAP-33 + 78 aus W1) |
| offen | 137 - Welle W2 (P1+P2, offline) und W3 (4 live, 22 manuell) |

Beide W1-Abbruchpunkte sind aufgehoben: GAP-33 ist gebaut, und E2E-05 existiert und faehrt
ueber `prodEnv()` die ausgelieferte Konfiguration.
