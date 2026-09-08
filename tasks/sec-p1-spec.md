# SEC-P1 — Ergaenzung zum Phasenabschnitt in PLAN-SEC-FIX.md

ERGAENZT `PLAN-SEC-FIX.md` -> "SEC-P1 — Webhook-Idempotenz". Ersetzt ihn nicht; bei
Widerspruch gilt der Abschnitt. Diese Datei fuellt vier Luecken, die der Abschnitt offen
laesst und die man sonst raten muesste.

## Pre-Mortem (Pflicht nach CLAUDE.md) — die fuenf Arten, wie dieser Fix Schaden anrichtet

Ein Jahr spaeter, der Fix war falsch. Was ist passiert?

1. **Der Schluessel war zu grob.** Auf `/voice/turn` wurde z.B. nur die Call-Kennung als
   Anker benutzt. Damit ist die ZWEITE Gespraechsrunde desselben echten Anrufs ein
   "Duplikat" — der Agent verstummt nach dem ersten Satz. Das ist der teuerste Ausgang: er
   macht das Produkt kaputt, nicht nur die Sicherheit. **Der Anker muss das EREIGNIS
   identifizieren, nicht den ANRUF.**
2. **Die Wiederholung wurde verschluckt statt beantwortet.** Ein Anbieter-Retry kommt fast
   immer daher, dass unsere erste ANTWORT verloren ging — der Anbieter hat sie nie gesehen.
   Wer auf die Wiederholung ein leeres/anderes 200 zurueckgibt, laesst einen ECHTEN Anruf
   ohne Anweisung zurueck; er stirbt still und sieht wie ein Carrier-Problem aus (dieses
   Repo hat dazu Historie: `assistant-dead-call-rca`). Idempotenz heisst hier: **dieselbe
   Antwort noch einmal ausliefern, nicht die Anfrage wegwerfen.** Wenn der Plan davon
   abweichen will, muss er begruenden, warum der Anrufer trotzdem weiterspricht.
3. **Nur im Speicher verankert.** Ein Neustart oeffnet das Loch wieder. Der Abschnitt sagt
   das bereits — hier steht es, weil es zusammen mit 4. eine Bauart-Entscheidung erzwingt.
4. **Pruefen-dann-schreiben statt atomar beanspruchen.** Zwei gleichzeitig zugestellte
   Kopien laufen beide durch die Pruefung, bevor eine schreibt. Der Test misst sequenziell
   und wird gruen, die Produktion bucht weiter doppelt. Der Anspruch auf einen Schluessel
   muss ein atomarer Schritt sein (im pg-Backend das naheliegende `ON CONFLICT`), nicht
   zwei.
5. **Der Schluesselspeicher waechst unbegrenzt.** Es braucht eine benannte Vorhaltezeit und
   den Weg, wie alte Schluessel verschwinden. Der Abschnitt verlangt die Entscheidung
   ohnehin fuer `PLAN-SECURITY.md` — sie gehoert in den Plan, nicht in ein spaeteres
   Aufraeumen.

## Was der Plan zusaetzlich beantworten muss

- **Woraus genau wird der Anker gebildet?** Der Abschnitt sagt: aus dem Anbieter-Ereignis,
  nicht aus unserer Uhr. Gibt es fuer `/voice/turn` kein anbieterseitig eindeutiges
  Ereignis-Merkmal, ist das im Plan ausdruecklich festzuhalten und die gewaehlte Ersatzform
  zu begruenden — inklusive der Frage, ob sie bei einem echten Retry STABIL bleibt (ein
  Merkmal, das sich beim Retry aendert, taugt nicht; eines, das sich zwischen zwei echten
  Runden NICHT aendert, taugt ebenso wenig, s. Pre-Mortem 1).
- **Beide Store-Backends.** Der Anker muss in `json` und in `pg` funktionieren. Im
  pg-Backend gilt: DDL laeuft beim Boot automatisch mit (`no-automatic-db-migration`), ein
  Backfill NICHT. Neue Spalten/Tabellen additiv und nullable.
- **Keine neue Bauart, wenn eine im Haus liegt.** Der Abschnitt nennt zwei Vorbilder
  (`billedAt` und die Stripe-`event.id`-Abwehr). Eine dritte Bauart braucht eine
  Begruendung im Plan.

## Abgrenzung, hart

- `/voice/status` ist bereits durch `billedAt` gedeckt und wird NICHT umgebaut.
- Keine Aenderung an Denylist, Land-Gate, Stundenlimit, Kostendecke, `OUTBOUND_FROZEN`,
  Signaturpruefung oder am Offenlegungssatz. Diese Phase fuegt einen Anker HINZU, sie
  fasst kein bestehendes Gate an.
- Jede neue Env-Variable wird neutral in `BASE_ENV` (`test/helpers.js`) gepinnt — sonst
  leakt die echte `.env` in jeden Spawn-Test (Lehre `test-base-env-drift`).

## Zusaetzliche Pflicht-Testfaelle (ueber die Abnahme des Abschnitts hinaus)

Die Abnahme des Abschnitts deckt "zweimal dasselbe Ereignis". Diese drei kommen dazu, weil
sie die Pre-Mortem-Faelle 1 und 2 fangen:

1. **Mehrere ECHTE Runden desselben Anrufs.** Zwei bis drei aufeinanderfolgende, inhaltlich
   verschiedene `/voice/turn`-Requests desselben Anrufs werden ALLE normal verarbeitet
   (Transkript waechst je Runde). Ohne diesen Fall ist ein zu grober Anker gruen.
2. **Die Wiederholung liefert dieselbe Antwort.** Bei `/voice/incoming` ist der Antwortkoerper
   der zweiten Zustellung gleichwertig zum ersten (der Anruf bekommt weiter Anweisungen),
   nicht leer.
3. **Zwei Anrufe, gleicher Zeitpunkt.** Zwei VERSCHIEDENE Anrufe duerfen sich nicht
   gegenseitig als Duplikat ausschliessen.

## Ausgangsmessung (aus dem Abschnitt, hier zur Bequemlichkeit)

`/voice/incoming` zweimal -> 2 Anruf-Datensaetze statt 1.
`/voice/turn` zweimal -> Token 4.000.000/1.000.000 -> 8.000.000/2.000.000, gebucht
828 -> 1656 Cent, Transkript 2 -> 4 Zeilen.
`/voice/status` zweimal -> unveraendert (bereits gedeckt).
