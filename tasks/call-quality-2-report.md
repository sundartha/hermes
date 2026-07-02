# Anrufqualitaet Runde 2: Report (2026-07-02, Branch call-quality-2)

Auftrag: NEXT-SESSION-CALL-QUALITY-2.md (Owner-Symptome nach Deploy c12c546).

## Diagnose (Render-Logs + Hermes-MCP, verifiziert statt geglaubt)

### Falle 0 bestaetigt: Der Owner hat den neuen Stand nie vollstaendig gehoert

| Ereignis | Zeit (UTC) | Beleg |
|---|---|---|
| Testanruf 1 `call_mr3dz9t9u5jm` (completed, 50s, 2 Turns) | 10:53:32-10:54:27 | audit place_call + [voice/status] |
| Aktiver Code dabei: **0dca7ce (ALTER Stand)** | Boot 09:34:59 | [boot]-Banner Instanz 45cqh |
| c12c546 (call-quality) erstmals live | 14:01:42 | Deploy dep-d936tvsm..., [boot]-Banner |
| Manueller Deploy dep-d9377ui gestartet | 14:21:46 | list_deploys |
| Testanruf 2 `call_mr3lg2g7t9zg` (place_call auf alter Instanz 7gm5x) | 14:22:33 | audit place_call |
| Traffic-Switch auf neue Instanz hzkck | 14:22:46 | "Your service is live" |

- Testanruf 1 (der einzige mit vollem Gespraech) lief komplett gegen den ALTEN
  Code -> S-C ("kaum Unterschied") ist damit erwartbar, keine Aussage ueber v6.
- Testanruf 2 lief auf c12c546, starb aber nach der Eroeffnung (s.u.).

### S-A ("Agent hat mitten im Gespraech aufgelegt"): Deploy-Kollision, KEIN LLM-/Prompt-Problem

Log-Forensik Testanruf 2: NUR die place_call-Zeile existiert - kein [metrics] turn,
kein [voice/status], und der Call fehlt komplett in list_calls. Ablauf:

1. place_call 14:22:33 auf Instanz 7gm5x; Answer-Webhook + LLM-freie Eroeffnung
   liefen noch dort (Owner hoerte die Eroeffnung).
2. 14:22:46 Traffic-Switch: der erste Gather-Callback (/voice/turn) traf die NEUE
   Instanz hzkck. Deren Store (in-memory-Fassade, Boot-Hydrate 14:22:30) kannte
   den 3 Sekunden aelteren Call nicht -> server.js /voice/turn antwortet bei
   unbekanntem Call fail-closed mit nacktem `<Hangup/>` - bis dato OHNE Logzeile.
3. Der naechste Reconcile-Flush der neuen Instanz loeschte den Call-Row aus pg
   (deleteMissing) -> der Call verschwand aus der Historie (list_calls, Widget-
   Polls ab 14:22:51 liefen ins Leere).

Gegenprobe LLM-Hypothese (Auftrags-Kandidat LlmUnavailableError): widerlegt -
alle [metrics] llm im Fenster: outcome=success, attempts=1, latencyMs 1358-1529,
breakerState=closed; kein [turn]-Error, kein end_call-Toolcall (tools=[]).

Testanruf 1 endete mit hangupCause=normal_clearing, hangupSource=callee
(die GEGENSEITE legte auf) - auch dort kein Agent-Hangup. Nebenbefund: ein
stt_gap von 16172ms (Endpointing/Sprechpause, bekanntes Deferral FT2).

### S-B ("Eroeffnung total bescheuert"): deterministischer Code, zwei Hebel

`openingText` = disclosure + `bridgePhrase(goal)`; live sprach der Agent
"Ich rufe an wegen folgendem Anliegen: Den naechsten freien Termin erfragen." -
Amtsdeutsch-Bruecke plus Infinitiv-Stummel, den die alte objective-Description
sogar als Beispiel vorgab.

## Umsetzung (Commits auf call-quality-2)

1. **S-B(a) bridgePhrase (de/fr/en)**: "Es geht um Folgendes: <goal>." statt
   "Ich rufe an wegen folgendem Anliegen: ..." (fr: "Voici l'objet de mon
   appel :", en: "Here's what I'm calling about:"). NEU: Ich-Satz-Passthrough -
   beginnt das Anliegen bereits in der ersten Person (de /^ich\b/i, fr je/j',
   en I/I'), wird es OHNE Bruecke woertlich gesprochen. disclosureSentence
   byte-identisch davor (Regel 2), /voice/outbound bleibt LLM-frei.
2. **S-B(b) place_call objective-Description**: verlangt einen sprechbaren
   Ich-Satz ("Ich moechte fuer Max einen Herrenhaarschnitt am Samstagvormittag
   vereinbaren."), verbietet Infinitiv-Stummel; Thema-Pflicht + Rueckfrage-Regel
   bleiben. ACHTUNG: claude.ai cacht Tool-Descriptions pro Chat - wirkt erst in
   einem FRISCHEN Chat.
3. **S-A Diagnose-Logging**: /voice/turn + /voice/outbound loggen den unknown-
   call-Hangup jetzt PII-frei (callId ist server-generiert), Verhalten am Draht
   unveraendert. Damit ist der Deploy-Kollisions-Fall kuenftig in den Render-
   Logs sichtbar (CLAUDE.md Regel 7). /voice/status bleibt bewusst still
   (Rauschen, Bestandsentscheidung).
4. **S-C Natuerlichkeits-Feinschliff: versucht und ABLADIERT.** Judge-
   Rationales der Runde-1-Laeufe gemint (Hauptmuster "formelhaft/mechanisch"),
   drei Prompt-Iterationen durch die Bench gefahren (Historie unten) - keine
   verdiente ihren Platz. Der gemergte System-Prompt ist byte-identisch zu v6;
   S-C wird real durch die neue Eroeffnung (1) und bessere goals (2) getragen.

## Bench-Beleg (A/B gepoolt, Judge claude-sonnet-5 + deterministische Checks)

Baseline = v6-Pool aus Runde 1 (candidate-final-sweep + candidate-v6-fv, 20
Laeufe, git_rev 2930127 = identischer Voice-Pfad wie c12c546/2c6c4e2 - per
git diff verifiziert, nur Auth/Widget-Diffs dazwischen).

### Iterations-Historie S-C (der Loop hat wieder eine Regression VOR dem Merge gefangen)

| It. | Aenderung | Bench-Befund |
|---|---|---|
| v1 | "variiere die Formulierung" + speechClause "Alltagssprache" | REGRESSION: Duz-Drift 2/3 termin-duenn ("danke dir", "Passt dir"), Thema-Frage reaktiviert. Positive Stil-AUFFORDERUNGEN erzeugen Register-Entropie - Spiegelbild der Runde-1-Lehre zu breiten Verboten. |
| v2 | Anrede-Bindung in der Klausel, speechClause zurueck | besser (1/5 Duzen, Leak in der Verabschiedung), friseur 4.80 |
| v3 | nur enges Verbot "nie zwei Antworten hintereinander mit derselben Floskel" | targeted sauber (0/8), aber gepoolt (38 Laeufe): "formelhaft"-Beschwerden UNVERAENDERT (39% vs 40%), naturalness flach -> Regel verdient ihren Platz nicht |
| final | v3-Regel ABLADIERT: System-Prompt byte-identisch zu v6 | Scheibe traegt nur S-A/S-B/objective-Description |

### Finaler A/B (gepoolt, Baseline n=20 vs Candidate n=30)

| Szenario | Baseline | Final | Delta |
|---|---|---|---|
| friseur-voll (n=8/6) | 4.58 | 4.70 | +0.12 |
| inbound-nachricht (n=3/6) | 4.33 | 4.07 | -0.26 (SE 0.31; Inbound nutzt openingText NICHT - Code identisch, reines Judge-Rauschen) |
| partner-knapp (n=3/6) | 4.27 | 4.73 | +0.46 |
| stt-noise (n=3/6) | 4.80 | 4.43 | -0.37 (SE 0.20; Baseline-SE 0.00 bei n=3 war Glueckslos) |
| termin-duenn (n=3/6) | 3.60 | 4.00 | +0.40 |
| **GESAMT** | **4.38 (SE 0.13)** | **4.39 (SE 0.10)** | **+0.01** |
| naturalness | 3.70 (SE 0.11) | 3.83 (SE 0.10) | +0.13 |
| determ. Checks | 83/85 | **120/120** | besser |

Ehrlicher Restbefund: in termin-duenn zeigen 2/6 Laeufe Duzen und 1/6 die
Titel-Interview-Frage - unter BYTE-IDENTISCHEM v6-Prompt. Das ist ein
vorbestehender v6-Rest des pathologischen Duenn-Szenarios (Baseline-n=3 war zu
klein, ihn zu sehen; Runde 1 selbst mass 5% Themen-Verhoer im Final), KEINE
Regression dieser Scheibe. Der Quell-Fix ist genau die neue objective-
Description (konkreter Ich-Satz statt duennem Auftrag) + I12-Kontextkanal.

MERGE-ENTSCHEIDUNG: JA - Eroeffnung deterministisch besser (Owner-Symptom S-B
direkt), Judge-Paritaet, Checks perfekt, naturalness nominal +0.13; Prompt
gegenueber dem bewaehrten v6 unangetastet.

### Grenze der Prompt-Schraube (S-C)

Drei Iterationen zeigen: jede zusaetzliche Stil-Anweisung an Haiku kostet
Register-Stabilitaet, ohne die "formelhaft"-Wahrnehmung messbar zu senken. Die
verbleibenden S-C-Hebel liegen NICHT im Prompt: (a) die jetzt natuerliche
Eroeffnung (hoert der Owner sofort), (b) bessere goals via objective-Description,
(c) Katja-Prosodie/SSML (Owner-Live-Gate, O4/O6 aus Runde 1).

## Entscheidungen / bewusst NICHT gemacht

- Kein "langsame-API"-Bench-Szenario: der Auftrags-Verdacht LlmUnavailable ist
  per Logs widerlegt; das Szenario haette keinen aktuellen Befund reproduziert.
- Eroeffnungs-Wortlaut-Check: als Unit-Tests (O1-O9, byte-genau) statt Bench-
  Szenario - die Eroeffnung ist deterministischer Code, ein LLM-Judge misst
  dort nur Rauschen.
- Szenarien unveraendert gelassen (Vergleichbarkeit mit Baseline-Pool);
  Ich-Satz-Goal-Variante als moegliche Ergaenzung notiert, sobald die neue
  objective-Description live Wirkung zeigt.
- FT1 (S1, strukturell, Folge-Ticket): Call-State ueberlebt Instanzwechsel
  nicht - Zero-Downtime-Deploy toetet laufende Calls (stiller Tod + pg-Row-
  Verlust durch Reconcile-deleteMissing). Fix = eigener Store-Schnitt
  (read-through-Rehydrate im Webhook-Pfad + Reconcile-Schutz fuer aktive
  Calls + Draining), eigener Review. Bei Millionen-Skala PFLICHT vor echtem
  Traffic; heute trifft es jeden Deploy waehrend eines laufenden Calls.

## OWNER-Aktionen

1. NEU TESTEN, diesmal sauber: keinen Deploy waehrend des Anrufs laufen lassen
   (Render-Dashboard "Deploy in progress" abwarten) und fuer die neue
   objective-Description einen FRISCHEN Claude-Chat verwenden (Description-
   Cache pro Chat).
2. Render plan:free -> always-on weiter offen (Cold-Start; unabhaengig davon
   toetet auch ein Deploy auf paid-Plan laufende Calls -> FT1).
3. Telnyx TeXML "hang-up on timeout" im Portal pruefen (weiter offen).
4. Push origin+upstream nach Owner-Ok (Merge ist lokal).

## Lehren (Runde 2; gehoeren nach tasks/lessons.md, sobald die Datei frei ist -
## sie traegt gerade uncommittete WIP einer parallelen Session)

- Stil-AUFFORDERUNGEN ("variiere die Formulierung", "Alltagssprache") erzeugen bei
  Haiku Register-Entropie: Duz-Drift + reaktivierte Thema-Frage - Spiegelbild der
  Runde-1-Lehre zu breiten Verboten. Auch enge Zusatzregeln nur behalten, wenn die
  Bench einen Gewinn zeigt (v3 zeigte keinen -> Ablation).
- BEIDE Owner-Symptome waren Infra/Timing (Deploy-Kollision, alter Deploy) - Log-
  Forensik VOR dem Coden hat verhindert, am Prompt zu kurieren, was nicht am Prompt
  lag (CLAUDE.md Regel 7).
- Bench-Reports tragen meta.git_rev: alte Laeufe sind als Baseline-Pool
  wiederverwendbar (git diff auf den Voice-Pfad als Legitimation) - spart einen
  vollen Baseline-Sweep.
- Vor einem Merge in master aus einem Worktree: `git status` im HAUPT-Checkout
  UNGEKUERZT lesen (head schnitt die tasks/-WIP ab) und die eigene Branch-Flaeche
  von fremder WIP freihalten, statt zu stashen.
