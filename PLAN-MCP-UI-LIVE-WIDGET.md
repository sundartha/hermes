# PLAN — MCP-UI Live-Widget (ein sich selbst aktualisierendes Call-Widget)

Strategie-Doc (Analyse-only, KEIN Code). Erstellt 2026-07-01 aus Live-Forensik +
Spec-Recherche + einem dynamischen Sonnet-Design-Workflow (3 Draft-Agenten + 1
adversariale Kritik). Umgesetzt wird sequenziell in einer FRISCHEN Session ueber die
Lean-Phasen-Kette in `tasks/mcp-ui-live-widget-chain.md` (Muster wie
[[conversation-quality-chain]] / [[owner-removal-chain]]).

Verwandt: [[mcp-ui-strategy]] (die urspruengliche Rich-UI-Strategie P0-P5, hier gebaut),
[[deploy-repo-split]] (Live = Push upstream), [[lean-phase-orchestration]] (Kette + Rollen).

---

## 1. Problem (vom Owner)

Bei EINEM einzigen Telefonanruf erscheinen 10-20 Widget-Karten im Claude-Chatverlauf.
Fuer `place_call` wird faktisch alle ~5-10 Sekunden eine neue Karte erzeugt. Das ist
unbrauchbar. Gewuenscht: **EIN vereintes Widget pro Anruf, das sich selbst in-place
aktualisiert** (Waehlen -> Live-Status mit Transkriptzeilen -> Ergebnis/Zusammenfassung).

## 2. Wurzel (forensisch belegt)

Zwei Ursachen greifen zusammen:

1. **Modell-getriebenes Polling.** `src/mcp-tools.js:306` (`place_call`-Beschreibung)
   UND `src/mcp-tools.js:407` (`get_call_status`-Beschreibung) weisen das Modell
   woertlich an, "alle ~10 Sekunden `get_call_status` aufzurufen".
2. **Jedes Tool-Result rendert eine Karte.** `get_call_status` traegt via
   `enableWidgetUi(WIDGET_CALL_STATUS)` (`src/mcp-tools.js:410`) ein
   `_meta.ui.resourceUri`. Jeder Modell-getriebene Aufruf ist ein eigenes Tool-Result;
   der Host rendert PRO Result eine NEUE Karte. SEP-1865 kennt **keinen** "ersetze
   bestehende Karte"-Mechanismus.

Ergebnis: N Polls = N Karten.

## 3. Loesungsprinzip (Spec-belegt)

In Anthropics MCP Apps ist ein **widget-initiierter Tool-Call inhaerent still** — er
erzeugt KEINE neue Chat-Karte (Anthropics offizielles ext-apps System-Monitor-Beispiel
pollt so alle 2s "without creating new chat interactions"). Kanonisches Muster fuer
Live-Status:

- **Das Widget pollt sich selbst** (setInterval + Host-Bruecke) und aktualisiert seinen
  eigenen DOM in-place. Das Modell pollt NICHT.
- `place_call` oeffnet die EINZIGE Karte; `get_call_status` verliert sein Widget-`_meta`
  und wird zur reinen Daten-/Fallback-Quelle.

Quellen: modelcontextprotocol.io/extensions/apps, SEP-1865, ext-apps system-monitor;
OpenAI-Aequivalent `window.openai.callTool` (beide erzeugen keine neue Karte).

## 4. Der ehrliche Haken (empirische Unsicherheit)

Der geteilte `src/ui/widget-bind.js` ist heute **rein empfangend** — der Empfangspfad
ist im echten Claude des Owners **bewiesen** (rendert 7 Widgets). Der **ausgehende**
Pfad (Widget ruft ein Tool ueber die Host-Bruecke) ist im echten Claude **nie
bestaetigt**. Zwei Dinge haengen am realen Host und lassen sich nicht aus Code beweisen:

- **U1:** Wird ein ausgehender Widget-Call ueberhaupt akzeptiert, und in welchem
  Wire-Format? Kandidaten: `window.openai.callTool` / postMessage `tools/call` /
  postMessage `ui/tool-call`.
- **U2:** Versteckt `_meta.ui.visibility:["app"]` ein Tool vor dem Modell? (Wir nutzen
  das NICHT als Fundament — siehe Fallback.)

Deshalb: **voll bauen mit sauberem Fallback + eingebauter Bruecken-Diagnose** (Owner-
Entscheidung #2). Ein Deploy, EIN Live-Test klaert U1 empirisch.

## 5. Owner-Entscheidungen (BINDEND)

- **#1 Umfang = EIN vereintes "Call"-Widget** fuer den gesamten Lebenszyklus in EINER
  Karte (Waehlen -> Live-Status mit letzten Transkriptzeilen -> Ergebnis/Zusammenfassung),
  aktualisiert sich in-place. Subsumiert die heutigen Einzel-Widgets call-status,
  call-result (Cancel) und die aktive-Anruf-Transcript-Sicht.
- **#2 Vorgehen = voll bauen mit Fallback + Diagnose, EIN Deploy.** Schlimmstenfalls
  bleibt je 1 statische Karte (KEIN Spam). Diagnose-Zeile zeigt, welches Wire-Format
  wirkt + letzter Update-Zeitpunkt. Owner testet EINMAL live in seinem Claude.
- **#3 (Lead-Entscheidung, Owner kann ueberstimmen) Bruecke inline in `call.html`.**
  Die ausgehende Bruecke + Self-Poll-Logik lebt im widget-EIGENEN Inline-`<script>` von
  `call.html` — exakt das etablierte Muster von `call-result.html` (Cancel) und
  `probe-call-bridge.html`. Der geteilte `widget-bind.js` und die uniforme
  Katalog-Injektion bleiben **byte-unberuehrt**. KEIN neues `widget-bridge.js`-Modul,
  keine Katalog-Umstrukturierung (Regel 6 / lean; das Wire-Format ist ohnehin erst am
  Live-Gate beweisbar, damit hat Byte-Shape-Unit-Testing geringen Wert).

## 6. Ziel-Architektur

### 6.1 Das vereinte Widget (`src/ui/widgets/call.html`)

Zustandsmaschine (Strings 1:1 aus `pickCallStatus`/`mapStatus`, `src/mcp-tools.js:90-93`):

```
dialing  ->  in_progress  ->  completed (terminal)
                          ->  failed    (terminal)
                          ->  cancelled (terminal)
```

Data-mcp-Slots (alle via `textContent`, NIE `innerHTML` — XSS-Disziplin wie Bestand):

| Slot                    | Quelle                                  | sichtbar bei      |
| ----------------------- | --------------------------------------- | ----------------- |
| `call_id`               | initiales structuredContent (place_call)| immer             |
| `status`                | `pickCallStatus`                        | alle Zustaende    |
| `duration_s`            | `pickCallStatus`                        | alle Zustaende    |
| `last_transcript_lines` | `pickCallStatus`                        | dialing/in_progress |
| `failure_reason`        | `pickCallStatus`                        | nur failed        |
| `result_summary`        | `pickTranscript` (get_transcript-Poll)  | nur completed     |
| `objective_achieved`    | `pickTranscript`                        | nur completed     |
| Diagnose (2 Slots)      | Widget-eigen (Format + Update-Zeit)     | immer             |
| Cancel-Button           | eigenes DOM-Element, JS-Toggle          | dialing/in_progress |

Ablauf im Widget-eigenen Inline-`<script>` (nach dem injizierten BIND_SCRIPT):

1. `call_id` aus dem gebundenen `[data-mcp="call_id"]`-Slot lesen (fuellt der bewiesene
   Empfangspfad aus dem place_call-structuredContent-Push).
2. `setInterval` (`POLL_INTERVAL_MS = 8000`, benannte Konstante): ruft
   `get_call_status({call_id})` ueber die Host-Bruecke; Antwort -> Slots in-place.
3. Terminal-Status -> `clearInterval`; Cancel-Button deaktivieren; bei `completed`
   EINMAL `get_transcript({call_id})` -> `result_summary`/`objective_achieved`.
4. Cancel-Button -> `cancel_call({call_id})` (gefaltet aus call-result.html).

### 6.2 Die ausgehende Bruecke (inline, U1-agnostisch)

Beim ersten Poll-Tick alle drei Kandidaten-Formate versuchen (wie der Probe):
`window.openai.callTool(name,args)` / postMessage `{jsonrpc,id,method:"tools/call",
params:{name,arguments}}` / dito `method:"ui/tool-call"`. Antwort kommt ueber einen von
zwei Kanaelen: (A) `ui/notifications/tool-result`-Notification (der geteilte Bind bindet
sie bereits automatisch) oder (B) direkte JSON-RPC-Response id-gematcht (das Widget
schreibt die Slots dann selbst per querySelector — dieselbe Slot-Konvention, kein Import).
Das erste antwortende Format wird gemerkt und in der Diagnose-Zeile gezeigt; Folge-Ticks
nutzen nur dieses.

### 6.3 Fallback-Vertrag (garantiert, U1-unabhaengig)

- Antwortet nach ~15s KEIN Format: `clearInterval`, Diagnose-Zeile zeigt "kein
  Live-Update", der initiale place_call-Status bleibt sichtbar (NIE leer). **Kein Spam.**
- `get_call_status` bleibt ein Modell-SICHTBARES Text-Tool (nur ohne Widget-`_meta`) —
  das Modell kann bei Bedarf weiter pollen (erzeugt KEINE Karte) und so den Abschluss
  lernen und `get_transcript` holen. Damit funktioniert der Flow auch, wenn die Bruecke
  tot ist.

### 6.4 Byte-Identitaets-Invariante (MCP_UI_ENABLED=false)

`uiRendererFor` liefert bei `enabled=false/null` `null`; `enableWidgetUi` liefert dann
`{}` (kein `_meta`). Nach dem Umbau: `place_call` (jetzt `uiTool`) traegt bei Flag=aus
kein `_meta`, der Textblock bleibt. `get_call_status`/`get_transcript` tragen dann in
BEIDEN Faellen kein `_meta` (Vereinfachung der Invariante, kein Bruch). Die einzige
minimale Neuerung bei Flag=aus: `place_call` schickt jetzt IMMER `structuredContent` mit
(wie alle anderen uiTools schon) — vom Host ohne Widget ignoriert, unschaedlich.

## 7. Pre-Mortem (Risiken vorab benannt)

- **Bruecke tot, Karte haengt auf "dialing", Modell holt nie get_transcript.**
  Entschaerft durch 6.3: `get_call_status` bleibt modell-sichtbar (Fallback-Poll ohne
  Karte) + 15s-Timeout + initialer Status sichtbar.
- **Cross-Tenant-/Gate-Umgehung ueber die Bruecke.** KEIN neuer Angriffsvektor: der
  Widget-Poll geht ueber `/mcp` mit derselben Auth wie ein Modell-Poll;
  `get_call_status`/`get_transcript` sind bereits fail-closed tenant-scoped (I5),
  `cancel_call` write-scoped (I6). Kein Seitenkanal — nur die vom Host bereitgestellte
  Tool-Bruecke.
- **DSGVO: Summary im Widget nach Roh-Transkript-Purge.** Das Widget zieht Summary nur
  ueber `get_transcript` (dessen Whitelist `pickTranscript` das Roh-Transkript NICHT
  durchreicht). Keine neue Datenflaeche.
- **place_call-Schema-Mismatch** beim Umstieg `tool()`->`uiTool()`. Entschaerft: volles
  `CALL_OUTPUT`-Zod-Schema + Vorher/Nachher-Snippet in der Kette (W2).
- **Safety-Gates von place_call.** Bleiben UNBERUEHRT — Allowlist/Denylist/Land/Budget/
  Signatur/Disclosure sitzen in `src/server.js` `/api/calls`, nicht in mcp-tools. Der
  Umbau aendert nur Widget-Anhang + Beschreibung.
- **Probe-Entfernung bricht Flags/Tests.** Vollstaendige Fundstellen-Liste in W3 inkl.
  `.env.example` (grep-AC deckt src/ test/ .env.example ab).

## 8. Harte Invarianten (die Kette darf sie NIE verletzen)

Regel-1-Gates (Allowlist/Denylist/Land/Budget global+pro-Tenant/Signatur fail-closed),
Disclosure-Satz, Tenant-Isolation (I5/I6 fail-closed), DSGVO-Roh-Transkript-Purge,
Byte-Identitaet bei `MCP_UI_ENABLED=false`, kein Secret-Leak, kein neuer offener Endpunkt,
geteilter `widget-bind.js` byte-unberuehrt.

## 9. Phasen-Ueberblick (Details in `tasks/mcp-ui-live-widget-chain.md`)

| Phase  | Autonom? | Kurz                                                                       |
| ------ | -------- | -------------------------------------------------------------------------- |
| **W0** | ja       | Charakterisierungs-Baseline: heutigen Spam-Zustand in Asserts pinnen (test-only) |
| **W1** | ja       | `call.html` bauen: inline Bruecke + Self-Poll-Lebenszyklus + Diagnose + Fallback + Cancel; `WIDGET_CALL` im Katalog |
| **W2** | ja       | Tool-Rewiring: `place_call`->`uiTool(WIDGET_CALL)`+structuredContent; `get_call_status`/`get_transcript` verlieren `_meta`; Beschreibungen entschaerft; ALLE betroffenen Tests aktualisiert |
| **W3** | ja       | Aufraeumen (kein toter Code): Probe-Spike + get_call_result + call-result.html + transcript.html-Widget + call-status.html + tote Konstanten raus |
| **W4** | **nein (Owner)** | `git push upstream master` (PASS = push ok + Commit-Hash); EIN Live-Test in Claude |

Reihenfolge W0->W1->W2->W3->W4. Jede autonome Phase = EIN `phase-impl-lean`-Lauf,
dualer Sonnet-Review als Gate (S1/S2=Blocker), Merge im Lead. **Alle Subagenten auf
Sonnet, nur der Lead auf Opus.**

## 10. Deploy / Betrieb

- Live = **`git push upstream master`** (Render deployt jonas986, NICHT origin —
  [[deploy-repo-split]]). Lokaler master ist voraus; der Push ist W4.
- `MCP_UI_ENABLED` muss in Render gesetzt/Default true sein.
- W4-Live-Test ist NICHT autonom — Owner-Gate. Diskriminatoren: genau EINE Karte, die
  sich aktualisiert; Diagnose zeigt wirksames Format; Cancel deaktiviert sich nach Ende.
