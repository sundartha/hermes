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
4. **S-C Natuerlichkeits-Feinschliff (eng, am Entscheidungspunkt)**: Judge-
   Rationales der Runde-1-Laeufe gemint; Hauptmuster "formelhaft/mechanisch"
   (gleichfoermige Floskel-Anfaenge). Zwei enge Aenderungen:
   - Quittierungs-Bullet: Variation gefordert, "beginne nie zwei Antworten
     hintereinander mit derselben Floskel" (+ drittes Beispiel "Verstehe,").
   - speechClause de: "... - Alltagssprache wie am Telefon, keine
     Schriftsprache." (fr/en bewusst unveraendert - die Bench misst nur DE;
     Angleichung erst nach eigenem FR/EN-Beleg.)

## Bench-Beleg (A/B gepoolt, Judge claude-sonnet-5 + deterministische Checks)

Baseline = v6-Pool aus Runde 1 (candidate-final-sweep + candidate-v6-fv, 20
Laeufe, git_rev 2930127 = identischer Voice-Pfad wie c12c546/2c6c4e2 - per
git diff verifiziert, nur Auth/Widget-Diffs dazwischen).

<!-- BENCH-ERGEBNISSE: wird nach den Candidate-Sweeps befuellt -->

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
