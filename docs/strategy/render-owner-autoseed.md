# Strategie: Owner-Nummer beim Boot aus Env seeden (Render-Deploy-Fix)

> **Status:** Strategie (Phase 0, KEIN Code). Erstellt mit Agent-Team (Architektur + Pre-Mortem, je Opus/xhigh).
> **Scope:** `STORE_BACKEND=json` (Render free plan, fluechtiges Dateisystem). pg-Pfad bleibt unangetastet.

## 1. Ziel & Akzeptanzkriterien

### Problem
Render (free plan) hat ein **fluechtiges Dateisystem** → `data/store.json` ist nach jedem Deploy weg.
Der Boot-Guard in `src/server.js:1167` verlangt fail-closed eine **aktive Owner-Nummer im Store**
(`findActiveNumber(store.load(), OWNER_TENANT_ID)`), sonst `exit(1)`. Diese Nummer wird heute NUR via
CLI `scripts/seed-owner-number.js <e164> <provider>` eingetragen — auf Render nach jedem Deploy weg
→ Boot schlaegt dauerhaft fehl.

### Ziel
Die Owner-/Betriebsnummer beim Boot **idempotent aus einer Env-Var** in den json-Store seeden — exakt
nach dem etablierten Muster `PROFILES_JSON → seedProfilesFromEnv()` in `src/store/json.js`. Damit
ueberlebt der Boot-Guard einen Render-Deploy ohne CLI-Lauf.

### Akzeptanzkriterien (hart)
1. **AC1 — Render-Boot gelingt:** Bei leerer/fehlender `store.json` + gesetzter, gueltiger Env-Var
   bootet der Dienst (`/healthz` 200); die Nummer liegt mit `tenantId="owner"`, `status="active"`,
   korrektem `provider` im Store.
2. **AC2 — Fail-closed bleibt:** Leere/fehlende Env-Var → **kein Seed** → Boot-Guard verweigert mit
   exit(1) und der bestehenden Diagnose (verweist aufs Seed-CLI). `test/boot-failclosed.test.js:24-33`
   darf NICHT brechen.
3. **AC3 — Keine Garbage-Nummer hebelt den Guard aus:** Eine syntaktisch ungueltige Nummer
   (z.B. `"hallo"`, `"0049…"` ohne `+`) wird NICHT geseedet → Boot-Refusal, NICHT gruener Boot mit
   totem Routing.
4. **AC4 — Keine stillen Falsch-Kosten durch Provider:** Provider wird validiert (`twilio|telnyx`).
   Default = Twilio (`DEFAULT_PROVIDER`); ein **gesetzter, aber ungueltiger** Provider (Tippfehler) →
   kein Seed → Boot-Refusal, der die Var nennt.
5. **AC5 — Keine Konflation:** `OWNER_NUMBER` (privater SMS-Empfaenger) bleibt unveraendert und wird
   NIE zum Seeden der Betriebsnummer wiederverwendet.
6. **AC6 — Store gewinnt / kein Doppel-Seed:** Existiert bereits eine aktive Owner-Nummer (CLI-Seed,
   pg-Bestand, persistente FS), wird der Env-Seed zum No-Op → genau EINE aktive Owner-Nummer.
7. **AC7 — Kein PII-Leak:** Keine Diagnose (Erfolg/Fehler/WARN/Guard) loggt die Nummer — nur Var-Name
   + Erwartung (Muster `numEnv`, `config.js:19-20`).
8. **AC8 — Idempotenz:** Zweiter Boot mit identischer Env → kein Duplikat.

---

## 2. Architektur-Skizze

### Einhaengepunkt (eine Stelle)
`src/store/json.js::finishLoad()` (heute Zeilen 66-77) ruft bereits `seedProfilesFromEnv()` und
`ops.seedOwnerIdentity(...)`. Ein **neuer Wrapper `seedOwnerNumberFromEnv()`** wird dort eingehaengt:

```
function finishLoad() {
  seedProfilesFromEnv();
  seedOwnerNumberFromEnv();   // NEU — vor der Identitaet (Routing-Infra zuerst)
  ops.seedOwnerIdentity(state, config.ownerFirstName, config.ownerLastName, OWNER_TENANT_ID);
  return state;
}
```

`finishLoad()` ist der gemeinsame Abschluss ALLER drei `load()`-Zweige (First-Boot, Parse-Erfolg,
Korruptions-Recovery) — genau deshalb gehoert der Seed hierhin (kein verlorener Seed-Pfad).
**Automatische Backend-Abgrenzung:** `finishLoad()` lebt nur im json-Backend; `pg.js::init()` bleibt
unberuehrt → der Env-Seed wirkt ausschliesslich im json-Pfad (gewollt, siehe Risiko R4/R7c).

### Der Wrapper (Pseudocode, lebt in `json.js`, Muster wie `seedProfilesFromEnv`)
```
function seedOwnerNumberFromEnv() {
  const raw = config.ownerNumberSeed;           // OWNER_NUMBER_SEED
  if (!raw) return;                             // env-gating → AC2 (leer = Refusal bleibt)
  if (findActiveNumber(state, OWNER_TENANT_ID)) return;  // AC6: Store gewinnt, kein Doppel-Seed/Drift
  const norm = normNum(raw);
  if (!isValidE164(norm)) {                     // AC3: /^\+[1-9]\d{6,14}$/
    console.error("[owner-number] OWNER_NUMBER_SEED hat kein gueltiges E.164-Format - ignoriert");
    return;                                     // kein Seed → Guard greift (kein PII im Log, AC7)
  }
  const provider = resolveSeedProvider();       // AC4: default twilio; gesetzt+ungueltig → null
  if (provider === null) {
    console.error("[owner-number] OWNER_NUMBER_PROVIDER ungueltig (erwartet twilio|telnyx) - ignoriert");
    return;                                     // kein Seed → Guard greift
  }
  ops.seedOwnerNumber(state, norm, OWNER_TENANT_ID, provider);  // bestehende Funktion, unveraendert
}
```

### Neue config-Felder (`src/config.js`, neben `ownerNumber:110`)
- `ownerNumberSeed: process.env.OWNER_NUMBER_SEED || ""` — analog `profilesSeed:189`.
- `ownerNumberProvider: (process.env.OWNER_NUMBER_PROVIDER || "").toLowerCase()` — **leer als Default**
  (unterscheidet "ungesetzt" → Twilio-Default von "gesetzt-aber-Muell" → Refusal).

### Wiederverwendet, KEIN Edit noetig
- `state-ops.seedOwnerNumber()` (`state-ops.js:331`) — bereits idempotent, `normNum`-normalisiert,
  No-Op bei leer, provider-Default Twilio, country/language DE/de.
- `defaults.js` — `PROVIDER {twilio,telnyx}:26`, `DEFAULT_PROVIDER:27`, `normNum:211`,
  `DEFAULT_COUNTRY/LANGUAGE:133-134`.
- `views.findActiveNumber()` (`views.js:20`) — fuer das AC6-Gate.

### Betroffene Dateien (gesamt)
| Datei | Aenderung |
|---|---|
| `src/config.js` | 2 neue Felder (`ownerNumberSeed`, `ownerNumberProvider`) |
| `src/store/json.js` | `seedOwnerNumberFromEnv()` + Aufruf in `finishLoad()`; `isValidE164`-Helper; Imports (`PROVIDER`, `findActiveNumber`) |
| `test/helpers.js` | `OWNER_NUMBER_SEED:""` + `OWNER_NUMBER_PROVIDER:""` in `BASE_ENV` (Drift-Schutz) |
| `test/owner-number-seed.test.js` (neu) | Spawn-/Unit-Tests fuer AC1-AC8 |
| `.env.example` | neuer Block + klare Abgrenzung zu `OWNER_NUMBER` |

---

## 3. Zentrale Design-Entscheidungen (ADR-kompakt)

### D1 — Eigene Env-Var, NICHT `OWNER_NUMBER` wiederverwenden ✅
`OWNER_NUMBER` (`config.ownerNumber`) ist im ganzen Code **ausschliesslich der private SMS-Empfaenger**
(`to`, `server.js:611`; Anzeige `api-read.js:64`; Trial-Check `check-setup.js`). Die Store-Owner-Nummer
ist die **Betriebsnummer** (`from` fuer Outbound/SMS + Inbound-Routing-Key `findTenantByNumber`).
Zwei verschiedene Nummern. `OWNER_NUMBER` zum Seeden zu missbrauchen wuerde die private Nummer als
Betriebsnummer einbrennen → Inbound-Bruch + privates Handy als geschaeftliche Caller-ID (Identitaets-Leak).
**Entscheidung:** Neue Var `OWNER_NUMBER_SEED` (+ `OWNER_NUMBER_PROVIDER`).
*(Alternative `OWNER_OPERATING_NUMBER` ist semantisch noch deutlicher gegen Konflation — falls das Team
staerkere Benennung bevorzugt; `OWNER_NUMBER_SEED` gewinnt fuer Naehe zum CLI `seed-owner-number` + zum
`PROFILES_JSON`-Seed-Modell.)*

### D2 — Provider: Default Twilio, Validierung bei gesetztem Wert ✅
- **Ungesetzt** → `DEFAULT_PROVIDER` (Twilio). Honoriert die haeufigste Konfiguration und die
  Boss-Vorgabe ("Provider? default-Twilio"); Zero-Config fuer Twilio-Owner.
- **Gesetzt + gueltig** (`twilio|telnyx`) → dieser Provider.
- **Gesetzt + ungueltig** (Tippfehler `twillio`) → **kein Seed** → Boot-Refusal (fail-closed, Var
  genannt). Verhindert die stille Falsch-Zuordnung (R1).
- **Telnyx-Owner-Hinweis:** Ein Telnyx-Owner MUSS `OWNER_NUMBER_PROVIDER=telnyx` setzen — sonst wird
  die Nummer als `twilio` geseedet und der Twilio-Client lehnt sie beim ersten Senden ab (lauter,
  nicht stiller Fehler, da `outboundFrom`/SMS dann den falschen Carrier-Client treffen). Wird in
  `.env.example` prominent dokumentiert; optional eine `check-setup.js`-Warnung (Folgeschritt).

### D3 — E.164-Format vor dem Seed validieren ✅
`normNum` strippt nur Trennzeichen, validiert KEIN E.164 → `"hallo"` waere truthy und wuerde als
aktive Nummer geseedet (gruener Boot, totes Routing — schlimmer als ehrlicher exit(1)). Der Wrapper
prueft daher `/^\+[1-9]\d{6,14}$/` nach `normNum`. **Bewusst im Wrapper**, nicht in `seedOwnerNumber`
selbst — so bleibt das geteilte Primitive (+ CLI + Bestands-Tests) verhaltens-erhaltend.

### D4 — Gate auf "noch keine aktive Owner-Nummer" ✅
Der Wrapper seedet nur, wenn `findActiveNumber(state, OWNER_TENANT_ID)` leer ist. Das subsumiert
Idempotenz (AC8), schuetzt vor Drift (Env ≠ Bestand → Store gewinnt, kein zweiter aktiver Record, R4)
und macht den pg-Pfad unschaedlich, falls je dort aufgerufen. **Store gewinnt** — konsistent mit der
`seedProfilesFromEnv`-Philosophie ("Store gewinnt pro Key", `json.js:152`).

### D5 — country/language NICHT als Env-Var (YAGNI) ✅
`seedOwnerNumber` defaultet DE/de (`DEFAULT_COUNTRY/LANGUAGE`) — korrekt fuer den DE-only-Launch
(`provisioningCountry:"DE"`). Ein Nicht-DE-Owner korrigiert die Sprache via Dashboard-Settings-Override
(`resolveCallLanguage` priorisiert `settings.language` zuerst). Additiv nachruestbar (Signatur traegt
die Parameter bereits).

---

## 4. Pre-Mortem-Risiken (priorisiert, mit Gegenmassnahme)

| # | Risiko | Schwere | Gegenmassnahme (→ AC) |
|---|---|---|---|
| **R1** | **Stille Falsch-Provider-Zuordnung** — Default-Twilio auf realer Telnyx-Nummer → Outbound/SMS bricht oder laeuft ueber falschen Carrier; gruener Boot. | HOCH | D2: Provider validieren; gesetzt+ungueltig = Refusal; Telnyx-Pflicht dokumentiert (AC4). |
| **R2** | **`OWNER_NUMBER`-Konflation** — privater Empfaenger wird Betriebs-/Absendernummer → Inbound-Bruch + Identitaets-Leak. | HOCH | D1: eigene Var, `OWNER_NUMBER` unangetastet (AC5). |
| **R3** | **Garbage-Nummer hebelt Fail-closed-Guard aus** — `normNum` validiert kein E.164 → gruener Boot mit totem Routing. | HOCH | D3: E.164-Regex vor Seed; ungueltig → Refusal (AC3). |
| **R4** | **Drift Env↔Store / Doppel-Seed** — Env ≠ Bestand → zwei aktive Nummern → nicht-deterministischer Absender; bei pg dauerhafte Zombie-Nummer. | HOCH | D4: nur seeden wenn keine aktive Owner-Nummer existiert; json-only Scope (AC6). |
| **R5** | **PII-Leak im Log** — neue Seed-Diagnose koennte die Nummer loggen. | MITTEL | AC7: nur Var-Name + Erwartung, nie Wert (Muster `numEnv`). |
| **R6** | **Boot-Reihenfolge** — Seed muss VOR dem Guard (`server.js:1167`) laufen. | MITTEL | Seed sitzt in `finishLoad()` ⊂ `store.load()` (`server.js:1140`) → vor dem Guard. Im Test absichern. |
| **R7** | **Render-spezifisch** — (a) Env gesetzt-aber-leer/Fehlformat; (c) `STORE_BACKEND=pg` auf Render macht Env-Seed ueberfluessig/schaedlich. | MITTEL | (a) durch D3 abgedeckt; (c) json-only Scope + `.env.example`-Hinweis "Env-Seed ist fuer json/fluechtiges FS; bei pg Nummer einmalig via CLI". |
| **R8** | **Test-Baseline-Drift** — lokale `.env` mit gesetztem `OWNER_NUMBER_SEED` leckt via dotenv in Spawn-Tests → bricht u.a. den Boot-Refusal-Test. | MITTEL | `OWNER_NUMBER_SEED:""` + `OWNER_NUMBER_PROVIDER:""` in `helpers.js` `BASE_ENV` (dokumentierte "test-base-env-drift"-Lehre). |
| **R9** | **Falscher Geo-Anker** (DE/de hart auf Nicht-DE-Owner). | NIEDRIG | D5: DE-Launch korrekt; Dashboard-Override existiert; spaeter nachruestbar. |

---

## 5. Phasenplan

> Klein gehalten — ein fokussierter Fix. Reihenfolge: P1 → (P2 ∥ P3).

### Phase 1 — config + Seed-Wrapper (Kern) · **nicht parallelisierbar**
- **Dateien:** `src/config.js` (2 Felder), `src/store/json.js` (`seedOwnerNumberFromEnv` + `isValidE164`
  + Aufruf in `finishLoad`; Imports `PROVIDER`, `findActiveNumber`).
- **Wiederverwendet (kein Edit):** `state-ops.seedOwnerNumber`, `defaults.PROVIDER/normNum`.
- **Tests:** Unit/Spawn — Default-Provider Twilio; explizit telnyx; gesetzt+Muell-Provider → Refusal;
  Garbage-E.164 → Refusal; leere Var → No-Op; AC6-Gate (Bestand gewinnt).

### Phase 2 — Test-Harness-Gating · **parallelisierbar mit P3** (nach P1)
- **Dateien:** `test/helpers.js` — `OWNER_NUMBER_SEED:""` + `OWNER_NUMBER_PROVIDER:""` in `BASE_ENV`.
- **Tests:** gesamte Bestandssuite gruen (besonders `boot-failclosed.test.js`). Reine Drift-Absicherung (R8).

### Phase 3 — Boot-Integrationstest + Doku · **parallelisierbar mit P2** (nach P1)
- **Dateien:** `test/owner-number-seed.test.js` (neu) — Render-Beweis: kein store.json-Seed
  (`ownerNumber:null`) + gueltige Env → Boot OK, `/healthz` 200, `readStore()` zeigt Nummer mit
  korrektem provider/status/tenantId. Gegenprobe: leere Env → exit(1) (Regression zu
  `boot-failclosed.test.js`). `.env.example` — `OWNER_NUMBER_SEED` + `OWNER_NUMBER_PROVIDER`
  dokumentieren, mit kontrastierendem Kommentar zu `OWNER_NUMBER` (= privater SMS-Empfaenger).

### Optionaler Folgeschritt (out of scope)
- pg-Symmetrie in `pg.js::init` (nur bei leerer number-Tabelle) — NUR falls pg-Deploys denselben
  Komfort sollen. Fuer Render-free nicht noetig.
- `check-setup.js`-Warnung bei Telnyx-Nummer ohne `OWNER_NUMBER_PROVIDER=telnyx`.

---

## 6. Risiko-Dokumentation (explizit gefordert)

### Was passiert, wenn `OWNER_NUMBER_SEED` leer ist?
**Fail-closed bleibt.** Leere Var → Wrapper No-Op (`if (!raw) return`) → keine Nummer im Store →
Boot-Guard (`server.js:1167`) greift → exit(1) mit der bestehenden, actionable Diagnose (verweist
aufs Seed-CLI). Der heutige Sicherheitsvertrag ist unveraendert (AC2; Regressionstest gegen
`boot-failclosed.test.js:24-33`).
> Hinweis: `OWNER_NUMBER` (privater SMS-Empfaenger) und `OWNER_NUMBER_SEED` (Betriebsnummer) sind
> getrennt — eine leere `OWNER_NUMBER_SEED` betrifft NIE die SMS-Empfaengernummer (D1/R2).

### Was beim Provider?
**Default Twilio** (`DEFAULT_PROVIDER`), wenn `OWNER_NUMBER_PROVIDER` ungesetzt ist — die haeufigste
Konfiguration, Zero-Config fuer Twilio-Owner. Ein **gesetzter, aber ungueltiger** Provider (Tippfehler)
fuehrt fail-closed zu **keinem Seed → Boot-Refusal** (Var genannt), statt still die falsche
Carrier-Zuordnung zu schreiben (R1/AC4). **Telnyx-Owner MUSS** `OWNER_NUMBER_PROVIDER=telnyx` setzen
(dokumentiert in `.env.example`).
