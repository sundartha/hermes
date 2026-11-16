`src/store.js` + `src/store/` — Persistenz-Fassade ueber zwei Backends: `json.js`
(`data/store.json`, gitignored; loeschen = lokaler Reset) und `pg.js` (Postgres, RLS).
`state-ops.js`/`views.js`/`portal.js`; Backend via `STORE_BACKEND`.
Multi-Tenant: pro-Tenant settings/calendar/usage/budget.
**Kommentardichte ist hier selbst der Tech-Debt, kein Vorbild.**
Sich beim Schreiben am Bestand zu orientieren (G24, Konventionen) reproduziert hier einen Missstand.
Neue Kommentare nur, wo eine Invariante sonst unsichtbar waere.
**Ursache:** `save()` ist im pg-Store fire-and-forget und wird **zusammengefasst**.
**Regel:** Bei asynchroner/gebuendelter Persistenz muss der Test den
**Zeitpunkt** nachstellen, nicht nur die Reihenfolge der Aufrufe.
Ein `await store.save()` an der Stelle, an der live ein Flush laege, ist Teil des Aufbaus — nicht Kosmetik.
**Ausgehende Anrufe sind vor dem Waehlen in der Datenbank:** `persistCall` schreibt die Zeile bestaetigt (wirft bei Fehler,
der Anruf entfaellt), `countOutboundCallsSince` zaehlt im pg-Store per SQL (`anrufe.js`, mit eigenem Mandanten-Kontext).
`addTranscript` und `purgeTranscript` schreiben im pg-Store bestaetigt per SQL in `transcript_segment` (ebenfalls `anrufe.js`, in der Flush-Reihe);
ein Schreibfehler wirft, der Spiegel bleibt dann unveraendert.
`markAnswered`, `trueUpAnsweredAt`, `recordAnsweredUnclearReason`, `endCallRecord` und `setCallEndedAt` sind `async` und schreiben die Zeile `call` bestaetigt per SQL (`anrufe.js`, Abheben, Grund und Ende nur einmal, Ende nur aus `active`); Aufrufer warten darauf (ausser `/voice/incoming` beim Abheben: dort bleibt `answeredAt` im Spiegel, der Fehler wird geloggt), ein Schreibfehler wirft und setzt die Felder im Spiegel zurueck.
`markSummarySmsSent`, `markSummaryMailSent`, `markNotPlacedMailSent`, `markBilled`, `markInboxEntry`, `recordWebhookAnchors`, `recordCallEstimatedCostCents`, `recordCallCostTruingResult` und `recordElDetectorCounts` schreiben ebenso bestaetigt (`anrufe.js`, Marken und Kosten nur einmal); `getCall` bleibt synchron aus dem Spiegel und heisst: auf dieser Instanz gebunden und bewacht; ein Fehltreffer fuehrt zu `reattachActiveCall` (Webhook-Waechter, `voice.js`, Lebenszyklus-Fristen, alles was einen laufenden Anruf veraendert). `leseCall` (`pg.js`) liefert den Spiegel-Treffer oder liest den Anruf ueber `anruf_schluessel` mit dem Mandanten des Anrufs aus der Datenbank und haengt ihn in den Spiegel, ein Lesefehler wirft; nur der Anrufstart-Pfad (`elevenlabs/outbound.js`, `vorspann-*.js`, `nachlauf-anspruch.js`) liest ueber `leseCall`. `leseCallUngebunden` (`pg.js`) liest wie `leseCall`, haengt aber nichts in den Spiegel und ist nur fuer Aufrufer, die einen Anruf bloss lesen und zurueckgeben (`GET /api/calls/:id` in `routes/api-read.ts`). Fuer S4-A/H5: bevor `state.calls` wegfaellt, braucht der Lebenszyklus eine eigene Menge gebundener Anruf-IDs, denn der Spiegeltreffer ist heute diese Markierung.
`counterpartyMemory` (Gespraechsgedaechtnis) ist im pg-Store `async` und liest die frueheren ausgehenden Anrufe an dieselbe Nummer per SQL (`anrufe.js`, `gedaechtnis`, filtert nach `tenant_id` und setzt den Mandanten-Kontext selbst); Anrufe im eigenen Spiegel ersetzen die Zeile gleicher ID, ein Lesefehler wird geloggt und das Gedaechtnis kommt dann aus dem Spiegel. Das JSON-Backend liefert dasselbe synchron.
`attachActiveCall(wert, { schluessel: "streamToken" | "twilioSid" })` findet einen laufenden Anruf einer anderen Instanz ueber die Tabelle `anruf_schluessel`
(Pruefsummen, vom Trigger in `0019_anruf_schluessel.sql` gepflegt) und setzt den Mandanten-Kontext des Treffers, ohne alle Mandanten durchzugehen; ein Lesefehler wirft.
**Call-IDs sind Zeitstempel:** `call_` + `Date.now().toString(36)` in den ersten 8 Zeichen.
Damit laesst sich ein bestimmter Anruf ohne DB-Zugriff in Sweep-Logs wiederfinden.
Der Weglauf-Fall bleibt gedeckt, aber an der richtigen Stelle: Outbound setzt Abo+KYC voraus (am Code
belegt, `state-ops.js:1149`, `activation.js:87`, `outbound-gates.js:317`) — ein unverkaufter Tenant erzeugt
keine Carrier-Kosten; DID-Vermehrung deckeln `MAX_NUMBERS` (plattformweit) und `MAX_NUMBERS_PER_TENANT`.

## Baustein speicher (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck: Hält und speichert den Zustand, eine Fassade für alle. Neuer Begriff in die passende `src/begriffe/<thema>.js`, nie in eine Sammeldatei.
- Darf nutzen: basis, begriffe, konfiguration, texte, mail, sperrdaten
- Ort für Neues: Neue Dateien in `src/store/` gehören zu speicher, solange tools/bausteine.json sie keinem anderen Baustein nennt. Weitere Ordner von speicher: `src/db/`.
- Eingang: Andere Bausteine importieren aus `src/store/` nur cost-evidence.js, portal.js, state-ops.js, views.js.
