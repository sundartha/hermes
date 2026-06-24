# F1 Block A — Sprachzuordnung: Authoritative Phasen-Spec (P1-P5)

> Verbindliche Scope-/Design-/Invarianten-Definition pro Phase (vor dem Strategie-Doc
> `docs/strategy/f1-geo-location.md`). Quelle: Auftrag des Engineering-Lead.
> Zeilennummern unten sind HINWEISE (koennen rotten) - per grep auf Symbole/Call-Sites
> verifizieren, nicht uebernehmen.

## Absolute Grundregeln (gelten in ALLEN Phasen)
1. **DE bleibt byte-identisch** zum heutigen Verhalten. Kein FR-Pfad faerbt DE ab.
2. FR-Offenlegung = **fest verdrahtet, kuratiert** im Locale-Bundle (nie per Call-Parameter
   abschaltbar/frei waehlbar). Gilt auch fuer den Realtime-Opener.
3. **Keine neuen npm-Dependencies.**
4. Safety-Gates nie aufweichen.
5. `npm test` nach jeder Phase gruen (beide Backends: json-Default + pglite-in-process).
6. Unbekannte/fehlende Sprache -> Fallback `de`. Unbekanntes Land -> `config.provisioningCountry || "DE"`.
7. Kommentare deutsch OHNE Umlaute (ue/oe/ae). ESM, kein Build-Step, kein TypeScript.

---

## Phase P1 (f1-p1) — Store-Schema Geo-Felder + Migration (FUNDAMENT)
**Branch:** `phase/f1-p1-geo-schema`, **base:** `master`

**Was zu tun:** `country` (ISO-2) + `language` (BCP-47-kurz) additiv NULLABLE auf
Number-Record UND Tenant. Backfill aller Bestands-Records auf `DE`/`de`. JSON- und
PG-Backend konsistent (Strategie R12: beide Backends in EINEM Schritt).

**Betroffene Dateien (per grep verifizieren):**
- `src/store/state-ops.js` — Number-Record-Struktur, `createCall`, `seedOwnerNumber`,
  `registerTenant`, ggf. neue Setter
- `src/store/defaults.js` — `settings.language` optional (Default-Merge)
- `src/store/json.js` — Default-Merge beim Lesen
- `src/store/pg.js` — hydrate/flush fuer tenants + numbers (additive Spalten)
- `src/db/schema.sql` — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS country TEXT, language TEXT`
  (Muster wie bestehende additive ALTERs)
- `src/db/migrate.js` — Migration beim Boot (idempotent)
- `src/store.js` — Setter-Export falls noetig
- `src/store/views.js` — falls Projektion noetig

**Schluessel-Details:**
- Number-Struktur erweitern: `{ id, number:e164, provider, status, country, language }`
- Tenant-Struktur erweitern: `country`, `defaultLanguage`
- `seedOwnerNumber`: country = `config.provisioningCountry || "DE"`, language = `"de"`
- `createCall`: language aus `number.language` -> `tenant.defaultLanguage` -> `"de"`
- Code-Fallback ueberall: `record.language || "de"`, `record.country || config.provisioningCountry || "DE"`
- PG: idempotentes additives DDL (migrate.js fuehrt bei Boot aus)
- JSON: Default-Merge beim Lesen
- Additive NULLABLE Spalten (keine harten Annahmen, nie `undefined` durchreichen)

---

## Phase P2 (f1-p2) — Sprach-Resolver + LLM-Schicht sprachabhaengig
**Branch:** `phase/f1-p2-language-resolver`, **base:** `<P1.finalBranch>`

**Was zu tun:**
- Neues `src/i18n/`-Verzeichnis mit Locale-Bundle: `de.js`, `fr.js`, `index.js` (Resolver)
- `src/claude.js`: `systemPrompt`, `summarizeCall`, `disclosureSentence` sprachabhaengig
  via `call.language`
- FR-Offenlegung als feste, kuratierte Variante im Bundle (R8)
- **Keine** Aenderung an `src/llm.js`, **kein** Modellwechsel

**Locale-Struktur pro Sprache (Mindestform):**
```js
{ language, sttLocale, ttsVoice, deepgramModel, disclosureSentence, greetingDefault }
```
(Phase 2 nutzt mindestens `disclosureSentence` + die Prompt-Strings; STT/TTS/greeting
werden in P3/P4 konsumiert - das Bundle ist der einzige Ort fuer Sprach-Strings.)

**Invarianten:** DE-System-Prompt + DE-Offenlegung + DE-Summary byte-identisch zu heute.
Resolver fail-safe: unbekannte Sprache -> `de`-Bundle.

---

## Phase P3 (f1-p3) — Telephonie-Renderer sprachabhaengig (STT + TTS)
**Branch:** `phase/f1-p3-renderer`, **base:** `<P2.finalBranch>` (linear gestapelt)

**Was zu tun:**
- `src/telephony/directives.js` — VOICE_PROFILE um FR erweitern
- `src/telephony/adapters/twilio/render.js` + `.../telnyx/render.js` — STT-Locale + TTS-Voice
  aus `call.language`/Voice-Profil statt hart `de-DE`/DE-Voice
- **Fail-closed** bei unbekanntem Profil (wirft, faellt NICHT still auf DE/Englisch) (R9/R10)
- Snapshot-Tests aktualisieren (DE-Snapshots byte-identisch, FR-Snapshots neu)

**STT-Falle (R9):** Locale strikt volle BCP-47 (`fr-FR`, nicht `fr`) + passender
Deepgram-Model-String.

---

## Phase P4 (f1-p4) — Statische Texte + Inbound-Wiring (Nummer -> Sprache)
**Branch:** `phase/f1-p4-inbound-wiring`, **base:** `<P3.finalBranch>` (enthaelt P1+P2+P3)

**Was zu tun:**
- `src/server.js` `/voice/incoming` ermittelt `language` aus Number/Tenant und gibt sie an
  `createCall` (echte language statt `"de"`)
- Statische Server-Texte (Reprompt/Fehler/Hangup) aus dem i18n-Bundle
- `src/store/defaults.js` Greeting-Default sprachabhaengig
- `src/self-service.js` Greeting-Templates falls betroffen
- Schwester-Query zu `findTenantByNumber` (liefert `language`/Record, nicht nur tenantId)
  in `src/store/state-ops.js`/`views.js`

**Invarianten:** Eine DE-Nummer fuehrt weiterhin DE byte-identisch; eine FR-Nummer fuehrt FR.

---

## Phase P5 (f1-p5) — Realtime-Engine-Sprache
**Branch:** `phase/f1-p5-realtime`, **base:** `<P4.finalBranch>` (enthaelt P1+P3)

**Was zu tun:**
- `src/bridge.js` — OpenAI-Instructions + Voice + Whisper-Sprache aus VOICE_PROFILE/
  `call.language`
- Offenlegungs-Opener bleibt fest verdrahtet (kuratierte FR-Variante aus dem Bundle)

**Invarianten:** Nur relevant bei `VOICE_ENGINE=realtime`; Budget-Engine-Verhalten
unberuehrt; DE-Realtime byte-identisch.
