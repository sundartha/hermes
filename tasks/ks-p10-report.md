# Phase KS-P10 — Inbound wird nie budget-gesperrt (E11)

**Gate: BLOCKED**
**finalBranch: `phase/ks-p10-inbound-frei`**

## Kernaussage

Der geplante Branch `phase/ks-p10-inbound-frei` existiert nicht — weder lokal, noch auf
`origin`, noch auf `upstream`, kein `-impl`-Ausweichbranch, kein Reflog-Eintrag. Es gibt
kein Diff, das implementiert, gereviewt oder gemergt werden konnte. Der Impl-Agent hat
keinen Commit hinterlassen (Muster "Workflow-PASS != Merge-Freigabe" / toter Impl-Agent
ohne Branch). Ein einziger Fix-Versuch (r1) scheiterte ebenso: kein Commit, kein Branch
`phase/ks-p10-inbound-frei-fix1`.

An `master` (`d76c46a`) wurde nichts beschädigt — keine der absoluten Regeln (Safety-Gates,
Offenlegung, Auth-fail-closed, Secrets, Scope) ist verletzt, weil schlicht nichts
geschrieben wurde.

---

## Plan (gekürzt)

Basis: `master = d76c46a` (KS-P9 und KS-P5a bereits gemergt — `globalBudgetExceeded`
existiert nicht mehr, `BUDGET_AXIS` hat nur noch `TENANT`).

**Kern-Idee:** `blockingBudgetAxis` (`src/budget-gate.js`) ist die eine Quelle für "sperrt
die Geld-Achse gerade?" mit genau zwei Aufrufern (`roundStopReason` in `src/claude.js`,
Schritt 6 im Shim `src/telnyx-llm-shim.js`). Zieht man die Richtungsfrage in
`blockingBudgetAxis` hinein (Signatur nimmt `call` statt `tenantId`), sind Mid-Call-Abbruch
und Assistant-Pfad auf einen Schlag erledigt. `routes/voice.js` hat eine eigene, zweite
Prüfung bei der Inbound-Annahme — die wird ersatzlos gelöscht. `outbound-gates.js`
(Dial-Gate + Reserve) bleibt unangetastet, die Sperrwirkung dort bleibt vollständig.
Ergebnis laut Plan: 4 Code-Dateien, ~15 geänderte Zeilen.

**Geplante Edits:**

1. `src/budget-gate.js` — neue Funktion `budgetGateApplies(call)` (`call.direction !== "inbound"`,
   fail-closed: nur exakt `"inbound"` ist befreit), `blockingBudgetAxis({ store, billing, call })`
   ruft sie zuerst.
2. `src/claude.js` — Aufrufer-Anpassung `tenantId: call.tenantId` → `call` (verhaltensneutral)
   + Kommentar-Ergänzung.
3. `src/telnyx-llm-shim.js` — dieselbe Aufrufer-Anpassung in Schritt 6 + Kommentarzeile;
   `killCallForBudget`/Schritt 7 bleiben byte-identisch.
4. `src/routes/voice.js` — der `budgetExceeded`-Block bei `/voice/incoming` wird ersatzlos
   gelöscht, ersetzt durch einen Erklär-Kommentar.
5. `PLAN-SECURITY.md` — Befund-8-Stichpunkt aktualisiert + neuer Abschnitt "KS-P10".
6. `tasks/ks-p10-report.md` — dieser Bericht.

**Geplante Tests** (`test/ks-p10-inbound-never-budget-blocked.test.js`, 9 Fälle):
Block A (Einheit `blockingBudgetAxis`, 4 Fälle inkl. fail-closed-Grenzfälle), Block B
(Shim-Harness, 2 Fälle: Inbound nicht aufgelegt / Outbound-Gegenprobe unverändert), Block C
(Spawn-Routen, 3 Fälle: `/voice/incoming` nimmt trotz erschöpfter Decke an; Pflicht-Gegenprobe
`/api/calls` bleibt 402; laufendes Inbound-Gespräch wird mid-turn nicht aufgelegt).
Mutationsproben-Tabelle für 4 Mutationen von `budgetGateApplies` vorgesehen.

**Pre-Mortem-Punkte aus dem Plan:** Befreiung gilt nur, solange Inbound nichts bucht (Kopplung
an KS-P2 explizit benannt); fail-closed-Test gegen fehlende `direction`; strukturelle Garantie
gegen eine künftige zweite Budget-Abfrage.

---

## Impl-Zusammenfassung + Abweichungen (Deviations)

**Kein Impl-Ergebnis vorhanden.** Der Impl-Lauf hat keinen Branch, keinen Commit und keine
Datei erzeugt. `IMPL === null` im Quellprotokoll. Keine der geplanten Code-Änderungen
(2.1–2.6) lässt sich am Repo nachweisen:

- `src/budget-gate.js` — keine Funktion `budgetGateApplies`, `blockingBudgetAxis` nimmt laut
  Safety-Review weiterhin die alte Form.
- `src/billing/metering.js` enthält laut Safety-Review nur die vorbestehenden
  Richtungs-Stellen (Tarif-Zeile, Buchungs-Zeile) — keine neue richtungsabhängige
  Budget-Sperre.
- `test/ks-p10-inbound-never-budget-blocked.test.js` existiert nicht.
- `PLAN-SECURITY.md` trägt keinen KS-P10-Abschnitt.

Abweichung vom Plan: **vollständig** — 0 von 6 geplanten Datei-Änderungen wurden umgesetzt.
Zusätzlich lag der Review-Worktree auf einer veralteten Basis (`57adf4a`, 75 Commits hinter
`master`, ohne KS-P9/KS-P5a) — das bekannte Muster "Worktree auf veraltetem Commit". Ob der
Impl-Agent an derselben Stale-Base-Falle scheiterte oder aus einem anderen Grund nichts
schrieb, ist nicht feststellbar, da kein Worktree-Log/Artefakt übrig blieb.

---

## Safety-Urteil (final)

`approved: false`. Alle Verifikations-Flags (`testsPassIndependently`, `safetyGatesIntact`,
`disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`,
`behaviorAsIntended`) stehen auf `false` — **im Sinne von "nicht verifizierbar mangels
Diff", nicht im Sinne von "Defekt gefunden"**. Kein Schaden an `master` festgestellt;
`node --check` auf `src/claude.js`, `src/bridge.js`, `src/billing/metering.js` lief grün.

**Verdikt:** BLOCK — kein Prüfgegenstand. Branch existiert nirgends
(`git checkout -b review-ks-p10 phase/ks-p10-inbound-frei` → Exit 128 "is not a commit";
`git diff --stat master phase/ks-p10-inbound-frei` → Exit 128 "unknown revision";
`git ls-remote --heads origin/upstream | grep ks-` → beide leer; kein Reflog-Eintrag).

**Blocker:**
1. Kein Artefakt — Branch existiert nirgends, Review physisch unmöglich.
2. Stale Base des Review-Worktrees (`57adf4a`, 75 Commits hinter `master`) — die gesamte
   KS-Kette (KS-P9, KS-P5a, Spec-Commits) fehlt dort; falls der Impl-Agent auf derselben
   Basis lief, wäre ein dort gebautes KS-P10 ohnehin unbrauchbar, weil die Spec
   Spiegelbildlichkeit zu KS-P9 verlangt. Neulauf braucht harte Basis-Prüfung
   (`git merge-base --is-ancestor master HEAD`) vor der Implementierung.
3. Spec-Invarianten ungeprüft — insbesondere Punkt (d): fail-closed bei nicht auflösbarer
   Richtung. Ein `direction !== "outbound"`-Test würde `undefined` fälschlich als Inbound
   freigeben und das Gate für richtungslose Calls öffnen — sicherheitskritischster Punkt,
   beim Neulauf gezielt zu prüfen.

**Concerns:** `npm test` wurde bewusst nicht gefahren (kein Branch als Prüfgegenstand,
~50 aktive Worktrees / dokumentierte Parallelitäts-Grenze); ein etwaiger vorheriger PASS
eines Impl- oder Clean-Code-Agenten zu dieser Phase ist nachweislich haltlos und sollte
verworfen werden.

---

## Clean-Code-Audit (S1–S4)

- **S1:** `BRANCH-MISSING` — Branch `phase/ks-p10-inbound-frei` existiert nicht (weder lokal
  noch auf `origin`/`upstream`); in der KS-Kette existieren bisher nur
  `phase/ks-p5a-starter-minuten` und `phase/ks-p9-plattform-beobachtung`. Kein Code
  bewertbar.
- **S2:** keine.
- **S3:** keine.
- **S4:** keine.

**Blocker:** ja. **Verdikt:** Audit nicht durchführbar — kein Diff vorhanden, keine Befunde
erfunden. Top-Todos: korrekten Branch liefern/pushen, danach Audit mit
`git diff master phase/ks-p10-inbound-frei` erneut anstoßen.

---

## Fix-Runden

- **r1:** kein Ergebnis. Abbruch — kein Commit vom Fix-Agenten, Branch
  `phase/ks-p10-inbound-frei-fix1` existiert nicht. Self-Fix-Schleife beendet; die
  Blocker der Erstreview-Runde bleiben stehen.

---

## Fazit / nächster Schritt

Phase KS-P10 ist nicht umgesetzt. Kein Code-Schaden an `master`, aber auch kein Fortschritt
gegenüber dem Plan. Empfehlung: KS-P10 neu implementieren lassen, ausgehend von `master`
(aktueller Stand, nicht `57adf4a`), mit expliziter Basis-Prüfung vor Beginn der
Implementierung. Spec liegt vor (`tasks/ks-chain-spec.md`, Abschnitt "KS-P10", plus
`PLAN-KOSTEN-STEUERUNG.md` Abschnitt "KS-P10"). Vor jedem Merge weiterhin
`git diff --stat` prüfen — ein PASS-Report allein ist kein Nachweis, dass Code existiert.
