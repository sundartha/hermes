# Grounding: Persona/Ansprache + i18n + Testlandschaft fuer das Owner-Call-Feature

Stand: 2026-08-20. Reine Bestandsaufnahme (nur gelesen, nichts geaendert). Praemisse:
Produkt ist noch nicht gelauncht, alle aktiven Accounts (Owner+Jonas) gehoeren uns.

Vorab-Klaerung Begriff "Owner-Call": im Bestand ist "Owner-Call" bereits ein etablierter
Testbegriff (`test/claude-identity.test.js:57`, `test/i9-self-service.test.js:90`,
`test/read-scope-tenant.test.js`, `test/tenant-erasure*.test.js`) - dort heisst es
schlicht "ein Call, der dem Owner-Tenant (`BOOTSTRAP_TENANT_ID`) gehoert", zur Abgrenzung
von Calls fremder Tenants. Das ist NICHT dasselbe wie das hier zu planende Feature. Fuer
den Feature-Kontext relevant ist eine ANDERE, bereits im Code sichtbare Unterscheidung:
ein Anruf, dessen Ziel `to` die EIGENE verifizierte Nummer des Tenants ist
(`store.tenantPrivateNumber`, `src/diagnostic-retention.js:44-52`) - heute nur als
Signal fuer Diagnose-Retention genutzt, NICHT fuer Persona/Anrede. Das ist vermutlich der
Andockpunkt fuer das neue Feature, aber das ist eine Annahme dieses Berichts, keine
belegte Festlegung.

## 1. Persona: heutige Dritt-Vorstellung und ihre Bausteine

Der Agent stellt sich heute IMMER in der dritten Person vor - nie direkt an den Owner
gerichtet, egal wer am anderen Ende ist:

- **System-Prompt-Persona** (Modell-Text, nie gesprochen):
  `src/i18n/prompts/de.js:13-15`
  ```
  persona: ({ settings: s, owner, now }) =>
    `Du bist "${s.agentName}", der persönliche KI-Telefonassistent von ${owner}.
  Du telefonierst gerade LIVE. Heute ist ${now}.`,
  ```
  `owner` ist hier der VORNAME (`ctx.firstName`, `src/claude.js:66`, Kommentar
  `src/claude.js:53-55`: "LLM-Persona = Vorname ... Beide aus derselben gebundenen
  Tenant-Identitaet"). Analoge Bausteine: `src/i18n/prompts/en.js`, `fr.js` (nicht
  einzeln zitiert, gleiches Muster, per `grep PROMPT_EN\|PROMPT_FR` bestaetigt vorhanden).

- **Identitaets-Antwort auf Nachfrage** ("wer bist du"), zwei Varianten je Richtung:
  `src/i18n/prompts/de.js:38-41` (`clarificationRules`):
  - Inbound: `"du bist der KI-Assistent von ${owner} und nimmst den Anruf entgegen"`
  - Outbound: `"du bist ein KI-Assistent und rufst im Auftrag von ${owner} an"`

- **Pflicht-Offenlegung** (Regel 2, gesprochener ALLERERSTER Satz bei Outbound, fest
  verdrahtet, NICHT abschaltbar): `src/i18n/locales.js:207-211` (DE):
  ```
  "Guten Tag, hier spricht ein KI-Assistent im Auftrag von ${ownerName}.
   Das Gespräch wird für meinen Auftraggeber zusammengefasst."
  ```
  `ownerName` hier ist der VOLLE Name (`store.tenantContext(call.tenantId).ownerName`,
  `src/claude.js:392-393`, `disclosureSentence`). Analog FR (`locales.js:356-360`) und
  EN (`locales.js:470-474`). Fallback-Ausdruck bei fehlendem Namen:
  `DISCLOSURE_OWNER_FALLBACK_DE/FR/EN` (`locales.js:128-130`).

- **Greeting-Default (Inbound-Begruessung)**: `src/store/defaults.js:431`
  ```
  "Hallo, hier ist der KI-Assistent von {owner}. {owner} kann gerade nicht ans Telefon..."
  ```
  Weitere kuratierte Varianten: `src/i18n/locales.js:267-270` (DE), `:395-398` (FR),
  `:504-507` (EN) - alle im Muster "der KI-Assistent von {owner}".

- **agentStyle-Enum (Personal-Assistant-Kette, P2)**: `PERSONA_STYLE_IDS`,
  `src/i18n/locales.js:70`: genau zwei kuratierte IDs, `"warm-persoenlich"` und
  `"formell-professionell"`, plus `null` (=neutral/Sie). Faerbt AUSSCHLIESSLICH Ton +
  Anrede (Du/Sie bzw. tu/vous bzw. informal/polite) einer EINZIGEN Prompt-Zeile
  (`styleClause`, `src/i18n/locales.js:84-102`, eingesetzt in `speechRules`,
  `src/i18n/prompts/de.js:32`). Validierung fail-closed gegen die Katalog-Liste:
  `src/store/state-ops.js:4248-4251` (`OPTIONAL_ENUM_FIELDS.agentStyle`), Speicherfeld
  `settings.agentStyle`, Default `null` (`src/store/defaults.js:536-541`).
  **Wichtig fuer den Owner-Call-Kontext**: `agentStyle` steuert NUR Ton/Anrede
  gegenueber FREMDEN Anrufern ("duze/sieze den Anrufer" - Kommentar
  `src/i18n/locales.js:67-69`: "styleClause faerbt AUSSCHLIESSLICH Ton + Anrede") und
  ausdruecklich NICHT Persona/Offenlegung. Es gibt aktuell **keinen** Baustein, der
  Anrede/Persona spezifisch fuer ein Gespraech MIT dem Owner selbst veraendert.

**Was fuer einen Owner-Anruf fehlt (Bestandsaufnahme, keine Empfehlung):**
- Kein Pfad erkennt heute "die Gegenstelle IST der Owner selbst" und schaltet daraufhin
  Anrede/Persona um. `tenantPrivateNumber` (`src/store/state-ops.js:2161`) existiert als
  Datenquelle (die verifizierte private Nummer des Tenants), wird aber nur in
  `diagnostic-retention.js` gelesen (Retention-Frage), nicht in `claude.js` oder den
  i18n-Prompt-Bausteinen.
- `owner` (Vorname) und `ownerName` (voller Name) sind BEREITS ueber `tenantContext`
  aufloesbar (`src/store/state-ops.js:1676-1689`) - die Variable fuer eine namentliche
  Anrede ("Hallo Jonas, ...") existiert also strukturell, wird aber im Persona-/
  Offenlegungs-Baustein bisher nur als DRITTPERSON-Objekt ("im Auftrag von Jonas"),
  nie als direkte Anrede ("Hallo Jonas,") verwendet.
- Du-Form gegenueber dem Owner: `agentStyle` koennte als Vorbild fuer eine neue,
  Owner-spezifische Klausel dienen (gleiches Muster: kuratierte, NON-PII-Enum-Klausel je
  Sprache, `makeStyleClause`, `src/i18n/locales.js:100-102`), ist aber nicht dafuer
  gebaut - eine neue Owner-Anrede-Klausel waere ein NEUER Baustein, kein Wiederverwenden
  von agentStyle mit anderer Bedeutung (sonst kollidiert die Semantik mit dem Bestand,
  der agentStyle explizit "faerbt NUR Ton + Anrede [gegenueber Fremden]" definiert,
  Kommentar `src/store/defaults.js:538-539`).
- ANNAHME (nicht belegt): das Feature betrifft vermutlich primaer den Fall
  "Owner ruft die eigene Hermes-Nummer an" (Inbound, `from === tenantPrivateNumber`)
  oder "Agent ruft im Auftrag zurueck an die eigene Nummer des Owners" (Outbound,
  `to === tenantPrivateNumber`, wie in `diagnostic-retention.js` bereits fuer
  Retention-Zwecke erkannt). Beide Richtungen haben HEUTE in `claude.js`/`locales.js`
  keinerlei Sonderbehandlung - das ist neu zu bauen, nicht nur umzubenennen.

## 2. i18n: lokalisierte Bausteine und was eine Owner-Eroeffnung je Sprache braeuchte

Produktanspruch (Memory `i18n-launch-test-catalog.md`, bestaetigt im Code):
`en` ist Weltdefault, `de`/`fr` gepflegt zusaetzlich. Eine Sprache = ein weiterer Eintrag
in `LOCALES` (`src/i18n/locales.js:149-546`), `SUPPORTED_LANGUAGES` daraus abgeleitet
(`:550`).

- **`src/elevenlabs/call-locale.js`** (ElevenLabs-Anrufstart-Naht, EIN Modul):
  loest je Anruf Sprache/Stimme/Offenlegung auf (`callLocaleFor`, Zeile 142-151).
  Praezedenz: Sprache des ANGERUFENEN aus dessen Rufnummer (`calleeLanguage`,
  Zeile 45-48) schlaegt die Auftraggeber-Kette (`resolveCallLanguage`,
  `src/store/state-ops.js`). Fuer einen Owner-Call relevant: `calleeLanguage(to)` wuerde
  bei `to === eigene Nummer des Owners` die SPRACHE DES OWNERS liefern (uebers Land
  seiner eigenen Nummer) - das ist vermutlich korrekt, aber ungeprueft fuer diesen
  Spezialfall.
  Die volle Eroeffnung (`providerOpening`, Zeile 76-77) ist IMMER
  `disclosure(ownerName) + " " + OPENING_LINE_PLACEHOLDER` - unveraendert unabhaengig
  davon, wer angerufen wird. Es gibt keinen Zweig "Ziel ist der Owner selbst -> andere
  Eroeffnung".

- **`language_presets_offenlegung`**: dieses exakte Feld existiert NICHT im Code (nur
  Testreferenzen zu `language_presets` allgemein, z.B.
  `test/elevenlabs-agent-werkzeuge.test.js:87`, `test/elevenlabs-push-zusammenfuehrung
  .test.js:201-245`). Das ElevenLabs-Konstrukt heisst `conversation_config
  .language_presets` (Schluessel = Sprachcode, `overrides.agent.first_message` je
  Sprache) - die Offenlegung ist darin der ERSTE SATZ von `first_message`, nicht ein
  eigenes benanntes Feld. `providerOpeningFor(language)` (`call-locale.js:92-94`) ist
  die Quelle, gegen die das Preset gemessen wird (`test/elevenlabs-anrufstart.test.js`).
  **Fuer die Owner-Eroeffnung**: eine Owner-spezifische Variante muesste entweder (a)
  ein eigenes `first_message`-Preset je Sprache bekommen (schwer wartbar, drei weitere
  ElevenLabs-Presets pro Sprache), oder (b) dynamisch ueber `dynamic_variables` in
  `{{opening_line}}`/`{{owner_name}}` eingespeist werden (bereits vorhandener
  Platzhalter-Mechanismus, Zeile 63/80) - das waere der naheliegendere Weg, ist aber
  eine Design-Entscheidung, keine bereits getroffene.

- **Owner-Fallback-Ausdruck je Sprache**: `DISCLOSURE_OWNER_FALLBACK_DE/FR/EN`
  (`locales.js:128-130`) - eine Blaupause dafuer, wie ein Owner-spezifischer
  Eroeffnungsbaustein je Sprache aussehen wuerde (ein Konstante-Trio + `makeX`-Faktorei,
  Muster `makeDisclosure`/`makeStyleClause`).

- **Realtime-Pfad** (`VOICE_ENGINE=realtime`): eigener Opener-Mechanismus
  (`realtimeOpener.outbound/inbound`, `locales.js:162-167` DE, analog FR/EN) - ein
  Owner-Call-Feature muesste BEIDE Engines bedienen (Budget-Engine ueber `claude.js`
  System-Prompt + `disclosureSentence`, Realtime ueber `bridge.js`/`realtimeOpener`),
  wie es das bestehende Muster `speechClause`/`styleClause` bereits fuer alle Bausteine
  tut. ANNAHME: das Owner-Call-Feature betrifft vermutlich in erster Linie die
  ElevenLabs-Naht (aktueller Live-Pfad laut Memory `assistant-path-kept-real-costs.md`)
  und die Budget-Engine (`claude.js`) - nicht als Tatsache belegt, sondern aus dem
  aktuellen Live-Zustand abgeleitet.

- **Sprachauswahl bleibt server-seitig, kein Client-Feld**: `place_call` hat bewusst
  KEIN `language`-Feld (`src/mcp-tools.js`, Kommentar "LANG-15" bei `max_duration_s`,
  vgl. `src/elevenlabs/call-locale.js:17-22`: "place_call fuehrt bewusst KEIN
  Sprachfeld"). Eine Owner-Call-Sprachsteuerung muesste denselben Grundsatz respektieren
  - aus State/Geo abgeleitet, nicht vom aufrufenden Client gesetzt.

## 3. Tests: Landschaft, die dieses Feature beruehrt

**Direkt einschlaegig (heute grün, per Suite-Lauf bestaetigt s. Abschnitt 4):**

| Datei | Deckt |
|---|---|
| `test/claude-identity.test.js` | `systemPrompt`/`disclosureSentence` ziehen Name ueber `tenantContext`; explizite Tests fuer den Owner-Tenant (`BOOTSTRAP_TENANT_ID`) vs. Tenant B |
| `test/persona-style.test.js` | agentStyle-Enum, DE/FR/EN Klauseln, Default-null-Byte-Identitaet, Fail-closed bei Freitext (in-process, kein Spawn) |
| `test/persona-style-pg.test.js` | dasselbe Feld im pg-Backend: Default null, Round-Trip (set->save->reopen), Freitext-Ablehnung (Zeilen 10/16/32) |
| `test/disclosure-outbound.test.js` | Regel 2: Offenlegung ist der ALLEREERSTE Say-Praefix im `<Gather>`, LLM-frei (`/voice/outbound`) |
| `test/disclosure-regression.test.js` | weitere Offenlegungs-Regressionen (nicht im Detail gelesen, Name+Groesse: 105 Zeilen) |
| `test/inbound-disclosure-mandatory.test.js` | Inbound-Pflichtsatz (GAP-14/O7), 117 Zeilen |
| `test/el-opening-line.test.js` | ElevenLabs-Eroeffnungszeile: Laengen-/Klammer-/Preis-/Offenlegungs-Wiederholungs-Waechter mit Rotproben, 498 Zeilen |
| `test/elevenlabs-anrufstart.test.js` | `language_presets`, `providerOpeningFor` gegen jedes Preset (Zeilen 927-1025) |
| `test/elevenlabs-push-zusammenfuehrung.test.js` | Push-Merge-Logik fuer `conversation_config.language_presets` |
| `test/route-auth-inventory.test.js` | JEDE neue HTTP-Route MUSS in `src/route-policy.js` klassifiziert sein - bei einem neuen `/api/*`-Endpunkt fuer das Owner-Call-Feature Pflichtlektuere/-erweiterung |
| `test/gq-b1-briefing-openness.test.js` | Zeichen-Deckel `place_call`-Beschreibung: `PLACE_CALL_BUDGET_CHARS=5800` (aktuell 5667 genutzt), `PLACE_CALL_WITH_CONSULT_BUDGET_CHARS=6200` (aktuell 6069 genutzt) - **nur ~130 Zeichen Luft je Variante** |
| `test/store-pg-json-parity.test.js`, `test/store-pg-multitenant.test.js`, `test/store-pg-rls.test.js` | generische Store-Roundtrip/Parity/RLS-Netze; ein neues Tenant-/Settings-Feld muss durch diese Netze durch (json+pg) |

**Namenspraefix-Regel (Katalog-ID am Namensanfang, `package.json`
`config.i18nCatalogPattern`):**
```
^(Charakterisierung )?(DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD)-[0-9]
```
Jeder Test, dessen `test()`-Name mit einem dieser Praefixe (z.B. `LANG-`, `PROMPT-`,
`GAP-`) beginnt, landet automatisch NUR in `npm run test:gates` (i18n-Launch-
Testkatalog, DARF rot sein) und NICHT in `npm test` (Regressionsschutz). Fuer das
Owner-Call-Feature heisst das konkret: ein NEUER Test, der versehentlich mit `LANG-99:`
oder `PROMPT-30:` beginnt, verschwindet aus dem Regressionslauf, ohne dass irgendjemand
es beabsichtigt hat (Memory `catalog-id-prefix-misroutes-tests.md`). Umgekehrt: solange
der Testname NICHT mit einem der Praefixe beginnt, landet er automatisch in `npm test`.

**Konvention fuer neue Tests:**
- `node:test` ohne Zusatz-Dependencies, Datei unter `test/*.test.js`.
- In-process bevorzugt (kein Spawn) wo moeglich - Muster `persona-style.test.js`
  (`tempDataDir`/`seedState`/`seedCall` aus `test/helpers.js`, dynamischer Import NACH
  `process.env.DATA_DIR`-Setzen).
- **Neue Env-Variable IMMER in `BASE_ENV` eintragen** (`test/helpers.js:49-...`), sonst
  leakt eine lokale `.env` in Spawn-Tests (`startServer`, Zeile ~1112/1147 nutzt
  `{ ...BASE_ENV, ...env, DATA_DIR: dataDir }`). Ein Owner-Call-Feature-Flag (z.B.
  `OWNER_CALL_PERSONA_ENABLED` o.ae., falls hinter einem Flag gebaut) MUSS hier gepinnt
  werden, sonst driftet die Baseline (Memory `test-base-env-drift.md`).
- Golden-Master-Pins sind Bestandsmuster (`P0-Pins`, mehrfach referenziert in
  `claude.js`-Kommentaren): ein neuer Baustein rendert bei ausgeschaltetem
  Flag/leerem Input `""`, damit der Bestandsprompt BYTE-IDENTISCH bleibt
  (`filter(Boolean).join("\n\n")`, `src/claude.js:316-317`).

## 4. Bekannter Suite-Zustand (echter Lauf, VOR jeder Aenderung)

Befehl exakt wie vorgegeben ausgefuehrt:
```
cd "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent" && LLM_PROVIDER=anthropic npm test
```
Ergebnis:
```
# tests 4928
# suites 37
# pass 4928
# fail 0
...
# testbaenke-run (regression): 19 Datei-Wrapper ohne echten Test abgezogen
# korrigiert: tests 4909 / pass 4909 / fail 0
```
**Vollstaendig GRUEN, 4909/4909.** Das stimmt mit der im Auftrag genannten Groessenordnung
(~4909) ueberein.

**Abweichung von der Praemisse "42 Testdateien brauchen den Vorsatz
`LLM_PROVIDER=anthropic`"**: das lokale `.env` traegt tatsaechlich
`LLM_PROVIDER=deepseek` (`.env:45`, per `grep` bestaetigt). ABER: `test/helpers.js`
pinnt `LLM_PROVIDER: "anthropic"` bereits fest in `BASE_ENV` (Zeile 49-55, mit
Kommentar "B5: Anbieter-Wahl neutral auf den Default gepinnt, sonst leakt eine lokale
.env via dotenv in Spawn-Tests") - jeder Spawn-Test (`startServer`) ist dadurch bereits
geschuetzt, unabhaengig vom Praefix in der Kommandozeile. Zur Gegenprobe zusaetzlich
lesend ausgefuehrt (nicht im Auftrag verlangt, aber zur Verifikation der Praemisse):
```
npm test    # OHNE LLM_PROVIDER=anthropic-Praefix, .env-Wert deepseek greift wo dotenv laedt
# tests 4928 / pass 4927 / fail 1
# korrigiert: tests 4909 / pass 4908 / fail 1
```
Der EINE Fehlschlag war `test/el-geldpfad-s1.test.js` ("S1-B: Abbruch auf ein
LAUFENDES Gespraech ... loescht den Buchungsanker NICHT"), inhaltlich ohne erkennbaren
Bezug zu `LLM_PROVIDER` (Timing/Booking-Anker-Test). `grep -rl
"process.env.LLM_PROVIDER" test/` liefert **0 Treffer** - kein Testfile setzt die
Variable selbst um, alle verlassen sich auf `BASE_ENV` (Spawn-Tests) bzw. laufen
providerunabhaengig (in-process-Tests ohne LLM-Call). Die Zahl **42** liess sich mit den
verfuegbaren, rein lesenden Mitteln in dieser Session NICHT reproduzieren; sie ist als
Praemisse im Auftrag benannt, aber am aktuellen Code-/Testbestand nicht (mehr?)
nachvollziehbar. Messbasis fuer den Planer bleibt daher: **4909/4909 gruen mit dem
vorgegebenen Praefix `LLM_PROVIDER=anthropic`**, und **4908/4909 (1 vermutlich
unabhaengiger Flake) ohne Praefix**. Vor jeder Aenderung sollte der Planer diesen einen
Fehlschlag isoliert nachpruefen (Memory `suite-flake-p5-gate-proof-spawn-race.md`:
"rot zaehlt nur, wenn isoliert rot"), statt ihn ungeprueft der Owner-Call-Aenderung
zuzurechnen.

## 5. MCP-Sicht: was `place_call`/`mcp-tools.js` wissen muesste

- **Kein bestehender Hinweis** auf "Ziel = eigene Nummer" in `src/mcp-tools.js` heute
  (per `grep` bestaetigt: kein "eigene Nummer", "own number" o.ae. in der Datei). Die
  `to`-Beschreibung (`src/mcp-tools.js`, `objective`-Feld benachbart) sagt nur, wie die
  Zielnummer zeichengetreu zu uebernehmen ist, nichts zur Sonderrolle einer eigenen
  Nummer.
- **Aktuelle Realitaet, gegen die Auftragsformulierung "Anrufe an die eigene Nummer
  laufen ohne Offenlegung" verifiziert**: das ist HEUTE NICHT der Fall.
  `disclosureSentence` (`src/claude.js:392`) wird unbedingt fuer JEDEN Outbound-Call
  gerendert, unabhaengig vom Ziel; es gibt keinen Code-Pfad, der die Offenlegung fuer
  `to === tenantPrivateNumber` ausschaltet (das waere auch ein Verstoss gegen Absolute
  Regel 2 - "kein KI-Ermessen, kein Setting, das ihn abschaltet" - und daher vermutlich
  NICHT der geplante Weg, sondern eine zu klaerende Praemisse des Auftrags). Falls der
  Planer eine Sonderregel fuer Owner-Ziel-Calls einfuehren will, ist das eine bewusste,
  im Code-Kommentar UND ggf. in CLAUDE.md zu dokumentierende Ausnahme von Regel 2 -
  kein Bestandsverhalten, das nur beschrieben werden muesste.
- **Falls eine Beschreibungs-Ergaenzung noetig wird**: der Zeichen-Deckel ist eng
  (Abschnitt 3, `test/gq-b1-briefing-openness.test.js:39-40`): `PLACE_CALL_BUDGET_CHARS`
  hat aktuell nur **133 Zeichen Luft** (5800-5667), die Consult-Variante nur **131**
  (6200-6069). Jeder neue Satz in `to`/`objective`/`briefing`-Beschreibung muss entweder
  in dieses Budget passen oder der Deckel selbst braucht eine bewusste, benannte
  Anhebung (der Testkommentar verlangt das ausdruecklich: "Anheben nur mit benanntem
  Grund", `test/gq-b1-briefing-openness.test.js:34-38`).
- **Sprachfeld-Verbot bleibt**: `place_call` hat aus gutem Grund (LANG-15) kein
  `language`-Feld - eine Owner-Call-Erweiterung darf diesen Grundsatz nicht durchbrechen
  (server-seitige Aufloesung bleibt die einzige Quelle).
- **Falls ein neues Werkzeug/Feld** entsteht (statt nur einer Beschreibungs-Anpassung):
  `test/route-auth-inventory.test.js` verlangt fuer jeden neuen HTTP-Endpunkt eine
  Klassifizierung in `src/route-policy.js` (Absolute Regel 3); ein rein MCP-seitiges
  Feld ohne neue HTTP-Route braucht das nicht, aber `src/mcp-tools.js` spricht ohnehin
  ausschliesslich mit der bestehenden REST-API (`/api/calls`), keine neue Route noetig,
  solange keine neue Fähigkeit (nicht nur Text) hinzukommt.

## Kernaussagen fuer den Planer

- Die Dritt-Persona ("Assistent von X") sitzt an VIER Stellen (System-Prompt-Persona
  `src/i18n/prompts/{de,en,fr}.js` `persona`, Identitaets-Antwort `clarificationRules`,
  Pflicht-Offenlegung `src/i18n/locales.js` `disclosure`, Greeting-Defaults) - eine
  Owner-Anrede muss ALLE vier bewusst adressieren, sonst bleibt der Bruch sichtbar.
- `owner`/`ownerName` sind bereits ueber `tenantContext` (`src/store/state-ops.js:1676`)
  aufloesbar - die Datenquelle fuer eine namentliche Anrede existiert, wird bisher aber
  nur als Drittperson-Objekt genutzt, nie als direkte Anrede.
- `agentStyle` (`PERSONA_STYLE_IDS`) ist NICHT das richtige Feld fuer Owner-Anrede - es
  ist explizit auf "Ton/Anrede gegenueber FREMDEN Anrufern" definiert; ein Owner-Call
  braucht einen NEUEN, separaten Baustein nach demselben Muster (kuratierte Klausel je
  Sprache, fail-closed validiert), keine Zweckentfremdung des Bestandsfelds.
- Es gibt HEUTE keinen Code-Pfad, der "Gegenstelle = Owner selbst" erkennt und Persona/
  Offenlegung/Anrede daraufhin umschaltet - weder inbound (`from === eigene Nummer`)
  noch outbound (`to === eigene Nummer`, wo `diagnostic-retention.js` das bereits fuer
  einen ANDEREN Zweck, Retention, misst).
  `store.tenantPrivateNumber` ist der naheliegende Datenpunkt, wird bisher aber nur
  dort gelesen.
- Die Behauptung "Anrufe an die eigene Nummer laufen ohne Offenlegung" ist am
  Bestandscode WIDERLEGT: `disclosureSentence` ist unbedingt und fest verdrahtet
  (Absolute Regel 2) - jede Ausnahme dafuer ist eine neue, im Code UND in CLAUDE.md zu
  begruendende Abweichung, kein beschreibbares Bestandsverhalten.
- `language_presets_offenlegung` als Feldname existiert NICHT - das reale Konstrukt ist
  `conversation_config.language_presets[<sprache>].overrides.agent.first_message`; die
  Offenlegung ist darin der erste Satz von `first_message`, kein eigenes Feld.
  `src/elevenlabs/call-locale.js` ist DIE eine Quelle, gegen die jedes Preset gemessen
  wird (`providerOpeningFor`).
- Suite-Baseline VOR jeder Aenderung: **4909/4909 gruen** mit
  `LLM_PROVIDER=anthropic npm test` (Vorgabe erfuellt). Ohne den Praefix (lokales `.env`
  = deepseek) **4908/4909**, ein vermutlich provider-unabhaengiger Flake in
  `test/el-geldpfad-s1.test.js`. Die im Auftrag genannte Zahl "42 Testdateien" liess
  sich nicht reproduzieren (0 Treffer fuer `process.env.LLM_PROVIDER` in `test/`) - als
  offene Diskrepanz vermerkt, nicht stillschweigend uebernommen.
- Zeichen-Deckel der `place_call`-Beschreibung ist eng: nur ~130 Zeichen Luft in beiden
  Varianten (`test/gq-b1-briefing-openness.test.js`); jede MCP-Text-Ergaenzung fuers
  Owner-Call-Feature braucht entweder Sparsamkeit oder eine bewusste Deckel-Anhebung.
- Testnamens-Praefix-Falle: ein neuer Test, dessen Name zufaellig mit
  `LANG-`/`PROMPT-`/`GAP-`/etc. + Ziffer beginnt, landet automatisch NUR im
  `test:gates`-Lauf (darf rot sein) statt in `npm test` (Regressionsschutz) - beim
  Formulieren neuer Testnamen fuer dieses Feature bewusst gegenpruefen.
- Store-Roundtrip-Muster fuer ein neues Settings-Feld ist bereits vorhanden und bewaehrt:
  `test/persona-style.test.js` (json, in-process) + `test/persona-style-pg.test.js`
  (pg, Zeilen 10/16/32) zeigen exakt das Schema (Default-Wert, Round-Trip, Fail-closed-
  Ablehnung von Freitext) fuer ein neues, kuratiertes Enum-Feld analog `agentStyle`.
