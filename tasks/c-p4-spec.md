# C-P4 — Den Twilio-Adapter entfernen

Spezifikation fuer **eine** Phase (`phase-impl-lean`). Umbrella: `PLAN-ANBIETER-PORT.md`,
Track C, Schritt 5 (erste Haelfte). Vorgaenger: C-P1, C-P1b, C-P2, C-P3 (alle gemergt).

Die Freigabe des Owners fuer die Twilio-Entfernung steht in `CLAUDE.md`, Absolute Regel 1
(Eintrag 2026-08-07, C-P3).

## 1. Was faellt — die Fläche ist kleiner, als sie aussieht

`grep -rl twilio src/` liefert 46 Dateien, `test/` 123. **Das ist irrefuehrend.** Der
groesste Teil davon ist `twilioSid` — ein **gespeicherter Feldname am Call-Record, den
BEIDE Anbieter benutzen** (18 src-, 22 test-Dateien; der Telnyx-TeXML-Pfad schreibt dort
seine SID). Ihn umzubenennen ist eine Datenform-Aenderung mit Migration, **kein**
Adapter-Ausbau — **ausdruecklich NICHT Teil dieser Phase.**

Echte Adapter-Abhaengigkeit in `src/` (vollstaendig gegruept):

| Ort | was |
|---|---|
| `src/telephony/adapters/twilio/` | 6 Dateien, 243 Zeilen: `client.js`, `media.js`, `messaging.js`, `render.js`, `voice.js`, `webhook-events.js` |
| `src/telephony/registry.js` | 5 Importe (`:17`, `:19`, `:20`, `:25`, `:27`), die `ADAPTERS`-Eintraege (`:69-73`, `:88`) und der Capability-Eintrag (`:120`) |
| `src/bridge.js:31` | `MEDIA_PATH[PROVIDER.TWILIO] = "/media"` |
| `src/routes/api-calls.js:292` | `if (ctx.outboundProvider === PROVIDER.TWILIO)`-Zweig |
| `src/store/defaults.js:33` | `PROVIDER = { TWILIO: "twilio", TELNYX: "telnyx" }` |

## 2. Enum und Adapter-Tabelle fallen GEMEINSAM — das erzwingt der Bestand

`test/telephony-registry.test.js` haelt die Invariante:

```js
for (const provider of Object.values(PROVIDER))
  for (const [name, factory] of FULL_COVERAGE)
    assert.doesNotThrow(() => factory(provider), `${name}/${provider} fehlt in ADAPTERS`);
```

Bleibt `TWILIO` im Enum, waehrend die `ADAPTERS`-Eintraege verschwinden, wird dieser Test
rot — zu Recht. **Also faellt `PROVIDER.TWILIO` mit.** Danach ist die Invariante
automatisch wieder gruen, ohne sie anzufassen. Sie **darf nicht abgeschwaecht werden**;
wenn sie rot bleibt, ist der Ausbau unvollstaendig.

**Datenseitig unbedenklich, gemessen:** `src/db/schema.sql` fuehrt `provider TEXT` **ohne
CHECK-Constraint**; ein gespeicherter Wert `'twilio'` bricht kein Schema. In der
Produktions-DB steht ohnehin keiner (3 Nummern, 67 Anrufe, alle `telnyx`, gemessen
2026-08-07). `resolveSeedProvider("twilio")` liefert danach `null` — fail-closed, korrekt:
`twilio` ist kein unterstuetzter Anbieter mehr.

## 3. Ausdruecklich NICHT in dieser Phase

- **`twilioSid`** (Feldname am Call-Record, s. Abschnitt 1) und `twilio_sid` in `schema.sql`.
- **`config.js` `twilioSid`/`twilioToken`, die Boot-Pflicht in `assertConfig` (`:1669-1670`),
  `.env.example`, `render.yaml`, `BASE_ENV` in `test/helpers.js`.** Das ist C-P5.
  **Reihenfolge-Warnung:** die Boot-Pflicht muss fallen, BEVOR jemand die Render-Env-Keys
  loescht — sonst startet der Live-Dienst nicht mehr. Beide Keys sind dort gesetzt
  (belegt: `assertConfig` verlangt sie unbedingt und der Dienst laeuft).
- **`SKIP_TWILIO_SIGNATURE_CHECK`** — trotz des Namens der globale `/voice`-Bypass.

## 4. Erwartete Aenderungen an Tests

Diese Dateien importieren den Adapter direkt und muessen behandelt werden:

`bridge-openai-event`, `telnyx-voice`, `media-transport`, `telnyx-cost-records`,
`render-adapter-language-parity`, `twilio-voice`, `webhook-events`, `directive-render`,
`stt-model-seam`, `telephony-registry`, `telephony-contract`, `p9-voice-locale-source`.

**Behandlungsregel — dieselbe wie in C-P2, und sie ist der Kern der Abnahme:**

- Ist der **Gegenstand** des Tests Twilio (z. B. `twilio-voice.test.js` ganz,
  Twilio-Render-Snapshots), faellt er mit dem Adapter. Das ist korrekt.
- Ist der Gegenstand ein **anderer** (Sprach-Paritaet zwischen Adaptern, Locale-Quelle,
  Media-Transport-Vertrag, STT-Naht), darf die Aussage **nicht** verschwinden. Wo ein Test
  zwei Adapter verglich, bleibt die Telnyx-Haelfte als eigenstaendige Zusicherung stehen —
  ein Paritaetstest mit einem Teilnehmer ist keiner, aber die Eigenschaft, die er sicherte,
  braucht weiterhin einen Beleg.
- **`telnyx-p9-flag-matrix.test.js`**: die Orthogonalitaets-Zelle "Flag AN + NICHT-Telnyx"
  verliert ihren Gegenstand — mit einem Anbieter gibt es keine Orthogonalitaet zwischen
  Flag und Anbieter. Sie faellt, und `TWILIO_TEST_OWNER_NUMBER` in `test/helpers.js`
  (C-P2) faellt mit ihr.

**Im Report ist je Datei zu nennen: geloescht, gekuerzt oder unveraendert — und warum.**
Eine Datei, die nur "gruen gemacht" wurde, ist ein Befund.

## 5. Abnahme

- `npm test` gruen. **Die Zahl gehoert in den Report, nicht geraten** — sie sinkt, und um
  wie viel ist die Aussage ueber den Umfang.
- Die Registry-Invariante (Abschnitt 2) ist **unveraendert** gruen. Wurde sie angefasst,
  ist das ein Blocker.
- `node --check` auf jede geaenderte `src/`-Datei.
- **Gegenprobe:** `PROVIDER.TWILIO` testweise wieder ins Enum -> die Registry-Invariante
  wird rot (kein Adapter mehr) -> wieder entfernen. Belegt, dass Enum und Tabelle
  tatsaechlich gekoppelt sind.
- **Smoke-Test:** Server lokal starten, `/healthz` = 200, und ein Telnyx-Inbound mit
  gueltiger Ed25519-Signatur liefert weiterhin 200 + TeXML. Der Ausbau darf den einzigen
  verbliebenen Sprechpfad nicht beruehren.

## 6. Pre-Mortem

| Ein Jahr spaeter ist es schiefgegangen. Was ist passiert? | Gegenmassnahme |
|---|---|
| *"Eine Eigenschaft, die ein Paritaetstest sicherte, ist mit ihm verschwunden."* | Abschnitt 4, Behandlungsregel + Report je Datei |
| *"Der Live-Dienst startete nach dem Deploy nicht mehr."* Jemand hat die Boot-Pflicht oder die Render-Env-Keys mitgenommen. | Abschnitt 3, ausdruecklich ausgeschlossen; C-P5 macht es in der richtigen Reihenfolge |
| *"`twilioSid` wurde mit umbenannt und die Bestandsdaten passten nicht mehr."* | Abschnitt 1 und 3: Feldname, nicht Adapter |
| *"Die Registry-Invariante wurde abgeschwaecht, damit die Suite gruen wird."* | Abschnitt 5: Anfassen ist ein Blocker |
