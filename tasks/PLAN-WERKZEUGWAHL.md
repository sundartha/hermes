# PLAN-WERKZEUGWAHL — warum der Agent `look_up` und `get_consult` nicht ruft

Stand: 2026-08-11. Grundlage: fuenf parallele Diagnose-Spuren, Befunde in
`tasks/befund-toolwahl-1-draht.md` .. `-5-bench.md`.
Ausloeser: echter Anruf `call_msor2k4pefds` (11.08., 14:22 UTC, 70,5 s, 7 Turns), live auf
`deepseek-v4-pro`.

---

## 1. Der Kernbefund: EIN Label, ZWEI Defekte

Die Beobachtung "der Agent ruft `look_up` und `get_consult` nicht" ist **ein Symptom mit zwei
voneinander unabhaengigen Wurzeln**. Sie liefen bisher unter einem Label — die wiederkehrende
Falle dieses Projekts (vgl. 91-s-Kappung vs. Dead-Air).

| | `look_up` | `get_consult` |
|---|---|---|
| Im angebotenen Satz? | **NIE** (tagesweit 0 Treffer) | **JA**, 4 von 5 beantworteten Turns |
| Gefeuert? | konnte nicht | **0-mal** |
| Wurzel | Konfiguration | Modellwahl |
| Modell hatte die Wahl? | nein | ja |

Daraus folgt die wichtigste Konsequenz fuer die Arbeit: **`look_up` ist ein Freischalt-Vorgang,
`get_consult` ist ein Verhaltensproblem.** Wer beides zusammen "fixt", belegt am Ende keines von
beidem.

---

## 2. Die fuenf Wurzeln, mit Belegstatus

### W1 — `look_up` ist per Tenant-Profilrecht gesperrt (BELEGT)

Die globalen Schalter sind live alle AN (Boot-Banner Deploy `a3e3ee5`): `LOOKUP_ENABLED=true`,
`EXA_API_KEY` gesetzt, `ASSISTANT_CONTEXT_ENABLED=true`, `CONSULT_ENABLED=true`. Der Blocker
liegt im Plan-Profil des anrufenden Tenants: `PAID_PLAN_PROFILE` traegt `allowLookup:false`
(`src/plans.js:105`), bewusst gesperrt mit dem Vermerk "bleibt Owner-Faehigkeit, bis Testanruf +
Datenschutzerklaerung durch sind". Der Anruf lief nicht unter dem Bootstrap-/Owner-Tenant, wo
das Recht hart auf `true` gepinnt ist.

**`RESEARCH_ENABLED=false` ist NICHT die Ursache** — getrennte Flags, getrennte Config-Felder,
getrennte Registry-Zeilen (`src/config.js:493` vs. `:518`; `src/research/registry.js:40` vs.
`:54`). Diese Verwechslung ist naheliegend und wird hier ausdruecklich ausgeschlossen.

### W2 — Der System-Prompt leitet den Rueckfrage-Fall dreimal unbedingt auf `take_message` (BELEGT als Text, Kausalitaet UNBELEGT)

Im gerenderten System-Prompt kommt `take_message` **1x** woertlich vor, `get_consult` **0x** —
in allen fuenf gerenderten Faellen. Fuer das Modell existiert die Rueckfrage nur als
Array-Eintrag, waehrend drei Bloecke den Consult-Fall woertlich zur Nachricht schicken:

1. **`outOfScopeSentence`** (Position 81 %, letzte konkrete Ausweg-Anweisung): "AUSSERHALB
   DEINES SPIELRAUMS: ... gib es ueber take_message weiter und sag zu, dass Antonio sich
   meldet." Rendert bei **jedem** Mandat unbedingt (`claude.js:213-220`), auch ohne gesetztes
   `on_out_of_scope`.
2. **GRENZEN** (`claude.js:181`, jeder Turn): "Fehlt dir eine Angabe ueber Antonio oder dessen
   Sachen, fragst du NIEMALS dein Gegenueber danach ... Du klaerst das auf deiner Seite oder
   nimmst das Anliegen als Nachricht auf."
3. **`noLookup`** (live-only, weil W1): "Du kannst nichts nachschlagen, nichts recherchieren und
   niemanden weiterverbinden. Wird das verlangt, ... nimmst das Anliegen als Nachricht auf."

Dazu die Beschreibungs-Ueberlappung: `take_message` oeffnet bei 8 % mit "Nutze das, wenn du eine
Frage nicht beantworten kannst..." — **vor** jeder Abgrenzung (die erst bei 76-89 % kommt) — und
der Schlusssatz bei 92 % oeffnet wieder: "Fehlt dir das passende Werkzeug in diesem Zug, bleibt
die Nachricht der richtige Weg." Live ist dieser Satz halb wahr, denn er nennt `look_up`, das
gar nicht angeboten ist. Reihenfolge im Array: `take_message` steht **vor** `get_consult`
(`claude.js:507-517`).

**Korrektur einer frueheren Projektannahme.** In den Notizen stand "der Systemprompt ist NICHT
die Ursache". Das war zu frueh geschlossen. Die zwei gescheiterten Anlaeufe haben
**Werkzeug-Beschreibungen** umformuliert, nie die **Routing-Saetze im Prompt**. Ein Eingriff
dort ist deshalb keine dritte Formulierungsrunde, sondern der erste Eingriff an der Stelle, auf
die die Diagnose zeigt.

### W3 — Die Entscheidungsschwelle: implizite Entscheidungslagen loest das Modell selbst (BELEGT, live gemessen)

A/B im Draht-Befund, n=5 je Arm, byte-identische Anfragen bis auf den Nutzer-Satz:

- **EXPLIZIT** (Gegenstelle fordert die Entscheidung des Auftraggebers ausdruecklich):
  `get_consult` feuert **5/5**.
- **IMPLIZIT** (Entscheidungslage besteht, wird aber nicht ausgesprochen): **0/5**. Das Modell
  antwortet selbst — und sagt verbindlich zu: *"Donnerstag um siebzehn Uhr passt gut - den nehme
  ich gerne."*

Das reproduziert den Live-Anruf. Und es ist der schaerfere Befund: nicht "das Werkzeug wird
uebersehen", sondern "das Modell haelt sich fuer entscheidungsbefugt".

### W4 — Blindgaenger: rekonstruierte `tool_calls` tragen kein `type:"function"` (BELEGT, live isoliert)

`deepseek.js:313` liest `fragment.type` nie; aus dem SSE-Strom zusammengesetzte Werkzeugaufrufe
gehen ohne `type` in die naechste Runde. Drei-Arm-Isolation am echten Anbieter: Runde 2
nonstream OK, **stream HTTP 400 "messages[3]: missing field `type`"**, stream mit nachgeruestetem
`type` OK.

Trifft nur den Stream-/Shim-Pfad und nur Werkzeuge mit **zweiter Runde**: `get_consult` bricht
vorher ab (`claude.js:1048-1062`), `look_up` nicht. **Es schlaeft heute einzig deshalb, weil
`allowLookup:false` ist.** Der Bestandstest faengt es nicht — `test/b5-deepseek-adapter.test.js:196-218`
baut den Aufruf von Hand, statt ihn zu rekonstruieren.

> **Das ist die Reihenfolge-Bedingung des ganzen Plans:** wer W1 freischaltet, ohne W4 vorher zu
> beheben, schickt `look_up` live in einen HTTP 400.

### W5 — `get_consult`-Verfuegbarkeit flackert (BELEGT, Ursache UNBELEGT)

In turnSeq 3 des Live-Anrufs fehlte `get_consult` im angebotenen Satz, Grund
`consultPollFresh:false` (`src/consult/in-call.js:62-64`). Das Werkzeug haengt an einem frischen
MCP-Client-Poll; bleibt der aus, verschwindet die Rueckfrage mitten im Gespraech. Der
Werkzeugsatz wird in **jeder** Tool-Loop-Runde neu gebaut (`claude.js:988`, bis 4 Runden/Turn),
nicht einmal pro Turn.

### W6 — Die Messkette erreicht die Live-Konfiguration nicht (BELEGT, empirisch)

`scripts/convo-bench/runner.mjs#buildEnv` pinnt `CLAUDE_MODEL="claude-haiku-4-5"` hart;
`test/helpers.js#BASE_ENV` pinnt `LLM_PROVIDER="anthropic"` und `DEEPSEEK_API_KEY=""`. Kein
CLI-Flag, kein Szenario setzt das um; Shell und `.env` erreichen den Spawn-Kindprozess nicht (nur
`PATH` wird durchgereicht). **Empirisch bewiesen:** ein Minimallauf lief real gegen Anthropic
(0,051 USD), obwohl `LLM_PROVIDER=deepseek` in der Shell stand.

Was die Kette schon kann: die Positiv-Kontrolle steht (`offeredToolNames` je Runde belegbar ueber
die unconditional `[telnyx-shim] turn_ok`-Zeile), und der Defekt **reproduziert sich** — unter
Haiku feuert `get_consult`, aber `take_message` feuert zusaetzlich, `no_message_taken` scheitert.

---

## 3. Was ausdruecklich WIDERLEGT ist

Diese Kandidaten sind gemessen und tot. Sie duerfen nicht noch einmal aufgemacht werden, ohne
neue Evidenz:

- **Der Draht kuerzt oder verliert Werkzeuge.** `deepseek.js:231-240` mappt vollstaendig,
  Beschreibung byte-genau (823 Zeichen), Schema komplett, Reihenfolge erhalten.
- **`thinking:{"type":"disabled"}` unterdrueckt die Werkzeugwahl.** A/B n=5: Thinking AN ist
  strikt schlechter (p50 5062 ms gegen 3500-ms-Deckel, Fehlschlaege auf `finish_reason:"length"`,
  weil 1000+ Zeichen `reasoning_content` die `max_tokens:300` auffressen). Im IMPLIZIT-Fall 0/5
  in beiden Armen.
- **Timeouts/Retries/Breaker verschlucken Aufrufe.** Live: alle `[metrics] llm`-Zeilen
  `outcome=success, attempts=1, breakerState=closed`, tagesweit 0 Fehler. Probe n=10: 10/10
  gefeuert, p50 1795 ms, max 2547 ms.
- **`RESEARCH_ENABLED=false` schaltet `look_up` mit ab.** Getrennte Flags (s. W1).
- **Das Angebot ist strukturell nicht rufbar.** `tool_choice:"required"` feuert `get_consult`
  5/5 und `look_up` 3/3 — der Positiv-Beleg, den kein Negativtest liefern kann.

---

## 4. Phasen

Reihenfolge ist nicht kosmetisch: P1 muss vor jeder `look_up`-Freischaltung liegen (W4), und P2
muss vor jedem Verhaltens-Eingriff liegen, sonst belegt der Nachher-Wert nichts.

### P0 — Messkette erreicht die Live-Konfiguration

`LLM_PROVIDER`, `CLAUDE_MODEL` und `DEEPSEEK_API_KEY` muessen den Bench-Kindprozess erreichen;
zusaetzlich muss ein Szenario Tenant-Profilrechte (`allowLookup`, `allowConsult`) setzen koennen.

- **Erwartetes Ergebnis:** ein Bench-Lauf mit `--provider deepseek` protokolliert im Report
  nachweislich `deepseek-v4-pro` als real benutztes Agent-Modell, und die Boot-Zeile des
  Kindprozesses belegt `LLM_PROVIDER=deepseek`.
- **Verifikation:** Minimallauf n=1, Report-JSON auf das Modellfeld pruefen; Gegenprobe mit
  `--provider anthropic` muss `claude-haiku-4-5` zeigen. Zwei laufende Faelle, nicht nur ein
  Abbruch — ein fail-closed-Boot allein beweist nur, dass nie etwas startet.

### P1 — Blindgaenger W4 schliessen

`type:"function"` an rekonstruierten `tool_calls` ergaenzen; Regressionstest ueber den
**rekonstruierten** Pfad (SSE-Fragmente), nicht ueber einen handgebauten Aufruf.

- **Erwartetes Ergebnis:** ein zweirundiger Werkzeug-Aufruf im Stream-Pfad laeuft ohne HTTP 400
  durch.
- **Verifikation:** neuer Test, der ohne den Fix rot ist (Rotprobe zwingend vorfuehren) und mit
  ihm gruen; `npm test` vollstaendig gruen.
- **Sicherheit:** beruehrt den LLM-Draht, nicht die Gates. Kein Gate-Bezug.

### P2 — Vorher-Messung auf DeepSeek

Die drei d3-Szenarien plus je eine EXPLIZIT- und IMPLIZIT-Variante des Consult-Falls, n>=5, auf
`deepseek-v4-pro`.

- **Erwartetes Ergebnis:** eine Tabelle mit **gueltigem Nenner** (nur Laeufe mit `turns > 0`) je
  Szenario: wie oft `get_consult`, wie oft `take_message`, welche Checks scheitern.
- **Verifikation:** Positiv-Kontrolle vorweg — `offeredToolNames` je Tool-Loop-Runde belegt, dass
  das Werkzeug im Satz stand. Ohne diesen Beleg ist "feuert nicht" keine Aussage.
- **Falle, benannt:** ein Lauf mit `turns: 0` meldet trotzdem "checks 10/10 = 100 %".

### P3 — W2 beheben: die Prompt-Asymmetrie

Den Rueckfrage-Weg im System-Prompt ueberhaupt benennen, und die drei unbedingten
`take_message`-Routings bedingt machen, solange `get_consult` im Satz steht. Die
Beschreibungs-Ueberlappung (`take_message` S2 bei 8 %, Schlusssatz bei 92 %) mit aufloesen.

- **Erwartetes Ergebnis:** im gerenderten Prompt kommt `get_consult` mindestens einmal woertlich
  als Weg vor, wenn es angeboten ist; `outOfScopeSentence`/GRENZEN nennen dann nicht mehr
  ausschliesslich die Nachricht.
- **Verifikation:** Prompt-Renderer-Test ueber die fuenf Faelle aus
  `tasks/befund-toolwahl-3-prompt-dump.txt`; danach P4.
- **Randbedingung:** wenn `get_consult` NICHT angeboten ist (Kontingent erschoepft, Poll alt),
  muss der alte Wortlaut stehen bleiben — sonst verweist der Prompt auf ein Werkzeug, das fehlt.

### P4 — W3 beheben: die Entscheidungsschwelle

Der Agent darf in fremder Sache nicht verbindlich zusagen. Die implizite Entscheidungslage muss
als Consult-Fall erkennbar werden.

- **Erwartetes Ergebnis:** im IMPLIZIT-Szenario steigt `get_consult` von 0/5 messbar an, **ohne**
  dass `take_message` zusaetzlich feuert (`no_message_taken` bleibt gruen).
- **Verifikation:** Nachher-Messung gegen P2, gleiche Konfiguration, gleicher Treiber, gleicher
  Nenner. Eine Messung gilt nur fuer ihre Konfiguration.
- **Pre-Mortem:** die Gegenrichtung ist ein Agent, der bei **jeder** Kleinigkeit rueckfragt. Der
  Nachher-Lauf muss deshalb auch die Szenarien pruefen, in denen `get_consult` korrekt NICHT
  feuern soll — sonst tauscht P4 einen Defekt gegen den anderen.

### P5 — W5: das Verfuegbarkeits-Flackern

`consultPollFresh:false` nimmt das Werkzeug mitten im Gespraech aus dem Satz.

- **Erwartetes Ergebnis:** entweder ist das Flackern beseitigt, oder es ist als bewusst
  akzeptiert dokumentiert, mit Begruendung.
- Diese Phase ist die einzige, die auch ohne Fix abschliessbar ist — als benannte Entscheidung.

### P6 — OWNER-ENTSCHEIDUNG: `allowLookup` freischalten

**Nicht autonom.** Die Sperre traegt den Vermerk "bis Testanruf + Datenschutzerklaerung durch
sind"; die Datenschutzerklaerung ist an anderer Stelle als offener Punkt gefuehrt. Das ist eine
Rechts- und Produktentscheidung, keine technische.

- **Harte Vorbedingung:** P1 ist gemergt. Sonst laeuft `look_up` live in HTTP 400.
- **Erwartetes Ergebnis nach Freigabe:** `look_up` steht im angebotenen Satz eines echten
  Outbound-Anrufs, und der `noLookup`-Block ("Du kannst nichts nachschlagen") rendert nicht mehr
  — was zugleich W2 entlastet.

---

## 5. Pre-Mortem

Ein Jahr weiter, die Sache ist gescheitert. Was ist passiert?

1. **`allowLookup` wurde freigeschaltet, bevor P1 gemergt war.** Jeder Anruf mit Nachschlag
   bricht in Runde 2 mit HTTP 400 ab; der Anrufer hoert Stille. Der Defekt sah aus wie ein
   Modellproblem und wurde wochenlang im Prompt gesucht. — *Gegenmittel: P1 ist harte
   Vorbedingung von P6, im Plan an beiden Stellen notiert.*
2. **P3/P4 wurden ohne P0/P2 gebaut.** Der Nachher-Lauf lief gegen Anthropic, die Zahl wurde als
   DeepSeek-Beleg gelesen, der Fix galt als bewiesen und war es nicht. — *Gegenmittel: P0 vor
   allem, Modellfeld im Report pflicht.*
3. **P4 hat ueberkorrigiert.** Der Agent fragt jetzt bei jeder Kleinigkeit zurueck, jedes
   Gespraech braucht den Menschen, das Produktversprechen ist tot. — *Gegenmittel: der
   Nachher-Lauf prueft ausdruecklich die Nicht-Feuer-Szenarien mit.*
4. **Prompt-Runde drei.** Es wurde wieder nur an Beschreibungen geschraubt, ohne die
   Routing-Saetze, und wieder ohne Wirkung. — *Gegenmittel: W2 benennt die konkreten Fundstellen;
   P3 ist an ihnen zu messen, nicht an "besseren Formulierungen".*
5. **Beide Defekte liefen wieder unter einem Label.** "Werkzeuge gehen nicht" wurde als eine
   Aufgabe gefuehrt, der Freischalt-Handgriff verdeckte das Verhaltensproblem. — *Gegenmittel:
   Abschnitt 1 trennt sie; getrennte Phasen, getrennte Belege.*

---

## 6. Was dieser Plan NICHT anfasst

Keine Sicherheits-Gates. Keine Kostendecke, kein `OUTBOUND_FROZEN`, keine Signaturpruefung, keine
Auth-Route. Der Offenlegungssatz bleibt unberuehrt. P6 ist die einzige Phase mit Rechtsbezug und
ausdruecklich der Owner-Entscheidung vorbehalten.
