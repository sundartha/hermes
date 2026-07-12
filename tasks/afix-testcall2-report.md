# Forensik-Report: Zweiter Owner-Testanruf (Idle-Nudge- + Overlap-Probe)

Status: Abgeschlossen. Anruf `call_mri2scgen8jf` (Hermes-interne ID), 2026-07-12,
Telnyx-Conversation `2e5ee817-a692-4606-b938-9fd04411d1a9`, Call-Leg
`414e9d4e-7e18-11f1-87bb-02420a1f0b69`, Call-Session `414831f2-7e18-11f1-ad6f-02420a1f0b69`.
Anonymisiert: keine Telefonnummern, kein echter Personenname (Auftraggeber-Name
in Zitaten durch `[Auftraggeber]` ersetzt), keine Secrets/Presigned-URLs.

Testskript des Owners laut Auftrag: (a) Opening angehoert, (b) danach ca. 10s
bewusst geschwiegen (Idle-Nudge-Probe), (c) spaeter der KI absichtlich ins Wort
gefallen (Overlap-Probe = R1-Gate).

## Datenquellen (alle read-only erhoben)

- Render-App-Logs (`srv-d8m0fhflk1mc73bno570`) fuer `call_mri2scgen8jf`, 17:36:44-17:38:30 UTC
- Telnyx `/v2/recordings` (Liste + Einzelabruf) -> frischer Presigned-Download `rec2.mp3`
  (dual-channel, 8kHz, 38.556s Nutzlaenge, `recording_started_at`=17:37:08.084653Z)
- Telnyx `/v2/call_events?filter[call_control_id]=...` (18 Events, `dial` bis `call.analyzed`,
  inkl. vollem `hangup`/`call.hangup`-Payload mit `hangup_source`/`hangup_cause`)
- Telnyx `/v2/ai/conversations/{id}/messages` (6 Nachrichten: 1x system "[long silence]",
  3x assistant, 2x user) - **inklusive Telnyx-eigener Latenz-Metadaten pro Assistant-Message**
  (`end_user_perceived_latency_ms`, `llm_first_token_duration_ms`, `audio_first_token_duration_ms`)
  und `sent_at` (verifiziert: `sent_at` = Trigger-Zeitpunkt + `end_user_perceived_latency_ms`,
  d.h. `sent_at` markiert den Beginn der hoerbaren Audio-Wiedergabe)
- Kanaltrennung via `ffmpeg channelsplit` -> `ch0.wav` (Owner), `ch1.wav` (Agent)
- `ffmpeg silencedetect` auf beiden Kanaelen (-35/-40/-45dB, d=0.15-0.3s zur
  Robustheitspruefung), plus `astats` (RMS/Peak) zur Signal-vs-Stille-Verifikation
- Telnyx `/v2/ai/audio/transcriptions`, Modell `openai/whisper-large-v3-turbo`, ohne
  Sprach-Hint, als Referenz-STT fuer beide Owner-Aeusserungen UND zur Kontrolle von
  Turn 1 (Reintroduction) und Turn 3 (Abschied) auf dem Agent-Kanal

Kanalzuordnung verifiziert: ch1-Sprachfenster korrelieren durchgehend mit allen 4
`turn_ok`-Zeitpunkten und den `sent_at`-Werten der Assistant-Messages (mit ~0.4-0.5s
Vorlauf-Versatz durch weiche Anlaute unterhalb der Schwelle), ch0-Sprachfenster mit
den beiden User-Messages. Kein Kanaltausch.

## Zeitachse (Render-App-Log + Telnyx call_events, UTC)

```
17:36:46.095  place_call abgesetzt
17:36:54.996  call.answered / opening_voice=elevenlabs
17:36:56.050  call.speak.started (Opening)
17:37:07.751  call.speak.ended (completed) [App-Log; Telnyx-Event: 17:37:07.714]
17:37:07.820  ai_assistant_start (Telnyx call_events)
17:37:08.085  Aufnahme startet effektiv (recording_started_at)
17:37:08.519  call.conversation.created (conversation_id 2e5ee817-...)
17:37:12.778  System-Message "[long silence]" (sent_at) -> Idle-Nudge-Trigger
              (~4.96s nach ai_assistant_start, konsistent mit einem ~5s-Idle-Timer)
17:37:14.612  turn_ok #1 (LLM 1771ms) -> Assistant-Turn 1 (Reintroduction)
17:37:14.789  Turn 1 sent_at (= Audio-Start), end_user_perceived_latency_ms=2012
17:37:20.478  Owner beginnt zu sprechen (Overlap-Probe) - WAEHREND Turn 1 noch laeuft
17:37:21.531  Turn 1 Audio endet akustisch (ch1)
17:37:23.815  Owner-Aeusserung 1 endet akustisch (ch0)
17:37:24.704  turn_ok #2 (LLM 1843ms) -> KEINE Assistant-Message, KEIN Audio (VERWORFEN)
17:37:24.853  User-Message 1 finalisiert (sent_at): "Ja, das Wetter wird morgen gut.
              Es hat er vêtementgut."
17:37:26.074  turn_ok #3 (LLM 1168ms) -> Assistant-Turn 2 ("Entschuldigung...")
17:37:26.252  Turn 2 sent_at (Audio-Start), end_user_perceived_latency_ms=1551
17:37:30.778  Owner-Aeusserung 2 beginnt akustisch (ch0)
17:37:30.875  Turn 2 Audio endet akustisch (ch1)
17:37:32.127  Owner-Aeusserung 2 endet akustisch (ch0)
17:37:32.660  User-Message 2 finalisiert (sent_at): "Es Wetter wird morgen gut."
17:37:34.393  Turn 3 Audio beginnt akustisch (ch1, Abschied)
17:37:34.709  turn_ok #4 (LLM 2003ms) + tools=[end_call] + farewell_scheduled delayMs=12000
17:37:34.878  Turn 3 sent_at (Audio-Start), end_user_perceived_latency_ms=2417
17:37:46.087  Turn 3 Audio endet akustisch (ch1) - Abschied vollstaendig gespielt
17:37:46.798  Telnyx-Event "hangup" (Kommando unsererseits)
17:37:46.921  call.hangup (hangup_source=caller, hangup_cause=normal_clearing)
17:37:47.019  call.hangup empfangen im App-Log
```

## Konversationsinhalt (Telnyx `/messages`, anonymisiert, vollstaendig)

| Rolle | Text | sent_at (UTC) | Latenz-Metadaten |
|---|---|---|---|
| system | "[long silence]" | 17:37:12.778 | - |
| assistant (Turn 1) | "Guten Tag! Hier ist Hermes, der Telefonassistent von [Auftraggeber]. Ich rufe an, weil [Auftraggeber] gerne kurz von Ihnen wissen " | 17:37:14.789 | TTFA 2012ms |
| user (Msg 1) | "Ja, das Wetter wird morgen gut. Es hat er vêtementgut." | 17:37:24.853 | - |
| assistant (Turn 2) | "Entschuldigung, ich habe das letzte Wort nicht ganz verstanden - koennten Sie das nochmal wiederholen?" | 17:37:26.252 | TTFA 1551ms |
| user (Msg 2) | "Es Wetter wird morgen gut." | 17:37:32.660 | - |
| assistant (Turn 3) | "Alles klar, danke der Nachfrage - dann ist das ja geklaert, das Wetter wird morgen gut. Ich gebe [Auftraggeber] gerne Bescheid! Dann bedanke ich mich vielmals fuer Ihre Zeit und wuensche Ihnen noch einen schoenen Tag!" | 17:37:34.878 | TTFA 2417ms |

**Wichtig:** `turn_ok #2` (17:37:24.704, LLM erfolgreich, 1843ms) hat **keine** Entsprechung
in dieser Tabelle - siehe Punkt 1.

## Einzelbewertungen

### 1. R1-GATE (launch-kritisch)

**Verdikt: PASS (numerisch) MIT SCHWEREM VORBEHALT - R1-Verwerf-Mechanismus weiterhin
aktiv bestaetigt.**

Owner-Aeusserungen und Gap bis zur naechsten hoerbaren Agent-Aeusserung:

| # | Owner-Aeusserung (Text) | Ende (UTC) | Naechste hoerbare Agent-Aeusserung | Gap | Kriterium <=5.0s |
|---|---|---|---|---|---|
| 1 (ueberlappend, siehe unten) | "Ja, das Wetter wird morgen gut. Es hat er vêtementgut." | 17:37:23.815 | Turn 2, 17:37:25.801 | **1.99s** | PASS |
| 2 | "Es Wetter wird morgen gut." | 17:37:32.127 | Turn 3 (Abschied), 17:37:34.393 | **2.27s** | PASS |

Beide Luecken liegen klar unter 5.0s - das numerische Kriterium ist erfuellt.

**Overlap real nachgewiesen:** Der Owner begann bei 17:37:20.478 zu sprechen, WAEHREND
Turn 1 (Reintroduction) noch bis ca. 17:37:21.531 lief - echte akustische Ueberlappung
von ca. 1.05s. Bemerkenswerter Nebenbefund: die gespeicherte Turn-1-Nachricht bricht
grammatikalisch unvollstaendig ab ("...wissen "), waehrend die Whisper-Referenz auf dem
vollen Audio-Fenster ein zusaetzliches Wort liefert ("...wissen moechte,") - die Antwort
ist also auch danach noch unvollstaendig. Das ist ein Indiz (nicht zweifelsfrei beweisbar
ohne Audio-Abhoeren durch einen Menschen), dass Telnyx die Turn-1-Wiedergabe durch das
Ins-Wort-Fallen des Owners tatsaechlich unterbrochen hat, mit ca. 1s Reaktions-/Puffer-
Verzoegerung bis zum tatsaechlichen Stopp. Das waere die erste empirische Bestaetigung,
dass der Telnyx-AI-Assistant-Pfad (anders als der TeXML-Gather-Pfad) Barge-in besitzt -
aber nicht abschliessend von "LLM hat unvollstaendigen Satz generiert" zu unterscheiden.

**Zentraler Befund - verworfene Antwort:** `turn_ok #2` (17:37:24.704, LLM erfolgreich,
1843ms Latenz, LLM-Aufruf gestartet ca. 17:37:22.86) hat **weder eine Assistant-Message
in der Telnyx-Conversation noch ein zugeordnetes Audio-Segment auf ch1** hinterlassen.
Mechanismus rekonstruiert: Der Owner machte nach "Ja, das Wetter wird morgen gut."
eine kurze Pause (0.76s, 17:37:23.06-23.82 grob), die vom Endpointing faelschlich als
Gespraechsende gewertet wurde und einen LLM-Aufruf mit dem UNVOLLSTAENDIGEN Transkript
ausloeste (`turn_ok #2`). Der Owner sprach jedoch weiter ("Es hat er vêtementgut."),
Telnyx fasste beides zu EINER finalen User-Message zusammen und loeste einen ZWEITEN,
neuen LLM-Aufruf aus (`turn_ok #3`, nur 1.37s nach `turn_ok #2`). Die bereits synthetisierte
Antwort aus `turn_ok #2` wurde nie gespielt und nicht registriert - exakt das aus der
Vorsitzung bekannte R1-Verwerf-Muster (RCA `tasks/rca-2026-07-12-assistant-dead-call.md`),
diesmal ausgeloest durch eine normale Sprechpause MITTEN in einer Owner-Aeusserung, nicht
durch das bewusste Overlap-Manoever selbst.

**Einordnung:** 1 von 4 erfolgreichen LLM-Turns (25%) wurde in diesem Anruf verworfen.
Die Luecke blieb nur deshalb unter 5s, weil der Folge-Turn (`turn_ok #3`) fast unmittelbar
(~150ms nach Finalisierung der vollstaendigen Owner-Aeusserung) startete und schnell fertig
wurde (1168ms). Das ist Zufall der Zeitverhaeltnisse in diesem Anruf, keine strukturelle
Absicherung - bei laengerer LLM-Latenz des Recovery-Turns waere das 5s-Kriterium
realistisch verletzbar. **R1 ist NICHT behoben**, nur diesmal folgenlos maskiert.

### 2. E1.3 Idle-Nudge

**Verdikt: PASS.**

`call.speak.ended` (17:37:07.751) bis erste hoerbare Assistant-Aeusserung (akustischer
Onset Turn 1 auf ch1, 17:37:14.348): **6.60s**. Cross-Check ueber Telnyx' eigene
`sent_at`-Metrik (17:37:14.789): **7.04s**. Beide Werte liegen bei/knapp unter der
~7s-Zielmarke und sind eine massive Verbesserung gegenueber dem 12.4s-Befund vor dem Fix
(R5 in der Vorsitzung). Zusatzbefund: der System-Trigger "[long silence]" kam bei
17:37:12.778, ca. 4.96s nach `ai_assistant_start` - deutet auf einen ~5s-Idle-Timer hin
(nicht die zuvor dokumentierten 10s).

### 3. E2.1/E2.2 STT-Qualitaet

**Verdikt: FAIL (eingeschraenkt) - R2-Muster erneut aufgetreten, diesmal als
Wortfragment statt Vollsatz.**

| Owner-Aeusserung | Flux-live (Telnyx Conversation) | Whisper-Referenz (kein Sprach-Hint) | Bewertung |
|---|---|---|---|
| 1 | "Ja, das Wetter wird morgen gut. Es hat er vêtementgut." | "Ja, das Wetter wird morgen gut. Das Wetter wird morgen gut." | Flux-Tail ist Kauderwelsch (franzoesisch angehauchtes Nonsense-Wort "vêtementgut"), Whisper liefert sauberes, wiederholtes Deutsch |
| 2 | "Es Wetter wird morgen gut." | "Das Wetter wird morgen gut." | Flux macht einen kleinen Artikelfehler ("Es" statt "Das"), aber KEIN Kauderwelsch - korrektes Deutsch im Kern |

Aeusserung 1 enthaelt ein fremdsprachlich angehauchtes Nonsense-Fragment - dasselbe
R2-Muster wie in der Vorsitzung (dort ganze Saetze NL/EN), hier auf ein Wort begrenzt,
aber mit realer Konsequenz: Es hat DIREKT die verwirrte Rueckfrage "Entschuldigung, ich
habe das letzte Wort nicht ganz verstanden..." (Turn 2) ausgeloest und den Owner zu einer
Wiederholung gezwungen (User-Message 2). R2 ist damit **nicht behoben**, nur seltener/
kleiner in der Auswirkung.

### 4. E2.3 TTFA

**Verdikt: PASS.**

Nur die beiden echten Antwort-Turns (Reaktion auf Owner-Sprache) gezaehlt, Turn 1
(Idle-Nudge, kein Owner-Trigger) ausgeschlossen:

| Turn | Ende Owner-Aeusserung -> Beginn Agent-Audio (akustisch) | Telnyx `end_user_perceived_latency_ms` |
|---|---|---|
| Turn 2 | 1.99s | 1551ms |
| Turn 3 (Abschied) | 2.27s | 2417ms |

Median akustisch: **2.13s**. Median Telnyx-Metrik: **1.98s**. Beide klar unter der
2.5s-Zielmarke, beide Quellen groessenordnungsmaessig konsistent (Differenz durch
unterschiedliche EOT-Referenzpunkte akustisch vs. STT-intern erklaerbar).

### 5. E3.1/E3.2 Abschied + Hangup

**E3.1 - Vollstaendigkeit: PASS.** Whisper-Referenz auf dem vollen Turn-3-Audiofenster
liefert wortgleich (bis auf Interpunktion) den gespeicherten Abschiedstext, keine
fehlenden Woerter, kein Abbruch.

**E3.2 - Hangup-Timing: PASS (fuer diesen Anruf) mit Vorbehalt zum Mechanismus.**
`farewell_scheduled` um 17:37:34.710 + 12000ms-Cap = rechnerisch 17:37:46.710. Tatsaechlicher
Hangup-Befehl (Telnyx-Event) um 17:37:46.798 - **88.6ms NACH** Cap-Ablauf. Wie beim
Vorgaenger-Call (82ms) ist das ein starkes Indiz, dass wieder der MAXIMALE Cap den Hangup
ausgeloest hat, nicht ein frueh erkanntes "TTS fertig"-Signal. Diesmal jedoch: die
hoerbare Abschieds-Hauptaeusserung dauerte selbst fast 11.7s (17:37:34.393-17:37:46.087)
und fuellte den 12s-Cap fast vollstaendig aus - die Stille zwischen Ende der hoerbaren
Aeusserung und Hangup-Befehl betrug nur **0.71s** (statt 4.5s beim Vorgaenger-Call). Das
ist eine deutliche Verbesserung fuer DIESEN Anruf, aber vermutlich Zufall der Satzlaenge
(langer Abschiedssatz = Cap passt fast genau), nicht Beweis eines fruehen Abbruch-Triggers.
Der Cap-Mechanismus selbst ist unveraendert (Vollausschoepfung bestaetigt).

**Keine Wiederholung der Vorgaenger-Anomalie:** Die ~3.9s-Luecke MITTEN im Abschiedssatz
aus dem Vorgaenger-Call trat diesmal NICHT auf. Alle internen Pausen innerhalb des
Abschieds waren kurz und natuerlich (0.30s, 0.50s, 0.62s) - konsistent mit normalen
Satzpausen, durch die Whisper-Referenz-Transkription (durchgehend korrekt und
luecken-frei rekonstruiert) bestaetigt.

Sowohl am Ende von Turn 1 als auch ganz am Schluss (ca. 17:37:46.28-46.47, auf BEIDEN
Kanaelen simultan, Peak exakt 0.0dB = Vollausschlag) findet sich ein extrem kurzer
Klick-Artefakt (nicht Sprache) - konsistent mit einem Leitungs-/Teardown-Klick, wie er
bereits in der Vorsitzung als "89ms-Klick" dokumentiert wurde. Kein Hinweis auf
verschluckte Sprachausgabe an dieser Stelle.

## 6. Zusatzmessungen fuer die Optimierungsstrategie

- **Totzeit (kein Ton auf BEIDEN Kanaelen gleichzeitig), gesamte Aufnahme nach Opening
  (38.556s):** 14.11s = **36.6%** der Gespraechszeit. Davon allein 6.26s die bewusste
  Anfangs-Stille der Idle-Nudge-Probe (Testskript-Artefakt). Ohne diese Anfangsphase:
  7.85s von 32.29s = **24.3%** Totzeit im eigentlichen Dialogteil.
- **Fenster "Ende Owner-Aeusserung -> erster Agent-Ton"** (das Fenster, das mit
  Fuellwoertern/Backchanneling ueberbrueckt werden koennte): Turn 2 = **1.99s**,
  Turn 3 = **2.27s**. Beide Werte in der gleichen Groessenordnung wie E2.3 (dieselben
  Messpunkte) - ein Fuellwort-Mechanismus haette hier ca. 2s Zeit zu ueberbruecken.
  Zusaetzlich: die anfaengliche Idle-Phase vor dem System-Trigger betrug 4.96s (kein
  Fuellwort-Kandidat, da nutzergetriggerte Stille, kein Antwort-Warten).
- **Sprechzeit-Anteile:** Agent (ch1) 21.66s (56.2% der Aufnahme), Owner (ch0) 4.05s
  (10.5%) - der grosse Rest ist die genannte Totzeit plus die lange Abschieds-/Cap-Phase
  am Ende.
- **Verworfene Turns:** 1 von 4 (25%) - siehe Punkt 1.

## Wichtigster Befund

R1 (Turn-Taking verwirft erfolgreich generierte Antworten) ist **nicht behoben** und trat
in diesem Anruf real auf - diesmal ausgeloest durch eine normale Sprechpause der
Owner-Aeusserung, nicht nur durch bewusstes Ins-Wort-Fallen. Die Antwort aus `turn_ok #2`
wurde synthetisiert, aber nie gespielt und nicht registriert. Der Anruf "funktionierte"
dennoch, weil der Recovery-Turn (`turn_ok #3`) zufaellig schnell genug war, um die 5s-Grenze
einzuhalten - das ist keine strukturelle Absicherung, sondern Glueck der Zeitverhaeltnisse.
Alle anderen gemessenen Groessen (Idle-Nudge-Latenz, TTFA, Abschieds-Vollstaendigkeit,
Hangup-Stille) sind in diesem Anruf im gruenen Bereich, teils deutlich besser als beim
Vorgaenger-Call.

## Wichtigste verbleibende Schwachstelle

Der R1-Verwerf-Mechanismus selbst ist architektonisch ungeloest: Jede Sprechpause des
Angerufenen innerhalb einer laengeren Aeusserung kann eine vorzeitige LLM-Antwort
ausloesen, die beim Fortsetzen der Rede automatisch verworfen wird. Ob der Anrufer davon
etwas merkt, haengt rein vom Zufall ab, wie schnell der nachfolgende "echte" Turn
antwortet. Ergaenzend bestaetigt: R2 (STT-Kauderwelsch) tritt weiterhin auf, diesmal in
abgeschwaechter Form (ein Nonsense-Wortfragment statt ganzer Fremdsprach-Saetze), aber mit
direkter, beobachtbarer Gespraechs-Konsequenz (erzwungene Rueckfrage/Wiederholung).
