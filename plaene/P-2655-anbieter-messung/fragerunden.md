# Fragerunden P-2655 Anbieter-Messung

## Runde 1
1. Umfang: Die Hülle misst genau die Anbieter-Aufrufe, die B4 mit Fristen versieht: Telnyx (`voice.js`, `messaging.js`, `numbers.js`, `config-read.js`), Brevo (`brevo-mail.js`), Stripe (`billing/stripe.js`) und WorkOS (`web-auth.js`, `auth.js`, `workos-management.js`). Nicht dabei: ElevenLabs (`convai.js`, trägt die Offenlegungsprüfung, kommt mit K3), LLM-Anbieter (haben `metrics.llmCall`), Exa. Empfehlung: ja, weil derselbe Satz wie B4 und kein Gate-Code berührt wird.
2. Labels: genau `anbieter`, `vorgang`, `ergebnis`. `vorgang` kommt aus einer festen Liste im Code, ein Wert je Aufrufstelle (z. B. `anruf-starten`), nie aus Pfad, URL oder Antwort. Empfehlung: ja, das entspricht der Grundregel „keine Personendaten in Metriken“.
3. Ergebnisse: `ok`, `fehler`, `zeitueberschreitung` (Abbruch durch die B4-Frist), `429`, `kanalgrenze`. Die Einordnung liest nur Statuscode und Fehlerart, nie Antworttext. Für `kanalgrenze` zeigt heute keine HTTP-Antwort eines Anbieters den Fall eindeutig (Telnyx SIP 403 „channel limit“ kommt als Anrufereignis, nicht als Antwort eines Aufrufs; die Erkennung ist Paket K3). Empfehlung: `kanalgrenze` steht in der festen Liste, B5 setzt es aber nicht selbst; K3 liefert die Erkennung und nutzt dafür den Wert. Der Satz „Kanalgrenze“ in der Absicht wird dazu in Nicht-Ziele gestellt. Alternative: B5 zählt jeden Telnyx-Fehler mit bestimmtem Code als `kanalgrenze`, aber das müsste auf Staging gemessen werden.
4. Fehlerverhalten: Scheitert die Messung selbst, läuft der Anbieteraufruf unverändert weiter (Antwort, Fehler, Frist wie ohne Hülle); der Messfehler wird ohne Inhalt geloggt. Empfehlung: ja, die Messung darf nie einen Anruf, eine SMS oder eine Zahlung verändern.
5. Messwerte: ein Zähler `{anbieter, vorgang, ergebnis}` und ein Dauer-Histogramm `{anbieter, vorgang}` (höchstens 8 Grenzen wie in B3), damit das Serienbudget klein bleibt. Empfehlung: ja.
6. Design Doc: ja, kurz (Antonio 02.11.). B3/B4-Schnittstellen stehen als Annahmen darin; der Bau startet erst nach deren Merge.

## Antworten
Runde 1 (Betreuung, Antonio 02.11.): „wie empfohlen (1-5)“. Zu 3: `kanalgrenze` steht in der festen Liste, gesetzt wird es erst mit K3; die Verschiebung in die Nicht-Ziele ist in Ordnung. Zu 6: Design Doc ja, kurz.

## Runde 2 (Freigabeliste)
Betreuung 02.11.: „wie empfohlen (1 bis 18)“; DID-08 wird nicht angepasst; Punkt 18 als separates Folge-Issue; Freigabe erteilt.

## Vorher-Rot
S1: heute kein Zähler `hermes_anbieter_aufrufe_total` im Export, `src/metrics.js:1-40` kennt nur `llmCall` und `logTurn`; ein Exporter existiert erst mit B3.
S2: heute kein Zähler mit `ergebnis="429"`, derselbe Beleg; der Fehler erreicht nur den Aufrufer (`src/telephony/adapters/telnyx/errors.js:34-43`).
S3: heute kein Zähler mit `ergebnis="zeitueberschreitung"`, `src/brevo-mail.js:21` bricht per `AbortSignal.timeout` ab und wirft, misst aber nichts.
S4: heute kein Zähler für Stripe, `src/billing/stripe.js:183` ruft `fetch` ohne Messung.
S5: heute kein Zähler für WorkOS, `src/web-auth.js:246` ruft `_fetch` ohne Messung.
S6: heute kein Histogramm `hermes_anbieter_dauer_ms`, derselbe Beleg wie S1.
S7: heute gibt es keine `hermes_anbieter_*`-Messwerte, daher kein Label-Satz `anbieter`, `vorgang`, `ergebnis`; `src/metrics.js:1-40`.
B4: heute zählt nichts; Szenario sichert die Vorgangsliste (Kein Messwert ohne Netzaufruf) — kein Dann tritt heute ein, daher unter „Bleibt unverändert“.
S9: heute kein Zähler für Stripe mit `ergebnis="429"`, `src/billing/stripe.js:183` ruft `fetch` ohne Messung und der Fehler trägt keinen Status.
S10: heute kein Zähler `vorgang="nummer-kaufen"`, `src/metrics.js:1-40`; der Kauf wirft ohne Status (`test/telnyx-numbers.test.js:248-259`).
B11 bis B14: Szenarien unter „Bleibt unverändert“ (Antwort auf T1 und T2 der Sicherheitsprüfung); kein Dann ändert sich gegenüber heute.
