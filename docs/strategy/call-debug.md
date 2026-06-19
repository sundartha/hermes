# Strategie: Anruf-Debugging — "Agent legt sofort auf & hoert nichts" (Outbound)

> Erstellt 2026-06-19 durch ein 3-straengiges Agent-Team (Outbound-Code-Pfad,
> Provider-Adapter/Render, Tests+Config+Log-Zugang), anschliessend vom Lead
> erstkonsumiert und gegen den realen Code verifiziert. Methode: 5-Why, Wurzel
> statt Symptom, Pre-Mortem. Schwesterdokument fuer den INBOUND-Fall:
> `BERICHT-INBOUND-STT-2026-06-16.md`. Konvention: Deutsch ohne Umlaute.
>
> **Dies ist ein Analyse-/Strategie-Dokument. Es wurde KEIN Code geaendert.**

---

## 0. Symptom (wie gemeldet)

Outbound-Anruf ueber den MCP-Server, Engine `budget` (Live-Default, `config.js:195`):

- Agent KANN den Anruf starten (`place_call` -> `/api/calls` -> `originateCall`). [OK]
- Agent REDET, wenn der Empfaenger abnimmt — der Disclosure-Satz kommt an. [OK]
- Agent **legt sofort wieder auf** nach dem ersten Satz. [DEFEKT] (Symptom A)
- Agent **kann den Angerufenen nicht hoeren** (kein STT / keine Audio-Eingabe). [DEFEKT] (Symptom B)

Zusaetzlich: ein Render-MCP ("Map-Server", `.mcp.json`) macht die Render-Logs
(gerenderte TwiML/TeXML-Antworten, Diagnose-Zeilen) zugaenglich — das zentrale
Beobachtungsinstrument fuer die Live-Diagnose (Abschnitt 6).

---

## 1. Ziel + Akzeptanzkriterien

**Ziel:** Ein Outbound-Anruf fuehrt ueber den ersten Satz hinaus ein echtes
Zwei-Wege-Gespraech: der Agent nennt nach der Pflicht-Offenlegung sein Anliegen,
**hoert** die Antwort des Angerufenen und reagiert inhaltlich, bis der Auftrag
erledigt ist oder die Max-Dauer greift.

**Ein Anruf gilt als "funktionsfaehig", wenn ALLE Kriterien erfuellt sind:**

| # | Akzeptanzkriterium | Wie gemessen |
|---|---|---|
| AK-1 | Nach dem Disclosure-`<Say>` wird im selben Antwort-Dokument ein `<Gather>` (STT) gerendert — kein `<Hangup>` als erster Folge-Knoten | Render-Log / TeXML-Body des `/voice/outbound`-Webhooks |
| AK-2 | Der Call bleibt nach dem ersten Satz `active` (legt NICHT auf) | Call-Status / `status`-Webhook |
| AK-3 | Mindestens **eine** `role:caller`-Transkriptzeile entsteht (Agent hat gehoert) | Transkript / `[turn-recv]`-Log mit nicht-leerem Speech-Feld |
| AK-4 | Der Agent antwortet **inhaltlich** auf das Gehoerte (kein Re-Greet, keine Wiederhol-Schleife) | Transkript-Verlauf |
| AK-5 | Gilt fuer den **Live-Provider** (Telnyx, sofern `TELNYX_NUMBER` produktiv) — und bricht Twilio nicht | Live-Test + Test-Suite gruen |
| AK-6 | Keine Sicherheits-/Disclosure-Regression: Offenlegung bleibt erster Satz, Signatur-Gate fail-closed, Max-Dauer/Budget unangetastet | Test-Suite + Code-Review |

Negativ-Kriterium (Pre-Mortem): Kein Fix wird als verifiziert betrachtet, der
nur die Test-Suite gruen macht, aber nicht durch eine **Live-Log-Beobachtung**
einem konkreten Ursachen-Ast zugeordnet ist (Abschnitt 9, Hartes Gate).

---

## 2. Verifizierte Befundlage (Beleg, nicht Vermutung)

Alle Zeilen gegen den realen Code gelesen (Worktree `antonio20045-github`).

### 2.1 Der Outbound-Antwort-Pfad (`/voice/outbound`, Budget-Engine)
`src/server.js:488-514`:
```js
app.post("/voice/outbound", async (req, res) => {
  const call = store.getCall(req.query.callId);
  if (!call) return res.type("text/xml").send(render([hangupD()]));   // :489-491
  ...
  if (config.voiceEngine === "realtime") { ...streamDirectives... }     // :497-499
  const disclosure = disclosureSentence(call);                          // :504
  store.addTranscript(call.id, "agent", disclosure);                    // :505
  try {
    const { speech, endCall } = await agentTurn(call, null);            // :507
    const tail = endCall ? [sayD(speech), hangupD()] : turnDirectives(call, speech); // :508
    res.type("text/xml").send(render([sayD(disclosure), ...tail], call.provider));   // :509
  } catch (err) {
    console.error("[outbound]", err.message);                          // :511
    res.type("text/xml").send(render([sayD(disclosure), hangupD()], call.provider)); // :512
  }
});
```

### 2.2 Der Turn-Direktiven-Bauer (STT wird HIER aktiviert)
`src/server.js:353-358`:
```js
function turnDirectives(call, text) {
  const isTelnyx = call.provider === "telnyx";
  const base = isTelnyx ? config.publicUrl : "";          // Telnyx absolut, Twilio relativ
  const action = `${base}/voice/turn?callId=${call.id}`;
  return [gatherD({ promptText: text, action }), redirectD(action)];
}
```
Nur dieser Pfad erzeugt ein `<Gather>` mit STT. Wird `tail` zu `[sayD(speech),
hangupD()]` (endCall) oder der Fehlerpfad genommen, gibt es **kein** `<Gather>`.

### 2.3 STT-Attribute der Renderer (beide Provider aktivieren STT korrekt)
- Telnyx (`telnyx/render.js:31-36`): `input="speech" language="de"
  transcriptionEngine="Deepgram" model="deepgram/nova-3"`. Kommentar `:20-27`
  haelt fest: `transcriptionEngine` ist PFLICHT (ohne sie transkribiert Telnyx
  nicht — der Inbound-Bug), Deepgram ist ein **Premium-Add-on** (muss im Telnyx-
  Account freigeschaltet sein), `de` (nicht `de-DE`) ist fuer Deepgram zwingend.
  `speechTimeout`/`actionOnEmptyResult` sind bewusst NICHT gesetzt (Twilio-spezifisch).
- Twilio (`twilio/render.js:17-23`): `input="speech" language="de-DE"
  speechTimeout="auto" speechModel="deepgram_nova-2-general" actionOnEmptyResult="true"`.

### 2.4 Der Gespraechs-Turn / Hangup-Quelle
- `agentTurn` (`src/claude.js:170-229`): baut bei Outbound die Pseudo-User-Zeile
  `"[Der Angerufene hat abgenommen. Beginne das Gespraech.]"` (`:182-184`), ruft
  Claude (`config.claudeModel` = Haiku) mit `toolDefs` inkl. `end_call` (`:86-94`).
  Tool-Loop max 4 Runden (`:193`). **`end_call` -> `endCall=true`** (`:216`).
- Outbound-System-Prompt (`src/claude.js:65-72`), letzter Satz:
  `"... Bei Unklarheit beende das Gespraech hoeflich."` (`:72`). Das ist eine
  explizite Instruktion, die das Modell im kontextarmen ERSTEN Turn Richtung
  `end_call` druecken kann.

### 2.5 Der Turn-Endpunkt + die Live-Diagnose-Spur (geteilt In/Out)
`src/server.js:452-485`:
- `[turn-recv]`-Log VOR dem Guard (`:457-459`) — zeigt `callId=FEHLT`, wenn der
  Query-String verloren geht; nur Feld-NAMEN + Wert-LAENGEN (kein PII).
- Guard `:461-465`: Call nicht aufloesbar/inaktiv -> `render([hangupD()])` (bare Hangup).
- `extractSpeech` provider-bewusst (`:252-256`): Telnyx `Transcript`, Twilio
  `SpeechResult`. Leeres Ergebnis + vorhandenes Caller-Transkript -> Rueckfrage-
  Schleife (`:469-473`); leer ohne Caller-Transkript -> `agentTurn(call, null)`
  (Agent redet weiter, ohne gehoert zu haben).

### 2.6 Originate ist absolut — und der entscheidende Schluss daraus
`src/server.js:724`: `url: ${config.publicUrl}/voice/outbound?callId=${call.id}`
(absolut, **mit Query-String**). `config.publicUrl` ist non-leer, sonst verweigert
der Boot-Guard den Start (`config.js:217`).

> **Schluss (wichtig fuer das Ursachen-Ranking):** Weil der Disclosure-Satz
> hoerbar ankommt, wurde `/voice/outbound?callId=...` vom Provider **mit
> aufgeloestem `callId`** erreicht — sonst haette `:489-491` (`if (!call)`) sofort
> und ohne Disclosure aufgelegt. Damit ist bewiesen: der `?callId=`-Query-String
> ueberlebt beim Live-Provider auf der ANTWORT-Leg. Das **schwaecht** die
> Hypothese "Telnyx verliert `?callId=`" als Ursache fuer *dieses* Symptom
> (Auflegen nach erstem Satz) und **staerkt** die Hypothesen, bei denen schon im
> ersten Antwort-Dokument gar kein `<Gather>` gerendert wird (Trigger 1/2 unten).

---

## 3. Root-Cause-Analyse (5-Why)

### 3.1 Gemeinsame Wurzel beider Symptome
Symptom A und B kollabieren auf **eine** strukturelle Tatsache:

> Wenn das vom `/voice/outbound`-Webhook gerenderte Dokument nach dem
> Disclosure-`<Say>` mit `<Hangup/>` endet und **kein `<Gather>`** enthaelt,
> dann (A) legt der Provider nach dem Satz auf (Dokumentende) UND (B) wird STT
> nie scharf geschaltet -> der Agent ist taub. **B ist Folge von A.**

Genau dieses No-Gather-Dokument entsteht auf zwei Wegen — `:508` (`endCall=true`)
und `:512` (Fehlerpfad).

### 3.2 Fuenf-Why — Symptom A (Sofort-Auflegen nach erstem Satz)

1. **Warum legt der Agent nach dem ersten Satz auf?**
   Das `/voice/outbound`-Dokument enthaelt kein `<Gather>`/`<Redirect>` nach dem
   `<Say>` -> bei TwiML/TeXML endet damit der Call (Dokumentende = Auflegen).
2. **Warum fehlt das `<Gather>`?**
   `tail` wurde zu `[sayD(speech), hangupD()]` statt `turnDirectives(...)`
   (`server.js:508`) — ODER der `catch`-Pfad rendert `[sayD(disclosure),
   hangupD()]` (`:512`).
3. **Warum wird `tail` zum Hangup-Zweig?**
   Entweder `agentTurn(call, null)` liefert `endCall=true` (Claude ruft im
   ersten Turn `end_call`, `claude.js:216`), oder `agentTurn` **wirft** (Anthropic-
   Fehler/Token-Meter/etc., `claude.js:194-201`).
4. **Warum wuerde der erste Turn schon `end_call` ausloesen / werfen?**
   - `end_call`: Der kontextarme Opener (`"[Der Angerufene hat abgenommen.
     Beginne das Gespraech.]"`, `claude.js:182-184`) plus die Prompt-Instruktion
     `"Bei Unklarheit beende das Gespraech hoeflich."` (`claude.js:72`) koennen
     ein kleines Modell (Haiku) dazu bringen, sofort abzuschliessen.
   - Wirft: jeder Fehler im Anthropic-Call/Metering im allerersten Outbound-Turn.
5. **Wurzel.**
   - *Technisch:* Der Outbound-Antwort-Webhook macht **synchron im Webhook** einen
     LLM-Turn (`server.js:507`) und macht das Vorhandensein des `<Gather>` von
     dessen Ergebnis abhaengig. Es gibt **keinen Sicherungsboden**, der garantiert,
     dass auf den ersten Turn IMMER zugehoert wird, bevor aufgelegt werden darf.
   - *Prozess:* Das tatsaechliche Webhook-Ergebnis (endCall? throw? gerendertes
     Markup?) ist im Live-Log **bisher nur teilweise** beobachtbar (`[outbound]`
     loggt nur den Fehlerfall, nicht den endCall-Fall) — Diagnose vor Fix fehlt.

### 3.3 Fuenf-Why — Symptom B (Agent hoert nichts)

1. **Warum hoert der Agent nichts?**
   Es kommt keine `role:caller`-Zeile zustande -> `agentTurn` bekommt nie
   echten `callerText`.
2. **Warum kommt kein Caller-Text?**
   Drei sich nicht ausschliessende Ursachen:
   (a) Es gab nie ein `<Gather>` (Folge von Symptom A) — dann kann STT gar nicht
       laufen. **Wahrscheinlichster Fall hier.**
   (b) Ein `<Gather>` lief, aber der Telnyx-`Transcript` ist leer (Deepgram-Add-on
       nicht freigeschaltet / Modell/Sprache nicht bedient -> stilles Scheitern,
       `telnyx/render.js:20-27`).
   (c) Der Folge-POST an `/voice/turn` verliert `?callId=` -> Guard-Hangup
       (`server.js:461-465`), Speech erreicht `agentTurn` nie.
3. **Warum konnten wir den Ast bisher nicht festnageln?**
   Der reale Provider-POST ist nur **live** beobachtbar; die Test-Suite pinnt nur
   das *isoliert gerenderte* Markup und das *serverseitige Lesen*, nicht das, was
   Telnyx/Twilio tatsaechlich zuruecksenden (Abschnitt 5).
4. **Warum trifft (b)/(c) hier evtl. NICHT zu?**
   Siehe Abschnitt 2.6: der Disclosure kommt an -> `?callId=` ueberlebt auf der
   Antwort-Leg -> (c) ist geschwaecht; und wenn nie ein `<Gather>` gerendert wird
   (Symptom A), kommt (b) gar nicht erst zum Tragen. -> (a) dominiert.
5. **Wurzel.**
   Identisch zu A: fehlt das `<Gather>` (Trigger 1/2), ist die Taubheit eine reine
   Folge. Liefe ein `<Gather>` und der Agent bliebe trotzdem taub, waere die Wurzel
   der bereits dokumentierte Inbound-STT-Mechanismus (Deepgram still / callId-
   Verlust) — derselbe geteilte `/voice/turn`-Pfad.

### 3.4 Trigger-Tabelle (Diagnose-Schluessel fuer das Live-Log)

| Trigger | Mechanik (Code) | Provider | Live-Signatur im Render-Log |
|---|---|---|---|
| **T1 — LLM beendet 1. Turn** | `agentTurn` -> `endCall=true` (`claude.js:216`), getrieben von Prompt `:72` + Opener `:182-184` -> `server.js:508` rendert `[Say,Say,Hangup]` | beide | **kein** `[outbound]`-Error; Transkript = Disclosure **+ 1 Anliegen-Satz**, dann Ende |
| **T2 — agentTurn wirft** | Anthropic-/Meter-Fehler -> `catch` `server.js:511-512` rendert `[Say(disclosure),Hangup]` | beide | `[outbound] <err.message>`; Transkript = **nur** Disclosure, dann Ende |
| **T3 — `?callId=` verloren (Folge-Turn)** | `<Gather action>` POST ohne Query -> `server.js:461-465` bare Hangup | Telnyx-Verdacht | `[turn-recv] callId=FEHLT` |
| **T4 — Telnyx-STT still** | Deepgram nicht aktiv/Modell/Sprache -> leerer `Transcript` -> `extractSpeech` "" -> Re-Greet/Schleife | Telnyx | `[turn-recv] callId=<ok>` aber Speech-Feld fehlt/Laenge 0 |

**Beobachtbarer Diskriminator T1 vs T2 (ohne Code-Aenderung sofort nutzbar):**
hoert der Anrufer **zwei** Saetze (Offenlegung **+** Anliegen) und dann Stille/
Auflegen -> **T1**. Hoert er **nur** die Offenlegung und dann sofort weg -> **T2**.

### 3.5 Wahrscheinlichkeits-Ranking (bis zur Live-Beobachtung)
Fuer das gemeldete Symptom "redet, legt nach erstem Satz auf, hoert nichts":

1. **T1** (LLM ruft `end_call` im ersten Turn) — am konsistentesten mit
   "Disclosure + ein Satz, dann weg"; provider-unabhaengig; Prompt `:72` ist ein
   konkreter Treiber.
2. **T2** (agentTurn wirft) — gleich strukturell, aber dann fehlt der Anliegen-Satz;
   per `[outbound]`-Log sofort falsifizierbar.
3. **T4** (Telnyx-Deepgram still) — erklaert die Taubheit, falls doch ein `<Gather>`
   rendert; passt aber schlecht zum *sofortigen* Auflegen (wuerde eher re-greeten).
4. **T3** (`?callId=`-Verlust) — durch den Schluss in 2.6 geschwaecht (Antwort-Leg
   traegt callId), aber nicht null: der `<Gather action>`-POST kann sich anders
   verhalten als die Antwort-Url.

---

## 4. Architektur-Skizze des Call-Flows (mit Fehlerstellen)

```
 MCP place_call (mcp-tools.js)
   |  POST /api/calls  (Safety-Gates: Allowlist/Budget/Land/Limit, server.js:636-749)
   v
 originateCall(provider)  url = {publicUrl}/voice/outbound?callId=ID   [absolut+Query] (server.js:724)
   |
   v
 Empfaenger nimmt ab  ->  POST /voice/outbound?callId=ID   (server.js:488)
   |
   |  callId aufgeloest? --nein--> [Hangup]               (server.js:489-491)
   |  engine==realtime?  --ja----> <Connect><Stream>      (server.js:497-499)  ~~ Telnyx-Media live unbestaetigt
   v ja(budget)
 disclosure = disclosureSentence(call)  -> <Say>          (server.js:504-505)
   |
   v
 agentTurn(call, null)  (claude.js:170)  -- Haiku, Tool-Loop, Prompt ":72" --.
   |                                                                         |
   |  +-- endCall==true (end_call, claude.js:216) --> tail=[Say,Hangup] ===> ### FEHLERSTELLE F1 (T1)
   |  +-- wirft (Anthropic/Meter)         --> catch --> [Say,Hangup]   ===> ### FEHLERSTELLE F2 (T2)
   |  +-- normal                          --> tail=turnDirectives(...) --> <Gather>+<Redirect>  (OK)
   v
 render([<Say>disclosure, ...tail], provider)            (server.js:509)
   |
   |   ...Angerufener spricht (nur wenn <Gather> da)...
   v
 POST /voice/turn?callId=ID  (server.js:452)
   |  [turn-recv]-Log  (server.js:457-459)
   |  callId aufloesbar? --nein--> [Hangup]               (server.js:461-465) ### FEHLERSTELLE F3 (T3)
   v
 extractSpeech(provider)  Telnyx:Transcript / Twilio:SpeechResult  (server.js:252-256)
   |  leer? --(Telnyx Deepgram still)--> Re-Greet/Schleife (server.js:469-475) ### FEHLERSTELLE F4 (T4)
   v
 agentTurn(call, heard) -> <Gather> (weiter) | [Say,Hangup] (endCall)         (server.js:475-477)
```

Fehlerstellen: **F1/F2** liegen im Outbound-Webhook und erklaeren das gemeldete
Symptom am direktesten; **F3/F4** sind der geteilte Turn-Pfad (auch Ursache des
Inbound-Bugs, `BERICHT-INBOUND-STT-2026-06-16.md`).

---

## 5. Was die Tests beweisen — und was nicht

**Gepinnt (Beleg, dass Bausteine korrekt sind):**
- `telnyx-render.test.js`: `<Gather ... transcriptionEngine="Deepgram"
  model="deepgram/nova-3" ...>` byte-exakt + Regression "ohne transcriptionEngine
  kein SpeechResult".
- `directive-render.test.js`: Twilio-`<Gather>` mit `actionOnEmptyResult`/`speechTimeout`.
- `disclosure-outbound.test.js`: im **Fehlerpfad** steht der Disclosure-`<Say>` vor
  `<Hangup/>` (Offenlegung zuerst).
- `onboarding-outbound.test.js`: Telnyx-Provider-Wahl + Originate-Pfad (Url nur per
  Regex `/voice/outbound?callId=`, **kein** Absolut-URL-Check).
- `place-call-error.test.js`: Originate-Fehler -> generische 500 ohne Provider-Leak.

**Luecken (genau hier wohnt der Bug):**
1. **Kein Test prueft den Outbound-ERFOLGS-Pfad** (`agentTurn` gelingt) auf
   `<Gather>`-Praesenz nach dem Disclosure. Die No-Gather-Pfade (endCall/throw)
   sind unbeobachtet -> Symptom A+B faellt durchs Raster.
2. **Kein Test fuer `/voice/outbound` mit `provider=telnyx`** auf den TeXML-Body
   (Gather da? action absolut? STT-Attribute?).
3. **Reales Provider-Verhalten live unbestaetigt:** Telnyx-Outbound/-Media
   (`.env.example:19-27`, `telnyx/voice.js`, `telnyx/media.js`), Deepgram-
   Freischaltung, Query-Erhalt bei `<Gather action>`.

---

## 6. Diagnose-Instrument: Map-Server / Render-Log-Zugang

- Der "Map-Server" ist der in `.mcp.json` konfigurierte **Render-MCP**
  (`https://mcp.render.com/mcp`, Auth `Bearer ${RENDER_API_KEY}`). Ueber ihn sind
  Service-Logs der Render-Deployment (Region Frankfurt, `render.yaml`) lesbar —
  inkl. der gerenderten TwiML/TeXML-Antworten und der Diagnose-Zeilen.
- **Status im aktuellen Worktree-Prozess:** `RENDER_API_KEY` ist NICHT gesetzt ->
  der Render-MCP ist aus dieser Session **nicht** live abrufbar. Der Log-Zugang
  ist damit **Betreiber-Schritt** (Schluessel im Live-Agent-/Render-Umfeld), was
  zum bestehenden harten Gate (Abschnitt 9) passt.
- **Vorhandene Voice-Log-Zeilen** (was live zu lesen ist): `[boot] ... commit=` +
  `Voice-Engine: budget` (Start), `[turn-recv] callId=.. fields=..`
  (`server.js:457-459`), `[turn-recv] -> frueher Hangup` (`:463`), `[outbound]
  <err>` (`:511`, nur Fehlerfall), `[turn] <err>` (`:479`), `[place_call] ..` (Originate).

> **Diagnose-Luecke:** der **endCall-Fall (T1)** erzeugt KEINE Log-Zeile (nur der
> throw-Fall T2 loggt `[outbound]`). Um T1 sauber von T2/Normal zu trennen, fehlt
> eine minimale Instrumentierung des Outbound-Erfolgspfads (Phase 1).

---

## 7. Pre-Mortem-Risiken (ein Jahr in der Zukunft, der Fix war falsch)

| Risiko | Szenario | Gegenmassnahme in dieser Strategie |
|---|---|---|
| **Ungewollte Anrufe** | Live-Test/Repro loest echte Calls aus; ein "Fix" laesst den Agent in Schleifen weiter-waehlen | Live-Tests NUR gegen Allowlist-Nummer (Owner), je 1 kurzer Call; Allowlist/Budget/Max-Dauer-Gates unangetastet (AK-6); Offline-Repro (Phase 0) ohne echte Telefonie |
| **Kostenexplosion** | endless Re-Greet/Redirect-Schleife oder Deepgram-Minuten ausserhalb des Budget-Guards | Max-Dauer-Timer bleibt (`server.js:389-396`); jeder Fix muss eine **Abbruchbedingung** haben; Deepgram-Minuten als Betreiber-Kostenrisiko dokumentiert (STATUS Abschnitt 3) |
| **Secret-Leak** | `RENDER_API_KEY`/Provider-Keys in Logs/Doku/Antworten | Keine Secrets in Logs/Doc; `[turn-recv]` loggt nur Feld-NAMEN+LAENGEN; Render-Key nur via Env (Regel 4) |
| **Transkript-/PII-Leak** | Diagnose-Logging schreibt Roh-Speech in die Render-Logs (durchbricht Datenminimierung) | Diagnose-Logs PII-frei (nur Laengen/Booleans); **Pflicht-Cleanup** aller Temp-Logs nach Verifikation (Phase 6) |
| **Provider-API-Missbrauch** | Falsche TeXML/Originate-Annahmen -> Telnyx sperrt/drosselt; Realtime-Media falsch verdrahtet | Telnyx-Realtime bleibt hinter Flag bis WS-Echo-Test (STATUS 1c); kein Fix am `realtime`-Pfad in diesem Strang; Aenderungen nur am Budget-Pfad |
| **Disclosure-Regression** | Ein Fix verschiebt/entfernt den Offenlegungssatz | Disclosure bleibt erster Knoten in ALLEN Pfaden (Regel 2); bestehender `disclosure-outbound.test.js` + erweiterter Test (Phase 0) |
| **Blind-Fix (Wiederholung der Inbound-Falle)** | Dritter Fix-Versuch ohne Live-Beweis (wie Inbound 3x) | Hartes Gate (Abschnitt 9): kein Fix ohne klassifizierten Trigger aus dem Live-Log |

---

## 8. Phasenplan (Diagnose zuerst, dann gezielter Fix)

Grundprinzip: **erst die Wurzel verifizieren (Phasen 0-2), dann NUR den
bestaetigten Trigger fixen (Phase 3.x).** Fix-Phasen sind **bedingt** — eine
Phase wird nur ausgefuehrt, wenn Phase 2 ihren Trigger nachgewiesen hat.

Regel: Zwei Phasen, die dieselbe Datei anfassen, sind NIE parallelisierbar.

| Phase | Kurz | Dateien/Bereiche | Parallel? | Abhaengt von |
|---|---|---|---|---|
| **P0** | Offline-Repro-Test (No-Gather-Pfade pinnen) | `test/outbound-greeting.test.js` (neu), evtl. `test/helpers.js` | **ja** (mit P1; disjunkt) | — |
| **P1** | Diagnose-Instrument Outbound-Erfolgspfad | `src/server.js` | **nein** (server.js auch in P3b/P3c/P6) | — |
| **P2** | Live-Log-Diagnose + Trigger-Klassifikation (HARTES GATE) | keine (Betrieb/Render-MCP) | **nein** (Gate, alle warten) | P1 deployt |
| **P3a** | Fix T1: 1. Turn darf nicht auflegen, bevor gehoert wurde | `src/claude.js` | ja (zu P3c/P3d; disjunkt) | P2==T1 |
| **P3b** | Fix T2: Fehlerpfad rendert Retry-`<Gather>` statt stummem Hangup | `src/server.js` | **nein** (server.js) | P2==T2 |
| **P3c** | Fix T3: `callId` in den Pfad statt Query (`/voice/turn/:callId`) | `src/server.js` (+ Renderer-action-Bau) | **nein** (server.js) | P2==T3 |
| **P3d** | Fix T4: Telnyx-STT freischalten/Fallback-Engine/Modell | `src/telephony/adapters/telnyx/render.js` (+Test); Telnyx-Portal (Betrieb) | ja (zu P3a; disjunkt) | P2==T4 |
| **P4** | Re-Test offline (alle Fixes gruen) | `test/*` (betroffene) | **nein** (haengt an P3.x) | P3.x |
| **P5** | Live-Re-Verifikation (AK-1..AK-5) | keine (Betrieb) | **nein** (Gate) | P4 |
| **P6** | Cleanup: alle Temp-Diagnose-Logs entfernen | `src/server.js` | **nein** (server.js, zuletzt) | P5 |

### Phasen-Details + Akzeptanz pro Phase

**P0 — Offline-Reproduktion (test-only).**
Neuer Test, der `/voice/outbound` (provider=telnyx UND twilio) lokal gegen einen
gefakten `agentTurn` faehrt (analog zum Anthropic-Hook in bestehenden Tests) und
drei Faelle pinnt: (i) normaler Turn -> Body enthaelt `<Gather>` nach dem
Disclosure; (ii) `endCall=true` -> Body enthaelt **kein** `<Gather>` (heutiger
Bug, als Regression dokumentiert); (iii) `agentTurn` wirft -> Disclosure + Hangup.
*Akzeptanz:* Test gruen, reproduziert die No-Gather-Mechanik offline; `node --test`.
*Parallel:* ja, disjunkt zu P1.

**P1 — Diagnose-Instrument (src/server.js).**
EINE zusaetzliche, PII-freie Log-Zeile im Outbound-Erfolgspfad, analog `[turn-recv]`:
z.B. `[outbound-recv] callId=.. engine=budget endCall=<bool> tail=<gather|hangup>`
(nur Booleans/Enums, kein Speech). Schliesst die Diagnose-Luecke aus Abschnitt 6
(T1 wird sichtbar). Temporaer, mit demselben "Phase 6 entfernen"-Vermerk.
*Akzeptanz:* Unit-Test, dass die Zeile die Felder enthaelt UND kein Roh-Speech/PII
leakt; `npm test` gruen. *Parallel:* nein (server.js).

**P2 — Live-Log-Diagnose (HARTES GATE, Betrieb).**
P1 deployen. EIN kurzer Owner-Allowlist-Outbound-Testanruf. Render-Log via
Map-Server (Render-MCP) lesen und ueber die Trigger-Tabelle (3.4) klassifizieren:
`[outbound]`-Error? -> T2. `[outbound-recv] endCall=true tail=hangup`? -> T1.
`[turn-recv] callId=FEHLT`? -> T3. `callId=ok` + Speech-Laenge 0? -> T4.
*Akzeptanz:* genau ein Trigger (oder mehrere) dokumentiert mit Log-Beleg. **Ohne
diesen Beleg wird KEINE Fix-Phase gestartet.** *Parallel:* nein.

**P3a — Fix T1 (src/claude.js).**
Sicherungsboden: Im ersten Outbound-Turn darf `end_call` den Call nicht beenden,
bevor mindestens einmal zugehoert wurde (z.B. `end_call` ignorieren/verzoegern,
solange keine `role:caller`-Zeile existiert), und/oder Prompt `:72` so schaerfen,
dass "Bei Unklarheit beende" nicht im Opener feuert. Caller von `agentTurn`
pruefen (Budget- UND Realtime-Pfad nutzen es — CLAUDE.md).
*Akzeptanz:* Offline-Test: gefakter `end_call` im 1. Turn -> Dokument enthaelt
trotzdem `<Gather>` (legt nicht auf); Disclosure bleibt erster Knoten; `npm test`.
*Parallel:* ja zu P3c/P3d (disjunkte Dateien), nein zu anderen claude.js-Phasen.

**P3b — Fix T2 (src/server.js).**
Outbound-`catch` rendert statt `[Say(disclosure), Hangup]` einen
Disclosure + Retry-`<Gather>` (oder kontrollierter Redirect mit Zaehler), damit
ein transienter API-Fehler den Call nicht taub killt — mit Abbruchbedingung gegen
Endlosschleife (Kostenrisiko, Abschnitt 7).
*Akzeptanz:* Offline-Test: `agentTurn` wirft -> Body = Disclosure + `<Gather>`
(kein stummer Hangup), aber begrenzte Retries; `npm test`. *Parallel:* nein (server.js).

**P3c — Fix T3 (src/server.js).**
`callId` von Query auf Pfad umstellen (`/voice/turn/:callId`), damit kein Provider
den Parameter verlieren kann; `turnDirectives`/Renderer-`action` entsprechend.
Betrifft auch Inbound (geteilter Pfad) -> Inbound-Tests mitziehen.
*Akzeptanz:* `[turn-recv]` zeigt live nie mehr `callId=FEHLT`; bestehende
Turn-/Render-Tests angepasst gruen. *Parallel:* nein (server.js).

**P3d — Fix T4 (telnyx/render.js + Telnyx-Portal).**
Betrieb: Deepgram im Telnyx-Account freischalten. Falls weiter still: Fallback
`transcriptionEngine="Telnyx"`/`"Google"` bzw. `model="deepgram/nova-2"` —
`language` passend (Deepgram: `de`). Snapshot-Test (`telnyx-render.test.js`)
mitziehen.
*Akzeptanz:* Live `[turn-recv]` zeigt nicht-leeres Telnyx-`Transcript`; Snapshot-
Test gruen. *Parallel:* ja zu P3a (disjunkte Datei), nein zu telnyx-render-Phasen.

**P4 — Offline-Re-Test (test/*).**
Alle in P3.x beruehrten Tests + P0-Repro gruen, kein Disclosure-/Gate-Regress.
*Akzeptanz:* `npm test` vollstaendig gruen. *Parallel:* nein (haengt an P3.x).

**P5 — Live-Re-Verifikation (Betrieb, GATE).**
Zweiter Owner-Allowlist-Testanruf. Pruefen: AK-1..AK-5 (Gather rendert, Call
bleibt aktiv, >=1 `role:caller`-Zeile, inhaltliche Antwort).
*Akzeptanz:* AK-1..AK-5 mit Log-/Transkript-Beleg erfuellt. *Parallel:* nein.

**P6 — Cleanup (src/server.js, ZULETZT).**
Alle temporaeren Diagnose-Logs (`[turn-recv]`, `[outbound-recv]`) entfernen — kein
dauerhaftes PII-Logging (Pre-Mortem). Signatur-/Disclosure-/Budget-Gates bleiben.
*Akzeptanz:* Temp-Logs weg, `npm test` gruen, kurzer Smoke. *Parallel:* nein (server.js, solo, letzte Phase).

### Parallelisierungs-Hinweis
- P0 ∥ P1 (Test-Dateien vs `server.js` — disjunkt).
- P3a ∥ P3d (`claude.js` vs `telnyx/render.js` — disjunkt), falls Phase 2 beide
  Trigger nachweist.
- P3b und P3c teilen `server.js` -> untereinander UND mit P1/P6 **niemals** parallel.
- P2/P5/P6 sind Gates/solo.

---

## 9. Hartes Gate (aus dem Pre-Mortem)

**Kein Fix wird implementiert oder gemergt, bevor Phase 2 (Live-Log) den
auslosenden Trigger mit Log-Beleg klassifiziert hat.** Der Inbound-Bug wurde 3x
ohne Live-Beweis "gefixt" (`455bd71`, `fb59001`, `04549c4`) — diese Strategie
verhindert den vierten Blind-Schuss. Temp-Diagnose-Logs nach P5 zwingend entfernen
(P6). Live-Tests nur Allowlist-Nummer, kurze Dauer, Gates unangetastet.

---

## 10. Offene / nur live verifizierbare Punkte

- Ob `agentTurn` im ersten Outbound-Turn `end_call` ruft (T1) — Haiku-Verhalten,
  nur per Transkript/`[outbound-recv]` (Phase 1) belegbar.
- Ob `agentTurn` wirft (T2) — nur `[outbound]`-Log.
- Ob Telnyx `?callId=` beim `<Gather action>`-POST haelt (T3) — `[turn-recv]`.
- Ob Telnyx-Deepgram aktiv ist (T4) — nicht aus dem Repo bestimmbar.
- Telnyx-Outbound/-Media generell "live unbestaetigt" (`.env.example:19-27`,
  `telnyx/voice.js`, `telnyx/media.js`); Realtime-Pfad bleibt hier ausgeklammert.

## 11. Quellen (Code, verifiziert)
- `src/server.js`: `:353-358` (turnDirectives), `:452-485` (/voice/turn +
  [turn-recv] + Guard), `:488-514` (/voice/outbound), `:252-256` (extractSpeech),
  `:724` (Originate-Url absolut).
- `src/claude.js`: `:65-72` (Outbound-Prompt, `:72` "Bei Unklarheit beende"),
  `:86-94` (end_call-Tool), `:170-229` (agentTurn), `:182-184` (Opener), `:216`
  (endCall=true).
- `src/telephony/adapters/telnyx/render.js`: `:20-27` (Kommentar STT/Deepgram),
  `:31-36` (GATHER_ATTRS). `src/telephony/adapters/twilio/render.js`: `:17-23`.
- `src/config.js`: `:97` (publicUrl), `:195` (voiceEngine budget), `:217` (Boot-Guard).
- `.mcp.json` (Render-MCP / Map-Server), `render.yaml` (Frankfurt, VOICE_ENGINE).
- Schwesterdoku Inbound: `BERICHT-INBOUND-STT-2026-06-16.md`,
  `PLAN-INBOUND-AUDIO-STT.md`, `STATUS-OFFENE-PHASEN.md` (1b).
