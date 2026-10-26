# P-010 Kürzen an der Wortgrenze behält das letzte ganze Wort

Status: freigegeben
Planung freigegeben: 100000000 Token
Issue: 2019
Design Doc: nein, weil es mit einer Zeile in der vorhandenen Hilfe `clampAtWordBoundary` nur einen ernsthaften Weg gibt, weder Werkzeugvertrag noch gespeicherte Daten berührt werden und ein Code-Rollback alles zurücknimmt.

## Absicht
Wenn Hermes einen Text an der Wortgrenze kürzt und genau hinter der Grenze ein Leerzeichen steht, soll das vollständige letzte Wort erhalten bleiben, damit der Agent dem Angerufenen in dieser Lage nicht das Gegenteil sagt, etwa „erreichbar“ statt „nicht erreichbar“. Nicht gewollt ist, Satzzeichen hinter der Grenze als Wortende zu werten, eine Grenze zu ändern, eine zweite Kürzungshilfe neben `clampAtWordBoundary` zu bauen, bestehende Tests umzuschreiben oder den Offenlegungssatz zu berühren. Im Zweifel gilt: das Ergebnis ist nie länger als die Grenze und nie kürzer als heute, und der Offenlegungssatz bleibt byte-gleich der erste Satz.

## Problem
Ein Kunde lässt Hermes eine Arztpraxis anrufen (ElevenLabs-Outbound, Recherche an). Der Angerufene fragt nach dem Brückentag, der Agent schlägt über `look_up` nach, und die Suche liefert „Praxis Dr. Hoffmann: Im November 2026 gilt ein neuer Plan: …, und telefonisch erreichbar ist die Praxis am Brueckentag nicht mehr, auch nicht per Mail.“ (227 Zeichen). Hermes kürzt jeden Fakt auf 200 Zeichen; das 200. Zeichen ist das „t“ von „nicht“, dahinter steht ein Leerzeichen. Heute gibt Hermes dem Agenten „… und telefonisch erreichbar ist die Praxis am Brueckentag“ zurück, und der Agent sagt dem Angerufenen, die Praxis sei am Brückentag erreichbar. Dasselbe passiert im Eröffnungssatz auf dem Telnyx-Pfad: Aus dem Ziel „… denn der Samstag passt mir nicht mehr, Montag geht“ wird „… denn der Samstag passt mir.“

## Ergebnis
Nach dieser Änderung behält jede Kürzung an der Wortgrenze das letzte Wort, wenn das Zeichen direkt hinter der Grenze ein Leerzeichen ist: Der Recherche-Fakt endet bei 200 Zeichen auf „… am Brueckentag nicht“ statt auf „… am Brueckentag“ (194 Zeichen), der Eröffnungssatz auf „… passt mir nicht.“ statt auf „… passt mir.“; steht hinter der Grenze kein Leerzeichen, wird wie heute am letzten Leerzeichen davor gekürzt.

## Grobe Lösung
Der Angerufene bemerkt nur, dass der Agent an der Grenze kein vollständiges letztes Wort mehr weglässt, wenn genau dahinter ein Leerzeichen steht. Die Änderung erhält nur ganze Wörter; ob der gekürzte Text noch dasselbe sagt, prüft sie nicht. Alle Stellen, die einen Text an der Wortgrenze kürzen, nutzen dieselbe vorhandene Hilfe: der Recherche-Fakt (200 Zeichen), die Recherche-Anfrage (120), die Rückfrage an den Besitzer (200), das Denk-Signal (120), das Ziel im Eröffnungssatz auf dem Telnyx-Pfad (75) und das Gesprächsgedächtnis (Grenze minus 1 plus „…“). Die Hilfe schaut künftig auch auf das eine Zeichen direkt hinter der Grenze: Ist es ein Leerzeichen, endet das Wort davor genau an der Grenze und bleibt stehen. Sonst bleibt alles wie heute: Text, der passt, kommt unverändert zurück; sonst wird vor dem letzten Leerzeichen innerhalb der Grenze gekürzt; ohne Leerzeichen wird hart an der Grenze geschnitten. Das Ergebnis ist immer ein Anfang des Textes, nie länger als die Grenze und mindestens so lang wie heute. Im Eröffnungssatz ändert sich nur das Ziel hinter dem Offenlegungssatz.

## Fallen
- Die Hilfe sucht nur das Leerzeichen `" "`, nicht Tabs oder Zeilenumbrüche: So bleibt es; als Wortende zählt hinter der Grenze nur `" "`, auch beim Denk-Signal, das seinen Text nicht vorher faltet.
- Satzzeichen hinter der Grenze („nicht, auch“, „12,50 €“, „14.30 Uhr“): bewusst nicht behandelt, weil Komma und Punkt auch in Zahlen stehen und ein Schnitt dort „12“ oder „14“ stehen ließe; dort gilt der heutige Schnitt am letzten Leerzeichen (Runde 1, Frage 1).
- Die Hilfe hat 6 Aufrufstellen in 5 Dateien (`src/claude.js:248`, `src/thinking-signal.js:10`, `src/call-memory.js:21`, `src/research/lookup-guard.js:35` und `:45`, `src/consult/question.js:16`): Geändert wird nur die Hilfe selbst in `src/utils/text.js`; kein Aufrufer, keine Grenze, kein Name und kein Export ändert sich, und es entsteht keine zweite Kürzungshilfe.
- Das Gedächtnis ruft die Hilfe mit Grenze minus 1 auf und hängt „…“ an (`src/call-memory.js:19-22`): Behält die Hilfe jetzt ein Wort, ist die Angabe mit „…“ genau so lang wie ihre Grenze; die Grenzen 100, 200 und 600 Zeichen halten weiter.
- Ein ganzes Wort mehr in jeder gekürzten Ausgabe: Die Änderung behält höchstens ein ganzes Wort mehr; die Sicherheitsprüfung hat jeden Aufrufer geprüft, das Ergebnis liegt bei der Betreuung. (Runde 1, Frage 6; Runde 2, Frage 3).
- Die Hilfe behält das Wort vor der Grenze, ohne seine Bedeutung zu prüfen: Eine Verneinung, die erst mit dem nächsten Wort ihren Sinn hat, kann allein stehen bleiben („nicht nur vormittags“ → „… nicht“, „kein Problem“ → „… kein.“), wo heute ein neutrales Bruchstück steht (PM2). Das wird hingenommen; es gibt keine Prüfung der Bedeutung und keine Liste von Wörtern (Runde 2, Frage 2).
- Der Offenlegungssatz steht im Eröffnungssatz vor dem Ziel und wird nicht gekürzt (`src/claude.js:224-233`): Die Änderung betrifft nur das gekürzte Ziel dahinter (höchstens ein ganzes Wort mehr); Wortlaut, Reihenfolge und Vorhandensein des Offenlegungssatzes bleiben byte-gleich (B1).
- Bestehende Tests, die die Hilfe über ihre Aufrufer erreichen (~99 Testdateien), bleiben unverändert grün und werden nicht umgeschrieben.

## Geänderte Dateien
- `src/utils/text.js`
- `test/anrufe/wortgrenze-letztes-wort.test.js`

## Altfunktionen
- nicht berührt: `src/research/lookup-guard.js:lookupFactsFrom`, weil sie die Hilfe unverändert mit 200 aufruft und die Änderung nur in `src/utils/text.js:clampAtWordBoundary` liegt
- nicht berührt: `src/research/lookup-guard.js:anonym ab Zeile 42`, weil sie Teil von `lookupFactsFrom` ist, unverändert bleibt und die Änderung nur in `src/utils/text.js:clampAtWordBoundary` liegt
- nicht berührt: `src/research/adapters/exa-search.js:factLineOf`, weil sie Titel und Auszug unverändert zum Fakt verbindet und die Änderung nur in `src/utils/text.js:clampAtWordBoundary` liegt
- nicht berührt: `src/routes/voice.js:makeVoiceRoutes`, weil die Route `POST /voice/outbound` den Eröffnungstext unverändert sendet und die Änderung nur in `src/utils/text.js:clampAtWordBoundary` liegt
- nicht berührt: `src/claude.js:callMemorySection`, weil sie die fertigen Gedächtniszeilen unverändert übernimmt und die Änderung nur in `src/utils/text.js:clampAtWordBoundary` liegt
- nicht berührt: `src/claude.js:agentTurn`, weil er das Denk-Signal unverändert aufruft und die Änderung nur in `src/utils/text.js:clampAtWordBoundary` liegt
- nicht berührt: `src/mcp-tools.js:registerTools`, weil die Werkzeuge `prepare_call` und `place_call` unverändert bleiben und die Änderung nur in `src/utils/text.js:clampAtWordBoundary` liegt
- nicht berührt: `src/mcp-tools.js:anonym ab Zeile 916`, weil sie Teil von `registerTools` ist, unverändert bleibt und die Änderung nur in `src/utils/text.js:clampAtWordBoundary` liegt
- nicht berührt: `src/routes/api-read.js:anonym ab Zeile 51`, weil die Anrufansicht unverändert bleibt und die Änderung nur in `src/utils/text.js:clampAtWordBoundary` liegt
- nicht berührt: `src/store/state-ops.js:emitConsult`, weil sie die Rückfrage unverändert speichert und die Änderung nur in `src/utils/text.js:clampAtWordBoundary` liegt
- nicht berührt: `src/store/state-ops.js:addLookupFacts`, weil sie die Fakten unverändert speichert und die Änderung nur in `src/utils/text.js:clampAtWordBoundary` liegt
- nicht berührt: `src/utils/text.js:comparableWords`, weil sie unverändert bleibt und die Änderung nur in `clampAtWordBoundary` (`src/utils/text.js:1-6`) derselben Datei liegt

## Anforderungen

### Regel R1: Steht direkt hinter der Grenze ein Leerzeichen, bleibt das Wort davor bei der Kürzung an der Wortgrenze erhalten.

#### Szenario S1: Recherche-Fakt behält das letzte Wort vor einem Leerzeichen an Stelle 200
Gegeben ein Outbound-Anruf über den ElevenLabs-Pfad mit eingeschalteter Recherche, und die Suche (Exa) liefert einen Treffer mit dem Titel „Praxis Dr. Hoffmann“ und dem Auszug „Im November 2026 gilt ein neuer Plan: Sprechstunde nur vormittags, Rezepte nur nach Vorbestellung, Befunde per Post, und telefonisch erreichbar ist die Praxis am Brueckentag nicht mehr, auch nicht per Mail.“ (Fakt 227 Zeichen, an Stelle 200 ein Leerzeichen)
Wenn der Agent `POST /webhooks/elevenlabs/lookup` mit einer Anfrage zu diesem Anruf aufruft
Dann hat die Antwort den Status `ok`, und ihre `answer` endet mit „und telefonisch erreichbar ist die Praxis am Brueckentag nicht“ (Fakt 200 Zeichen)

#### Szenario S2: Ziel im Eröffnungssatz behält das letzte Wort vor einem Leerzeichen an Stelle 75
Gegeben ein Konto mit hinterlegtem Besitzernamen, der Telnyx-Pfad (ElevenLabs-Outbound aus) und ein Anruf an eine fremde Nummer über `place_call` mit dem Ziel „Bitte den Termin beim Friseur verschieben, denn der Samstag passt mir nicht mehr, Montag geht“ (an Stelle 75 ein Leerzeichen)
Wenn Telnyx `POST /voice/outbound` für diesen Anruf meldet
Dann endet der Eröffnungstext in der Antwort mit „Es geht um Folgendes: Bitte den Termin beim Friseur verschieben, denn der Samstag passt mir nicht.“

## Bleibt unverändert

### Szenario B1: Der Offenlegungssatz bleibt byte-gleich der erste Satz der Eröffnung
Gegeben derselbe Anruf wie in S2 (Konto mit hinterlegtem Besitzernamen, Telnyx-Pfad, fremde Nummer, Ziel mit Leerzeichen an Stelle 75)
Wenn Telnyx `POST /voice/outbound` für diesen Anruf meldet
Dann beginnt der Eröffnungstext in der Antwort byte-gleich mit dem Offenlegungssatz aus `LOCALES.de.disclosure` für diesen Besitzernamen („Guten Tag, hier spricht ein KI-Assistent im Auftrag von <Besitzername>. Das Gespräch wird für meinen Auftraggeber zusammengefasst.“), gefolgt von genau einem Leerzeichen und „Es geht um Folgendes: “

### Szenario B2: Steht hinter der Grenze ein Buchstabe, wird wie heute am letzten Leerzeichen gekürzt
Gegeben ein Outbound-Anruf über den ElevenLabs-Pfad mit eingeschalteter Recherche, und die Suche (Exa) liefert einen Treffer mit dem Titel „Praxis Dr. Hoffmann“ und dem Auszug „Im November 2026 gilt ein neuer Plan: Sprechstunde nur vormittags, Rezepte nur nach Vorbestellung, Befunde per Post, und telefonisch erreichbar ist die Praxis am Brueckentag niemals mehr, auch nicht per Mail.“ (an Stelle 200 der Buchstabe „l“)
Wenn der Agent `POST /webhooks/elevenlabs/lookup` mit einer Anfrage zu diesem Anruf aufruft
Dann hat die Antwort den Status `ok`, ihre `answer` endet mit „und telefonisch erreichbar ist die Praxis am Brueckentag“ (Fakt 194 Zeichen) und enthält nicht „niema“

### Szenario B3: Endet ein Wort genau an der Grenze, aber erst eine Stelle dahinter steht ein Leerzeichen, wird wie heute am letzten Leerzeichen davor gekürzt
Gegeben ein Outbound-Anruf über den ElevenLabs-Pfad mit eingeschalteter Recherche, und die Suche (Exa) liefert einen Treffer mit dem Titel „Praxis Dr. Hoffmann“ und dem Auszug „Im November 2026 gilt ein neuer Plan: Sprechstunde nur vormittags, Rezepte nur nach Vorbestellung, Befunde per Post, und telefonisch erreichbar ist die Praxis am Brueckentag nichts mehr, auch nicht per Mail.“ (an Stelle 200 das „s“ von „nichts“, an Stelle 201 ein Leerzeichen)
Wenn der Agent `POST /webhooks/elevenlabs/lookup` mit einer Anfrage zu diesem Anruf aufruft
Dann hat die Antwort den Status `ok`, ihre `answer` endet mit „und telefonisch erreichbar ist die Praxis am Brueckentag“ (Fakt 194 Zeichen) und enthält nicht „nichts“

## Nicht-Ziele
- Nicht Teil dieser Änderung: Satzzeichen hinter der Grenze als Wortende zu werten („Brueckentag nicht, auch“ bleibt bei „Brueckentag“), weil Komma und Punkt auch in Zahlen stehen („12,50 €“, „3.000“, „14.30 Uhr“) und ein Schnitt dort einen falschen Wert stehen ließe (Runde 1, Frage 1).
- Nicht Teil dieser Änderung: eine Verneinung zu erhalten, wenn die Grenze innerhalb des verneinenden Wortes oder auf dem Leerzeichen davor liegt (B2: „Brueckentag niemals“ bleibt bei „Brueckentag“), weil die Änderung nur die Lage schließt, in der das letzte Wort genau an der Grenze endet (PM1, Runde 2, Frage 1).
- Nicht Teil dieser Änderung: die Bedeutung des behaltenen Wortes zu prüfen (etwa „nicht“ oder „kein“ vor „nur“ oder „Problem“), weil die Hilfe Bedeutung nicht beurteilen kann; diese Fälle sind bewusst gegen die Fälle aus dem Problem abgewogen (PM2, Runde 2, Frage 2).
- Nicht Teil dieser Änderung: eigene Szenarien für Rückfrage an den Besitzer, Recherche-Anfrage, Denk-Signal und Gesprächsgedächtnis, weil sie dieselbe Hilfe unverändert aufrufen (Runde 1, Frage 6).
- Nicht Teil dieser Änderung: die Grenzen 75, 120, 200 und die des Gedächtnisses zu ändern.
- Nicht Teil dieser Änderung: andere Leerzeichen als `" "` (Tab, Zeilenumbruch, geschütztes Leerzeichen) als Wortende zu werten.
- Nicht Teil dieser Änderung: andere Kürzungen, die die Hilfe nicht nutzen.

## Neue Begriffe
keine

## Offene Fragen

### Vor dem Bau zu klären
keine

### Kann warten
- Soll ein Satzzeichen hinter der Grenze, dem ein Leerzeichen folgt („nicht, auch“), als Wortende gelten, wenn davor keine Ziffer steht?

## Premortem
| Nr. | Grund | Ausgang |
|---|---|---|
| PM1 | Weil R1 nur greift, wenn genau hinter der Grenze ein Leerzeichen steht, passiert bei einer Grenze im Wort „nicht“ oder auf dem Leerzeichen davor, dass „nicht“ weiter wegfällt, und die Folge ist, dass der Agent dem Angerufenen in diesen Lagen wie heute das Gegenteil sagt. | Nicht-Ziel |
| PM2 | Weil die Hilfe das Wort vor der Grenze ohne Blick auf seine Bedeutung behält, passiert bei „nicht nur“ oder „kein Problem“ an der Grenze, dass die Verneinung allein stehen bleibt („… nicht“, „… kein.“), und die Folge ist eine neue Umkehrung des Sinns, wo heute ein neutrales Bruchstück steht. | Nicht-Ziel |
| PM3 | Weil jede gekürzte Ausgabe künftig ein ganzes Wort mehr enthalten kann, passiert bei einer Ausgabe, die an Dritte weitergeht, dass dieses Wort mit hinausgeht, und die Folge ist, dass dort etwas mehr vom Gesagten sichtbar ist als heute. | hingenommen: Die Änderung behält höchstens ein ganzes Wort mehr; die Sicherheitsprüfung hat jeden Aufrufer geprüft, das Ergebnis liegt bei der Betreuung. |
