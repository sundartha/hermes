# Abnahmekatalog Werkzeugwahl

Aufgestellt **vor** dem Vorliegen der Nachher-Zahlen (2026-08-11), damit die Latte nicht
nachtraeglich an das Ergebnis angepasst wird. Jedes Kriterium nennt erwartetes Ergebnis und
Verifikationsmethode (Workflow-Regel 7).

Ein Kriterium ist **erfuellt**, **nicht erfuellt** oder **nicht belegbar**. "Nicht belegbar" ist
ein legitimes und wichtiges Ergebnis — es ist NICHT dasselbe wie erfuellt.

---

## A — Der Blindgaenger ist entschaerft (Vorbedingung fuer alles mit `look_up`)

| | |
|---|---|
| **Erwartet** | Ein aus SSE-Fragmenten rekonstruierter Werkzeugaufruf ueberlebt eine zweite Runde ueber den Draht, ohne HTTP 400. |
| **Verifikation** | `node --test test/b5-deepseek-adapter.test.js` — B5-17 gruen. Rotprobe: Fix zurueckdrehen, B5-17 muss rot sein. |
| **Stand** | **ERFUELLT.** 17/17 gruen, selbst nachgefahren. Rotprobe logisch zwingend: `expectedToolCall` enthaelt `type`, `deepEqual` kann ohne den Fix nicht bestehen. Destruktive Gegenprobe steht aus, bis der Workflow den Arbeitsbaum freigibt. |

## B — Die Messkette misst, was sie behauptet

| | |
|---|---|
| **Erwartet** | Ein Bench-Lauf mit DeepSeek weist `deepseek-v4-pro` als real benutztes Agent-Modell aus; die Gegenprobe mit Anthropic weist `claude-haiku-4-5` aus. Zwei LAUFENDE Faelle, kein blosser Abbruch. |
| **Verifikation** | Modellfeld im Report-JSON beider Laeufe. |
| **Warum hart** | Ohne das ist jede DeepSeek-Zahl in Wahrheit eine Anthropic-Zahl — der Bestandsdefekt, der die letzte Messreihe wertlos gemacht hat. |

## C — Die Vorher-Messung reproduziert den Defekt

| | |
|---|---|
| **Erwartet** | Im IMPLIZIT-Szenario feuert `get_consult` nahe 0 bei gueltigem Nenner, waehrend das Werkzeug nachweislich angeboten war. |
| **Verifikation** | `offeredToolNames` je Tool-Loop-Runde als Positiv-Kontrolle; Nenner zaehlt nur Laeufe mit `turns > 0`. |
| **Warum hart** | Ein Szenario, das heute schon gruen ist, kann keinen kuenftigen Fix belegen. Reproduziert die Vorher-Messung den Defekt nicht, ist die Nachher-Messung wertlos — dann ist das Ergebnis **nicht belegbar**, egal wie gut die Zahlen aussehen. |

## D — Der Fix wirkt, wo der Defekt sass

| | |
|---|---|
| **Erwartet** | `get_consult` steigt im IMPLIZIT-Szenario gegenueber der Vorher-Messung messbar an, bei identischer Konfiguration (Commit, Treiber, Anbieter, Modell, Flags, Profilrechte). |
| **Verifikation** | Vorher/Nachher nebeneinander, beide mit Nenner. Weicht die Konfiguration ab, ist der Vergleich ungueltig. |

## E — Kein Tausch eines Defekts gegen den anderen (Veto-Kriterium)

| | |
|---|---|
| **Erwartet** | In den Szenarien, in denen `get_consult` korrekt NICHT feuern soll, feuert es weiterhin nicht. Und `take_message` feuert nicht laenger zusaetzlich (`no_message_taken`). |
| **Verifikation** | Dieselben Laeufe, die Nicht-Feuer-Szenarien ausdruecklich mit ausgewertet. |
| **Warum Veto** | Ein Agent, der bei jeder Kleinigkeit rueckfragt, ist wertloser als einer, der zu selten fragt — er braucht den Menschen in jedem Gespraech. Scheitert E, ist die Phase NICHT abgenommen, auch wenn D glaenzt. |

## F — Der Prompt luegt nicht ueber fehlende Werkzeuge

| | |
|---|---|
| **Erwartet** | Ist `get_consult` NICHT angeboten (Kontingent erschoepft, Poll nicht frisch, Recht fehlt), steht der bisherige Wortlaut unveraendert im Prompt. |
| **Verifikation** | Prompt-Renderer-Test, beide Richtungen gepinnt. |
| **Warum hart** | Ein Prompt, der auf ein fehlendes Werkzeug verweist, ist schlimmer als der heutige Zustand. Das Werkzeug verschwindet real mitten im Gespraech (`consultPollFresh:false`, Live-Turn 3). |

## G — Nichts Bestehendes ist kaputt

| | |
|---|---|
| **Erwartet** | `npm test` vollstaendig gruen; `test/b3-wire-golden-master.test.js` unveraendert und gruen; kein Sicherheits-Gate beruehrt; Offenlegungssatz unveraendert. |
| **Verifikation** | Voller Lauf, selbst gefahren — nicht die Behauptung des Umsetzers. `git diff master...HEAD` auf Gate-Dateien durchsehen. |

## H — `look_up` ist im echten Anruf angeboten

| | |
|---|---|
| **Erwartet** | `offeredToolNames` eines echten Outbound-Anrufs enthaelt `look_up`; der `noLookup`-Block ("Du kannst nichts nachschlagen") rendert nicht mehr. |
| **Verifikation** | Render-Log des Anrufs, `[telnyx-shim] turn_ok`-Zeile. |
| **Vorbedingung** | A erfuellt, P6 umgesetzt, deployt. |

---

## Was autonom NICHT beweisbar ist — ehrliche Grenze

Diese Punkte kann ich vorbereiten, aber nicht allein abschliessen. Sie werden im Abschlussbericht
ausdruecklich als **offen** ausgewiesen, nicht stillschweigend als erledigt behandelt:

1. **Der Deploy.** Live faehrt der Render-Dienst; ein Merge auf `master` macht nichts live.
2. **Der echte Anruf.** Der Bench ist ein Stellvertreter, kein Beweis. Er faehrt denselben
   Server- und Prompt-Pfad, aber mit einer Persona statt eines Menschen und ohne Telefonie,
   STT/TTS und Barge-in. Kriterium H braucht zwingend einen echten Anruf.
3. **Die Datenschutzfrage** zu `look_up` traegt der Owner (Entscheidung 2026-08-11).

**Ein bestandener Workflow ist keine Abnahme.** Abgenommen ist, was gegen diesen Katalog
gemessen wurde.
