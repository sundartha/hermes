# Strategie F2 — Inbound-Call: SMS-Zusammenfassung an die private Tenant-Nummer

> Status: **Entwurf / Entscheidungsreif**. Erstellt von einem Agent-Team (Architektur-Plan + adversarialer
> Pre-Mortem), geerdet am verifizierten Code-Stand (Branch `wip/a3-p2-seam`).
> **Eine offene Owner-Entscheidung** (Abschnitt 5) blockiert den Start NICHT, legt aber das Zielbild fest.

## 0. Ausgangslage (verifiziert)

Nach einem Inbound-Call erzeugt `summarizeCall()` (`src/claude.js:292`) eine Zusammenfassung. In
`finishCall()` (`src/server.js:561`) wird sie als SMS verschickt. Der **Absender** ist bereits
tenant-aware:

```js
// src/server.js:594
const smsFrom = findActiveNumber(store.load(), call.tenantId, call.provider);
if (config.sendSmsSummary && config.ownerNumber && smsFrom) {
  // ...
  await messaging(call.provider).sendSms({ from: smsFrom.e164, to: config.ownerNumber, body: sms.slice(0, 1500) });
}
```

**Nur das Ziel (`to: config.ownerNumber`) ist noch fest.** Genau das stellt F2 um: Ziel soll die private
Mobilnummer des registrierten Tenants sein. Der Versand läuft heute schon in einem inneren `try/catch`
(`console.error`, kein `throw`); das bleibt.

Relevanter Kontext: **„Owner = Tenant Null"** (jüngste Commits) — der Owner IST ein Tenant
(`OWNER_TENANT_ID = "owner"`, `src/store/defaults.js:8`); Absendernummern kommen schon aus dem Store
statt aus Env. `config.ownerNumber` wird außer in `finishCall` nur noch in `src/routes/api-read.js:64`
(Owner-View-Anzeige) genutzt.

---

## 1. Ziel und Akzeptanzkriterien

### Ziel
Die Call-Summary-SMS geht nach einem Inbound-Call an die **private Mobilnummer des betroffenen Tenants**
(E.164), nicht mehr an die feste `config.ownerNumber`. Der Tenant erfasst diese Nummer bei der
Registrierung und verwaltet sie selbst über Self-Service.

### Akzeptanzkriterien („Done")
1. **Datenmodell:** Der Tenant-Record kann ein optionales Feld `privateNumber` (E.164-String) tragen —
   in **beiden** Store-Backends (`json` + `pg`) round-trip-fest persistiert.
2. **Registrierung:** `POST /api/onboard` nimmt `privateNumber` als **optionales** Feld entgegen und
   speichert es validiert; fehlt es, wird der Tenant wie heute angelegt (Feld bleibt weg).
3. **Self-Service:** Der eingeloggte Tenant kann seine eigene `privateNumber` **lesen** (GET) und
   **setzen/ändern/leeren** (Write) — fail-closed über die Web-Session (`webAuthMw`), nie für einen
   fremden Tenant.
4. **Validierung:** Jede gesetzte `privateNumber` wird zentral normalisiert (`normNum`) und gegen
   `E164` geprüft; **nur die normalisierte Form** wird gespeichert (eine Quelle, kein Drift). Ungültige
   Eingabe ⇒ Ablehnung (kein Müll at rest).
5. **Versand:** `finishCall` zieht das SMS-Ziel **ausschließlich über `call.tenantId`**. Hat der Tenant
   eine `privateNumber`, geht die SMS dorthin; hat er keine, wird die Summary-SMS **still übersprungen**
   (mit Audit-Marker, ohne PII) — **kein Fallback auf `config.ownerNumber` im `finishCall`-Pfad**.
6. **Owner-Kontinuität:** Der Owner verliert seine Summary-SMS **nicht still** (siehe Abschnitt 5 —
   empfohlene Lösung: Owner-`privateNumber` einmalig aus `config.ownerNumber` seeden).
7. **PII/DSGVO:** `privateNumber` leakt nicht in geteilte Serialisierungen/Logs; sie ist in
   `exportTenantData` (Art. 15) enthalten und wird von der Tenant-Löschung (Art. 17) erfasst.
8. **Tests:** Jede neue/geänderte Funktion hat Tests inkl. der Negativfälle (kein Ziel / falscher Tenant /
   Müll-Eingabe). `node --test` grün für `json` **und** `pg` (pglite).

---

## 2. Architektur-Skizze

### Datenfluss (Soll)

```
REGISTRIERUNG                         SPEICHERUNG                         SMS-VERSAND
─────────────                         ───────────                         ───────────
POST /api/onboard                     tenant-Record                       finishCall(call)
{tenantId, firstName,        ──►      { id, status, ownerName,    ──►     summarizeCall() OK
  lastName, privateNumber?}             firstName, privateNumber? }         tenantPrivateNumber(call.tenantId)
   │ registerTenant(s,id,{...})         │                                    │
   │   → setPrivateNumber-Logik         ├─ json: data/store.json (auto)      ├─ vorhanden → to = privateNumber → sendSms
   │     (normNum → E164 → store)       └─ pg:  tenant.private_number TEXT    └─ leer → SMS überspringen + audit(skip)
SELF-SERVICE                                 (schema.sql + hydrate + flush)
────────────
Write /api/self-service/private-number ──► setPrivateNumber(req.tenant.tenantId, e164) → mutate + save
GET   /api/self-service/state          ──► privateNumber (nur EIGENE, für „deine hinterlegte Nummer")
```

### Wo lebt `privateNumber`? — Auf dem **Tenant-Record**

Genau wie `ownerName` / `firstName` / `kycLevel` / `stripeCustomerId`. **Nicht** im Settings-Bucket.
Begründung:
- `privateNumber` ist **Identitäts-/Kontaktdatum**, kein verhaltensänderndes Setting. Settings laufen
  über `updateSettings` + `selfServicePatch` (Greeting-/Persona-Whitelist) — dort gehört PII fachlich
  nicht hin.
- Würde sie als Setting abgelegt, leakt sie **automatisch** über jede `settings`-Serialisierung
  (`GET /api/self-service/state` gibt `ctx.settings` komplett zurück; siehe Risiko H4) und der
  generische Settings-Typcheck (`typeof === "string"`) ließe **jeden** String durch (Risiko H2).

### Validierung — **eine** Quelle, **eine** Reihenfolge

Die gesamte Setz-Logik lebt **einmal** in `state-ops.js` und wird von Onboard **und** Self-Service
genutzt (G5, kein Copy-Paste):

```
setPrivateNumber(s, tenantId, raw) -> tenant            // reine Mutation, kein IO
  1. findTenant; fehlt        → throw (kein stilles No-Op, Muster wie setKycLevel)
  2. raw leer / "" / null     → delete tenant.privateNumber (Feld weg, Owner-Fallback bleibt verlässlich)
  3. e164 = normNum(raw)      → ZUERST normalisieren (Whitespace/-/() strippen)
  4. !E164.test(e164)         → throw/reject (kein Müll at rest)
  5. tenant.privateNumber = e164                          // NUR die normalisierte Form speichern
```

Reihenfolge **normNum → E164 → speichere normalisierte Form** ist verbindlich (Risiko M3): so matchen
Eingabe `"+49 (170) 123-4567"`, gespeicherte Form `"+491701234567"` und spätere Vergleiche garantiert.

### Store-Facade (Symmetrie zu `setKycLevel` / `tenantStripe`)
- **Mutation:** `setPrivateNumber(tenantId, e164)` — Wrapper in `src/store/json.js` (mutate → `save`) **und**
  `src/store/pg.js` (mutate → flush). Kernlogik in `state-ops.js` (oben).
- **Query:** schmaler Reader `tenantPrivateNumber(tenantId)` (reine Query, kein `save`) — Pendant zu
  `tenantStripe` / `kycReached`. `finishCall` ruft **diesen** Reader auf.

### Wie kommt `privateNumber` in `finishCall`? — **Nicht** über `tenantContext`

`tenantContext` (`state-ops.js:340`) ist die **LLM-Persona-/View-Quelle** (`ownerName, firstName,
settings, calendar`); sie fließt in Inbound-Greeting und `summarizeCall`. PII gehört dort nicht hin.
`finishCall` liest ohnehin schon roh aus dem Store (`findActiveNumber(store.load(), call.tenantId, ...)`).
Das Ziel wird über den schmalen Reader **am selben Schlüssel `call.tenantId`** wie der Absender gezogen:

```js
// finishCall, statt to: config.ownerNumber:
const to = store.tenantPrivateNumber(call.tenantId);          // EIN Lookup-Key: call.tenantId
if (config.sendSmsSummary && to && smsFrom) {
  // ... sendSms({ from: smsFrom.e164, to, body: sms.slice(0, 1500) })
} else if (config.sendSmsSummary && !to) {
  audit("sms_summary_skipped", ..., "reason=no_private_number");   // ohne PII
}
```

`call.tenantId` als **einziger** Auflöse-Schlüssel verhindert Cross-Tenant-Fehlzustellung (Risiko H3).
Der `to`-Guard ist fail-closed wie heute der `smsFrom`-Guard.

---

## 3. Pre-Mortem-Risiken (benannt und entschärft)

Die gefährlichste Eigenschaft von F2: es berührt **fünf Stellen gleichzeitig** (Schema, Validierung/
Self-Service, Versand-Lookup, Export, Erase). Jede vergessene Stelle scheitert **still** — keine
Exception, nur fehlende SMS oder ungelöschte PII. Deshalb deckt jeder Test explizit den Negativfall ab.

### Hoch

| ID | Risiko | Eintrittsweg | Entschärfung (testbar) |
|----|--------|--------------|------------------------|
| **H1** | **Toll-Fraud / Kostenexplosion** | Tenant setzt `privateNumber` auf Premium-/Satelliten-/Auslandsnummer (`E164` erlaubt z.B. `+8821…`); jeder (selbst provozierte) Inbound-Call löst eine von **uns** bezahlte SMS aus. | **SHOULD:** zusätzlich zur E.164-Prüfung eine **Ländercode-Allowlist** spiegeln (Konzept wie `config.allowedCountryCodes`, Default `+49`) + Premium-Range-Blocklist im Setter. **SHOULD:** Summary-SMS-Cap pro Tenant/Tag (vorhandener `recordUsageEvent`-Pfad). Test: `privateNumber=+888…` → Reject; N+1 Calls/Tag → genau N SMS. |
| **H2** | **Validierungs-Umgehung** | `privateNumber` als gewöhnliches Settings-Free-Field ⇒ nur Typcheck „ist String" ⇒ `"hallo"`, leer, später gekippt kommt durch. | `privateNumber` **nicht** in Settings/Free-Fields; eigener Setter `setPrivateNumber` mit `normNum→E164` ist die **einzige** Schreibtür (Onboard + Self-Service). Test: `Write privateNumber="abc"` → Reject, alter Wert bleibt. |
| **H3** | **Cross-Tenant-Fehlzustellung** | Ziel über *Absender*-Nummer / provider-only-Lookup statt `call.tenantId` ⇒ Summary von A geht an `privateNumber(B)` (Inhalt + PII). | Ziel **ausschließlich** über `call.tenantId` (`tenantPrivateNumber(call.tenantId)`), identisch zur Absenderquelle. Property-Test: zwei Tenants, gleiche Provider-Familie, Call an A → `to == privateNumber(A)`, nie B. |
| **H4** | **PII-Leck** | `GET /api/self-service/state` gibt `settings` komplett zurück; `/api/state` zeigt Owner-View. Liegt `privateNumber` in `settings` oder wird in SMS-`catch` geloggt → Leak in Response/Logs. | (a) Record-Feld, nicht Setting (H2). (b) Lese-Sicht gibt nur die **eigene** Nummer zurück (ggf. maskiert `+49…4567`), nie fremde. (c) SMS-`catch` loggt **nie** `to`/Nummer. Statischer Test: grep auf `console.*privateNumber` → 0 Treffer. |
| **H5** | **DSGVO: Export & Löschung** | `exportTenantData` liefert keine Record-Felder; `eraseTenantData` fasst den Tenant-Record nicht an. `privateNumber` ist PII ⇒ Auskunft (Art. 15) unvollständig, Löschung (Art. 17) greift nicht. | `privateNumber` in `exportTenantData` aufnehmen; bei Tenant-Löschung (`eraseTenantData` / `scripts/erase-tenant.js`) entfernen/nullen. Test: set → Export enthält sie → Erase → Record/Export leer. |

### Mittel

| ID | Risiko | Eintrittsweg | Entschärfung (testbar) |
|----|--------|--------------|------------------------|
| **M1** | **json↔pg-Drift / Migration** | Bestandstenants haben kein Feld; pg braucht Spalte + hydrate/flush-Mapping. Vergessen ⇒ in json gesetzt, nach pg-Restart weg (still). | Idempotentes `ALTER TABLE tenant ADD COLUMN IF NOT EXISTS private_number TEXT` (Muster `schema.sql:23`) + Spalte in `hydrateTenants`-SELECT und `flushTenants`-INSERT/UPDATE. Backend-Paritäts-Test (json == pg). |
| **M2** | **Owner verliert SMS still** | Heute bekommt Owner **immer** SMS; neu nur mit `privateNumber`, kein Fallback. Owner-Tenant hat das neue Feld initial nicht ⇒ ab Deploy still keine SMS mehr. | **Owner-`privateNumber` einmalig aus `config.ownerNumber` seeden** (idempotent, Muster `seedOwnerIdentity` `state-ops.js:380`); Boot-Log-Warnung, wenn Owner-Tenant danach keine `privateNumber` hat. Siehe Abschnitt 5. |
| **M3** | **Format-Inkonsistenz E.164↔normNum** | Validierung vor/ohne `normNum` ⇒ Trennzeichen-Nummer failt Regex oder wird roh gespeichert und matcht später nicht. | Eine Reihenfolge: `normNum` → `E164.test` → normalisierte Form speichern. Test: `"+49 (170) 123-4567"` → `"+491701234567"`; `"0170…"` (ohne `+`) → Reject. |
| **M4** | **Crash bei null/leer in finishCall** | `privateNumber` vor dem Guard gelesen + String-Op (`.slice`) auf `undefined` ⇒ äußerer `catch` verschluckt restliche Notification-Logik; `to: undefined` an `sendSms`. | Guard `if (config.sendSmsSummary && to && smsFrom)` **vor** jeder String-Op (Vorbild: `smsFrom`-Guard). Test: Tenant ohne Nummer → keine SMS, Notification trotzdem erstellt, kein Throw. |

### Niedrig

| ID | Risiko | Eintrittsweg | Entschärfung (testbar) |
|----|--------|--------------|------------------------|
| **N1** | **Race/Concurrency** | Paralleles Onboard + Self-Service-Set auf demselben Tenant ⇒ mem/disk-Divergenz / Lost-Update. | Set über denselben `withStoreLock`+`save`-Pfad wie andere Mutationen. Test: zwei parallele Sets → letzter gewinnt deterministisch, Record nicht verloren. |
| **N2** | **Keine Sichtbarkeit „SMS übersprungen"** | Ohne `privateNumber` wird still übersprungen — kein Signal, ob Absicht oder Fehler. | `audit("sms_summary_skipped", …, "reason=no_private_number")` (ohne Nummer). Test: Call ohne Nummer → Audit-Zeile mit Reason, ohne PII. |

**Must-Fix vor Launch:** H1, H2, H3, H4, H5, M2.

---

## 4. Phasenplan

Leitidee: **Datenmodell-Seam zuerst** (Setter/Reader + beide Facades + pg-Persistenz), danach die
Konsumenten (Onboard / Self-Service / finishCall) **echt parallel**, weil sie nur gegen die fertige
Facade arbeiten und disjunkte Dateien anfassen. Jede Phase ist klein und einzeln per `node --test` testbar.

| # | Phase | Ziel | Betroffene Dateien | Parallel | Akzeptanz |
|---|-------|------|--------------------|----------|-----------|
| **P0** | Validierungs-Seam bestätigen | Sicherstellen, dass `E164` (`routes/_validation.js`) + `normNum` (`store/defaults.js`) ohne Import-Zyklus in `state-ops` nutzbar sind | (nur lesen) | — | Kein Code; Import-Pfad bestätigt. Bei Zyklus → kleiner lokaler Helfer in `state-ops`. |
| **P1** | **Modell-Kern** | `setPrivateNumber(s,id,raw)` (normNum→E164→store; leer→delete; fehlender Tenant→throw) + `tenantPrivateNumber(s,id)`-Query | `src/store/state-ops.js` | nein (Wurzel) | Unit: gültig setzt normalisiert; ungültig wirft; `""`/null löscht; fehlender Tenant wirft; Reader liefert Wert/`""`. |
| **P2** | Facade **json** | `setPrivateNumber` (mutate→save) + `tenantPrivateNumber` (Query) | `src/store/json.js` | ja (nach P1) | json-Round-Trip: set → reload → read. |
| **P3** | Facade **pg** + Persistenz | Wrapper + Spalte `private_number TEXT`, hydrate, flush | `src/store/pg.js`, `src/db/schema.sql` | ja (nach P1) | pglite: `ALTER … ADD COLUMN IF NOT EXISTS`; set → flush → hydrate round-trip; SELECT- + INSERT/ON-CONFLICT-Liste ergänzt. **Paritäts-Test json==pg (M1).** |
| **P4** | **Registrierung** | `registerTenant` nimmt optional `privateNumber` (teilt P1-Setzlogik); `POST /api/onboard` reicht es durch | `src/store/state-ops.js`, `src/server.js:927` | ja (nach P1) | Onboard mit gültiger Nummer → Record trägt sie; ungültig → Reject/Feld weg; Idempotenz von `registerTenant` bleibt. |
| **P5** | Self-Service **Write** | Eigene Route (z.B. `POST /api/self-service/private-number`, `webAuthMw`) → `setPrivateNumber(req.tenant.tenantId, …)`; **nicht** über `selfServicePatch` | `src/self-service-routes.js` | ja (nach P2/P3) | Eigene Nummer setzen/leeren; ungültig → 400; kein Cookie → 401; Audit nur „set"/Reason, **kein Wert** (H4). |
| **P6** | Self-Service **Read** | `GET /api/self-service/state` liefert die **eigene** `privateNumber` (für UI „deine hinterlegte Nummer", ggf. maskiert) | `src/self-service-routes.js` | ja (mit P5) | State liefert eigene Nummer; nie fremde; Identität = `req.tenant.tenantId`, fail-closed. |
| **P7** | **finishCall-Umstellung** | SMS-Ziel = `tenantPrivateNumber(call.tenantId)` statt `config.ownerNumber`; kein Ziel → skip + `audit(sms_summary_skipped)`; Guard fail-closed | `src/server.js:591-608` | ja (nach P2/P3) | Tenant mit Nummer → SMS dorthin; ohne → keine SMS, Notification bleibt, kein Throw; Cross-Tenant-Property-Test (H3); kein PII-Log (H4). |
| **P8** | **DSGVO Export/Erase** | `privateNumber` in `exportTenantData`; Tenant-Löschung entfernt sie | `src/store/state-ops.js` (+ ggf. `scripts/erase-tenant.js`) | ja (nach P1) | set → Export enthält sie → Erase → leer (H5). |
| **P9** | **Owner-Seed-Migration** | Owner-`privateNumber` idempotent aus `config.ownerNumber` seeden (Abschnitt 5, falls Option b gewählt) + Boot-Warnung wenn leer | `src/store/state-ops.js`, `src/store/json.js`+`pg.js` (Seed-Aufruf, Muster `seedOwnerIdentity`) | ja (nach P1) | Frischer Owner mit `OWNER_NUMBER` → nach Boot `privateNumber(owner)==config.ownerNumber` (normalisiert) → Call → SMS geht raus (M2). |
| **P10** | **Integrationstest** | End-to-end Inbound → Summary → korrektes SMS-Ziel; Owner-Tenant-Null-Pfad; beide Backends | `test/…` (nur neue Tests) | nein (Sammelpunkt) | `node --test` grün für json **und** pg; Owner-Pfad grün. |

### Abhängigkeitsgraph

```
P0 ─► P1 ─┬─► P2 ─┬───────────────► P5 ─► P6
          │       │
          ├─► P3 ─┤
          │       └───────────────► P7
          ├─► P4 ───────────────────────────► P10 (sammelt P4·P5·P6·P7·P8·P9)
          ├─► P8 ───────────────────────────►
          └─► P9 ───────────────────────────►
```

Kritischer Pfad: **P0 → P1 → {P2, P3} → P7 → P10**. Nach P1 + Facade-Schicht laufen **P4, P5/P6, P7, P8,
P9 parallel** (disjunkte Dateien/Konsumenten). P10 ist der einzige Sammelpunkt.

### Idiom-Checks (pro Phase)
- **G5 / kein Drift:** Setz-/Validierlogik lebt **einmal** in `state-ops`; json-/pg-Wrapper sind dünn;
  Paritäts-Test sichert Byte-Gleichheit beider Backends.
- **fail-closed:** ungültige/leere Nummer → Reject/Feld weg; fehlender Tenant → throw; kein Ziel → SMS skip.
- **kein PII im Log:** Audit/`console` nur Keys/Reason-Marker, nie die Nummer (Muster `self_service_settings`).

---

## 5. Offene Owner-Entscheidung (blockiert den Start NICHT)

**Frage:** Soll der Owner (`config.ownerNumber`) weiterhin Summary-SMS bekommen — und wie?

Kontext „Owner = Tenant Null": Der Owner ist ein Tenant (`OWNER_TENANT_ID="owner"`); Inbound-Calls an seine
Nummer laufen mit `call.tenantId === "owner"`. Wenn er seine `privateNumber` auf dem Owner-Tenant trägt,
bekommt er die SMS über **denselben generischen Pfad** wie jeder Tenant — `config.ownerNumber` wird in
`finishCall` redundant.

| Option | Verhalten | Pro | Contra |
|--------|-----------|-----|--------|
| **(a)** Owner bekommt Kopie via `config.ownerNumber` parallel | finishCall sendet zusätzlich an `config.ownerNumber` | Owner verliert nie eine SMS | Bricht G5 (zwei Zielpfade); **Doppelversand** bei Owner-Calls; `config.ownerNumber`-Sonderzweig bleibt — widerspricht Anforderung #5 „kein Fallback". |
| **(b) — empfohlen** Generischer Pfad + **Owner-Seed** | finishCall **ohne** `config.ownerNumber`; Owner-`privateNumber` einmalig aus `config.ownerNumber` geseedet (P9) | Maximal G5-konform (ein Pfad für alle); erfüllt Anforderung #5 wörtlich; **kein** stiller Owner-Verlust (M2 entschärft); Zielbild „Owner = Tenant Null" erreicht | `config.ownerNumber` bleibt vorerst nur als **Seed-Quelle** + in `api-read.js:64` (Owner-View); spätere separate Phase entfernt es ganz. |
| **(c)** `config.ownerNumber` als Laufzeit-**Fallback** in finishCall | `to = privateNumber || config.ownerNumber` | Keine Funktionslücke; kein Doppelversand | **Widerspricht Anforderung #4** (kein Fallback im finishCall-Pfad); Rest-Sonderzweig bleibt dauerhaft in der Versandlogik. |

**Empfehlung des Agent-Teams: Option (b).** Sie ist die einzige, die die Anforderung („kein Fallback im
`finishCall`") **wörtlich** erfüllt **und** den stillen Owner-SMS-Verlust (M2) vermeidet — durch einen
einmaligen, idempotenten Seed der Owner-`privateNumber` aus `config.ownerNumber` (Muster `seedOwnerIdentity`).
Der `finishCall`-Pfad bleibt damit ein **einziger** generischer Lookup ohne config-Sonderzweig.
`config.ownerNumber` lebt übergangsweise nur noch als Seed-Quelle und Owner-View-Anzeige und kann in einem
**separaten** späteren Schritt vollständig entfernt werden, sobald der Owner-Record garantiert eine
`privateNumber` trägt.

> **Entscheidung erforderlich vom Owner:** (b) bestätigen (dann P9 einplanen) — oder (c) wählen, falls ein
> dauerhafter Laufzeit-Fallback gewünscht ist (dann Anforderung #4 entsprechend lockern). (a) wird wegen
> Doppelversand/G5-Bruch nicht empfohlen.
