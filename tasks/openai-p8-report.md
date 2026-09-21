# P8 — Abschlussbericht: Widget-UI, ChatGPT-Adapter auf Paritaet (CSP, Domain, Metadaten-Schluessel)

Branch: `phase/openai-p8-widget-ui`. Spec: `tasks/openai-p8-spec.md`. IDs im Auftrag dieser Phase
laut Spec-Kopf: **T-30, T-31, X-7, T-23** (Quelle: `tasks/openai-audit/00-openai-anforderungen.md`,
Zeilen 56/63/64/138). T-34, X-3, X-4 sind laut Spec-Kopf selbst schon ausgeschlossen.

**Commit-Hinweis (wichtig fuer den Merge — beide Angaben im Auftrag sind veraltet, nicht nur eine):**
Der Auftrag nennt Commit `f5236d7`. Der tatsaechliche Branch-HEAD ist zum Zeitpunkt dieses
Berichts **`8ab8ce1`** (voll: `8ab8ce11e017f1db830c2e4221e9cea9a5ba79a9`) — **zwei** Commits weiter:

```
f5236d7  docs(p8): PLAN-SECURITY.md um OpenAI-P8-Abschnitt ergaenzt      <- Auftrag nennt DIESEN
79a12d2  docs(p8): Pruefer-Befunde Runde 1 - ...korrigiert
8ab8ce1  fix(p8): T-30/T-31 zurueckgenommen - ...                        <- tatsaechlicher HEAD
```

Das ist kein kosmetischer Unterschied. Bei `f5236d7` waren T-30/T-31 bereits **gebaut** — ueber
zwei OpenAI-eigene "Legacy"-Alias-Schluessel (`openai/widgetCSP`/`openai/widgetDomain`) am
Resource-Inhalt des mcp-nativen Renderers (Commits `4adee50`/`4190448`, vor `f5236d7`). Nach
Pruefer-Runde 2 wurde das **vollstaendig zurueckgenommen** (Commit `8ab8ce1`) — zwei Blocker:
der Legacy-Alias erfuellt T-30/T-31 nicht einmal (die verlangen woertlich den Standard-Schluessel),
und der Zwischenstand machte `resources/read` nicht mehr byte-identisch zu master, ohne einen
Verhaltensbeleg, dass irgendein MCP-Apps-Host (Claude eingeschlossen) das zusaetzliche Feld
schluckt. Der Auftrag beschreibt in seinen "Nicht gebaut"-Gruenden bereits korrekt den **Runde-2-
Endstand** (T-30/T-31 nicht gebaut) — nur die "Commit"- und "Tests zuletzt"-Felder im Auftrag
zeigen auf einen frueheren Punkt der Kette. Auch die Testzahl im Auftrag (6228) ist ein
Zwischenstand: das ist exakt die Zahl aus der Commit-Message von `79a12d2` (Runde-1-Fix, "6220 +
8 P8-eigene Tests"), nicht vom HEAD. Am tatsaechlichen HEAD selbst gemessen (Abschnitt "Testzahlen"
unten): **6229 pass / 0 fail (roh)**, deckungsgleich mit der Commit-Message von `8ab8ce1` selbst
("6220 + 9 P8-Tests").

Dieser Bericht bewertet **`8ab8ce1`** (den echten HEAD und zugleich den sichereren der beiden
Staende), nicht `f5236d7` — bei `f5236d7` wuerde ein Lead eine bereits von der eigenen Pruefer-
Runde 2 verworfene, riskantere Fassung mergen.

---

## 1. Was NICHT erfuellt ist — zuerst, nicht versteckt

Von den vier Katalog-IDs, die laut Spec-Kopf im Auftrag dieser Phase standen (T-30, T-31, X-7,
T-23), ist **nur eine** (T-23) tatsaechlich erfuellt. Die anderen drei bleiben offen:

- **T-30 (`_meta.ui.csp` am Resource-Inhalt)** — NICHT gebaut. Ein Zwischenstand (Commits
  `4adee50`/`4190448`, vor `f5236d7`) setzte statt dessen den Legacy-Alias `openai/widgetCSP` an
  derselben Stelle — nach Pruefer-Runde 2 zurueckgenommen (`8ab8ce1`). Grund, selbst im Code
  nachgelesen: `src/ui/contract.js:78-104` — der einzige Pfad, der je ein zusaetzliches
  Resource-`_meta` an einen echten Client ausliefert, ist `mcpNativeRenderer` (der ChatGPT-Adapter
  ist auf dem Draht tot, s. Abschnitt 2), also ginge ein neues Feld dort unconditional an
  **heutige Claude-Nutzer** — ohne Verhaltensbeleg, dass ein MCP-Apps-Host es unveraendert
  schluckt. Offener Owner-Punkt: **O-P8-2** (Live-Probe gegen einen echten Claude-Host).
- **T-31 (`_meta.ui.domain` am Resource-Inhalt)** — NICHT gebaut, dieselbe Stelle
  (`src/ui/contract.js:78-104`), derselbe Grund. Zusaetzlich: `domain` ist laut MCP-Apps-Spec
  host-abhaengig (Claude nutzt `<hash>.claudemcpcontent.com`), die Wirkung des eigenen Origins
  dort ist ohne Live-Probe unbekannt.
- **X-7 (`openai/widgetCSP.redirect_domains`)** — NICHT gebaut. Grund: `redirect_domains` ist laut
  Anforderungs-Wortlaut (`tasks/openai-audit/00-openai-anforderungen.md:138`) ausschliesslich fuer
  `window.openai.openExternal(...)` relevant; das Widget-HTML hat 0 externe URLs und keine
  `openExternal`-Ziele (Messung dokumentiert in `src/ui/contract.js` beim `UI_CSP`-Kommentar,
  Zeilen ~96-104 — 5 Widget-Quellen, 12 injizierte Bausteine, 0 Treffer fuer
  fetch/XHR/WebSocket/EventSource/sendBeacon/importScripts).
- **Rueckbau des ChatGPT-Adapters** (`src/ui/adapters/chatgpt.js`, seit dieser Phase als toter
  Code gemessen und dokumentiert) — bewusst NICHT gemacht. Grund: laut Kommentar in
  `src/ui/registry.js` (Absatz "BEWUSST OFFENE LUECKE") ist Rueckbau ein Owner-Auftrag, kein
  Blocker-Fix, und reisst mindestens 7 Regressionstests mit (`T-P3-AC2` bis `T-P3-AC7`,
  `test/mcp-ui.test.js:562` und `:733` selbst nachgeschlagen, plus weitere P2-/P3-Faelle). Offener
  Owner-Punkt: **O-P8-1**.
- **T-34 (Cache-Anforderung, mit Folgefrage Sprach-Suffix in der `ui://`-URI)** — explizit
  ausgeschlossen, Lead-Regel 2 / Owner-Entscheidung O-4: die `ui://`-URI ist eine geteilte Fabrik
  (`src/ui/contract.js:21,92,97,105`), ein Sprach-Suffix dort ist nicht additiv machbar und laut
  Spec-Kopf (`tasks/openai-p8-spec.md:3,329`) nicht Teil dieses Auftrags.
- **X-3** (`openai/widgetAccessible`, `openai/visibility`, `openai/profile`, `openai/fileParams`,
  `widgetDescription`) — explizit ausgeschlossen, Lead-Regel 3 (alle optional laut Anforderungs-
  Katalog, `tasks/openai-audit/00-openai-anforderungen.md:134`).
- **X-4** (`openai/locale` u.ae.) — kein Fehlen, sondern kein Gegenstand: das sind Felder, die der
  *Client* an den Server liefert, nichts, das serverseitig zu bauen waere
  (`00-openai-anforderungen.md:135`).
- **`window.openai`-Bruecke / echte Live-Wirkung in einem ChatGPT-Connector** — nicht geprueft,
  nicht baubar ohne echten Zugang. Offener Owner-Punkt: **O-P8-3** (= OW-4 aus
  `tasks/openai-p0-entscheidungen.md`).
- **`MCP_UI_ENABLED`** — Schalter/Default nicht angefasst, wie im Auftrag vorgegeben (Lead-Regel 6).

Kurz: diese Phase liefert fuer die Einreichung selbst **keinen** der drei CSP/Domain/Legacy-Punkte
(T-30, T-31, X-7) — sie liefert eine gemessene Begruendung, warum sie mit vertretbarem Risiko
gerade NICHT baubar sind, plus die Rueck­nahme eines bereits gebauten, aber unzureichenden
Zwischenstands.

---

## 2. Was diese Phase erfuellt — ID fuer ID mit Beweisstelle

Alle Zeilenangaben unten habe ich selbst im per `git worktree` ausgecheckten HEAD (`8ab8ce1`)
nachgeschlagen, nicht nur aus dem Auftrag uebernommen.

### T-23 — Standard-Key `_meta.ui.resourceUri` bevorzugt, `openai/outputTemplate` nur als Alias

**Status: erfuellt**, fuer den einzigen Pfad, den je ein realer Client sieht (mcp-nativ, s. M-1
unten). Beweis: `src/ui/adapters/mcp-native.js` setzt `metaKey: UI_META_KEY` (= `"ui"`), keinen
Alias-Schluessel. Test `P8-E` (HTTP, `test/openai-p8-widget-ui.test.js:261-288`): fuer alle 5
Widget-Werkzeuge ist `"openai/outputTemplate" in tool._meta` == `false`, `_meta.ui.resourceUri`
ist ein String, genau eine passende Resource existiert. Zusaetzlich stdio-seitig indirekt
mitbelegt durch `P8-B` (`:196-219`, prueft explizit `"openai/outputTemplate" in (placeCall._meta
|| {})` == `false`) und den vollen Hash-Test `P8-J` (`:364-379`, deckt `tools/list` ueber stdio
komplett ab). Ich habe `P8-E` isoliert nachgefahren — gruen (Abschnitt "Testzahlen").

### M-1 — Kern-Messergebnis der Phase (keine Katalog-ID, aber die Grundlage aller "nicht
gebaut"-Entscheidungen oben): ChatGPT-Adapter ist auf dem Draht tot

**Status: gemessen und durch zwei Draht-Tests belegt.** Ursache: der stateless MCP-Transport
(`sessionIdGenerator: undefined`, s. Kommentar `src/routes/mcp.js:148-154`) baut fuer jeden POST
einen frischen Server — die im `initialize`-POST deklarierten Capabilities erreichen nie den
spaeteren `tools/list`- oder `resources/read`-POST. Test `P8-A` (HTTP,
`test/openai-p8-widget-ui.test.js:163-195`): `initialize` mit Skybridge-Capability wird
angenommen, `tools/list` liefert trotzdem den mcp-nativen Pfad (`_meta.ui.resourceUri` gesetzt,
kein `openai/outputTemplate`), `resources/read` liefert `mimeType: "text/html;profile=mcp-app"`,
nicht `text/html+skybridge`. Test `P8-B` (stdio, `:196-219`): derselbe Befund ueber einen echten
`src/mcp-server.js`-Kindprozess. Beide selbst isoliert nachgefahren — gruen.

### Byte-Stabilitaet ("Regel 1" der Phase: kein Verhalten fuer heutige Claude-Nutzer aendert sich)
— das eigentliche Ergebnis dieser Phase, keine Katalog-ID

**Status: erfuellt, mit zwei unabhaengigen Belegformen.**
1. Eigener Diff, selbst nachgemessen: `git diff master..phase/openai-p8-widget-ui -- src/ui/
   src/routes/mcp.js` zeigt **ausschliesslich** Kommentarzeilen — jede geaenderte Zeile in
   `contract.js`, `mcp-native.js`, `chatgpt.js`, `registry.js` und `routes/mcp.js` beginnt mit
   `//`; keine einzige Zeile mit ausfuehrbarem Code ist im Diff enthalten (selbst Zeile fuer Zeile
   geprueft). `PLAN-SECURITY.md` ist eine reine Ergaenzung (`git diff ... | grep '^-' | grep -v
   '^---'` liefert keine Treffer).
2. Test `P8-C`/`P8-D` (`:220-260`): jede der 5 Widget-Resourcen traegt exakt `{uri, mimeType,
   text}`, kein `_meta`, ueber HTTP und stdio. Test `P8-F` (`:290-324`): Tool-`_meta`-Schluesselmenge
   (`["openai/toolInvocation/invoked", "openai/toolInvocation/invoking", "ui"]`) und
   `resources/list`-Eintraege unveraendert. Test `P8-I`/`P8-J` (`:343-379`): sha256 der vollen,
   kanonisierten (Schluessel sortiert) JSON-Serialisierung von `tools/list` + `resources/list` +
   jedem `resources/read` (5 Widgets), gegen einen fest eingecheckten Hash-Wert (`baf9f1c9…4d36bf`
   HTTP, `cb8d492a…3ee215a` stdio) — beide selbst isoliert nachgefahren, gruen.

### PLAN-SECURITY.md-Dokumentation

Neuer Abschnitt "OpenAI-P8" (im ausgecheckten HEAD ab Zeile 5155), dokumentiert M-1, die
T-30/T-31-Ruecknahme mit beiden Gruenden, den Byte-Beweis und die drei offenen Owner-Punkte
(O-P8-1/2/3). Reine Ergaenzung (s.o.), selbst gelesen.

**Nicht als P8-Leistung gefuehrt (Doppelbuchung ausgeschlossen):** T-23 war schon vor dieser Phase
strukturell erfuellt (der mcp-native Renderer setzte nie einen Alias-Schluessel) — diese Phase
liefert dafuer den ersten expliziten Draht-Test (`P8-E`), nicht die zugrundeliegende Eigenschaft.

---

## 3. Beruehrte Pfade — vollstaendig?

| Pfad | Beruehrt? | Punkt erfuellt? |
|---|---|---|
| HTTP `/mcp`, mcp-nativer Renderer | ja | ja — T-23 und Byte-Identitaet belegt (`P8-C/E/F/I`) |
| HTTP `/mcp`, `initialize` mit Skybridge-Capability | ja | ja — M-1 belegt (`P8-A`) |
| stdio (`src/mcp-server.js`), mcp-nativer Renderer | ja | ja — dieselben Befunde ueber echten Kindprozess (`P8-B/D/J`); T-23 selbst hat keinen eigens benannten stdio-Testfall (`P8-E` ist HTTP-only), die zugrunde liegende Eigenschaft (kein Alias-Key) wird stdio-seitig aber durch `P8-B` und den vollen Hash `P8-J` mitbelegt |
| ChatGPT-Adapter als **realer** Transport-Endpunkt (Skybridge, ueber ein echtes `initialize` erreicht) | **nein** | entfaellt strukturell — M-1 zeigt, dass dieser Pfad ueber keinen realen Transport je erreicht wird; `P8-H` liest den Renderer **in-process direkt** (`readbackResource`-Fake, `test/openai-p8-widget-ui.test.js:95-120,325-342`, kein HTTP, kein stdio) — die Aussage "ChatGPT-Adapter liefert weiterhin ohne `_meta`" ist damit fuer diesen einen Fall NICHT End-to-End ueber einen echten Transport bewiesen, nur direkt am Renderer-Objekt |
| Ein echter Claude-Host (claude.ai/Claude Desktop) gegen zusaetzliches Resource-`_meta` | nein, nicht messbar in dieser Session | **entfaellt fuer diese Phase** — da nichts Zusaetzliches gesendet wird (Ruecknahme), ist dieser Pfad gar nicht mehr Gegenstand; er waere nur relevant gewesen, haette man T-30/T-31 tatsaechlich gebaut. Offener Owner-Punkt **O-P8-2** bleibt fuer eine kuenftige Phase stehen. |
| Ein echter OpenAI ChatGPT Developer-Mode-Connector | nein, nicht messbar in dieser Session | offener Owner-Punkt **O-P8-3** (= OW-4) |
| Safety-Gates, Offenlegungssatz, Auth-Middleware, Billing | nein, nicht angefasst | ausserhalb des Diffs — `git diff master..phase/openai-p8-widget-ui --stat` listet ausschliesslich die 7 Dateien aus dem Auftrag (selbst nachgemessen), keine Datei aus `src/config.js`, `src/claude.js`, `src/auth.js`, `src/telephony/**`, `src/billing/**` |

Fuer die beiden real erreichbaren Wire-Pfade (HTTP und stdio, mcp-nativer Renderer) ist die
Byte-Identitaets-Behauptung auf **beiden** durch je einen eigenen Draht-Test belegt. Fuer den
ChatGPT-Adapter selbst gibt es dagegen **keinen** Wire-Beleg (nur in-process), was aber konsistent
mit M-1 ist: ein Wire-Test gegen einen Pfad, der nachweislich nie erreicht wird, wuerde nichts
zusaetzlich zeigen.

---

## 4. Was ein fremder Pruefer nachmessen sollte

Neutral formuliert — jede Zeile beschreibt eine pruefbare Behauptung, nicht deren Bestaetigung.

1. **Steht der zu bewertende Code wirklich auf `8ab8ce1`, nicht auf `f5236d7`?**
   `git log --oneline f5236d7..phase/openai-p8-widget-ui` (Erwartung laut diesem Bericht: zwei
   weitere Commits, "Pruefer-Befunde Runde 1" und "T-30/T-31 zurueckgenommen").
2. **Ist der Unterschied zwischen `f5236d7` und dem HEAD wirklich inhaltlich, nicht nur
   kosmetisch?** `git diff f5236d7 phase/openai-p8-widget-ui -- src/ui/contract.js
   src/ui/adapters/mcp-native.js` lesen — enthaelt `f5236d7` tatsaechlich noch
   `openAiResourceMeta`/`OPENAI_WIDGET_CSP_KEY`/`OPENAI_WIDGET_DOMAIN_KEY`, die am HEAD fehlen?
3. **Sind wirklich genau die 7 im Auftrag genannten Dateien betroffen, keine weiteren?**
   `git diff master..phase/openai-p8-widget-ui --stat`
4. **Ist der Diff in `contract.js`, `mcp-native.js`, `chatgpt.js`, `registry.js` und
   `routes/mcp.js` wirklich reiner Kommentar, keine einzige Verhaltensaenderung?** Jede geaenderte
   Zeile einzeln lesen: `git diff master..phase/openai-p8-widget-ui -- src/ui/ src/routes/mcp.js`
5. **Ist `PLAN-SECURITY.md` wirklich eine reine Ergaenzung?**
   `git diff master..phase/openai-p8-widget-ui -- PLAN-SECURITY.md | grep '^-' | grep -v '^---'`
   — leer?
6. **Laufen alle 9 P8-Tests isoliert gruen?**
   `NODE_ENV=test node --test --test-concurrency=1 test/openai-p8-widget-ui.test.js`
7. **Stimmt die Gesamtzahl des vollen Testlaufs mit den hier berichteten 6229 pass / 0 fail
   (roh) ueberein, nicht mit den im Auftrag genannten 6228?**
   `npm test -- -- --test-concurrency=4` im Worktree neu fahren.
8. **Traegt `tools/list` wirklich keinen `openai/outputTemplate`-Schluessel fuer die 5
   Widget-Werkzeuge, egal welche Capability `initialize` deklariert?** Manuell pruefen: Server
   lokal starten (`PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true MCP_UI_ENABLED=true npm start`),
   `curl` mit `initialize` + Skybridge-Capability, danach `tools/list`, `_meta` je Werkzeug
   inspizieren.
9. **Ist `P8-H` wirklich kein Transport-Test, sondern ein direkter In-Process-Aufruf?**
   `sed -n '95,120p;325,342p' test/openai-p8-widget-ui.test.js` lesen — ruft `readbackResource`
   tatsaechlich `renderer.registerResource(fakeServer, widgetId)` direkt auf, ohne HTTP/stdio?
10. **Sind die Owner-Punkte O-P8-1/O-P8-2/O-P8-3 tatsaechlich offen und nachvollziehbar
    begruendet?** `PLAN-SECURITY.md`, Abschnitt "OpenAI-P8" (im HEAD ab Zeile ~5155) lesen.
11. **Bleiben Safety-Gates, Offenlegungssatz, Auth-Middleware und Billing unangetastet?**
    `git diff master..phase/openai-p8-widget-ui --stat` — taucht dort etwas ausserhalb der 7
    genannten Dateien auf, insbesondere `src/config.js`, `src/claude.js`, `src/auth.js`,
    `src/telephony/**`, `src/billing/**`?
12. **Reisst ein Rueckbau des ChatGPT-Adapters wirklich Regressionstests?** (Nur relevant, falls
    O-P8-1 in Richtung Rueckbau entschieden wird.) `NODE_ENV=test node --test
    --test-concurrency=4 test/mcp-ui.test.js` nach probeweisem Entfernen von `chatgpt.js` /
    dessen Verdrahtung in `registry.js` — werden `T-P3-AC2` bis `T-P3-AC7` tatsaechlich rot?

---

## 5. Restrisiko

Das Risiko fuer laufenden Produktionsverkehr ist klein: der Diff gegen `master` besteht in den
vier UI-Quelldateien plus `routes/mcp.js` **ausschliesslich** aus Kommentaren (selbst Zeile fuer
Zeile geprueft), Safety-Gates/Offenlegung/Auth/Billing sind nicht Teil des Diffs, und der volle
Testlauf steht bei 6229 pass / 0 fail (selbst nachgefahren, mit der im Auftrag vorgeschriebenen
Concurrency). Das eigentliche Restrisiko liegt woanders, in drei Teilen. **Erstens, fachlich:**
fuer die OpenAI-Einreichung bleiben T-30/T-31/X-7 formal unerfuellt — wird die Einreichung
versucht, bevor O-P8-2 (Claude-Live-Probe) und O-P8-3/OW-4 (OpenAI-Live-Probe) durch den Owner
beantwortet sind, wird sie an genau diesen Punkten scheitern, weil kein Codepfad heute die
verlangten Standard-Schluessel setzt; das ist hier bewusst in Kauf genommen, nicht versehentlich
offen. **Zweitens, strukturell:** der ChatGPT-Adapter bleibt als toter, aber lebender Code im Baum
(`chatgpt.js`, `registry.js`-Verdrahtung) — er kostet heute nichts, aber sein Rueckbau ist an 7+
Regressionstests gekoppelt (O-P8-1) und ein kuenftiger Wartender koennte den mimeType
`text/html+skybridge` faelschlich fuer live halten, ohne den M-1-Befund zu kennen; die Phase
begegnet dem mit ausfuehrlicher Kommentierung an allen vier Fundstellen, nicht mit Code-Aenderung.
**Drittens, methodisch:** die Byte-Identitaets-Garantie (`P8-I`/`P8-J`) ist eine
Selbstkonsistenz-Pruefung (Hash gegen einen fest eingecheckten master-Stand) plus ein
Schema-Argument (das SDK verwirft ein offenes `_meta`-Record nicht) — sie beweist nicht, wie ein
echter Host mit zusaetzlichen Feldern umgehen wuerde, weil dieser Phase absichtlich KEINE
zusaetzlichen Felder mehr sendet. Das ist die richtige, konservative Entscheidung angesichts der
Sicherheits-Prioritaet dieses Repos, bedeutet aber: die zugrunde liegende offene Frage (vertraegt
ein MCP-Apps-Host ein zusaetzliches Resource-`_meta`?) ist nach dieser Phase genauso unbeantwortet
wie davor — nur wird jetzt nichts mehr riskiert, um sie zu umgehen, statt sie zu beantworten.
**Viertens, prozessual, nicht inhaltlich:** wie oben beschrieben zeigen sowohl die Commit-Angabe
als auch die Testzahl im Auftrag auf fruehere Punkte derselben Kette, nicht auf den HEAD — wer
diesen Bericht als Grundlage fuer den Merge nimmt, sollte den Merge ausdruecklich gegen `8ab8ce1`
ausfuehren, nicht gegen `f5236d7`.

---

## Testzahlen (selbst nachgemessen)

- `test/openai-p8-widget-ui.test.js` isoliert (`NODE_ENV=test node --test --test-concurrency=1
  test/openai-p8-widget-ui.test.js`): **9 pass / 0 fail** (`P8-A, B, C, D, E, F, H, I, J`, kein
  `G` — laut Commit-Message von `8ab8ce1` entfallen, weil die getestete Funktion nicht mehr
  existiert; selbst nachgefahren, alle neun mit `✔`).
- Voller Testlauf, exakt das im Auftrag/CLAUDE.md vorgeschriebene Kommando (`npm test -- --
  --test-concurrency=4`), selbst im Worktree (`8ab8ce1`) gestartet und bis zum Ende
  durchgelaufen (ca. 425 s): **`# tests 6229`, `# suites 80`, `# pass 6229`, `# fail 0`,
  `# cancelled 0`, `# skipped 0`, `# todo 0`**, danach die `testbaenke-run`-eigene Korrektur
  ("20 Datei-Wrapper ohne echten Test abgezogen"): `tests 6209 / pass 6209 / fail 0`. Diese Zahl
  ist **neuer** als die im Auftrag genannte (6228) und deckt sich mit der Commit-Message von
  `8ab8ce1` selbst ("6220 Baseline + 9 P8-Tests" = 6229) — ich uebernehme sie hier als
  selbst gepruecften, aktuellen Stand.
- `git diff master..phase/openai-p8-widget-ui -- src/ui/ src/routes/mcp.js`: ausschliesslich
  Kommentarzeilen, selbst Zeile fuer Zeile durchgesehen.
- `git diff master..phase/openai-p8-widget-ui -- PLAN-SECURITY.md`: keine geloeschte Zeile ausser
  Diff-Header (reine Ergaenzung).
- `node --check` auf allen 6 betroffenen Quell-/Testdateien: syntaktisch fehlerfrei.

---

## Empfehlung

Ich wuerde **mergen**, ausdruecklich gegen `8ab8ce1` (nicht `f5236d7`). Begruendung: gemessen an
`master` ist der Produktionscode-Diff reiner Kommentar (selbst Zeile fuer Zeile verifiziert), kein
Safety-/Auth-/Billing-Pfad ist beruehrt, der volle Testlauf ist gruen (6229/0, selbst gefahren)
und die neuen P8-Tests belegen echte Draht-Eigenschaften (HTTP + stdio gegen einen echten
Kindprozess), nicht nur Behauptungen. Was offen bleibt, ist ehrlich als offen dokumentiert (drei
Owner-Punkte O-P8-1/2/3, alle strukturell nicht ohne Owner-Zugang bzw. Owner-Entscheidung
schliessbar) und blockiert diesen Merge nicht — es blockiert die **OpenAI-Einreichung** an den
Punkten T-30/T-31/X-7, was in `PLAN-SECURITY.md` und `tasks/openai-p0-entscheidungen.md` bereits
so gefuehrt wird. Einzige Bedingung: der Merge muss den tatsaechlichen HEAD nehmen, nicht den im
Auftrag genannten, bereits ueberholten Commit.

---

*Bericht erstellt von einem Subagenten (Sonnet 5) am 2026-09-21. Alle Codezeilen-, Test- und
Diff-Angaben in diesem Bericht wurden im per `git worktree` ausgecheckten Branch-HEAD selbst
nachgelesen bzw. selbst ausgefuehrt (u.a. ein vollstaendiger `npm test -- -- --test-concurrency=4`-
Lauf), nicht unbesehen aus dem Auftrag oder aus Commit-Messages uebernommen.*
