# Kontingente: gleichzeitige Anrufe bei Telnyx, ElevenLabs und Anthropic

Prüfliste: Kennungen K1 (Telnyx), K2 (ElevenLabs) und K3 (Anthropic) in `docs/betrieb/launch-pruefliste.md`. Die Schwelle je Kennung steht als `PFLICHT` in `scripts/launch-pruefliste.mjs`. Wert ist die Zahl gleichzeitiger Anrufe, die das Konto beim Anbieter nachweislich trägt.

Neben der Zusage des Anbieters vergibt Hermes selbst nur eine begrenzte Zahl von Leitungsplätzen (`src/store/leitungsplaetze.js`): `KAPAZITAET` je Anbieter, davon hält `RESERVE` einen Teil von ausgehenden Anrufen frei, und `BEDARF` sagt, welcher Weg Plätze bei welchen Anbietern belegt. Für Anthropic gibt es dort keinen Platz.

## Symptom

- Anrufe warten auf eine Leitung (Status `queued`) oder werden abgewiesen (Prüfspur `ausgelastet`, Quelle: `src/telephony/outbound-gates.js`).
- Ein Anbieter lehnt Anrufstarts wegen Auslastung ab (Quelle: `startRejectionReason` und `CHANNEL_LIMIT_MARK` in `src/telephony/failure-reason.ts`).
- Die Prüfspur `gleichzeitig_limit` ist etwas anderes: Dort greift die Grenze je Kunde (`AUSGEHEND_JE_KUNDE`), kein Anbieterkontingent.

## Prüfen

1. Belegung gegen Kapazität je Anbieter ansehen: Kennzahlen `hermes.lines.occupied` und `hermes.lines.capacity`, dazu `hermes.queue.length` (Namen in `src/utils/betriebsmessung.js`).
2. Telnyx (K1): im Telnyx-Konto das Limit gleichzeitiger Kanäle ablesen oder schriftlich bestätigen lassen. Anrufe über ElevenLabs belegen auch Telnyx, siehe `BEDARF`.
3. ElevenLabs (K2): im Konto den Tarif und dessen Grenze gleichzeitiger Gespräche ablesen.
4. Anthropic (K3): in der Anthropic-Konsole die Limits für Anfragen und Token je Zeitfenster ablesen. Die Umrechnung auf gleichzeitige Anrufe braucht den gemessenen Verbrauch je Anruf; ohne Messung bleibt K3 leer.

## Beheben

1. Reicht ein Kontingent nicht, beantragt Antonio beim Anbieter die Erhöhung oder wechselt den Tarif. Der Antrag zählt erst, wenn die Zusage vorliegt.
2. Ein höheres Kontingent nutzt Hermes nur, wenn `KAPAZITAET` dazu passt. Liegt dieser Wert unter der Schwelle aus `PFLICHT` oder über der Zusage des Anbieters, wird er über ein Issue im normalen Arbeitsweg geändert, nie von Hand im Betrieb.
3. Bis dahin die Last senken, etwa angekündigte Anrufwellen verschieben. Sicherheits- und Kosten-Gates werden dafür nicht gelockert.

## Eintragen

Je Anbieter trägt Antonio Wert, Datum und Beleg (Zusage, Tarifseite mit Kontostand, Ticket des Anbieters) selbst in die Prüfliste ein. Ein beantragtes oder geschätztes Kontingent wird nicht eingetragen.

## Eskalieren

Werden Anrufe wegen Auslastung abgewiesen und lässt sich die Last nicht senken, die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen (`docs/betrieb/bereitschaft.md`).
