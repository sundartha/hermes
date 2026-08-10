# Spec: der Dead-Air-Waechter darf nicht kappen, waehrend der Agent spricht

Auftrag fuer eine Umbauphase. **Phasen-ID: `dead-air-speech`.**
Alle Behauptungen unten sind am Code bzw. am Live-Log belegt; Vermutungen sind markiert.

## 1. Der Defekt (live reproduziert)

Testanruf `call_msn34lpf77wg`, 2026-08-10, 10:24:55,884 -> 10:26:21,931 UTC = **86,05 s**,
ASSISTANT-Pfad. Der Agent war angewiesen, laut mitzuzaehlen; der Owner hat nur zugehoert.

```
10:26:21.689  [telnyx-watchdog] dead_air {"callId":"call_msn34lpf77wg","turnSeq":3}
10:26:21.931  call.hangup ... hangup_cause=normal_clearing hangup_source=caller
10:26:21.957  [telnyx/voice] endCallViaCallControl ok status=200 ccid=true
```

`hangup_source=caller` — wir haben aufgelegt. Owner-Gegenprobe unabhaengig: der Agent brach
bei der gesprochenen Zahl **70** ab, mitten im Satz.

**Wurzel (am Code bestaetigt):** `restartDeadAirTimer`
(`src/telnyx-conversation-watchdog.js:129-132`) ist ein reiner Wall-Clock-`setTimeout`.
Armiert wird einmalig bei `ai_assistant_start`; zurueckgesetzt wird er **ausschliesslich**
von `observeTurn()` (ebenda `:162-178`), das nur bei einem eingehenden `/v1`-Request laeuft —
also nur, wenn der **Anrufer** spricht. Nichts im Sprechpfad (`respond`, `wire.writeChunk`)
beruehrt den Timer.

Folge: Spricht der Agent laenger als `TELNYX_DEAD_AIR_TIMEOUT_S` (=45) am Stueck, entsteht in
dieser Zeit kein Request — und der Waechter haelt die aktive Leitung fuer tot.
**Er misst die falsche Groesse: er soll "Leitung tot" erkennen, prueft aber "Anrufer schweigt".**

Ueberschlag mit der vorhandenen Kalibrierung (65 ms/Zeichen): ab rund **700 Zeichen**
ununterbrochener Agentensprache schlaegt der Waechter mitten ins laufende Gespraech. Ein
normaler Turn erreicht das selten — ein Vorlesen, eine Aufzaehlung oder ein
Recherche-Ergebnis sehr wohl.

**NICHT Teil dieser Phase:** die neun 91-Sekunden-Anrufe. Die haben eine andere Signatur
(`hangup_source=callee`) und `dead_air` steht bei keinem von ihnen im Log. Siehe
`tasks/91s-kappung-befunde-2026-08-10.md`. **Nicht vermischen.**

## 2. Was der Waechter schuetzt (bleibt erhalten)

Kosten-Notaus gegen eine still haengende Telnyx-TTS-Pipeline. Ohne ihn liefe ein toter Call
bis zum absoluten Cap (bis 30 min, ~5 US-Cent/Minute). **Der Schutz darf nicht entfernt und
nicht per Default umgangen werden** — eine wirklich tote Leitung muss weiterhin beendet
werden. Diese Phase verschiebt ausschliesslich die Grenze zwischen "tot" und "Agent spricht",
die im Code heute gar nicht existiert.

## 3. Die Loesung: das bestehende Muster verallgemeinern

**Der Mechanismus ist bereits da.** Fuer den Abschiedssatz wird der Dead-Air-Timer heute schon
um eine geschaetzte Sprechdauer suspendiert (`farewellDelayMs`, Kalibrierung
`FAREWELL_CALIBRATION_BY_LANGUAGE`, `src/telnyx-conversation-watchdog.js:80-99`; Test T10 in
`test/telnyx-stab-p9-watchdog.test.js` pinnt das). Die Phase wendet **dasselbe erprobte
Muster** auf jede Agentenantwort an, statt einen neuen Mechanismus zu bauen.

**Soll-Verhalten:** Liefert ein Shim-Turn Sprechtext, wird der Dead-Air-Timer fuer diesen Turn
um die geschaetzte Sprechdauer dieses Textes verlaengert. Nach dem geschaetzten Sprechende
laeuft die normale Frist von `TELNYX_DEAD_AIR_TIMEOUT_S` weiter.

Damit gilt: **Frist = geschaetzte Sprechdauer + 45 s.** Eine tote Leitung wird weiterhin
erkannt, nur eben gemessen ab dem Moment, in dem der Agent aufgehoert hat zu reden — statt ab
dem Moment, in dem er angefangen hat.

### Bewusst verworfene Alternativen

- **Timer bei jedem Chunk auf der Leitung zuruecksetzen:** laesst "tot nach dem letzten Chunk"
  durchrutschen — genau der Fall, den der Waechter fangen soll.
- **Auf ein Provider-Event stuetzen:** `call.speak.ended` ist im Code ausschliesslich an die
  einmalige Opening-Ansage gekoppelt; ob Telnyx fuer spaetere Turns ueberhaupt ein solches
  Event sendet, ist **unbelegt**. Ausserdem sind Telnyx' Speak-Events nachweislich schon
  einmal ganz ausgeblieben (Opening-Speak-Timeout-Fix) — es braeuchte ohnehin einen
  Fallback-Timer. Kein Fundament fuer eine Sicherung.
- **Auf den In-Flight-Status stuetzen:** das heutige Signal (`telnyx-turn-supersede.js`) endet
  bei **unserer** Berechnung, nicht bei Telnyx' Wiedergabe — es deckt fast genau NICHT den
  beobachteten Fall.

## 4. Auflagen an die Umsetzung

1. **Eine Quelle fuer die Kalibrierung.** Die Sprechdauer-Schaetzung existiert bereits
   (`FAREWELL_CALIBRATION_BY_LANGUAGE` / `farewellDelayMs`, modul-privat). Sie ist
   wiederzuverwenden, **nicht zu duplizieren**. Ein zweiter Zeichen-pro-Sekunde-Wert im Code
   ist ein Fehler.
2. **Die Antwortlaenge ist vorhanden:** `speechTextOf(turn).length`
   (`src/telnyx-llm-shim.js:962`) wird heute nur fuer den Farewell-Pfad benutzt.
   **Achtung, Falle:** das Feld `chars` in der `turn_ok`-Logzeile ist NICHT die Antwortlaenge,
   sondern `callerText.length` — die eingehende Aeusserung. Nicht verwechseln.
3. **Obergrenze fuer die Verlaengerung (Pflicht).** Die Verlaengerung braucht einen benannten
   Deckel als Konstante. Begruendung im Pre-Mortem unten. Kein Magic Number.
4. **Einmalig je Turn, nicht kumulativ.** Zwei Turns duerfen sich nicht zu einer unbegrenzten
   Frist aufaddieren.
5. **Der absolute Max-Dauer-Cap bleibt unberuehrt.** Er ist der letzte Rueckhalt, falls die
   Schaetzung versagt.
6. **Die Logzeile muss den neuen Zustand sichtbar machen.** Wenn der Waechter feuert, muss
   erkennbar sein, ob eine Sprech-Verlaengerung aktiv war und wie lang sie war. Ursachen-Codes
   und Zahlen, **kein PII**, Muster `bd8610c`.
7. Kommentare auf Deutsch ohne Umlaute, wie im Bestand. Gesprochene Strings behalten korrekte
   Umlaute.

## 5. Pre-Mortem

Angenommen, dieser Fix hat in einem Jahr Schaden angerichtet — was ist passiert?

- **Die Schaetzung war viel zu lang** (Telnyx' eigene Stimme spricht schneller als die
  ElevenLabs-Kalibrierung, fuer die die 65 ms/Zeichen gemessen wurden — **das ist unverifiziert
  und das groesste bekannte Risiko dieser Phase**). Eine tote Leitung laeuft dann laenger als
  noetig und verbrennt Carrier-Minuten. *Gegenmittel:* die Obergrenze aus Auflage 3 plus der
  unberuehrte Max-Dauer-Cap. Der Schaden ist dadurch nach oben beschraenkt und deutlich
  kleiner als der heutige Schaden (gekappte echte Gespraeche).
- **Die Schaetzung war zu kurz** — dann kappt es weiterhin, nur spaeter. Das ist nicht
  schlechter als der Status quo, also kein Regressionsrisiko.
- **Die Verlaengerung addierte sich auf** und der Waechter feuerte nie wieder. *Gegenmittel:*
  Auflage 4 plus ein Test, der genau das ausschliesst.
- **Der Waechter wurde faktisch abgeschaltet**, weil die Verlaengerung immer griff. *Gegenmittel:*
  der Rueckversicherungs-Test aus Abschnitt 6.

## 6. Verifikation (Pflicht, deterministisch)

Neue Tests in `test/telnyx-stab-p9-watchdog.test.js` (dort liegt die Watchdog-Abdeckung,
T1-T11; T10 ist das Vorbild fuer die Suspendierung):

1. **Der Defektfall, ohne den Fix rot:** ein Turn mit einer langen Antwort (ueber der
   45-s-Sprechdauer), danach kein weiterer Anrufer-Turn -> der Waechter darf **waehrend** der
   geschaetzten Sprechdauer NICHT beenden.
2. **Die Rueckversicherung, die den Schutz pinnt:** nach Ablauf der geschaetzten Sprechdauer
   plus `TELNYX_DEAD_AIR_TIMEOUT_S` ohne jede Aktivitaet -> der Waechter beendet **doch**.
   Ohne diesen Test waere der Fix eine getarnte Abschaltung.
3. **Kein kumulatives Aufaddieren** ueber mehrere Turns (Auflage 4).
4. **Kurze Antworten unveraendert:** ein normaler kurzer Turn verhaelt sich byte-identisch zum
   Bestand — die Verlaengerung darf dort nichts verschieben.

**Bestandstest T3 pinnt das heutige, defekte Verhalten als gewollt.** Er muss angepasst
werden. Die Anpassung ist im Report ausdruecklich zu begruenden und der alte Erwartungswert zu
nennen — ein stillschweigend umgeschriebener Bestandstest ist ein Merge-Blocker.

Ausserdem: `npm test` vollstaendig gruen (Bestand 4138/4138), `node --check` auf jede
geaenderte Datei.

## 7. Abnahmekriterium

Ein Anruf, in dem der Agent laenger als 45 Sekunden am Stueck spricht, laeuft weiter.
Nachweis nach dem Deploy: Testanruf mit Zaehl-Auftrag wie `call_msn34lpf77wg`; die Dauer
`answered_at -> ended_at` muss deutlich ueber 86 s liegen und es darf keine
`[telnyx-watchdog] dead_air`-Zeile erscheinen, solange der Agent spricht.
