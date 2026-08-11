# Kickoff: Kappungs-Kette — bau O1, dann O2

Du uebernimmst eine laufende Arbeit. **Die Analyse ist fertig, sie ist nicht zu wiederholen.**
Was fehlt, ist ein Messwerkzeug und danach ein Diagnose-Anruf.

## Pflichtlektuere, in dieser Reihenfolge — und sonst nichts

1. `tasks/PLAN-KAPPUNG.md` — die Strategie. Enthaelt Optionen, Messplan mit Erfolgsschwelle
   und sechs verworfene Hypothesen.
2. `tasks/gq-chain-state.md`, nur der Abschnitt **"Abnahme 2026-08-11"** (ganz unten).
3. `CLAUDE.md` (Absolute Regeln) und `.claude/refs/clean-code.md` vor dem ersten Edit.

Lies NICHT die ganze `gq-chain-state.md` (1400 Zeilen Historie) und keine Berichte aus
`tasks/gq-welle0/`. Der Stand steht in 1 und 2.

## Der Stand in fuenf Saetzen

Von 7 gesprochenen Agenten-Turns kommen beim Angerufenen im Schnitt nur ~60 % vollstaendig an;
der Rest bricht mitten im Wort ab. Die Rate liegt bei **rund 40 % seit mindestens dem
31.07.** — es ist kein neuer Defekt und keine Regression der Sprechsperre. Die **Wurzel ist
unbelegt**: ein Workflow mit 26 Agenten hat 13 von 20 Befunden gekippt, darunter alle, die
nach einer Erklaerung aussahen. Belegt ist nur, was es nicht ist (Provider-Config,
Startlatenz, unvollstaendige Auslieferung unsererseits — Telnyx hatte den Text nachweislich
211-279 ms bevor es zu sprechen begann). Der Barge-in-Patch vom 09.08. gilt im Bestand als
Loesung und ist keine.

## Deine Aufgabe 1: O1 — `scripts/kappungsrate.mjs`

Ein **read-only** Messskript. Kein Laufzeit-Code, kein Deploy, keine Env-Aenderung, kein Anruf.

**Was es tut:** nimmt eine Liste `call_id`s und gibt je Agenten-Turn aus, ob er vollstaendig
gespielt wurde. Dazu joint es den **gespielten** Text
(`GET /v2/ai/conversations/<uuid>/messages`, Feld `text` — NICHT `content`) gegen den
**erzeugten** Text (`transcript_segment` in der Prod-DB). Ein Turn gilt als gekappt, wenn der
gespielte Text ein echtes Praefix des erzeugten ist. Zusaetzlich protokolliert es je Turn, ob
im Sprechfenster ein Caller-Turn liegt (fuer die spaetere Barge-in-Trennung).

**Vorbild:** `scripts/telnyx-call-latency.mjs` und `scripts/stt-wer.mjs` (dessen Kopf-Kommentar
zeigt, wie ausfuehrlich ein Messverfahren hier dokumentiert wird — inklusive seiner Grenzen).

**Drei Pflicht-Assertions. Jede stammt aus einem Fehler, der in der Analyse passiert ist:**

1. `meta.total_pages` auslesen und **alle** Seiten holen, sonst harter Abbruch. Die
   Paginierung (page_size 20) hat 19 Nachrichten verschluckt — bei HTTP 200 und einer Antwort,
   die vollstaendig aussah.
2. RLS-SET in **derselben** `psql`-Sitzung wie das SELECT, **plus Positiv-Kontrolle**
   (`count > 0`), sonst Abbruch. Die Prod-DB steht unter FORCE-RLS; 0 Zeilen sind sonst nicht
   von "keine Daten" unterscheidbar.
3. Join ueber `call_id` + Reihenfolge, **niemals** ueber Text-Praefix. Ein Praefix-Join hat
   ausgerechnet die haertesten Kappungen verloren.

**Selbsttest, nicht verhandelbar:** das Skript **muss** fuer `call_msoem5d1qpsf` genau **5 von
7** gekappten Turns liefern. Tut es das nicht, ist das Skript kaputt — nicht die Datenlage.
Bau diesen Fall als Test, nicht als manuelle Kontrolle.

**Filter:** nur Anrufe mit `telnyx_conversation_id IS NOT NULL` (sonst mischst du
Assistant-Pfad und Budget-Engine; im Fenster liegen 11 Anrufe ohne). Schreib den Filter in die
Kopfzeile der Ausgabe.

**Zwei Zaehlregeln aus dem Messplan:**
- Ein Turn, dessen Text weniger als 2 s vor dem Hangup auf den Draht ging, wird **verworfen** —
  das ist die 91-s-Carrier-Kappung, ein anderer Defekt.
- Telnyx' `user`-Zeitstempel ist unzuverlaessig (1,62 s zu spaet, Aeusserungen fehlen ganz).
  Als Onset gilt der **fruehere** Wert aus Telnyx-Protokoll und unserer `turn_probe`-Zeile.

## Deine Aufgabe 2: O2 vorbereiten (der Diagnoseknopf)

`PATCH /v2/ai/assistants/<id>` mit `interruption_settings.enable: false`, dann **drei
begleitete Testanrufe**, dann sofort zurueck.

Das beantwortet binaer, ob die Wiedergabe wegen Barge-in abbricht: verschwindet die Kappung,
ist die Achse belegt; bleibt sie, scheidet Barge-in aus und der Suchraum halbiert sich.

**Vor dem Eingriff festhalten:** Rueckweg (`enable: true`, `interrupt_prediction_threshold: 0.4`)
und die aktuelle `version_id 20260809T095319385426`. **Nach dem PATCH zwingend `GET`** und den
zurueckgegebenen Wert lesen — Telnyx quittiert ungueltige Felder mit **HTTP 200** und ignoriert
sie still (in diesem Projekt zweimal passiert). Rueckstellung am selben Tag.

**Erfolgsschwelle, vorher festgelegt:** hoechstens **2 von 18** Turns gekappt (11 %), gemessen
mit O1, am selben Tag, in einer Konfiguration. Gegen die Grundrate 40 % gerechnet:
P(X<=2 | n=18) = 0,008. Zur Warnung: "0 von 2 gekappt" — die Abnahme vom 09.08. — tritt bei
derselben Grundrate mit **36 %** zufaellig ein. Ein Anruf ohne Kappung ist KEIN Beleg.

Drei Anrufe a <=90 s ergeben ~21 Turns. Der Plan braucht bewusst keinen langen Anruf, weil die
Owner-Nummer vom Ziel-Carrier nach ~91 s gekappt wird (belegt, bei uns nicht behebbar).

## Was du NICHT tust

- **Die sechs verworfenen Hypothesen nicht erneut untersuchen** (`PLAN-KAPPUNG.md`, Abschnitt
  "Verworfen"). Darunter: Trendkurve der Tagesquoten, "die Sprechsperre hat es verschlimmert",
  Startlatenz, Chunk-Zahl-Vergleich, "`flushed` heisst gratis", Provider-Ingest-Verlust.
- **Keine Prompt-Runde gegen die Werkzeugwahl.** Das wurde dreimal versucht (AL-P14, AL-D3,
  GQ-P9) und hat nie gewirkt.
- **Nicht O3 (Env-Flip `TELNYX_SHIM_EXTEND_HOLD_MS` 3000 -> 0) vor O2.** Er holt die
  Doppelantwort-Regression zurueck und loest einen Deploy aus, der die Messung verunreinigt.
- **Keinen Fix bauen, bevor O1 eine Zahl liefert, die zweimal gleich herauskommt.** In der
  Analyse sind sieben von sieben vorgelegten Messungen gekippt.

## Was du nicht selbst kannst — dafuer brauchst du den Owner

In der letzten Session vom Berechtigungs-Classifier blockiert:

- **Env-Variablen setzen** (Render-Dashboard)
- **Deploy ausloesen** (Render-Dashboard -> Manual Deploy)
- **Skripte gegen die Prod-DB laufen lassen**

Der Owner kann Kommandos in der Session mit vorangestelltem `!` selbst ausfuehren; die Ausgabe
landet dann im Chat. Formuliere sie kopierfertig, statt es selbst zu versuchen.

**Deploy-Weg:** Render deployt den Branch `master` des **upstream**-Repos (`jonas986`) mit
`autoDeploy: no`. Ein Push allein macht nichts live. Live-Stand IMMER per `/healthz` +
`git merge-base --is-ancestor` pruefen, nie aus einer Notiz.

## Daneben offen — nur mit Ansage anfassen

- **Anruf 3 (Satzzeichen):** wartet auf `TELNYX_PER_CALL_TRANSCRIPTION_ENABLED=false`. Der
  Schalter ist gebaut und live (Default `true`). Vorher-Zahl steht: 0 % Satzzeichen bei n=7.
- **SMS-Zusammenfassung scheitert nach JEDEM Anruf** (`HTTP 400, 40305 Invalid 'from' address`).
  Der Owner bekommt nie eine Zusammenfassung. Noch nicht diagnostiziert.
- **Befund 2/3/4 aus der Gespraechsanalyse vom 11.08.:** der Agent nennt den Auftraggeber als
  Auskunftsquelle (verletzt eine bindende Owner-Vorgabe); `get_consult` faellt mitten im
  Gespraech aus dem Werkzeugsatz (`consultPollFresh:false`) und der Agent behauptet daraufhin,
  er koenne "technisch nicht" rueckfragen; `consultHoldSpeech` (`src/i18n/locales.js:213`) ist
  hart auf "Sie" kodiert und bricht das Du im Gespraech. Der letzte ist ein Einzeiler.

## Arbeitsweise

Der Owner will **Tempo und Ergebnisse, keine Prozessdokumente**. Gib Messungen und Recherche an
Subagenten ab, halte deinen eigenen Kontext duenn, und berichte kurz. Neue Dateien in `tasks/`
nur, wenn er sie verlangt. Ein Befund gilt erst, wenn er gemessen ist — eine plausible
Rechnung ist keine Messung, und ein gruenes Mechanismus-Signal ist kein gutes Gespraech.
