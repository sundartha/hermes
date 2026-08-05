# Strategie: Gespraechsqualitaet, Stand 2026-08-06

**Regel wie im Kickoff: nur Gemessenes.** Jede Aussage traegt einen Beleg (Call-ID, SQL,
Log-Zeile, Datei:Zeile) oder ist als **unbelegt** markiert.

---

## Teil 0 — erledigt

| Schritt | Ergebnis |
|---|---|
| `master` auf `upstream/master` zurueckgeholt | war kuenstlich auf `2429d38` |
| Review-Fixes `3a7b8f6` regulaer gemergt | `b4d51d4` |
| Reports P1-P4/S1 in die Historie, dann Prozessmuell geloescht | `bc3823d`, `72dabd3` |
| `npm test` | **3970/3970 gruen, Exit 0** |
| Push auf `upstream` und `origin` | `8fb7804..72dabd3` |
| Deploy | `dep-d9piv3rm8hqs73flju50`, Status `live` |
| Live-Gegenprobe | `/healthz` -> `commit: 72dabd3...` |
| PR #1 | geschlossen |
| Hilfs-Branches | lokal geloescht; `review/gq-2026-08-05` auf `origin` geloescht |

**Rest, nicht erledigt:** drei Remote-Refs stehen noch — `base/pre-gq-2026-08-05` auf
`origin` und `upstream`, `review/gq-2026-08-05` auf `upstream`. Der Klassifizierer hat die
Loeschung dreimal blockiert. Alle drei Commits sind von `master` aus erreichbar
(`git merge-base --is-ancestor` gegen `2429d38`/`5e45d05`/`3a7b8f6`/`7670ff1`: alle IN
master), es geht also nichts verloren. Owner loescht sie oder gibt `git push --delete` frei.

---

## Teil 1 — was diese Session neu gemessen hat

Fuenf Messungen, alle aus der Prod-DB bzw. dem Live-Log. Drei davon korrigieren den Kickoff.

### M-1 — Rohtranskripte existieren. Der Kickoff sagt, sie fehlen.

```sql
select (summary is not null) as hat_summary, (seg>0) as hat_segmente, count(*)
from (select c.id, c.summary, count(t.*) as seg
      from call c left join transcript_segment t on t.call_id=c.id group by 1,2) x
group by 1,2;
```

| hat_summary | hat_segmente | Anzahl |
|---|---|---:|
| f | f | 16 |
| f | **t** | **15** |
| t | f | 27 |
| t | t | **0** |

**222 Segmente liegen in der Prod-DB.** Die Korrelation ist perfekt und ohne Ausnahme:
**kein einziger Call hat Summary UND Segmente.** Das ist genau der Mechanismus aus
`keepsTranscriptForDiagnosis` (`src/diagnostic-retention.js:36`) im Abschluss-Pfad — der
Purge haengt an der Summary, nicht an einem Defekt.

Daraus folgt die Umkehrung, die den eigentlichen Schaden erklaert:

> **Ein Anruf, der sauber durchlaeuft, verliert sein Transkript. Ein Anruf, der vorher
> abbricht, behaelt es.** Die Diagnose bekommt also systematisch genau die Faelle NICHT zu
> sehen, in denen der Agent bis zum Ende geredet hat.

### M-2 — `diagnostic` ist nicht kaputt, sondern dreifach zugesperrt

```
select diagnostic, count(*) from call group by 1;   ->   f | 58     (t: keine Zeile)
```

**58 Calls, kein einziger mit `diagnostic=true`.** `diagnosticRetentionGranted`
(`src/diagnostic-retention.js:27`) verlangt drei Dinge gleichzeitig:

1. `requested === true` — **das Modell** muss `diagnostic: true` an `place_call` haengen.
   Die Werkzeug-Beschreibung sagt woertlich: *"Set this ONLY when the user explicitly wants
   to make a test call to their OWN number... **Never set it unasked.**"*
   (`src/mcp-tools.js:636-641`).
2. `DIAGNOSTIC_RETENTION_DAYS > 0` — in `render.yaml:468` steht **`"0"`** mit dem Kommentar
   *"in Produktion vorerst AUS. Erst auf 7 stellen, wenn die Datenschutzerklaerung den
   Diagnosemodus + die Frist nennt."* **Der Live-Wert ist unbelegt** (s. M-3).
3. `to === tenantPrivateNumber` — diese Bedingung war am 05.08. erfuellt (Kickoff D-1).

Der Vorgaenger hat nur Bedingung 3 geprueft und daraus "Ursache unbekannt" gemacht. Die
beiden vorgelagerten Bedingungen sind nie angesehen worden.

**Die Fehlerklasse von Bedingung 1 ist B-4.** Das Diagnose-Flag haengt daran, dass das
Modell eine angebotene Faehigkeit von sich aus waehlt — genau das, was laut drei Messungen
(`look_up` 0/19, `get_consult` 0/4, Kickoff Teil 3) nicht zuverlaessig passiert. Ein
Diagnose-Werkzeug, das am selben Defekt haengt wie das zu diagnostizierende Verhalten,
kann nicht funktionieren.

### M-3 — es gibt keine Boot-Sonde fuer `DIAGNOSTIC_RETENTION_DAYS`

`capabilityProbeLines` (`src/boot.js:526`) druckt fuenf Sonden: Vorab-Briefing,
Vorab-Recherche, In-Call-Nachschlag, Consult-Kanal, Ergebnis-Zitate. **Diagnose-Retention
fehlt.** Die einzige andere Log-Zeile, die den Wert nennt (`boot.js:68`), druckt nur, wenn
der Sweep tatsaechlich etwas geloescht hat — Abwesenheit beweist dort nichts.

Gegenprobe am Nachbarwert, aus dem Live-Log vom 2026-08-05 10:36:22Z:

```
Ergebnis-Zitate: AKTIV (EVIDENCE_RETENTION_DAYS=7) - Zitate werden erhoben und nach 7 Tagen geloescht
```

`render.yaml` fuehrt fuer denselben Schluessel **`"0"`**. **Live und `render.yaml`
widersprechen sich nachweislich** — die Dashboard-Werte gewinnen. Fuer
`DIAGNOSTIC_RETENTION_DAYS` laesst sich daraus nichts ableiten: der Wert ist aus dem Log
schlicht nicht lesbar. Das ist die Luecke, die AL-P16 fuer die anderen Schalter geschlossen
hat.

### M-4 — die Persona-Wurzel im Kickoff ist widerlegt

Kickoff Teil 1: *"Herkunft des Defekts, am Code belegt: der Satzbaustein
`boundaries.noAskingCounterpartAboutOwner` (GQ-P9, gebaut am 2026-08-05) enthaelt woertlich
'Du klaerst das auf deiner Seite'. Der Agent hat das uebernommen."*

Gesucht ueber alle 222 Segmente, `role='agent'`:

| Call | Zeit (UTC) | Satz |
|---|---|---|
| `call_msabz9975sph` | **2026-08-01** 12:13:02 | "Ich frage Antonio, ob zehn Uhr am Samstagvormittag passt, und melde mich dann bei Ihnen zurueck." |
| `call_msfx9pruzjvc` | 2026-08-05 10:07:15 | "Ich frage kurz bei Antonio nach und gebe dir dann Bescheid." |
| `call_msfx9pruzjvc` | 2026-08-05 10:07:27 | "Ich hole mir die Fahrzeugangabe von Antonio und rufe dich dann gleich wieder an..." |

GQ-P9 ist Commit `c6bc809`, **2026-08-05 10:26 UTC**, deployt **10:35 UTC**. Alle drei
Belege liegen **davor** — einer vier Tage davor.

> **Das Verhalten ist aelter als die Prompt-Zeile, die es angeblich verursacht.** Die Zeile
> zu korrigieren ist richtig (ihre Formulierung ist schlecht und sie bietet `take_message`
> woertlich als Ausweg an), aber sie zu korrigieren wird das Verhalten **nicht** abstellen.
> Wer die Phase auf "Zeile fixen" zuschneidet, baut eine Phase, die messbar nichts aendert.

### M-5 — GQ-P8 hat jetzt einen Vorher-Beleg, GQ-P7 einen Nachweis

Rohtranskript `call_msfx9pruzjvc`, das der Kickoff als *"das Rohtranskript fehlt"* fuehrt —
es liegt vor, 10 Segmente. Der entscheidende Ausschnitt:

```
10:07:13.438  caller  Was soll ich das wissen?
10:07:15.502  agent   Sie haben recht, das ist nicht deine Aufgabe. Ich frage kurz bei
                      Antonio nach und gebe dir dann Bescheid.
10:07:25.367  caller  Was soll ich das wissen?
10:07:27.259  agent   Du hast voellig recht - das geht dich nichts an. Ich hole mir die
                      Fahrzeugangabe von Antonio und rufe dich dann gleich wieder an, um
                      den Termin zu vereinbaren.
```

Dazu die Zeitachse aus dem Kickoff (mechanisch belegt): Consult-**Antwort 10:07:21
eingetroffen**, Zustellfenster 10:07:25 geoeffnet, `deliveredAt` 10:07:27.

**Damit ist beides belegt:**

- **GQ-P7 wirkt.** Genau ein Fenster, genau ein Satz darin, danach wieder blockiert.
- **GQ-P8 ist noetig und sein Vorher-Zustand ist jetzt woertlich dokumentiert.** Der Agent
  hatte die Antwort seit 6 Sekunden im Prompt und kuendigte im Fenster einen **Rueckruf**
  an. GQ-P8 war zu diesem Zeitpunkt nicht live (Commit 10:19 UTC, Deploy 10:35 UTC).

**Die Zahl fuer die GQ-P8-Messung steht damit fest:** im Zustellfenster verwendet der Agent
die eingetroffene Antwort, statt einen Rueckruf anzukuendigen.

### M-6 — N-2 ist am Code belegt: GQ-P10 haengt am falschen Pfad

`src/claude.js:1277`:

```js
for (const item of parsed.actionItems || []) store.addActionItem(call.id, item, "todo");
```

Das steht in der **Zusammenfassung** nach dem Gespraech, nicht im `take_message`-Werkzeug
(`claude.js:560`). Die zwei zusaetzlichen Eintraege aus dem Kickoff-Befund N-2 entstehen
also nach dem Anruf. GQ-P10s Prompt-Block deckt nur `take_message` im Gespraech ab —
**der Verdacht des Kickoffs ist bestaetigt: falscher Pfad.**

### M-7 — Nebenbefund, gemessen und dadurch entschaerft

Im Transkript oben mischt der Agent Du und Sie **im selben Satz**. Nachgemessen ueber alle
12 Transkripte mit Agenten-Saetzen:

| | Du-Saetze | Sie-Saetze |
|---|---:|---:|
| `call_msfx9pruzjvc` | **3** | 3 |
| die uebrigen 11 Anrufe | **0** | 74 |

Die Gegenstelle hatte in diesem einen Anruf geduzt; der Agent spiegelt das Register. **1 von
12 — kein systemischer Befund.** Als Karte notiert, nicht als Phase. (Hier gemessen statt
behauptet, weil der Satz beim Lesen wie ein Marken-Defekt aussah.)

---

## Teil 2 — was das an der Reihenfolge des Kickoffs aendert

Der Kickoff ordnet: D-1 -> Persona -> D-2 -> O-4 -> Fragilitaet. Die Begruendung fuer
"D-1 zuerst" traegt weiter, ihr **Inhalt** aber nicht: `diagnostic` ist nicht der Hebel.

### Der eigentliche Diagnose-Defekt

Nicht *"`diagnostic` greift nicht"*, sondern:

> Die Aufbewahrung des Rohtranskripts haengt an einem Flag, das (a) das Modell selbst setzen
> muss, (b) an einem Env-Wert haengt, dessen Live-Zustand niemand lesen kann, und (c) nur
> fuer Anrufe an die eigene Nummer gilt. Fuer jeden erfolgreich beendeten Anruf ist das
> Transkript weg.

Und die harte Konsequenz fuer diese Session:

> **Fuer keinen einzigen Anruf nach dem P8/P9/P10-Deploy (2026-08-05 10:35 UTC) existiert
> ein Transkript.** Der juengste Anruf mit Segmenten ist `call_msfx9pruzjvc`, 10:06 UTC —
> davor. Die drei Phasen sind nicht nur ungemessen, sie sind **nachtraeglich nicht
> messbar.** Jede Messung braucht neue Anrufe, und vor dem naechsten Anruf muss die
> Aufbewahrung stehen.

### Vorgeschlagene Reihenfolge

| # | Phase | Warum hier | Zahl, an der sie gemessen wird |
|---|---|---|---|
| 1 | **Diagnose-Aufbewahrung** | ohne sie ist der naechste Testanruf wieder verloren | nach dem Anruf: `transcript_segment` > 0 **und** `summary is not null` fuer denselben Call — heute 0 von 58 |
| 2 | **Persona / Wortwahl (Owner-Auftrag)** | bindend; Beleg liegt vor; unabhaengig von 1 baubar | in neuen Transkripten 0 Treffer auf das Muster aus M-4 (heute 3 in 2 Anrufen) |
| 3 | **N-2 / GQ-P10 auf den richtigen Pfad** | am Code belegt, klein, kein Testanruf noetig | ein Sachverhalt erzeugt einen Eintrag, nicht drei |
| 4 | **D-2 `await_call_event`** | kann die Rueckfrage mitten im Gespraech abschalten | `event:"done"` nie vor `ended_at` |
| 5 | **O-4 Modellwechsel A/B** | braucht 1, sonst nicht auswertbar | `offeredToolNames` vs. `toolNames` ueber n Anrufe |
| 6 | **Fragilitaets-Analyse** | der nie begonnene Auftrag; deckt die Klasse hinter 1-4 ab | Liste: vorhandener Zustand ohne Kante zum Entscheidungspunkt |

**Phase 6 ist die einzige, die keine Owner-Antwort braucht und keinen Anruf kostet** — und
sie ist die, deren Fehlerklasse in dieser Session schon dreimal aufgetreten ist:

- der Consult-Zustand `answered` erreichte den Prompt nicht (GQ-P8),
- der notierte Stand erreichte den Entscheidungspunkt nicht (GQ-P10, und zwar am falschen Pfad),
- der Live-Wert von `DIAGNOSTIC_RETENTION_DAYS` erreicht keinen Leser (M-3),
- und `diagnostic` selbst ist ein Zustand, den nur das Modell setzen kann (M-2).

---

## Teil 3 — Owner-Fragen, die die Phasen aendern

### O-A — Die Teil-1-Vorgabe deckt einen gemessenen Fall nicht ab

Vorgeschrieben sind zwei Saetze: *"Warten Sie kurz, ich schaue einmal nach."* (er klaert es
JETZT) und *"Tut mir leid, ich kann die Information momentan nicht finden."* (er findet es
nicht).

`call_msabz9975sph` zeigt einen dritten, legitimen Fall: *"Ich frage Antonio, ob zehn Uhr am
Samstagvormittag passt, und melde mich dann bei Ihnen zurueck."* — er kann es **jetzt nicht**
klaeren, aber spaeter. Nach der Vorgabe waere dieser Satz verboten; ein Ersatz ist nicht
vorgesehen. Was soll Hermes hier sagen?

### O-B — Diagnose-Aufbewahrung hat eine rechtliche Vorbedingung

`render.yaml:468` haelt fest: `DIAGNOSTIC_RETENTION_DAYS` erst auf >0, wenn die
Datenschutzerklaerung den Diagnosemodus und die Frist nennt. Dieselbe Bedingung stand bei
`EVIDENCE_RETENTION_DAYS` — der steht live auf 7. **Unbelegt, ob die Datenschutzerklaerung
das heute hergibt.** Ohne Owner-Entscheidung wird Phase 1 nicht scharf.

### O-C — O-4 braucht Testanrufe, der Owner hat sie gestoppt

Kickoff Teil 2: *"Owner hat Testanrufe vorerst gestoppt ('keine Testcalls mehr, bau')."*
O-4 ist ein A/B-Lauf am Telefon. Die Phasen 1-4 und 6 sind ohne Anruf baubar, ihre **Wirkung**
aber ohne Anruf nicht belegbar — genau der Fehler, den der Vorgaenger am 05.08. viermal
gemacht hat.

---

## Teil 4 — was diese Strategie ausdruecklich NICHT tut

- **Keine Prompt-Runde gegen B-4.** O-4 ist bindend: dagegen hilft der Modellwechsel mit
  Messung, nicht die vierte Formulierung.
- **Kein Merge ohne dualen Review.** Jede Phase laeuft ueber `phase-impl-lean`.
- **Keine Phase ohne vorher benannte Zahl.** Steht oben je Zeile.
- **Kein behaupteter Gewinn ohne Messung.** M-7 ist das Muster: gemessen, entschaerft,
  nicht als Fortschritt verkauft.

---

## Teil 5 — Owner-Entscheidungen vom 2026-08-06

| ID | Frage | Entscheidung |
|---|---|---|
| **O-A** | dritter Persona-Fall (spaeter statt jetzt) | **"Das klaere ich und melde mich bei Ihnen zurueck."** — kein Dritter wird genannt, kein "meine Seite", der Rueckruf bleibt moeglich |
| **O-B** | Umfang der Diagnose-Phase | **beides**: Owner setzt `DIAGNOSTIC_RETENTION_DAYS` im Dashboard und zieht die Datenschutzerklaerung nach; der Code hoert auf, das Modell-Opt-in zu verlangen |
| **O-C** | Testanrufe | **frei, aber erst nach Phase 1** — danach traegt jeder Anruf ein Rohtranskript, ein Anruf belegt mehrere Phasen |

## Teil 6 — Ergebnis der Fragilitaets-Analyse (Workflow, 11 Agenten)

Bericht: `tasks/gq-fragilitaet-2026-08-06.md`. **7 bestaetigt, 1 widerlegt.**

Die Fehlerklasse zerfaellt in zwei Formen, und das aendert den Zuschnitt:

- **Projektion enger als der Zustand** (F1 `endCallWait` direction-blind, F2 Consult-ANSWERED
  ohne Fakten, F4 `failureReason` erreicht die Ausfall-Nachricht nicht) -> je ein Feldzugriff
  bzw. eine Bedingung. Echte Fixes.
- **Wert ohne jeden Leser** (F3 `gapMs`, F5 `CallDuration`, F6 `DASHBOARD_PASSWORD`,
  F7 `WORLD_DEFAULT_LANGUAGE_ENABLED`) -> Loeschung, Sonde oder Messung. **Nie ein Fix** —
  ohne Leser gibt es keine Entscheidung, die man richtig machen koennte.

**Zwei Befunde erklaeren offene Kickoff-Punkte, statt neue aufzumachen:**

- **F4** ist die Code-Erklaerung fuer *"fuenf stille Fehlanrufe ueber drei Wochen sind
  niemandem aufgefallen"*: `failureReason` war jedes Mal gespeichert
  (`state-ops.js:608-618`), die passive Nachricht baut aber ausschliesslich auf
  `call.status` (`call-finish.js:59-66`). no-answer, besetzt, Fehler, Dauer-Cap und
  Budget-Abbruch sind darin nicht unterscheidbar.
- **F7** ist derselbe Blindfleck wie M-3, nur an einer Absoluten Regel: die Sprache, in der
  die **Offenlegung** gesprochen wird, haengt an einem Wert ohne jede Spur im Boot-Log.

**F5 ist die einzige Zeile, die ein geschuetztes Gate beruehrt** und deshalb ausdruecklich
keine Fix-Phase: `CallDuration` wird geparst und hat im gesamten `src/`-Baum **null Leser**;
abgerechnet wird `Math.ceil((endedAt - answeredAt)/60000)` aus der **Serveruhr**. Belegt ist
der fehlende Leser — **unbelegt**, dass die abgerechnete Zahl falsch ist. Erst messen.

## Teil 7 — Phasenplan nach den Entscheidungen

| # | Phase | Inhalt | Anruf noetig |
|---|---|---|---|
| **GQ-P11** | Diagnose-Aufbewahrung | Modell-Opt-in faellt weg; Boot-Sonde fuer `DIAGNOSTIC_RETENTION_DAYS` | nein |
| GQ-P12 | Persona/Wortwahl | Teil 1 + O-A, de/en/fr; gebaut gegen das **Verhalten**, nicht gegen die eine Zeile (M-4) | Beleg ja |
| GQ-P13 | F2 Consult-ANSWERED ohne Fakten | `answeredFacts > 0` in `consultAnswerAwaitingDelivery` | nein |
| GQ-P14 | N-2 / GQ-P10 auf den richtigen Pfad | `claude.js:1277`, Zusammenfassung statt `take_message` | nein |
| GQ-P15 | F4 Ausfall-Grund in die Nachricht | `call-finish.js:59-66` | nein |
| GQ-P16 | F1 `endCallWait` direction-neutral (de/fr) | zwei i18n-Strings + ein Test | nein |
| GQ-M1 | F5 Messphase Provider-Dauer vs. abgerechnete Dauer | nur messen, kein Fix | nein |
| GQ-P17 | D-2 `await_call_event` meldet `done` zu frueh | | Beleg ja |
| GQ-P18 | O-4 Modellwechsel A/B | erst nach P11 auswertbar | ja |

**GQ-P11 zuerst, ohne Alternative:** solange sie nicht steht, verliert jeder erfolgreich
beendete Testanruf sein Transkript (M-1) — und O-C haengt ausdruecklich daran.
