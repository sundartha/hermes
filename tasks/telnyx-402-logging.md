# Spec — Telnyx 402-Body-Logging (Diagnose-Luecke A)

> Quelle: HANDOVER-TELNYX-402.md §3.3 + §5.2. Seam-Map verifiziert (SeamMapper, 2026-06-30).
> Ziel: der EXAKTE Telnyx-402-Grund landet im Worker-Log, statt verworfen zu werden — ohne PII/Secret-Leak.

## Phase TELNYX-402-LOG — 402-Response-Body in die Adapter-Fehlermeldung aufnehmen

### Problem (verifiziert)
`src/telephony/adapters/telnyx/numbers.js`, `assertOk(res, op)` (aktuell L39-41):
```
function assertOk(res, op) {
  if (!res.ok) throw new Error(`Telnyx ${op} fehlgeschlagen: HTTP ${res.status}`);
}
```
`assertOk` bekommt nur das fetch-`Response`-Objekt + `op` und wirft status-only. In JEDEM Caller laeuft
`assertOk(res, ...)` ZUERST, `await res.json()` erst danach (Erfolgspfad). Auf 402 feuert der throw,
**bevor** der Body gelesen wird — der Telnyx-`errors[]`-Block (code/title/detail, z.B. unfunded balance /
regulatory) wird verworfen. Genau dort steht der echte Grund.

### Scope (NUR das)
Eine Datei: `src/telephony/adapters/telnyx/numbers.js`. Plus ein automatisierter Test.
`assertOk` ist modul-lokal (nicht exportiert); andere Adapter (`telnyx/voice.js`, `billing/stripe.js`)
haben eigene Kopien und bleiben UNANGETASTET.

### Design
1. `assertOk` async machen. Im `!res.ok`-Zweig den Body **non-destruktiv** lesen (`await res.text()`,
   single-use Stream — nur im Fehlerfall, Erfolgspfad liest weiter `res.json()` wie bisher).
2. Body als Telnyx-Error-Envelope parsen (`{ errors: [{ code, title, detail }] }`) und NUR
   `code`/`title`/`detail` strukturiert in die Error-Message aufnehmen
   (z.B. `Telnyx ${op} fehlgeschlagen: HTTP ${status} [<code> <title>: <detail>]`).
3. **Fail-safe:** Body-Read/Parse-Fehler darf den throw NICHT verschlucken — bei Fehler/leerem Body auf die
   bisherige status-only-Meldung zurueckfallen. Der throw passiert IMMER.
4. Alle 4 Caller auf `await assertOk(...)` umstellen: `resolveNumberId`, `searchNumbers`, `orderNumber`,
   `releaseNumber`. (Aktuell synchron aufgerufen — ohne `await` waere der Guard unwirksam.)
5. Extraktion sauber kapseln (eine kleine Helper-Funktion, keine Duplizierung), benannte Konstante fuer
   etwaige Truncation-Laenge (kein Magic Number).

### Invarianten / HART (CLAUDE.md Regel 4 — bindend)
- KEIN API-Key, KEINE `Authorization`-Header, KEINE Telefonnummer (PII) in der Message.
  Nur Telnyx-`errors[].code/title/detail`. KEIN Raw-Body-Dump (kann PII/grossen Payload enthalten) —
  unbekannte/zusaetzliche Felder NICHT durchreichen; bei Truncation sinnvoll begrenzen.
- Erfolgspfad byte-identisch: bei `res.ok` aendert sich NICHTS am Verhalten.
- Kein neues Dependency. ESM, kein Build-Step, Kommentare deutsch OHNE Umlaute.

### Abgrenzung (NICHT tun)
- Kein Retry/Backoff, kein Verhalten am Order selbst aendern — nur die Fehlermeldung anreichern.
- `telnyx/voice.js` und `billing/stripe.js` NICHT anfassen.
- Keine Logger-Library einfuehren; das Idiom der Datei (`throw new Error(...)`, Worker loggt) bleibt.

### Deterministisch pruefbares Ergebnis
Bei einem 402 mit Body `{"errors":[{"code":"10015","title":"Payment required","detail":"Account balance too low"}]}`
enthaelt die geworfene Error-Message `10015`, `Payment required` UND `Account balance too low` —
und enthaelt WEDER den API-Key NOCH eine Telefonnummer. Bei leerem/kaputtem Body faellt sie auf
`Telnyx <op> fehlgeschlagen: HTTP 402` zurueck (throw passiert trotzdem).

### Verifikation
- `node --check src/telephony/adapters/telnyx/numbers.js`
- `npm test` (beide Backends gruen)
- Neuer Test deckt: (a) 402-Body-Extraktion (code/title/detail in Message), (b) PII/Secret-Absenz,
  (c) Fail-safe-Fallback bei kaputtem/leerem Body. Test-Seam: Plan-Agent waehlt die sauberste Variante
  (global `fetch`-Stub ueber eine public Adapter-Funktion ODER `assertOk` testbar exponieren) — abhaengig
  davon, ob `numbers.js` beim Import config braucht (npm test laeuft ohne `.env`).
