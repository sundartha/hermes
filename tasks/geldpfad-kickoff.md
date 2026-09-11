# Kickoff: Geldpfad-Behebungskette (GP-P0..P6)

Kopiere den Block unten als erste Nachricht in eine **frische** Session. Frisch ist Pflicht,
nicht Stil: der Lead soll duenn bleiben, und ein Lead, der mit 200k Vorgeschichte startet,
ist es nie.

---

Du bist der **Lead** einer Behebungskette. Du orchestrierst, du implementierst nicht.

Lies ZUERST, vollstaendig und ohne dich auf Zusammenfassungen zu verlassen:

- `CLAUDE.md` — Absolute Regeln. Diese Kette beruehrt Geld, Nummernkauf, Budget-Gates und
  Auth-Oberflaechen, ist also per Definition nicht-trivial.
- `PLAN-GELDPFAD.md` — die Kette: sieben Phasen, je mit Auftrag, belegten Stellen,
  Abnahmekriterium, Verifikationsmethode und Abgrenzung. Das ist dein Manifest. Hier wird NICHT
  geplant, sondern abgearbeitet.
- `.claude/refs/workflow.md` — Pflicht, insbesondere Abschnitt 2a (was Subagenten kosten).

Die Messwerte des Vorfalls stehen bereits in `PLAN-GELDPFAD.md` (Herkunft: Render-Logs des
Dienstes und Stripe-Dashboard vom 11.09.2026, Nummern- und Guthabenstaende aus dem
Telnyx-Portal desselben Tages). Du brauchst keine weitere Befund-Datei.

## Deine Rolle, hart abgegrenzt

- **Du liest NIE Quellcode und NIE Diffs.** Kein `git diff` ausser `--stat`. Kein `cat` auf
  `src/**`. Wenn du wissen willst, was eine Phase getan hat, liest du ihren Report-Pfad —
  nicht den Code.
- **Zwei Ausnahmen, beide zaehlen statt auszugeben** — sie sind Teil der Abnahmekriterien und
  geben dir keinen Code zu lesen, sondern eine Zahl:
  `grep -cF "<Zeichenkette>" <datei>` (zaehlt Treffer, erwartet 0) und das gefilterte
  Nicht-Kommentar-Diff aus dem Abnahmekriterium von GP-P5, das die Zahl der geaenderten
  Logikzeilen liefert. Alles andere bleibt verboten.
- Du faehrst jede Phase ueber `.claude/workflows/phase-impl-lean.js`, mit einer **per-run
  Kopie** des Skripts (nie das geteilte Original editieren — andere Sessions lesen es).
- Aufruf-Form, die nachweislich funktioniert:
  `Workflow({ scriptPath, args: { phaseId, phaseTitle, branch, baseBranch, planDoc, specFile, maxFixRounds, highStakes } })`
  — `args` MUSS ein echtes Objekt sein und `phaseId` tragen; fehlt es, bricht der Workflow
  fail-closed ab. Der lange Auftragstext gehoert in die `specFile`, nicht in `args`.
- **`maxFixRounds` raetst du nicht.** Er folgt aus der Spalte **Groesse** der Phasentabelle in
  `PLAN-GELDPFAD.md` Abschnitt 1: `S` -> `1`, `M` -> `2`, `L` -> `3`. Konkret also GP-P0 `1`,
  GP-P1 `1`, GP-P2 `3`, GP-P3 `2`, GP-P4 `2`, GP-P5 `1`, GP-P6 `2`. Braucht eine Phase mehr
  Runden, ist der Phasenschnitt falsch — ein sauberes BLOCKED ist dann das richtige Ergebnis,
  keine weitere Runde.
- **Modell-Pins sind im Skript bereits gesetzt** (Plan + Safety-Review auf Opus,
  Implementierung/Clean-Code/Fix/Report auf Sonnet). Pruefe sie in deiner per-run Kopie nach,
  aendere sie nicht ohne Grund — Vererbung waere ein Kosten-Bug.
- **`highStakes` MUSST du selbst setzen.** Das Skript leitet Hochrisiko aus einer
  hartkodierten Liste `["P5","P6","P7"]` ab (`.claude/workflows/phase-impl-lean.js:91`,
  `HIGH_STAKES_PHASES`). Unsere IDs heissen `GP-P<N>` und treffen diese Liste **NICHT** —
  weder `GP-P5` noch `GP-P6` matchen, weil verglichen wird, ob die Liste die **ganze** Phasen-ID
  enthaelt. Ohne den expliziten Schalter laeuft die Implementierung des Geldpfads auf dem
  schwaecheren Modell und der Safety-Review eine Stufe weicher. Setze ihn so:

  | Phase | Titel | `highStakes` | Warum |
  |---|---|---|---|
  | GP-P0 | Sichtbarkeit: zahlender Mandant ohne Nummer | `false` | Reiner Selektor, bewegt kein Geld, loest keinen Anruf/SMS aus |
  | GP-P1 | Ablehnungsgrund: Diagnose UND Steuerung | `false` | Liest einen bereits geparsten Fehlerkoerper; keine Request-Form, kein Gate, keine Geldrechnung. **Die PII-Positiv-Kontrolle bleibt trotzdem hartes Abnahmekriterium** — `lastError` landet dauerhaft in Postgres |
  | GP-P2 | Eignung der Zahlungsmethode | **`true`** | Fail-closed-Gate direkt vor dem Geldpfad; eine falsche Null-Politik sperrt alle Bestands-Mandanten aus |
  | GP-P3 | Wiederanlauf + Versuchsdeckel | **`true`** | Macht aus einer Speicher-Route eine geldbewegende; beruehrt den letzten Deckel gegen DID-Vermehrung |
  | GP-P4 | Zeitgesteuerter Wiederanlauf | **`true`** | Automatischer Kaufanstoss auf dem Pfad, der strukturell an `MAX_NUMBERS_PER_TENANT` vorbeilaeuft |
  | GP-P5 | R4-Kommentar korrigieren | `false` | Kein Verhalten, keine Logikzeile |
  | GP-P6 | Preis-Waechter Katalog gegen Stripe | **`true`** | Fuehrt einen FATAL-Boot-Guard ein — genau der Fall, den die Hochrisiko-Definition des Skripts nennt ("ein Live-Dienst, der nicht mehr startet") |

- **Eine Bahn zur Zeit.** Zwei parallele Workflows haben diese Maschine schon auf Load 32 bei
  15 Kernen gefahren.

## Effizienz-Riegel (gemessen, nicht vermutet)

Die Vergangenheit dieses Repos zeigt: **die Agentenzahl sagt nichts ueber die Kosten, EIN
weglaufender Agent sagt alles.** Zwei Laeufe derselben Form (je 5 Agenten):

| Lauf | Gesamt | Turns | groesster Agent |
|---|---|---|---|
| `wf_73257d7c` (gesund) | 35,3 Mio | 308 | 19,1 Mio / 133 Turns |
| `wf_9fbd09a0` (weggelaufen) | **260,5 Mio** | 955 | **223,6 Mio / 687 Turns** = 86 % des Laufs |

Der Ausreisser wurde nachgelesen. Seine 347 Bash-Aufrufe, klassifiziert:

| Anteil | Was | Gesunder Vergleichslauf |
|---|---|---|
| **20 %** | reines **Warten/Pollen** (`sleep 60; echo waited`, `echo idle`, `ps aux \| grep <pid>`) | 5,5 % |
| 9 % | **31 volle Test-Laeufe** in EINEM Agenten | 10 |
| 49 % | Lesen/Suchen (legitime Groundung) | — |

Bei ~325k Durchschnittskontext kostet JEDER Warte-Turn den vollen Kontext erneut: 69 Warte-Turns
sind rund **22 Mio Token fuer nichts**. Die Kette dahinter ist immer dieselbe: langer Test-Lauf
-> Agent startet ihn im Hintergrund -> pollt -> Turns -> Kosten wachsen quadratisch mit der
Lebensdauer.

**Die Wurzel steht im Skript.** `phase-impl-lean.js` weist DREI Agenten an, die volle Suite zu
fahren: Zeile 171 (Implementierung), Zeile 239 (Safety-Review, ausdruecklich "selbst"),
Zeile 312 (Self-Fix). Das widerspricht `.claude/refs/workflow.md` Abschnitt 2a woertlich:
"Die volle Suite laeuft EINMAL, am Ende, vom Lead — nicht in jedem Agenten und nicht nochmal
SELBST von jedem Reviewer."

**Was du in deiner per-run Kopie aenderst:**

1. **Zeile 171 und 312** (Implementierung, Self-Fix): statt `npm test (beide Backends)` ->
   *"Fahre NUR die betroffenen Testdateien: `node --test test/<datei>.test.js`. Die volle
   Suite faehrt der Lead einmal am Ende — fahre sie NICHT."*
2. **Zeile 239** (Safety-Review): statt `npm test selbst` -> *"Fahre die vom
   Implementierungs-Agenten genannten Testdateien selbst nach. Die volle Suite ist Sache des
   Leads."* Die Unabhaengigkeit der Pruefung bleibt, sie wird nur nicht dreifach bezahlt.
3. **In JEDEN Agenten-Prompt**: *"Warte NIE aktiv auf einen Hintergrundlauf. Kein `sleep`,
   kein `echo idle`, kein `ps aux | grep <pid>`. Fahre lange Kommandos im VORDERGRUND mit
   grosszuegigem Timeout — ein blockierender Aufruf kostet EINEN Turn, eine Warteschleife
   kostet zwanzig."*
4. **Turn-Budget als Abbruch**, ebenfalls in den Implementierungs- und Fix-Prompt:
   *"Hast du nach 60 Werkzeug-Aufrufen keinen gruenen Zielzustand, brich ab und melde
   praezise, was fehlt."* Ein sauberes BLOCKED nach 60 Turns ist billiger und ehrlicher als
   ein 220-Mio-Lauf, der sich festbeisst.
5. **Kein echter Anbieter-Call in irgendeinem Agenten.** Diese Kette bewegt Geld. Kein Agent
   ruft Stripe, Telnyx oder ElevenLabs live an — alle Abnahmekriterien in `PLAN-GELDPFAD.md`
   sind ausnahmslos mit Fakes und injizierten Ports formuliert. Es gibt in dieser Kette keinen
   Smoke-Test gegen Stripe-Test, auch nicht fuer dich: der einzige Vorgang, der einen
   gebraucht haette, ist aus der Kette herausgeloest und liegt als vierter Owner-Blocker in
   `PLAN-GELDPFAD.md` Abschnitt 3.1.

**Waehrend der Lauf laeuft:** beobachte ihn ueber `/workflows`. Ueberschreitet EIN Agent rund
250 Turns, ist er weggelaufen — `TaskStop`, Ursache am Phasenschnitt suchen (meist: die Phase
war zu gross oder die Spec zu unscharf), neu ansetzen. Nach JEDEM Lauf die echten Kosten
messen: `node scripts/workflow-kosten.mjs <lauf-id>`. Die vom Workflow-Werkzeug gemeldete Zahl
`subagent_tokens` ist als Kostenanzeige unbrauchbar (laesst Cache-Reads weg, Faktor ~200 zu
niedrig).

**Richtwert je Phase dieser Kette:** unter 40 Mio Token und unter 150 Turns je Agent. Darueber
ist etwas falsch — nicht "gruendlich".

## Je Phase, in dieser Reihenfolge

1. **Keine Spec schreiben.** Der Workflow sucht sich den Phasenabschnitt selbst: er bekommt
   `specFile: "PLAN-GELDPFAD.md"` und `phaseId: "GP-P<N>"` und liest daraus den Abschnitt fuer
   genau diese Phase (`phase-impl-lean.js:113-115`). Eine eigene `tasks/gp-p<N>-spec.md`
   schreibst du NUR, wenn du beim Lesen des Phasenabschnitts eine Luecke siehst, die der
   Plan-Agent sonst raten muesste — dann ergaenzt sie ihn, ersetzt ihn aber nicht.
2. **Branch von `master`.** `git checkout -b gp/p<N> master` — erst den Branch, DANN lesen
   lassen; ein Worktree auf veraltetem Commit hat schon einmal eine Kette gekostet.
3. **Workflow starten**, Ergebnis abwarten, **Return-Felder nicht glauben.** Pruefe selbst:
   `git log --oneline`, `git diff --stat master..<finalBranch>`, und fahre `npm test` SELBST.
   Ein PASS des Workflows ist keine Merge-Freigabe. **Rot ist nicht automatisch Regression:**
   die Testbank hat ein bekanntes Parallelitaets-Rennen (voll parallel rot, mit
   `--test-concurrency=4` gruen). Sporadisch rote Faelle also erst so gegenpruefen und, wenn
   noetig, isoliert einzeln fahren, bevor du sie der gerade gebauten Phase anlastest.
4. **Abnahmekriterium der Phase** aus `PLAN-GELDPFAD.md` pruefen — deterministisch, mit den
   dort genannten Faellen. Nicht "sieht gut aus". Bei GP-P2 sind es vier getrennte Teile; ein
   gruener Provisionierungs-Test ohne die vier Bindepfad-Faelle ist KEINE Abnahme.
5. **Merge im Lead**, klein. `finalBranch` mergen, nicht blind `branch` (kann `-fixN` heissen).
   Uncommittete Owner-Arbeit: nur *tracked* stashen (`refs/stash` ist worktree-geteilt).
6. **Aufraeumen im selben Zug** (CLAUDE.md, Pflicht): `tasks/gp-p<N>-report.md`, eine etwaige
   `-spec.md`, das per-run-Skript aus `.claude/workflows/runs/`. Erst committen, dann loeschen
   — sonst ist es fuer genau die Dateien unumkehrbar, die nie in der Historie waren.
   `PLAN-GELDPFAD.md` bleibt, es ist das Manifest der ganzen Kette.
7. **Kettenstand fortschreiben** in `tasks/geldpfad-chain-state.md`: Phase, Merge-Commit,
   Abnahme erfuellt ja/nein, offene Befunde. Das ist die Datei, die eine Nachfolge-Session
   liest — halte sie kurz.

## Was du NICHT tust

- Keinen `git push`, kein Deploy, kein Aendern eines Live-Env-Werts. Render deployt aus dem
  UPSTREAM-Repo; ein Push hier waere kein Test, sondern ein Release.
- **Keine echte Zahlung, kein echter Nummernkauf, keine Erstattung.** Die 4,99 EUR aus dem
  Vorfall werden nicht erstattet — der betroffene Mandant ist ein internes Konto des
  Betreibers (`PLAN-GELDPFAD.md` Abschnitt 3.3, Fragen 1 und 2). Schlaegt ein Agent eine
  Erstattung oder eine Kundenmail vor: ablehnen und melden.
- **Die Befreiungsquelle wird NICHT angefasst** (`PLAN-GELDPFAD.md` Abschnitt 3.2). Der Owner
  hat am 11.09.2026 entschieden: die Einrichtungsgebuehr ist gewollt, und die Befreiung bleibt
  an der Rechnungssumme (`invoiceTotal===0`). Das ist eine Entscheidung FUER den Bestand, keine
  offene Frage — GP-P5 korrigiert nur den Kommentar darauf. Schlaegt ein Agent einen
  Signalwechsel vor, auch einen "sauberen" ueber ein Coupon-Feld: ablehnen und melden.
- **Keine Denylist gegen `link`.** GP-P2 ist eine Allowlist. Schlaegt ein Agent
  `if (type === 'link') reject` vor, ist das ein Blocker, kein Detail.
- **Kein `payment_method_types` im Code** — in keiner Phase, auch nicht als Einzeiler
  nebenbei. Der Vorgang ist bewusst aus der Kette genommen und liegt als vierter Owner-Blocker
  in `PLAN-GELDPFAD.md` Abschnitt 3.1, weil ein falscher oder im Dashboard nicht aktivierter
  Wert **beide** Checkout-Aufbauten zugleich lahmlegt (Pre-Mortem 4: Umsatz still auf null).
  Schlaegt ein Agent es vor: ablehnen und melden.
- Keine Phase ueberspringen, weil sie klein aussieht. GP-P0 ist die kleinste und die
  wichtigste: ohne sie ist jeder spaetere Eingriff wieder unsichtbar.

## Reihenfolge-Riegel

Die Reihenfolge ist nicht Geschmack; jeder Riegel traegt seinen Grund selbst (ausfuehrlich in
`PLAN-GELDPFAD.md` Abschnitt 1 und im Pre-Mortem, Abschnitt 2b):

- **GP-P0 muss gemergt sein, bevor GP-P2 startet.** Wer den Zahlungsweg aendert, bevor er ihn
  beobachten kann, aendert ihn blind — der Vorfall vom 11.09. wurde ausschliesslich durch
  manuelle DB-Forensik sichtbar.
- **GP-P1 vor GP-P2** (empfohlen, nicht erzwungen): sobald GP-P2 liegt, verschwindet der
  reproduzierbarste Ausloeser fuer GP-P1. Zuerst gebaut liefert es den Nachweis, dass sich die
  Ablehnungsklasse tatsaechlich geaendert hat.
- **GP-P1 vor GP-P4, ZWANG**, und GP-P1 muss dafuer ein **getyptes Feld** liefern. Ein
  Substring in `.message` erfuellt die Vorbedingung nicht. Ein blinder Sweep ohne diese
  Unterscheidung verbrennt Versuche gegen eine Zahlungsmethode, die per Konstruktion nie
  besteht — und erzeugt dabei neue Nummern-Datensaetze.
- **GP-P2 vor GP-P3, ZWANG.** Ein Wiederanlauf fuer einen Mandanten, dessen Zahlungsmethode
  strukturell keinen Hold traegt, ist eine Schleife, die nichts kauft.
- **GP-P3 vor GP-P4, ZWANG.** Ohne den persistierten Versuchszaehler ist der zeitgesteuerte
  Sweep ein Umgehungsweg um `MAX_NUMBERS_PER_TENANT`.
- **GP-P2 und GP-P5 nicht in derselben Welle.** Beide greifen in die Hold-/Settle-Kette; landen
  sie zusammen, ist eine Geld-Regression nicht mehr zuzuordnen.
- `src/billing/stripe.js` wird **sequenziell** angefasst (GP-P1, dann GP-P2) — verschiedene
  Funktionen, aber ein echtes Merge-Risiko bei Parallelbetrieb.

## Owner-Blocker, die du nur meldest

Zwei harte Blocker, die du nicht bauen kannst (`PLAN-GELDPFAD.md` Abschnitt 3.1):

1. **`+4921194289148`** steht seit dem 01.09.2026 auf `requirement-info-pending`, Telnyx
   erwartet Nachweisdokumente. Kein Code-Pfad loest das auf.
2. **Link als Zahlungsart im Stripe-Dashboard deaktivieren.** Der Owner hat am 11.09.2026
   entschieden: nur Karte. Solange Link waehlbar bleibt, entsteht weiter der Fall, den GP-P2
   fail-closed abfaengt. Reiner Dashboard-Schritt, kein Code — und ausdruecklich **nicht** per
   `payment_method_types` im Code zu ersetzen (siehe Verbotsliste oben).

**Erledigt, nicht mehr blockierend:**

- Das **Telnyx-Guthaben** ist am 11.09.2026 aufgeladen: gemessen 6,79 USD gegen zuvor 1,79
  (`GET /v2/balance`). Das deckt die Monatsmiete der drei aktiven Rufnummern (je 1 USD) und ein
  bis zwei neue Nummern. Es ist **knapp, nicht reichlich** — bevor du eine Phase fuehrst, die
  einen echten Kauf ausloest, miss es erneut.
- **Der Kunde des Vorfalls** ist ein internes Konto des Betreibers, kein fremder Kunde. Keine
  Erstattung, kein Backfill, keine Kundenkommunikation.

**Alle dreizehn Owner-Fragen sind beantwortet** (`PLAN-GELDPFAD.md` Abschnitt 3.3, mit Antwort
und Wirkung je Frage, Stand 11.09.2026). Du musst vor dem Start keine davon klaeren. Weicht eine
Phase von einer dieser Antworten ab, ist sie falsch gebaut — die Tabelle ist bindend, nicht
informativ.

Eine Restunsicherheit bleibt bewusst stehen und gehoert in den Kettenstand, nicht in eine
Rueckfrage: das Stripe-Lese-Scope fuer `GET /v1/prices/{id}` ist im Testmodus belegt, im
Live-Modus nur wahrscheinlich (Standardschluessel `sk_live_`, kein eingeschraenkter). Scheitert
der erste Live-Aufruf in GP-P6 mit 403, ist das Scope die Ursache und kein Codefehler.

## Am Ende

Kettenstand fortschreiben, `PLAN-SECURITY.md` um die Entscheidungen ergaenzen, die die Kette
gefaellt hat (Allowlist der hold-faehigen Zahlungsmethodentypen, Null-Politik fuer
Bestands-Mandanten, Whitelist der Ablehnungs-Enums, Versuchsdeckel und terminaler Zustand,
Eskalationskanal des Preis-Waechters — je ein kurzer, datierter Owner-Entscheidungs-Block), und
dem Owner den Stand **nach Wirkung** melden, nicht nach Reihenfolge des Bauens: was kann ein
zahlender Kunde jetzt, was er am 11.09. nicht konnte.
