# GQ-E1 - Eroeffnungs-Komposition (Track E, Befund E)

Grundlage: `tasks/gq-transkript-befunde-2026-08-19.md`, Befund E (Anruf `call_mt0ddduxuzgl`).
Dieser Entwurf aendert KEINEN Code - er spezifiziert ihn. Ein Implementierungs-Agent baut
danach ohne Rueckfrage.

Gemessener Ist-Satz aus dem Anruf (woertlich, DB):

> "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Antonio Fotiadis. Das Gespräch wird
> für meinen Auftraggeber zusammengefasst. Ich wollte fragen, ob du morgen um 15 Uhr Zeit für
> eine Runde Tennis hast.. Wie sieht es damit bei Ihnen aus?"

---

## 1. Wurzelursache (belegt am Code, nicht vermutet)

Die gesprochene Eroeffnung entsteht an ZWEI Orten, die einander nicht kennen: unsere Seite
liefert die Grund-Zeile als dynamische Variable `{{opening_line}}`, der fremde Agent haelt den
Rahmen als STATISCHEN Text (`first_message` bzw. `language_presets[*].overrides.agent.first_message`
in `elevenlabs/agent_configs/outbound-agent.template.json`, gespiegelt in
`src/elevenlabs/call-locale.js#providerOpening`). Weil der Rahmen statisch ist, kann die
angehaengte Abschlussfrage weder entfallen noch ihr Register wechseln - sie steht in jedem Anruf
gleich da, in Sie-Form, hinter einer Zeile, die den Auftraggeber-Text in Du-Form transportiert
und haeufig schon selbst eine Frage ist. Der doppelte Punkt kommt aus derselben Naht-Blindheit
eine Etage tiefer: `bridgedObjective` (`src/elevenlabs/opening-line.js:118`) reicht den
Auftragstext ungestrippt an `locale.bridgePhrase`, und die haengt bedingungslos ein `.` an
(`src/i18n/locales.js:181`) - der Telnyx-Weg macht denselben Schritt richtig, weil
`trimGoalForSpeech` (`src/claude.js:436`) das Satz-Endzeichen vorher entfernt.
Kurz: **der Teil der Eroeffnung, der sich pro Anruf entscheiden muss, liegt an der einen
Stelle, die sich pro Anruf nicht aendern kann.**

### Ist-Zustand, Stueck fuer Stueck

| Textteil | entsteht in | pro Anruf veraenderbar? |
|---|---|---|
| Offenlegungssatz | `LOCALES.<lang>.disclosure`, gesprochen als statischer Rahmen am Anbieter | nein (Regel 2, richtig so) |
| Grund-Zeile | `fetchOpeningLine` -> `createCall.openingLine` -> `{{opening_line}}` | ja |
| Abschlussfrage | `LOCALES.<lang>.openingQuestion`, im statischen Rahmen am Anbieter | **nein** (die Wurzel) |

Treppe heute (`src/elevenlabs/opening-line.js`, Kopfkommentar): 1. erzeugte Zeile
(`opening-line-llm.js`), 2. `locale.bridgePhrase(objective)`, 3. `locale.openingReasonFallback`.
`SENTENCE_END = /[.!]$/` verbietet "?" am Zeilenende - ausdruecklich deshalb, weil danach die
feste Frage kommt.

---

## 2. Optionen

### Option 1 - "die Zeile bleibt Aussage, wir reparieren nur die Interpunktion"

Nur `bridgedObjective` strippt das Satz-Endzeichen; Erzeugungs-Prompt verlangt weiterhin einen
Aussagesatz; der statische Rahmen bleibt unangetastet.

- Kein Push an den Anbieter noetig, null Deploy-Risiko, kleinster Diff.
- Loest Defekt 1. Defekt 2 (Register) und Defekt 3 (doppelte Frage) bleiben **unveraendert**:
  die feste Sie-Frage steht weiter hinter einer Du-Zeile, und wenn der Auftrag die Frage schon
  stellt, wird sie ein zweites Mal gestellt.
- Ein Drittel des Befunds, und der auffaelligste Teil (Register) bleibt offen.

### Option 2 - "zweite Variable `{{opening_question}}`"

Der Rahmen behaelt seinen Frage-Platz, aber als Variable; wir setzen sie leer, wenn die Zeile
schon fragt, und in der passenden Anrede-Form.

- Loest alle drei Defekte.
- Kostet dieselbe Vorlagen-Aenderung UND denselben Push wie Option 3, zusaetzlich einen zwoelften
  Variablennamen in Vorlage *und* allen elf `elevenlabs/test_configs/*.json` (sonst meldet
  `npm run elevenlabs:check` eine tote/unbekannte Variable). Eine leere Variable hinterlaesst
  ausserdem ein doppeltes Leerzeichen im gesprochenen Text.
- Mehr bewegliche Teile fuer exakt dasselbe Ergebnis.

### Option 3 - "der Rahmen endet mit der Variablen; die Zeile traegt Grund UND Frage" (GEWAEHLT)

Der statische Rahmen ist ab sofort **Offenlegung + `{{opening_line}}`, sonst nichts**. Alles, was
nach der Offenlegung gesprochen wird, komponieren wir pro Anruf in genau einen Wert. Die feste
Frage wird angehaengt - aber nur, wenn die Grund-Zeile nicht schon selbst fragt.

- Loest alle drei Defekte an EINER Stelle, und zwar fuer jede Stufe der Treppe.
- Vokabular bleibt bei elf Namen: `npm run elevenlabs:check` und die elf Testdefinitionen
  bleiben unberuehrt.
- Die Regel "was gesprochen wird, ist entweder Pflichttext oder geprueft" wird **staerker**:
  heute steht ein Teil des gesprochenen Satzes ausserhalb der Pruefung im fremden Rahmen,
  danach faellt der ganze Schwanz unter `validOpeningLine` + Hash.
- Preis: die Vorlage muss gepusht werden (`npm run elevenlabs:push`), sonst wirkt nur die
  Haelfte (s. Abschnitt 5, Risiko P1) - und der Anrufbeantworter-Text traegt die Frage mit
  (Abschnitt 4.6, bewusst akzeptiert).

**Wahl: Option 3.** Begruendung in einem Satz: die drei Defekte sind drei Symptome derselben
Ursache - eine anrufabhaengige Entscheidung liegt an einer anrufunabhaengigen Stelle -, und nur
Option 3 verschiebt die Entscheidung dorthin, wo der Anruf bekannt ist. Option 1 waere ein
Pflaster auf einem Symptom, Option 2 zahlt denselben Preis fuer ein schlechteres Ergebnis.

---

## 3. Die Entscheidung als Regeln

**R1 - Der Rahmen endet mit der Variablen.** `providerOpening` = `disclosure(ownerName)` + " " +
`{{opening_line}}`. Kein Textteil steht mehr hinter der Variablen. Der Offenlegungssatz bleibt
woertlich und allererster Satz (Absolute Regel 2) - er bleibt exakt dort, wo er heute steht.

**R2 - Die Zeile darf fragen.** `SENTENCE_END` wird `/[.!?]$/`. Neu daneben: ein "?" darf NUR
das letzte Zeichen sein (kein zweites, keines mitten im Satz). Damit ist die alte Zusage "nie
zwei Fragen hintereinander" nicht aufgeweicht, sondern an die Stelle verschoben, an der sie
jetzt haengt: R3.

**R3 - Die Frage wird angehaengt, wenn und nur wenn die Zeile nicht schon fragt.**
`composedOpeningLine(reason, locale)` = `reason`, falls `reason` auf "?" endet; sonst
`reason + " " + locale.openingQuestion`. Deterministisch, ohne Sprachkenntnis, in JEDER Sprache
identisch. Die Eroeffnung endet damit IMMER auf genau eine Frage - die Zusage aus Befund 1
(Anruf 6, 11 s Stille) bleibt erhalten.

**R4 - Feste gesprochene Eroeffnungs-Bausteine tragen KEIN Anrede-Pronomen.** Betroffen sind
`openingQuestion` und `openingReasonFallback`. Ein Baustein ohne Anrede kann mit keiner Anrede
des Auftrags brechen - das ist die einzige Loesung des Register-Problems, die ohne Heuristik
und auf ALLEN Stufen der Treppe traegt (Stufe 3 kennt den Auftragstext gar nicht). Konkrete
Wortlaute in Abschnitt 4.2.

**R5 - Genau ein Satz-Endzeichen.** `bridgedObjective` strippt das vorhandene Satz-Endzeichen,
bevor `bridgePhrase` ihres setzt - wortgleich das, was `trimGoalForSpeech` auf dem Telnyx-Weg
seit jeher tut. Endet der Auftrag auf "?", laeuft er OHNE Bruecken-Rahmen durch: er ist bereits
die sprechbare Frage, und "Es geht um Folgendes: Hast du morgen Zeit?" waere ein Rahmen um eine
Frage herum.

### Was das je Fall und je Stufe ergibt

| | goal nennt nur einen Grund | goal ist bereits eine Frage |
|---|---|---|
| **Stufe 1** (erzeugt) | Aussagesatz + feste Frage | erzeugte direkte Frage, nichts angehaengt |
| **Stufe 2** (Bruecke) | Bruecke + genau ein Punkt + feste Frage | Auftrag woertlich (endet auf "?"), nichts angehaengt |
| **Stufe 3** (fest) | feste Kurzzeile + feste Frage | dito (der Auftragstext ist hier ohnehin raus) |

Der gemessene Fall, Stufe 2, nachher (LLM aus oder tot):

> "... zusammengefasst. Ich wollte fragen, ob du morgen um 15 Uhr Zeit für eine Runde Tennis hast. Wie sieht es damit aus?"

Ein Punkt, eine Frage, kein "Ihnen". Stufe 1 (LLM lebt) ergaebe stattdessen z.B.
"Hast du morgen um 15 Uhr Zeit für eine Runde Tennis?" und haengt nichts an.

---

## 4. Spezifikation

### 4.1 `src/elevenlabs/opening-line.js`

`SENTENCE_END` auf `/[.!?]$/`; der Kommentar "BEWUSST OHNE ?" wird durch die neue Begruendung
ersetzt (die feste Frage steht nicht mehr dahinter, sondern wird von `composedOpeningLine`
entschieden). Neu daneben, als eigener Waechter mit eigenem Kommentar:

```js
// Ein Fragezeichen NUR als letztes Zeichen: zwei Fragen in einer Aeusserung lassen den
// Angerufenen raten, welche er beantworten soll - dieselbe Zusage wie vor Thema E, nur
// jetzt an der Stelle, an der sie noch etwas entscheidet (composedOpeningLine).
const QUESTION_MARK = "?";
const fragtHoechstensAmEnde = (line) => {
  const i = line.indexOf(QUESTION_MARK);
  return i === -1 || i === line.length - 1;
};
```

In `validOpeningLine` direkt hinter der `SENTENCE_END`-Pruefung:
`if (!fragtHoechstensAmEnde(line)) return null;`

Neue exportierte, reine Funktion (die EINE Stelle, an der komponiert wird):

```js
/**
 * Die vollstaendige gesprochene Eroeffnung NACH der Offenlegung: die Grund-Zeile und -
 * nur wenn sie nicht schon selbst fragt - die feste Frage der Sprache.
 * ...
 */
export function composedOpeningLine(reason, locale) {
  return reason.endsWith(QUESTION_MARK) ? reason : `${reason} ${locale.openingQuestion}`;
}
```

`bridgedObjective` nach R5:

```js
export function bridgedObjective(objective, locale) {
  if (typeof objective !== "string") return null;
  const normalized = objective.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  // Der Auftrag IST schon die sprechbare Frage - kein Rahmen, kein zweites Satzzeichen.
  if (normalized.endsWith(QUESTION_MARK)) return validOpeningLine(normalized);
  // Genau EIN Satz-Endzeichen (R5, wortgleich trimGoalForSpeech auf dem Telnyx-Weg):
  // bridgePhrase setzt ihres, also faellt ein mitgebrachtes vorher weg.
  const ohneSatzende = normalized.replace(/[.!]+$/, "").trim();
  if (!ohneSatzende) return null;
  return validOpeningLine(locale.bridgePhrase(ohneSatzende));
}
```

`verifiedOpeningLine`: der GESPEICHERTE Wert ist bereits die komponierte Zeile und wird
unveraendert zurueckgegeben (der Hash deckt genau ihn ab); der Rueckfall komponiert hier:

```js
  const reason = bridgedObjective(call.goal, locale) ?? locale.openingReasonFallback;
  return composedOpeningLine(reason, locale);
```

Die Asymmetrie gehoert als Kommentar hin: **oben verbuergt, unten komponiert** - die
gespeicherte Zeile ist die bei Auftragsannahme komponierte, der Rueckfall entsteht erst hier
und muss deshalb denselben Schritt noch gehen.

Zusaetzlich, neben `OPENING_LINE_MAX_CHARS`:

```js
// Obergrenze der festen Frage je Sprache. Sie ist kein Stilmass, sondern der Deckel der
// Eroeffnung: die gesprochene Zeile ist hoechstens OPENING_LINE_MAX_CHARS + 1 + dieser
// Wert (test/el-opening-line.test.js rechnet das nach). Heutiges Maximum ist EN mit 32.
export const OPENING_QUESTION_MAX_CHARS = 40;
```

`OPENING_LINE_MAX_CHARS` bleibt bei 120 und bleibt die Grenze der GRUND-Zeile (nicht der
komponierten): die Kappe misst weiter, was aus Auftrag oder Modell kommt.

### 4.2 `src/i18n/locales.js` - nur vier Zeichenketten (R4)

| Feld | vorher | nachher |
|---|---|---|
| `de.openingQuestion` | "Wie sieht es damit bei Ihnen aus?" | "Wie sieht es damit aus?" |
| `fr.openingQuestion` | "Qu'en est-il de votre côté ?" | "Qu'en est-il ?" |
| `en.openingQuestion` | "How does that look on your side?" | **unveraendert** |
| `de.openingReasonFallback` | "Ich rufe an, um ein kurzes Anliegen mit Ihnen zu klären." | "Ich rufe an, um ein kurzes Anliegen zu klären." |
| `fr.openingReasonFallback` | "J'appelle pour régler une petite demande avec vous." | "J'appelle pour régler une petite demande." |
| `en.openingReasonFallback` | "I am calling to sort out a small matter with you." | **unveraendert** |

Jede Aenderung ist ein STREICHEN des anrede-tragenden Satzteils, keine Neuerfindung - der Rest
des Satzes bleibt byte-identisch. Englisch bleibt unangetastet, weil "your"/"you" im Englischen
kein Register traegt: es gibt dort nichts zu brechen. Umlaute/Akzente bleiben (gesprochene
Strings, Memory-Regel).

`bridgePhrase` wird NICHT angefasst (der Telnyx-Weg bleibt byte-identisch; die Interpunktion
wird eine Etage hoeher in `bridgedObjective` geloest, wo der Defekt sitzt).

### 4.3 `src/elevenlabs/opening-line-llm.js`

`openingSystem(language)` bekommt zwei Anweisungen dazu (englisch, wie der Bestand). Der Rest
des Prompts bleibt woertlich:

- Frage-Form: "If the assignment asks the other person something, write that one sentence as a
  direct question they can answer immediately, ending with a question mark. If it only states a
  reason, write one statement ending with a full stop. Never write two sentences and never more
  than one question mark."
- Register: "Mirror the form of address used in the assignment text: if it addresses the person
  informally (German 'du', French 'tu'), stay informal; otherwise use the polite form. Never mix
  the two."

`fetchOpeningLine` komponiert genau einmal, am Ende, und behaelt seine drei Quellen-Kennungen
(`erzeugt`/`auftrag`/`fest`) unveraendert - die Quelle beschreibt die Herkunft der GRUND-Zeile:

```js
  const reason = generated ?? bridgedObjective(objective, locale) ?? locale.openingReasonFallback;
  const source = generated ? "erzeugt" : (bridgedObjective(...) ? "auftrag" : "fest");
  return { line: composedOpeningLine(reason, locale), source };
```

(Implementierungsfreiheit in der Form - Auflage: `bridgedObjective` wird hoechstens EINMAL
ausgewertet, und die Zuordnung Quelle<->Zeile bleibt die heutige.)

Die Log-Zeile in `routes/api-calls.js` (`quelle=... zeichen=...`) bleibt unveraendert; sie misst
ab jetzt die komponierte Laenge. Kein Text im Log (Regel 4).

### 4.4 `src/elevenlabs/call-locale.js`

```js
const providerOpening = (locale, ownerName) =>
  [locale.disclosure(ownerName), OPENING_LINE_PLACEHOLDER].join(" ");
```

Der Kommentarblock darueber (heute drei nummerierte Punkte) wird auf zwei gekuerzt und behaelt
die Begruendung aus Befund 1 in der neuen Form: die Eroeffnung endet weiterhin auf eine Frage,
aber die Frage reist ab jetzt IM Wert, weil nur dort entscheidbar ist, ob sie noch gebraucht
wird. `firstMessage`/`providerOpeningFor` behalten Signatur und Abnehmer.

### 4.5 `elevenlabs/agent_configs/outbound-agent.template.json`

Drei Werte verlieren ihren Schwanz hinter `{{opening_line}}`:

- `agent.conversation_config.agent.first_message`: " How does that look on your side?" entfaellt.
- `...language_presets.de.overrides.agent.first_message`: " Wie sieht es damit bei Ihnen aus?" entfaellt.
- `...language_presets.fr.overrides.agent.first_message`: " Qu'en est-il de votre côté ?" entfaellt.
- `language_presets.es` bleibt `null`.

Dazu ein NACHTRAG-Satz in `_sprachumstellung_hinweis` (Muster der dortigen Nachtraege):
Thema E, 2026-08-19 - `{{opening_line}}` traegt jetzt Grund UND, wo noetig, die Abschlussfrage;
der statische Rahmen endet mit der Variablen, damit die Frage pro Anruf entfallen kann. Das
Variablen-Vokabular bleibt bei elf Namen, die `test_configs/*.json` bleiben unberuehrt.

### 4.6 Anrufbeantworter - bewusst unveraendert

`voicemail_message` fuehrt `{{opening_line}}` mitten im Text und traegt damit kuenftig auch die
Abschlussfrage ("... Hast du morgen um 15 Uhr Zeit? I will try again later."). Das ist eine
rhetorische Frage auf Band - schief, aber harmlos. Die Alternative waere eine zweite Variable
nur fuer den seltensten Pfad (Option 2 fuer die Voicemail allein), samt Vokabular-Wachstum in
elf Testdefinitionen. **Akzeptiert und hier festgehalten**, nicht uebersehen.

---

## 5. Pre-Mortem (Stand: 2027-08, die Entscheidung war falsch)

**P1 - "Der Push ist nie passiert."** Der wahrscheinlichste Ausfall. Der Code komponiert, der
LIVE-Agent haengt weiter seinen statischen Satz an: zwei Fragen, Register-Bruch, und alle Tests
gruen, weil sie die VORLAGE gegen den Code pruefen, nie das Konto.
*Entschaerfung:* (a) `npm run elevenlabs:drift` meldet genau diese Abweichung - der Lauf gehoert
in denselben Arbeitsgang; (b) der Zwischenzustand ist nachweislich **nicht schlechter als heute**
(der doppelte Punkt ist auch ohne Push weg, alles Uebrige bleibt der heutige Defekt), es gibt
also keinen Druck, den Code zurueckzudrehen; (c) der Push steht als eigener, benannter Schritt in
Abschnitt 7 - er ist eine Eigentuemer-Handlung, kein Nebeneffekt eines Commits.

**P2 - "Die erzeugte Frage behauptet etwas."** Aus "wegen Tennis fragen" macht das Modell
"Passt dir morgen 15 Uhr?" und erfindet damit einen Termin.
*Entschaerfung:* die Erzeugungs-Anweisung sagt ausdruecklich, dass sie nur umformuliert, wenn der
Auftrag selbst fragt, und der Bestandssatz "nothing is agreed in it" bleibt woertlich stehen. Die
deterministischen Stufen 2 und 3 erfinden per Bau nichts.
*Restrisiko:* semantisch nicht pruefbar, nur an echten Anrufen messbar - **akzeptiert**, siehe
Offene Punkte O1. Der Notaus dagegen existiert und bleibt: `openingLineLlm=false` faellt ohne
Kosten auf Stufe 2.

**P3 - "Die Offenlegung ist nicht mehr der erste Satz."** Jede Aenderung an `first_message` ist
eine Aenderung an dem Feld, an dem Artikel 50 haengt.
*Entschaerfung:* T5 (c)/(e) pruefen weiterhin `startsWith(disclosure)` je Sprache; NEU kommt die
Gegenrichtung dazu (Test T5), dass der Rahmen mit `{{opening_line}}` ENDET - zwischen Offenlegung
und Variable passt danach kein Text mehr, weder vorne noch hinten.

**P4 - "Der Register-Bruch ist zurueck."** Jemand findet "Wie sieht es damit aus?" zu knapp und
schreibt "bei Ihnen" wieder hinein.
*Entschaerfung:* der Pronomen-Waechter (Test T4) verbietet Anrede-Pronomen in beiden festen
Bausteinen und nennt im Fehlertext den Grund. Struktur statt Konvention.

**P5 - "Die Eroeffnung ist wieder zu lang."** Der komponierte Wert waechst unbemerkt.
*Entschaerfung:* Test T6 rechnet die Grenze nach (`OPENING_LINE_MAX_CHARS + 1 +
OPENING_QUESTION_MAX_CHARS`) und pinnt jede Sprachfrage gegen ihren Deckel. Rechnerisch sinkt die
Obergrenze fuer DE/FR sogar, weil die Fragen kuerzer werden.

**P6 - "Niemand hat je den ganzen gesprochenen Satz geprueft."** Rahmen und Variable sind je fuer
sich getestet, der zusammengesetzte Satz war nie Gegenstand eines Tests - genau die Luecke, aus
der dieser Befund kam.
*Entschaerfung:* Test T7 setzt beide Haelften zusammen (`providerOpeningFor(lang)` mit
eingesetzter komponierter Zeile) und prueft den fertigen Satz auf "genau ein Fragezeichen, kein
doppeltes Satz-Endzeichen, beginnt mit der Offenlegung". Das ist der Test, der den Befund vom
19.08. gefangen haette.

---

## 6. Tests (node:test, `test/*.test.js`) - was das neue Verhalten pinnt

Bestehende Faelle, die MITGEZOGEN werden muessen (sonst rot):

- `test/el-opening-line.test.js:261` "Rotprobe Fragezeichen-Ende" - **kehrt sich um**: die Zeile
  auf "?" ist jetzt gueltig. Der Fall wird nicht geloescht, sondern ersetzt durch T2 (Frage am
  Ende gueltig) + T3 (Frage NICHT am Ende ungueltig) - die Zusage bleibt, ihre Form aendert sich.
- `test/el-opening-line.test.js:170-197` (Stufen 1/2/3) - Erwartungswerte tragen jetzt die
  komponierte Zeile.
- `test/elevenlabs-torzustand.test.js:209/213` - Rueckfallwert wird
  "Es geht um Folgendes: Termin vereinbaren. Wie sieht es damit aus?".
- `test/elevenlabs-anrufstart.test.js:2036` (T11) - `erwartet` wird
  `` `Es geht um Folgendes: ${OBJECTIVE}. ${LOCALES.de.openingQuestion}` `` (aus LOCALES gelesen,
  nicht getippt).
- `test/elevenlabs-anrufstart.test.js:888/923` (T5 c/e) und
  `test/elevenlabs-sprachwahl.test.js:269-278` folgen `providerOpeningFor` automatisch; ihre
  Kommentare/Meldungen nennen ab jetzt "Offenlegung + Grund-Zeile" statt "+ Frage".

Neue Faelle (alle in `test/el-opening-line.test.js`, ausser T5/T7):

- **T1 - Der Befundfall, byte-genau (Regressionsanker).** LLM aus (`openingLineLlm=false`),
  `objective` = der woertliche goal-Text aus dem Anruf. Erwartet exakt
  "Ich wollte fragen, ob du morgen um 15 Uhr Zeit für eine Runde Tennis hast. Wie sieht es damit aus?"
  plus drei Zusicherungen am selben Wert: kein `..`, kein "Ihnen", genau ein "?".
- **T2 - Frage-Zeile gueltig:** `validOpeningLine("Hast du morgen um 15 Uhr Zeit?")` gibt sie
  zurueck; je Sprache ein Fall.
- **T3 - Rotprobe zwei Fragen:** `validOpeningLine("Hast du Zeit? Und am Freitag?")` -> null;
  `validOpeningLine("Wie geht es? Ich rufe wegen des Termins an.")` -> null.
- **T4 - Pronomen-Waechter (R4), je Sprache:** `de` gegen
  `/\b(Sie|Ihnen|Ihr\w*|du|dir|dich|dein\w*)\b/` (gross-/kleinschreibungs-genau), `fr` gegen
  `/\b(vous|votre|vos|tu|te|toi|ton|ta|tes)\b/i`, geprueft an `openingQuestion` UND
  `openingReasonFallback`. `en` ist ausgenommen, mit der Begruendung im Kommentar. Fehlertext
  nennt den Grund (Register-Bruch aus Anruf `call_mt0ddduxuzgl`).
- **T5 - Der Rahmen endet mit der Variablen** (`test/elevenlabs-anrufstart.test.js`, an T5 c/e
  angehaengt): `first_message` der Vorlage und jedes Preset enden auf `{{opening_line}}`; die
  heutigen `startsWith(disclosure)`-Zusagen bleiben daneben stehen.
- **T6 - Deckel-Arithmetik:** je Sprache `validOpeningLine(openingQuestion) === openingQuestion`
  und `openingQuestion.length <= OPENING_QUESTION_MAX_CHARS`; dazu eine Zeile, die
  `OPENING_LINE_MAX_CHARS + 1 + OPENING_QUESTION_MAX_CHARS` als Obergrenze der komponierten Zeile
  festhaelt.
- **T7 - der GANZE gesprochene Satz** (`test/el-opening-line.test.js`, importiert
  `providerOpeningFor`): fuer jede Sprache und fuer beide Faelle (goal = Grund / goal = Frage)
  wird `providerOpeningFor(lang).replace("{{opening_line}}", komponiert)` gebildet und geprueft:
  beginnt mit `LOCALES[lang].disclosure("{{owner_name}}")`, enthaelt genau ein "?", enthaelt kein
  `[.!?]{2}`, endet auf "?".
- **T8 - Komposition, beide Richtungen, je Sprache:** Zeile auf "." -> komponiert ist
  `Zeile + " " + openingQuestion`; Zeile auf "?" -> komponiert ist byte-identisch die Zeile.
- **T9 - Stufe 2 mit Frage-Auftrag:** `objective` = "Hast du morgen um 15 Uhr Zeit für eine Runde
  Tennis?" bei totem LLM -> Zeile ist woertlich der Auftrag, KEIN "Es geht um Folgendes:", nichts
  angehaengt.
- **T10 - Stufe 3 komponiert:** je Sprache `openingReasonFallback + " " + openingQuestion`.
- **T11 - Hash-Gegenprobe unveraendert:** `createCall` speichert die KOMPONIERTE Zeile, der Hash
  passt darauf, und die mutierte Zeile faellt weiterhin auf den (jetzt ebenfalls komponierten)
  Rueckfall - der bestehende Rotproben-Block bleibt, nur seine Erwartungswerte wachsen.
- **T12 - Prompt-Pin (Muster der bestehenden "No prices"/"umlauts"-Pins):** der System-Block der
  Erzeugung enthaelt die Frage-Anweisung und die Register-Anweisung; der Auftragstext steht
  weiterhin NUR in der user-Message.

`npm test` muss danach gruen sein; `npm run elevenlabs:check` bleibt gruen (kein neuer
Variablenname).

---

## 7. Reihenfolge fuer den Implementierer

1. `src/elevenlabs/opening-line.js` (R2/R3/R5), 2. `src/i18n/locales.js` (R4),
3. `src/elevenlabs/opening-line-llm.js` (Prompt + eine Komposition),
4. `src/elevenlabs/call-locale.js` (R1), 5. Vorlage JSON (4.5), 6. Tests (Abschnitt 6).
7. `node --check` auf jede geaenderte Datei, `npm test`, `npm run elevenlabs:check`.
8. **Eigentuemer-Handlung, nicht Teil des Commits:** `npm run elevenlabs:push`, danach
   `npm run elevenlabs:drift` - erst damit wirkt R1 am Konto (Pre-Mortem P1).

---

## 8. Was NICHT angefasst wird

Woertlich aus der Befunde-Datei:

> HARTE LEITPLANKEN: Der Offenlegungssatz bleibt fest verdrahtet allererster Satz (Absolute
> Regel 2, CLAUDE.md). Die fail-closed-Treppe und die Hash-Gegenprobe in opening-line.js
> duerfen nicht aufgeweicht werden. Gesprochene DE-Strings tragen Umlaute (Memory-Regel).

> Das "[freundlich]" ist eine gesprochene Ton-Marke im Transkript - separater Bestandsbefund,
> NICHT Teil dieser Kette.

> Die Formulierungsschwaeche des Agenten beim Ablehnen ("guter Tipp, ich schaue mir das an")
> ist AUSSERHALB dieses Auftrags - erst Muster ueber weitere Testanrufe sammeln.

> Nur Aenderungen, die OHNE weitere Testanrufe belegt werden koennen (Tests/Statik).
> Was einen echten Anruf braucht, als offener Folgepunkt notieren, nicht bauen.

Zusaetzlich ausserhalb dieses Entwurfs:

- `src/mcp-tools.js` (goal-/briefing-Feldbeschreibungen) - **Track B**. Die neue Komposition
  vertraegt beide goal-Formen (Grund wie Frage), Track E braucht dort keine Aenderung, und zwei
  Tracks an derselben Datei waeren ein vermeidbarer Konflikt.
- `src/claude.js` / der Telnyx-Budget-Weg und `LOCALES.*.bridgePhrase` - byte-identisch. Der
  doppelte Punkt existiert dort nicht (`trimGoalForSpeech` strippt bereits).
- Der System-Prompt des Anbieter-Agenten (`prompt.prompt`), die Werkzeug-Beschreibungen,
  `voicemail_message`, `disable_first_message_interruptions`, alle Gates, `OPENING_LINE_MAX_CHARS`,
  `elevenlabs/test_configs/*.json`, Store-Schema.

---

## 9. Offene Punkte (brauchen einen echten Testanruf - hier nur notiert)

- **O1** Ob die erzeugte Direkt-Frage (Stufe 1) den Auftrag treu trifft und nichts hinzudichtet,
  ist nur am echten Anruf messbar (Pre-Mortem P2). Vorschlag fuer den naechsten Testanruf:
  derselbe Tennis-Auftrag, `openingLineLlm` AN, und im Transkript pruefen, ob die erste
  Aeusserung genau eine Frage stellt und keinen Termin behauptet, den der Auftrag nicht nennt.
- **O2** Ob eine Eroeffnung, die auf eine Sachfrage endet, den Angerufenen frueher zum Reden
  bringt als die generische Frage (die 11-s-Stille aus Anruf 6), ist eine Zeitmessung am Anruf -
  aus dem Transkript allein nicht ablesbar.
- **O3** Der Klang der gekuerzten franzoesischen Frage ("Qu'en est-il ?") ist nur am Ohr eines
  franzoesischen Angerufenen zu beurteilen. Sie ist der bestehende Satz minus des
  register-tragenden Teils, also kein neu erfundener Wortlaut - aber "grammatisch korrekt" und
  "klingt am Telefon natuerlich" sind zwei Fragen.
- **O4** Ob der Push die Presets tatsaechlich schreibt (der Schreibweg ist seit 2026-08-19 in der
  Vorlage erklaert, aber der Befund "Push kann Presets nicht schreiben" stammt vom 18.08.), zeigt
  erst der `elevenlabs:drift`-Lauf nach dem Push. Ist er danach rot, ist das ein
  Push-Werkzeug-Befund und kein Code-Befund dieses Entwurfs.
