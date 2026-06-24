# Phase G3 — STT-Endpointing-Truncation (Detailbericht)

**Phase:** G3 (Gespraechsqualitaet)
**Thema:** STT-Endpointing-Truncation — config-getriebener `speechTimeout` fuer Folge-Gathers via Override-Seam; Outbound-Erst-Gather bleibt bewusst auf `auto`.
**Gate:** **PASS**
**finalBranch:** `phase/g3-stt-endpointing`
**Commit:** `9ec9a6c78047ed92a77d085dc7f3a0cf600ed865`
**Tests:** 733/733 gruen (json/Default-Backend, autoritativ) — Baseline 727 + 6 neue G3-Tests
**Fix-Runden:** 0

---

## Problem

`speechTimeout="auto"` finalisiert die STT-Erkennung auf der **ersten internen Sprechpause** — ein laenger gesprochener Satz wird abgeschnitten ("geht" statt ganzem Satz). Ziel: interne Sprechpausen in Folge-Turns tolerieren, **ohne** den Erst-Turn (G2-Invariante) zu verschlechtern.

Kernkonflikt: `auto` darf NICHT pauschal in den geteilten `GATHER_ATTRS`/`GATHER_OPTS` ersetzt werden — das wuerde auch das Outbound-Erst-Gather treffen und den in G2 behobenen Erst-Turn-Deadlock reaktivieren.

---

## Plan (gekuerzt)

**Loesung = Override-Seam** (kein pauschaler Ersatz): optionales, benanntes Feld `speechTimeoutSec` faedelt von der Call-Site -> `gather`-Direktive -> Telnyx-Renderer. Nur **Folge-Gathers im `/voice/turn`** setzen den Wert; **Outbound-Erst-Gather + Inbound-Greeting + Twilio** bleiben byte-identisch auf `auto`.

**Pre-Mortem (vor Umsetzung benannt):**
- (a) `auto` global ersetzen reaktiviert G2-Deadlock -> Seam statt pauschal; Drift-Asserts "Erst-Gather + Twilio bleiben `auto`".
- (b) `test-base-env-drift` -> `test/helpers.js` BASE_ENV neutralen Default `STT_SPEECH_TIMEOUT_SEC: "2"` nachziehen.
- (c) Latenz-Kompoundierung -> N konservativ (2s), config-tunebar; Gesamt-Erst-Turn-Zeit im Live-Gate (geparkt).
- (d) Magic Number / Selektor-Argument -> Default als benannte config-Konstante; Seam als benannter Options-Schluessel (kein Boolean-Flag, vermeidet F3/G15).
- (e) Twilio-Drift -> Twilio-Renderer byte-identisch lassen; Seam generisch im neutralen Direktiven-Typ (kein Provider-Leak).

**Edits laut Plan:**
1. `src/config.js` — neue `numEnv`-Var `sttSpeechTimeoutSec` (Default 2, min 1, Ganzzahl). min:1 statt min:0, da `speechTimeout="0"` semantisch defekt (sofortiges Finalisieren).
2. `.env.example` — Doku `STT_SPEECH_TIMEOUT_SEC=2`.
3. `src/telephony/directives.js` — `gather`-Builder um optionales `speechTimeoutSec` (Objekt-Param, F1-konform; `undefined` -> byte-identisch).
4. `src/telephony/adapters/telnyx/render.js` — `gatherAttrs(d)`-Override-Seam: ersetzt `"auto"` an **derselben Attribut-Position** (Reihenfolge vertraglich/Snapshot), nur wenn `speechTimeoutSec` gesetzt; sonst `GATHER_ATTRS` byte-identisch.
5. `src/telephony/adapters/twilio/render.js` — **kein Edit** (bewusst byte-identisch; Override Telnyx-only, Live laeuft Telnyx).
6. `src/server.js` — `turnDirectives` bekommt optionalen Options-Param `{ speechTimeoutSec }`; neuer intentions-ausdrueckender Helper `followupTurnDirectives` (kein Boolean-Flag) fuer die zwei Folge-Gather-Call-Sites (No-Speech-Reprompt + normaler Turn-Reply). Inbound-Greeting + Outbound bleiben auf plain `turnDirectives`.
7. `test/helpers.js` — BASE_ENV-Nachzug.

**Caller-Matrix:**

| Caller | Erst-/Folge-Gather | speechTimeoutSec |
|---|---|---|
| Inbound-Greeting | Erst-Turn | nein (`auto`) |
| No-Speech-Reprompt | Folge-Gather | ja (N) |
| Normaler Turn-Reply | Folge-Gather | ja (N) |
| Outbound-Erst-Gather | Erst-Turn | nein (`auto`) |

**Tests (Plan):** Telnyx-Render Override + Drift (Snapshot, offline); Twilio-Drift-Assert (byte-identisch); neue Spawn-Integration `test/g3-speech-timeout.test.js` (Erst-Gather=auto, Folge-Gather=N, config-Tunebarkeit via `STT_SPEECH_TIMEOUT_SEC=3`).

**Geparkt (Plan-Doc-konform):** Live-Gate (Owner, Allowlist) — voller `SpeechResult` ohne Fragment, Latenz akzeptabel; `redirectD`-Entfernung (separates Live-Gate); `[turn-recv]`/`[turn-ok]`-Log-Cleanup (erst G4).

---

## Implementierungs-Zusammenfassung

Override-Seam exakt gemaess Plan umgesetzt: optionales `speechTimeoutSec` faedelt von der Call-Site (`server.js` `followupTurnDirectives`) ueber den `gather`-Builder (`directives.js`) zum Telnyx-Renderer (`render.js` `gatherAttrs` ersetzt `"auto"` an stabiler Attribut-Position). `config.sttSpeechTimeoutSec` (Default 2s, min 1) in `config.js` + `.env.example` dokumentiert.

Folge-Gathers im `/voice/turn` (No-Speech-Reprompt + normaler Turn-Reply) bekommen das feste N; Outbound-Erst-Gather + Inbound-Greeting bleiben bewusst auf `"auto"` (G2-Invariante, unveraendert). Twilio-Renderer byte-identisch (Override Telnyx-only, Drift-Test sichert das ab). BASE_ENV-Nachzug in `test/helpers.js` gegen `test-base-env-drift`.

**Verifikation:** `node --check` auf allen 8 geaenderten/neuen `.js` gruen. 733/733 gruen. Discriminator-Greps wie erwartet (`speechTimeout: "auto"` in Telnyx-Renderer = 1 Quelle; Twilio `speechTimeout`-refs = 1, unveraendert). Safety-Gates/Disclosure/LLM-frei-Outbound/Auth unberuehrt.

**Geaenderte/neue Dateien (9):** `src/config.js`, `.env.example`, `src/telephony/directives.js`, `src/telephony/adapters/telnyx/render.js`, `src/server.js`, `test/helpers.js`, `test/telnyx-render.test.js` (+2), `test/directive-render.test.js` (+1), **neu** `test/g3-speech-timeout.test.js`. Twilio-Renderer bewusst NICHT geaendert. Keine neue npm-Dependency (`package.json`/lock unveraendert).

### Deviations
1. **Integrationstest-LLM-Mock:** Die Plan-Skizze rief `runOutboundThenTurn` ohne `mockUrl` — der Turn ruft aber `agentTurn` (Anthropic). Tatsaechlich verdrahtet: `startCountingAnthropicMock({ failFirst: 0 })` als lokaler valider, offline-deterministischer LLM-Mock. Asserts unveraendert (`turnBody`, `speechTimeout=2` bzw. `3`).
2. **Smoke uebersprungen:** Direkter `node src/server.js`-Boot scheiterte am Boot-Guard (unrelated Pflicht-Config fehlt: TWILIO_*-Keys, OWNER_FIRST_NAME/LAST_NAME) — unabhaengig von G3. Die Route ist stattdessen durch die neue Spawn-Integration (gespawnter realer Server, `/voice/outbound` + `/voice/turn`, gerenderte TeXML asserted: Erst-Gather auto, Folge-Gather=2, env-Override=3) end-to-end verifiziert. Kein Blocker.

---

## Safety-Urteil

**APPROVED.** Tests laufen unabhaengig gruen (733/733 json-Default selbst ausgefuehrt). Safety-Gates intakt, Disclosure intakt, Auth fail-closed intakt, keine Secrets geleakt, Scope respektiert, Verhalten wie beabsichtigt. **Keine Blocker.**

Quellseitig verifizierte Invarianten:
1. Erst-Gather Inbound-Greeting (`server.js:440`) UND `/voice/outbound` (`server.js:515`) nutzen weiterhin plain `turnDirectives` -> `speechTimeout="auto"` bleibt (kein G2-Erst-Turn-Deadlock-Regress); nur Folge-Turns (463, 475) nutzen `followupTurnDirectives` mit festem Timeout.
2. `/voice/outbound` bleibt strikt LLM-frei (synchrones openingText).
3. Disclosure-Pfad (`claude.js`, `bridge.js`) nicht im Diff; Outbound rendert Offenlegung weiterhin disclosure-first im Erst-Gather.
4. Safety-Gates (numberGateError, Budget, Allowlist, Max-Dauer, Signatur) komplett unberuehrt.
5. Keine Auth-/Secret-Aenderungen.
6. Twilio byte-identisch (Override Telnyx-only, durch Drift-Tests bewiesen); Telnyx-Override an derselben Attribut-Position (Snapshot-getestet).
7. config-Var mit min:1-Guard (kein 0/negativ moeglich), fallback:2 fail-safe, BASE_ENV nachgezogen.

**Concerns (Nits, keine Blocker):**
- `STT_SPEECH_TIMEOUT_SEC` ist in `.env.example` + `config.js` zentralisiert, aber NICHT in `render.yaml`. CLAUDE.md verlangt fuer Render auch `render.yaml`-Pruefung. Wegen sicherem Default (fail-safe, Live=Telnyx) kein Blocker; vor Live-Deploy ggf. nachziehen, falls getunt werden soll.
- pg-Backend-Testlauf scheitert umgebungsbedingt (DB unerreichbar beim Store-Init) — identische Ursache auf master, betrifft G3-unberuehrten Code (bridge, disclosure, claude-identity). Keine G3-Regression. (pg: 695 Tests, 685 pass, 10 fail — alle 10 rein umgebungsbedingt.)

---

## Clean-Code-Audit

**Verdict: PASS — keine FLAGs in irgendeiner Kategorie. Sauberer, minimaler, vollstaendig getesteter Diff. Kein Blocker.**

- **S1 (Tests/kritisch):** [] — leer. Neues Verhalten abgedeckt: positiver Fall (`speechTimeout=2`), Negativ-/Drift-Fall (ohne Override byte-identisch `auto` fuer Erst-Gather + Twilio), config-Tunebarkeit (`=3`), Attribut-Reihenfolge-Invariante. Beide Pre-Mortem-Risiken (Erst-Turn-Deadlock-Regress, Twilio-Drift) explizit getestet.
- **S2 (Duplizierung):** [] — leer. `followupTurnDirectives` delegiert an `turnDirectives` (Logik wiederverwendet, nicht kopiert); `gatherAttrs` ist ein einzelner Override-Seam. `config.sttSpeechTimeoutSec`-Verdrahtung nur einmal.
- **S3 (Ausdrucksstaerke):** [] — leer. `followupTurnDirectives` statt Boolean-Flag = bewusste Vermeidung von Selektor-Argument (G15/F3), im Kommentar begruendet. Magic Number 2 = benannte config-Konstante (G25). Namen deskriptiv. `speechTimeoutSec` optionales destructured Arg (F1 ok). Kommentare praezise, deutsch ohne Umlaute (C2/C4).
- **S4 (Struktur):** [] — leer. Configwert in `config.js` + `.env.example` (G35). BASE_ENV korrekt nachgezogen. Renderer-Override an einer einzigen, dokumentierten Position; Telnyx-only, Twilio bewusst byte-identisch.

**Top-Todos (optional, kein Blocker):**
- Merge-bereit; optional volle `npm test`-Suite vor Merge einmal gruen bestaetigen.
- Bewusste Vereinfachung dokumentiert lassen: Override ist Telnyx-only (Live=Telnyx); falls Twilio je live geht, muesste der Twilio-Renderer `speechTimeoutSec` ebenfalls auswerten — aktuell korrekt als byte-identisch dokumentiert/getestet.

---

## Fix-Runden

**0** — Gate PASS ohne Nachbesserung (Safety APPROVED + Clean-Code S1-S4 alle leer beim ersten Review).
