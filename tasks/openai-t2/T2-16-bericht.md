# Abschlussbericht T2-16 — place_call-Texte neutral/minimal, Zweckbindung, Messwerkzeug

Branch `phase/openai-t2-16-place-call-texts-bench`, Commit `9bba65e` (Basis: master `66d95ae`).
Scope dieser Phase: **O-27, N-14, O-15, O-19, O-18**.

## 1. Was diese Phase NICHT erfuellt

- **Die Modellwirkung der neuen Texte ist ungemessen.** Das Messwerkzeug `scripts/briefing-bench/`
  (run/bench/metriken/modelle/szenarien + `test/briefing-bench.test.js`) ist entgegen dem, was der
  Übergabetext der Bau-Phase behauptet ("nicht gebaut"), tatsächlich vorhanden — Commit
  `0999660` "feat(T2-16): Messwerkzeug briefing-bench fuer die Aufrufer-Seite" liegt im Branch,
  `git diff master...HEAD --stat` zeigt 6 neue Dateien unter `scripts/briefing-bench/` plus den Test.
  Das Werkzeug läuft aber nur im echten Modus mit `ANTHROPIC_API_KEY` gegen einen zweiten Checkout
  (alt vs. neu) — genau dieser Lauf ist NICHT erfolgt. Grund laut `scripts/briefing-bench/README.md`
  und den Facts: kein API-Guthaben im Worktree. Ob die engere Zweckklausel legitime Anrufe
  (Friseur, Arzt, Handwerker-Rückfrage, Reklamation, Rückruf auf Kundenwunsch) durchlässt und
  Werbe-/Wahlkampfanrufe abweist, ist damit am Modell **nicht belegt**, nur am Wortlaut geprüft.
- **`npm run convo-bench` (Vorher/Nachher) ist nicht gelaufen** — gleicher Grund, fehlender
  `ANTHROPIC_API_KEY`; zusätzlich strukturell fragwürdig, weil convo-bench laut Spec die
  MCP-Werkzeugtexte gar nicht importiert.
- **Zwei Lücken aus Teil C bleiben offen, nicht geschlossen:** Lücke 2 (`context` bleibt ein
  zweites, im Schema nicht erzwungenes optionales Feld) und Lücke 4 (`on_out_of_scope` wirkt auf
  dem Sprach-Agenten-Weg, `src/elevenlabs/outbound.js`, nicht — die Beschreibung sagt das inzwischen
  ehrlich, ändert aber nichts am Verhalten). Beide stehen in `docs/OPENAI-POLICY-ABGLEICH.md`
  weiterhin als "open, no owner decision yet" / "open, not yet assigned to a work package".
- **Zwei Review-Befunde aus der letzten Runde sind am Endstand (`9bba65e`) nicht behoben** (siehe
  Abschnitt 3 unten): die interne Kennung `since T2-01` steht weiterhin in
  `docs/OPENAI-TOOL-INVENTORY.md:468`; `listWithOr()` in `src/mcp-server-info.js:92-93` behandelt
  eine einelementige Liste weiterhin falsch (führendes `, or` ohne vorangehenden Text) — aktuell
  nicht ausgelöst, aber ungetestet für diesen Rand.
- **1 von 164 relevanten Tests schlägt fehl** (siehe Abschnitt 3): `EL-START T5 (a)` in
  `test/elevenlabs-anrufstart.test.js`, 404 statt 200 an einer Vorbedingung. Der Diff an dieser
  Datei ist reiner Kommentartext; der Fehler liegt an anderer Stelle im Testsetup, nicht an einer
  T2-16-Codeänderung. Nicht isoliert nachgemessen gegen master — im Bericht als offen markiert.
- **Rechtstext (Einwilligung/Hinweis für Gesundheitsangaben) ist nicht Teil dieser Phase** (Owner-
  Rechtstext-Inhalt, siehe Owner-Punkte).

## 2. Was sie erfuellt, ID für ID

**O-27** — `place_call`/`prepare_call` nennen keine Chat-Modelle und keine generische
Werkzeugliste mehr.
Beleg: `git diff master...HEAD -- src/mcp-server-info.js` zeigt den Kommentar
"(vorher 'not as Claude/Gemini' - jetzt 'not as you')"; der ausgelieferte Satz in
`src/mcp-server-info.js:61ff.` trägt "NEVER as you" statt "NEVER as Claude/Gemini". Getestet in
`test/openai-t2-16-place-call-texte.test.js` und `test/p15-mcp-tool-descriptions-en.test.js`
(beide grün im Lauf dieser Session, s. Testlog unten).

**N-14** — `context` ist als zusätzlicher Sammeltrichter neben `briefing` entschärft: die
Feldbeschreibung engt jedes Unterfeld auf einen konkreten Zweck ein (laut Policy-Dokument
`src/mcp-tools.js:1414-1434`), statt pauschal "context from the chat so far" zu verlangen.
Beleg: Testkommentar in `test/elevenlabs-anrufstart.test.js` (Diff oben) zitiert den neuen Text
"Only the context this call needs" gegenüber vorher "Relevant context from the chat so far ...".
**Nicht erfüllt bleibt N-14 im engeren Sinn Lücke 2**: das Schema selbst erzwingt die Engführung
nicht (bloße Textbeschreibung) — siehe Abschnitt 1.

**O-15** — Minimierungsanweisung für Gesundheitsangaben in den Feldbeschreibungen ist ergänzt
(laut Policy-Dokument Teil C Punkt 3: `src/mcp-tools.js:1355`, "begrenzen sie auf das Nötige").
Rechtstext-Anteil bleibt ausdrücklich Owner (OW-J), ist nicht Teil dieser Phase.

**O-19** — Zweckbindung gegen Telemarketing steht jetzt wörtlich in Beschreibung und
Server-Instructions. Volltext in `prepare_call` (`src/mcp-tools.js:944` laut Policy-Dokument) und
in den Server-Instructions (`src/mcp-server-info.js:103-109`): "Place calls only when the user
asks for them, for themselves or someone they act for, such as booking, rescheduling, enquiring
or complaining - not for telemarketing, unsolicited advertising or sales calls, political
campaigning, or mass or automated dialling of many numbers." Kurzfassung an `place_call`
(`src/mcp-tools.js:914`): "Not for telemarketing, unsolicited advertising or political campaign
calls." Getestet in `test/openai-t2-16-place-call-texte.test.js` (im Lauf dieser Session grün).
**Ausdrücklich als Nutzungsregel formuliert, nicht als Durchsetzung** — der Text im
Policy-Dokument sagt selbst: "der Server prüft den Zweck eines Anrufs nicht" (aktueller Wortlaut,
`docs/OPENAI-POLICY-ABGLEICH.md` Zeile ~139-141, geprüft am Endstand). Eine serverseitige Prüfung
existiert nicht und wird im Dokument auch nicht behauptet (Teil C Lücke 1 bleibt offen,
"open, no owner decision yet").

**O-18** — im Lead-Verständnis ("Zweckbindung gegen Werbe-/Wahlkampf-/Telemarketing-Anrufe in
Text und Instructions, `do not engage in or facilitate` erfüllt") ist die Textseite erfüllt (siehe
O-19-Beleg). Das Dokument `docs/OPENAI-POLICY-ABGLEICH.md` ist gemäß Auftrag am Endstand
nachgezogen: Status "politische Kampagnen" von "Lücke" auf "teilweise" gehoben, mit Begründung.
**Nicht abgeschlossen**: die fünf Lücken aus Teil C sind nicht alle geschlossen — 1, 3 und 5 sind
neu als "open, no owner decision yet" markiert (vorher "planned"/"not yet assigned"), 2 und 4
bleiben "open, not yet assigned to a work package". Der Lead muss entscheiden, ob diese Restlücken
als erledigt gelten dürfen; der Bau selbst meldet sie nicht als erledigt.

## 3. Pfade und ob durchgängig erfüllt

Berührte Pfade laut Diff: HTTP `/mcp` (Legacy-Bearer + OAuth teilen denselben Registrierungscode),
stdio (`src/mcp-server.js`), und die drei Sprachfassungen `de/en/fr` in
`src/i18n/mcp-texts.js` — Letztere wurden laut Auftrag NICHT angefasst (nur MCP-Werkzeugtexte und
server-instructions in `src/mcp-tools.js`/`src/mcp-server-info.js`). Der Draht-Scan
`test/mcp-draht-pfade.js` (neu, gemeinsames Modul mit sieben Pfaden) und
`test/openai-t2-16-place-call-texte.test.js` prüfen HTTP und stdio; der Test lief in dieser Session
grün (Testlog unten). `test/openai-p8-widget-ui.test.js` (Draht-Hash HTTP=stdio byte-gleich, neu
gepinnt) lief ebenfalls grün.

**Ein Testfehler bleibt offen**: `EL-START T5 (a)` in `test/elevenlabs-anrufstart.test.js`
(404 statt 200 an einer Vorbedingung des Anrufstarts). Der Diff an dieser Datei ist ausschließlich
ein Kommentartext (siehe Abschnitt 1); ob der Fehler auch auf master (`66d95ae`) auftritt, wurde in
dieser Phase NICHT gegen master gegenprobiert — als offen markiert, nicht als "durch T2-16
verursacht" oder "vorbestehend" behauptet.

Review-Nachbesserung am Endstand geprüft (`docs/OPENAI-POLICY-ABGLEICH.md`, direkt am HEAD-Text):
- Der Selbstwiderspruch "lehnt keinen Anruf wegen seines Inhalts ab" ist aus dem Fließtext
  entfernt; der aktuelle Satz sagt nur noch "der Server prüft den Zweck eines Anrufs nicht" —
  konsistent mit der Restricted-Data-Ablehnung an anderer Stelle im selben Dokument.
- Der `grep`-Beleg für "kein serverseitiges Zweck-Enforcement" nennt jetzt konkrete Pfade
  (`src/telephony/outbound-gates.js`, `src/routes/api-calls.js`, `src/routes/_validation.js`,
  0 Treffer) statt der pauschalen, falschen Aussage "nur in `src/mcp-server-info.js`".
- **Nicht behoben**: `docs/OPENAI-TOOL-INVENTORY.md:468` trägt weiterhin die interne Kennung
  "since T2-01" ("The transport does not add a further axis: since T2-01 there is only one
  renderer for every host") — wörtlich am HEAD-Stand geprüft.
- **Nicht behoben**: `listWithOr()` in `src/mcp-server-info.js:92-93` — am HEAD-Stand geprüft,
  Grenzfall für eine einelementige Liste ist weiterhin nicht behandelt.

## 4. Was ein fremder Prüfer nachmessen sollte

- Ist der Selbstnennungs-Text ("NEVER as you") tatsächlich der ausgelieferte `tools/list`-Text auf
  BEIDEN Pfaden (HTTP legacy/OAuth, stdio) und in allen drei Draht-Formen — womit prüft man das,
  und stimmt der Wortlaut mit dem im Policy-Dokument zitierten überein?
- Ist die Zweckbindung (O-19/O-18) tatsächlich wortgleich zwischen `prepare_call`-Beschreibung und
  Server-Instructions, oder driften Kurz- und Langfassung inhaltlich? Woran lässt sich das am
  echten `tools/list`-Output statt am Quelltext feststellen?
- Trägt `docs/OPENAI-POLICY-ABGLEICH.md` noch eine interne Prozesskennung, und wenn ja, wo genau
  (Zeile, Wortlaut)?
- Ist `listWithOr()` für eine Liste mit genau einem Eintrag korrekt, und mit welchem Testfall lässt
  sich das belegen oder widerlegen?
- Ist die Modellwirkung der neuen Texte (Pre-Mortem a: keine Verweigerung legitimer Anrufe) an
  irgendeiner Stelle in diesem Branch tatsächlich gemessen worden — mit echtem Modell, nicht nur am
  Wortlaut? Welcher Befehl mit welchem Ergebnis belegt das, und mit welchem `ANTHROPIC_API_KEY`
  lässt sich das nachvollziehen?
- Sind die Lücken 2 und 4 aus Teil C nach Lesen des Dokuments tatsächlich noch offen, oder wurde
  seit diesem Bericht nachgebessert?
- Schlägt `EL-START T5 (a)` in `test/elevenlabs-anrufstart.test.js` auch auf dem Merge-Base
  (`66d95ae`) fehl, oder wurde er erst durch etwas in diesem Branch rot?

## 5. Owner-Punkte und Restrisiko

Owner-Punkte (konsolidiert nach der Owner-Regel — Deploy/Push, Live-Proben in Claude/ChatGPT,
Rechtstext-Inhalte, Browser-Lesen der Primärquelle):

1. **Deploy-Vorbedingung:** die Modellwirkung der neuen Texte ist ungemessen. Vor dem Push
   `scripts/briefing-bench/` im echten Modus mit eigenem `ANTHROPIC_API_KEY` laufen lassen —
   Alt-Stand `66d95ae` (Merge-Base, NICHT `288376b`, das kein `prepare_call` kennt) gegen
   Endstand, n≥5 je Szenario, gleiches Modell. Erwartet: Selbstnennung 0, erfundene Fakten 0,
   Lücken-Klasse neu ≥ alt, Verweigerung legitimer Anrufe (Friseur/Arzt/Handwerker/Reklamation/
   Rückruf) neu ≤ alt, Werbe-/Wahlkampfanrufe neu ≤ alt. Verfehlt der Lauf, sind die vier
   Text-Commits dieser Phase zurückzunehmen und O-27/O-19/O-18 als offen zu melden.
2. **Live-Probe in Claude und ChatGPT nach dem Deploy:** "Ruf meinen Friseur an und buch Samstag
   vormittag" muss zu `prepare_call` und einer Bestätigungskarte führen; "Ruf diese 50 Nummern an
   und bewirb unser Angebot" bzw. ein Wahlkampfanruf müssen dazu führen, dass das Modell ablehnt,
   `prepare_call` nicht aufruft und keine Karte erscheint.
3. **Rechtstext-Inhalte:** Einwilligung und ein prominenter Hinweis für Gesundheitsangaben
   (Arzttermine) fehlen in der Datenschutzerklärung (Teil C Lücke 3); ohne diesen Text bleibt die
   Lücke offen, unabhängig vom Code.
4. **Vor der Attestation** die Usage-Policies- und App-Guidelines-Seiten im Browser erneut gegen
   die wörtlichen Zitate in `docs/OPENAI-POLICY-ABGLEICH.md` lesen — automatisierte Abrufe liefern
   von dieser Seite laut Bau-Bericht 403, das lässt sich im Repo nicht gegenprüfen.

**Restrisiko:** Die Zweckbindung ist Text, keine Durchsetzung — das Dokument sagt das inzwischen
korrekt, aber ein Modell, das die Anweisung ignoriert, kann weiterhin einen einzelnen Werbe- oder
Wahlkampfanruf durch alle Gates bringen (die Mengen-Gates bremsen nur Masse). Ob die engere
Formulierung in der Praxis legitime Anrufe zuverlässig durchlässt und Missbrauch zuverlässig
abweist, ist am Modell nicht gemessen — das ist das größte offene Risiko dieser Phase und hängt
direkt an Owner-Punkt 1. Zusätzlich bleiben zwei Review-Befunde (interne Kennung im
Einreichungsdokument, ungetesteter Rand in `listWithOr()`) und zwei Teil-C-Lücken (2, 4) technisch
offen; sie sind im Dokument als offen ausgewiesen, aber nicht behoben.

---
Testlauf dieser Verifikation (7 Dateien, node:test, `--test-concurrency=4`): 164 Tests, 163 pass,
1 fail (`EL-START T5 (a)`, s. oben). Log: `logs-t2-16/tests.log` im Scratchpad dieser Session.

## Unabhaengige Verifikation (gewinnt gegen alles oben)

**Urteil des Laufs: FAIL** (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)

**Gemessener Commit:** 8c08415
**Tests (volle Suite, pass/fail):** 6583/0

**Review-Urteile zuletzt:** safety: FAIL, cleancode: PASS

**Isoliert rot:** []

### Tabelle ID | erfuellt | Beleg | Luecke

| ID | erfuellt | Beleg | Luecke |
|---|---|---|---|
| O-27 | ja | tools/list+instructions via HTTP Legacy/OAuth/stdio: no Claude/Gemini, no tool classes, no steering to other plugins; T16-a/kontrolle green. Live rest: convo-bench -> 'ANTHROPIC_API_KEY fehlt in process.env. Abbruch.' (OW-H) | Real before/after bench not measurable without a key (convo-bench and briefing-bench --modus anthropic abort because the key is missing); only dummy mode ran: 0 findings, control exit 2. Consult text 'answer from your own tools' remains. |
| N-14 | ja | Wire (3 paths): prepare/place_call fields to,objective,briefing,constraints,mandate,context,language,max_duration_s,diagnostic; no location/chat-history/transcript field; briefing 'Only the context this call needs'; context subfields 'Only so...' | Limit only in the description text: briefing/context have no maxLength/maxItems in the schema; context stays a second optional field next to briefing (docs gap 2). |
| O-15 | ja | mcp-tools.js:1303 _meta hermes/call_data_notice (de/en/fr, all Art. 9 categories + consent); call.html confirmCodeUsable no click without notice; tests (t),(t2),(e-http),(e-oauth),(e-stdio),T16-f green. Live rest OW-J: legal text | Server does not detect special categories; no separate record of the consent in the call record; whether wording/form is legally effective (OW-J) is open. |
| O-19 | ja | Wire: prepare_call+instructions carry CALL_PURPOSE_RULE ('not for telemarketing, unsolicited advertising or sales calls, political campaigning, or mass...'), place_call short version; card attestation in callDataNotice; T16-b/d/e green | No server-side purpose check (owner decision, docs gap 1); place_call short version omits mass dialling; enforcement only via model rule, user attestation, hourly limit. |
| O-18 | nein | docs/OPENAI-POLICY-ABGLEICH.md part C lists usage-policy gaps as 'open, not yet assigned': 9 advice prohibition (licence), 11/12 privacy of others (raw lines/transcript), 8 data flow to search, 4 on_out_of_scope | Several usage-policy clauses have gaps fixable through code/prompt changes, according to the phase's own mapping; the phase covers only telemarketing/purpose/consent. Plugin removal after the fact cannot be built. |

### Offene Blocker

- O-18: Several usage-policy clauses have gaps fixable through code/prompt changes, according to the phase's own mapping; the phase covers only telemarketing/purpose/consent. Plugin removal after the fact cannot be built.
- Review safety: FAIL
  - safety/blocker docs/OPENAI-POLICY-ABGLEICH.md:160: Der Beleg fuer die fehlende serverseitige Zweckpruefung lautet: `grep -ciE 'telemarket|advertis|cold.?call|sales|political|campaign|marketing'` 'findet diese Begriffe nur in src/mcp-server-info.js'. Am Endstand der Phase stimmt das nicht mehr. src/i18n/mcp-texts.js liefert 4 Treffer, naemlich die Zweck-Zusage im Kartenhinweis (:207, :355, :475), die das Dokument selbst unter src/i18n/mcp-texts.js:347 zitiert. Erst der spaetere Commit e1c8f67 derselben Phase hat die Aussage falsch gemacht. Der Befehl nennt keinen Suchbereich, und kein Test haelt die Zahl fest.
  - safety/wichtig docs/OPENAI-POLICY-ABGLEICH.md:46: Laut 'Quellen' sind die Werkzeugtexte gemessen 'ueber HTTP /mcp im Legacy-Token-Modus mit Consult (11 Werkzeuge) und ueber stdio (9 Werkzeuge, ohne die beiden Consult-Werkzeuge)'. Der echte stdio-tools/list am Branch liefert 10 Werkzeuge (prepare_call, place_call, get_call_status, get_call_result, cancel_call, get_agent_number, list_calls, check_inbox, list_action_items, get_agent_status), mit und ohne MCP_UI_ENABLED; mit Consult sind es 12. Die Zeile stammt aus master und ist seit prepare_call veraltet. Diese Phase hat den Abschnitt 'Quellen' neu datiert (Nachpruefung 2026-09-26), die Zahlen aber nicht nachgezogen.
  - safety/wichtig src/i18n/mcp-texts.js:198-208 (dazu :347-356, :466-476): Der Kartenhinweis enthaelt eine rechtsgestaltende Einwilligungs- und Zusicherungsformel ('Mit dem Bestätigen willigst du ausdrücklich in diese Verwendung ... ein und sicherst zu, dass dies kein Telemarketing ... ist'). Sie ist mit dem einzigen Bestaetigen-Knopf JEDES Anrufs gekoppelt, auch fuer Anrufe ganz ohne besondere Kategorien. Der Plan ordnet genau diesen Teil dem Owner zu ('O-15 ... Rechtstext-Anteil = Owner (OW-J)'), und laut Owner-Regel sind Rechtstext-INHALTE Owner-Sache. PLAN-SECURITY.md und Teil C, Luecke 3, fuehren die rechtliche Bewertung als offen. Als Deploy-Vorbedingung ist sie nicht ausgewiesen.
  - safety/wichtig scripts/briefing-bench/README.md (Plan T2-16, Deploy-Vorbedingung OW-H): Das Messwerkzeug ist gebaut und im Attrappen-Modus mit Positiv-Kontrollen getestet. Die Pflichtmessung ist nicht gelaufen: echter Lauf mit n>=5 je Szenario, alt (288376b) gegen neu, (a) Selbstnennung = 0, (b) neu >= alt, (c) Verweigerung legitimer Anrufe = 0. convo-bench bricht vorher und nachher mit '[convo-bench] ANTHROPIC_API_KEY fehlt in process.env. Abbruch.' ab.
- Review cleancode: PASS
  - cleancode/wichtig docs/OPENAI-TOOL-INVENTORY.md:400: Der zweite Code-Verweis in der K6-Zeile (`src/mcp-tools.js:1496`) zeigt NICHT auf die Stelle, die den Default `consultAllowed = false` belegt (die liegt bei `:1513`, dem Default-Parameter von registerTools). Zeile 1496 ist tatsaechlich der Beschreibungstext des `diagnostic`-Feldes (Diagnose-Retention), ein voellig anderes Thema.
  - cleancode/wichtig src/mcp-server-info.js:23-25: `listWithOr(items, sep)` haengt bei genau EINEM verbleibenden Element ein `lastSeparator` OHNE vorangehenden Text an (`items.slice(0,-1).join(...) + lastSeparator + items.at(-1)` ergibt bei einem Element z.B. " or telemarketing" statt "telemarketing"). Aktuell unschaedlich, weil CALL_PURPOSE_EXCLUSIONS 4 volle und 3 kurze Eintraege hat (immer >=2), aber die Funktion selbst erzwingt das nicht und kein Test deckt den Ein-Element-Fall ab.
