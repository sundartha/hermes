# GQ-E1 — Spec (bindend): Eroeffnungs-Komposition auf dem ElevenLabs-Outbound-Weg

Status: bindend. Wer das umsetzt, braucht kein anderes Dokument. Entscheidungsgrundlage steht in
`tasks/gq-strategie-2026-08-19.md`; die Entwuerfe sind ueberholt.

Sprache: Code-Kommentare und Doku deutsch, OHNE Umlaute. **Gesprochene Strings (de/fr) tragen
Umlaute und Akzente** — das ist die Regel, nicht die Ausnahme.

---

## 1. Was heute falsch ist (der zu behebende Zustand)

Gemessener erster Satz aus Anruf `call_mt0ddduxuzgl` (woertlich aus der Prod-DB):

> "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Antonio Fotiadis. Das Gespräch wird
> für meinen Auftraggeber zusammengefasst. Ich wollte fragen, ob du morgen um 15 Uhr Zeit für
> eine Runde Tennis hast.. Wie sieht es damit bei Ihnen aus?"

Drei Defekte, eine Wurzel:

1. **Doppelter Punkt.** Der Auftragstext endet auf ".", `bridgePhrase` haengt bedingungslos ein
   weiteres "." an (`src/i18n/locales.js:180-181`, DE-Zweig mit Ich-Satz-Passthrough).
2. **Du/Sie-Bruch.** Der Auftrag duzt, die fest angehaengte Abschlussfrage siezt
   (`LOCALES.de.openingQuestion`) und kann sich nicht anpassen.
3. **Doppelte Frage.** Der Auftrag ist bereits die vollstaendige Frage; die feste Frage kommt
   trotzdem.

**Wurzel:** die gesprochene Eroeffnung entsteht an zwei Orten. Unsere Seite liefert die
Grund-Zeile als dynamische Variable `{{opening_line}}`; der fremde Agent haelt Offenlegung UND
Abschlussfrage als STATISCHEN Text (`agent.first_message` und
`language_presets.<lang>.overrides.agent.first_message` in
`elevenlabs/agent_configs/outbound-agent.template.json`, gespiegelt in
`src/elevenlabs/call-locale.js` `providerOpening`). Der Teil der Eroeffnung, der sich pro Anruf
entscheiden muss, liegt an der einzigen Stelle, die sich pro Anruf nicht aendern kann.

---

## 2. Die Entscheidung als Regeln

**R1 — Der Rahmen endet mit der Variablen.**
`providerOpening` = `disclosure(ownerName)` + `" "` + `{{opening_line}}`. Hinter der Variablen
steht kein Textteil mehr. Der Offenlegungssatz bleibt woertlich und allererster Satz (Absolute
Regel 2, Artikel 50 EU AI Act) — er bleibt exakt dort, wo er heute steht.

**R2 — Die Zeile darf fragen.** `SENTENCE_END` wird `/[.!?]$/`. Daneben ein eigener Waechter: ein
Fragezeichen darf NUR das letzte Zeichen sein. Die alte Zusage "nie zwei Fragen hintereinander"
ist damit nicht aufgeweicht, sondern an die Stelle verschoben, die sie jetzt entscheidet (R3).

**R3 — Die Frage wird angehaengt, wenn und nur wenn die Zeile nicht schon fragt.**
`composedOpeningLine(reason, locale)` = `reason`, falls `reason` auf "?" endet; sonst
`reason + " " + locale.openingQuestion`. Deterministisch, ohne Sprachkenntnis, in jeder Sprache
identisch. Die Eroeffnung endet danach IMMER auf genau eine Frage.

**R4 — Feste gesprochene Eroeffnungs-Bausteine tragen in Sprachen mit Du/Sie-Unterscheidung kein
Anrede-Pronomen.** Betroffen: `openingQuestion`, `openingReasonFallback` und der feste Rahmen von
`bridgePhrase`, je fuer `de` und `fr`. Ein Baustein ohne Anrede kann mit keiner Anrede des
Auftrags brechen — die einzige Loesung des Register-Problems, die ohne Heuristik auskommt und auf
ALLEN Stufen der Treppe traegt (Stufe 3 kennt den Auftragstext gar nicht). Englisch ist
ausgenommen: "you"/"your" tragen dort kein Register, es gibt nichts zu brechen.

**R5 — Genau ein Satz-Endzeichen.** `bridgedObjective` streicht ein mitgebrachtes `[.!]+$`, bevor
`bridgePhrase` ihres setzt. Endet der Auftrag auf "?", laeuft er OHNE Bruecken-Rahmen durch: er
ist bereits die sprechbare Frage, und "Es geht um Folgendes: Hast du morgen Zeit?" waere ein
Rahmen um eine Frage.
**Bewusste Abweichung, so zu kommentieren:** `trimGoalForSpeech` auf dem Telnyx-Weg
(`src/claude.js:436`) streicht `[.!?]+$`, also AUCH das Fragezeichen. Hier wird das Fragezeichen
absichtlich behalten. Der Telnyx-Weg wird NICHT angepasst — dort gibt es den Defekt nicht.

**R6 — Komponiert wird auf der Schreibseite, nie nach der Hash-Pruefung.** Die Komposition
passiert in `fetchOpeningLine` (also VOR `createCall` und damit vor `openingLineHash`) und
zusaetzlich im RUECKFALL-Zweig von `verifiedOpeningLine`. Sie darf niemals in `outbound.js` oder
sonst hinter der Hash-Gegenprobe stattfinden — dort waere der angehaengte Satz ungeprueft und
ungehasht.

---

## 3. Verhalten vorher/nachher, je Stufe und je Sprache

Rueckfall-Treppe (unveraendert dreistufig, `src/elevenlabs/opening-line.js` Kopfkommentar):
1. erzeugte Zeile (`opening-line-llm.js`), 2. `locale.bridgePhrase(objective)`, 3.
`locale.openingReasonFallback`.

### Was aus der Grund-Zeile wird

| | `goal` nennt nur einen Grund | `goal` ist bereits eine Frage |
|---|---|---|
| **Stufe 1** (erzeugt) | Aussagesatz + feste Frage | erzeugte direkte Frage, nichts angehaengt |
| **Stufe 2** (Bruecke) | Bruecke + genau ein Punkt + feste Frage | Auftrag woertlich (endet auf "?"), kein Rahmen, nichts angehaengt |
| **Stufe 3** (fest) | feste Kurzzeile + feste Frage | dito (der Auftragstext ist hier ohnehin raus) |

### Der gemessene Fall, Stufe 2 (LLM aus oder tot), DE

- **vorher:** `... zusammengefasst. Ich wollte fragen, ob du morgen um 15 Uhr Zeit für eine Runde Tennis hast.. Wie sieht es damit bei Ihnen aus?`
- **nachher:** `... zusammengefasst. Ich wollte fragen, ob du morgen um 15 Uhr Zeit für eine Runde Tennis hast. Wie sieht es damit aus?`

Ein Punkt, eine Frage, kein "Ihnen". Stufe 1 (LLM lebt) ergaebe stattdessen z.B. `Hast du morgen
um 15 Uhr Zeit für eine Runde Tennis?` und haengt nichts an.

### Die sprachabhaengigen Bausteine

| Feld | vorher | nachher |
|---|---|---|
| `de.openingQuestion` | `Wie sieht es damit bei Ihnen aus?` | `Wie sieht es damit aus?` |
| `fr.openingQuestion` | `Qu'en est-il de votre côté ?` | `Qu'en est-il ?` |
| `en.openingQuestion` | `How does that look on your side?` | **unveraendert** |
| `de.openingReasonFallback` | `Ich rufe an, um ein kurzes Anliegen mit Ihnen zu klären.` | `Ich rufe an, um ein kurzes Anliegen zu klären.` |
| `fr.openingReasonFallback` | `J'appelle pour régler une petite demande avec vous.` | `J'appelle pour régler une petite demande.` |
| `en.openingReasonFallback` | `I am calling to sort out a small matter with you.` | **unveraendert** |

Jede Aenderung ist ein STREICHEN des anrede-tragenden Satzteils, keine Neuerfindung — der Rest
bleibt byte-identisch. `bridgePhrase` wird NICHT angefasst (die Interpunktion wird eine Etage
hoeher geloest, dort wo der Defekt sitzt; der Telnyx-Weg bleibt byte-identisch).

### Der statische Rahmen am Anbieter

| Ort | vorher (Ende) | nachher (Ende) |
|---|---|---|
| `agent.conversation_config.agent.first_message` | `... {{opening_line}} How does that look on your side?` | `... {{opening_line}}` |
| `language_presets.de.overrides.agent.first_message` | `... {{opening_line}} Wie sieht es damit bei Ihnen aus?` | `... {{opening_line}}` |
| `language_presets.fr.overrides.agent.first_message` | `... {{opening_line}} Qu'en est-il de votre côté ?` | `... {{opening_line}}` |
| `language_presets.es` | `null` | `null` (unveraendert) |
| `voicemail_message` | fuehrt `{{opening_line}}` mitten im Text | unveraendert (traegt kuenftig die Frage mit — bewusst akzeptiert) |

---

## 4. Dateien und Aenderungen

### 4.1 `src/elevenlabs/opening-line.js`

a) `SENTENCE_END` -> `/[.!?]$/`. Der Kommentar "BEWUSST OHNE '?'" wird durch die neue Begruendung
ersetzt: die feste Frage steht nicht mehr dahinter, ueber sie entscheidet
`composedOpeningLine`.

b) Neuer Waechter mit eigenem Kommentar, direkt daneben:

```js
// Ein Fragezeichen NUR als letztes Zeichen: zwei Fragen in einer Aeusserung lassen den
// Angerufenen raten, welche er beantworten soll. Dieselbe Zusage wie vorher, nur an der
// Stelle, an der sie jetzt etwas entscheidet (composedOpeningLine).
const QUESTION_MARK = "?";
const fragtHoechstensAmEnde = (line) => {
  const i = line.indexOf(QUESTION_MARK);
  return i === -1 || i === line.length - 1;
};
```

In `validOpeningLine` DIREKT hinter der `SENTENCE_END`-Pruefung:
`if (!fragtHoechstensAmEnde(line)) return null;`

c) Neue exportierte, reine Funktion — die EINE Stelle, an der komponiert wird:

```js
/**
 * Die vollstaendige gesprochene Eroeffnung NACH der Offenlegung: die Grund-Zeile und -
 * nur wenn sie nicht schon selbst fragt - die feste Frage der Sprache. Der statische
 * Rahmen am Anbieter endet mit der Variablen (call-locale.js), also ist DIES der
 * einzige Ort, an dem ueber die Frage entschieden wird.
 *
 * @param {string} reason gepruefte Grund-Zeile (validOpeningLine)
 * @param {object} locale LOCALES-Bundle (localeFor)
 * @returns {string}
 */
export function composedOpeningLine(reason, locale) {
  return reason.endsWith(QUESTION_MARK) ? reason : `${reason} ${locale.openingQuestion}`;
}
```

d) `bridgedObjective` nach R5:

```js
export function bridgedObjective(objective, locale) {
  if (typeof objective !== "string") return null;
  const normalized = objective.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  // Der Auftrag IST schon die sprechbare Frage - kein Rahmen, kein zweites Satzzeichen.
  if (normalized.endsWith(QUESTION_MARK)) return validOpeningLine(normalized);
  // Genau EIN Satz-Endzeichen: bridgePhrase setzt ihres, also faellt ein mitgebrachtes
  // vorher weg. BEWUSST NUR [.!] - trimGoalForSpeech (claude.js, Telnyx-Weg) streicht
  // zusaetzlich das Fragezeichen; hier bleibt es stehen, weil eine Frage-Zeile seit
  // dieser Phase gueltig ist. Der Telnyx-Weg bleibt unveraendert.
  const ohneSatzende = normalized.replace(/[.!]+$/, "").trim();
  if (!ohneSatzende) return null;
  return validOpeningLine(locale.bridgePhrase(ohneSatzende));
}
```

e) `verifiedOpeningLine`: der GESPEICHERTE Wert ist bereits die komponierte Zeile und wird
unveraendert zurueckgegeben (der Hash deckt genau ihn ab); der Rueckfall komponiert hier:

```js
  const reason = bridgedObjective(call.goal, locale) ?? locale.openingReasonFallback;
  return composedOpeningLine(reason, locale);
```

Die Asymmetrie gehoert als Kommentar hin: **oben verbuergt, unten komponiert** — die gespeicherte
Zeile ist die bei Auftragsannahme komponierte (R6), der Rueckfall entsteht erst hier und muss
denselben Schritt noch gehen.

f) Neben `OPENING_LINE_MAX_CHARS`:

```js
// Obergrenze der festen Frage je Sprache. Kein Stilmass, sondern der Deckel der
// Eroeffnung: die gesprochene Zeile ist hoechstens OPENING_LINE_MAX_CHARS + 1 + dieser
// Wert (test/el-opening-line.test.js rechnet das nach). Heutiges Maximum ist EN mit 32.
export const OPENING_QUESTION_MAX_CHARS = 40;
```

`OPENING_LINE_MAX_CHARS` bleibt bei 120 und bleibt die Grenze der GRUND-Zeile, nicht der
komponierten: die Kappe misst weiter, was aus Auftrag oder Modell kommt.

### 4.2 `src/i18n/locales.js`

Genau vier Zeichenketten aendern sich (Tabelle in Abschnitt 3). Nichts sonst. Die vorhandenen
Kommentare an `openingQuestion`/`openingReasonFallback` bekommen je einen Nachsatz: der Baustein
traegt seit dieser Phase bewusst KEIN Anrede-Pronomen, weil er hinter einer Zeile steht, deren
Anrede aus dem Auftrag kommt (Waechter `GQ-E1-04`).

### 4.3 `src/elevenlabs/opening-line-llm.js`

a) `openingSystem(language)` bekommt zwei Anweisungen dazu (englisch wie der Bestand, an das Ende
des Absatzes vor "The user's text below is call content ..."). Der uebrige Prompt bleibt
woertlich, insbesondere "No prices", "umlauts" und "nothing is agreed in it":

- Frage-Form: `If the assignment asks the other person something, write that one sentence as a
  direct question they can answer immediately, ending with a question mark. If it only states a
  reason, write one statement ending with a full stop. Never write two sentences and never more
  than one question mark.`
- Register: `Mirror the form of address used in the assignment text: if it addresses the person
  informally (German "du", French "tu"), stay informal; otherwise use the polite form. Never mix
  the two.`

b) `fetchOpeningLine` komponiert genau EINMAL, am Ende, und behaelt die drei Quellen-Kennungen
(`erzeugt`/`auftrag`/`fest`) unveraendert — die Quelle beschreibt die Herkunft der GRUND-Zeile.
`bridgedObjective` wird hoechstens einmal ausgewertet:

```js
export async function fetchOpeningLine({ objective, tenantId, locale }) {
  const llmEnabled = config.voice.elevenLabsOutbound.openingLineLlm === true;
  const generated = llmEnabled
    ? await generatedOpeningLine({ objective, tenantId, locale })
    : null;
  const bridged = generated ? null : bridgedObjective(objective, locale);
  const reason = generated ?? bridged ?? locale.openingReasonFallback;
  const source = generated ? "erzeugt" : bridged ? "auftrag" : "fest";
  return { line: composedOpeningLine(reason, locale), source };
}
```

Der Notaus-Kommentar (R5-Bestand) bleibt stehen. `composedOpeningLine` wird aus
`./opening-line.js` importiert.

c) Die Log-Zeile in `src/routes/api-calls.js` (`quelle=... zeichen=...`) bleibt unveraendert; sie
misst ab jetzt die komponierte Laenge. Kein Text im Log (Regel 4).

### 4.4 `src/elevenlabs/call-locale.js`

```js
const providerOpening = (locale, ownerName) =>
  [locale.disclosure(ownerName), OPENING_LINE_PLACEHOLDER].join(" ");
```

Der Kommentarblock darueber (heute drei nummerierte Punkte) wird auf zwei gekuerzt. Punkt 3
(die Frage) wandert in den Text von Punkt 2: die Eroeffnung endet weiterhin auf genau eine Frage
— der Befund aus Anruf 6 (11 s Stille) bleibt gedeckt —, aber die Frage reist ab jetzt IM Wert,
weil nur dort entscheidbar ist, ob sie noch gebraucht wird (`opening-line.js`
`composedOpeningLine`). `firstMessage`, `providerOpeningFor` und `callLocaleFor` behalten
Signatur und Abnehmer. Nach der Aenderung referenziert diese Datei `locale.openingQuestion` nicht
mehr — das ist beabsichtigt und der Kern von R1.

### 4.5 `elevenlabs/agent_configs/outbound-agent.template.json`

Drei `first_message`-Werte verlieren ihren Schwanz hinter `{{opening_line}}` (Tabelle in
Abschnitt 3), inklusive des trennenden Leerzeichens: die Werte enden danach exakt auf
`{{opening_line}}`. `language_presets.es` bleibt `null`. `voicemail_message` bleibt unveraendert.

Dazu ein NACHTRAG-Satz in `_sprachumstellung_hinweis` (Muster der dortigen Nachtraege), deutsch
ohne Umlaute, sinngemaess: *Thema E, 2026-08-19 — `{{opening_line}}` traegt jetzt Grund UND, wo
noetig, die Abschlussfrage; der statische Rahmen endet mit der Variablen, damit die Frage pro
Anruf entfallen kann. Das Variablen-Vokabular bleibt bei zwoelf Namen, die 18 Testdefinitionen
unter `elevenlabs/test_configs/` bleiben unberuehrt.*

Ebenso ein Nachsatz in `agent._first_message_hinweis`: der Referenz-Wortlaut ist weiterhin
`providerOpeningFor` (`src/elevenlabs/call-locale.js`), aber er endet ab jetzt mit der Variablen.

---

## 5. Testplan

Testdatei-Zuordnung: alles Neue in `test/el-opening-line.test.js`, ausser `GQ-E1-05`
(Vorlagen-Pruefung, gehoert zu T5 in `test/elevenlabs-anrufstart.test.js`).
**Testnamen der neuen Faelle beginnen mit `GQ-E1-`** — dieses Praefix trifft weder
`config.i18nCatalogPattern` noch `config.abnahmePattern` in `package.json`, die Faelle bleiben
also im Regressionslauf (`npm test`).

### 5.1 Bestandsfaelle, die MITGEZOGEN werden muessen (sonst rot)

Angegeben ist der Testname, nicht die Zeilennummer.

**`test/el-opening-line.test.js`**

| Testname | Aenderung |
|---|---|
| `fetchOpeningLine: erzeugte Zeile gewinnt und Umlaute ueberleben byte-genau (A6)` | Erwartung wird `GENERATED_DE + " " + localeFor("de").openingQuestion` |
| `fetchOpeningLine: unbrauchbare Erzeugung -> Stufe 2, WORTGLEICH der Anruf-8-Wortlaut` | Erwartung + `" " + openingQuestion` |
| `fetchOpeningLine: LLM-Fehler -> Stufe 2; ASCII-Auftrag bleibt ASCII (ehrlich, nie umgeschrieben)` | Erwartung + `" " + openingQuestion` |
| `fetchOpeningLine: Erzeugung UND Auftrag unbrauchbar -> feste Kurzzeile (Stufe 3)` | Erwartung wird `openingReasonFallback + " " + openingQuestion`; die zweite Zusicherung `validOpeningLine(line)` BLEIBT und muss weiter gruen sein (die komponierte Zeile besteht ihre eigene Pruefung) |
| `fetchOpeningLine: Ich-Satz-Auftrag laeuft ohne Bruecken-Rahmen (bridgePhrase-Zweig)` | Erwartung + `" " + openingQuestion` |
| `verifiedOpeningLine: ROTPROBE - mutierte Zeile wird NIE gesprochen, Rueckfall greift` | Rueckfall-Erwartung wird komponiert |
| `verifiedOpeningLine: halber Datensatz (Hash weg) -> Rueckfall, nie die unverbuergte Zeile` | dito |
| `verifiedOpeningLine: Alt-Datensatz ohne Zeile -> stiller deterministischer Rueckfall` | dito |
| `verifiedOpeningLine: unbrauchbares goal am Alt-Datensatz -> feste Kurzzeile` | dito |
| `Notaus (R5): openingLineLlm=false -> KEIN LLM-Aufruf, Treppe ab Stufe 2` | Erwartung + `" " + openingQuestion`; die Zusicherung `requestCount` unveraendert bleibt |
| `validOpeningLine: Rotprobe Fragezeichen-Ende - vor der festen Frage darf keine zweite stehen` | **wird ersetzt** durch `GQ-E1-02` + `GQ-E1-03` (die Zusage bleibt, ihre Form aendert sich) |
| `verifiedOpeningLine: unveraenderte Zeile wird gesprochen` | **unveraendert** — der gespeicherte Wert wird byte-genau zurueckgegeben |
| `openingReasonFallback: JEDE Sprache fuehrt eine feste Kurzzeile, die ihre eigene Pruefung besteht` | **unveraendert** |

**`test/elevenlabs-torzustand.test.js`**

| Testname | Aenderung |
|---|---|
| `ROTPROBE A6: mutierte Zeile (Hash passt nicht) wird NIE gesendet - Rueckfall greift` | Erwartung wird `Es geht um Folgendes: Termin vereinbaren. Wie sieht es damit aus?` — aus `LOCALES` gelesen, nicht getippt |
| `Alt-Datensatz ohne Zeile -> deterministischer Rueckfall aus dem Auftrag, NIE roh unbegrenzt` | dito |
| `festgelegte Zeile mit passendem Hash wird WOERTLICH gesendet (Umlaute ueberleben)` | **unveraendert** |

**`test/elevenlabs-anrufstart.test.js`**

| Testname | Aenderung |
|---|---|
| `EL-START T11 (Thema A): opening_line reist geprueft an den Anbieter UND liegt mit Annahme-Hash am Datensatz` | `erwartet` wird ``` `Es geht um Folgendes: ${OBJECTIVE}. ${LOCALES.de.openingQuestion}` ``` (aus `LOCALES`, nicht getippt). ZUSAETZLICH: `assert.ok(call.openingLine.endsWith("?"))` mit der Begruendung, dass komponiert wird, BEVOR gehasht wird (R6) |
| `EL-START T5 (c, Mechanismus, gruen): ...` | Gleichheit gegen `providerOpeningFor("en")` bleibt; die Meldung "(Offenlegung + Bruecke + Frage)" wird zu "(Offenlegung + Grund-Zeile)". NEU: `GQ-E1-05` (unten) |
| `EL-START T5 (e, Mechanismus, gruen): ...` | Gleichheit gegen `providerOpeningFor(sprache)` bleibt; NEU: `GQ-E1-05` deckt auch die Presets |

**`test/elevenlabs-sprachwahl.test.js`**: die `startsWith(disclosureFor(...))`-Zusicherung bleibt
unveraendert gruen; nur der erklaerende Kommentar/die Meldung nennen ab jetzt "Offenlegung +
Grund-Zeile" statt "Offenlegung + Bruecke + Frage".

### 5.2 Neue Faelle

**`GQ-E1-01: der Befundfall aus call_mt0ddduxuzgl, byte-genau`**
LLM aus (`config.voice.elevenLabsOutbound.openingLineLlm = false`, im `finally` zuruecksetzen),
`objective` = woertlich `Ich wollte fragen, ob du morgen um 15 Uhr Zeit für eine Runde Tennis hast.`
Erwartet exakt:
`Ich wollte fragen, ob du morgen um 15 Uhr Zeit für eine Runde Tennis hast. Wie sieht es damit aus?`
Dazu drei Zusicherungen am selben Wert: enthaelt kein `..`, enthaelt kein `Ihnen`, enthaelt genau
ein `?`. Kommentar: das ist der Regressionsanker des Befunds.

**`GQ-E1-02: eine Zeile, die am Ende fragt, ist gueltig`**
Je Sprache ein Fall: `validOpeningLine("Hast du morgen um 15 Uhr Zeit?")` gibt die Zeile zurueck
(analog fr/en mit einer sprachtypischen Frage).

**`GQ-E1-03: Rotprobe - zwei Fragen oder ein Fragezeichen mitten im Satz sind ungueltig`**
`validOpeningLine("Hast du Zeit? Und am Freitag?")` -> `null`;
`validOpeningLine("Wie geht es? Ich rufe wegen des Termins an.")` -> `null`.

**`GQ-E1-04: die festen Eroeffnungs-Bausteine tragen kein Anrede-Pronomen (de/fr)`**
Ueber eine benannte Menge `SPRACHEN_MIT_ANREDEFORM = ["de", "fr"]` (EN ausgenommen, Begruendung im
Kommentar: "you"/"your" tragen im Englischen kein Register). Geprueft werden je Sprache DREI
Werte: `openingQuestion`, `openingReasonFallback` und `bridgePhrase(SENTINEL)` mit
`SENTINEL = "XGOALX"` (traegt selbst kein Pronomen und loest den Ich-Satz-Passthrough nicht aus).
Muster:
- `de`: `/\b(Sie|Ihnen|Ihr\w*|du|dir|dich|dein\w*)\b/` (gross-/kleinschreibungs-genau)
- `fr`: `/\b(vous|votre|vos|tu|te|toi|ton|ta|tes)\b/i`

Der Fehlertext nennt den Grund: Register-Bruch aus Anruf `call_mt0ddduxuzgl` — eine feste Anrede
hinter einer Zeile, deren Anrede aus dem Auftrag kommt.

**`GQ-E1-05: der statische Rahmen endet mit der Variablen`** (in
`test/elevenlabs-anrufstart.test.js`, direkt hinter T5 c/e)
`agent.first_message` der Vorlage UND jedes `language_presets[*].overrides.agent.first_message`
enden auf `{{opening_line}}` (`endsWith`, ohne nachfolgendes Leerzeichen). Zusaetzlich:
`providerOpeningFor(lang)` endet fuer jede Sprache in `SUPPORTED_LANGUAGES` ebenfalls auf
`{{opening_line}}`. Kommentar: zusammen mit den bestehenden `startsWith(disclosure)`-Zusagen passt
danach zwischen Offenlegung und Variable kein Text mehr — weder davor noch dahinter.

**`GQ-E1-06: Deckel-Arithmetik der Eroeffnung`**
Je Sprache: `openingQuestion` ist nicht leer, endet auf `"?"`,
`validOpeningLine(openingQuestion) === openingQuestion` und
`openingQuestion.length <= OPENING_QUESTION_MAX_CHARS`. Dazu eine Zusicherung, die
`OPENING_LINE_MAX_CHARS + 1 + OPENING_QUESTION_MAX_CHARS` als Obergrenze der komponierten Zeile
festhaelt. Kommentar: die Zusage "die Eroeffnung endet auf eine Frage" haengt seit R1 allein an
diesem Wert — waere er leer oder ohne Fragezeichen, faellt der 11-Sekunden-Befund aus Anruf 6
lautlos zurueck.

**`GQ-E1-07: der GANZE gesprochene Satz, je Sprache und in beiden Faellen`**
Importiert `providerOpeningFor`. Fuer jede Sprache und fuer beide Faelle (goal = Grund /
goal = Frage) wird
`providerOpeningFor(lang).replace("{{opening_line}}", komponiert)` gebildet und geprueft:
beginnt mit `LOCALES[lang].disclosure("{{owner_name}}")`, enthaelt genau ein `?`, enthaelt keine
Folge `[.!?]{2}`, endet auf `?`. Kommentar: das ist der Test, der den Befund vom 19.08. gefangen
haette — Rahmen und Variable waren bis dahin nur je fuer sich geprueft.

**`GQ-E1-08: Komposition, beide Richtungen, je Sprache`**
Zeile auf `"."` -> komponiert ist `Zeile + " " + openingQuestion`;
Zeile auf `"?"` -> komponiert ist byte-identisch die Zeile.

**`GQ-E1-09: Stufe 2 mit Frage-Auftrag laeuft ohne Bruecken-Rahmen`**
LLM tot, `objective` = `Hast du morgen um 15 Uhr Zeit für eine Runde Tennis?` -> Zeile ist
woertlich der Auftrag, enthaelt KEIN `Es geht um Folgendes:`, und es ist nichts angehaengt.

**`GQ-E1-10: Stufe 3 wird komponiert`**
Je Sprache: `openingReasonFallback + " " + openingQuestion`.

**`GQ-E1-11: Prompt-Pin der Erzeugung`** (Muster der bestehenden "No prices"/"umlauts"-Pins)
Der System-Block enthaelt die Frage-Anweisung (`question mark`) und die Register-Anweisung
(`Mirror the form of address`); der Auftragstext steht weiterhin NUR in der user-Message.

**Die Hash-Gegenprobe** bleibt durch die bestehenden Rotproben abgedeckt (Bestandsfaelle oben) —
neu ist nur, dass ihre Erwartungswerte die komponierte Zeile tragen und `GQ-E1-05`/T11 belegen,
dass komponiert wird, bevor gehasht wird.

### 5.3 Pflichtlauf

```
node --check src/elevenlabs/opening-line.js
node --check src/elevenlabs/opening-line-llm.js
node --check src/elevenlabs/call-locale.js
node --check src/i18n/locales.js
LLM_PROVIDER=anthropic npm test
npm run elevenlabs:check
```

**Vorbedingung, nicht verhandelbar:** `npm test` OHNE `LLM_PROVIDER=anthropic` ist auf diesem
Rechner rot, weil `.env` `LLM_PROVIDER=deepseek` traegt und 42 Testdateien nur
`ANTHROPIC_BASE_URL` binden (darunter `test/el-opening-line.test.js` mit 4 Faellen). Das ist ein
Bestandsdefekt und **wird in dieser Phase NICHT behoben** (Regel 6). Gemessene Basis vor der
Aenderung: 4888 Tests, 4887 gruen, ein bekannter Spawn-Flake rot
(`Gate 11 Budget: erschoepftes Tenant-Budget blockt auch mit Flag an (402)`,
`test/telnyx-p5-gate-proof.test.js`). Nachher muss dieselbe Bilanz stehen — plus die neuen Faelle.

`npm run elevenlabs:check` muss gruen bleiben: es kommt kein Variablenname dazu (weiterhin zwoelf),
und keine der 18 Testdefinitionen fuehrt die Abschlussfrage im Text.

---

## 6. Leitplanken (Verletzung = Abbruch)

1. **Offenlegung**: `disclosure` bleibt woertlich, unveraendert und ALLERERSTER Satz. Es wird
   ausschliesslich geaendert, was DAHINTER steht.
2. **Fail-closed-Treppe**: bleibt dreistufig, in derselben Reihenfolge, mit denselben
   Ablehnungsgruenden. Nichts Ungeprueftes erreicht die Sprache. `validOpeningLine` verliert
   KEINE Pruefung — Laenge, verbotene Zeichen, Preismuster, Offenlegungs-Wiederholung bleiben; es
   kommt eine dazu.
3. **Hash-Gegenprobe**: unveraendert. Komponiert wird VOR `createCall` (R6). Es wird nichts an
   `openingLineHash`, `createCall` oder dem Store-Schema geaendert.
4. **Umlaute**: `Wie sieht es damit aus?`, `Ich rufe an, um ein kurzes Anliegen zu klären.`,
   `Qu'en est-il ?`, `J'appelle pour régler une petite demande.` sind gesprochene Strings und
   tragen ihre Sonderzeichen. Kommentare bleiben ASCII-Deutsch.
5. **Keine Gate-Aenderung**: `OPENING_LINE_MAX_CHARS` bleibt 120; `outbound-gates.js`,
   Budget-/Denylist-/Signatur-Gates, `OUTBOUND_FROZEN` werden nicht beruehrt.
6. **Kein Text im Log** (Regel 4): die bestehende Log-Zeile bleibt bei Quelle und Zeichenzahl.

---

## 7. Was NICHT angefasst wird

- `src/mcp-tools.js` (`goal`-/`briefing`-Feldbeschreibungen) — das ist Track B. Die neue
  Komposition vertraegt beide `goal`-Formen (Grund wie Frage); Track E braucht dort nichts.
- `src/claude.js` / der Telnyx-Budget-Weg und `LOCALES.*.bridgePhrase` — byte-identisch. Der
  doppelte Punkt existiert dort nicht (`trimGoalForSpeech` streicht bereits).
- Der System-Prompt des Anbieter-Agenten (`prompt.prompt`), die Werkzeug-Beschreibungen,
  `voicemail_message`, `disable_first_message_interruptions`, `elevenlabs/test_configs/*.json`,
  Store-Schema, alle Gates.
- Die 42 Testdateien ohne `LLM_PROVIDER`-Pin (offener Punkt S-O1 der Strategie).

---

## 8. Reihenfolge fuer den Implementierer

1. `src/elevenlabs/opening-line.js` (R2/R3/R5/R6)
2. `src/i18n/locales.js` (R4)
3. `src/elevenlabs/opening-line-llm.js` (Prompt + genau eine Komposition)
4. `src/elevenlabs/call-locale.js` (R1)
5. `elevenlabs/agent_configs/outbound-agent.template.json` (Abschnitt 4.5)
6. Tests (Abschnitt 5.1 mitziehen, 5.2 neu)
7. Pflichtlauf (Abschnitt 5.3)
8. **Eigentuemer-Handlung, NICHT Teil des Commits, und zwingend VOR dem Deploy:**
   `npm run elevenlabs:push` aus diesem Branch, danach `npm run elevenlabs:drift`. Erst damit
   wirkt R1 am Konto. Der Zwischenzustand "Code deployt, Vorlage nicht gepusht" ergibt ZWEI
   aufeinanderfolgende Fragen und ist schlechter als der heutige Defekt — deshalb gilt: erst
   pushen, dann deployen. Ist der Push nicht durchfuehrbar, wird der Code nicht deployt.

## 9. Offene Punkte dieser Phase (nicht bauen, nur wissen)

- **E-O1** Ob die erzeugte Direkt-Frage (Stufe 1) den Auftrag treu trifft, ist nur am echten
  Anruf messbar. Notaus bleibt `openingLineLlm=false`.
- **E-O2** Ob eine Eroeffnung, die auf die Sachfrage endet, den Angerufenen frueher zum Reden
  bringt, ist eine Zeitmessung am Anruf.
- **E-O3** Der Klang von `Qu'en est-il ?` ist nur am franzoesischen Ohr zu beurteilen.
- **E-O4** Ob der Push die Presets tatsaechlich schreibt, zeigt erst der `elevenlabs:drift`-Lauf
  danach.
- **E-O5** `voicemail_message` mischt Sprachen (englischer Rahmen, sprachabhaengige
  `{{opening_line}}`) und traegt ab jetzt auch die Frage. Bestand plus bewusst akzeptierter
  Zuwachs; eine zweite Variable nur fuer den seltensten Pfad kostet mehr als sie bringt.
