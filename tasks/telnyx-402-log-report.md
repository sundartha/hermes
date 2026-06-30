# Report — Phase TELNYX-402-LOG (402-Body-Logging Telnyx-Number-Adapter)

**Stand:** 2026-06-30 · **Gate:** PASS (manuell verifiziert) · **finalBranch:** `phase/telnyx-402-log-fix1` → gemerged nach `master` (`e6d5491`, **unpushed**).

> Der phase-impl-lean-Workflow gab `gate=BLOCKED` zurueck — das ist ein **Artefakt**: das Anthropic-Account-Monthly-Spend-Limit toetete Review-r1, Fix-r2, Review-r2 UND den Report-Agent. `remainingBlockers:[]` ist leer, weil die Review-Agents `null` lieferten, nicht weil sauber. Plan, Impl und Fix-r1 (beide echten Blocker behoben) liefen VOR dem Limit durch. Der Lead (Main-Thread) hat den ausgefallenen Dual-Review durch eigenes Diff-Review + unabhaengigen Testlauf ersetzt.

## Was umgesetzt wurde

Telnyx-Adapter loggte bei einem fehlgeschlagenen Number-Order nur `HTTP <status>` und verwarf den
Response-Body — der echte Grund (Telnyx `errors[].code/title/detail`) war unsichtbar (Diagnose-Luecke A
aus HANDOVER §3.3).

- **`src/telephony/adapters/telnyx/errors.js`** (neu): gemeinsamer Envelope-Parser `assertTelnyxOk(res, op, {includeDetail, attachStatus})`. Liest im `!res.ok`-Zweig non-destruktiv `res.text()`, parst `{errors:[{code,title,detail}]}`, nimmt **strikt allowlisted** `code`/`title`(`/detail`) in die Fehlermeldung. Kein Raw-Body, kein API-Key, `detail` auf `ERROR_DETAIL_MAX_LEN=200` truncated. Body fehlt/kaputt → `""` → Fallback status-only (throw passiert immer).
- **`numbers.js`**: lokales `assertOk` entfernt, alle 4 Caller (`resolveNumberId`/`searchNumbers`/`orderNumber`/`releaseNumber`) auf `await assertTelnyxOk(..., {includeDetail:true})`. → 402 ergibt jetzt z.B. `Telnyx orderNumber fehlgeschlagen: HTTP 402 (10015 Payment required: Account balance too low)`.
- **`voice.js`**: eigene Inline-Envelope-Logik durch den gemeinsamen Helper ersetzt (`includeDetail:false`, `attachStatus:true`) — beseitigt die Duplizierung (Review-Blocker DUP1 / Clean-Code S2, G5). Verhalten unveraendert (vorher schon code+title+providerStatus).
- **`PLAN-SECURITY.md`**: dokumentiert das bewusst akzeptierte Restrisiko (Review-Blocker SEC1).

## Dualer Review (Runde 0, vor dem Spend-Limit) + Self-Fix r1

- **Safety:** approved (Erfolgspfad byte-identisch, Gates/Disclosure/Auth unberuehrt, kein Secret-Leak).
- **Clean-Code:** S2-Blocker `DUP1` (Envelope-Logik in numbers.js dupliziert voice.js) + S1/Security `SEC1` (`detail` kann PII tragen).
- **Fix-r1:** beide mit EINER kohaerenten Aenderung behoben — Helper extrahiert (DUP1), `includeDetail`-Schalter + Allowlist + Truncation + Doku (SEC1).

## Akzeptiertes Restrisiko (SEC1, dokumentiert)

`numbers.js` nutzt `includeDetail:true`, weil der 402-Grund ("Account balance too low") im `detail` steht.
Preis: ein **nicht-402**-Fehler (z.B. 422 Validierung) kann die zu provisionierende Telnyx-**Inventarnummer**
ins **Server-Log** (nicht in API-/MCP-Antworten) echoen. Eingegrenzt: Felder-Allowlist (kein Raw-Body/Key),
Truncation 200, nur Server-Log, eigene Nummer (kein Dritt-PII, kein Secret). Akzeptiert fuer die
Betriebsdiagnose (PLAN-SECURITY.md).

## Verifikation (unabhaengig, Main-Thread)

- `node --check` auf errors.js / numbers.js / voice.js → OK
- `NODE_ENV=test node --test test/*.test.js` auf fix1 UND auf master nach Merge → **pass 1464, fail 0**
- 11 neue Tests gruen: 8× `assertTelnyxOk` (Allowlist/Truncation/attachStatus/Leak-Schutz/Fallback), 3× `orderNumber 402` (Diagnose sichtbar / Key+PII-frei / Fallback)
- `npm test` (Wrapper) gibt EXIT=194 — Reporter/TTY-Artefakt; der direkte `node --test` ist EXIT=0.

## Wichtig: das fixt NICHT den 402

Diese Phase macht den 402-Grund **diagnostizierbar**, sie behebt den Order-Fehlschlag nicht. Nach **Deploy**
(Push = Jonas) zeigt der naechste Subscribe/Retry im Log den exakten Telnyx-Grund → dann gezielt fixen
(Funding/Billing, siehe HANDOVER §4 H1/H2).
