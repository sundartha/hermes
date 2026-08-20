# OC-P2 — Wirkung auf dem Live-Pfad (ElevenLabs)

Bauanweisung. Allein tragfaehig: du brauchst NUR diese Datei und den Code.
Voraussetzung: **OC-P1 ist gemergt** (Praedikat `src/callee-is-owner.js`, Feld
`call.calleeIsOwner`, Schalter `OWNER_SELF_CALL_ENABLED`, Default aus).
Repo-Konventionen: ESM, kein Build-Step, keine neuen Dependencies, Kommentare/Doku
deutsch OHNE Umlaute — **Ausnahme: gesprochene deutsche Strings tragen echte Umlaute**
(`test/de-umlaut-orthography.test.js` haelt das fest).

**Risikoklasse hoch.** Diese Phase beruehrt Absolute Regel 2 (Offenlegung) und die
Erlaubnis-Karte des fremden Agenten.

---

## 1. Worum es geht

Traegt ein Anruf `call.calleeIsOwner === true`, dann soll er auf dem heute live laufenden
ElevenLabs-Weg

1. **ohne den langen Offenlegungssatz** eroeffnen — aber weiterhin
   **KI-identifizierend** ("hier ist dein KI-Assistent", 2.1), und
2. den Auftraggeber **direkt ansprechen** statt ueber ihn in der dritten Person zu reden,
   und
3. sofort in den vollen Offenlegungssatz zurueckfallen, wenn am Apparat jemand anderes ist
   (Pflichtzeile im Prompt-Block, 2.2).

Bei jedem anderen Ziel bleibt alles exakt wie heute — inklusive des byte-identischen
Anfragekoerpers an den Anbieter.

### 1.1 Wie die Eroeffnung heute entsteht (lies das, bevor du irgendetwas anfasst)

- Der Offenlegungssatz ist **statischer Text beim Anbieter**, nicht in unserem Code
  zusammengesetzt: `elevenlabs/agent_configs/outbound-agent.template.json`,
  `agent.conversation_config.agent.first_message` (Basissprache EN) und
  `agent.conversation_config.language_presets.{de,fr}.overrides.agent.first_message`.
  Wortlaut je Sprache byte-identisch aus `src/i18n/locales.js`
  (`LOCALES.<lang>.disclosure`), nur `${ownerName}` → `{{owner_name}}`.
- Pro Anruf variabel ist darin **nur** `{{opening_line}}` (Grund-Zeile, serverseitig
  erzeugt und validiert, `src/elevenlabs/opening-line.js`) und der Wert von
  `{{owner_name}}`.
- Die Referenz, gegen die Vorlage und Presets gemessen werden, ist `providerOpeningFor`
  (`src/elevenlabs/call-locale.js:76-94`). **Diese Funktion wird NICHT angefasst.**
- Ein Ueberschreiben von `first_message` pro Anruf ist heute dreifach verhindert: unser
  Code baut keins; die Whitelist `OVERRIDE_ALLOWED_LEAF_PATHS`
  (`src/elevenlabs/convai.js:84-122`) bricht den Anrufstart ab; und die Erlaubnis-Karte
  des Agenten selbst (`platform_settings.overrides.conversation_config_override.agent.first_message`)
  steht auf `false`, weshalb der Anbieter eine Uebersteuerung still ignorieren wuerde.

### 1.2 Der gewaehlte Weg — und die verworfenen

**Gewaehlt: Uebersteuerung von `first_message` NUR im Owner-Fall.**
Der Offenlegungssatz bleibt fuer alle anderen Anrufe statischer Anbieter-Text. Selbst ein
Totalausfall unseres Codes kann ihn Dritten gegenueber nicht entfernen.

**Verworfen: `first_message` zu einer Variablen machen** ("`{{opening}}`, alles
serverseitig komponieren"). Das verlegte den Artikel-50-Anker aus dem statischen
Anbieter-Text in unseren Code — ein einziger Kompositionsfehler entfernte dann die
Offenlegung fuer JEDEN. Die Vorlage begruendet das bereits selbst
(`agent._first_message_hinweis`).

**Verworfen: ein zweiter, offenlegungsfreier Agent.** Verdoppelt Prompt, Werkzeuge,
Vorlage und Drift-Waechter fuer denselben Gewinn und traegt dasselbe Restrisiko. Bleibt
als Rueckfall vorgehalten, falls die Messung nach dem Live-Gang zeigt, dass das
`language_presets`-Preset die Uebersteuerung schlaegt.

**Die Asymmetrie, die diesen Weg vertretbar macht:** der Anbieter ignoriert nicht
freigeschaltete Uebersteuerungen STILL. Fuer den Offenlegungssatz waere das gefaehrlich
(er verschwaende lautlos). Fuer die Owner-Eroeffnung ist es harmlos: sie verschwindet,
die Offenlegung bleibt. Jeder Fehler dieses Wegs zeigt in Richtung **mehr** Offenlegung.

**Ungeklaert, bewusst offen:** ob eine Client-Uebersteuerung das `language_presets`-Preset
fuer `de`/`fr` schlaegt, ist am Anbieter NICHT gemessen. Beide Ausgaenge sind
ungefaehrlich (gewinnt das Preset, hoert der Owner die Offenlegung — Feature wirkungslos,
Pflicht uebererfuellt). Das wird am ersten echten Anruf gemessen, nicht geraten. **Baue
nichts, was diese Frage vorwegnimmt.**

---

## 2. Was zu bauen ist

### 2.1 Gesprochene Owner-Eroeffnung je Sprache (`src/i18n/locales.js`)

Neuer Schluessel je Sprachbundle, direkt bei `disclosure` / `openingReasonFallback`:

```js
ownerOpening: (firstName) => `...`
```

Wortlaute (verbindlich, gesprochene Strings — DE mit echten Umlauten, wo welche
vorkommen):

| Sprache | Wortlaut |
|---|---|
| `de` | `Hallo ${firstName}, hier ist dein KI-Assistent.` |
| `fr` | `Bonjour ${firstName}, c'est ton assistant IA.` |
| `en` | `Hi ${firstName}, it's your AI assistant.` |

**Das Wort "KI" / "IA" / "AI" ist tragend und darf in keiner Sprachvariante wegfallen.**
Grund (Plan 1.4): das Praedikat beweist eine Aussage ueber die NUMMER — dass die gewaehlte
Nummer die hinterlegte Nummer des Tenants ist. Es beweist NICHT, dass die PERSON am
Apparat der Auftraggeber ist. `normalizePrivateNumber` kennt keine
Mobilfunk-Beschraenkung und keinen Geraetebezug (`src/store/state-ops.js:2127-2136`), ein
Festnetz- oder Gemeinschaftsanschluss ist also zulaessig. Hebt dort jemand anderes ab,
muss schon der erste Satz sagen, dass eine Maschine spricht; das Wort "Assistent" allein
leistet das nicht. Schreib genau diese Begruendung als Kommentar an den Schluessel — sonst
faellt das Wort beim naechsten Kuerzen der Begruessung heraus.

Weitere Begruendung im Kommentar festhalten:

- Direkte Anrede, Du-Form im Deutschen, Vorname — der Auftraggeber spricht mit seinem
  eigenen Assistenten.
- **Keine Selbst-Vorstellung als "Assistent von <Name>"**: gegenueber dem Auftraggeber
  waere das die dritte Person ueber den Zuhoerer.
- **Kein Hinweis auf eine Zusammenfassung** fuer "meinen Auftraggeber" — der Auftraggeber
  ist der Zuhoerer.
- Kurz. Die Eroeffnung ist im Anbieter-Agenten gegen Unterbrechung gesperrt
  (`disable_first_message_interruptions`), also ist jedes ueberfluessige Wort eine
  Sekunde, in der der Owner nicht dazwischenreden kann.

Es gibt **keinen Namens-Rueckfall**. Ist `firstName` leer, wird gar keine Uebersteuerung
gebaut (2.4) und der statische Offenlegungs-Rahmen spricht — fail-closed.

### 2.2 Prompt-Sektion fuer den Owner-Fall (`src/i18n/prompts/en.js`)

Der Prompt des EL-Agenten ist durchgehend englisch, unabhaengig von der gesprochenen
Sprache; die Bausteine dafuer liegen in `LOCALES.en.prompt` (in `src/elevenlabs/outbound.js`
als `EN_PROMPT` importiert, Zeile 338). Neuer Baustein dort, Muster
`constraintsPrecedence` / `background`:

```
THIS CALL IS AN EXCEPTION - YOU ARE DIALLING YOUR OWN PRINCIPAL'S OWN NUMBER:
This number is <ownerName>'s own number, so you are expected to be speaking with <ownerName> - not with a third party on their behalf. Wherever anything else in these instructions distinguishes "the other party" from "your principal", treat both as the same person for this call.
Do not introduce yourself as an assistant acting for someone. Do not say that this conversation will be summarised for anyone. Never speak about your principal in the third person - speak to them.
Address them directly, by their first name, in the informal register their language offers.
There is nobody else to consult and no message to pass on: if something is unclear, ask them directly.
IF THE PERSON WHO ANSWERED IS NOT <ownerName>: say this sentence immediately, word for word, before anything else - "<disclosureSentence>" - and from then on run the call exactly as a normal call made on <ownerName>'s behalf: third person, message-taking, no informal address. This applies whenever they say they are someone else, or it becomes clear they are, even mid-call. Never leave a person who is not <ownerName> unaware that they are talking to an AI.
```

`<ownerName>` und `<disclosureSentence>` werden **serverseitig eingesetzt** (2.3), nicht
als `{{owner_name}}` stehen gelassen: ElevenLabs ersetzt keine Platzhalter innerhalb von
Variablenwerten, und ein uebrig gebliebenes `{{...}}` waere im Prompt sichtbarer Muell.

`<disclosureSentence>` ist der Wortlaut aus `LOCALES.<lang>.disclosure(ownerName)` — also
**dieselbe eine Quelle**, aus der die statische `first_message` und die Presets ihn
beziehen, in der GESPROCHENEN Sprache des Anrufs (nicht Englisch, obwohl der Prompt
englisch ist). Der Satz wird dem Modell fertig mitgegeben und nicht umschreiben gelassen:
ueber den Wortlaut einer Rechtspflicht entscheidet kein Modell. Das ist **keine**
Verlegung des Artikel-50-Ankers in unseren Code (1.2): der Anker fuer Dritte bleibt der
statische Anbieter-Text; dies hier ist ein zusaetzlicher Rueckfall, der nur greifen kann,
wenn die Ausnahme bereits aktiv ist.

Diese letzte Zeile ist **Pflicht** (Plan 1.4/7.9) und der gutglaeubige Normalfall, nicht
der Missbrauchsfall: der Auftraggeber darf einen Festnetz- oder Familienanschluss als
eigene Nummer hinterlegen, und dann geht irgendwann jemand anderes ran. Ohne diese Zeile
verbietet der Block dem Agenten ausdruecklich, sich als KI im Auftrag von jemandem
vorzustellen — und ein ahnungsloser Mensch bliebe ahnungslos.

Der Satz "Do not say that this conversation will be summarised for anyone" ist kein
Fuellwerk: es gibt einen offenen Bestandsbefund, in dem der Agent mitten im Gespraech ein
Fragment des Offenlegungssatzes wiederholt hat (`tasks/gq-chain-state.md:1636-1639`,
Wurzel unbekannt). Faellt die Offenlegung aus der `first_message`, ist der Prompt die
einzige verbliebene Quelle dafuer — deshalb wird sie dort ausdruecklich verboten.

### 2.3 Neue dynamische Variable `{{callee_relation}}`

In `src/elevenlabs/outbound.js`, `dynamicVariables(...)` (Zeile 742-760): ein weiterer
Schluessel, gebaut wie `constraintsText` / `backgroundText` (siehe Zeile 524-528 und
547-558) — ein Text-Baustein, der **`""` oder einen fertigen Block mit fuehrendem `\n`**
liefert, nie `null`, nie `undefined`:

```js
callee_relation: calleeRelationText({ call, ownerName, disclosure }),
```

- `call.calleeIsOwner !== true` ⇒ `""`. Damit rendert der Prompt am Anbieter **exakt den
  heutigen Text**. Leere Strings als Variablenwert sind erprobt: `constraints` und
  `background` gehen heute regelmaessig leer hinaus.
- `call.calleeIsOwner === true` ⇒ der Block aus 2.2 mit eingesetztem `ownerName` UND
  eingesetztem Offenlegungssatz.
- Strikt `=== true` pruefen. `undefined` (Bestands-Datensatz) heisst NICHT-Owner.
- Der eingesetzte Offenlegungssatz kommt aus `LOCALES.<lang>.disclosure(ownerName)` mit
  der Sprache dieses Anrufs — dieselbe Quelle wie ueberall sonst, keine zweite Fassung.
  Enthaelt der zusammengesetzte Block wider Erwarten `{{`, wird er NICHT gesendet
  (`""`), denn ein unversorgter Platzhalter im Prompt ist im besten Fall Muell und im
  schlechtesten der 1008-Abbruch (2.4, Bedingung 4).

`originateCall` (Zeile 1226 ff.) holt heute `const { ownerName } = store.tenantContext(...)`.
Erweitere auf `const { ownerName, firstName } = ...` — `firstName` liegt dort bereits
(`src/store/state-ops.js:1685`).

### 2.4 Uebersteuerung der `first_message` im Owner-Fall

`conversationConfigOverride(locale)` (`src/elevenlabs/outbound.js`, direkt vor
`startCallBody`) baut heute:

```js
{ agent: { language: locale.language }, ...(locale.voiceId ? { tts: { voice_id: locale.voiceId } } : {}) }
```

Ergaenze einen dritten, **bedingten** Zweig nach demselben Muster wie der
`tts`-Zweig (weglassen statt leer setzen):

- Baue zuerst den Text:
  `ownerFirstMessage = [locale.ownerOpening(firstName), verifiedOpeningLine({ call, locale: localeFor(locale.language) })].filter(Boolean).join(" ")`
  — dieselbe Grund-Zeile wie im Bestandsfall, nur mit der Owner-Begruessung davor statt
  der Offenlegung.
- Der Zweig wird **nur** gesetzt, wenn ALLE gelten:
  1. `call.calleeIsOwner === true`,
  2. `firstName` ist ein nicht-leerer String nach `trim()`,
  3. der zusammengesetzte Text ist nach `trim()` nicht leer,
  4. der Text enthaelt **kein** `{{`.
- Sonst: der Schluessel `agent.first_message` **existiert im Koerper gar nicht**. Nicht
  `undefined`, nicht `""`, nicht `null` — gar nicht. Ein leerer Wert naehme dem Agenten
  seine Eroeffnung, ohne eine zu setzen; das ist derselbe Fehler, den der
  Bestandskommentar am `tts`-Zweig bereits benennt.

Bedingung 4 ist kein Aberglaube: ein Platzhalter in der `first_message`, fuer den keine
Variable mitgeschickt wird, beendet das Gespraech beim Anbieter unmittelbar nach dem
Abheben (Fehlercode 1008, der Angerufene hoert Stille) — belegt im Kopfkommentar von
`test/el-vorlage-variablen-abgleich.test.js`.

`startCallBody(...)` reicht die dafuer noetigen Werte durch (`call`, `firstName`); halte
die Signatur bei EINEM Objekt-Argument, wie im Bestand.

### 2.5 Der Waechter wird kontextabhaengig — und strenger als der Anbieter

`src/elevenlabs/convai.js`:

```js
export const OVERRIDE_ALLOWED_LEAF_PATHS = Object.freeze(["agent.language", "tts.voice_id"]);
```

bleibt die **Basis-Menge**. Dazu kommt eine zweite, ausdruecklich benannte Menge:

```js
export const OVERRIDE_OWNER_ONLY_LEAF_PATHS = Object.freeze(["agent.first_message"]);
```

`assertOverrideWhitelisted(body, callId, calleeIsOwner)` erlaubt die Basis-Menge immer und
die Owner-Menge **nur** bei `calleeIsOwner === true`. Alles andere bricht den GESAMTEN
Anrufstart ab, wie heute: Wurf, kein Netzzugriff, kein stiller Filter.

- Der neue Parameter hat den fail-closed Default `false`. Ein kuenftiger Aufrufer, der ihn
  vergisst, bekommt die strenge Menge.
- `startOutboundCall({ fetchImpl, account, body, callId, calleeIsOwner })` reicht ihn
  durch; der einzige Aufrufer ist `originateCall` in `src/elevenlabs/outbound.js` und
  uebergibt `call.calleeIsOwner === true`.
- Beide Seiten lesen damit **dasselbe Feld desselben Datensatzes**. Es gibt keine zweite
  Quelle, die abweichen koennte.

Das ist strenger als der Anbieter: der ignoriert eine nicht freigeschaltete Uebersteuerung
still, wir brechen ab. Schreib genau das als Begruendung an den Code.

### 2.6 Rueckfrage-Tor bei Owner-Anrufen zu

In `originateCall` (`src/elevenlabs/outbound.js:~1240`):

```js
const consultAllowed = consultAllowedFor(store.resolveProfile(call.tenantId)) && call.calleeIsOwner !== true;
```

Den eigenen Auftraggeber zu fragen, waehrend man mit ihm telefoniert, ist sinnlos. Der
Prompt deckt den `unavailable`-Zustand bereits vollstaendig ab (Abschnitt "REACHING YOUR
PRINCIPAL DURING THIS CALL") — es braucht **keinen** neuen Prompt-Text dafuer.

Das Recherche-Tor (`lookupAllowed`) bleibt unveraendert.

### 2.7 Anbieter-Vorlage `elevenlabs/agent_configs/outbound-agent.template.json`

Genau vier Aenderungen an der Vorlage (Punkte 1-4), mehr nicht — plus zwei
Kommentar-Nachzuege im Code (Punkt 5), die keine Vorlagen-Aenderung sind:

1. **Prompt-Platzhalter.** In `agent.conversation_config.agent.prompt.prompt` wird
   `{{callee_relation}}` an das ENDE der PERSONA-Zeile angehaengt (heute Zeile 2 des
   Prompt-Texts, endend auf `... not a human.`). Der Block bringt seinen eigenen
   fuehrenden Zeilenumbruch mit (2.3), also kommt hier kein zusaetzliches Leerzeichen und
   kein zusaetzlicher Umbruch dazu. Die Sektion muss ganz oben stehen: sie hebt Aussagen
   auf, die weiter unten stehen.
2. **Erlaubnis-Karte.**
   `platform_settings.overrides.conversation_config_override.agent.first_message`
   von `false` auf `true`.
3. **Die Begruendung als GESCHWISTER-Schluessel, niemals in der Karte selbst** (deutsch,
   ohne Umlaute). Konkret: den bestehenden `_overrides_hinweis` erweitern — er liegt auf
   `platform_settings`-Ebene, als Geschwister von `overrides`
   (`elevenlabs/agent_configs/outbound-agent.template.json:875`, Karte ab `:876`). Ein
   neuer Schluessel auf DERSELBEN Ebene ist ebenfalls zulaessig.

   **Der Hinweis darf NICHT innerhalb von `overrides.conversation_config_override`
   stehen.** Genau dieses Dict ist der besessene Pfad und wird beim Push ERSETZT
   (`scripts/push-elevenlabs.mjs`, Kopfkommentar: "Dict- und Listenfelder ERSETZT es") —
   ein Schluessel darin reiste also mit zum Anbieter. Dasselbe gilt weiterhin fuer
   `_`-Schluessel INNERHALB eines `language_presets`-Eintrags (die Vorlage sagt das bei
   `_language_presets_offenlegung_hinweis` selbst).

   Inhalt: warum die Karte geoeffnet wird, was unser Code dagegen setzt (Bedingungen aus
   2.4 + Waechter aus 2.5), und dass der statische Offenlegungssatz in `first_message` und
   in den `de`/`fr`-Presets UNVERAENDERT bleibt.

4. **Den ueberholten Satz im Besitz-Eintrag nachziehen.** Der `_hinweis` an
   `_besitz.felder[feld=conversation_config_override_erlaubnisse]` behauptet "ZWEI
   ABWEICHUNGEN VOM LIVE-ZUSTAND (tts.voice_id, conversation.text_only)". Der Drift-Lauf
   vom 2026-08-20 meldete 38/38 mit nur `retention_days`/`record_voice`
   (`tasks/gq-chain-state.md:1612-1620`) — die zwei PUSH-ABSICHTEN sind seither
   offensichtlich geschrieben. **Du hast in dieser Phase keinen Netzzugriff und darfst
   nicht messen.** Also: den Satz nicht loeschen und nicht "korrigieren", sondern um einen
   datierten Zusatz ergaenzen, der (a) den Drift-Beleg vom 2026-08-20 nennt und (b)
   festhaelt, dass der Live-Stand der Karte vor dem naechsten Push LESEND zu belegen ist
   (Runbook 8.3/1b). Grund: stimmte der alte Satz noch, flippte derselbe Push zusaetzlich
   `tts.voice_id` — und unser Code sendet `tts.voice_id` bei JEDEM Anruf
   (`conversationConfigOverride`), das waere eine Stimm-Aenderung fuer alle Anrufe im
   selben Zug.

5. **Zwei Code-Kommentare nachziehen** (kein Verhalten, aber sie behaupten sonst etwas
   Falsches):
   - `src/elevenlabs/outbound.js:693` — "Es sind genau die zwoelf" wird dreizehn;
     `{{callee_relation}}` in die Aufzaehlung aufnehmen.
   - `src/elevenlabs/call-locale.js:105-108` — "`agent.first_message` steht NICHT auf der
     weissen Liste (convai.js) und darf es nicht" ist ab dieser Phase falsch. Neuer,
     engerer Wortlaut: `agent.first_message` steht auf der **Owner-Menge**
     (`OVERRIDE_OWNER_ONLY_LEAF_PATHS`) und wird ausschliesslich bei
     `call.calleeIsOwner === true` gesendet; fuer jeden anderen Anruf bleibt der Traeger
     je Sprache das `language_preset` am Agenten. Die Funktion `providerOpeningFor`
     selbst bleibt unveraendert (Invariante 2) — hier aendert sich NUR der Kommentar.

**Ausdruecklich unveraendert:** `agent.first_message`,
`language_presets.{de,fr,es}`, `disable_first_message_interruptions`,
`transcribe_on_disabled_interruptions`, alle Datenschutz-/Aufbewahrungsfelder, alle
Werkzeuge.

**Kein `npm run elevenlabs:push`, kein `npm run elevenlabs:drift` in dieser Phase.** Beide
sind Owner-Handlungen im Live-Runbook. Der Push ist ausserdem nur mit `--ausfuehren`
schreibend und wird hier nicht angefasst.

### 2.8 Doku-Eintraege (Teil dieser Phase, weil die Ausnahme ab hier wirkt)

- **`CLAUDE.md`, Absolute Regel 2 (OFFENLEGUNG):** den Block "Owner-Entscheidung
  2026-08-20 (OC)" einfuegen. Der Wortlaut steht in `PLAN-OWNER-CALL.md`, Abschnitt 1.3,
  und ist woertlich zu uebernehmen — nicht umzuformulieren.
- **`PLAN-SECURITY.md`:** den Abschnitt "Offen (Launch-Blocker): Besitz-Verifikation der
  eigenen Nummer" einfuegen. Wortlaut in `PLAN-OWNER-CALL.md`, Abschnitt 5.4, ebenfalls
  woertlich.

Kurzfassung des Grundes, falls du ihn brauchst: `tenant.privateNumber` ist Format- und
land-validiert (`normalizePrivateNumber`, `src/store/state-ops.js:2127-2136`), aber
**nicht eigentums-verifiziert**. Wer eine fremde Nummer hinterlegt, bekommt einen
KI-Anruf ohne Offenlegung an einen Dritten. Vor dem Launch akzeptiert (alle aktiven
Accounts gehoeren uns), danach nicht.

---

## 3. Invarianten (verletzen = Phase durchgefallen)

1. **Fuer jedes Nicht-Owner-Ziel ist der Anfragekoerper des Anrufstarts byte-identisch zum
   Bestand.** Kein `agent.first_message` im Uebersteuerungs-Objekt, und
   `callee_relation` ist der leere String.
2. **`providerOpeningFor` (`src/elevenlabs/call-locale.js`) wird nicht angefasst.** Der
   statische Rahmen und die de/fr-Presets beginnen weiterhin byte-identisch mit dem
   Offenlegungssatz; `test/elevenlabs-anrufstart.test.js` T5(c) und T5(e) bleiben
   unveraendert gruen.
3. **`disclosureSentence` (`src/claude.js:392-397`) bleibt unbedingt.** Es gibt keine
   Variante, die `""` liefert. Die Verzweigung sitzt bei den Zusammensetzern, nie beim
   Wortlaut-Lieferanten.
4. **Die Owner-Eroeffnung enthaelt keine `{{...}}`-Platzhalter.**
4b. **Die Owner-Eroeffnung identifiziert die KI** — in jeder Sprache, per Test gepinnt.
   Ein Wortlaut ohne `KI`/`IA`/`AI` ist ein Phasenfehlschlag, kein Stilfrage.
4c. **Der Owner-Prompt-Block traegt die Rueckfallzeile aus 2.2** mit dem vollstaendigen
   Offenlegungssatz der Anrufsprache. Fehlt sie, ist die Phase durchgefallen.
5. **Der Schalter bleibt Teil des Praedikats.** Diese Phase liest ausschliesslich
   `call.calleeIsOwner` und fragt `config.voice.ownerSelfCallEnabled` NICHT noch einmal
   ab. Zwei Auswertungen desselben Schalters sind zwei Wahrheiten.
6. **Kein bestehender Offenlegungs-Test wird veraendert.** Faellt einer um, ist das ein
   Befund fuer den Phasenbericht, kein Anpassungsbedarf.
7. `LLM_PROVIDER=anthropic npm test` ist vollstaendig gruen.

### 3.1 Die drei einzigen erlaubten Aenderungen an Bestands-Testdateien

Alle drei sind erzwungen: zwei Zaehl-/Mengen-Anpassungen und eine Werkzeug-Erweiterung
ohne die der Testplan dieser Phase gar nicht ausfuehrbar waere. Jede andere
Test-Aenderung ist verboten — insbesondere jede an einem Offenlegungs-Test.

| Datei | Aenderung | Zusatz-Pflicht |
|---|---|---|
| `test/el-vorlage-variablen-abgleich.test.js` | `EXPECTED_VARIABLE_COUNT` von `12` auf `13` | Kommentar, dass `{{callee_relation}}` der 13. Name ist |
| `test/elevenlabs-override-whitelist.test.js` | der Paritaets-Test "Code-Whitelist und Besitz-Karte nennen dieselben Pfade" vergleicht die Karte jetzt gegen `[...OVERRIDE_ALLOWED_LEAF_PATHS, ...OVERRIDE_OWNER_ONLY_LEAF_PATHS]` | derselbe Test muss ZUSAETZLICH pinnen, dass `agent.first_message` in der Owner-Menge und **nicht** in der Basis-Menge steht |
| `test/helpers/elevenlabs-anrufstart-attrappe.mjs` | Erweiterung, s. unten | die zwei Bestandsnutzer bleiben **unveraendert** und gruen |

**Warum die Attrappe erweitert werden MUSS.** Sie gibt heute ausschliesslich
`rumpf.dynamic_variables` zurueck (letzte Zeile von `sendeAnrufstart`) — das
Uebersteuerungs-Objekt `conversation_config_override` ist von aussen gar nicht erreichbar,
und die Faelle A, B, C, D dieses Testplans behaupten genau darueber etwas. Zusaetzlich
liefert `pinStore().tenantContext` nur `{ ownerName: "Pin Testowner" }` OHNE `firstName`;
damit kann Bedingung 2 aus 2.4 (nicht-leerer `firstName`) NIE wahr werden und Fall B
faellt konstruktionsbedingt durch. Ohne diese Erweiterung waere der Testplan mit dem
vorgeschriebenen Werkzeug nicht ausfuehrbar.

Erlaubter Umfang, genau dieser:

1. Eine zweite Ausfahrt, die den **ganzen** abgegriffenen Koerper liefert (z.B.
   `sendeAnrufstartKoerper(...)`). `sendeAnrufstart` bleibt in Signatur UND Rueckgabe
   unveraendert und delegiert an dieselbe Abgriff-Implementierung — EIN Abgriff, zwei
   Sichten. Keine zweite Attrappe, keine zweite `fetch`-Ersetzung.
2. `pinStore()` liefert `tenantContext: () => ({ ownerName: "Pin Testowner", firstName: "Pin" })`
   und laesst den Wert ueberschreiben (z.B. `pinStore({ tenantContext })`), damit der
   Fall "leerer `firstName`" aus der Fail-closed-Treppe (Fall C) ueberhaupt herstellbar
   ist. `call.calleeIsOwner` ist bereits ueber den vorhandenen `call`-Parameter setzbar —
   dort ist nichts zu aendern.
3. Nichts sonst. Kein neuer Default, der eine Entscheidung vorwegnimmt (die Lehre
   `b1-messwerkzeug-attrappe` gilt weiter: ein eingebauter Rueckfall misst die Attrappe
   statt den Code).

Pflicht-Gegenprobe, im Phasenbericht zu belegen:
```
NODE_ENV=test LLM_PROVIDER=anthropic node --test test/el-vorlage-variablen-abgleich.test.js test/elevenlabs-torzustand.test.js
```
Erwartet: `fail 0` — und `git diff` zeigt an diesen beiden Dateien nur die erlaubte
`EXPECTED_VARIABLE_COUNT`-Zeile, sonst nichts.

Die zweite und dritte Aenderung machen die Messung **strenger** bzw. ueberhaupt erst
moeglich, nicht schwaecher. Faellt dir eine Umsetzung ein, die eine davon schwaecher
macht, ist sie falsch.

---

## 4. Abgrenzung — ausdruecklich NICHT in dieser Phase

- Kein Budget-/TeXML-Pfad, kein `openingText`, kein `systemPrompt`, kein
  `src/claude.js`, kein `src/bridge.js`, kein `src/telnyx-call-control-ingest.js`,
  kein `src/routes/voice.js` (das ist OC-P3).
- Keine UI, kein `apps/web`.
- Keine Inbound-Erkennung.
- Keine Besitz-Verifikation der Nummer.
- Kein zweiter ElevenLabs-Agent.
- Kein `elevenlabs:push`, kein `elevenlabs:drift`, kein Deploy, kein echter Anruf, kein
  `git push`.

---

## 5. Tests

Neue Datei `test/callee-is-owner-elevenlabs.test.js`. **Kein Katalog-ID-Praefix** am
Testnamen (`DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD` gefolgt
von einer Ziffer landet im `test:gates`-Lauf) und kein `ABNAHME-`-Praefix.

Der Anfragekoerper wird ohne Netzzugriff abgegriffen — die Attrappe dafuer existiert:
`test/helpers/elevenlabs-anrufstart-attrappe.mjs`, genutzt von
`test/el-vorlage-variablen-abgleich.test.js` und `test/elevenlabs-torzustand.test.js`.
**Nutze sie, baue keine zweite** — zwei Attrappen driften, und dann hoert eine der Suiten
still auf zu messen. Sie muss dafuer erweitert werden (ganzer Koerper statt nur
`dynamic_variables`, `firstName` im Store-Double); Umfang und Auflagen stehen in 3.1 und
sind ausdruecklich erlaubt. `FAKE_ORIGINATE_ELEVENLABS` scheidet aus: der Schalter
ueberspringt den ganzen Aufruf-Ausdruck, es gaebe nichts abzugreifen.

Pflicht-Faelle:

**A. Fremd-Ziel bleibt unberuehrt (der wichtigste Test der Phase)**
- Der Koerper enthaelt **keinen** Blatt-Pfad `agent.first_message`.
- `dynamic_variables.callee_relation === ""`.
- Der Rest des Koerpers ist unveraendert gegenueber dem Bestand.

**B. Owner-Ziel**
- Der Koerper enthaelt `conversation_config_override.agent.first_message`.
- Der Wert **beginnt** mit `LOCALES.<lang>.ownerOpening(firstName)` — je Sprache de, fr,
  en gepinnt.
- Der Wert enthaelt den Offenlegungssatz **nicht** (`assert.ok(!wert.includes(...))` gegen
  `LOCALES.<lang>.disclosure(ownerName)` und zusaetzlich gegen einen charakteristischen
  Teilsatz daraus, damit auch ein Fragment auffaellt).
- Der Wert enthaelt kein `{{`.
- **Der Wert traegt das KI-Wort der jeweiligen Sprache** (`KI` / `IA` / `AI`) — je Sprache
  einzeln gepinnt. Das ist der Riegel gegen ein spaeteres "Kuerzen" der Begruessung, das
  die Kennzeichnung wegnimmt (Plan 1.4/7.9).
- `dynamic_variables.callee_relation` enthaelt den `ownerName` und kein `{{`.
- `dynamic_variables.callee_relation` enthaelt den vollstaendigen Offenlegungssatz der
  Anrufsprache (`LOCALES.<lang>.disclosure(ownerName)`) als Rueckfall-Anweisung — je
  Sprache gepinnt. Fehlt er, ist die Pflichtzeile aus 2.2 nicht gebaut.

**C. Fail-closed-Treppe** — jeder Fall einzeln: `calleeIsOwner` fehlt (`undefined`),
`calleeIsOwner: false`, `calleeIsOwner: "true"` (String!), leerer `firstName`, leere
Grund-Zeile. Erwartet in JEDEM Fall: **kein** `agent.first_message` im Koerper,
`callee_relation === ""`.

**D. Waechter (Rotprobe).** Ein von Hand gebauter Koerper mit
`conversation_config_override.agent.first_message` und `calleeIsOwner`-Kontext `false`
(bzw. weggelassen) ⇒ `startOutboundCall` **wirft**, und die Attrappen-`fetch` wurde
**nicht** aufgerufen. Spiegelbildlich: derselbe Koerper mit Kontext `true` ⇒ kein Wurf.
Und weiterhin: ein VIERTER Pfad (z.B. `tts.speed`) ⇒ Wurf, auch im Owner-Kontext.

**E. Rueckfrage-Tor.** Owner-Anruf ⇒ `dynamic_variables.consult_available === "unavailable"`,
auch wenn das Tenant-Profil die Rueckfrage erlaubt. Fremd-Anruf ⇒ unveraendert.

**F. Vorlage.** Die Erlaubnis-Karte der Vorlage fuehrt `agent.first_message: true`; der
statische `agent.first_message` und die `de`/`fr`-Presets beginnen weiterhin
byte-identisch mit `LOCALES.<lang>.disclosure` (das pinnen T5(c)/(e) bereits — hier nur
sicherstellen, dass sie unveraendert gruen sind).

**G. Sprach-Orthografie — und eine ausdrueckliche Grenze.**

Der vorgeschriebene DE-Wortlaut ("Hallo ${firstName}, hier ist dein KI-Assistent.")
enthaelt **keinen Umlaut**. Das ist kein Versehen und kein Grund, den Wortlaut zu biegen.
Daraus folgt zweierlei, beides verbindlich:

- **`ownerOpening` wird NICHT in `SPOKEN_DE_FIELDS` von
  `test/de-umlaut-orthography.test.js` aufgenommen** (Liste `:24-44`). Der Test dort
  besteht aus zwei Haelften: `P1-U1` verbietet Transliterationen, `P1-U2` verlangt als
  Gegenprobe `/[äöü]/` in JEDEM gelisteten Feld. Ein umlautfreier Satz in dieser Liste
  macht `P1-U2` rot — und die naheliegende "Reparatur" waere, einen Umlaut in einen
  Rechtssatz hineinzuschreiben. `test/de-umlaut-orthography.test.js` bleibt damit
  **unveraendert** (Invariante 6).
- **Die Luecke wird benannt und im NEUEN Test selbst gedeckt:** es entsteht ein neuer
  gesprochener DE-String, den die Bestands-Ratsche nicht erfasst (ihre Liste ist explizit
  aufgezaehlt, nicht generisch). Der neue Test prueft deshalb selbst, dass
  `LOCALES.de.ownerOpening("Pin")` keine Transliteration traegt — gegen dieselbe eine
  Quelle `SPOKEN_TRANSLITERATION_STEMS` aus `test/umlaut-stems-helper.js`, NICHT gegen eine
  eigene Kopie der Staemme. Eine Umlaut-Gegenprobe entfaellt hier bewusst, mit genau
  dieser Begruendung als Kommentar.
- Fuer `fr` gilt spiegelbildlich: der Wortlaut traegt keine Akzente; die
  Akzent-Gegenprobe entfaellt aus demselben Grund.

---

## 6. Abnahme (deterministisch)

Alle Kommandos vom Repo-Wurzelverzeichnis.

1. **Syntax + Vorlage parst**
   ```
   node --check src/elevenlabs/outbound.js && node --check src/elevenlabs/convai.js && node --check src/i18n/locales.js && node --check src/i18n/prompts/en.js && node -e "JSON.parse(require('fs').readFileSync('elevenlabs/agent_configs/outbound-agent.template.json','utf8'));console.log('vorlage ok')"
   ```
   Erwartet: `vorlage ok`, Exit 0.

2. **Neue Tests**
   ```
   NODE_ENV=test LLM_PROVIDER=anthropic node --test test/callee-is-owner-elevenlabs.test.js
   ```
   Erwartet: `fail 0`, `pass` >= 24.

3. **Die Bestands-Riegel der Offenlegung sind unveraendert gruen**
   ```
   NODE_ENV=test LLM_PROVIDER=anthropic node --test test/elevenlabs-anrufstart.test.js test/elevenlabs-override-whitelist.test.js test/el-vorlage-variablen-abgleich.test.js test/elevenlabs-sprachwahl.test.js test/el-opening-line.test.js test/elevenlabs-torzustand.test.js test/de-umlaut-orthography.test.js
   ```
   Erwartet: `fail 0`. `test/elevenlabs-torzustand.test.js` und
   `test/de-umlaut-orthography.test.js` stehen hier, weil beide von einer Aenderung dieser
   Phase getroffen werden koennten (geteilte Attrappe bzw. neuer gesprochener DE-String)
   und beide **unveraendert** bleiben muessen.

4. **Volle Regressionsbank**
   ```
   LLM_PROVIDER=anthropic npm test
   ```
   Erwartet: `fail 0`, korrigierte Gesamtzahl >= `4909` + neue Faelle (Ausgangsstand
   gemessen 2026-08-20: `korrigiert: tests 4909 / pass 4909 / fail 0`).

5. **Kein Testkatalog-Leck**
   ```
   npm run test:gates
   ```
   Erwartet: **exakt `korrigiert: tests 129`** (Ausgangsstand 2026-08-20: `pass 126 /
   fail 3`). Die drei roten sind Bestand; die ANZAHL ist die Zusage.

6. **Genau vier Aenderungen an der Vorlage**
   ```
   git diff master -- elevenlabs/agent_configs/outbound-agent.template.json
   ```
   Erwartet: `{{callee_relation}}` im Prompt, `agent.first_message` in der Erlaubnis-Karte
   von `false` auf `true`, die erweiterte Begruendung als Geschwister von `overrides`, der
   datierte Zusatz am Besitz-Eintrag `conversation_config_override_erlaubnisse`.
   **Sonst nichts** — insbesondere keine Zeile, die `first_message` oder ein
   `language_presets`-Preset im `conversation_config` beruehrt.

   Gegenprobe, dass der Hinweis nicht in der Karte gelandet ist (er reiste sonst beim Push
   mit, weil der Push Dicts ERSETZT):
   ```
   node -e "const d=JSON.parse(require('fs').readFileSync('elevenlabs/agent_configs/outbound-agent.template.json','utf8'));const k=d.platform_settings.overrides.conversation_config_override;const tief=JSON.stringify(k).includes('\"_');console.log(!tief?'karte sauber':'FEHLER: _-Schluessel in der Karte');console.log('erlaubnis first_message:',k.agent.first_message);"
   ```
   Erwartet: `karte sauber` und `erlaubnis first_message: true`. (`platform_settings` liegt
   auf oberster Ebene der Vorlage, NICHT unter `agent`; `_overrides_hinweis` ist sein
   Geschwister-Schluessel zu `overrides`.)

7. **Der Offenlegungssatz steht weiterhin statisch in der Vorlage**
   ```
   node -e "const d=JSON.parse(require('fs').readFileSync('elevenlabs/agent_configs/outbound-agent.template.json','utf8'));const cc=d.agent.conversation_config;console.log(cc.agent.first_message.slice(0,40));console.log(cc.language_presets.de.overrides.agent.first_message.slice(0,40));console.log(cc.language_presets.fr.overrides.agent.first_message.slice(0,40));"
   ```
   Erwartet drei Zeilen, beginnend mit `Hello, this is an AI assistant calling`,
   `Guten Tag, hier spricht ein KI-Assistent` und `Bonjour, ceci est un assistant IA`.

8. **Die Doku-Eintraege existieren**
   ```
   grep -c "Owner-Entscheidung 2026-08-20 (OC)" CLAUDE.md; grep -c "Besitz-Verifikation der eigenen Nummer" PLAN-SECURITY.md
   ```
   Erwartet: jeweils mindestens `1`.

9. **Nichts ausserhalb des Scopes bewegt**
   ```
   git diff --stat master -- src/claude.js src/bridge.js src/routes/voice.js src/telnyx-call-control-ingest.js apps/web
   ```
   Erwartet: **leer**.

---

## 7. Fallen aus der Projekthistorie

- **Fehlende Variable = stiller Tod.** Ein `{{name}}` in der `first_message`, fuer den
  keine Variable mitgeschickt wird, beendet das Gespraech beim Anbieter mit Code 1008 —
  der Angerufene hoert Stille. Deshalb Bedingung 4 in 2.4.
- **Der Anbieter ignoriert Uebersteuerungen still**, wenn die Erlaubnis-Karte sie nicht
  fuehrt. Kein Fehler, keine Warnung. Ein wirkungsloser Wert an dieser Stelle hat in
  diesem Projekt bereits zweimal zugeschlagen (`tts.voice_id`).
- **`language_presets`-Eintraege duerfen keine `_`-Doku-Schluessel enthalten** — die reisen
  beim Push mit.
- **Die Erlaubnis-Karte ist ein besessenes Feld** (`_besitz.felder`, Eintrag
  `conversation_config_override_erlaubnisse`) und wird vom Drift-Waechter gegen den
  LIVE-Agenten gemessen. Eine Vorlagen-Aenderung ohne Push meldet der Waechter als
  Abweichung — das ist Absicht und gehoert ins Runbook, nicht in diese Phase.
- **`git add -A` ist in diesem Repo verboten.** Dateien einzeln adden.
- **`npm run elevenlabs:push` niemals mit `--ausfuehren` in dieser Phase.**
