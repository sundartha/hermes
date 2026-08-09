# FIX-1 — Zusammenfassung reparieren + die fehlenden zwei Token-Sorten ins Log

Spezifikation, Stand 2026-08-09. Basis: `master` (nach Track-B-Abschluss, `00facce`).
Zwei kleine, unabhaengige Aenderungen in derselben Gegend (`llm`/`metrics`).

## TEIL 1 — Die Gespraechs-Zusammenfassung kann strukturell nie gelingen

### Der Befund, gemessen

Am 2026-08-09 im Live-Log (`call_mslm38yfw5xb`):

```
[metrics] llm {"outcome":"retries-exhausted","attempts":3,"latencyMs":10766,...}
[summary] LLM nicht verfuegbar: retries-exhausted
```

`get_transcript` lieferte deshalb **keine Zusammenfassung**.

**Die Ursache ist Arithmetik, kein Timing-Pech.** Gegen die echte Anthropic-API gemessen
(drei Laeufe, `claude-haiku-4-5`, `max_tokens: 800` — exakt die Parameter von
`summarizeCall`):

| Lauf | Dauer | Output |
|---|---|---|
| 1 | **8856 ms** | 800 Token (`stop_reason: max_tokens`) |
| 2 | **8985 ms** | 800 Token |
| 3 | **7745 ms** | 800 Token |

Konfiguriert ist `llmRequestTimeoutMs` = **3500 ms** je Versuch, `llmMaxRetries` = 2.
Drei Versuche a 3500 ms scheitern **immer**, wenn die Antwort den Platz ausnutzt. Die
gemessenen 10766 ms sind exakt das aufgebrauchte Budget.

**Folge:** die Zusammenfassung scheitert genau bei den LANGEN Gespraechen — also dort, wo sie
am wertvollsten waere. Kurze Antworten (~200 Token) kommen in ~2 s durch; deshalb ist der
Defekt nie als "immer kaputt" aufgefallen.

### Warum der Timeout hier der falsche ist

`config.js:420` begruendet die 3500 ms ausdruecklich mit dem **Webhook**-Zeitfenster:
*"der Provider kappt einen unbeantworteten Webhook nach 15 s hart"*, Budget-Soll
`(llmMaxRetries+1)*timeout + Backoff < 12 s`.

**`summarizeCall` laeuft aber nicht im Webhook-Antwortpfad.** Belegt am Code:
`call-termination.js:31` — *"bill() bleibt bewusst **fire-and-forget** (Regel 1 - der
Max-Dauer-Cap-Timer darf NICHT auf die Buchungskette warten)"*, und `bill()` wird ohne
`await` aufgerufen (`Promise.resolve(bill()).catch(...)`). Der Webhook antwortet sofort; die
Zusammenfassung laeuft danach detached weiter.

Die Zusammenfassung erbt damit eine Beschraenkung, die fuer sie **nie gedacht war**.

### Auftrag Teil 1

Ein **eigener** Timeout fuer `summarizeCall`, analog zum bereits existierenden
`briefingTimeoutMs` (dasselbe Muster, dieselbe Begruendungsform):

- Neue Env-Variable, zentral in `src/config.js`, dokumentiert in `.env.example`,
  `render.yaml` pruefen, **und in `BASE_ENV` (`test/helpers.js`)** — sonst leakt die echte
  `.env` in Spawn-Tests (dokumentierte Repo-Falle).
- **Vorgabewert so waehlen, dass 800 Output-Token sicher durchpassen.** Gemessen 7,7-9,0 s;
  ein Wert um 20000 ms gibt Reserve fuer Lastspitzen. Die Zahl ist zu begruenden, nicht zu
  raten.
- **`llmRequestTimeoutMs` bleibt UNVERAENDERT bei 3500 ms.** Der Sprechpfad und sein
  Boot-Waechter (`src/turn-budget.js`) werden NICHT angefasst — genau deshalb ist ein
  zweiter Wert die richtige Loesung und nicht das Anheben des bestehenden.
- Retries fuer die Zusammenfassung: bewusst entscheiden und begruenden (der Bestand nutzt
  `llmMaxRetries` = 2; bei einem 20-s-Timeout ist die Frage, ob 3 Versuche noch sinnvoll
  sind oder das Budget unnoetig strecken).

### Abnahme Teil 1

1. Ein Test, der belegt: `summarizeCall` fuehrt seinen **eigenen** Timeout mit, nicht
   `llmRequestTimeoutMs`. (Muster: `precall-briefing.js:125` reicht `llmRequestTimeoutMs:
   config.llm.briefingTimeoutMs` durch — hier analog.)
2. Ein Test, der belegt: `llmRequestTimeoutMs` (Sprechpfad) ist unveraendert 3500 ms.
3. **Rotprobe:** den neuen Wert wieder auf `llmRequestTimeoutMs` zurueckbiegen -> der Test
   aus (1) MUSS rot werden.

## TEIL 2 — Zwei der vier Token-Sorten erreichen das Log nicht

### Der Befund

`metrics.js:35-52` fuehrt eine bewusste Feld-Whitelist. Durch kommen NUR
`cache_creation_input_tokens` und `cache_read_input_tokens`. **`inputUncachedTokens` und
`outputTokens` erreichen das Log nie** — obwohl die Buchung alle vier kennt
(`llm-usage.js` `billedTokens`).

Folge: **W6 (B4b) ist nicht beantwortbar.** Aus einem Live-Anruf laesst sich weder der alte
noch der neue gebuchte Betrag rekonstruieren. `convo-bench` gibt gar keine Token aus
(geprueft: kein `usage`-Feld in 183 Zeilen).

Nebenbefund vom 2026-08-09: ueber den ganzen Anruf trug **keine** der 9 erfolgreichen
`[metrics] llm`-Zeilen ein Cache-Feld. Die Metrik meldet Cache-Zaehler nur, wenn sie > 0
sind — es gab also **keinen einzigen Cache-Treffer**. Ob das reproduzierbar ist, kann erst
nach dieser Aenderung sauber beurteilt werden.

### Auftrag Teil 2

Die zwei fehlenden Sorten in die Whitelist aufnehmen — **auf demselben Risikoniveau wie die
zwei bereits erlaubten**: reine Zahlen, PII-frei, kein Inhalt.

- Die Schluesselnamen folgen der bestehenden Konvention (E7: Anthropic-Namen, zwei
  Bestandstests pinnen sie woertlich — **diese Tests duerfen nicht brechen**).
- Die bestehende Regel *"gemeldet wird nur ein Wert > 0"* ist beizubehalten oder bewusst zu
  aendern; ein `outputTokens: 0` waere eine Falschaussage, wenn 0 "unbekannt" heissen kann.
  **Diese Unterscheidung ist zu begruenden** (`LlmTokenUsage` kennt kein "abwesend", 0 heisst
  dort "keine Token dieser Preisklasse").

### Abnahme Teil 2

1. Ein Test, der belegt: alle **vier** Sorten erreichen den Metrik-Payload.
2. Die zwei Bestandstests, die die Schluesselnamen woertlich pinnen, bleiben gruen.
3. **Rotprobe:** ein Feld wieder aus der Whitelist nehmen -> Test aus (1) MUSS rot werden.
4. **Kein Leck:** ein Test, der belegt, dass weiterhin NUR Zahlen durchkommen — kein
   Transkript, kein Prompt, kein Modelltext. Die Whitelist existiert genau dafuer.

## Abgrenzung — was NICHT in FIX-1 gehoert

- **Die Doppelantwort im Anruf** (Telnyx stoesst Turns auf partiellen Transkripten an) —
  eigener Befund, eigene Phase, Wurzel liegt in der Turn-Erkennung.
- **Der Briefing-Timeout** (`briefingTimeoutMs` = 6000 ms). Gemessen 3690/4196 ms bei
  erzwungenem Werkzeug — knapp, aber grundsaetzlich ausreichend. **Die geschaetzte
  Kostenbuchung im Timeout-Fall ist KORREKT** und kein Abrechnungsdefekt:
  `precall-briefing.js:316` begruendet es — Anthropic generiert und berechnet auch dann,
  wenn wir vorher abbrechen.
- **B4b selbst** (die Auswertung des Betrag-Rueckgangs). FIX-1 schafft nur die Datenbasis.
- Keine Aenderung an Safety-Gates, Offenlegungssatz, Preisrechnung.

## Allgemeine Abnahme

- `node --check` auf jede geaenderte Datei, Exit 0.
- `npm test` -> `fail 0`, Exit 0, `pass` **>= 4110** (Stand `00facce`). Ein SINKEN ist ein
  Blocker, auch bei `fail 0`.
- **Der Lauf MUSS im Worktree stattfinden** (`cd .claude/worktrees/<run>-2 && npm test`) —
  `git checkout` scheitert still, wenn ein Worktree den Branch belegt (Lehre 2026-08-09).
- Der Lauf wird gegen ein **Merkmal der Aenderung** geprueft (`grep -c "^ok .* - FIX1-"`),
  nicht nur gegen `fail 0`.

## Arbeitsweise (Repo-Lehren)

- Erst Branch/Worktree auf `master` anlegen, **dann** lesen.
- Hintergrund-Testlaeufe **nie** durch eine Pipe filtern (`| tail`, `| grep`) — volle Ausgabe
  in eine Datei, erst beim Lesen filtern.
- Commit-Messages mit Anfuehrungszeichen ueber `-F datei`, nie inline.
- Dateien **einzeln** adden, **nie** `git add -A`.
- Kommentare auf Deutsch OHNE Umlaute; gesprochene deutsche Strings behalten korrekte Umlaute.
- Neue Env-Variable: `src/config.js` + `.env.example` + `render.yaml` + `BASE_ENV`.
