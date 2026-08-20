# OC-P3 — Gleichlauf der uebrigen Outbound-Wege

Bauanweisung. Allein tragfaehig: du brauchst NUR diese Datei und den Code.
Voraussetzung: **OC-P1 und OC-P2 sind gemergt** (Praedikat `src/callee-is-owner.js`, Feld
`call.calleeIsOwner`, Schalter `OWNER_SELF_CALL_ENABLED` Default aus, ElevenLabs-Weg
owner-bewusst, `LOCALES.<lang>.ownerOpening(firstName)` existiert).
Repo-Konventionen: ESM, kein Build-Step, keine neuen Dependencies, Kommentare/Doku
deutsch OHNE Umlaute.

**Zur Umlaut-Regel, weil sie hier zweimal kippt:** gesprochene deutsche Strings
(`src/i18n/locales.js`) tragen echte Umlaute. Der Prompt-Rumpf in `src/i18n/prompts/de.js`
traegt seit CQ-P5 **ebenfalls** korrekte Umlaute (siehe Modulkopf dort). Nur
Code-Kommentare und Doku bleiben ASCII-transliteriert.

---

## 1. Worum es geht

OC-P2 hat den ElevenLabs-Weg owner-bewusst gemacht. Es gibt aber weitere Outbound-Wege,
und einer davon haengt an **keinem Flag**:

```js
if (config.voice.elevenLabsOutbound.enabled)            -> ElevenLabs (OC-P2)
else if (config.telnyx.telnyxAssistant.enabled && ...)  -> Telnyx Call-Control-Assistant
else                                                     -> TeXML/Budget-Engine
```
(`src/routes/api-calls.js:280-338`)

Faellt ElevenLabs aus oder wird der Schalter gedreht, faehrt **jeder** Outbound-Call in
den `else`-Zweig — real waehlend, nicht simuliert. Ein Feature, das nur im
ElevenLabs-Zweig existiert, ist beim Rueckfall lautlos weg.

Diese Phase stellt sicher: **kein Weg legt bei einem Owner-Ziel faelschlich offen, und
kein Weg schweigt bei einem Fremd-Ziel.**

---

## 2. Was zu bauen ist

### 2.1 Erst-Turn-Text: `openingText` (`src/claude.js:425-431`)

Heute:

```js
export function openingText(call) {
  const disclosure = disclosureSentence(call);
  const goal = trimGoalForSpeech(call.goal);
  if (!goal) return disclosure;
  return `${disclosure} ${localeFor(call.language).bridgePhrase(goal)}`;
}
```

Neu: bei `call.calleeIsOwner === true` tritt an die Stelle des Offenlegungssatzes die
Owner-Begruessung `localeFor(call.language).ownerOpening(firstName)` (aus OC-P2). Die
Bruecke und die Kappung des Anliegens bleiben **unveraendert** — es wird nur der erste
Satz ausgetauscht, nicht der Aufbau.

Zwingend:

- `firstName` kommt aus `store.tenantContext(call.tenantId)` — dieselbe Quelle, aus der
  `disclosureSentence` bereits `ownerName` zieht (`src/claude.js:392-397`).
- **Fail-closed:** `call.calleeIsOwner !== true` ODER `firstName` leer nach `trim()` ⇒
  der Bestandspfad, also Offenlegung. Strikt `=== true` pruefen.
- **`disclosureSentence` selbst wird NICHT angefasst.** Es bleibt der unbedingte
  Wortlaut-Lieferant; es gibt keine Variante, die `""` liefert. Die Verzweigung sitzt hier
  im Zusammensetzer.

**Eine Aenderung, zwei Wege.** `openingText` hat genau zwei Aufrufer:
`src/routes/voice.js:487` (TeXML/Budget-Engine, `<Say>`-Praefix im `<Gather>`) und
`src/telnyx-call-control-ingest.js:206` (Disclosure-Speak-Node vor `ai_assistant_start`).
Beide werden damit gemeinsam korrekt. Fasse keinen der beiden Aufrufer an.

### 2.2 Systemprompt: Owner-Persona

`systemPrompt(call)` (`src/claude.js:291`) baut den Prompt aus Bausteinen, die pro Sprache
in `src/i18n/prompts/{de,fr,en}.js` liegen. Der Kontext dafuer entsteht in der Funktion um
`src/claude.js:55-80` (dort steht heute `owner: ctx.firstName`).

Ergaenze im Kontext ein `calleeIsOwner: call.calleeIsOwner === true` und verzweige damit
**genau zwei** Bausteine:

**(a) `situationOutbound` → Owner-Variante.** Heute (DE,
`src/i18n/prompts/de.js:~41`):

> `SITUATION: Du rufst im Auftrag von ${owner} bei ${call.to} an. Du bist der Anrufer. Deine Offenlegung und dein Anliegen wurden dem Angerufenen bereits wörtlich gesagt, bevor du übernommen hast. Wiederhole sie NICHT. Knüpfe direkt an seine Antwort an.`

Neuer Baustein `situationOutboundOwner` je Sprache. Verbindlicher Inhalt:

| Sprache | Wortlaut |
|---|---|
| `de` | `SITUATION: Du rufst ${owner} an - deinen eigenen Auftraggeber. Du sprichst also direkt mit ihm, nicht mit einem Dritten. Deine Begrüßung und dein Anliegen wurden bereits wörtlich gesagt, bevor du übernommen hast. Wiederhole sie NICHT. Sprich in der Du-Form und rede nie in der dritten Person über deinen Auftraggeber. Es gibt niemanden, bei dem du rückfragen oder für den du eine Nachricht aufnehmen könntest - was unklar ist, fragst du direkt.` |
| `fr` | dieselbe Aussage, natuerliches Franzoesisch, Tutoiement, mit Akzenten |
| `en` | dieselbe Aussage, natuerliches Englisch |

**(b) Identitaets-Zeile in `clarificationRules`.** Heute gibt es dort zwei Zweige
(inbound / outbound, `src/i18n/prompts/de.js:~48`). Es kommt ein dritter dazu: outbound
**und** Owner.

| Sprache | Wortlaut |
|---|---|
| `de` | `- Wirst du gefragt, wer du bist, antworte wahrheitsgemäß: du bist der KI-Assistent von ${owner}. Du rufst auf der eigenen Nummer von ${owner} an, gehst also davon aus, mit ${owner} selbst zu sprechen. Weiche dieser Frage nie aus.` |
| `fr` | Entsprechung |
| `en` | Entsprechung |

**(b2) Pflicht-Rueckfallzeile — dieselbe Aussage wie im EL-Prompt (OC-P2 2.2), auf diesem
Weg genauso verbindlich.** Sie gehoert in denselben owner-spezifischen Baustein:

| Sprache | Wortlaut |
|---|---|
| `de` | `- Ist am Apparat nicht ${owner}, sprich sofort und wörtlich diesen Satz, bevor du irgendetwas anderes sagst: "${disclosure}" - und führe das Gespräch danach als normalen Anruf im Auftrag von ${owner}: dritte Person, Nachricht aufnehmen, keine Du-Form. Das gilt auch, wenn sich das erst mitten im Gespräch herausstellt.` |
| `fr` | Entsprechung |
| `en` | Entsprechung |

`${disclosure}` ist `localeFor(call.language).disclosure(ownerName)` — dieselbe eine
Quelle, die `disclosureSentence` benutzt (`src/claude.js:392-397`), in der Sprache dieses
Anrufs. Der Satz wird dem Modell **fertig** mitgegeben, nicht umschreiben gelassen: ueber
den Wortlaut einer Rechtspflicht entscheidet kein Modell.

Der Grund steht im Plan (1.4/7.9) und ist der gutglaeubige Normalfall, nicht der
Missbrauchsfall: `normalizePrivateNumber` kennt keine Mobilfunk-Beschraenkung und keinen
Geraetebezug (`src/store/state-ops.js:2127-2136`), ein Festnetz- oder
Gemeinschaftsanschluss ist als eigene Nummer zulaessig — und dort hebt irgendwann jemand
anderes ab. Der uebrige Owner-Baustein verbietet dem Agenten ausdruecklich, sich als
Assistent im Auftrag von jemandem vorzustellen; ohne diese Zeile bliebe ein ahnungsloser
Mensch ahnungslos.

**Die Verzweigungslogik bleibt in `src/claude.js`.** Die Prompt-Module liefern nur
Text-Bausteine — der Modulkopf von `src/i18n/prompts/de.js` sagt das ausdruecklich
("KEINE Verzweigungslogik hier - die lebt weiterhin in claude.js (G5/S2, sonst dreifach
vorhanden)"). Halte dich daran: drei Kopien derselben `if`-Abfrage in drei Sprachmodulen
sind genau der Fehler, den dieser Satz verhindert.

**Reichweite.** `systemPrompt` hat zwei Aufrufer: die Budget-Turn-Schleife
(`src/claude.js:1080`) und die Realtime-Bruecke (`src/bridge.js:99`). Beide werden damit
mit-korrekt. Fasse keinen der beiden an.

### 2.3 Der Telnyx-Assistant-Shim ist gedeckt — Beleg, keine offene Frage

`src/telnyx-llm-shim.js` bedient den Telnyx-Call-Control-Assistant-Pfad. Sein Prompt kommt
ueber `systemPrompt`; die Kette ist am Code belegt:

| Schritt | Beleg |
|---|---|
| Der Shim kapselt `agentTurn` | `src/telnyx-llm-shim.js:2` (Modulkopf: "Kapselt agentTurn (claude.js)") |
| `agentTurn` ist Abhaengigkeit der Fabrik | `src/telnyx-llm-shim.js:495` (`makeTelnyxLlmShim({ ..., agentTurn, ... })`) |
| `agentTurn` baut den Prompt ueber `systemPrompt` | `src/claude.js:1080` (`system: systemPrompt(call)`), Definition `src/claude.js:291` |

Er ist damit durch 2.2 abgedeckt, ohne eigene Aenderung. **Deine Aufgabe ist der Beleg,
nicht die Untersuchung:** ein Test, der den Shim-Pfad mit einem Owner-Call durch die
Prompt-Erzeugung schickt und die Owner-Situationszeile im erzeugten Systemprompt findet;
faellt er anders aus als hier beschrieben, ist DAS der Befund fuer den Phasenbericht
(Datei:Zeile), und es wird trotzdem nichts umgebaut. Der Eroeffnungs-Teil dieses Pfads ist
ueber `openingText` (2.1) ohnehin gedeckt
(`src/telnyx-call-control-ingest.js:206`).

### 2.4 Beschriftung des Nummernfelds im Dashboard

Seit OC-P2 entscheidet `tenant.privateNumber` mit darueber, ob ein gesetzlicher
Pflichtsatz gesprochen wird. Bis dahin steuerte das Feld nur, wohin die
Anruf-Zusammenfassung als SMS geht. Ein Feld, dessen Wirkung sich verdoppelt, ohne dass
die Beschriftung es sagt, ist eine Falle.

Datei: `apps/web/src/components/app/SettingsIsland.astro` (die Route dahinter ist
`POST /api/self-service/private-number`, `src/self-service-routes.js:401-414`).

- Ergaenze den erklaerenden Text um genau zwei Aussagen: dass Anrufe an **diese** Nummer
  als Anrufe an dich selbst behandelt werden, und dass der Assistent dich dabei direkt mit
  Vornamen anspricht und den langen Offenlegungssatz weglaesst.
- **Nicht schreiben, dass "die KI-Offenlegung weggelassen" wird** — das waere falsch und
  eine Einladung, eine fremde Nummer einzutragen. Die Eroeffnung nennt weiterhin die KI
  ("your AI assistant"), und sobald am Apparat jemand anderes ist, folgt der volle Satz
  (Plan 1.4). Wenn der Platz reicht, sag genau das in einem Halbsatz: die Nummer muss dir
  selbst gehoeren.
- **`/app` bleibt englisch.** Kein Uebersetzungs-Mechanismus, keine neue Sprachdatei.
- Keine Layout-/Design-Aenderung, kein neues Feld, keine neue Route.
- Der Wert wird weiterhin nur maskiert angezeigt (`maskPrivateNumber`,
  `src/self-service-routes.js:324`). Daran aendert sich nichts.

Dies ist eine reine Textaenderung an einer Astro-Komponente; die Marketing-Website-Kette
(`staging` → `hermes-web-staging`) ist davon **nicht** betroffen — `/app` wird vom
Gateway ausgeliefert.

---

## 3. Bewusst NICHT geaendert (und warum)

| Stelle | Entscheidung |
|---|---|
| `src/bridge.js:222-227` (Realtime-Opener) | bleibt bei `disclosureSentence`. Realtime ist am Telnyx-Provider produktiv blockiert und `VOICE_ENGINE` steht auf `budget`. Wuerde der Zweig doch fahren, bekaeme der Owner eine ueberfluessige Offenlegung — die harmlose Richtung. Kein Overengineering fuer einen toten Pfad. |
| `boundaries.personalData` / `noCalendar` in den Prompt-Modulen | bleiben. Sie schuetzen gegen Weitergabe an Dritte; gegenueber dem Auftraggeber sind sie lediglich uebervorsichtig, nicht falsch. Sie umzuschreiben vervielfacht die Prompt-Oberflaeche fuer einen Randnutzen. **Als bekannte Einschraenkung in den Phasenbericht.** |
| `disclosureSentence` | unbedingt, s. 2.1. |
| `persona`-Baustein | bleibt. Er beschreibt, WER der Agent ist, nicht mit wem er spricht — das erledigt `situationOutboundOwner`. |
| Gate-Kette, `outbound-gates.js` | unberuehrt. |

---

## 4. Invarianten (verletzen = Phase durchgefallen)

1. **Fuer jedes Nicht-Owner-Ziel sind Erst-Turn-Text und Systemprompt byte-identisch zum
   Bestand** — in allen drei Sprachen, inbound wie outbound.
2. **`disclosureSentence` bleibt unbedingt.**
3. **Kein bestehender Offenlegungs-Test wird veraendert.** Betroffen sind mindestens:
   `test/disclosure-outbound.test.js`, `test/disclosure-regression.test.js`,
   `test/g1-identity-binding.test.js`, `test/g2-opening-turn.test.js`,
   `test/claude-identity.test.js`, `test/telnyx-p8-opening-contract.test.js`,
   `test/al-p5-opening.test.js`, `test/inbound-disclosure-mandatory.test.js`. Faellt einer
   um, ist das ein Befund fuer den Phasenbericht, kein Anpassungsbedarf.
4. **Keine Verzweigungslogik in `src/i18n/prompts/*`** — nur Text-Bausteine.
4b. **Die Rueckfallzeile aus 2.2b steht in jedem Owner-Baustein**, in allen drei Sprachen,
   mit dem hereingereichten Offenlegungssatz. Fehlt sie, ist die Phase durchgefallen —
   und zwar aus demselben Grund wie eine fehlende Offenlegung: ein Mensch, der nicht
   weiss, dass er mit einer KI spricht.
5. **Der Schalter wird nicht erneut abgefragt.** Diese Phase liest ausschliesslich
   `call.calleeIsOwner`.
6. `LLM_PROVIDER=anthropic npm test` ist vollstaendig gruen.

---

## 5. Abgrenzung — ausdruecklich NICHT in dieser Phase

- Kein ElevenLabs-Pfad, keine Anbieter-Vorlage, kein `elevenlabs:push`, kein
  `elevenlabs:drift`.
- Keine Inbound-Erkennung ("Owner ruft an") — ausdruecklich nicht Teil dieser Kette.
- Keine Besitz-Verifikation der Nummer.
- Kein Umbau des Telnyx-Assistant-Shims (2.3 ist ein Beleg mit Test, kein Bauauftrag).
- Kein Deploy, kein echter Anruf, kein `git push`.

---

## 6. Tests

Neue Datei `test/callee-is-owner-opening.test.js`. **Kein Katalog-ID-Praefix** am
Testnamen und kein `ABNAHME-`-Praefix.

**A. `openingText`, je Sprache de/fr/en**
- Owner-Ziel ⇒ der Text **beginnt** mit `LOCALES.<lang>.ownerOpening(firstName)` und
  enthaelt den Offenlegungssatz **nicht** (pruefe zusaetzlich gegen einen
  charakteristischen Teilsatz, damit auch ein Fragment auffaellt).
- Owner-Ziel mit Anliegen ⇒ die Bruecke und die 75-Zeichen-Kappung wirken unveraendert
  (dieselbe Zusage, die `test/al-p5-opening.test.js` fuer den Bestandsfall haelt).
- Owner-Ziel ohne Anliegen ⇒ nur die Begruessung, kein Bruecken-Artefakt.
- Fremd-Ziel ⇒ byte-identisch zum Bestand.
- Fail-closed: `calleeIsOwner` fehlt / `false` / String `"true"` / leerer `firstName` ⇒
  jeweils Offenlegung.

**B. `systemPrompt`, je Sprache**
- Owner-Ziel ⇒ enthaelt die Owner-Situationszeile, enthaelt **nicht** die
  Bestands-Situationszeile ("im Auftrag von ... bei ... an" bzw. die
  Sprach-Entsprechung), und enthaelt die Owner-Identitaetszeile.
- Fremd-Ziel outbound ⇒ byte-identisch zum Bestand.
- Inbound ⇒ byte-identisch zum Bestand, unabhaengig von `calleeIsOwner` (ein Inbound-Call
  traegt das Feld gar nicht; er darf davon nicht beruehrt werden).

**C. Ende zu Ende ueber die Route, ohne echten Anruf.** `/voice/outbound` mit
`SKIP_TWILIO_SIGNATURE_CHECK=true`: bei Owner-Ziel enthaelt das gerenderte TwiML den
`<Say>`-Praefix mit der Owner-Begruessung und **nicht** den Offenlegungssatz; bei
Fremd-Ziel unveraendert. Vorbild fuer den Aufbau: `test/disclosure-outbound.test.js`
(nicht veraendern — nachbauen).

**D. Telnyx-Assistant-Pfad.** Der Speak-Node vor `ai_assistant_start` traegt bei
Owner-Ziel die Owner-Begruessung, bei Fremd-Ziel byte-identisch den Bestandstext.
Vorbild: `test/telnyx-p8-opening-contract.test.js` (nicht veraendern — nachbauen).

**E. Umlaute — die richtige Ratsche, und warum sie hier nicht reicht.**

Die Umlaut-Zusage fuer PROMPT-Bausteine haelt `test/cq-p5-prompt-redesign.test.js`
(`P5-O1`/`P5-O2` fuer DE, `P5-O1b`/`P5-O2b` fuer FR) — **nicht**
`test/de-umlaut-orthography.test.js`, das deckt die `LOCALES`-Felder ab. Beide bleiben
unveraendert und gruen.

`P5-O1`/`P5-O2` rendern den Prompt ueber `seedCall({ tenantId, language, direction })`
(`test/cq-p5-prompt-redesign.test.js:38`) — **ohne `calleeIsOwner`**. Der neue Baustein
`situationOutboundOwner` und die Owner-Identitaets-/Rueckfallzeilen werden dort also NIE
erzeugt und sind von der Bestands-Ratsche ungedeckt.

Der neue Test bringt die Pruefung deshalb selbst mit: fuer den Owner-Zweig je Sprache
(a) keine Transliteration — gegen dieselbe eine Quelle `TRANSLITERATION_STEMS` aus
`test/umlaut-stems-helper.js`, NICHT gegen eine eigene Kopie —, und (b) die Gegenprobe auf
echte Umlaut-/Akzentzeichen, die fuer die DE- und FR-Owner-Bausteine anwendbar ist (der
DE-Wortlaut aus 2.2 traegt "Begrüßung"/"wörtlich", der FR-Wortlaut traegt Akzente). Wo ein
vorgeschriebener Wortlaut ausnahmsweise gar kein solches Zeichen enthaelt, entfaellt die
Gegenprobe FUER DIESEN STRING mit begruendendem Kommentar — nie durch Biegen des
Wortlauts.

---

## 7. Abnahme (deterministisch)

Alle Kommandos vom Repo-Wurzelverzeichnis.

1. **Syntax**
   ```
   node --check src/claude.js && node --check src/i18n/prompts/de.js && node --check src/i18n/prompts/fr.js && node --check src/i18n/prompts/en.js
   ```
   Erwartet: keine Ausgabe, Exit 0.

2. **Neue Tests**
   ```
   NODE_ENV=test LLM_PROVIDER=anthropic node --test test/callee-is-owner-opening.test.js
   ```
   Erwartet: `fail 0`, `pass` >= 22 (die Rueckfallzeile aus 2.2b und der Shim-Beleg aus
   2.3 kommen zu den urspruenglich 18 Faellen dazu).

3. **Die Bestands-Riegel sind unveraendert gruen**
   ```
   NODE_ENV=test LLM_PROVIDER=anthropic node --test test/disclosure-outbound.test.js test/disclosure-regression.test.js test/g1-identity-binding.test.js test/g2-opening-turn.test.js test/claude-identity.test.js test/telnyx-p8-opening-contract.test.js test/al-p5-opening.test.js test/inbound-disclosure-mandatory.test.js test/de-umlaut-orthography.test.js test/cq-p5-prompt-redesign.test.js
   ```
   Erwartet: `fail 0`. `test/cq-p5-prompt-redesign.test.js` ist die Ratsche, die die
   Prompt-Orthografie haelt (nicht `de-umlaut-orthography`, s. Tests/E) und gehoert
   deshalb in diese Liste.

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
   fail 3`).

6. **Kein bestehender Offenlegungs-Test wurde angefasst**
   ```
   git diff --stat master -- test/disclosure-outbound.test.js test/disclosure-regression.test.js test/g1-identity-binding.test.js test/g2-opening-turn.test.js test/claude-identity.test.js test/telnyx-p8-opening-contract.test.js test/al-p5-opening.test.js test/inbound-disclosure-mandatory.test.js
   ```
   Erwartet: **leer**.

7. **Nichts ausserhalb des Scopes bewegt**
   ```
   git diff --stat master -- src/elevenlabs src/bridge.js elevenlabs/ src/telephony
   ```
   Erwartet: **leer**.

8. **Der Shim-Beleg steht.** Der Phasenbericht nennt fuer `src/telnyx-llm-shim.js` die
   Beleg-Kette aus 2.3 (Datei:Zeile) UND den Test, der sie haelt. Ein "vermutlich" gilt
   als nicht belegt. Weicht der gemessene Befund von 2.3 ab, ist das der Befund — nicht
   ein Bauauftrag.

9. **Die Rueckfallzeile ist auf beiden Wegen wirksam.**
   ```
   grep -rn "disclosure" src/i18n/prompts/de.js src/i18n/prompts/fr.js src/i18n/prompts/en.js | head
   ```
   Erwartet: der Offenlegungssatz wird in den Owner-Bausteinen als **hereingereichter
   Wert** verwendet (Parameter), NICHT als in den Prompt-Modulen neu formulierter Text.
   Eine zweite Fassung des Satzes irgendwo in `src/i18n/prompts/*` ist ein
   Phasenfehlschlag (eine Quelle, G5).

---

## 8. Fallen aus der Projekthistorie

- **Zwei Umlaut-Regeln in dieser Phase.** Gesprochene DE-Strings (`locales.js`) UND der
  DE-Prompt-Rumpf (`prompts/de.js`, seit CQ-P5) tragen echte Umlaute; Code-Kommentare und
  Doku bleiben ASCII. Ein pauschales Transliterieren macht hier zwei Tests rot.
- **Katalog-ID-Praefix:** ein Testname, der mit `LAW-`, `PROMPT-`, `VOICE-` usw. beginnt,
  wandert stumm in den `test:gates`-Lauf.
- **Der `else`-Zweig waehlt echt.** `FAKE_ORIGINATE` steht per Default auf `false`; in
  Tests immer setzen.
- **`git add -A` ist in diesem Repo verboten.** Dateien einzeln adden.
- **Verwaiste Testserver:** nach langen Laeufen mit `ps` pruefen (`pgrep` ist in der
  Sandbox blind).
