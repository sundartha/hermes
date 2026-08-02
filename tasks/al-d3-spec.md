# AL-D3 — Den Tool-Entscheidungspunkt schaerfen (Befund D-3)

**Kontext:** `tasks/al-handover-2026-08-01.md` §1 (D-3) und §4 Punkt 2, sowie
`tasks/al-d2-diagnose.md` §5 (K4-Befund). **Basis:** `master` @ `a327334`.

**Was hier geaendert wird, ist Modelltext am Entscheidungspunkt — kein Mechanismus.**
Genau eine Produktdatei-Gruppe (die drei Sprachbausteine) aendert Verhalten. Alles andere
in dieser Phase ist **Messapparat**, der die Wirkung ueberhaupt erst sichtbar macht.

---

## 0. Warum diese Phase, in einem Absatz

An zwei echten Anrufen gemessen: `offeredToolNames` trug `get_consult` in 10 von 12 und
`look_up` in 12 von 12 Turns — `toolNames` trug **nie** eines von beiden, nur dreimal
`take_message`. Auch nicht, als die Gegenstelle woertlich „frag Antonio" und „ich moechte,
dass Du eine Internetrecherche machst" sagte. Drei von vier live geschalteten Faehigkeiten
tun damit nachweislich nichts. Die Ursache liegt nicht in der Klempnerei (die steht, AL-P16
belegt es) sondern am Tool-Entscheidungspunkt: die `take_message`-Beschreibung **wirbt heute
aktiv um genau diese Faelle** — sie nennt „nachschlagen" als *fehlende* Faehigkeit und
„Nachricht fuer den Besitzer" als Zweck, waehrend `look_up` und `get_consult` daneben
liegen und schweigen. Repo-Lehre `call-quality-chain`: Haiku braucht am Entscheidungspunkt
enge Verbote, keine wohlmeinenden Beschreibungen.

---

## 1. Bindende Entscheidungen

**B1 — Die Steuerung sitzt an der Tool-Description, nirgends sonst.** Kein Eingriff in den
Prompt-Rumpf, keine neue Mechanik, kein neues Flag, keine neue Env-Variable auf dem
Produktpfad. Das ist die im Repo belegte Wirkstelle (`src/claude.js:409-411`, `:425-428`,
`:439-442`, `:475-477`).

**B2 — Jede Klausel muss fail-safe sein, wenn das referenzierte Werkzeug fehlt.**
`take_message` wird **immer** angeboten; `get_consult` und `look_up` haengen an
Richtung (outbound), Flag, per-Tenant-Recht, Kontingent, Frische und Secret
(`src/consult/in-call.js:65-75`, `src/research/in-call.js:60-72`). Auf dem Inbound-Pfad ist
also **keines von beiden** je da. Eine Klausel wie „nimm dafuer `get_consult`" ohne
Ausstieg wuerde dort einen Agenten erzeugen, der nicht mehr puntet, sondern raet oder
etwas verspricht. **Jede verweisende Klausel traegt deshalb ihren Ausstiegssatz** („wird
dir das Werkzeug nicht angeboten, …") — dasselbe Muster, das `end_call` und `get_consult`
schon tragen.

**B3 — K4-Aufloesung: fuehrender Satz JA, Offenlegung der Suche NEIN.** Die
`look_up`-Beschreibung verlangt einen kurzen ueberbrueckenden Satz im **selben** Zug
(Muster: `takeMessageDescription`, „in dieselbe Antwort … nicht in eine spaetere"). Der
bestehende Riegel „Sage NIE, dass du nachschaust, und nenne NIE eine Quelle" **bleibt**.
Beides zusammen ist widerspruchsfrei: ein natuerlicher Ueberbrueckungssatz („Einen Moment
bitte.") verraet weder Suche noch Quelle. `src/thinking-signal.js` wird **nicht**
angefasst.

**B4 — Was offline pinnbar ist, ist der Vertrag; was die Wirkung belegt, ist der Bench.**
Ein `node:test` kann die Modellwahl prinzipiell nicht pruefen — die Tool-Wahl gibt im
Bestandsmuster (`test/al-p14-in-call-consult.test.js`) der Test selbst per Queue vor.
Offline gepinnt wird deshalb der **Wortlaut-Vertrag** (jede Regel hat ihre Klausel, in
allen drei Sprachen). Die **Verhaltensmessung** ist der Conversation-Bench. Der Bericht
haelt diese Trennung ausdruecklich auseinander und behauptet keinen Gewinn, den er nicht
gemessen hat.

**B5 — Der Bench kann D-3 heute nicht messen; das wird in dieser Phase behoben.**
`buildEnv` (`scripts/convo-bench/runner.mjs:61-71`) setzt `LOOKUP_ENABLED`,
`IN_CALL_CONSULT_ENABLED`, `CONSULT_ENABLED`, `EXA_API_KEY`, `EXA_API_BASE` **nicht** —
sie bleiben auf den Aus-Defaults aus `BASE_ENV` (`test/helpers.js:245-273`). Beide
Werkzeuge sind im Bench-Lauf **strukturell abwesend**, unabhaengig vom Szenario. Ohne
E4/E5 waere jede Bench-Zahl dieser Phase eine Messung an der falschen Konfiguration.

**B6 — Der Workflow fuehrt KEINEN Bench-Lauf aus.** Der Bench braucht Netz und einen
echten `ANTHROPIC_API_KEY` und kostet Geld je Lauf. Ein autonomer Self-Fix-Loop darf das
nicht ausloesen. Die Messung macht der Lead nach PASS, aus dem gemergten Stand.

**B7 — Reihenfolge der Commits ist Teil des Auftrags.** E4+E5 (Messapparat) gehen in
einen **eigenen, frueheren** Commit als E1–E3 (Produktaenderung). Nur so ist die
Vorher-Messung ueberhaupt erhebbar: derselbe Apparat, einmal gegen die alten und einmal
gegen die neuen Beschreibungen. Beide Commit-Hashes stehen im Bericht.

---

## 2. Die Aenderungen

Regeln, auf die sich E1–E3 beziehen (aus dem Auftrag):

- **R1** Entscheidung ausserhalb des Mandats („frag Antonio", „das muss dein Chef
  entscheiden") ⇒ `get_consult`, **nicht** `take_message`.
- **R2** Bitte um Nachschlagen, **die dem Auftrag dient** ⇒ `look_up`.
- **R3** Bitte eines Fremden um **beliebige** Recherche ⇒ **kein** `look_up`. Korrektes
  Verhalten, kein Bug.
- **R4** `look_up` nur mit kurzem fuehrendem Satz im selben Zug (K4).

### E1 — `takeMessageDescription`: aufhoeren, um fremde Faelle zu werben

Datei: `src/i18n/prompts/{de,en,fr}.js`, Feld `tools.takeMessageDescription`.

1. **Die Falschaussage entfernen.** Die Aufzaehlung fehlender Faehigkeiten nennt heute
   „nachschlagen" (`de.js:133-134`, `en.js:127-129`, `fr.js` analog). Solange `look_up`
   angeboten wird, ist das schlicht falsch und lenkt R2 aktiv auf `take_message`.
   „nachschlagen" faellt aus der Aufzaehlung; „weiterverbinden"/„spaeter zurueckrufen"
   bleiben (die fehlen wirklich).
2. **Ausschluss R1** mit Ausstieg: eine Entscheidung des Auftraggebers wird nicht als
   Nachricht weggelegt, **solange** `get_consult` angeboten wird; wird es nicht
   angeboten, bleibt die Nachricht der richtige Weg.
3. **Ausschluss R2** mit Ausstieg: eine auftragsdienliche Nachschlag-Bitte wird nicht als
   Nachricht weggelegt, **solange** `look_up` angeboten wird; sonst wie bisher.
4. **Unveraendert bleiben:** der Termin-/Gueltigkeits-Satz, „NICHT anstelle einer normalen
   Antwort", der Selbe-Zug-Satz (er ist per `AL-P4-9` gepinnt — der Substring
   `"in dieselbe Antwort"` / `"in the very same reply"` / `"dans la réponse MÊME"` **muss**
   erhalten bleiben), das Rueckruf-Verbot, das Buchungs-Verbot, der Mandats-Ausstieg.

### E2 — `getConsultDescription`: der positive Ausloeser fehlt heute ganz

Datei: `src/i18n/prompts/{de,en,fr}.js`, Feld `tools.getConsultDescription`.

Der Text beschreibt heute nur die **Bedingung** („wenn AUFTRAG und SPIELRAUM die Frage
nicht abdecken") und vier Verbote. Was fehlt, ist der **erkennbare Fall**: die Gegenstelle
verlangt ausdruecklich die Entscheidung des Auftraggebers. Ergaenzt wird genau das —
benannt als Fall, nicht als Bedingung, mit dem Gegensatzpaar zu `take_message` (R1).

**Unveraendert bleiben:** Paraphrase-Pflicht, Zitat-/Detailverbot, „Antwort ist NICHT
garantiert" samt Mandats-Fallback, der Ausstieg „deckt dein Auftrag die Frage ab,
entscheide selbst", das Kontingent „hoechstens EINMAL".

### E3 — `lookUpDescription`: Auftragsbindung, Negativfall, fuehrender Satz

Datei: `src/i18n/prompts/{de,en,fr}.js`, Feld `tools.lookUpDescription`.

1. **R2 schaerfen:** aus „bringt das Gespraech weiter" wird die Bindung an den **Auftrag**.
   Das ist die Trennlinie, an der R3 haengt.
2. **R3 als eigener, benannter Verbotsfall:** bittet die Gegenstelle um eine Recherche, die
   den Auftrag nicht betrifft, wird `look_up` **nicht** gerufen — freundlich ablehnen bzw.
   als Nachricht sichern. Ausdruecklich als richtiges Verhalten formuliert, damit es nicht
   als Unfaehigkeit klingt.
3. **R4/K4:** kurzer ueberbrueckender Satz im **selben** Zug, in dem `look_up` gerufen wird
   — nicht in einer spaeteren Antwort. Ohne Nennung von Suche oder Quelle (B3).

**Unveraendert bleiben:** die Themen-Aufzaehlung (oeffentlich bekannte Sachen), das
PII-/Zitat-Verbot, „Sage NIE, dass du nachschaust, und nenne NIE eine Quelle", das
Kontingent „hoechstens zweimal".

### E4 — Bench-Apparat: die drei Naehte, ohne die nichts messbar ist

Nur `scripts/convo-bench/**`. **Kein Byte auf dem Produktpfad**, keine Aenderung an
`BASE_ENV`, kein neuer Env-Key in `src/config.js`.

1. **Env-Naht pro Szenario.** `buildEnv` (`runner.mjs:61-71`) bekommt einen generischen
   Durchreicher fuer szenario-eigene Env (`scenario.env`). Heute existiert keiner; nur
   `assistantContextEnabled` praegt Env (`runner.mjs:66`).
2. **Such-Anbieter faelschen.** Ein lokaler HTTP-Server im Bench liefert einen festen
   Treffer; `EXA_API_BASE` des Kindprozesses zeigt darauf, `EXA_API_KEY` bekommt einen
   Dummy. Muster und Vorlage: `test/al-p10b-lookup.test.js:132-155`. **Keine echten
   Exa-Aufrufe** — weder Kosten noch Netzabhaengigkeit noch nichtdeterministische Treffer.
3. **Consult-Frische pumpen.** `get_consult` wird nur angeboten, solange ein Client pollt
   (`consultClientIsPolling`, `src/consult/in-call.js:72`). Der Bench pollt deshalb
   waehrend des Laufs `GET /api/calls/:id/consult` (`src/routes/api-calls.js:306`, setzt
   `consultPolledAtMs`) und beantwortet ein auftauchendes Consult ueber
   `POST /api/calls/:id/consult/answer` (`:331`) mit einer festen Antwort. Beide Routen
   liegen hinter der `/api/*`-Basic-Auth — die Zugangsdaten kommen aus derselben Quelle,
   aus der der Bench den Server schon startet, und werden **nicht** geloggt.

### E5 — Bench-Szenarien und -Checks: die vier Regeln als Messung

1. **Neue Checks in `scripts/convo-bench/checks.mjs`**, gespeist aus einem Signal, das
   heute schon anfaellt und von **keinem** Check gelesen wird: die `[metrics] turn`-Zeile
   traegt `tools` (die tatsaechlich gefeuerten Werkzeuge, `src/metrics.js:56-59`,
   `src/claude.js:1070-1075`), und `runResult.metricsParsed` enthaelt sie roh
   (`runner.mjs:269/285`). Gebraucht werden: „`get_consult` wurde gefeuert", „`look_up`
   wurde gefeuert", „`look_up` wurde **nicht** gefeuert" und — fuer R4 — „im Zug des
   `look_up` stand gesprochener Text" (aus `turn.sayTexts`, `runner.mjs:124-127`).
2. **Vier neue Szenarien**, je eines pro Regel, alle `direction: "outbound"`,
   `assistantContextEnabled: true`, mit der Env aus E4-1:
   - **R1** Gegenstelle verlangt ausdruecklich die Entscheidung des Auftraggebers
     ⇒ `get_consult` gefeuert, `take_message` **nicht**.
   - **R2** auftragsdienliche Nachschlag-Bitte ⇒ `look_up` gefeuert.
   - **R3** Fremder bittet um beliebige, auftragsfremde Recherche ⇒ `look_up`
     **nicht** gefeuert, Gespraech bleibt hoeflich und laeuft weiter.
   - **R4** wie R2, zusaetzlich: im `look_up`-Zug liegt gesprochener Text auf der Leitung.
     (Darf mit R2 ein Szenario teilen, wenn die Checks getrennt bleiben — dann ist es im
     Bericht als ein Szenario mit zwei Checks auszuweisen, nicht als zwei Belege.)
3. **Bestandsschutz.** `mandat-innerhalb` (`no_message_taken`) bekommt zusaetzlich „kein
   `get_consult`" — sonst wird der Check blind fuer die neue Ausweichform: ein Punten per
   Consult trotz Mandat laesst `actionItems` leer und faerbt den Bestandscheck faelschlich
   gruen (`checks.mjs:226-230`). `inbound-nachricht` ist der Inbound-Waechter zu B2 und
   bleibt unveraendert.

### E6 — Offline-Vertragstests (`test/al-d3-*.test.js`)

Test-IDs **`AL-D3-N`**. Das Praefix darf das i18n-Katalogmuster nicht treffen
(`package.json` `config.i18nCatalogPattern`) — `AL-` ist sicher; die Tests gehoeren in
`npm test`, nicht in `test:gates`.

1. **Je Regel ein Fall, je Sprache** (R1–R4 × de/en/fr): die zustaendige Description
   traegt die geforderte Klausel. Assertiert wird auf **Bedeutung tragende Substrings**,
   nicht auf ganze Saetze — ein Test, der den kompletten Wortlaut kopiert, ist keine
   Zusage, sondern eine Kopie.
2. **Der Negativfall R3 ist ein eigener Fall**, nicht ein Anhaengsel von R2.
3. **Sprach-Paritaet.** Heute existiert **kein** Test, der eine reine DE-Aenderung an den
   Tool-Descriptions rot faerbt (belegt: `test/p11-agent-language-contract.test.js:93-96`
   prueft je Sprache nur „String, nicht leer", und `getConsultDescription`/
   `lookUpDescription` stehen dort ueberhaupt nicht in der Feldliste). Genau die Falle,
   die der Auftrag benennt. Ein Paritaetstest schliesst sie: **alle vier**
   Tool-Descriptions existieren in allen drei Sprachen und tragen jede geforderte Klausel
   — faellt eine Sprache zurueck, ist er rot. Mutationsprobe verlangt.
4. **Apparat-Integritaet, offline pruefbar:** jedes Szenario in
   `scripts/convo-bench/scenarios/index.mjs` ist aufloesbar und jeder seiner
   `checks`-Eintraege existiert in der Check-Registry (Bestand: `test/al-p8-bench-checks.test.js`
   erweitern statt neu bauen). Das faengt ein kaputtes Szenario, ohne einen Bench-Lauf zu
   bezahlen.
5. **Kein Leck des Apparats in die Produktion:** `BASE_ENV` haelt `EXA_API_BASE` und
   `EXA_API_KEY` weiter leer und die drei Flags weiter auf `false` — ein Test pinnt das.

---

## 3. Nicht-Ziele (harte Grenze)

- **`src/thinking-signal.js` wird NICHT aufgeweicht.** Ein generischer Ersatzsatz waere der
  ersatzlos verworfene Weg B. Der Hebel gegen K4 ist die Tool-Beschreibung.
- **Die Streaming-Armierung aus AL-P17 bleibt eine ALLOWLIST** (`STREAM_SAFE_TOOL_NAMES`).
  Nicht angefasst, nicht in eine Denylist gedreht.
- **D-4 (Poll-Frische, `CONSULT_POLL_FRESH_MS`) ist NICHT Teil dieser Phase.** Belege, die
  unterwegs anfallen, gehoeren in den Bericht — nicht in einen Fix. Die Consult-Pumpe aus
  E4-3 ist Messapparat und **kein** Fix von D-4.
- **D-5 (STT) und D-6 (Eroeffnung)** brauchen zuerst eine Aufnahme. Nicht anfassen.
- **Kein Modellwechsel, kein Stack-Umbau, keine neue Faehigkeit**, kein neues Flag, keine
  neue Env-Variable auf dem Produktpfad, keine Aenderung an `src/claude.js`-Logik
  (Kommentare dort duerfen praezisiert werden, wenn sie durch E1–E3 unrichtig werden).
- **Keine Aenderung** an Safety-Gates, Offenlegung, Auth, Geldpfad, Kostenbuchung.
  Insbesondere bleiben Richtungs-Gate, Kontingente, Paraphrase-Zwang und Query-Filter
  (`research/lookup-guard.js`, `consult/question.js`) unberuehrt — der Prompt war nie die
  Durchsetzung und wird es auch jetzt nicht.
- **Keine echten Anrufe.** Alles offline bzw. gegen gefaelschte Anbieter.

---

## 4. Pre-Mortem — was in einem Jahr schiefgegangen sein koennte

| Szenario | Riegel in dieser Phase |
|---|---|
| **Inbound bricht.** `take_message` verweist auf `get_consult`/`look_up`, die inbound nie angeboten werden. Der Agent puntet nicht mehr, sondern raet oder verspricht etwas. | B2: jede verweisende Klausel traegt ihren Ausstieg. E6-1 pinnt den Ausstieg als eigenen Substring. `inbound-nachricht` bleibt als Bench-Waechter unveraendert. |
| **`get_consult` ueberfeuert.** Der Agent fragt bei allem zurueck; das Kontingent (1/Anruf) ist nach dem ersten Belanglosen weg, das Gespraech stockt. | E2 laesst den Mandats-Ausstieg woertlich stehen. E5-3: `mandat-innerhalb` bekommt „kein `get_consult`" — ohne das ist der Bestandscheck blind. |
| **`look_up` ueberfeuert.** Jede Kleinigkeit wird gesucht: Latenz, Stille, Kosten. | E3-1 bindet an den **Auftrag**, nicht ans Gespraech. R3-Szenario misst genau das. Kontingent 2/Anruf unangetastet. |
| **K4 bleibt trotzdem offen.** Das Modell haelt sich nicht an den fuehrenden Satz; der Anrufer hoert weiter die Suchdauer als tote Leitung. | Ehrlichkeit statt Behauptung: die Klausel ist eine Prompt-Massnahme **ohne** Durchsetzung. Der R4-Check misst es; bleibt er rot, steht das so im Bericht und K4 bleibt offen. |
| **Stille Sprachdivergenz.** Nur `de.js` geaendert, en/fr fallen zurueck. | E6-3, der heute fehlende Paritaetstest, mit Mutationsprobe. |
| **Beschreibungs-Bloat.** Die Descriptions wachsen; Haiku kippt in Ueberkorrektur — die dokumentierte Todesart am Entscheidungspunkt. | E1 **entfernt** mindestens so viel, wie E1–E3 hinzufuegen. §5-8: Zeichenzahl je Description und Sprache, vorher/nachher, im Bericht. Wachstum > 30 % braucht eine ausdrueckliche Begruendung. |
| **Der Messapparat leakt live.** Ein gefaelschtes `EXA_API_BASE` oder ein Flag landet in `.env`/`BASE_ENV`/`render.yaml`. | E4: Env nur im gespawnten Kindprozess, `scripts/`-only. E6-5 pinnt `BASE_ENV`. |
| **Die Messung gilt fuer eine Konfiguration, die es live nicht gibt** (gefaelschte Suche, gepumptes Consult, Persona statt Mensch). | Kalibrierungs-Reichweite: der Bericht nennt die Konfiguration, unter der gemessen wurde, und leitet daraus **keine** Live-Zusage ab. Live-Beleg erst nach Deploy durch den Owner. |
| **PASS ohne Inhalt.** Ein toter Impl-Agent hinterlaesst einen leeren Branch. | Lead prueft `git diff --stat master..<branch>` vor dem Merge; §5-9 verlangt die zwei Commit-Hashes. |

---

## 5. Abnahme (deterministisch, offline)

1. **`npm test` gruen** ueber den Vollbestand. Roter Lauf mitgeschnitten
   (`npm test > log 2>&1; grep "^not ok" log`) — keine verlorenen Testnamen.
2. **`npm run test:gates`** auf der dokumentierten Baseline (3 rot: GAP-05, GAP-15
   zweimal). Rot ist erlaubt, **mehr** Rot nicht.
3. **`node --check`** je geaenderter `.js`/`.mjs`-Datei.
4. **Neue Tests `AL-D3-*`**: R1, R2, R3 (Negativfall, eigener Fall), R4 — je Regel und je
   Sprache de/en/fr. Plus die Ausstiegssaetze aus B2.
5. **Paritaetstest** (E6-3) mit **Mutationsprobe**: eine Klausel nur in `de.js` aendern ⇒
   selektives Rot; Mutation zuruecknehmen ⇒ gruen. Ergebnis im Bericht.
6. **Mutationsprobe je Klausel** (R1–R4): Klausel entfernen ⇒ genau der zugehoerige Test
   rot, nicht die halbe Suite. Belegt, dass die Tests an der behaupteten Stelle haengen.
7. **Registry-/Apparat-Test** (E6-4) gruen: jedes Szenario aufloesbar, jeder Check bekannt.
8. **Zeichenzahl-Tabelle** je Description × Sprache, vorher/nachher, im Bericht.
9. **Commit-Trennung** nach B7: Hash des Apparat-Commits (E4+E5) und Hash des
   Produkt-Commits (E1–E3+E6) stehen im Bericht.
10. **Kein Bench-Lauf im Workflow** (B6). Der Bench wird vom Lead nach dem Merge gefahren,
    `--repeat 5`, gegen beide Commits aus Punkt 9, und die Zahlen kommen als Nachtrag in
    `tasks/al-d3-report.md`.

**Bericht:** `tasks/al-d3-report.md` — was geaendert wurde und warum je Klausel, die
Zeichenzahl-Tabelle, jede Mutationsprobe mit Ergebnis, die zwei Commit-Hashes, die
Konfiguration der spaeteren Messung, und was offen bleibt (K4-Wirkung, D-4).
