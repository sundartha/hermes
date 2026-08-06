# C-P2 — Die Testsuite auf Telnyx migrieren, bevor der Adapter faellt

Spezifikation fuer **eine** Phase (`phase-impl-lean`). Umbrella: `PLAN-ANBIETER-PORT.md`,
Track C, Schritt 3. Vorgaenger: C-P1 (Rueckfall-Default, gemergt). **Diese Phase loescht
weiterhin nichts.**

## 1. Warum vor dem Adapter

Die Testsuite bezieht ihren Provider heute aus zwei Fixtures in `test/helpers.js`:

```js
export const OWNER_TEST_NUMBER    = Object.freeze({ e164: "+15005550006",   provider: "twilio" });
export const DOMESTIC_TEST_NUMBER = Object.freeze({ e164: "+4930111222333", provider: "twilio" });
```

Faellt der Adapter, bevor diese Fixtures umgestellt sind, muss man beides gleichzeitig
reparieren — und **genau dann ist nicht mehr unterscheidbar, ob ein gruener Test noch
dasselbe prueft wie vorher.**

## 2. Der gemessene Sprengradius

Vorab in einem Wegwerf-Worktree gemessen (beide Fixtures auf `telnyx`, `npm test`):

| | |
|---|---|
| Testdateien, die eine der Fixtures nutzen — **ihr Provider wechselt** | **26** |
| davon mit Twilio-spezifischen Zusicherungen (`speechModel`, `Polly.`, `actionOnEmptyResult`, `x-twilio-signature`, TwiML) | **4** (`inbound-routing`, `media-token`, `provider-threading`, `security`) |
| Tests, die tatsaechlich **rot** werden | **1** |

Der eine rote Test:
`Flag AN + NICHT-Telnyx (Twilio-Owner): Outbound faellt auf TeXML/Bestand zurueck (Orthogonalitaet)`
(`test/telnyx-p9-flag-matrix.test.js`).

**Sein Gegenstand IST "der Owner ist NICHT Telnyx".** Er darf deshalb nicht auf Telnyx
gezogen werden — er braucht seinen Provider **explizit** als Twilio. Wer ihn stattdessen
"gruen macht", loescht die Orthogonalitaets-Aussage, ohne dass etwas rot wird.

## 3. Die eigentliche Gefahr ist das Gruen, nicht das Rot

**25 der 26 Dateien bleiben gruen und pruefen danach trotzdem etwas anderes** — sie laufen
ab dem Flip durch den Telnyx-Renderer statt durch den Twilio-Renderer. Das ist ueberwiegend
gewollt (Telnyx ist der einzige echte Provider), aber es ist eine **stille** Verschiebung,
und stille Verschiebungen sind genau der Schaden, den Track C ausschliessen soll.

**Deshalb ist der Kern dieser Phase eine Inventur, kein Edit.** Fuer **jede** der 26 Dateien
ist zu klassifizieren und im Report zu nennen:

- **(A) provider-agnostisch** — die Zusicherungen haengen nicht am Carrier (Budget-Gates,
  Reserve/Release, Metering, KYC, Onboarding, Sprachwahl…). Der Flip ist folgenlos, die
  Abdeckung wandert von "zufaellig Twilio" auf "der Provider, den wir wirklich fahren".
  **Das ist eine Verbesserung, keine Luecke.**
- **(B) provider-spezifisch, Gegenstand ist Telnyx** — nach dem Flip korrekter als vorher.
- **(C) provider-spezifisch, Gegenstand ist Twilio** — der Test braucht seinen Provider
  **explizit**, damit er bis zur Adapter-Entfernung (spaetere Phase) weiter das prueft, was
  er prueft. `TWILIO_TEST_SIGNATURE_HEADERS` (aus C-P1, in `test/helpers.js`) ist dafuer da.
- **(D) unklar** — ausdruecklich als unklar melden. **Nicht raten.** Ein "unklar" im Report
  ist ein brauchbares Ergebnis; eine erfundene Einordnung ist es nicht.

Die Klassifikation gehoert in den Report, Datei fuer Datei, mit einem Satz Begruendung.
26 Zeilen. Ohne sie ist die Phase nicht abgenommen.

## 4. Umfang

1. Beide Fixtures in `test/helpers.js` auf `provider: "telnyx"`.
   **`OWNER_TEST_NUMBER` bleibt die US-Nummer `+15005550006`** — die ausgelieferte Default-DID
   ist US, und `test/prod-config-smoke.test.js` ist der Live-Messpunkt dafuer (Kommentar
   `helpers.js:26-29`). Nur der Provider aendert sich, nicht die Nummer.
2. Den einen roten Test auf **explizit Twilio** stellen (Fall C).
3. Die Inventur aus Abschnitt 3.
4. Wo die Inventur Fall (C) findet: Provider dort explizit setzen.

**Ausdruecklich NICHT in dieser Phase:**

- **`BASE_ENV` bleibt unveraendert.** `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` muessen dort
  stehen bleiben, solange `assertConfig` (`src/config.js:1669-1670`) sie **unbedingt**
  verlangt. Beides faellt zusammen in einer spaeteren Phase — die Reihenfolge ist nicht
  verhandelbar, sonst startet kein Spawn-Test mehr.
- Der Twilio-Adapter, seine Routen, seine Signaturpruefung, `.env.example`, `render.yaml`.
- `DEFAULT_PROVIDER` (steht seit C-P1 auf Telnyx und bleibt).

## 5. Abnahme

- `npm test` gruen (erwartet 4060; eine Abweichung ist ein **Befund**, kein stiller Fix).
- Gegenprobe: Fixtures zurueck auf `twilio` -> der in Abschnitt 2 genannte Test wird rot ->
  Fixtures wieder auf `telnyx`. Belegt, dass die Migration ueberhaupt etwas bewegt.
- `node --check` auf jede geaenderte Datei (hier: nur Tests + `helpers.js`).
- Die 26-Zeilen-Inventur im Report.

## 6. Pre-Mortem

| Ein Jahr spaeter ist es schiefgegangen. Was ist passiert? | Gegenmassnahme |
|---|---|
| *"Die Suite war gruen und hat trotzdem weniger geprueft."* Der Orthogonalitaets-Test wurde gruen gemacht statt explizit gemacht. | Abschnitt 2 benennt ihn namentlich und schreibt die Behandlung vor |
| *"Niemand wusste mehr, welche Tests ueberhaupt einen Carrier meinen."* | die Inventur aus Abschnitt 3 ist das Ergebnis, nicht der Diff |
| *"Nach dem Fixture-Flip startete kein Spawn-Test mehr."* Jemand hat `BASE_ENV` gleich mitbereinigt, waehrend `assertConfig` die Keys noch verlangt. | Abschnitt 4, ausdruecklich ausgeschlossen |
| *"`prod-config-smoke` misst seitdem etwas anderes."* Die US-Nummer wurde beim Flip mitgeaendert. | Abschnitt 4.1: nur der Provider aendert sich |
