# F3 — Messung: wirken F1 (Prompt-Widerspruch) und F2 (Nachfass-Mechanismus)?

Phase F3 aus `tasks/PLAN-WERKZEUGWAHL.md` (Fortsetzung nach P3+P4/Nachher-Messung,
`tasks/werkzeugwahl-nachher.md`, Verdikt dort: NICHT ABGENOMMEN). Reine Messung, **kein
Produktivcode geaendert**. Commit-Basis: `e3c3e8c` (HEAD von `phase/werkzeugwahl`,
F1 `9049c24` + F2 `e3c3e8c`).

---

## 0. Vorab-Planung (Pflicht vor dem Lauf, Guthaben ist knapp)

Geplante Aufrufe, VOR dem ersten Live-Request festgelegt:

| Schritt | Aufrufe | Begruendung |
|---|---|---|
| 1. Gegebene Probe unveraendert erneut fahren | 5 Arme x n=5 x 1 Runde = **25** | direkte Vergleichbarkeit zu den AUSGANGSWERTEN |
| 2. Neues Messwerkzeug fuer den Mechanismus | 2 Richtungen x n=5 x hoechstens 2 Runden = **hoechstens 20** | s. Abschnitt 2 |
| **Summe (Obergrenze)** | **hoechstens 45** | |

Guthaben-Vorabtest (`GET /user/balance`, wie im gegebenen Probe-Skript): **status=200,
`is_available:true`, `total_balance:"1.97"` USD** — Lauf freigegeben. Nach beiden Laeufen
(tatsaechlich verbraucht: 25 + 11 = 36 Aufrufe, s. Abschnitt 2 und 3):
**`total_balance:"1.96"` USD — Verbrauch rund 0,01 USD** fuer die gesamte Messung. Kein
Abbruch noetig gewesen.

---

## 1. Erreicht die gegebene Probe den Nachfass-Mechanismus? NEIN — geprueft, nicht vermutet

Die gegebene Probe `probe-werkzeugwahl-experiment.mjs` baut pro Arm **genau eine**
Modell-Anfrage (`bodyFor` -> `provider.complete(...)` -> Draht-Body lesen, echte Antwort
per eigenem `post()` gegen den Draht) — sie ist strukturell einrundig: es gibt in ihr keine
Schleife, keine zweite Anfrage, keinen Code, der die Antwort der ersten Runde auf eine
Handlungs-Ankuendigung prueft.

Der WW-F2-Mechanismus (`src/tool-follow-up.js`, verdrahtet in `src/claude.js:1033-1157`,
Funktion `agentTurn`) sitzt aber GENAU in diesem zweiten Schritt: `followUpToolsFor` wird
erst aufgerufen, NACHDEM eine Runde ausgewertet wurde UND nur, wenn diese Runde **kein**
Werkzeug aufgerufen hat (`claude.js:1132`, `if (!toolCalls.length)`). Ohne eine zweite,
antwortgetriebene Runde kann der Mechanismus nicht auftreten — unabhaengig davon, ob
`TOOL_FOLLOW_UP_ENABLED` gesetzt ist, weil die Probe diesen Zustand nie erreicht.

**Befund: die gegebene Probe geht am Mechanismus vorbei.** Sie ist trotzdem nicht wertlos —
sie misst weiterhin exakt das, was sie immer gemessen hat (Werkzeugwahl EINER isolierten
Runde unter `tool_choice`-Varianten), und diese Groesse aendert F2 nicht, weil F2 erst NACH
einer bereits abgeschlossenen ersten Runde eingreift. Schritt 2 (unten) verwendet deshalb
einen zweiten, neuen Pfad, der die Antwort tatsaechlich liest und den Mechanismus wirklich
durchlaeuft.

---

## 2. Schritt 1 (Aufgabe Punkt 1): gegebene Probe unveraendert, aktueller Stand

Aufruf: `node probe-werkzeugwahl-experiment.mjs --n=5` auf `HEAD=e3c3e8c`, Skript **nicht
veraendert**. Systemprompt jetzt 5886 Zeichen (vorher beim Bau der Probe kuerzer), `get_consult`
kommt **5x** woertlich vor (F1/P3-Effekt), `take_message` weiterhin 1x.

### Zaehltabelle (identisches Format zu den AUSGANGSWERTEN)

| Arm | n | get_consult | take_message | end_call | KEIN Werkzeug | Fehler |
|---|---|---|---|---|---|---|
| A0 Referenz (auto) | 5 | **1** | 0 | 0 | 4 | 0 |
| A1 Zwang required | 5 | 5 | 0 | 0 | 0 | 0 |
| A2 Reihenfolge | 5 | **0** | **1** | 0 | 4 | 0 |
| A3 ohne take_message | 5 | **0** | 0 | 0 | 5 | 0 |
| A4 benannter Zwang | 5 | 5 | 0 | 0 | 0 | 0 |

### Vergleich gegen die AUSGANGSWERTE (get_consult-Spalte, vor F1+F2)

| Arm | vorher | jetzt | Delta |
|---|---|---|---|
| A0 auto | 0/5 | **1/5** | +1 |
| A1 required | 5/5 | 5/5 | 0 |
| A2 Reihenfolge | 0/5 | 0/5 | 0 |
| A3 ohne take_message | 1/5 | **0/5** | −1 |
| A4 benannter Zwang | 5/5 | 5/5 | 0 |

**Lesart:** ein Plus bei A0 und ein Minus bei A3 — bei n=5 kippt ein einzelner Lauf ein
Ergebnis um 20 Prozentpunkte; ein +1 hier und ein −1 dort saldieren sich zu **netto 0**.
Das ist kein robustes Signal fuer eine Verhaltensaenderung durch F1 auf dieser Messebene,
sondern liest sich wie Stichprobenrauschen um denselben Mittelwert. Zusaetzlich neu (in
den AUSGANGSWERTEN nicht erfasst): A2 hat jetzt einen `take_message`-Treffer (1/5) — ein
Werkzeug feuert, wo vorher gar keins feuerte; auch das ist ein einzelner Lauf.

**A1/A4 (die Zwangs-Arme) bleiben unveraendert bei 5/5** — die Positiv-Kontrolle "das
Werkzeug ist grundsaetzlich waehlbar" haelt weiterhin, das war nie strittig.

Rohdaten: `.../scratchpad/ww-experiment/{results.json,body-A*.json,system-prompt.txt}`,
Konsolen-Log `.../scratchpad/run1-current-head.log`.

---

## 3. Schritt 2 (Aufgabe Punkt 2+3): neues Messwerkzeug fuer den echten Mechanismus

### 3.1 Design-Entscheidung, offen begruendet

Kein Aufruf der vollen `agentTurn()`: die haengt an `store.addTranscript`/
`countCallerTurn`, dem Consult-Wait-Zustandsautomaten und kann nach einem echten
Werkzeugaufruf (z.B. `take_message`) eine DRITTE Modellrunde ausloesen, um die
Abschluss-Aeusserung zu erzeugen — die Rundenzahl waere dadurch NICHT mehr vorab exakt
zaehlbar, und Aufgabenbedingung 4 verlangt genau das (Guthaben ist knapp, Anzahl vorher
nennen).

Stattdessen: ein neues Skript (`probe-followup-mechanism.mjs`, Scratchpad), das **exakt
die zwei Runden** nachbaut, um die es in dieser Phase geht — mit den ECHTEN
Produktionsfunktionen, nicht mit einer Nachbildung ihrer Logik:

- `systemPrompt(call)` — echte Funktion, `src/claude.js`
- `followUpToolsFor` / `announcesToolAction` — echte Funktionen, `src/tool-follow-up.js`
- `localeFor(lang).prompt.followUp.nudge` — echter Steuertext
- `providerTurnMessage` — echte Nachrichtenform, `src/llm/messages.js`
- `LLM_TOOL_CHOICE.REQUIRED` — echter Vertragswert, `src/llm/tool-choice.js`

Das ist derselbe Pfad wie `claude.js:1062-1157`, nur ohne die fuer die Werkzeugwahl-Frage
irrelevante Turn-Buchhaltung drumherum (Transkript, Consult-Wait, Deadline). Rundenzahl je
Lauf ist damit vorab exakt bekannt: **genau 1 oder genau 2**, nie mehr — `TOOL_FOLLOW_UP_ENABLED`
wird nicht gelesen, der Mechanismus wird direkt ueber `followUpToolsFor({enabled:true, ...})`
angesteuert (die Funktion ist rein, kein Store/Config-Zugriff, s. Kopfkommentar der Datei).

**Abgrenzung, ehrlich benannt:** das ist NICHT identisch mit einem echten `agentTurn()`-Aufruf.
Es ist der Pfad, der den Mechanismus SELBST enthaelt (dieselben Entscheidungsfunktionen,
dieselbe Runde-2-Konstruktion, echte Modellantworten), aber ohne die Turn-Infrastruktur
drumherum. Diese Abweichung ist bewusst und aus Kostengruenden noetig (s.o.).

### 3.2 Zwei Richtungen, identischer Rahmen, eine Variable

Beide Richtungen teilen sich System-Prompt, Mandat, Werkzeugsatz (`end_call`,
`take_message`, `get_consult` — bewusst ohne `look_up`, das ist nicht Gegenstand dieser
Phase und haette eine zweite Variable in die Messung gemischt) und Eroeffnungssatz. Einzige
Variable: der letzte Satz der Gegenstelle.

- **MIT** anstehender Entscheidung = `d3-consult-implizit` woertlich: "Diese Woche geht nur
  noch Donnerstag um siebzehn Uhr, der Grosscheck kostet 95 Euro - passt Ihnen das?" — SOLL:
  `get_consult` (Termin ausserhalb des Mandats, keine Zusage ohne Ruecksprache).
- **OHNE** anstehende Entscheidung = `mandat-innerhalb` woertlich: "Dienstag um 14 Uhr
  haetten wir frei, das kostet 55 Euro." — SOLL: KEIN Werkzeug noetig (Angebot liegt
  vollstaendig im Mandat: Dienstag 14 Uhr bis 60 Euro).

### 3.3 Ergebnis

Tatsaechlich verbrauchte Aufrufe: **11** von hoechstens 20 geplanten (nur 1 von 10
Runde-1-Antworten loeste eine Runde 2 aus).

| Szenario | n | get_consult | take_message | end_call | KEIN Werkzeug | Fehler | davon ueber Runde 2 entschieden |
|---|---|---|---|---|---|---|---|
| MIT | 5 | **1** | **1** | 0 | 3 | 0 | 1 |
| OHNE | 5 | 0 | 0 | 2 | 3 | 0 | 0 |

Lauf-fuer-Lauf (MIT):

| # | Runde 1 | angekuendigt? | Runde 2 | Final |
|---|---|---|---|---|
| 1 | kein Werkzeug, "Ich gebe Jonas die Option aber gern weiter: ..." | **ja** | erzwungen -> `take_message` | `take_message` |
| 2 | kein Werkzeug, schlaegt selbst einen Alternativtermin vor | nein | — | keins |
| 3 | kein Werkzeug, schlaegt selbst einen Alternativtermin vor | nein | — | keins |
| 4 | kein Werkzeug, "Ich gebe Jonas aber gerne Bescheid: D..." | **nein** (Marker-Luecke, s.u.) | — | keins |
| 5 | `get_consult` direkt | n/a | — | `get_consult` |

Lauf-fuer-Lauf (OHNE): alle 5 Antworten sagen den Termin direkt und verbindlich zu
("Das passt perfekt... sage ich hiermit zu.", "...sage ich Ihnen verbindlich zu."); in
keiner der 5 Antworten kommt ein Ankuendigungs-Marker vor. Runde 2 wurde in **keinem**
Lauf ausgeloest. Zwei der fuenf Laeufe (#4, #5) riefen bereits in Runde 1 `end_call` direkt
auf (Nebenbeobachtung, s. 3.5 — nicht Teil des F2-Mechanismus, der greift nur, wenn Runde 1
KEIN Werkzeug ruft).

Rohdaten: `.../scratchpad/ww-followup-experiment/{results.json,system-prompt.txt}`,
Konsolen-Log `.../scratchpad/run2-followup-mechanism.log`.

### 3.4 Kernbefund: F2 feuert nachweislich — aber waehlt `take_message`, nicht `get_consult`

F2 ist kein toter Code: in MIT wurde in 1 von 4 Faellen ohne Werkzeugaufruf eine
Ankuendigung erkannt, Runde 2 tatsaechlich erzwungen, und die Runde hat **zuverlaessig ein
Werkzeug geliefert** (kein Fehlschlag, kein `end_call` trotz B6-Ausschluss). Der
`get_consult`-Zaehler selbst bewegt sich dadurch in dieser Stichprobe **nicht**: er steht
in Runde-1-only (= ohne F2, entspricht Arm A0) bei 1/5 und nach dem vollen
Zwei-Runden-Mechanismus ebenfalls bei 1/5 — derselbe einzelne Lauf (#5), der schon in
Runde 1 direkt `get_consult` waehlte. Der EINZIGE Fall, in dem F2 tatsaechlich eingriff
(#1), endete bei `take_message`, weil das Modell in der ERZWUNGENEN Runde — bei freier
Wahl zwischen `get_consult` und `take_message` — selbst `take_message` waehlte.

Das reproduziert exakt den Befund aus `tasks/werkzeugwahl-nachher.md` Abschnitt 5b
("Ausweich-Rate steigt ... ueber den take_message-Ausweg, nicht ueber den vorgesehenen
get_consult-Weg") — mit einer unabhaengigen Stichprobe und einer Messung, die diesmal
GARANTIERT durch den echten Mechanismus lief (Abschnitt 1 dieses Berichts). Das ist eine
Bestaetigung des vorherigen Befunds, keine neue, unabhaengige Beobachtung.

### 3.5 Kriterium E (Veto) — beide Haelften separat, mit Zahlen

**5a (keine Ueberkorrektur):** in der OHNE-Richtung (voll im Mandat, keine Entscheidung
noetig) feuerte F2 in 0 von 5 Laeufen faelschlich — der Mechanismus wurde in keinem
einzigen Lauf ausgeloest, weil keine der 5 Antworten eine Handlung ankuendigte, die sie
nicht sofort selbst ausfuehrte. **Das ist der einzige klar positive Befund dieser Messung** —
aber auf n=5 gestuetzt, ein einzelner falsch-positiver Lauf haette das Bild gekippt.

**5b (kein zusaetzliches `take_message` statt Stille):** in MIT sank die Zahl der
komplett unagierten Laeufe (weder Werkzeug noch Ankuendigung) von 4/5 (Runde 1 allein) auf
3/5 (nach F2) — EIN vorher stummer Lauf wurde durch F2 tatsaechlich in eine Handlung
umgewandelt. Diese eine Handlung war aber `take_message`, nicht `get_consult` — dieselbe
Verschiebung wie in der P3+P4-Nachher-Messung, hier auf Wirkungsebene des Mechanismus
selbst reproduziert.

### 3.6 Nebenbefund, nicht Teil des Auftrags aber im Datensatz sichtbar: Marker-Luecke

Lauf #4 (MIT) formuliert die Ankuendigung als "Ich gebe Jonas aber gerne Bescheid: D..."
— eine Weitergabe-Ankuendigung in der Sache, aber `announcesToolAction()` erkennt sie
**nicht**, weil die Marker-Liste (`src/i18n/prompts/de.js`, `followUp.markers`) das Paar
`["gebe", "weiter"]` verlangt und hier "weiter" fehlt ("Bescheid geben" statt "weitergeben").
Dieser Lauf blieb dadurch bei "keins" stehen, obwohl der Text inhaltlich genau die
Handlung ankuendigt, die F2 fangen soll. **Das ist eine beobachtete Erkennungsluecke, kein
Fix dieser Phase** (F3 aendert keinen Produktivcode) — festgehalten fuer eine kuenftige
Phase, die die Marker-Liste erweitert.

### 3.7 Nebenbeobachtung: `end_call` in Runde 1 (OHNE-Szenario, 2/5)

In der OHNE-Richtung riefen 2 von 5 Laeufen bereits in Runde 1 `end_call` direkt nach der
Zusage auf. Das ist eine Eigenheit dieser EINRUNDIGEN Messkonstruktion (der Gespraechsverlauf
endet hier nach genau einer Gegenrede, wie es in einem echten mehrrundigen Anruf nicht
vorkaeme) und **nicht** Teil des F2-Mechanismus (der greift nur bei Runden ohne
Werkzeugaufruf) — hier nur der Vollstaendigkeit halber notiert, nicht bewertet.

---

## 4. Verdikt

Getrennt nach den zwei Eingriffen, weil sie unterschiedliche Wirkungsebenen haben:

### 4.1 F1 (Prompt-Widerspruch, `9049c24`) — Wirkung auf die Werkzeugwahl-Zahlen der Einzelrunde

**UNVERAENDERT.** Netto-Delta ueber alle 5 Arme der gegebenen Probe: +1 (A0) und −1 (A3)
saldieren sich zu 0; A1/A4 (Zwangs-Kontrolle) unveraendert bei 5/5. Bei n=5 je Arm ist das
kein robuster Beleg fuer eine Bewegung — es liest sich wie Rauschen um denselben
Mittelwert. (F1s EIGENTLICHER, bereits verifizierter Effekt — die Aufloesung der
Buchungs-Zeilen-Kontradiktion selbst — ist durch die dedizierten WW-F1-Tests belegt und
wird hier nicht neu bestritten; nur die Frage "bewegt sich dadurch messbar die
Werkzeugwahl am Draht" ist UNVERAENDERT.)

### 4.2 F2 (Nachfass-Mechanismus, `e3c3e8c`) — Kernziel "get_consult steigt in der IMPLIZIT-Lage"

**UNVERAENDERT.** `get_consult` steht bei 1/5 sowohl vor als auch nach dem vollen
Zwei-Runden-Mechanismus (derselbe einzelne Lauf entscheidet beide Male). Der Mechanismus
selbst ist nachweislich NICHT tot (er loeste in 1/5 Faellen korrekt aus und lieferte
zuverlaessig ein Werkzeug), aber die erzwungene Runde entschied sich fuer `take_message`,
nicht fuer das vom Plan als Ziel benannte `get_consult`.

### 4.3 Kriterium E (Veto)

**Geteilt.** Teil a (keine Ueberkorrektur in der OHNE-Richtung): 0/5 falsche Ausloesungen —
**erfuellt, aber duenn** (n=5). Teil b (kein Tausch Stille gegen `take_message` statt
`get_consult`): **nicht erfuellt** — genau dieser Tausch trat auf (1 von 4 vorher stummen
Faellen wandert zu `take_message`), identisch zum bereits in `werkzeugwahl-nachher.md`
dokumentierten Muster.

### 4.4 Gesamtverdikt

**UNVERAENDERT** fuer die Kernfrage der Phase (steigt `get_consult` in der impliziten
Entscheidungslage durch F1+F2). Die Stichprobe ist mit n=5 je Bedingung klein — ein
einzelner Lauf wiegt 20 Prozentpunkte — aber die Zahlen selbst zeigen unter dieser
Methodik keine Bewegung auf der Zielgroesse, sondern eine Bestaetigung des schon in der
P3+P4-Nachher-Messung dokumentierten Ausweichmusters (Stille wird seltener, aber zugunsten
von `take_message`, nicht `get_consult`). **NICHT BELEGBAR** waere die falsche Antwort hier
— die Zahlen sagen etwas Konkretes, naemlich "keine Bewegung auf der Zielgroesse", das ist
etwas anderes als "keine Aussage moeglich".

Einzig echter Lichtblick, mit derselben Vorsicht zu lesen: **0/5 Ueberkorrektur** in der
neu gemessenen OHNE-Richtung — der Mechanismus feuert nicht wild bei jeder Kleinigkeit,
zumindest nicht im hier gemessenen, klar innerhalb des Mandats liegenden Fall.

---

## 5. Was diese Messung nicht zeigt

- Keine Kausalanalyse, WARUM das Modell in der erzwungenen Runde 2 `take_message` statt
  `get_consult` waehlt, obwohl beide angeboten sind. **UNBELEGT**, nicht Teil dieser Phase.
- Keine Pruefung weiterer OHNE-Faelle jenseits von `mandat-innerhalb` (z.B. reine
  Sachfragen, Small Talk) — **NICHT GEMESSEN**. Der 0/5-Befund gilt nur fuer diese eine,
  konkrete Konfiguration (Lehre `calibration-scope-lesson`).
- Kein echter mehrrundiger Anrufverlauf (die Zwei-Runden-Konstruktion ist ein Stellvertreter
  fuer `agentTurn`, kein `agentTurn`-Aufruf selbst — Abschnitt 3.1). Ein Bench-Lauf mit
  echtem `agentTurn` und `TOOL_FOLLOW_UP_ENABLED=true` waere der naechste, teurere Schritt.
- Kosten pro Aufruf im Detail (Token-Zahlen je Anfrage) — nur der Gesamtverbrauch
  (~0,01 USD fuer 36 Aufrufe) ist belegt, keine Aufschluesselung je Arm/Szenario.
- `npm run test:gates`: **NICHT GEMESSEN** (wie in den Vorphasen — launch-Testkatalog,
  kein Regressionsschutz, diese Phase aendert ohnehin keinen Produktivcode).

## 6. Verifikation

- `node --check` auf die einzige neue Datei (`probe-followup-mechanism.mjs`, Scratchpad,
  kein Teil des Repos): **bestanden**.
- `git status --short` im Repo waehrend der gesamten Phase: **keine Aenderung an
  Produktivcode** (nur diese Berichtsdatei neu hinzugekommen).
- `npm test` (vollstaendig, auf `HEAD=e3c3e8c`, selbst gefahren): **4193/4193 gruen**
  (korrigiert 4173/4173 nach Abzug der 20 i18n-Katalog-Datei-Wrapper ohne echten Test,
  dieselbe Korrektur wie in den Vorphasen). Laufzeit ~100s.

## 7. Rohdaten

- Gegebene Probe, aktueller Stand: `.../scratchpad/ww-experiment/` (`results.json`,
  `body-A0..A4.json`, `system-prompt.txt`), Konsolen-Log `.../scratchpad/run1-current-head.log`.
- Neues Messwerkzeug: `.../scratchpad/probe-followup-mechanism.mjs` (Skript, Scratchpad,
  kein Produktivcode), Ausgabe `.../scratchpad/ww-followup-experiment/` (`results.json`,
  `system-prompt.txt`), Konsolen-Log `.../scratchpad/run2-followup-mechanism.log`.
- Beide Pfade unter `/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/8af6ee0c-29a2-449c-85e3-918b3b13e6ee/scratchpad/`.
