# E2: Tool-Metadaten - Nebenwirkungs-Kennzeichnung und Beschreibungen

Zweite Etappe der OpenAI-Sanierung. Sie schliesst den Blocker, den OpenAI woertlich als
haeufigen Ablehnungsgrund fuehrt: kein einziges Werkzeug sagt einem fremden Client, ob es liest
oder ob es einen echten Telefonanruf ausloest.

## Woher die Vorgabe stammt (in dieser Reihenfolge lesen)

1. `tasks/openai-fix/S1-tool-metadaten.md` - das vollstaendige Spec dieses Schnitts. Es enthaelt
   die Soll-Tabelle je Werkzeug (readOnlyHint / destructiveHint / openWorldHint / idempotentHint)
   und die zu korrigierenden Beschreibungstexte. Die Werte dort sind die Vorgabe - NICHT selbst
   neu herleiten.
2. Falls das Spec einen Abschnitt "## Pre-Mortem" traegt: seine Nachbesserungen gelten als Teil
   der Vorgabe, nicht als Anregung.
3. `tasks/openai-audit/03-tool-semantik-annotations.md` - die Herkunft der Soll-Werte (ist/soll je
   Werkzeug, am Code belegt). Nur bei Unklarheit nachschlagen.
4. `tasks/openai-audit/00-mcp-spec.md` - die exakten Feldnamen und Defaults der Annotations nach
   aktueller MCP-Spezifikation, samt dem Hinweis, welchen Vertrauensstatus die Spec ihnen gibt.
5. `PLAN-OPENAI.md`, Abschnitt "### Etappe 2" - dort steht die verbindliche Abnahme.

## Was gebaut wird

- `src/mcp-tools.js`: Annotations an allen 12 Registrierstellen; der lokale Registrier-Helfer
  wird so umgebaut, dass er sie durchlaesst. Drei Beschreibungstexte werden korrigiert.
- Eine neue Testdatei, die die Annotations je Werkzeug festhaelt, damit sie nicht wegdriften.
- Bestandstests anpassen, soweit sie auf der alten Registrierform oder den alten
  Beschreibungen aufsetzen.

## Abnahme (aus PLAN-OPENAI.md, Etappe 2)

- `tools/list` liefert fuer alle 12 Werkzeuge ein nicht-leeres `annotations`-Objekt mit exakt den
  Werten aus dem Spec.
- `grep -rn "readOnlyHint" src/` trifft alle 12 Werkzeuge.
- Die `place_call`-Beschreibung enthaelt "billed per minute" und "ALWAYS poll" und NICHT mehr
  "you do NOT need to poll".
- Die neue Annotations-Testdatei ist gruen.
- `npm test -- --test-concurrency=4` bleibt gruen.

## Harte Grenzen

- **Nur Metadaten und Beschreibungen.** Keine Aenderung an der Ausfuehrungslogik eines
  Werkzeugs, an den REST-Routen, an den Gates, am Store. Wer Verhalten aendert, hat den Auftrag
  verlassen: diese Etappe beschreibt, was die Werkzeuge TUN - sie aendert es nicht.
- **Die Annotations muessen die Wahrheit sagen, nicht das Bequeme.** Ein Werkzeug, das einen
  echten Anruf ausloest oder beendet, ist NICHT `readOnly` und NICHT `closed world`. Wenn die
  Soll-Tabelle des Specs an einer Stelle dem tatsaechlichen Code widerspricht, gilt der Code -
  dann den Widerspruch im Report benennen und die wahrheitsgemaesse Kennzeichnung setzen.
- Die bestehende Tauglichkeit fuer den heute verbundenen Claude-Client darf nicht kaputtgehen.
  Annotations sind additiv; Beschreibungen werden praeziser, nicht kuerzer.
- Kein Scope-Zuwachs: keine neuen Werkzeuge, keine entfernten Werkzeuge, keine Umbenennung,
  keine Schema-Aenderung an Eingabefeldern.
- Keine absolute Regel aus CLAUDE.md beruehren (Safety-Gates, Offenlegung, Auth fail-closed,
  Secrets). Wenn eine Beschreibungskorrektur eine dieser Regeln beruehrt, im Report melden.

## Konventionen

ESM, kein Build-Step. Kommentare auf Deutsch ohne Umlaute. Die Werkzeug-Beschreibungen selbst
sind Englisch (sie sprechen zum fremden Client) - das bleibt so. Neues Verhalten braucht einen
Test; hier ist der Test die Festschreibung der Metadaten.
