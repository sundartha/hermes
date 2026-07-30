# Phase KS-P5a — Starter-Kunde bekommt die verkauften Minuten

**Zusammenfassung (E5/E5a, ein Satz):** Die Plan-Decke soll aus demselben Satz abgeleitet werden, mit dem der Verbrauch gebucht wird (`voiceTariffDefaultCents` statt einem eigenen, davon abweichenden `voiceCapRateCentsPerMin`), damit ein Starter-Kunde seine verkauften 30 Minuten auch tatsaechlich telefonieren kann statt nach ~10 Minuten an der Budget-Decke zu haengen.

**Gate:** BLOCKED
**finalBranch:** `phase/ks-p5a-starter-minuten` (existiert nicht — siehe unten)

---

## Plan (gekuerzt)

Basis: `master` @ `218bfea`.

### Befundlage
- Decke = `includedMinutes * cfg.voiceCapRateCentsPerMin * num/den` (`src/billing/plan-caps.js`)
- `voiceCapRateCentsPerMin` (Fallback 6 ct/min) hat genau einen Konsumenten: `plan-caps.js`
- Gebucht wird auf der Budget-Achse mit `tariffCentsPerMin` -> `voiceTariffDefaultCents` (Fallback 300, Render live 30)
- Die zwei Saetze laufen im Verhaeltnis 1:5 (6 vs. 30) auseinander -> Starter bekam nur 10 von 30 verkauften Minuten
- Erste Boot-Guard-Linie (`PLAN_CAP_INERT`) ist heute FATAL, wenn Decke >= Plattform-Cap (3000 ct)

### Zwei harte Kollisionen, die der Plan aufloest
1. **D-1:** Mit einem gemeinsamen Satz ergeben sich Decken oberhalb des Plattform-Caps (Business: 120·30·5/4 = 4500 ct > 3000 ct) an *jedem* plausiblen Satz-Wert. `PLAN_CAP_INERT` muss deshalb von FATAL auf WARN gesenkt werden (`PLAN_CAP_UNDERIVABLE` bleibt FATAL). Begruendung: kein Geld-Gate wird beruehrt, die geschriebene Decke bleibt weiter auf den Plattform-Cap geklemmt (Schnittmenge Tenant ∧ Plattform unveraendert); die Schwesterlinie `tenantCapRowInertFindings` traegt fuer dieselbe Bedingung bereits WARN.
2. **D-2:** Ein Buchungssatz von `0` (Kosten-Achse testneutral abgeschaltet, `min: 0`) darf keine 0-Decke schreiben (sonst `budgetExceeded` sofort true, Telefonie-Totalausfall). Fix: an der Schreibkante (`deriveTenantBudgetFromPlan`) wird Decke `<= 0` als No-op + genau eine WARN behandelt, bestehende/Default-Decke bleibt bestehen.
3. **D-3:** Kein neuer Env-Schalter, keine neue Datei, keine neue Dependency; `voiceCapRateCentsPerMin` entfaellt ersatzlos.

### Aufstellung (Grundlage fuer Owner-Entscheidung E9)
- Gebuchter Satz: Inland (gleiche Vorwahl beidseitig) = `voiceTariffDomesticCents` (20 ct/min); alles andere inkl. Live-Fall US-DID->DE = `voiceTariffDefaultCents` (300 ct/min Code-Fallback bzw. 30 ct/min live). Inbound bucht nichts auf die Gate-Achse. Assistant-Pfad AN/AUS macht keinen Unterschied.
- Decke je Plan bei 30 ct/min: Starter 1500 ct (verkaufte Minuten kosten 900 ct, Kopffreiheit-Rest 600 ct, traegt 50 Min. >= 30); Business 4500 ct (kostet 3600 ct, Rest 900 ct, traegt 150 Min. >= 120). Bei 300 ct/min: 15000 / 45000 ct.
- Plattform-Cap-Bedarf bei N gleichzeitig ausschoepfenden Kunden (Satz 30 ct): Faustformel `MAX_BUDGET_EUR >= 15€×N_starter + 45€×N_business` (Decken-Lesart, worst case).
- Heutiger Wert 3000 ct (30 €): Business klemmt schon bei N=1 (Decke 4500 -> geklemmt auf 100 statt 120 Minuten); Starter ungeklemmt bis N=2 (Decke) bzw. N=4 (reine Minutennutzung). `BUDGET_MONTH_ENABLED` ist im Code/`render.yaml` `false` (Lebenszeit-Topf), live laut Notiz seit 07-25 `true` (Perioden-Topf) — die Tabelle gilt je nach Flag "pro Periode" oder "einmalig fuer immer".
- Fazit: 30 € traegt heute drei Starter-Kunden oder null Business-Kunden. Die Zahl selbst ist Geschaeftsentscheidung (E9), bleibt in dieser Phase unangetastet.

### Geplante Edits (nicht umgesetzt)
- `src/billing/plan-caps.js`: Formel auf `cfg.voiceTariffDefaultCents` umstellen, Kommentare nachziehen
- `src/config.js`: `voiceCapRateCentsPerMin` ersatzlos entfernen, Doku bei `voiceTariffDefaultCents` ergaenzen, `CONFIG_NAMESPACES.billing` 36->35 Keys
- `src/store/state-ops.js` (`deriveTenantBudgetFromPlan`): neuer Fall (4) — Decke `<= 0` -> No-op + WARN `grund=tarif_null`
- `src/boot-guard.js`: `PLAN_CAP_INERT` `fatal: true` -> `fatal: false`, Message nachziehen; `PLAN_CAP_UNDERIVABLE` bleibt FATAL
- `src/boot.js`, `.env.example`, `render.yaml`, `PLAN-SECURITY.md` (neuer Abschnitt `KS-P5A-EINSATZ`), `STATUS.md`: Kommentare/Doku nachziehen
- Neuer Test `test/ks-p5a-plan-cap-carries-sold-minutes.test.js` (reine Rechnung, Mutationsprobe gegen den Bestand rot)
- 9 bestehende Testdateien angepasst (Env-Umbenennung `voiceCapRateCentsPerMin`->`voiceTariffDefaultCents`, neuer Severity-Test j5, gedrehte Erwartung in `boot-failclosed.test.js`, PAY-04-Charakterisierungstest wird zum KS-P5a-Fix-Beweis und verlaesst den Katalog-Praefix-Schutz)

Details siehe vollstaendiger Plan-Text (Quelle dieses Berichts).

---

## Impl-Zusammenfassung + Deviations

**Keine Implementierung erfolgt.** `IMPL = null`.

Der Ziel-Branch `phase/ks-p5a-starter-minuten` existiert nicht — weder lokal noch auf `origin` noch auf `upstream`, kein einziger KS-P5a-Commit im Objektspeicher (auch nicht unreferenziert, `git fsck --dangling` leer). Das Schwester-Impl-Worktree desselben Workflows wurde waehrend des Reviews vom Harness abgeraeumt, was laut Harness-Verhalten nur bei null Aenderungen geschieht. Ein etwaiges PASS des Impl-Schritts waere ein Falsch-Positiv (bekanntes Muster "Workflow-PASS != Merge-Freigabe / toter Impl-Agent -> leerer Branch trotz PASS").

Zusaetzlicher Befund: das Review-Worktree stand auf `57adf4a`, einem Vorfahren von `master` (`218bfea`) — rund 70 Commits veraltet, insbesondere fehlten genau die beiden Commits, die KS-P5a ueberhaupt spezifizieren (`8da360d`, `218bfea` mit `PLAN-KOSTEN-STEUERUNG.md`). Ein Impl-Agent auf dieser Basis haette die Spec gar nicht sehen koennen.

Auch der Fix-Versuch (r1) scheiterte: kein Branch `phase/ks-p5a-starter-minuten-fix1`, kein Commit vom Fix-Agenten. Self-Fix-Schleife beendet.

---

## Safety-Urteil (final)

```json
{
 "approved": false,
 "testsPassIndependently": false,
 "safetyGatesIntact": true,
 "disclosureIntact": true,
 "authFailClosedIntact": true,
 "noSecretsLeaked": true,
 "scopeRespected": true,
 "behaviorAsIntended": false
}
```

**Verdict:** BLOCK / NICHT FREIGEGEBEN — nichts zu reviewen, nichts implementiert.

Kein Branch, kein Diff, kein Code-Delta. Die "intakt"-Flags (safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected) stehen nur trivial auf `true`, weil nichts existiert, das etwas haette aufweichen koennen — keine positive Freigabe. `behaviorAsIntended=false` ist die substanzielle Aussage: keine der Spec-Invarianten aus `PLAN-KOSTEN-STEUERUNG.md` (ein einziger Satz statt zweier, vorgelagerte Aufstellung, MAX_BUDGET_EUR-Folgekette, rot-faerbende Mutationsprobe, "Decke anheben statt abschaffen", `PLAN-SECURITY.md`-Nachzug) ist erfuellt.

**Blocker:**
1. Branch `phase/ks-p5a-starter-minuten` existiert nicht (erschoepfend geprueft: `git for-each-ref` ueber 633 Refs, `packed-refs`, `ls-remote origin`, `ls-remote upstream`, `git log --all --grep`, `git reflog --all` — durchweg 0 Treffer)
2. Kein Diff pruefbar, Schritte 2/4 des Review-Auftrags unausfuehrbar
3. Beweis fuer leeren Lauf: Impl-Worktree wurde waehrend des Reviews vom Harness geloescht (geschieht nur bei null Aenderungen); `git fsck --dangling` findet nichts
4. Keine unabhaengigen Tests gefahren (waere gegen einen veralteten master gelaufen und haette nichts ueber die Phase ausgesagt)
5. Wiederholungsgefahr fuer den Neulauf: Review-Basis `57adf4a` ist ~70 Commits hinter `master` (`218bfea`); der Impl-Agent braucht `218bfea` als Basis, sonst fehlt ihm `PLAN-KOSTEN-STEUERUNG.md`

**Concerns fuer den Neulauf:**
- MAX_BUDGET_EUR-Anhebung (E9) ist Owner-Entscheidung, keine Agenten-Schaetzung — scharf pruefen, falls ein Impl-Agent das anfasst
- Die Auflage "Decke wird angehoben, nicht abgeschafft — Schnittmenge mit dem Plattform-Notaus bleibt bestehen" ist die Stelle mit dem groessten Risiko eines Verstosses gegen Absolute Regel 1
- Im Impl-Worktree vor Arbeitsbeginn `git merge-base --is-ancestor master HEAD` pruefen; `ln -s ./node_modules node_modules` setzen

---

## Clean-Code-Audit (final)

**s1 (BLOCKER):** Branch `phase/ks-p5a-starter-minuten` existiert weder lokal noch auf origin/upstream (`git branch -a`, `git ls-remote`, `git for-each-ref` — alle ohne Treffer). Kein Diff pruefbar. Vor erneutem Audit: Branch-Namen/Commit beim Auftraggeber verifizieren — moeglicherweise abgebrochener Lauf (vgl. Lehre "aborted-run-leaves-colliding-branch": naechster Versuch kann als `<branch>-impl` auftauchen).

**s2:** — (kein Code gesehen)
**s3:** — (kein Code gesehen)
**s4:** — (kein Code gesehen)

**blocker:** true

**Verdict:** Kein Audit moeglich. `master` (lokal, frisch gefetcht) steht auf `218bfea` (docs(ks): Scope-Spec der Kosten-Kette) ohne jeden Hinweis auf eine KS-P5a-Implementierung.

**Top-TODOs:**
1. Branch-Namen/Commit fuer KS-P5a beim Auftraggeber verifizieren
2. Falls die Phase nie implementiert wurde: Impl-Schritt erneut anstossen, bevor der Auditor beauftragt wird
3. Danach diesen Audit mit dem bestaetigten Branch neu ausfuehren

---

## Fix-Runden

**r1:** NICHT AUSFUEHRBAR — Ziel-Branch `phase/ks-p5a-starter-minuten` existiert nicht (unabhaengig neu geprueft: `git for-each-ref`, `git branch -a`, `git fetch --all origin+upstream` — alle ohne Treffer; kein `tasks/ks-p5a*`-File). Deckt sich exakt mit dem Erstreview-Befund.

**r1 (Ergebnis):** ABBRUCH — kein Commit vom Fix-Agenten (Branch `phase/ks-p5a-starter-minuten-fix1` existiert ebenfalls nicht). Self-Fix-Schleife beendet, Blocker der Erstreview-Runde bleiben stehen.

---

## Fazit

KS-P5a ist vollstaendig **geplant**, aber nicht implementiert. Der Plan selbst ist in sich konsistent und beantwortet die geforderte Aufstellung fuer E9 vollstaendig; er identifiziert die zwei notwendigen Guard-Entscheidungen (D-1: `PLAN_CAP_INERT` FATAL->WARN, D-2: 0-Satz schreibt keine 0-Decke) mit Pre-Mortem und Alternativenabwaegung. Der Impl-Lauf ist jedoch nie gestartet oder wurde spurlos verworfen — kein Branch, kein Commit, kein Diff. Naechster Schritt: Impl-Lauf neu anstossen, hart auf `master`@`218bfea` gepinnt, Branch-Existenz nach dem Lauf per `git for-each-ref` selbst verifizieren statt der Agenten-Meldung zu vertrauen.
