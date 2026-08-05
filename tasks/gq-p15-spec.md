# GQ-P15 — der Grund eines Fehlanrufs steht in der Benachrichtigung

## Warum (am Code belegt, Fragilitaets-Analyse F4)

`recordFailureReason` (`src/store/state-ops.js:608-618`, set-once) wird synchron aus
`src/routes/voice.js:538` aufgerufen — **vor** `terminateAndBillCall`. Der Grund liegt also
nachweislich vor, wenn `finishCall` den Call sieht.

`src/telephony/call-finish.js:59-66` baut die einzige **passive** Benachrichtigung
ausschliesslich aus `call.status`:

```js
t.statusBody(target, call.status)     // -> `${target} (Status: ${status})`
```

Unabhaengiger Grep: die einzigen Leser von `failureReason` sind `src/mcp-tools.js:152`
(`get_call_status`) und das Call-Widget — beides **aktive** Kanaele, die jemand abfragen
muss. Zusaetzlich setzen sowohl der Dauer-Cap als auch der Budget-Abbruch
(`src/telephony/call-lifecycle.js`) den Status auf `completed`, landen also im selben
Frueh-Return-Zweig.

**Folge, im Kickoff als offener Befund gefuehrt:** *„Fuenf stille Fehlanrufe ueber drei
Wochen sind niemandem aufgefallen."* no-answer, besetzt, Fehler, Dauer-Cap und
Budget-Abbruch sind in der Nachricht nicht unterscheidbar. Der Grund war jedes Mal
gespeichert — er stand nur in keiner Nachricht.

Die fuenf Faelle sind belegt: nie angenommene Outbound-Anrufe mit Gesamtdauer
31,3 / 30,8 / 30,9 / 31,6 / 31,7 s (19.07.-05.08.).

## Aenderung

Die passive Benachrichtigung nennt den Grund, **wenn** einer gesetzt ist.

- Der Grund kommt aus `call.failureReason` — dem Feld, das bereits existiert und bereits
  gefiltert ist. `callFailureReason` (`src/telephony/failure-reason.js`) liefert einen
  **Token**, keine fremde Rede; `diagnostics.sipHangupCause` laeuft ausdruecklich durch
  `safeCauseToken`. Es wird **kein** neuer Rohwert in eine Nachricht getragen.
- Ist kein Grund gesetzt, bleibt der Text **byte-identisch** zum Bestand.
- Der Token wird ueber die i18n-Schicht in einen lesbaren Satz gebracht, in **de, en, fr** —
  Muster wie bei den bestehenden Status-Texten. Fuer einen unbekannten Token faellt der
  Text fail-soft auf den heutigen Wortlaut zurueck; ein Token darf nie roh beim Nutzer
  landen.

## Was diese Phase NICHT tut

- **Kein neuer Kanal, keine neue SMS, keine zusaetzliche Nachricht.** Nur der Inhalt der
  bestehenden.
- **`hangup_cause` wird nicht neu geloggt.** Das ist ein eigener offener Befund
  (Kickoff Teil 3) und eine eigene Phase.
- **Keine Aenderung an `recordFailureReason`, an der Gate-Kette oder am Billing-Pfad.**
- Kein Rohwert des Providers in Nutzertext — nur der bereits gefilterte Token.

## Verifikation — deterministisch

`npm test` gruen (Basis 3959). Neue Tests, offline:

1. Call mit `failureReason` gesetzt -> die Benachrichtigung enthaelt den zugehoerigen
   lesbaren Grund.
2. Call **ohne** `failureReason` -> Text byte-identisch zum Bestand (Golden-Master-Pin).
3. Zwei verschiedene Gruende ergeben zwei **verschiedene** Texte — das ist der Kern des
   Befunds (heute sind sie ununterscheidbar).
4. Unbekannter/fremder Token -> Fallback auf den Bestandstext, der Token erscheint **nicht**
   woertlich.
5. de/en/fr jeweils uebersetzt (kein durchgereichter englischer Token in einem DE-Text).

**Live-Zahl:** Anteil der Ausfall-Benachrichtigungen, die den Grund nennen. Heute **0**,
nach der Phase **1** fuer jeden Call mit gesetztem `failureReason`.

## Absolute Regeln

- **PII:** die Nachricht darf keinen Provider-Rohtext tragen. Der Weg ueber
  `callFailureReason` + `safeCauseToken` ist Pflicht, nicht Empfehlung.
- Keine Aenderung an Safety-Gates, Auth oder Kostenpfad.
