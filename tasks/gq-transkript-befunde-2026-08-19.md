# GQ-Befunde aus Testanruf call_mt0ddduxuzgl (2026-08-19, 17:32, 53 s)

Forensik-Quelle: Prod-DB (call + transcript_segment), Tenant t_user_01KX600834GCJFV9GTZQKWZMTH,
Profil: allowLookup=true, allowConsult=true, allowBooking=false. Engine: ElevenLabs-Outbound.
Beide In-Call-Werkzeuge (look_up, get_consult) waren VERFUEGBAR; consults und lookup_log sind LEER.

## Auftragsdaten (woertlich aus der DB)

- **goal**: "Ich wollte fragen, ob du morgen um 15 Uhr Zeit für eine Runde Tennis hast."
- **opening_line (gespeichert)**: "Ich wollte fragen, ob du morgen um 15 Uhr Zeit für eine Runde Tennis hast.." (Doppelpunkt!)
- **briefing** (vom auftraggebenden Claude via place_call geschrieben): "... Details zu Platz/Ort kenne
  ich nicht – falls danach gefragt wird, sagen, dass Antonio sich dazu noch direkt meldet."
- **constraints**: "... Gespräch kurz halten." (u.a.)

## Transkript (vollstaendig, 5 Turns)

> **Agent:** Guten Tag, hier spricht ein KI-Assistent im Auftrag von Antonio Fotiadis. Das Gespräch wird für meinen Auftraggeber zusammengefasst. Ich wollte fragen, ob du morgen um 15 Uhr Zeit für eine Runde Tennis hast.. Wie sieht es damit bei Ihnen aus?
> **Anrufer:** Ähm, wo soll denn morgen die Runde stattfinden?
> **Agent:** [freundlich] Den genauen Platz weiß ich noch nicht, Antonio meldet sich dazu direkt bei dir. Passt morgen um fünfzehn Uhr denn grundsätzlich bei dir?
> **Anrufer:** Ja, morgen passt. Kannst du mal im Internet was erscheinen, welche Tennisplätze es in Algarve gibt?
> **Agent:** Das ist ein guter Tipp, ich schaue mir das an. Das liegt außerhalb meiner Aufgabe hier, den Platz klärt Antonio direkt mit dir. Also, morgen um fünfzehn Uhr ist bestätigt – schönes Tennis morgen und einen schönen Tag noch!

(Das "[freundlich]" ist eine gesprochene Ton-Marke im Transkript - separater Bestandsbefund,
NICHT Teil dieser Kette.)

## Befund E (Eroeffnung, strukturell, aus diesem einen Anruf reproduzierbar)

Drei Defekte in einem Satz:
1. **Doppelpunkt**: opening_line endet auf "..", weil der Auftrag bereits einen Punkt traegt
   und die Erzeugung/Komposition einen weiteren anfuegt.
2. **Du/Sie-Bruch**: goal ist in Du-Form, die fest angehaengte Abschlussfrage
   (`openingQuestion`, src/i18n/locales.js:191 DE "Wie sieht es damit bei Ihnen aus?") ist
   Sie-Form und kann sich nicht anpassen.
3. **Doppelte Frage**: das goal ist bereits die vollstaendige Frage; die Vorlage haengt
   trotzdem die feste Frage an. Der Agenten-Prompt verlangt "at most one question per turn".

Wurzel: die Komposition `disclosure + OPENING_LINE_PLACEHOLDER + openingQuestion`
(src/elevenlabs/call-locale.js:76) nimmt an, die Eroeffnungszeile NENNT einen Grund
("Ich rufe an, um..."), waehrend die goal-Feldbeschreibung (src/mcp-tools.js:581) eine
sprechbare Ich-Form nahelegt, die haeufig schon eine Frage ist.

Relevante Dateien: src/elevenlabs/call-locale.js, src/i18n/locales.js (openingQuestion
DE/FR/EN, Zeilen ~191/343/454), src/elevenlabs/opening-line.js (Validierung: SENTENCE_END
verbietet "?", Kappe 120 Zeichen, Hash-Gegenprobe, Rueckfall-Treppe),
src/elevenlabs/opening-line-llm.js (Erzeugung), src/elevenlabs/outbound.js (dynamicVariables).

HARTE LEITPLANKEN: Der Offenlegungssatz bleibt fest verdrahtet allererster Satz (Absolute
Regel 2, CLAUDE.md). Die fail-closed-Treppe und die Hash-Gegenprobe in opening-line.js
duerfen nicht aufgeweicht werden. Gesprochene DE-Strings tragen Umlaute (Memory-Regel).

## Befund B (Briefing-Seite / place_call, systematisch)

1. **Vorwegnahme toetet den Consult-Kanal**: Der Agenten-Prompt
   (elevenlabs/agent_configs/outbound-agent.template.json) verbietet get_consult fuer alles,
   was bereits im Briefing steht. Der auftraggebende Claude schreibt bei Unbekanntem aber
   natuerlicherweise eine Vertroestung ins Briefing ("Antonio meldet sich") - damit ist die
   Live-Rueckfrage (get_consult -> await_call_event/answer_consult beim auftraggebenden
   Claude) systematisch abgeschaltet. Die briefing-Feldbeschreibung (src/mcp-tools.js:583)
   erwaehnt den Rueckfrage-Kanal mit keinem Wort.
2. **Vertroestung widerspricht dem Agenten-Prompt**: "NEVER offer the owner as another way
   to get that answer" - das Briefing hat den Prompt ueberstimmt.
3. **Tempo bis zum Anruf**: Owner-Beobachtung: ~1 Minute von der Bitte im Chat bis zum
   place_call, inkl. einer Rueckfrage vorab. Die Feldbeschreibungen enthalten mehrere
   "Ask the user FIRST"-Anweisungen (goal bei vagem Thema, mandate.decide_freely). Ziel:
   Claude kommt schneller und mit weniger Rueckfragen zum Anruf, OHNE dass Briefings vage
   werden - der Trade-off ist explizit abzuwaegen (eine gute Rueckfrage ist besser als ein
   vager Auftrag; drei Rueckfragen fuer einen Kumpel-Anruf sind zu viel).

Hebel, die uns gehoeren (alles im Repo): die place_call-Feldbeschreibungen in
src/mcp-tools.js (goal/briefing/constraints/mandate/context), die MCP-Server-Instructions
(String im Server, der den await_call_event-Loop vorschreibt), ggf. Tool-Result-Texte.
NICHT unser Hebel: das Verhalten von claude.ai selbst.

## Owner-Ziele (2026-08-19)

- Track E zuerst (kleiner Fix), dann Track B.
- Track B: Claude soll schneller/effizienter zum Anruf kommen UND weiterhin gute Briefings
  mit genug Infos liefern; Unbekanntes soll offen bleiben und ueber den Consult-Kanal laufen
  statt vorab vertroestet zu werden.
- Nur Aenderungen, die OHNE weitere Testanrufe belegt werden koennen (Tests/Statik).
  Was einen echten Anruf braucht, als offener Folgepunkt notieren, nicht bauen.
- Die Formulierungsschwaeche des Agenten beim Ablehnen ("guter Tipp, ich schaue mir das an")
  ist AUSSERHALB dieses Auftrags - erst Muster ueber weitere Testanrufe sammeln.
