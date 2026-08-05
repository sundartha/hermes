# GQ-P13 — keine „die Antwort ist DA"-Anweisung ohne Antwort

## Warum (am Code belegt, Fragilitaets-Analyse F2)

`mergeContextFacts` (`src/store/state-ops.js:721-731`) hat einen Deckel-Kurzschluss:

```js
const room = KEY_FACTS_LIMITS.maxItems - existing.length;
if (room <= 0) return 0;
```

Ist `call.context.key_facts` voll, werden **0** Fakten uebernommen. `answerConsult`
(`state-ops.js:766-770`) kennt diesen Wert in derselben Zeile und setzt den Status
**trotzdem** unbedingt auf `ANSWERED`.

Von dort laeuft die Kette ohne eine einzige Fakten-Pruefung weiter:
`consultAnswerAwaitingDelivery` (`:836-844`, prueft nur `status` und `deliveredAt`) ->
`advanceInCallConsult` (`:~890`, liefert `CONSULT_WAIT.ANSWERED`) -> `consultTurnMarker`
(`src/claude.js:823-828`) -> Steuertext im naechsten Turn.

Der Text ist zwingend formuliert (`src/i18n/prompts/de.js:260-263`):

> „[Die Antwort auf deine Rückfrage ist DA … Nenne sie JETZT in deiner nächsten Äußerung …
> Frage NICHT erneut nach, kündige KEINEN Rückruf an und nimm dafür KEINE Nachricht auf —
> du hast die Auskunft bereits.]"

**Der Agent wird angewiesen, einer echten Person am Telefon eine Auskunft zu nennen, die er
nicht hat, und ihm wird gleichzeitig jeder ehrliche Ausweg verboten.** Das ist eine
Einladung zur erfundenen Antwort.

`mergedFacts` verlaesst `answerConsult` nur nach **oben** zum HTTP-/MCP-Aufrufer
(`src/routes/api-calls.js:356-368`, `src/mcp-tools.js:738-741`) — nie seitwaerts zu dem
Praedikat, das ueber den Prompt-Hinweis entscheidet. `grep -rn "answeredFacts" src/` findet
ausserhalb des Schreibers **keinen** Produktions-Leser.

Verschaerfend: der Schaden ist unumkehrbar. `markConsultAnswerDelivered` (`:853`) setzt den
Einmal-Riegel `deliveredAt` unabhaengig von `mergedFacts`; danach blockiert der GQ-P7-Riegel
jeden weiteren Anstoss.

## Aenderung

`consultAnswerAwaitingDelivery` (`src/store/state-ops.js:836-844`) verlangt zusaetzlich, dass
die Antwort tatsaechlich Fakten gebracht hat:

```
status === ANSWERED  UND  !deliveredAt  UND  answeredFacts > 0
```

Eine Bedingung, ein Praedikat, **kein neuer Zustand**.

**Wichtig — dieses Praedikat traegt ZWEI Mechanismen** (das ist Absicht, GQ-P8 hat sie
bewusst auf einen Zustand gelegt): den Steuertext (`CONSULT_WAIT.ANSWERED`) **und** das
Zustellfenster des GQ-P7-Riegels. Beide Aufrufer sind zu pruefen und beide sollen sich
gleich verhalten: **eine Antwort ohne neue Fakten oeffnet weder ein Fenster noch loest sie
den Marker aus.** Es gibt nichts zu sagen, also auch keinen Anlass, dafuer einen Turn zu
oeffnen.

Verhalten im Nullfall danach: wie vor GQ-P8 — der Turn traegt fuer diesen Consult keinen
Steuertext. Der Consult bleibt `ANSWERED` ohne `deliveredAt`; das erzeugt keine Schleife,
weil dasselbe Praedikat weiterhin `false` liefert.

## Was diese Phase NICHT tut

- **`KEY_FACTS_LIMITS.maxItems` wird nicht angefasst.** Der Deckel ist ein bewusst geteiltes
  Limit (Kommentar `state-ops.js:715-720`); ihn zu aendern ist eine andere Entscheidung mit
  anderer Begruendung.
- **Kein neuer Prompt-Text, keine neue Sprache.** Ein eigener ehrlicher Marker
  („Antwort kam an, brachte aber nichts Neues") waere die groessere Loesung — er braucht drei
  Sprachen und eine eigene Messung und ist **ausdruecklich nicht Teil dieser Phase**.
- **`answerConsult` bleibt unveraendert** — der Consult gilt weiterhin als beantwortet. Was
  sich aendert, ist allein, ob daraus eine Sprech-Anweisung wird.
- `mergeContextFacts` bleibt unveraendert.

## Verifikation — deterministisch

`npm test` gruen (Basis 3959). Neue Tests, offline:

1. Consult `ANSWERED` mit `answeredFacts > 0`, kein `deliveredAt` -> `true` (Bestand bleibt).
2. Consult `ANSWERED` mit `answeredFacts === 0` -> **`false`** (das ist der Kern).
3. `advanceInCallConsult` liefert im Fall 2 **nicht** `CONSULT_WAIT.ANSWERED`.
4. Das Zustellfenster oeffnet im Fall 2 nicht (zweiter Aufrufer desselben Praedikats).
5. Bestehender Test `AL-P13-10` pinnt heute ausdruecklich das **Gegenteil**
   („Consult gilt trotzdem als beantwortet"). Er ist zu pruefen: pinnt er `answerConsult`
   (dann bleibt er unveraendert richtig) oder die Ableitung daraus (dann pinnt er einen
   falschen Sollzustand und ist mit Begruendung anzupassen)? **Das gehoert in den Report,
   nicht still geloest.**

**Live-Zahl:** Anteil der In-Call-Consults mit `answeredFacts === 0`, die den
`consultAnswered`-Marker ausloesen. Heute konstruierbar > 0, nach der Phase **0**.

## Absolute Regeln

Keine Safety-Gate-Kette, keine Auth, keine Kosten. Beruehrt den Gespraechspfad: der
Offenlegungssatz und die Persona bleiben unangetastet.
