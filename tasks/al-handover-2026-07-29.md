# AL-Kette — Uebergabe an die naechste Session (2026-07-29)

**Bedienung:** frische Session im Repo oeffnen, diese Datei zuerst lesen, dann
`tasks/al-chain-state.md` (Verlauf) und `tasks/al-testcall-checklist.md` (offene Abnahmen).

---

## 1. Stand in einem Satz

**11 von 17 Phasen sind gemergt, getestet und LIVE.** Offen sind 6 Phasen, die alle an
**AL-P2** haengen — und AL-P2 hat beim ersten Messversuch **kein Ergebnis** geliefert, weil
der Testanruf nicht angenommen wurde. Der Fehler ist eingegrenzt, aber nicht behoben.

## 2. Was live ist

| | |
|---|---|
| Live-Commit (Soll nach Rueckbau) | `6fb0030` |
| Verifikation | `curl -s https://vodafone-agent.onrender.com/healthz` -> `commit` muss `6fb0030` sein |
| Deploy-Weg | `git push upstream master`, dann **manuell** `mcp__render__trigger_deploy` — der Dienst steht auf `autoDeploy: no` |
| Service-ID | `srv-d8m0fhflk1mc73bno570`, Workspace `tea-d8m0b9jeo5us73cvasg0` |

**Gemergt und live:** AL-P1, P3, P4, P5, P6, P8, P9, P10, P11, P12, P13 (3525 Tests gruen).
**Wirkt sofort ohne Flag:** kuerzere Eroeffnung (AL-P5), frueherer Tool-Loop-Ausstieg (AL-P4),
Budget-/Fristpruefung pro Runde (AL-P6), Diagnostik `callerTurns`/Conversation-UUID (AL-P1).
**Bleibt AUS:** `PRECALL_BRIEFING_ENABLED`, `RESEARCH_ENABLED`, `LOOKUP_ENABLED`,
`THINKING_SIGNAL_ENABLED`, `CONSULT_ENABLED`, `EVIDENCE_RETENTION_DAYS=0`.

## 3. ZUERST PRUEFEN: ist der Rueckbau wirklich durch?

Die letzte Sitzung hat den Spike-Schalter **voruebergehend** auf master gebracht und wieder
entfernt (`fab4eff` -> Revert `6fb0030`). Die naechste Session prueft **als Erstes** drei Dinge:

1. **Live-Commit** ist `6fb0030` (s. o.). Ist er `fab4eff`, ist der Rueckbau-Deploy nicht
   durchgelaufen -> `mcp__render__trigger_deploy` nachholen.
2. **Kein Spike-Symbol mehr im Code:**
   `grep -rn "sseSpikeDelayMsFor\|SPIKE_SILENCE_PATH" src/` muss **leer** sein.
3. **Alle drei DIDs auf der TeXML-App `Hermes` (`2982643896460248193`):**
   ```
   KEY=$(grep -E "^TELNYX_API_KEY=" .env | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')
   curl -s -H "Authorization: Bearer $KEY" "https://api.telnyx.com/v2/phone_numbers?page%5Bsize%5D=25"
   ```
   Stand beim Schreiben dieser Datei: **alle drei zurueck, verifiziert.**

## 4. AL-P2: was passiert ist und woran es haengt

**Ziel:** eine Frage beantworten — konsumiert der Telnyx-Assistant unseren SSE-Strom
inkrementell (dann ist AL-P7 gerechtfertigt) oder puffert er bis `[DONE]` (dann wird AL-P7
ersatzlos gestrichen und AL-P7b nimmt Weg B)?

**Gebaut und getestet:**
- `phase/al-p2-sse-spike` (`197595f`) — Verzoegerungs-Schalter im Shim, fail-closed:
  wirkt nur wenn Verzoegerung UND Zielnummer gesetzt sind UND `call.to === callee`;
  Verzoegerung ohne Zielnummer = Boot-Refusal (`productionFootguns`).
- `phase/al-p2b-spike-betrieb-fix3` (`6a879f8`) — Schweige-Route `/voice/spike-silence`
  plus Treiber `scripts/al-p2-spike-driver.mjs` (`--arm` / `--measure` / `--restore`,
  Dry-Run als Default, harte Verweigerung fuer `+17067101188` und den Live-Assistant).

**Der Messversuch (2026-07-29, ~11:58 UTC):**
- Anruf `call_ms6165ncegeb`, `+18643028341` -> `+15739090177`, ueber die regulaere
  `POST /api/calls` (alle Gates liefen).
- **Ergebnis: `answered_at` ist NULL, `telnyx_conversation_id` NULL, nach 31 s beendet.**
  Der Anruf wurde **nie angenommen** -> keine Messung, kein Urteil.

**Die Hypothesen, in dieser Reihenfolge zu pruefen (noch KEINE ist verifiziert):**
1. **Die Schweige-Route hat nicht geantwortet.** Telnyx ruft
   `POST https://app.sundartha.com/voice/spike-silence`. Pruefen: Render-Logs zum
   Anrufzeitpunkt nach dieser Route durchsuchen. Kam gar keine Anfrage an, ist die
   TeXML-App-Zuordnung schuld; kam eine und wurde 404/401 beantwortet, ist es die Route.
2. **Signaturpruefung.** Die Route prueft die Telnyx-Signatur (AL-P2b-3). Ist
   `TELNYX_PUBLIC_KEY` im Live-Dienst der richtige Wert, faellt sie sonst fail-closed durch.
3. **`To`-Abgleich.** Die Route antwortet nur, wenn `To == TELNYX_SSE_SPIKE_CALLEE`. Telnyx
   liefert `To` moeglicherweise in anderer Formatierung (mit/ohne `+`).
4. **Die Wegwerf-TeXML-App** `AL-P2 Spike Silence (WEGWERF)` (`3014656686179747728`) existiert
   noch und zeigt auf `https://app.sundartha.com/voice/spike-silence`. Sie ist **Muell**, wenn
   der Spike anders geloest wird — dann loeschen.

**Bekannte Sackgassen (nicht noch einmal versuchen):**
- **Wegwerf-Dienst mit `STORE_BACKEND=json` scheitert am Boot-Guard** — der json-Store ist im
  Hosting verboten (fluechtiges Dateisystem). Ein eigener Wegwerf-Dienst braucht eine eigene
  Postgres samt Schema-Migration und die Secrets `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TELNYX_SHIM_SHARED_SECRET`, `TELNYX_CALL_CONTROL_APP_ID`.
  Der angelegte Dienst `hermes-spike-al-p2` (`srv-d9kt9bm1egvs738asd0g`) **bootet nicht** und
  kann geloescht werden.
- **Der Treiber kann den Assistant nicht schreiben:** `--arm` und `--restore` scheitern beim
  Assistant-Schritt (`10015 Bad Request` bzw. `10026 Invalid parameter type`). Das
  **Umhaengen der Nummern funktioniert trotzdem** — der Fehler kommt danach. Fuer den
  Live-Dienst-Weg ist der Assistant-Schritt ohnehin unnoetig, weil der Live-Assistant bereits
  auf den Live-Shim zeigt. Wer den Treiber weiterverwendet, sollte den Assistant-Teil
  optional machen.

## 5. Was der Owner noch entscheiden/tun muss

Vollstaendig in `tasks/al-testcall-checklist.md`. Die wichtigsten:
1. **AL-P2 zu Ende bringen** (s. o.) — davon haengen AL-P7, P7b, P10b, P14, P15 ab.
2. **Testanrufe** fuer die Abnahmen von AL-P1 (Latenztabelle, Baseline aus >= 5 Anrufen,
   Eroeffnungsfenster aus >= 3 Aufnahmen), AL-P3, AL-P4, AL-P5.
3. **AL-P3 NICHT vergessen:** die Endpointing-Aenderung wirkt erst, wenn
   `scripts/telnyx-assistant-provision.mjs` laeuft — und **vorher** muss die Basislinie ueber
   >= 5 echte Anrufe gemessen sein, sonst ist der Gewinn hinterher nicht belegbar.
4. **O6 ist beantwortet** (Boot-Banner): Worst-Case-Tarif 300 ct/min, Tenant-Deckel 1500 ct,
   Plattform 3000 ct. Offen bleibt, ob 300 ct/min gewollt ist.
5. **`BRAVE_SEARCH_API_KEY`** beschaffen — erst fuer die Abnahme von AL-P10b noetig.

## 6. Betriebsregeln, die diese Session teuer gelernt hat

1. **Eine Bahn zur Zeit.** Zwei parallele `phase-impl-lean`-Workflows erzeugten **35
   gleichzeitige `node --test`-Prozesse** und Load 32 auf 15 Kernen. Eigene Testlaeufe nur
   **zwischen** den Wellen.
2. **Nie mit `pgrep` messen — es sieht in dieser Sandbox keine fremden Prozesse und liefert
   stur 0.** `ps` verwenden. `ps -o etimes` gibt es auf macOS nicht.
3. **`git merge-base --is-ancestor master <finalBranch>` vor JEDEM Merge.** Ein abgebrochener
   Lauf hinterlaesst seinen Branch; der naechste Lauf weicht still auf `<branch>-impl` aus,
   meldet aber den **geplanten** Namen zurueck. Genau diese Pruefung hat verhindert, dass ein
   halbfertiger Torso gemergt und die echte Umsetzung verloren wird.
   **Vor dem Neustart einer abgebrochenen Phase deren Branch loeschen.**
4. **Migrationen laufen NICHT automatisch.** `applySchema` wird nur von Tests gerufen, es gibt
   kein `preDeploy`. Jede neue Spalte muss **vor** dem Deploy von Hand per `psql` angewendet
   werden, sonst bricht der erste Anruf danach.
   **Empfehlung fuer eine eigene Phase:** `applySchema` beim Serverstart aufrufen (das Schema
   ist bereits idempotent und ein Test pinnt das) — dann faellt dieser Handgriff weg.
5. **`psql`-Fehler „SSL connection has been closed unexpectedly" heisst meist FIREWALL, nicht
   TLS.** Die Prod-DB hat eine IP-Allowlist; nach einer Zwangstrennung fehlt die neue IP.
   Beweis, dass es nicht die DB ist: der Live-Dienst antwortet weiter (er verbindet intern).
6. **Secrets nie durch Werkzeugaufrufe schleusen** (Regel 4) — sie landen sonst im
   Sitzungsprotokoll. Env-Werte im Render-Dashboard setzen lassen.
7. **Ein Test, der nicht rot werden kann, ist kein Test.** Der Review fand einen Vakuumtest,
   der seinen eigenen Fehlerfall nicht erzeugen konnte — und ein Sicherheitsdokument, das sich
   auf ihn berief. Gegenmittel: **Mutationsprobe** (Eigenschaft absichtlich kaputtmachen und
   pruefen, ob der Test es merkt).

## 7. Wie Phasen gefahren werden

```
Workflow({ scriptPath: ".claude/workflows/phase-impl-lean.js", args: {
  phaseId: "AL-P7", phaseTitle: "...", branch: "phase/al-p7-streaming",
  baseBranch: "master", planDoc: "PLAN-ASSISTANT-LEAP.md",
  specFile: "tasks/assistant-leap-chain.md", maxFixRounds: 2, highStakes: true }})
```
`highStakes` IMMER explizit setzen. Die Phasen-Spezifikationen stehen in **Abschnitt 9** von
`tasks/assistant-leap-chain.md` — dort steht auch die Namensbruecke `AL-P<n>` -> `Phase <n>`
im Plan-Doc, ohne die der Plan-Agent seinen Abschnitt nicht findet.

**Bindend im Plan:** Abschnitt „Entscheidungen O1-O9". Der Abschnitt „Herleitung der offenen
Fragen" darunter ist **historisch und gilt NICHT**.
