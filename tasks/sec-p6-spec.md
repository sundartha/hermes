# SEC-P6 — Ergaenzung zum Phasenabschnitt in PLAN-SEC-FIX.md

ERGAENZT `PLAN-SEC-FIX.md` -> "SEC-P6 — Antwort statt Haenger + drei Struktur-Waechter".
Ersetzt ihn nicht.

## (a) Die Gate-Schleife — die eine Art, wie dieser Fix alles schlimmer macht

Heute gilt: 17 von 17 sterbenden Gate-Datenquellen fuehren zu **null** Wahlversuchen. Das
Sicherheitsversprechen haelt; kaputt ist nur, dass 14 davon gar nicht ANTWORTEN.

**Der Fix darf diese Bilanz unter keinen Umstaenden verschlechtern.** Ein `try/catch`, das den
Fehler abfaengt und die Ausfuehrung WEITERLAUFEN laesst, verwandelt "Gate kaputt -> niemand
wird angerufen" in "Gate kaputt -> es wird gewaehlt". Das waere der Totalschaden dieser Kette:
ein Sicherheitsfix, der die Absolute Regel 1 aushebelt.

Regel deshalb: **ein geworfenes Gate ist eine ABLEHNUNG, nie eine Freigabe.** Der Fehlerpfad
antwortet mit >= 400 und beendet die Verarbeitung. Die Bauart existiert im Haus
(`src/routes/voice.js` hat genau diesen Schutz) — sie wird uebernommen, nicht neu erfunden.

Von den beiden Abnahme-Haelften ist die zweite die wichtigere: **der Dial-Spion bleibt bei 0.**
Sie ist fuer ALLE Fehlerquellen zu belegen, nicht nur fuer eine Stichprobe.

## (b) Die drei Waechter — was sie zerbrechlich machen wuerde

1. **Keine Zeilennummern.** Der Abschnitt nennt zur Orientierung Fundstellen wie
   `api-calls.js:502`. Ein Waechter, der auf `Datei:Zeile` pinnt, ist beim naechsten Refactor
   falsch rot und wird dann abgeschaltet — das verbietet der Clean-Code-Katalog ausdruecklich
   (C2). Gepinnt wird die MENGE (Datei + Symbol), nicht die Position.
2. **Positiv-Kontrolle ist Pflicht, nicht Kuer.** Jeder der drei Waechter braucht den Beleg,
   dass er ueberhaupt anschlagen KANN — sonst sieht "nichts gefunden" genauso aus wie "sucht
   nichts" (Bestandslehre `pruefkommando-ohne-positiv-kontrolle`). Der Abschnitt schreibt sie
   fuer Waechter 1 und 2 vor; Waechter 3 braucht sie genauso.
3. **Waechter 1 darf die Testbank nicht verseuchen.** Die Sonden-Tabelle
   `probe_leak(tenant_id text)` entsteht in einer isolierten Datenbank und verschwindet danach
   wieder — auch wenn der Test scheitert. Eine liegengebliebene Sonde macht spaetere Laeufe
   rot und ist genau die Art Flake, die diese Kette in SEC-P0 bekaempft hat.
4. **Namensfalle:** Testnamen, die mit einer Katalog-Kennung beginnen
   (`DID-`, `E2E-`, `FMT-`, `GAP-`, `LANG-`, `LAW-`, `MCP-`, `ORIG-`, `OUT-`, `PAY-`,
   `PROMPT-`, `UI-`, `VOICE-`, `WEB-`, `WORLD-` je gefolgt von einer Ziffer) oder mit
   `ABNAHME-`, landen automatisch in einer ANDEREN Testbank und laufen in `npm test` nicht mit
   (Bestandslehre `catalog-id-prefix-misroutes-tests`). Ein Waechter, der nicht im
   Regressionslauf faehrt, friert nichts ein. Praefix `SEC-P6-` ist sicher.

## (c) Das Wahl-Skript

`scripts/spike2-anruf.mjs` waehlt direkt beim Anbieter, an Denylist, Land-Gate, Kostendecke,
Stundenlimit und `OUTBOUND_FROZEN' vorbei. Vom Lead nachgesehen: es haengt an KEINEM
npm-Skript, und `.fortschritt.md` fuehrt es als erledigt ("Spike 2 gemessen, der Weg ist jetzt
Produktcode"). Es ist Wegwerf-Code, der committet liegen blieb — **entfernen** ist damit der
richtige Weg, nicht das Nachruesten von Gates.

**Zusaetzlich zu pruefen, weil sonst der Fix Theater waere:** `scripts/spike2-sip.mjs` steht
in `.fortschritt.md` in derselben Hygiene-Zeile. Traegt es denselben Defekt (loest einen
echten Anbieter-Anruf ohne die Gate-Kette aus), gehoert es in denselben Commit — ein Befund,
ein Fix. Traegt es ihn NICHT, bleibt es unberuehrt und der Plan sagt in einem Satz, warum.
Nichts anderes aus `scripts/` wird angefasst.

## Pre-Mortem (Pflicht nach CLAUDE.md)

1. **Der Fehlerpfad waehlt.** Siehe (a) — der einzige Ausgang, der schlimmer ist als der
   heutige Zustand.
2. **Ein Waechter wurde abgeschaltet, weil er staendig falsch rot war.** Zeilennummern,
   fehlende Isolation, Namensfalle — alle drei oben adressiert. Ein Waechter, den man
   abschaltet, ist schlechter als keiner: er hat Vertrauen gekostet und nie geschuetzt.
3. **Der Waechter ist immer gruen, weil er nichts prueft.** Deshalb Positiv-Kontrolle.
4. **Das entfernte Skript fehlt jemandem.** Es haengt an keinem npm-Skript und ist als
   erledigt vermerkt; die Historie behaelt es. Das ist der bewusst akzeptierte Preis.

## Abnahme (aus dem Abschnitt, unveraendert)

1. Wirft eine Gate-Datenquelle -> `/api/calls` antwortet Status >= 400 **und** der Dial-Spion
   bleibt bei 0.
2. Waechter 1 (RLS-Inventar): jede Tabelle mit Spalte `tenant_id` hat FORCE + Policy ODER
   steht mit Begruendung in einer im Test hartkodierten Liste. Positiv-Kontrolle:
   `probe_leak(tenant_id text)` ohne Policy MUSS rot machen.
3. Waechter 2 (Wahlfunktions-Aufrufer): die Menge der Aufrufer je Dial-Weg entspricht der
   Erwartungsliste. Positiv-Kontrolle: ein synthetischer Zusatz macht rot.
4. Waechter 3 (Werkzeugsatz): `toolDefs("de")` liefert exakt
   `["end_call","get_consult","look_up","take_message"]`. Heute gruen — er soll gruen BLEIBEN.
5. `scripts/spike2-anruf.mjs` ist weg (bzw. hinter der vollstaendigen Gate-Kette).
