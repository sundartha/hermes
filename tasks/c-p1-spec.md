# C-P1 — Der Rueckfall-Default wird explizit Telnyx

Spezifikation fuer **eine** Phase (`phase-impl-lean`). Umbrella: `PLAN-ANBIETER-PORT.md`,
Track C, Schritt 2. **Dies ist der erste Schritt von Track C und er loescht noch nichts.**

## 1. Warum dieser Schritt zuerst kommt

Twilio ist in diesem Repo kein ungenutzter Zweig, sondern der **Rueckfall-Default**:
`src/store/defaults.js:34` — `export const DEFAULT_PROVIDER = PROVIDER.TWILIO;`

Wer den Adapter loescht, ohne diesen Default vorher bewusst umzustellen, aendert **still**,
was bei leerer oder unerkannter Konfiguration passiert. Genau das soll dieser Schritt
verhindern: eine **verhaltens-sichtbare** Aenderung mit eigenem Test, bevor irgendwo Code
verschwindet.

**Die Praemisse ist gemessen, nicht angenommen** (Produktions-DB, 2026-08-07, RLS je Tenant
gesetzt): 3 Tenants, **3 Nummern, 67 Anrufe — keine einzige Zeile auf Twilio.** Der Flip kann
also keinen echten Verkehr umleiten.

## 2. Umfang

**Ziel:** `DEFAULT_PROVIDER` ist Telnyx, und jede Stelle, die den Rueckfall liest, ist
weiterhin bewusst und getestet.

Die vier Leser des Rueckfalls (gegruept, vollstaendig):

| Ort | Bedeutung heute |
|---|---|
| `src/store/defaults.js:39` `resolveSeedProvider` | leerer `OWNER_NUMBER_PROVIDER` -> DEFAULT_PROVIDER |
| `src/routes/voice.js:262` | `providerFromHeaders(req.headers) ?? DEFAULT_PROVIDER` |
| `src/routes/voice.js:506` | `call.provider \|\| DEFAULT_PROVIDER` |
| `src/telephony/voice-render.js:64` | `MEDIA_PATH[call.provider] \|\| MEDIA_PATH[DEFAULT_PROVIDER]` |

Dazu die Kommentare, die den alten Default behaupten und danach falsch waeren:
`src/config.js:922-925` (`ownerNumberProvider`), `src/store/defaults.js:30-44`,
`src/billing/provision-trigger.js:7`.

**Nicht in diesem Schritt** (jeder ein eigener, spaeterer Schritt von Track C):

- Der Twilio-Adapter, seine Routen, seine Signaturpruefung.
- Die Boot-Pflicht auf `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` (`config.js:1669-1670`).
  **Achtung fuer spaeter:** beide Keys sind in der Render-Umgebung gesetzt (belegt: der
  Boot verlangt sie unbedingt und der Live-Dienst laeuft). Wer sie loescht, bevor diese
  Pflicht faellt, legt den Dienst still.
- `test/helpers.js` `OWNER_TEST_NUMBER`/`DOMESTIC_TEST_NUMBER` (`provider: "twilio"`) und
  die `TWILIO_*`-Eintraege in `BASE_ENV`. Die sind **explizit** und damit vom Flip nicht
  betroffen; ihre Migration ist Schritt 3 des Plans.

## 3. Der gemessene Sprengradius

Der Flip allein (eine Zeile, `DEFAULT_PROVIDER` -> `PROVIDER.TELNYX`) macht **genau 8 Tests
in 6 Dateien** rot. Vorab gemessen in einem Wegwerf-Worktree, `npm test` 4049/4057:

| Datei | roter Test |
|---|---|
| `test/owner-number-seed.test.js` | `resolveSeedProvider: leer -> DEFAULT_PROVIDER (Twilio, Zero-Config)` |
| `test/inbound-routing.test.js` | `DE-Nummer -> call.language=de + DE-Voice byte-identisch (Polly.Vicki/de-DE)` |
| `test/inbound-routing.test.js` | `FR-Nummer -> call.language=fr + FR-Voice (Polly.Lea/fr-FR)` |
| `test/inbound-routing.test.js` | `EN-Nummer -> call.language=en + EN-Voice (Polly.Amy/en-GB)` |
| `test/provider-threading.test.js` | `Twilio-Inbound -> TwiML-Greeting (speechModel) + call.provider=twilio (byte-identisch)` |
| `test/telnyx-elevenlabs-inbound.test.js` | `ElevenLabs-Env gesetzt: Telnyx-Inbound spricht ElevenLabs …, Twilio bleibt frei davon` |
| `test/telnyx-p9-flag-matrix.test.js` | `Flag AN + Telnyx: Outbound=Call-Control, Inbound(Telnyx)=Handoff, Inbound(NICHT-Telnyx)=Gather, Shim=403` |
| `test/voice-status-lifecycle.test.js` | `/voice/status provider-bewusst: Telnyx/Twilio-Lifecycle + Diagnose + Store-Effekt + PII-frei` |

**Diese Liste ist der Arbeitsauftrag.** Weicht die Zahl beim Umsetzen ab, ist das ein Befund
und gehoert in den Bericht — nicht stillschweigend wegzufixen.

## 4. Die entscheidende Regel: Abdeckung darf nicht still wandern

**Grün ist nicht das Ziel. Dieselben Invarianten wie vorher zu pruefen ist das Ziel.**

Fuer jeden der 8 Tests gilt genau eine von zwei Behandlungen, und die Wahl ist zu begruenden:

- **(a) Der Test hat den Provider bisher IMPLIZIT ueber den Default bezogen, sein Gegenstand
  ist aber ein anderer** (Sprach-Routing, ElevenLabs, Lifecycle, Flag-Matrix). Dann bekommt
  er den Provider **explizit** und behaelt seine bisherigen Zusicherungen **unveraendert**.
  Wer hier auf Telnyx umstellt und die Polly-/TwiML-Erwartungen mitzieht, hat einen
  Twilio-Renderer-Test in einen Telnyx-Test verwandelt — die Twilio-Abdeckung waere weg,
  ohne dass ein Test rot wird. **Das ist der Schaden, den dieser Schritt ausschliessen soll.**
- **(b) Der Test hat den Default SELBST zum Gegenstand** — das trifft ausschliesslich auf
  `resolveSeedProvider: leer -> DEFAULT_PROVIDER` zu. Der Test bleibt, sein SOLL kippt auf
  Telnyx, und **sein Name muss mitziehen** (er traegt heute "Twilio" im Titel).

Im Report ist je Test zu nennen: (a) oder (b), und warum.

## 5. Neue Zusicherungen

| | Zusicherung | ohne den Fix |
|---|---|---|
| **A** | `DEFAULT_PROVIDER === PROVIDER.TELNYX` — direkt, an einer Stelle | **ROT** |
| **B** | Ein Inbound-Webhook **ohne** erkennbaren Provider-Header laeuft auf den Telnyx-Pfad (der Rueckfall aus `routes/voice.js:262` ist sichtbar und gewollt) | **ROT** |
| **C** | `resolveSeedProvider("")` liefert Telnyx; `resolveSeedProvider("twillio")` liefert weiter `null` (fail-closed, kein stiller Falsch-Carrier) | teils rot |

Zusicherung C haelt ausdruecklich fest, dass die Trennung "leer vs. Muell" bestehen bleibt —
nur Muell ist ein Refusal-Grund. Diese Unterscheidung ist Bestand und darf der Flip nicht
mitnehmen.

## 6. Pre-Mortem

| Ein Jahr spaeter ist es schiefgegangen. Was ist passiert? | Gegenmassnahme |
|---|---|
| *"Die Suite war gruen und hat trotzdem weniger geprueft."* Jemand hat die 8 Tests auf Telnyx gezogen statt den Provider explizit zu machen — die Twilio-Renderer-Abdeckung verschwand lautlos. | Abschnitt 4, Behandlung (a)/(b) je Test im Report begruendet |
| *"Ein Anruf lief ploetzlich ueber den falschen Carrier."* | Praemisse ist gemessen (0 Twilio-Zeilen); zusaetzlich bleibt `resolveSeedProvider` bei Muell fail-closed (Zusicherung C) |
| *"Der Flip hat den Live-Dienst gestoppt."* Die Boot-Pflicht auf `TWILIO_ACCOUNT_SID` blieb bestehen, aber jemand hat gleichzeitig die Env-Keys entfernt. | Abschnitt 2: Boot-Pflicht und Env-Keys sind **nicht** Teil dieser Phase, und die Reihenfolge steht im Plan |
| *"Wir haben den Default umgestellt und dabei den Twilio-Adapter halb entfernt."* | Scope-Regel: diese Phase loescht **nichts** |

## 7. Abnahme

- `npm test` gruen (erwartet 4057, s. Abschnitt 3 zur Abweichung).
- Gegenprobe: Flip zurueckdrehen -> Zusicherung A und B rot -> Flip wieder rein.
- `node --check` auf jede geaenderte `src/`-Datei.
- Smoke-Test: Server lokal starten, `/healthz`, dann `/voice/incoming` **ohne**
  Provider-Header — die Antwort muss der Telnyx-TeXML-Pfad sein
  (`transcriptionEngine="Deepgram"`), nicht der Twilio-TwiML-Pfad (`speechModel=`).
  Das ist der sichtbare Beweis des Flips in einem echten Request.
