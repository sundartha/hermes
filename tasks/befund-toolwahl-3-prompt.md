# Befund: was das Modell tatsaechlich sieht — `get_consult` gegen `take_message`

Spur: NUR der final gerenderte Text (System-Prompt + Werkzeug-Array auf dem Draht).
Angebots-Gates stehen in `tasks/befund-toolwahl-2-angebot.md`. `look_up` ist laut
Forensik-Spur live nie angeboten (`allowLookup:false`, `src/plans.js:105`) und hier
bewusst AUSGEKLAMMERT — es taucht nur dort auf, wo der gerenderte Text es selbst nennt.

## Methode

Skript im Scratchpad faehrt einen echten `agentTurn` und faengt `globalThis.fetch` ab;
gedumpt wird der DeepSeek-Body, den der Anbieter bekommt — kein Anruf, keine Nachbildung
von `agentTools`. Env wie live, Sprache `de-DE`, Plan-Tenant `allowConsult:true` /
`allowLookup:false`. Vollstaendig: `tasks/befund-toolwahl-3-prompt-dump.txt`.

| Fall | Lage | Werkzeuge auf dem Draht | System-Prompt |
|---|---|---|---|
| **a** | **LIVE: outbound, Mandat, allowLookup=false** | **end_call, take_message, get_consult** | **5779 Zeichen** |
| a2 | wie a, aber allowLookup=true | + look_up | 5899 Zeichen |
| b | inbound | end_call, take_message | 3847 Zeichen |
| c | outbound ohne Mandat | end_call, take_message, get_consult, look_up | 4968 Zeichen |
| d | outbound, Mandat NUR `decide_freely` | end_call, take_message, get_consult, look_up | 5729 Zeichen |

## 1. KERNBEFUND: die Asymmetrie ist total

Woertliche Treffer im gerenderten System-Prompt, Fall a (live): `"take_message"` **1x**
(bei 81 % der Prompt-Laenge), `"get_consult"` **0x**, Umschreibung "Nachricht" **4x**
(52 %, 55 %, 59 %, 72 %), Saetze die eine Rueckfrage beim Auftraggeber als Weg benennen: **0**.

Dasselbe Bild in a2/c/d: `get_consult` kommt im System-Prompt in KEINEM der fuenf
gerenderten Faelle vor. Das Werkzeug existiert fuer das Modell ausschliesslich als
Eintrag im `tools`-Array; die Systemanweisung kennt es nicht. `take_message` steht
dagegen als Wort IM Prompt — und zwar genau an der Stelle, an der der Consult-Fall
eintritt.

## 2. Jeder Satz im gerenderten Prompt, der auf take_message zeigt (Fall a, woertlich)

**(1) `outOfScopeSentence` — Position 81 %, letzte konkrete Ausweg-Anweisung des Prompts.**
Quelle `src/i18n/prompts/de.js:95-97`, gerendert ueber `mandateSection`, `src/claude.js:213-221`:

> AUSSERHALB DEINES SPIELRAUMS: Sag klar, dass du das nicht selbst zusagen kannst. Halte das Angebot mit allen Details fest - Tag, Uhrzeit, Preis und bis wann es gilt -, gib es über take_message weiter und sag zu, dass Antonio sich meldet.

Das ist woertlich die Lage, fuer die `get_consult` gebaut ist ("dein Gegenueber verlangt
die Entscheidung deines Auftraggebers"), und der Prompt schreibt dafuer `take_message`
namentlich vor. **Fall d belegt: der Block rendert auch ohne gesetztes `on_out_of_scope`**
— `mandateSection` pusht ihn unbedingt, Fail-safe auf `MANDATE_OUT_OF_SCOPE_DEFAULT`
(`claude.js:213-220`). Also bei JEDEM Mandat mit irgendeinem Feld.

**(2) GRENZEN — der "ich weiss etwas ueber den Auftraggeber nicht"-Fall.** `de.js:70-71`,
unbedingt in JEDEM Turn (`claude.js:181`), Position 59 %:

> - Fehlt dir eine Angabe über Antonio oder dessen Sachen, fragst du NIEMALS dein Gegenüber danach - es kann das nicht wissen. Du klärst das auf deiner Seite oder nimmst das Anliegen als Nachricht auf.

Das ist die Definition des Consult-Falls. Von den zwei angebotenen Auswegen ist einer
vage ("auf deiner Seite"), der andere ein Werkzeug.

**(3) GRENZEN — pauschale Unwissenheits-Erklaerung.** `de.js:58-59` (`noLookup`; live
gerendert, weil `allowLookup:false`), Position 55 %:

> - Du kannst nichts nachschlagen, nichts recherchieren und niemanden weiterverbinden. Wird das verlangt, sagst du das ehrlich und nimmst das Anliegen als Nachricht auf.

"nichts recherchieren" steht unmittelbar neben einem Werkzeug, mit dem der Agent sehr
wohl etwas herausfinden kann (`get_consult`). Der einzige Handlungsverweis zeigt auf die
Nachricht.

**(4) GRENZEN — Terminwunsch.** `de.js:56-57`, Position 52 %:

> - Du buchst KEINE Termine fest. Einen Terminwunsch nimmst du mit allen Angaben als Nachricht auf: Tag, Uhrzeit, und bis wann er gilt.

**(5) Mandats-Rahmen.** `de.js:88`, Position 72 % — korrekt gescoped, aber es ist die
einzige Stelle, an der "fragst NICHT nach" faellt:

> Innerhalb dieses Rahmens entscheidest du selbst, fragst NICHT nach und gibst es NICHT als Nachricht weiter.

**Inbound (Fall b), kurz:** `get_consult` ist dort gar nicht im Satz; der Prompt nennt die
Nachricht 6x, schon bei 9 % ("sonst eine Nachricht aufnehmen", `de.js:26`) und im
Schlusssatz bei 97 % (`de.js:112`). Fuer diese Spur nicht der relevante Fall.

## 3. Die beiden Beschreibungen nebeneinander (`de.js:164-181` / `de.js:191-203`)

`take_message`, 1119 Zeichen, 9 Saetze. Der Satz, der den Consult-Fall MITDECKT, steht
bei 8 % der Beschreibung — vor jeder Abgrenzung:

> Nutze das, wenn du eine Frage nicht beantworten kannst oder wenn ein Terminwunsch festgehalten werden soll.

"eine Frage nicht beantworten koennen" ist genau der Zustand, in dem `get_consult`
greifen soll. Die Abgrenzung kommt erst bei 76-89 % und wird im Schlusssatz (92 %)
wieder geoeffnet:

> Verlangt dein Gegenüber die Entscheidung deines Auftraggebers, oder fehlt deinem Auftrag jetzt eine Sachauskunft, nimm KEINE Nachricht auf: dafür sind get_consult und look_up da. Fehlt dir das passende Werkzeug in diesem Zug, bleibt die Nachricht der richtige Weg.

**Live-Verschaerfung:** dieser Ausstiegssatz nennt `look_up` — ein Werkzeug, das live NICHT
im Satz liegt. Das Modell liest also im selben Atemzug "dafuer sind get_consult und
look_up da" und "fehlt dir das passende Werkzeug, bleibt die Nachricht der richtige Weg",
waehrend eines der zwei genannten Werkzeuge tatsaechlich fehlt.

`get_consult`, 823 Zeichen, 8 Saetze. Ausloeser vorn (S2), danach fuenf einschraenkende
Saetze — zwei davon zeigen selbst auf die Nachricht bzw. auf Nicht-Aufrufen:

> Der klare Fall: dein Gegenüber verlangt ausdrücklich die Entscheidung deines Auftraggebers - dann rufst du get_consult auf, statt eine Nachricht aufzunehmen.

> Eine Antwort ist NICHT garantiert: kommt keine, entscheidest du im Rahmen deines Mandats oder nimmst das Anliegen als Nachricht auf.

> Deckt dein Auftrag die Frage ab, entscheide selbst und rufe dieses Werkzeug NICHT auf.

> Höchstens EINMAL pro Gespräch.

Verbots-/Knappheitsmarker (NICHT|NIE|NIEMALS|KEINE|NUR|Höchstens) pro 1000 Zeichen:
`take_message` 5,4 — `get_consult` 6,1. `get_consult` ist die kuerzere Beschreibung mit
der hoeheren Verbotsdichte, plus einer harten Obergrenze und einem eingebauten
Rueckfall auf die Nachricht.

Auch die server-eigenen tool_result-Texte fuehren zurueck (`de.js:256-258`, `277-280`):
"Rückfrage jetzt nicht möglich. Entscheide im Rahmen deines Mandats oder nimm das
Anliegen über take_message auf."

## 4. Reihenfolge und Position auf dem Draht

`agentTools` (`claude.js:507-517`) baut `end_call`, `take_message`, dann angehaengt
`get_consult` — die Alternative steht im Array HINTER dem Werkzeug, das sie ersetzen soll.
Body: `model`, `max_tokens: 300`, `tools`, `messages` (System-Prompt = erste Nachricht),
`thinking:{type:"disabled"}`, **kein `tool_choice`** (agentTurn setzt es nicht ->
Anbieter-Default). System-Prompt 5779 Zeichen (~1650-1930 Token), Werkzeug-Array als JSON
2900 Zeichen = 33,4 % des cachefaehigen Praefix.

## 5. Anweisungen, die einen Werkzeugaufruf zusaetzlich verteuern (woertlich)

> - Höchstens zwei gesprochene Sätze pro Antwort, höchstens eine Frage darin.

> - Handle sparsam: du hast pro Antwort nur wenige Werkzeugaufrufe.

> - Was du nicht weißt, sagst du offen.

> - Sage dabei NIE, dass du nachschaust, suchst, nachschlägst, recherchierst oder jemanden fragst, und nenne danach NIE eine Quelle. Du überbrückst nur die Zeit und lieferst anschließend das Ergebnis, als wüsstest du es.

Der letzte Satz macht `get_consult` zu einer Handlung mit Verschleierungs-Pflicht,
waehrend `take_message` einen ausdruecklich erlaubten Sprechakt hat ("Sage dem Gegenüber
im SELBEN Zug, dass du die Nachricht weitergibst"). Ein Verbot "laenger zu brauchen" steht
NICHT im Prompt — der Druck entsteht ueber Sparsamkeit und Kontingent.

## 6. UNBELEGT

- Kausalitaet: der Befund zeigt die Asymmetrie im Text, nicht dass sie die gemessene
  Werkzeugwahl VERURSACHT. Kein A/B-Lauf (Prompt ohne (1)/(2)) gefahren.
- Wie DeepSeek `tools` und System-Nachricht intern zu einem Prompt zusammensetzt
  (Reihenfolge/Gewicht im Chat-Template) — aus unserem Body nicht messbar.
- Token-Zahlen aus Zeichen geschaetzt; kein DeepSeek-Tokenizer gefahren.
- Fixture-Werte (Auftrag, Mandat, Hintergrund) sind erfunden, nicht die des echten Anrufs;
  die STRUKTUR haengt nicht daran, die Laengen schon.
- Flag-Werte sind der dokumentierte Live-Stand, nicht am Render-Dienst nachgelesen.
  Sprachen ausser `de-DE` nicht gerendert.
