# B3b — Anfrageseite der LLM-Werkzeug-Schleife neutralisieren

Spezifikation, Stand 2026-08-09. Basis: `master` = `4aea823`.
Vorgaenger: B2 (Vertrag `src/llm/ports.js`, gemergt `50ba426`), B3a (Antwortseite, gemergt
`a8a8733`, seit 2026-08-09 LIVE), B4a (Preisstaffel, gemergt `1edf66c`, LIVE).

## 1. Ziel in einem Satz

Den letzten anbieter-spezifischen Rest aus dem **Fachcode** in den **Adapter** ziehen, damit
ein zweiter LLM-Anbieter (B5) angebunden werden kann, **ohne** `claude.js`,
`precall-briefing.js` oder `bridge.js` anzufassen.

## 2. Warum das der eigentliche Zweck von Track B ist

Der Owner-Ausloeser fuer diese Kette war: *"eigentlich wollte ich gucken, Sonnet und andere
Modelle wechseln, und das Problem war, dass die einzelnen Modelle total im Code eingebunden
waren"*. B3a hat die Antwortseite geloest. **B3b ist die zweite Haelfte derselben Naht.**
Ohne sie bleibt der Anbieterwechsel unmoeglich, auch wenn alles andere fertig ist.

Abgrenzung, damit die Erwartung stimmt: **Modellwechsel INNERHALB Anthropics geht heute
schon** (`CLAUDE_MODEL` / `PRECALL_BRIEFING_MODEL` in der Env, abgesichert durch den
B4a-Boot-Abbruch). B3b loest den **Anbieter**-Wechsel.

## 3. Scope — exakt K14 bis K19 der Grenztabelle

Autoritative Quelle: `tasks/b3a-report.md`, Abschnitt "Grenztabelle B3a/B3b (aus dem Plan,
vollstaendig)". Diese Spec wiederholt sie nur, sie ersetzt sie nicht.

**ACHTUNG Zeilennummern:** die Nummern in der Grenztabelle sind der Stand VOR dem
B3a-Merge und haben sich verschoben. **Per `grep` verifizieren, nie blind anspringen.**
Die ANZAHLEN unten sind am 2026-08-09 auf `4aea823` frisch nachgemessen.

| # | Marker | Datei | gemessen | Zielform |
|---|---|---|---|---|
| K14 | `input_schema` in Werkzeug-Definitionen | `claude.js` | **4x** | `parameters` (neutral) |
| K14 | `input_schema` | `precall-briefing.js` | **1x** | dito |
| K14/K22 | `input_schema`, `tool_choice` | `bridge.js` (`realtimeTools`) | **2x + 1x** | **PFLICHT-NACHZUG** |
| K15 | `cache_control`, `CACHE_CONTROL_EPHEMERAL`, `toolsWithCacheControl` | `claude.js` | **6x** | `LlmRequest.cachePrefix` |
| K16 | `max_tokens` | `claude.js` | **2x** | `maxTokens` |
| K16 | `max_tokens` | `precall-briefing.js` | **1x** | `maxTokens` |
| K17 | `tool_choice` | `precall-briefing.js` | **6x** | `toolChoice` (DREIWERTIG) |
| K18 | `system` als Blockliste vs. String | `claude.js` **2x**, `precall-briefing.js` | — | neutrale Form; haengt an K15 |
| K19 | Verlauf `{role, content:<String>}` | `claude.js` | — | **BLEIBT unveraendert** |

Gesamtzahl anbieter-spezifischer Treffer ausserhalb des Adapters (Messkommando unten):
`claude.js` 18, `precall-briefing.js` 15, `bridge.js` 3, `llm.js` 6, `llm-usage.js` 2.
Die Zahlen fuer `llm.js`/`llm-usage.js` enthalten legitime Rest-Treffer (Wort "Anthropic" in
Kommentaren, Metrik-Schluesselnamen aus E7) — **nicht blind auf 0 optimieren.**

Messkommando (Vorher/Nachher im Report belegen):
```
for f in src/claude.js src/precall-briefing.js src/bridge.js; do
  echo "$f"; for m in input_schema cache_control max_tokens tool_choice; do
    printf '  %s: %s\n' "$m" "$(grep -c "$m" "$f")"; done; done
```

## 4. Bindende Vorgaben — nicht neu aufrollen

1. **`toolChoice` ist DREIWERTIG**: `auto` / `required` / **benanntes Werkzeug**. Bindend aus
   B2. `precall-briefing.js` (`briefingTooling`) nutzt **live** einen namentlich erzwungenen
   Zwang. Ein zweiwertiger Vertrag bricht das Precall-Briefing im Outbound-Pfad.
   **Belegt am fremden Anbieter:** der B3-Spike hat am 2026-08-09 gemessen, dass
   `deepseek-v4-pro` im Thinking-Mode `tool_choice:"required"` UND die benannte Form mit
   **HTTP 400** ablehnt. Das ist ein **B5-Problem des Adapters**, KEIN Grund, den Vertrag hier
   zweiwertig zu machen.
2. **`LlmRequest.cachePrefix` gehoert in DIESE Phase** (Lead-Entscheidung E6, genehmigt).
   B3a hat sie bewusst nicht vorgezogen, weil sie dort keinen Aufrufer gehabt haette.
3. **K19 bleibt unveraendert** — `{role, content:<String>}` ist in beiden Anbieterwelten
   gueltig; der Adapter reicht ihn durch.
4. **Metrik-Schluesselnamen bleiben Anthropic-Namen** (E7). Zwei Bestandstests pinnen sie
   woertlich. Quelle wechselt auf `LlmTokenUsage`, der Name nicht.
5. **Absolute Regeln von CLAUDE.md gelten unveraendert**: Offenlegungssatz fest verdrahtet
   (Regel 2), alle Safety-Gates unangetastet (Regel 1), nur der beauftragte Scope (Regel 6).

## 5. Abgrenzung — was ausdruecklich NICHT in B3b gehoert

- **K20 `LlmProvider.limits`** — kommt nicht. Wuerde nur `config.llm`-Zahlen zurueckspiegeln.
- **K21 Registry / `LLM_PROVIDER`** — kommt nicht. Eine Tabelle mit einem Eintrag ist
  Indirektion ohne Mehrwert. Beides ist **B5**.
- **Kein DeepSeek-Adapter.** B3b macht die Naht neutral, mehr nicht.
- **Keine Store-Migration**, keine Aenderung an der Preisrechnung (das war B4a).
- **B4b** (gemessener Betrag-Rueckgang) ist eine getrennte Kostenfrage und blockiert B3b
  nicht.

## 6. Abnahme — jeder Punkt ein Kommando

1. **Syntax:** `node --check` auf jede geaenderte Datei. Erwartet: keine Ausgabe, Exit 0.
2. **Regressionssuite:** `npm test` -> `fail 0`, Exit 0, `pass` **>= 4077**
   (auf `4aea823` gemessener Stand). **Ein SINKEN der Zahl ist ein Blocker, auch bei
   `fail 0`** — dann sind Tests verschwunden, statt gruen zu sein.
3. **Golden-Master des ausgehenden Anfrage-Bodys** (aufgenommen in `42a2fe5`): er MUSS den
   Umbau ueberleben. Aendert sich der Body bewusst, wird er neu aufgenommen **und die
   Aenderung im Report Feld fuer Feld begruendet** — eine stille Neuaufnahme ist ein Blocker.
4. **Rotprobe (Pflicht):** mindestens eine Gegenprobe, die belegt, dass ein neuer Test den
   Defekt wirklich faengt — Marker zurueckbauen, Test MUSS rot werden. Ohne diesen Beleg ist
   der Test wertlos (Repo-Lehre: ein Gate, das alles durchlaesst, besteht jeden Positiv-Test).
5. **`bridge.js`-Nachzug belegen:** `realtimeTools` muss nach dem Umbau dieselbe Werkzeugform
   erzeugen wie der Budget-Pfad. Wird `bridge.js` NICHT angefasst, ist das ein Blocker —
   K22 haengt zwingend an K14.
6. **Precall-Briefing-Beweis:** ein Test, der belegt, dass der **namentlich erzwungene**
   `toolChoice` durch den Vertrag bis in den Anthropic-Body durchkommt. Das ist der Pfad, der
   live Geld ausloest.

## 7. Arbeitsweise (Repo-Lehren, teuer bezahlt)

- Erst Branch/Worktree auf `master` = `4aea823` anlegen, **dann** lesen.
- Hintergrund-Testlaeufe **nie** mit `| tail` — volle Ausgabe in eine Datei, erst beim Lesen
  filtern. Sonst ist bei einem Fehlschlag die Diagnose weg.
- Commit-Messages mit Anfuehrungszeichen ueber `-F datei`, nie inline.
- Dateien **einzeln** adden, **nie** `git add -A`.
- Kommentare auf Deutsch OHNE Umlaute; gesprochene deutsche Strings behalten korrekte Umlaute.
- `timeout` und `xargs -a` gibt es auf macOS nicht.
- Grep vor Zeilennummer: die Nummern in der Grenztabelle sind veraltet (s. Abschnitt 3).
