# GQ-B2-Spec: Drei-Klassen-Briefing + Consult-Antwort bei abwesendem Owner

Owner-entschieden 2026-08-19 (Diskussion nach GQ-B1-Merge). Bindende Praemisse:
**Der Owner ist waehrend des Anrufs ABWESEND - das ist der Normalfall.** get_consult ist
wertvoll, weil der auftraggebende Assistent EIGENE Quellen hat (Kalender, Mail,
Chat-Kontext, Dateien), nicht weil er den Menschen live durchreichen kann.

GQ-B1 (gemergt, `cdddf09`) hat die Vorab-Vertroestung PAUSCHAL verboten. Das ueberschiesst:
Wissensluecken zerfallen in drei Klassen, und fuer Klasse 2 ist die ehrliche Ansage vorab
die RICHTIGE Loesung (der eine gedeckelte Consult pro Anruf darf nicht auf eine Frage
verbrannt werden, die auch der Assistent nicht beantworten kann).

## Aenderung 1 - briefing-Feldbeschreibung (src/mcp-tools.js)

Die absolute Klausel ("never write that the principal will get back to the other party -
do not pre-empt that answer here, so such a line removes an answer instead of adding one.
Leave the gap open.") wird ersetzt durch die Drei-Klassen-Selbsteinschaetzung. Der Satz
"Write only what you KNOW: never script an answer for a detail you are missing" BLEIBT
(er ist weiterhin wahr). Neuer Text sinngemaess (Implementierer formuliert englisch,
knapp, im Stil der Bestandsbeschreibungen):

Fuer jede absehbare Frage des Angerufenen, die du JETZT nicht beantworten kannst, pruefe:
- Koenntest DU sie waehrend des Anrufs aus deinen eigenen Werkzeugen/deinem Kontext
  beantworten (Kalender, Mail, Dateien, dieser Chat)? Dann lass die Luecke OFFEN und
  deklariere das in EINER kurzen Zeile im Briefing (z.B. "Questions about the calendar
  I can answer during the call.").
- Kann sie nur der Owner selbst wissen? Dann schreib die ehrliche Prozess-Auskunft, dass
  der Owner sich dazu direkt meldet - das ist KEINE erfundene Antwort, sondern wahr,
  und erspart dem Agenten einen nutzlosen Consult.
- Ist sie oeffentlich pruefbar? Dann schreib NICHTS dazu - der Agent kann selbst
  nachschlagen.

## Aenderung 2 - MCP_CONSULT_INSTRUCTIONS (src/mcp-server-info.js)

Der Satz "if you do not know an answer, ask the user first rather than inventing one"
und der Schluss "if you have to ask the user, do it in the same turn" setzen Anwesenheit
voraus. Neu, sinngemaess: Antworte ZUERST aus deinen eigenen Werkzeugen und deinem
Kontext. Den User fragst du nur, wenn er JETZT tatsaechlich anwesend ist. Erfinde nie
etwas - und wenn du die Antwort nicht binnen Sekunden findest, antworte per
answer_consult AUSDRUECKLICH, dass du es nicht weisst, statt zu warten: der Agent kann
dann im Gespraech sauber ausrichten, dass der Owner sich meldet. Der Frist-Satz (ohne
Sekundenzahl) bleibt inhaltlich erhalten.

## Nicht anfassen

Nur Stringliterale + Tests. KEINE Gate-Logik, KEIN neues Schema-Feld, KEINE Aenderung
an elevenlabs/agent_configs/outbound-agent.template.json (Anrufverhalten, braucht
Testanrufe - das strukturelle consult_scope-Feld ist eine SPAETERE Phase), keine
Laufzeitpfade. PLACE_CALL_CONSULT_LOOP (mcp-tools.js:456) bleibt unveraendert, er ist
mit der Praemisse vertraeglich.

## Tests

- test/gq-b1-briefing-openness.test.js: die Pins auf das Pauschal-Verbot werden BEWUSST
  auf die Drei-Klassen-Regel umgestellt (das ist eine gewollte Owner-Revision, keine
  Drift). Insbesondere: der Test, der "never write that the principal will get back"
  pinnt, prueft neu, dass BEIDE Klassen-Zweige in der Beschreibung stehen (offen lassen
  + deklarieren UND ehrliche Ansage fuer Nur-Owner-Wissen).
- Der byte-identische-Prefix-Pin auf MCP_CONSULT_INSTRUCTIONS (GQ-B1-05) wird bewusst
  angepasst: der Pin schuetzte vor versehentlicher Drift, dies ist eine beabsichtigte
  Aenderung. Neuer Pin auf den neuen Wortlaut.
- Die Token-Deckel-Tests (5800 ohne / 6200 mit Kanal) BLEIBEN in Kraft; der neue Text
  muss darunter passen. Reicht es nicht, wird gekuerzt, NICHT der Deckel erhoeht.
- Neue Faelle (Praefix GQ-B2-, KEIN Katalog-Praefix): (01) briefing nennt beide
  Klassen-Zweige; (02) briefing enthaelt das Pauschal-Verbot NICHT mehr; (03)
  MCP_CONSULT_INSTRUCTIONS enthaelt den Eigene-Quellen-zuerst-Weg und den expliziten
  Unbekannt-Ausgang; (04) MCP_CONSULT_INSTRUCTIONS enthaelt KEIN unbedingtes
  "ask the user first" mehr.
- Suite: `LLM_PROVIDER=anthropic npm test` (42 Testdateien binden ANTHROPIC_BASE_URL
  ohne Provider-Pin - ohne den Vorsatz ist der Lauf breit rot, Bestandsdefekt).

## Kontext zum Nachlesen

tasks/gq-chain-state.md (Abschnitte 2026-08-19), tasks/gq-transkript-befunde-2026-08-19.md,
git show cdddf09 (GQ-B1-Merge). Die GQ-B1-Spec/Reports liegen in der Historie unter 886f528.
