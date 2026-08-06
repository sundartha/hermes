# STT-A1 — Eine Wahl fuer die Erkennungs-Engine, pro Adapter uebersetzt

Spezifikation fuer **eine** Phase (`phase-impl-lean`). Belege und Messungen: `tasks/todo.md`.
Auftrag: `tasks/kickoff-anbieter-austauschbarkeit-2026-08-07.md`, Track A.

## 1. Der Befund in einem Absatz

Die Erkennungs-Engine wird an drei Code-Orten unabhaengig voneinander gewaehlt
(`telnyx/voice.js:241`, `telnyx/render.js:119-120`, `twilio/render.js:40`), plus ein vierter
Ort ausserhalb des Repos (das Telnyx-Assistant-Objekt). Vier Wochen lang liefen der
Gather-Pfad auf `nova-3` und der Assistant-Pfad auf `flux` — einem Modell, das deutsches
Telefon-Audio als Englisch erkennt (gemessen 97,0 % / 95,7 % Wortfehlerrate). **Kein
Mechanismus hat diesen Widerspruch sichtbar gemacht.** Das ist die Wurzel eine Ebene unter dem
falschen Modellnamen: nicht die falsche Wahl, sondern dieselbe Entscheidung mehrfach, mit
Erlaubnis auseinanderzulaufen (Clean Code **G5/G22**). Zusaetzlich steht kein STT-Modellwert in
`src/config.js` (**G35**) — Preis: ein Deploy pro Modellwechsel.

## 2. Ziel und Nicht-Ziel

**Ziel:** eine neutrale Wahl an einer Stelle, pro Adapter in dessen Schreibweise uebersetzt,
fail-closed bei Unbekanntem — und ein Test, der das Auseinanderlaufen faengt. Genau das Muster,
das dieses Repo fuer Stimmen bereits traegt (`VOICE_PROFILE` + `voice-locale.js` +
Adapter-Tabellen).

**Ausdrueckliche Nicht-Ziele:**

- **Kein eigener Medien-Stack.** Welche Engines zur Auswahl stehen, bestimmt der
  Telefonie-Anbieter. Wir waehlen nur sauber, einmal und sichtbar aus dessen Liste.
- **`src/bridge.js:197` (`model: "whisper-1"`) wird NICHT angefasst.** Anderer Hersteller
  (OpenAI), andere Engine (`VOICE_ENGINE=realtime`, nicht der Live-Default), eine einzige
  Fundstelle. Keine Duplizierung, also kein Fall fuer diese Naht. Ein Enum ueber zwei
  unvereinbare Anbieterfamilien zu spannen waere ein neuer Defekt.
- **Keine Kopplungstabelle als Produktionscode.** Kein Code im Repo sendet je
  `smart_format`, `numerals`, `keyterm`, `eot_*` (gegruept ueber `src/` und `scripts/`), und
  der Pro-Call-Block kann sie schematisch nicht tragen. Eine Tabelle ohne Aufrufer ist
  Vorratshaltung (**P15**). Die Kopplung lebt stattdessen in der Drift-Probe (Abschnitt 7),
  wo sie einen echten Aufrufer und ein echtes Signal hat.
- **Kein gesendeter Wert aendert sich.** Die Phase ist verhaltens-erhaltend by construction.

## 3. Die Naht — sie trennt GENAU EINE Groesse

**Getrennt wird: welches Erkennungsmodell. Nicht die Sprache, nicht das Endpointing, nicht
die Engine-Zuordnung.**

### 3.1 Die Sprache wird NICHT angefasst — bindend

Die beiden Telnyx-Pfade benutzen bewusst **verschiedene** Sprachformen, beide einzeln belegt:

| Pfad | Sprachform | Beleg |
|---|---|---|
| Gather (TeXML) | volles BCP-47, `de-DE` | `telnyx/render.js:102-107`: *"Die fruehere Annahme 'de allein' war FALSCH und durch echte STT-Billing-Records widerlegt: Telnyx erkennt 'de' nicht als Deutsch -> Fallback auf Englisch"* |
| Assistant (Call-Control-JSON) | blanker Code, `de` | `voice.js:242-248` (`STT_LANGUAGE_HINTS`), gepinnt in `test/telnyx-call-control.test.js:243`, live im Assistant-Objekt bestaetigt |

**Der wahrscheinlichste Fehler des Umsetzenden ist, das fuer Duplizierung zu halten und zu
vereinheitlichen. Es ist keine.** Das neue Modul **nimmt kein Sprach-Argument entgegen und
exportiert nichts Sprach-Foermiges**. Braucht es eines, ist die Naht falsch gezogen.

### 3.2 Engine und Modell gehoeren bei Telnyx in EINEN Datensatz

`telnyx/render.js:98-99` haelt fest: *"der model-Vendor MUSS zu transcriptionEngine passen"*.
`transcriptionEngine` und `model` duerfen deshalb **nicht** zwei getrennt konfigurierbare
Groessen werden — das schuefe eine **neue** Divergenzachse, wo heute keine ist. Ein
Tabelleneintrag liefert beide zusammen.

### 3.3 Drei Verbraucher, drei Anbieter-Vertraege

| Aufrufer | Huelle | braucht |
|---|---|---|
| `telnyx/render.js` `gatherAttrs` | TeXML-Attribute | `transcriptionEngine="Deepgram"` **und** `model="deepgram/nova-3"` |
| `telnyx/voice.js` `transcriptionFields` | JSON `transcription.model` | nur den Modell-String, kein Engine-Feld |
| `twilio/render.js` `gatherOpts` | TwiML-Attribut | `speechModel="deepgram_nova-2-general"` — eigene Schreibweise, andere Generation |

Dass Telnyx auf `nova-3` und Twilio auf `nova-2-general` steht, ist **eine** Absicht in zwei
Anbieter-Schreibweisen (Twilio bietet nova-3 nicht an) — genau wie `DE_FEMALE_NEURAL` auf
`Polly.Vicki-Neural` bzw. `Azure.de-DE-KatjaNeural` abbildet.

## 4. Struktur

Vorschlag; der Plan-Agent darf begruendet abweichen, **nicht** aber von den Regeln in 3.1-3.2
und den Tests in Abschnitt 6.

1. **`src/telephony/stt-profile.js`** — rein (kein IO, kein `config`-Import), analog
   `voice-locale.js`: das neutrale Enum. **Heute genau EIN Mitglied.** Es benennt die Absicht,
   nicht den Hersteller, nicht die Generation, nicht die Sprache. Vorschlag:
   `STT_PROFILE.ACCURATE` = "hoechste verfuegbare mehrsprachige Erkennungsgenauigkeit".
   **Nicht** nach Vollstaendigkeit streben: `deepgram/flux` als zweites Mitglied waere ein
   Enum-Eintrag fuer einen empirisch disqualifizierten Wert.
2. **`src/telephony/adapters/telnyx/stt-model.js`** — die Telnyx-Uebersetzung, fail-closed
   (`throw` bei unbekanntem Profil, wie `voiceAttrs`). Liefert Engine und Modell als **einen**
   Datensatz. Von `render.js` UND `voice.js` importiert — Praezedenz: `elevenlabs-voice.js`
   wird ebenfalls von beiden genutzt. **Die Tabelle darf nicht in einer der beiden Dateien
   wohnen**, sonst ist die Duplizierung nur umgezogen.
3. **`src/telephony/adapters/twilio/render.js`** — eigene Tabelle neben `TWILIO_VOICE_NAME`,
   fail-closed. Ein Aufrufer, eine Datei.
4. **`src/config.js`** — `STT_PROFILE` als Env-Variable mit Default auf das heutige Verhalten;
   dazu `.env.example`. **Und `test/helpers.js` `BASE_ENV` nachziehen** — sonst leckt die echte
   `.env` in alle Spawn-Tests (bekannte Drift-Falle).
5. **`src/boot-guard.js`** — ungueltiges `STT_PROFILE` bricht den Boot ab. **Pflicht, nicht
   Kuer:** ohne Boot-Pruefung trifft ein Tippfehler im Render-Dashboard erst den fail-closed
   `throw` im **Render-Pfad des laufenden Anrufs**. Heute kann das nicht passieren, weil der
   String im Code steht; die Env-Variable darf dieses Risiko nicht neu einfuehren.
6. **Transportweg zu den Renderern:** die Registry injiziert das **Profil** (nicht den
   aufgeloesten String) — Praezedenz `registry.js:83-88` (`elevenLabs`, Lazy-Arrow,
   "config-Bindung an der Kompositionsstelle", **P15**). Twilio bekommt dafuer denselben
   Wrapper wie Telnyx. `voice.js` liest `config` ohnehin direkt (`:265`, `:327`).
   **Verboten:** Telnyx-Gather und Telnyx-Assistant aus zwei verschiedenen Config-Keys
   speisen — dann waere die Duplizierung nur von den Modell-Strings auf die Env-Keys verschoben.

**Nicht** in `directives.js`: die Modellwahl ist eine globale Betreiber-Entscheidung, kein
Pro-Call-Wert wie `voiceProfile`. Ein STT-Feld an der Direktive koppelte Modellwahl an Sprache.

## 5. Verhaltens-Erhaltung ist eine harte Anforderung

Die gerenderten TeXML-/TwiML-Bytes muessen **unveraendert** bleiben. Die Attribut-Reihenfolge
ist vertraglich (beide Renderer serialisieren in Einfuege-Reihenfolge, die Snapshot-Tests
nageln sie fest):

- Telnyx bleibt: `input, language, transcriptionEngine, model, speechTimeout`
- Twilio bleibt: `input, language, speechTimeout, speechModel, actionOnEmptyResult`

Werden die uebersetzten Felder an anderer Position eingespleisst, gehen die Snapshots rot,
**obwohl kein Defekt vorliegt**. Das ist kein Grund, die Snapshots anzupassen — es ist das
Signal, dass die Einfuege-Position falsch ist.

## 6. Tests — und die ehrliche Trennung zwischen Beleg und Fangnetz

Neue Datei **`test/stt-model-seam.test.js`** (nicht in `telnyx-render.test.js` einhaengen: die
Aussage betrifft drei Adapter-Dateien und ginge zwischen den Byte-Snapshots unter).

**Warnung vorab:** der naheliegende Test — *"Telnyx-Gather und Telnyx-Assistant benutzen
denselben Modell-String"* — ist **heute schon gruen** (beide stehen seit 2026-08-06 auf
`nova-3`). Er ist als Regressionsfang wertvoll, **belegt den Fix aber nicht**. Wer ihn als
Beleg verkauft, verletzt die Regel "ein gruener Test ist erst ein Beleg, wenn er ohne den Fix
rot ist".

| | Zusicherung | ohne den Fix |
|---|---|---|
| **A** | Eine **unbekannte** Wahl, in die Adapter injiziert -> `assert.throws` | **ROT** — heute ignorieren beide Renderer jede solche Angabe und rendern klaglos `deepgram/nova-3`. Verhaltens-Rot, kein "Modul fehlt"-Rot. **Das ist der Beleg.** |
| **B** | Dieselbe **gueltige** Wahl durch alle drei Aufrufer ergibt drei adaptertypische Schreibweisen — TeXML `model` **mit** `transcriptionEngine`, Assistant-Body `transcription.model` **ohne** Engine-Feld, TwiML `speechModel` | **ROT nur, wenn die Wahl als EINGABE durchgereicht wird.** Als reiner Wertevergleich formuliert waere er ohne den Fix gruen und damit wertlos. |
| **C** | Schleife ueber **alle** Enum-Mitglieder x alle Adapter: jedes Mitglied loest ueberall auf | gruen heute, gruen nachher — **Fangnetz**: ein neues Mitglied ohne Adapter-Uebersetzung wird rot. Muster: `test/directive-render.test.js:212-219` |
| **D** | Sprach-Kontrast festgenagelt: Gather-`language` ist `"de-DE"`, Assistant-`transcription.language` ist `"de"`, **und das ist Absicht** (mit Verweis auf beide RCAs) | gruen heute — **Fangnetz** gegen den Vereinheitlichungs-Reflex aus 3.1. Heute vergleicht kein Test die beiden Formen. |
| **E** | Boot mit ungueltigem `STT_PROFILE` bricht ab; mit gueltigem kommt hoch (Spawn-Test) | ROT (Guard existiert nicht) |

C und D sind im Test-Kommentar **ausdruecklich als Fangnetz zu kennzeichnen**, nicht als Beleg.

Harness existiert: `renderDirectives` (beide Adapter, exportiert) und `telnyxVoice.startAssistant`
mit `stubFetch` (Muster `test/telnyx-call-control.test.js:229-235`).

**Gegenprobe ist Pflicht:** Fix ausbauen, A und B rot sehen, Fix zurueck. Erst dann sind sie
ein Beleg.

## 7. Die Drift-Probe — der vierte Ort

`scripts/telnyx-stt-drift.mjs`, **nur lesend**:

1. `GET /v2/ai/assistants/<id>`, Momentaufnahme nach `data/evidence/telnyx-config/`
   (gitignored) — Bestandspraxis, s. Kickoff.
2. Vergleicht `transcription.model` gegen die Telnyx-Uebersetzung des konfigurierten Profils.
   Abweichung -> Meldung + **Exit != 0**.
3. Meldet zusaetzlich Einstellungen, die fuer das effektive Modell laut Spec **inert** sind.
   Heute liefert das sofort einen echten Befund: `eot_threshold: 0.9` und `eot_timeout_ms: 5000`
   stehen flux-only an einem nova-3-Objekt.
4. Nennt ausdruecklich die Grenze: **ob der Pro-Call-Block die `settings` des Objekts loescht,
   ist unbelegt** (s. `tasks/todo.md`, Schritt 7).

Getestet wird die **reine Vergleichslogik** (Eingabe: zwei Objekte, Ausgabe: Befundliste) —
nicht der HTTP-Aufruf. Nie den API-Key loggen (Absolute Regel 4).

**Warum die Probe und nicht ein Test:** kein Repo-Test kann Remote-Zustand sehen, und der
Provisionierer fasst `transcription` bewusst nicht an
(`scripts/telnyx-assistant-provision.mjs:141`, `PRESERVED_SAFETY_FIELDS`). Der vierte Ort hat
heute **kein** Netz. Ein einmaliger Lauf der Probe ist Teil der Abnahme, keine Empfehlung.

## 8. Pre-Mortem

| Ein Jahr spaeter ist der Umbau gescheitert. Was ist passiert? | Gegenmassnahme IN der Phase |
|---|---|
| *"Wir haben zentralisiert, und der vierte Ort ist trotzdem weggedriftet."* Jemand patcht das Assistant-Objekt im Portal, der Code bleibt stehen — B-7 mit vertauschten Rollen. | Drift-Probe (Abschnitt 7), ihr Lauf ist Teil der Abnahme |
| *"Die Naht hat ein Sprach-Argument bekommen, und die Erkennung lief wieder auf Englisch."* | 3.1 als bindende Regel, Modul ohne Sprach-Argument, **Test D** nagelt den Kontrast fest |
| *"Der Modellwechsel per Env hat alle Anrufe getoetet."* Tippfehler in der Render-Umgebung, fail-closed `throw` im Render-Pfad, jeder Anruf stirbt am Greeting — und zwar erst nach dem Deploy. | Boot-Guard (4.5) + **Test E**. Wer den Boot-Guard nicht will, laesst die Env-Variable weg und nimmt die Code-Konstante. Die Mischung aus Env-Knopf ohne Boot-Pruefung ist die einzige unvertretbare Variante. |
| *"Wir tragen eine Abstraktion mit einem einzigen Enum-Mitglied."* | Akzeptiertes Risiko, offen benannt: den Nutzen traegt die **Tabelle**, nicht die Aufzaehlung. |

## 9. Betroffene Bestands-Tests (namentlich, nicht abschliessend)

Byte-Snapshots und Reihenfolge-Invarianten: `test/telnyx-render.test.js` (u. a. Z. 102, 194),
`test/directive-render.test.js` (Z. 212-219), `test/telnyx-play-render.test.js`,
`test/telnyx-elevenlabs-render.test.js`, `test/telnyx-elevenlabs-inbound.test.js`,
`test/telnyx-call-control.test.js` (Z. 243, 255, 269).

**Zwei mit Sonderbehandlung:**

- `test/provider-threading.test.js:75-117` benutzt die **Abwesenheit** von `speechModel` als
  Provider-Diskriminator. Ein `speechModel`-foermiges Attribut auf dem Telnyx-Pfad macht ihn
  rot **und** entwertet den Diskriminator.
- `test/telnyx-assistant-merge-guard.test.js:52` traegt `{model:"deepgram/flux",
  language:"multi"}` als Fixture des Preserve-Guards. **Nicht "modernisieren"** — auf `nova-3`
  gezogen waere sie identisch mit dem Produktionswert, und gleiche Fixture-Werte testen nichts.
