# Prompt fuer die naechste Session — Strategiedokument fuer die Gate-Kette

> Alles ab der naechsten Zeile ist der Prompt. In einer FRISCHEN Session einfuegen.

---

Wir haben den i18n-Testkatalog vollstaendig abgearbeitet (Wellen W1, W2, W3 — siehe
`tasks/i18n-tests/`). Ergebnis: **36 rote Launch-Gates**, die den offenen Produktvorrat vor
dem Start beschreiben. Deine Aufgabe in dieser Session ist **NUR Planung**: ein
Strategiedokument `PLAN-GATES.md` im Repo-Root. **Kein Produktionscode, kein Fix, kein
Deploy.**

## Ausgangslage (gemessen, nicht angenommen)

- `npm test` (Regressionsschutz): **3295 / 0 rot** — muss so bleiben.
- `npm run test:gates` (Launch-Gates): **515 Tests / 36 rot**.
- Die Trennung laeuft ueber den Katalog-ID-Praefix im Testnamen
  (`config.i18nCatalogPattern` in `package.json`) — es gibt KEINE gepflegte Liste.
- Master traegt die W3-Protokolle; der juengste Gate ist `PAY-19`
  (`test/pay-19-sca-authentication-required.test.js`).

## Der wichtigste Unterschied zu frueheren Ketten

**Die Anforderungen liegen bereits als ausfuehrbare Tests vor.** Jeder rote Gate IST seine
eigene Spezifikation, und jede Phase hat damit eine objektive Abnahmebedingung: *diese
Gates werden gruen, die 3295 Regressionstests bleiben gruen*.

Daraus folgt: **schreibe KEIN Design-Dokument je Phase.** Es braucht ein SCHNITT-Dokument.
Kein BDUF (CLAUDE.md). Die Frage lautet nicht "was ist der Sollzustand" — die beantwortet
der Test — sondern "welche Gates teilen sich einen Aenderungsort, was darf parallel laufen,
was erzwingt eine Reihenfolge".

## Schritt 1 — TRIAGE (zuerst, vor jeder Planung)

Klassifiziere **jeden** der 36 roten Gates gegen den HEUTIGEN Code:

| Klasse | Bedeutung |
| --- | --- |
| `GUELTIG` | Der Befund besteht, der Fix steht aus. |
| `ERLEDIGT` | Der Code erfuellt den Sollzustand bereits; der Test ist rot aus einem anderen Grund (falscher Anker, veraltete Annahme). |
| `FALSCH_SPEZIFIZIERT` | Der Gate misst etwas, das der Sollzustand nicht verlangt, oder zeigt auf eine tote Oberflaeche. |
| `UEBERHOLT` | Eine Owner-Entscheidung hat die Praemisse aufgehoben. |
| `GETRAGEN` | Bewusst akzeptiertes Risiko, kein Arbeitsvorrat. |

**Warum das zuerst kommt:** in W3 waren **vier von 26** Katalogeintraegen tot — PROMPT-05 und
MCP-21 laengst gefixt, MCP-18 und UI-20 messen einen Mechanismus, den Phase P13 entfernt
hat. Der Katalog stammt aus einer Recherche, die AELTER ist als 15 Fix-Phasen. Fuer einen
bereits gruenen Gate eine Phase zu entwerfen ist verschwendete Arbeit.

Jede Klassifikation braucht einen **Beleg am Code** (Datei:Zeile oder Kommando + Ausgabe).
"Sieht erledigt aus" zaehlt nicht.

## Schritt 2 — CLUSTERN nach Aenderungsort, nicht nach ID

36 Gates sind keine 36 Phasen. `DID-05`, `DID-09` und `GAP-11` verlangen alle drei explizite
Eintraege in derselben Laender-Tabelle — eine Aenderung. `GAP-08` x2 ist ein Wechselkurs.
`WEB-10`/`WEB-13` sind zweimal derselbe Sachverhalt.

**Der Aenderungsort ist die Parallelitaets-Grenze.** Zwei Phasen, die dieselbe Datei
anfassen, kollidieren im Worktree. Fuer jeden Cluster brauche ich deshalb die konkrete
**Dateiliste** — daraus leitest du ab, was gleichzeitig laufen darf.

Erwartete Groessenordnung: **10-14 Phasen**. Weicht dein Schnitt stark davon ab, begruende es.

## Schritt 3 — REIHENFOLGE nach Risiko

Zuerst, was einen Kunden blockiert oder Geld bewegt. Nach heutigem Stand:

1. **`PAY-19` / SCA-Sackgasse** (`PLAN-SECURITY.md`, Rubrik `SCA-DEADEND`) — der einzige
   Befund, bei dem ein Kunde zahlen WILL und nicht kann. Wurzel liegt tiefer als "fehlende
   Behandlung": `assertOk` (`src/billing/stripe.js:92-94`) verwirft den Stripe-Code an der
   Adapter-Grenze, der Aufrufer KANN die Faelle nicht trennen.
2. Restlicher Geld-/Provisioning-Cluster (`GAP-06/08/09/11/19/23/34`, `DID-05/09`).
3. Sprache/MCP und Web/Dashboard.
4. Kosmetik und Doku-Kohaerenz (`OUT-14`, `GAP-31`, `GAP-37`).

**Nicht als Phase planen:** `GAP-15` x2 wartet auf Rechtstexte (Owner-Arbeit, kein Code) und
`GAP-05` ist ein getragenes Risiko.

## HARTE REGEL — gegen den falschen gruenen Gate

In W2 ist **`VOICE-12` lautlos zu einer Bestaetigung des Defekts geworden**: der Gate landete
als gruener Ist-Pin ("eine Voice-ID fuer alle Sprachen — das IST der Beweis"), **beide
Reviews gaben ihn frei**, gefunden hat es erst die Lead-Pruefung.

Deshalb gilt fuer jede Phase als Abnahmekriterium:

> **Ein Gate geht gruen, WEIL sich das Produkt geaendert hat — nicht, weil der Test
> umgeschrieben wurde.** Ein Diff, der ausschliesslich `test/` beruehrt, ist ein
> Verdachtsfall und braucht eine ausdrueckliche, im Phasenbericht dokumentierte Begruendung.

Mechanisch pruefbar: `git diff --name-only <base>..<branch> -- src/ public/ apps/` darf nicht
leer sein.

## Form des Dokuments `PLAN-GATES.md`

1. **Triage-Tabelle** — alle 36 Gates mit Klasse und Beleg. Die Zahl der `GUELTIG`-Eintraege
   ist das echte Arbeitsvolumen.
2. **Pre-Mortem** (CLAUDE.md-Pflicht) — versetz dich ein Jahr in die Zukunft, die Kette ist
   gescheitert: was ist passiert? Mindestens: ein Geld-Gate wurde gruen, ohne dass sich das
   Verhalten aenderte; zwei Phasen kollidierten; eine Migration lief zweimal.
3. **Phasen** — je Phase: ID, Titel, abgedeckte Gates, **Dateiliste**, Konflikte mit anderen
   Phasen, Risikoklasse (Geld/Safety/kosmetisch), Abnahmekriterium (welche Gates gruen +
   Regression 3295/0 + Diff beruehrt `src/`).
4. **Parallelitaets-Matrix** — welche Phasen duerfen gleichzeitig laufen (disjunkte
   Dateilisten), welche muessen nacheinander.
5. **Offene Owner-Fragen** — alles, was eine Entscheidung braucht, BEVOR die Phase laufen
   kann. Bekannt ist mindestens: fuer `VOICE-12` muss der Owner je eine englische und eine
   franzoesische ElevenLabs-Stimme AUSSUCHEN (Geschmack, nicht Technik).
6. **Kickoff-Prompt** fuer die Ausfuehrungs-Session (siehe unten).

## Token-Disziplin — gilt fuer DIESE Session, nicht erst fuer die Ausfuehrung

Die Triage ist der Loewenanteil des Verbrauchs. Drei Vorgaben:

**1. Buendle nach TESTDATEI, nicht nach Gate-ID.** Gemessen: die 36 roten Gates liegen in
**21 Dateien** — `dashboard-i18n-surface.test.js` allein traegt vier (`WEB-07/08/19`,
`GAP-30`), `gap-15-...`, `fx-single-source`, `tts-quota-counter` je zwei. Ein Agent je Datei
liest den Anker EINMAL statt mehrfach: **21 Agenten statt 36**. Thematisch verwandte Dateien
darfst du weiter zusammenlegen (z.B. `f1-geo-store` + `f1-provisioning-geo`).

**2. Modelle und Effort gezielt setzen — NIE das geerbte Modell durchreichen.**

| Aufgabe | Modell | Effort |
| --- | --- | --- |
| Triage je Testdatei (mechanisch: Test lesen, Code lesen, klassifizieren) | **Sonnet** | `low`-`medium` |
| Cluster-Schnitt + Parallelitaets-Matrix (Urteil, Folgekosten) | **Opus** | hoch |
| Pre-Mortem + Endfassung des Dokuments | **Opus** | hoch |

36 Triage-Agenten auf Opus waeren die teuerste und unnoetigste Variante dieser Session.

**3. Der Lead bekommt Urteile, keinen Code.** Erzwinge strukturierte Rueckgabe
(`schema`-Option) mit knappen Feldern: `gateId`, `klasse`, `beleg` (Datei:Zeile ODER
Kommando + beobachtete Ausgabe, **maximal zwei Zeilen**), `betroffeneDateien`. Keine
Quelltext-Ausschnitte, keine Fliesstext-Analysen. **Der Lead liest KEINEN Produktionscode** —
er synthetisiert aus den Rueckgaben.

**Fallstrick dazu (aus dem Team-Gedaechtnis):** ein erzwungenes Schema garantiert die
STRUKTUR, nicht den INHALT — ein Low-Effort-Agent hat Pflichtfelder schon mit `"Test"`
gefuellt. Grepp die Rueckgaben auf Platzhalter (`Test`, `TODO`, `n/a`, leere `beleg`-Felder)
und zieh die faulen Einzel-Agenten gezielt nach, statt den ganzen Lauf zu wiederholen.

## Ausfuehrungs-Modell, das du im Dokument festschreibst

Die naechste Session faehrt **pro Phase einen `phase-impl-lean`-Workflow**, parallel wo die
Dateilisten disjunkt sind. Der Lead liest KEINEN Produktionscode und merged erst nach
eigener Pruefung. Verbindlich aus dem Team-Gedaechtnis:

- **Modell-Politik:** Subagenten nie auf dem geerbten Modell laufen lassen. Opus fuer Plan
  und Safety-Review, Sonnet fuer Implementierung, Audit, Fix und Bericht — Pins explizit je
  `agent()`.
- **Worktree-Basis:** `isolation:worktree` legt Worktrees NICHT zuverlaessig auf `master` an.
  "Regel 0" im Phasen-Prompt erzwingen UND im Lead per `git merge-base` pruefen.
- **Nicht mergen, solange parallele Workflows laufen** — das erzeugt falsch-positive
  Stale-Base-Blocker und verbrennt Fix-Runden.
- **`git stash` ist worktree-GETEILT** — waehrend laufender Worktree-Workflows niemals.
- **Vor JEDEM Merge `git diff --stat`** — ein toter Impl-Agent hinterlaesst einen leeren
  Branch trotz PASS-Meldung.
- **Kein `git add -A`** in diesem Repo.

## Womit du anfaengst

Lies zuerst `CLAUDE.md`, `.claude/refs/workflow.md`, `tasks/i18n-tests/28-w3-checkliste.md`
(die W3-Protokolle, besonders Abschnitte 5-8) und `PLAN-SECURITY.md` (Rubrik `SCA-DEADEND`).
Lauf dann `npm run test:gates` selbst — verlass dich nicht auf die Zahl in diesem Prompt.

Fuer die Triage faehrst du EINEN Dynamic Workflow (die Gates sind unabhaengig pruefbar und
damit ideal parallelisierbar) — gebuendelt nach Testdatei und mit den Modell-/Effort-Pins
aus "Token-Disziplin". Cluster-Schnitt, Pre-Mortem und Dokument schreibst du als Lead.
