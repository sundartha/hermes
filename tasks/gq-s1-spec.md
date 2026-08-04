# GQ-S1 — Sonden: Turn-Herkunft und Inbound-Feldname sichtbar machen

**Befunde:** B-1 (Doppel-Turns, Quelle unbekannt) und B-9/O-1 (geratener Inbound-Feldname
mit stillem Rueckfall).

**Zweck:** EIN Testanruf soll zwei heute unbekannte Groessen belegen. Diese Phase aendert
**kein Verhalten** — sie macht nur sichtbar, was heute unsichtbar passiert. Sie ist rein
additiv und muss es bleiben.

## Warum diese Phase vor allem anderen kommt

Zwei Hypothesen zu B-1 sind bereits gestorben, beide an einer Messung:

1. "Endpointing steht auf 0,8 s" — der Provisioner-Wert existiert live gar nicht
   (`start_speaking_plan: null`).
2. "eager_eot_threshold wurde aktiv gesetzt" — 0.8 ist der Telnyx-**Default**, und laut
   Telnyx-Doku deaktiviert `eager_eot_threshold == eot_threshold` den eager-Modus bereits.

Was am Code belegt ist: der Shim behandelt jeden POST auf `/v1/chat/completions` als
eigenstaendigen Turn — kein `is_final`/`interim`-Feld wird gelesen, keine Serialisierung,
kein Abbruch. **Warum zwei POSTs fuer eine Aeusserung ankommen, ist unbelegt.** Am 04.08.
lagen `turnSeq 1` und `2` **eine Millisekunde** auseinander (`call_mseip2888klk`,
10:31:12.580 / .581) — kein Mensch spricht zweimal in einer Millisekunde. Das riecht nach
einem Doppel-POST, nicht nach zwei Sprech-Turns; belegt ist es nicht.

Dieses Repo hat schon einmal 297 von 297 Kostenbelegen verloren, weil jemand Feldnamen
geraten hat. Deshalb: **messen, nicht raten.**

## Sonde A — Turn-Herkunft am Shim (B-1)

Am Eingang des Handlers fuer `POST /v1/chat/completions` (`src/telnyx-llm-shim.js`) eine
Logzeile je eingehendem Request. Sie beantwortet genau eine Frage: **Sind zwei POSTs fuer
dieselbe Aeusserung zwei Sprech-Turns oder ein doppelt zugestellter Request?**

Pro Request zu protokollieren:

- Zuordnung: `callControlId` bzw. `telnyx_conversation_id`
- Zeitstempel in Millisekunden und der **Abstand zum vorherigen Request desselben Calls**
- Anzahl `messages` und die Rolle der letzten Nachricht
- **Laenge** des letzten Nutzer-Textes — **nicht der Text**
- ein kurzes, stabiles Hash-Praefix dieses Textes (z. B. die ersten 8 Hex-Zeichen eines
  SHA-256), damit "identischer Text" von "erweitertem Text" unterscheidbar wird
- ob der Text des vorherigen Requests ein **Praefix** des aktuellen ist — das ist der
  Fingerabdruck der Doppel-Zustellung (belegt an Segment 9/10 des Beleg-Anrufs)
- die von Telnyx gesetzten Request-Header, die eine Anfrage identifizieren
  (Namen wie `X-Telnyx-*`, insbesondere eine Request-ID, falls vorhanden)

**Zwei identische Hashes mit identischer Request-ID = ein doppelt zugestellter Request
(Retry/Reconnect). Zwei verschiedene Hashes in Praefix-Beziehung = zwei echte Turns aus
der Spracherkennung.** Die Sonde muss diese beiden Faelle unterscheidbar machen; das ist
ihre Abnahme.

## Sonde B — Inbound-Feldname und lauter Rueckfall (B-9 / O-1)

Heute steht in `src/telnyx-inbound.js`:

```js
const INBOUND_CALL_CONTROL_ID_FIELD = "CallControlId";   // "Doku-Stand, live unbestaetigt"
```

Faellt der Handoff aus, weil das Feld fehlt, geht der Aufrufer **still** auf die
Budget-Engine zurueck — kein Log, keine Metrik, keine Sonde. Der Dienst meldet
"Assistant-Pfad: AKTIV" und laeuft inbound seit Wochen ueber die alte Engine.

Zu bauen:

1. Am Inbound-TeXML-Webhook (`src/routes/voice.js`) die **Schluesselnamen** des Bodys
   protokollieren — sortiert, **ohne Werte**. Damit ist der echte Feldname am naechsten
   echten Anruf ablesbar, ohne ihn zu raten.
2. Zusaetzlich: gibt es einen Schluessel, dessen Name (case-insensitiv, ohne Unterstriche)
   wie `callcontrolid` aussieht? Wenn ja, seinen Namen nennen.
3. **Der stille Rueckfall wird laut.** Liefert `inboundCallControlId()` null und faellt der
   Aufrufer auf den TeXML-Greeting-Pfad zurueck, muss das eine eindeutige, gut auffindbare
   Logzeile erzeugen, die die **gescheiterte Bedingung** nennt und was der Betreiber tun
   soll — nicht nur "Fehler". Das ist die Zusatzauflage aus O-1 und der eigentliche Defekt
   hinter B-9.

Das Scharfschalten des Handoffs ist **NICHT** Teil dieser Phase. Hier wird nur gemessen und
sichtbar gemacht. Der Umbau folgt, wenn der Feldname belegt ist.

## Harte Randbedingungen

- **Keine Inhalte ins Log.** Gesprochene Texte sind personenbezogene Daten von Menschen, die
  dem nicht zugestimmt haben. Protokolliert werden **Laengen, Hashes, Schluesselnamen,
  Zeitstempel** — niemals Wortlaut, niemals Rufnummern in Klartext, niemals Secrets
  (kein `Authorization`-Header, kein Bearer, kein API-Key).
- **Kein Verhalten aendern.** Rein additiv. Kein Turn wird unterdrueckt, verzoegert,
  zusammengefasst oder abgebrochen. Wer bei dieser Phase anfaengt, B-1 zu *reparieren*,
  hat den Auftrag verfehlt — die Reparatur braucht erst das Messergebnis.
- **Safety-Gates unberuehrt:** Kostendecke, `OUTBOUND_FROZEN`, Denylist, Land-Gate,
  Stundenlimit, Max-Dauer, Provider-Signaturpruefung (fail-closed), Offenlegungssatz, Auth.
  Die Sonde sitzt vor bzw. neben diesen Pruefungen und darf ihre Reihenfolge und ihre
  Zaehler (`turnSeq`, `emptyStreak`, Rate-Fenster) **nicht** veraendern.
- **Kein Dauerlaerm.** Die Zeilen fallen je Turn an. Sie muessen knapp sein und duerfen den
  Log nicht so fluten, dass die bestehende Turn-Diagnostik unlesbar wird.
- ESM, kein Build-Step, kein TypeScript. Kommentare deutsch **ohne** Umlaute.
  Konfigurierbares nach `src/config.js` **und** `.env.example`.

## Abnahme

1. `npm test` gruen (Vorbedingung, nicht das Ergebnis).
2. Neue Tests: die Praefix-Erkennung aus Sonde A wird an einem Beispiel gepruefte
   (identischer Text / erweiterter Text / unabhaengiger Text), und der laute Rueckfall aus
   Sonde B hat ein **Gegenbeispiel** (Feld vorhanden -> kein Rueckfall-Befund).
3. Das eigentliche Ergebnis ist ein **echter Testanruf** durch den Owner. Danach muss aus
   dem Log ohne Raten ablesbar sein:
   - ob die zwei POSTs derselbe Request oder zwei Turns waren,
   - wie das Inbound-Feld mit der `call_control_id` wirklich heisst.

## Rueckweg

Rein additive Logzeilen: Revert des Commits entfernt sie rueckstandsfrei. Kein
Datenmodell, keine Migration, kein Verhalten betroffen.
