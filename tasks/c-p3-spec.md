# C-P3 — Header-Dispatch und Signaturpruefung: den Twilio-Zweig gemeinsam entfernen

Spezifikation fuer **eine** Phase (`phase-impl-lean`). Umbrella: `PLAN-ANBIETER-PORT.md`,
Track C, Schritt 4. Vorgaenger: C-P1, C-P1b, C-P2 (alle gemergt).

## 1. Was hier wirklich zu tun ist (Plan-Korrektur)

**Es gibt keine `/voice/twilio/*`-Routen.** Die fruehere Plan-Fassung nahm sie an; sie
existieren nicht. Die `/voice`-Routen sind **geteilt** und in `src/route-policy.js` gelistet
(`/voice/tts/:token`, `/voice/incoming`, `/voice/turn`, `/voice/outbound`, `/voice/status`,
`/voice/call-control`). Der Provider kommt aus den **Headern**:

```js
// src/telephony/registry.js:174-180
export function providerFromHeaders(headers) {
  if (h["x-twilio-signature"] !== undefined) return PROVIDER.TWILIO;      // <- faellt
  if (h["telnyx-signature-ed25519"] !== undefined && h["telnyx-timestamp"] !== undefined)
    return PROVIDER.TELNYX;
  return null;
}
// :182-192 — der Verifier verzweigt auf genau dieses Ergebnis
    if (provider === PROVIDER.TWILIO) return twilioVerify(req);           // <- faellt
```

**Drei Stellen, ein Zug:** der Zweig in `providerFromHeaders`, der Zweig in
`inboundSignatureVerifier`, und `src/telephony/adapters/twilio/signature.js` samt Import.

**Warum gemeinsam:** wer nur `signature.js` entfernt und `providerFromHeaders` stehen laesst,
schickt Twilio-Header in einen Zweig ohne Verifizierer. Wer nur den Dispatch entfernt, laesst
toten Verifizierer-Code liegen. Nach der Entfernung gilt: ein Request mit
`x-twilio-signature` -> `providerFromHeaders` = `null` -> Verifier `false` -> **403**.
Fail-closed, ohne dass eine Route stehen bleibt.

## 2. Ausdruecklich NICHT in dieser Phase

- **`SKIP_TWILIO_SIGNATURE_CHECK` bleibt.** Der Name ist irrefuehrend: der Schalter ist der
  **globale** Bypass fuer ALLE `/voice`-Signaturpruefungen (`routes/voice.js:224`), nicht ein
  Twilio-Schalter. Die Testsuite und `boot-guard.js` haengen daran
  (`fakeOriginateBootBlocked`). Ein Rename beruehrt `BASE_ENV`, `.env.example` und
  `render.yaml` — eigene Entscheidung, eigene Phase.
- Der Twilio-**Adapter** (voice/render/messaging/media/webhook-events/client), die Boot-Pflicht
  auf `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`, `.env.example`, `render.yaml`, `BASE_ENV`.
  Das ist C-P4. Nach C-P3 ist der Twilio-Renderer inbound **unerreichbar**, aber noch da —
  ein bewusster Zwischenzustand, damit die beiden Aenderungen einzeln abnehmbar bleiben.
- `PROVIDER.TWILIO` als Enum-Wert und der Outbound-Pfad (`voiceControl(PROVIDER.TWILIO)`).

## 3. Die harte Auflage: ein geschuetztes Gate darf nicht stiller werden

**Absolute Regel 1 nennt die Provider-Signaturpruefung ausdruecklich.** Der Sprengradius
(vorab gemessen, 9 rote Tests in 6 Dateien) enthaelt genau einen Test, dessen Wegfall die
Abdeckung dieses Gates senkt:

`test/security.test.js:25` — *"Twilio-Signaturpruefung fuer /voice/\*"*, mit drei Unterfaellen:

| Unterfall | Ersatz vorhanden? |
|---|---|
| ohne Signatur -> 403 | ja, provider-agnostisch (`voice-signature-403-log.test.js`, Fall c) |
| falsche Signatur -> 403 | ja, fuer Telnyx (`voice-signature-403-log.test.js`, Fall a) |
| **gueltige Signatur -> 200 + Antwort** | **NEIN** — es gibt keinen End-to-End-Beleg fuer Telnyx, nur einen Unit-Test des Verifiers (`signature-dispatch.test.js:27`) |

> **Auflage, nicht optional: bevor der Twilio-Test faellt, muss ein Telnyx-Aequivalent
> existieren und gruen sein — ein Spawn-Test, der ueber die echte HTTP-Route mit einer
> GUELTIGEN Ed25519-Signatur 200 bekommt.** Ohne ihn verliert das Repo den einzigen Beweis,
> dass die Signaturpruefung legitimen Verkehr nicht blockiert. Ein Gate, das alles ablehnt,
> besteht jeden Negativ-Test.

**Das Rezept existiert** (`test/signature-dispatch.test.js:27-42`): `crypto.generateKeyPairSync("ed25519")`,
den oeffentlichen Teil als raw-base64 (letzte 32 Byte des SPKI-DER) in die Server-Env
`TELNYX_PUBLIC_KEY`, dann `sign(null, Buffer.concat([Buffer.from(\`${ts}|\`), rawBody]), privateKey)`.
Neu ist nur, das durch `startServer` statt gegen den Verifier direkt zu fahren.

## 4. Der gemessene Sprengradius

Vorab in einem Wegwerf-Worktree gemessen (Twilio-Zweig entfernt, `npm test` 4050/4060):

| Datei | roter Test | Behandlung |
|---|---|---|
| `security.test.js` | Twilio-Signaturpruefung fuer /voice/* | **ersetzen** durch das Telnyx-Aequivalent aus Abschnitt 3, dann entfernen |
| `provider-threading.test.js` | providerFromHeaders: Twilio-Header -> twilio | umkehren: Twilio-Header -> `null` (der Header ist keine Provider-Quelle mehr) |
| `provider-threading.test.js` | Twilio-Inbound -> TwiML-Greeting + call.provider=twilio | entfaellt — der Inbound-Twilio-Pfad existiert nicht mehr |
| `inbound-routing.test.js` | DE-Nummer -> Polly.Vicki/de-DE | auf den Telnyx-Inbound-Pfad ziehen; die **Sprach**-Aussage (de/fr/en) bleibt, nur die Stimme wird die Telnyx-Stimme |
| `inbound-routing.test.js` | FR-Nummer -> Polly.Lea/fr-FR | dito |
| `inbound-routing.test.js` | EN-Nummer -> Polly.Amy/en-GB | dito |
| `telnyx-elevenlabs-inbound.test.js` | …"Twilio bleibt frei davon" | den Twilio-Arm streichen, die Telnyx-Aussage bleibt |
| `telnyx-p9-flag-matrix.test.js` | Flag AN + Telnyx: …Inbound(NICHT-Telnyx)=Gather… | die Zelle "Inbound NICHT-Telnyx" entfaellt; **Outbound**-Orthogonalitaet (eigener Test, C-P2) bleibt |
| `voice-signature-403-log.test.js` | OBS-3: 403 + PII-freie Logzeile | Fall b (Twilio-Header -> `provider=twilio`) wird zu `provider=unknown`; Faelle a/c/d bleiben |

**Weicht die Zahl beim Umsetzen ab, ist das ein Befund fuer den Report — kein stiller Fix.**

Die drei `inbound-routing`-Tests sind der subtilste Punkt: ihr **Gegenstand ist die
Sprachwahl**, nicht der Carrier. Sie duerfen ihre Sprach-Zusicherung nicht verlieren, nur
weil die Stimme wechselt. Wer sie loescht statt umzuziehen, nimmt die Sprach-Abdeckung mit.

## 5. Abnahme

- `npm test` gruen (erwartet 4060 minus die entfallenen, plus das neue Telnyx-Aequivalent —
  die Zahl gehoert in den Report, nicht geraten).
- **Gegenprobe:** den Twilio-Zweig in `providerFromHeaders` wieder einsetzen -> der Test aus
  Abschnitt 4 Zeile 2 (`Twilio-Header -> null`) wird rot -> wieder entfernen.
- **Der neue Telnyx-e2e-Signaturtest muss OHNE eine gueltige Signatur rot sein** (mit
  bogus Signatur 403 statt 200) — sonst beweist er nur, dass die Route antwortet.
- `test/route-auth-inventory.test.js` bleibt gruen (Absolute Regel 3).
- `node --check` auf jede geaenderte `src/`-Datei.
- **Smoke-Test:** Server lokal starten (`SKIP_TWILIO_SIGNATURE_CHECK=false`), dann
  `POST /voice/incoming` mit `x-twilio-signature: irgendwas` -> **403**. Das ist der
  sichtbare Beweis in einem echten Request.

## 6. Pre-Mortem

| Ein Jahr spaeter ist es schiefgegangen. Was ist passiert? | Gegenmassnahme |
|---|---|
| *"Die Signaturpruefung liess legitimen Verkehr durchfallen, und kein Test hat es gemerkt."* Der einzige Positiv-e2e-Test war der geloeschte Twilio-Test. | Abschnitt 3, harte Auflage: Ersatz zuerst, gruen, dann loeschen |
| *"Wir haben den Verifizierer entfernt und den Header-Dispatch stehen lassen."* Twilio-Header liefen in einen Zweig ohne Pruefung. | Abschnitt 1: drei Stellen, ein Zug, plus der Smoke-Test auf 403 |
| *"Die Sprach-Abdeckung ist mit dem Twilio-Renderer verschwunden."* Die drei `inbound-routing`-Tests wurden geloescht statt umgezogen. | Abschnitt 4, letzter Absatz |
| *"`SKIP_TWILIO_SIGNATURE_CHECK` wurde mit entfernt und die halbe Suite startete nicht mehr."* | Abschnitt 2, ausdruecklich ausgeschlossen |
