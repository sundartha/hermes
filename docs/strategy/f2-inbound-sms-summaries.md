# Strategie F2 — Inbound-Call: SMS-Zusammenfassung an die private Nummer des Users

> Status: **Entwurf / entscheidungsreif**. Erstellt von einem Agent-Team (3 parallele Code-Rechercheure +
> Synthese), geerdet am verifizierten Code-Stand (Branch `wip/a3-p2-seam`). **Kein Code, kein Patch — nur Plan.**
> Verwandtes Schwesterdokument: [`inbound-sms-summary.md`](./inbound-sms-summary.md) (gleiches Feature, gleiche
> Stoßrichtung). Dieses Dokument ist eigenständig geerdet und ergänzt drei im Schwesterdoc fehlende
> Befunde: **fehlendes SMS-Cost-Metering**, **In-Memory-Dedup-Lücke beim Prozess-Restart** und das **Opt-Out
> über das `allowSummaries`-Muster**.

---

## 0. Reality-Check — Auftrag vs. verifizierter Code

Der Auftrag formuliert das Feature als „der **map Agent** soll nach einem Inbound-Call eine Zusammenfassung
per SMS schicken **können**". Der verifizierte Code-Stand zeigt: **Das passiert bereits.** Drei Annahmen des
Auftrags weichen vom Code ab — das verschiebt den eigentlichen Arbeitsumfang:

| Auftrags-Annahme                                                                        | Verifizierter Code-Stand                                                                                                                                                                                                                                                                             | Konsequenz                                                                               |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Es gibt einen „**map Agent**" (`src/map-agent.js`).                                     | **Existiert nicht.** Keine Datei, kein `map-agent`-Symbol. Die Zusammenfassung erzeugt `summarizeCall(call)` (`src/claude.js:292`), aufgerufen aus **genau einer** Stelle: `finishCall` (`src/server.js:579`). Gatekeeper: `if (!s.allowSummaries) return null` (`claude.js:296`).                   | „Map Agent" = `summarizeCall`. Kein neuer Agent nötig.                                   |
| Der Map Agent „**soll SMS schicken können**" (neu zu bauen).                            | **SMS-Versand existiert bereits** in `finishCall` (`src/server.js:594-607`): `messaging(call.provider).sendSms({from: smsFrom.e164, to: config.ownerNumber, body: sms.slice(0,1500)})`.                                                                                                              | F2 baut **keinen** neuen Versand. F2 ändert **das Ziel** und **erfasst die Zielnummer**. |
| Provider-Auswahl via `messagingForNumber(s, numberId)` / `findNumberMessagingProvider`. | **Beide Funktionen existieren nicht** (repo-weiter grep: 0 Treffer). Provider kommt aus `call.provider`; `messaging(provider)` (`registry.js:29`) wählt Telnyx vs. Twilio (Default-Fallthrough Twilio). Absender via `findActiveNumber(store.load(), call.tenantId, call.provider)` (`views.js:20`). | Provider-Pfad ist **schon korrekt**; F2 fasst ihn nicht an.                              |

**Der echte F2-Kern** ist damit eng umrissen:

1. **Erfassung** der privaten Mobilnummer des Users bei der Registrierung (`POST /api/onboard`).
2. **Persistenz** auf dem Tenant-Record (`privateNumber`, E.164) — in **beiden** Backends (`json` + `pg`).
3. **Umstellung des Ziels** in `finishCall`: `to = privateNumber(call.tenantId)` statt `config.ownerNumber`.
4. **Querschnitt:** Self-Service (lesen/ändern), Opt-Out, Kosten-Schutz, DSGVO (Export/Erase), PII-Dichtheit.

> Heutige Versand-Stelle (`src/server.js:594-607`), wörtlich:
>
> ```js
> const smsFrom = findActiveNumber(store.load(), call.tenantId, call.provider);
> if (config.sendSmsSummary && config.ownerNumber && smsFrom) {
>   const sms = `[${store.tenantContext(call.tenantId).settings.agentName}] ${who}\n\n${result.summary}` + …;
>   try {
>     await messaging(call.provider).sendSms({ from: smsFrom.e164, to: config.ownerNumber, body: sms.slice(0, 1500) });
>   } catch (e) { console.error("[sms]", e.message, …); }   // wirft nie, kein Retry
> }
> ```
>
> **Nur `to: config.ownerNumber` ist fest.** `config.ownerNumber` ist außerdem **Teil des Guards** —
> beim Umbau muss dieser Guard-Term durch die private Nummer ersetzt werden, sonst läuft der Versand nie.

---

## 1. Ziel und Akzeptanzkriterien

### Ziel

Nach einem Inbound-Call geht die Gesprächs-Zusammenfassung als SMS an die **private Mobilnummer des
betroffenen Tenants** (E.164), die dieser bei der Registrierung angibt und selbst verwaltet — nicht mehr an
die feste `config.ownerNumber`. Versand ist **kosten-bewusst**, **dedupliziert**, **DSGVO-konform** und
**PII-dicht**.

### Pflicht- vs. Optional-Frage (Auftrag)

Die private Nummer ist **optional** für die Registrierung (ein Tenant kann ohne sie onboarden) und
**Voraussetzung** für die SMS-Zusammenfassung: keine Nummer ⇒ keine Summary-SMS (still übersprungen,
mit PII-freiem Audit-Marker). Das ist die Opt-In-Semantik per Datenvorhandensein; ein zusätzliches
explizites Opt-Out (Abschnitt 2.5) erlaubt „Nummer da (für Login/Kontakt), aber bitte keine SMS".

### Akzeptanzkriterien („Done")

1. **Datenmodell:** Tenant-Record trägt optional `privateNumber` (E.164-String), round-trip-fest in `json`
   **und** `pg` (`tenant.private_number TEXT`).
2. **Registrierung:** `POST /api/onboard` nimmt `privateNumber` **optional** entgegen, normalisiert
   (`normNum`) und validiert (`E164`); fehlt es, onboardet der Tenant wie heute.
3. **Self-Service:** Eingeloggter Tenant kann **seine eigene** `privateNumber` lesen und setzen/ändern/leeren
   (`webAuthMw`, fail-closed, nie fremder Tenant). Schreibtür ist ein **dedizierter** Setter — **nicht**
   `selfServicePatch`/`updateSettings`.
4. **Validierung — eine Quelle:** `normNum → E164.test → nur normalisierte Form speichern`. Ungültig ⇒
   Reject (kein Müll at rest). Identische Logik für Onboard und Self-Service (kein Copy-Paste).
5. **Versand:** `finishCall` zieht das Ziel **ausschließlich** über `call.tenantId`
   (`tenantPrivateNumber(call.tenantId)`). Kein Ziel ⇒ SMS still übersprungen + `audit("sms_summary_skipped",
…, reason=no_private_number)` (ohne Nummer). **Kein `config.ownerNumber`-Fallback im `finishCall`-Pfad.**
6. **Owner-Kontinuität:** Der Owner (`OWNER_TENANT_ID="owner"`) verliert seine Summary-SMS **nicht still**
   (Abschnitt 5 — empfohlen: Owner-`privateNumber` einmalig aus `config.ownerNumber` seeden).
7. **Kosten-Schutz:** Jede gesendete Summary-SMS erzeugt ein `recordUsageEvent({kind: SMS, …})`
   (heute **nie** emittiert) **und** wird durch eine Ländercode-/Premium-Range-Prüfung im Setter sowie ein
   Tages-Cap pro Tenant begrenzt. Test: `+888…` → Reject; N+1 Calls/Tag → höchstens N SMS.
8. **Dedup robust:** Genau **eine** Summary-SMS pro Call — auch bei mehrfachem `/voice/status`-Callback **und**
   bei Prozess-Restart zwischen Call-Ende und spätem Retry (heute: nur In-Memory-Flag, Abschnitt 3/M2).
9. **PII/DSGVO:** `privateNumber` leakt nicht in `/api/state`, MCP, Logs oder Audit; sie ist in
   `exportTenantData` (Art. 15) enthalten und wird von Tenant-Löschung (Art. 17) erfasst.
10. **Tests:** Jede neue/geänderte Funktion mit Negativfällen (kein Ziel / falscher Tenant / Müll / Premium-
    Range / Doppel-Callback). `node --test` grün für `json` **und** `pg` (pglite).

---

## 2. Architektur-Skizze

### 2.1 Datenfluss (Soll)

```
REGISTRIERUNG                       SPEICHERUNG                        SMS-VERSAND (finishCall)
─────────────                       ───────────                       ────────────────────────
POST /api/onboard                   tenant-Record                     /voice/status completed (o. bridge/cancel)
{tenantId, firstName,      ──►      { id, status, ownerName,   ──►    if (call._finished) return  (Dedup)
  lastName, privateNumber?}           firstName, privateNumber? }      summarizeCall(call)  → result
   │ registerTenant(s,id,{…})         │                                to = tenantPrivateNumber(call.tenantId)
   │   normNum→E164→store            ├─ json: data/store.json         optOut? / kein to? → skip + audit(no PII)
                                      └─ pg:  tenant.private_number    cost-guard (Allowlist + Tages-Cap)
SELF-SERVICE                              (schema + hydrate + flush)   sendSms({from: smsFrom.e164, to, body})
────────────                                                          recordUsageEvent({kind: SMS})
POST /api/self-service/private-number ──► setPrivateNumber(req.tenant.tenantId, raw)
GET  /api/self-service/state          ──► eigene privateNumber (maskiert), nie fremde
```

### 2.2 Wo lebt `privateNumber`? — Auf dem **Tenant-Record** (nicht in `settings`)

Wie `ownerName` / `firstName` / `kycLevel` / `stripeCustomerId` (alle opportunistisch am Tenant-Record,
kein statisches Schema-Objekt). **Begründung — kritisch für PII:**

- `privateNumber` ist **Identitäts-/Kontaktdatum**, kein verhaltensänderndes Setting.
- `/api/state` (`src/routes/api-read.js:52`) gibt **`settings: ctx.settings` komplett** zurück; jede neue
  `settings`-Property ist damit **automatisch über `/api/state` und jedes MCP-Tool sichtbar** (z.B.
  `get_agent_status` `mcp-tools.js:197`). Eine PII-Nummer in `settings` würde **direkt zur LLM/MCP leaken**
  (Risiko H4). Auf dem Tenant-Record dagegen serialisieren die MCP-Tools **feldweise** (`api-read.js:58-68`
  baut den `agent{}`-Block von Hand) — ein neues Record-Feld leakt **nur**, wenn man es explizit in
  `api-read.js` oder `settings` aufnimmt. ⇒ Record-Feld + **niemals** in `agent{}`/`settings` aufnehmen.
- Der generische Settings-Typcheck (`updateSettings`, `state-ops.js:747`: `typeof value === typeof allowed[key]`)
  ließe **jeden** String durch — also keine echte E.164-Validierung (Risiko H2).

### 2.3 Validierung — eine Quelle, eine Reihenfolge

Die Setz-Logik lebt **einmal** und wird von Onboard **und** Self-Service genutzt (kein Drift):

```
setPrivateNumber(s, tenantId, raw) -> tenant            // reine Mutation, kein IO
  1. tenant = findTenant; fehlt   → throw                (Muster setKycLevel state-ops.js:405)
  2. raw leer/""/null             → delete tenant.privateNumber   (Feld weg; Owner-Fallback bleibt verlässlich)
  3. e164 = normNum(raw)          → ZUERST normalisieren (strippt \s, -, ())   (defaults.js:194)
  4. !E164.test(e164)             → throw/reject          (E164 = /^\+[1-9]\d{6,14}$/, _validation.js:10)
  5. countryAllowed(e164) == false→ throw/reject          (Kosten-Schutz, Abschnitt 3/H1)
  6. tenant.privateNumber = e164                          // NUR normalisierte Form speichern
```

Reihenfolge **normNum → E164 → speichern** ist verbindlich (Risiko M3): so matchen Eingabe
`"+49 (170) 123-4567"` und gespeicherte Form `"+491701234567"` garantiert.

**Import-Pfad (verifiziert, kein Zyklus):** `normNum` liegt in `defaults.js` und wird heute schon von
`state-ops.js` **und** `server.js` importiert. `E164` liegt im **dependency-freien** `routes/_validation.js`
(importiert nichts aus `store`/`config`). Zwei saubere Optionen, beide zyklusfrei:

- **(A)** Validierung am Route-Layer (`server.js:28` importiert `E164` bereits; `server.js:932` ist die
  Onboard-Stelle) — `registerTenant` bekommt eine bereits validierte Nummer. **Aber:** dann müsste auch der
  Self-Service-Setter dieselbe Validierung am Route-Layer wiederholen ⇒ zwei Validier-Stellen.
- **(B) — empfohlen:** die E.164-Konstante neben `normNum` in `defaults.js` spiegeln (oder von dort
  re-exportieren), damit der **eine** `state-ops`-Setter normalisiert **und** validiert. `defaults.js` ist
  bereits der Präzedenzort für geteilte reine Telefon-Helfer (`normNum`). Eine Quelle (G5).

### 2.4 Store-Facade & Reader (Symmetrie zu `setKycLevel`/`tenantStripe`)

- **Mutation:** `setPrivateNumber(tenantId, raw)` — dünner Wrapper in `json.js` (mutate→`save()`) **und**
  `pg.js` (mutate→`save()`/flush). Kernlogik in `state-ops.js`. Vorbild-Paar wörtlich verifiziert:
  `setKycLevel` (`json.js:313`, `pg.js:170`).
- **Query:** schmaler Reader `tenantPrivateNumber(tenantId)` (reine Query, **kein** `save`) — Pendant zu
  `tenantStripe` (`state-ops.js:444`, gibt `?? null`). `finishCall` ruft **diesen** Reader auf, **nicht**
  `tenantContext`.
- **Warum nicht `tenantContext`?** `tenantContext` (`state-ops.js:340`) ist die LLM-Persona-/View-Quelle
  (`ownerName, firstName, settings, calendar`) und fließt in Greeting + `summarizeCall`. PII gehört dort
  nicht hin. `finishCall` liest ohnehin schon roh aus dem Store (`findActiveNumber(store.load(), …)`); das
  Ziel wird über **denselben Schlüssel `call.tenantId`** wie der Absender gezogen — das verhindert
  Cross-Tenant-Fehlzustellung (Risiko H3).

### 2.5 Opt-Out — Muster `allowSummaries`

Es gibt bereits einen Schalter, der die Zusammenfassung **komplett** unterdrückt: `allowSummaries`
(`defaultSettings()` `defaults.js:126`, Default `true`; geprüft in `claude.js:296`). Damit existiert die
„keine Zusammenfassung"-Stufe schon. Für „Zusammenfassung ja, aber **keine SMS**" zwei Varianten:

- **(Opt-Out implizit):** Keine `privateNumber` gesetzt ⇒ keine SMS. Einfachster Pfad, keine neue Property,
  keine MCP-Sichtbarkeit. Nachteil: vermischt „kein Kontakt hinterlegt" mit „kein SMS-Wunsch".
- **(Opt-Out explizit) — empfohlen, wenn Nummer ohnehin für Login dient:** neue Boolean
  `smsSummaryOptIn` (Default `true`) in `defaultSettings()`, geprüft im `finishCall`-Guard. Folgt exakt dem
  `allowSummaries`-Muster, schreibbar über die bestehende `POST /api/settings`-Whitelist (`updateSettings`,
  audit-Key-only `server.js:821`). **Hinweis:** als `settings`-Boolean ist sie über `/api/state`/MCP
  sichtbar — das ist **unkritisch** (kein PII), nur die Nummer selbst darf nicht in `settings`.

### 2.6 Provider- & Absender-Pfad bleibt unverändert

Provider via `call.provider` → `messaging(provider)` (`registry.js:29`); Absender via
`findActiveNumber(store.load(), call.tenantId, call.provider)`. `sendSms({from,to,body})` ist
`Promise<void>` (kein Message-ID/Status zurück; Twilio = 1:1-Pass-through, Telnyx mappt `body→text` und
wirft bei non-2xx). F2 ändert hier **nur** `to`.

---

## 3. Pre-Mortem — Risiken (benannt und entschärft)

Gefährlichste Eigenschaft: F2 berührt **mehrere Stellen gleichzeitig** (Schema, Validierung, Self-Service,
Versand-Lookup, Export, Erase, Kosten, Dedup). Jede vergessene Stelle scheitert **still** — keine Exception,
nur fehlende SMS, doppelte SMS oder ungelöschte PII. Jeder Test deckt deshalb den Negativfall ab.

### Hoch

| ID     | Risiko                              | Eintrittsweg (verifiziert)                                                                                                                                                                                                                                                                                                                                         | Entschärfung (testbar)                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1** | **Toll-Fraud / Kostenexplosion**    | `E164` erlaubt jede `+[1-9]\d{6,14}` — also Premium-/Satelliten-/Auslandsnummern (`+8821…`, `+87…`). Es gibt **kein SMS-Rate-Limit, kein Cap, kein Cost-Metering**: `USAGE_EVENT_KIND.SMS` ist in `defaults.js:79` **definiert, aber nirgends `recordUsageEvent`-emittiert**. Jeder (auch selbst provozierte) Inbound-Call löst eine von **uns** bezahlte SMS aus. | **MUST:** (a) Ländercode-Allowlist im Setter (Konzept `config.allowedCountryCodes`, Default `+49`) + Premium-Range-Blocklist; `+888…` → Reject. (b) Tages-Cap pro Tenant im Versand. (c) `recordUsageEvent({kind: SMS, costCents})` bei jedem Send (Ledger existiert, `state-ops.js:655`). Test: `privateNumber=+888…` → Reject; N+1 Calls/Tag → ≤ N SMS; Send erzeugt genau ein SMS-Usage-Event. |
| **H2** | **Validierungs-Umgehung**           | `privateNumber` als Settings-Free-Field ⇒ nur `typeof==="string"`-Check (`updateSettings` `state-ops.js:747`) ⇒ `"hallo"`/leer kommt durch.                                                                                                                                                                                                                        | Record-Feld, **nicht** Setting; einziger Schreibweg ist `setPrivateNumber` (`normNum→E164`). Test: `Write privateNumber="abc"` → Reject, alter Wert bleibt.                                                                                                                                                                                                                                       |
| **H3** | **Cross-Tenant-Fehlzustellung**     | Ziel über _Absender_-Nummer/Provider-Lookup statt `call.tenantId` ⇒ Summary (Inhalt + PII) von A geht an `privateNumber(B)`.                                                                                                                                                                                                                                       | Ziel **ausschließlich** über `tenantPrivateNumber(call.tenantId)`, identischer Schlüssel wie Absender. Property-Test: zwei Tenants, Call an A → `to == privateNumber(A)`, nie B.                                                                                                                                                                                                                  |
| **H4** | **PII-Leck (Response / MCP / Log)** | `/api/state` gibt `settings` **komplett** zurück (`api-read.js:52`); `get_agent_status` (`mcp-tools.js:197`) druckt `settings.*` und `agent{}` an die LLM. SMS-`catch` (`server.js:606`) könnte die Nummer loggen.                                                                                                                                                 | (a) Record-Feld, **nie** in `settings`/`agent{}` (H2). (b) Self-Service-Read gibt nur die **eigene** Nummer, ggf. maskiert (`+49…4567`). (c) SMS-`catch` loggt **nie** `to`/Nummer (heute korrekt: nur `e.message`). Statik-Test: `grep -R "console.*privateNumber" src` = 0; `/api/state` enthält `privateNumber` nicht.                                                                         |
| **H5** | **DSGVO Export & Löschung**         | `exportTenantData` (`state-ops.js:184`) ist **call-scoped** (`calls/actionItems/notifications`) — **enthält gar keine Record-Felder**. `eraseTenantData` (`state-ops.js:162`) lässt `tenants` **explizit unangetastet** (Kommentar `:159`). ⇒ Art. 15 unvollständig, Art. 17 greift nicht für `privateNumber`.                                                     | `privateNumber` in `exportTenantData` aufnehmen; bei Tenant-Löschung entfernen/nullen. Test: set → Export enthält sie → Erase → Record/Export leer.                                                                                                                                                                                                                                               |

### Mittel

| ID     | Risiko                                | Eintrittsweg (verifiziert)                                                                                                                                                                                                                                                                                                                                                                  | Entschärfung (testbar)                                                                                                                                                                                                                                 |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M1** | **json↔pg-Drift / Migration**         | pg braucht Spalte + hydrate/flush-Mapping. Vergessen ⇒ in json gesetzt, nach pg-Restart weg (still).                                                                                                                                                                                                                                                                                        | `ALTER TABLE tenant ADD COLUMN IF NOT EXISTS private_number TEXT;` (`schema.sql:33`-Muster) + Spalte in `hydrateTenants`-SELECT (`pg.js:270`) **und** `flushTenants` INSERT/ON-CONFLICT/Params `$9` (`pg.js:515-527`). Paritäts-Test json==pg.         |
| **M2** | **Doppelte SMS bei Restart**          | Dedup ist **nur** das **In-Memory**-Flag `call._finished` (`server.js:561-563`), nicht persistiert (`publicCall` strippt es, `views.js:10`). `finishCall` hat **drei** Auslöser (Status-Callback `:640`, Bridge `:1134`, cancel `:802`). Prozess-Restart zwischen Call-Ende und spätem `/voice/status`-Retry ⇒ `_finished` weg ⇒ **zweite Summary-SMS** (zweiter LLM-Call + zweite Kosten). | Versand idempotent gegen einen **persistierten** Marker machen (z.B. `call.summarySmsSentAt` am Call-Record, gesetzt nach erfolgreichem Send) und im Guard prüfen. Test: zwei `/voice/status completed` mit „Restart" dazwischen → genau **eine** SMS. |
| **M3** | **Format-Inkonsistenz E.164↔normNum** | Validierung vor/ohne `normNum` ⇒ Trennzeichen-Nummer failt Regex oder wird roh gespeichert.                                                                                                                                                                                                                                                                                                 | Reihenfolge `normNum → E164.test → normalisierte Form speichern`. Test: `"+49 (170) 123-4567"` → `"+491701234567"`; `"0170…"` (ohne `+`) → Reject.                                                                                                     |
| **M4** | **Crash bei null/leer in finishCall** | Heutiger Guard ist `config.sendSmsSummary && config.ownerNumber && smsFrom` — `config.ownerNumber` muss durch `to` ersetzt werden. Wird `to` vor dem Guard in einer String-Op (`.slice`) berührt und ist `undefined`, verschluckt der äußere `catch` (`server.js:578-611`) die restliche Notification-Logik.                                                                                | Guard `if (config.sendSmsSummary && to && smsFrom && smsAllowed)` **vor** jeder String-Op (Vorbild: `smsFrom`-Guard). Test: Tenant ohne Nummer → keine SMS, Notification bleibt, kein Throw.                                                           |
| **M5** | **Owner verliert SMS still**          | Heute bekommt der Owner **immer** SMS (`to: config.ownerNumber`); neu nur mit `privateNumber`, kein Fallback. Owner-Tenant hat das Feld initial nicht ⇒ ab Deploy still keine SMS.                                                                                                                                                                                                          | Owner-`privateNumber` einmalig idempotent aus `config.ownerNumber` seeden (Muster `seedOwnerIdentity` `state-ops.js:380`); Boot-Warnung wenn Owner danach leer. Abschnitt 5.                                                                           |

### Niedrig

| ID     | Risiko                              | Eintrittsweg                                                                                                                                                                                                                                                                                 | Entschärfung (testbar)                                                                                                                                                                            |
| ------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **N1** | **Race/Concurrency**                | Paralleles Onboard + Self-Service-Set auf demselben Tenant ⇒ Lost-Update.                                                                                                                                                                                                                    | Set über denselben `withStoreLock`+`save`-Pfad wie andere Mutationen. Test: zwei parallele Sets → letzter gewinnt deterministisch.                                                                |
| **N2** | **Zustellbarkeit unsichtbar**       | `sendSms` ist `Promise<void>` (kein Status). SMS kann trotz „erfolgreichem" Send nicht ankommen; Fehler nur als `console.error("[sms]", …)`.                                                                                                                                                 | Akzeptieren (bestehendes Verhalten), aber `audit("sms_summary_sent"/"_skipped"/"_failed", reason)` **ohne Nummer** für Sichtbarkeit. Optional späterer Delivery-Status-Webhook (out of scope F2). |
| **N3** | **Timing — Summary vor Transkript** | Im Default-Voice-Engine wird das Transkript **synchron** während des Calls via `/voice/turn` gefüllt; `finishCall` guardet `call.status==="completed" && call.transcript.length` (`server.js:569`). Kein separater Async-Transkriptions-Job, der `completed` nachläuft. ⇒ Risiko **gering**. | Bestehenden Guard belassen; Test: leeres Transkript → Notification „nicht zusammengefasst", keine SMS.                                                                                            |

**Must-Fix vor Launch:** H1, H2, H3, H4, H5, M2, M5.

---

## 4. Phasenplan

Leitidee: **Datenmodell-Seam zuerst** (Setter/Reader + beide Facades + pg-Persistenz), danach die
Konsumenten (Onboard / Self-Service / finishCall / DSGVO) **echt parallel**, weil sie nur gegen die fertige
Facade arbeiten und disjunkte Dateien anfassen. Jede Phase ist klein und per `node --test` einzeln testbar.

### Block A — Modell & Persistenz

| #      | Phase                                | Ziel                                                                                                                                      | Betroffene Dateien                                | Parallel      | Akzeptanz                                                                                                                         |
| ------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **P0** | Validierungs-/Import-Seam bestätigen | `E164` + `normNum` zyklusfrei in `state-ops` nutzbar (Variante B: Konstante neben `normNum` in `defaults.js`)                             | (nur lesen)                                       | —             | Kein Code; Import-Pfad bestätigt; bei Zyklus lokaler Helfer.                                                                      |
| **P1** | **Modell-Kern**                      | `setPrivateNumber(s,id,raw)` (normNum→E164→countryAllowed→store; leer→delete; fehlender Tenant→throw) + `tenantPrivateNumber(s,id)`-Query | `src/store/state-ops.js`, `src/store/defaults.js` | nein (Wurzel) | Unit: gültig→normalisiert; ungültig/Premium→throw; `""`/null→delete; fehlender Tenant→throw; Reader→Wert/`null`.                  |
| **P2** | Facade **json**                      | `setPrivateNumber` (mutate→save) + `tenantPrivateNumber` (Query)                                                                          | `src/store/json.js`                               | ja (nach P1)  | json-Round-Trip: set→reload→read.                                                                                                 |
| **P3** | Facade **pg** + Persistenz           | Wrapper + Spalte `private_number TEXT`, hydrate, flush                                                                                    | `src/store/pg.js`, `src/db/schema.sql`            | ja (nach P1)  | pglite: `ADD COLUMN IF NOT EXISTS`; set→flush→hydrate; SELECT + INSERT/ON-CONFLICT/`$9` ergänzt. **Paritäts-Test json==pg (M1).** |

### Block B — Konsumenten (parallel nach Block A)

| #       | Phase                     | Ziel                                                                                                                                                    | Betroffene Dateien                                           | Parallel    | Akzeptanz                                                                                                                      |
| ------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **P4**  | **Registrierung**         | `registerTenant` nimmt optional `privateNumber` (teilt P1-Logik); `POST /api/onboard` reicht es durch                                                   | `src/store/state-ops.js`, `src/server.js:927`                | ja          | Onboard mit gültiger Nummer → Record trägt sie; ungültig→Reject; Idempotenz von `registerTenant` bleibt.                       |
| **P5**  | Self-Service **Write**    | Dedizierte Route (z.B. `POST /api/self-service/private-number`, `webAuthMw`) → `setPrivateNumber(req.tenant.tenantId, …)`; **nicht** `selfServicePatch` | `src/self-service-routes.js`                                 | ja          | Setzen/leeren; ungültig→400; kein Cookie→401; Audit nur Reason, **kein Wert** (H4).                                            |
| **P6**  | Self-Service **Read**     | `GET /api/self-service/state` liefert die **eigene** `privateNumber` (UI „deine hinterlegte Nummer", maskiert)                                          | `src/self-service-routes.js`                                 | ja (mit P5) | Eigene Nummer; nie fremde; Identität `req.tenant.tenantId`, fail-closed.                                                       |
| **P7**  | **finishCall-Umstellung** | Ziel `tenantPrivateNumber(call.tenantId)` statt `config.ownerNumber`; Guard `&& to && smsAllowed`; kein Ziel→skip+`audit`; Opt-Out-Check (2.5)          | `src/server.js:591-608`                                      | ja          | Tenant mit Nummer→SMS dorthin; ohne→keine SMS, Notification bleibt, kein Throw; Cross-Tenant-Property (H3); kein PII-Log (H4). |
| **P8**  | **Kosten-Schutz**         | Tages-Cap pro Tenant + `recordUsageEvent({kind: SMS})` beim Send                                                                                        | `src/server.js` (Send-Pfad), `src/store/state-ops.js`        | ja (mit P7) | N+1 Calls/Tag → ≤ N SMS; jeder Send erzeugt genau ein SMS-Usage-Event (H1).                                                    |
| **P9**  | **Dedup persistent**      | `call.summarySmsSentAt` (o.ä.) am Record nach erfolgreichem Send; Guard prüft ihn zusätzlich zum In-Memory-`_finished`                                  | `src/server.js`, `src/store/state-ops.js` (createCall/views) | ja (mit P7) | Zwei `completed` mit Restart dazwischen → genau eine SMS (M2).                                                                 |
| **P10** | **DSGVO Export/Erase**    | `privateNumber` in `exportTenantData`; Tenant-Löschung entfernt sie                                                                                     | `src/store/state-ops.js` (+ ggf. `scripts/erase-tenant.js`)  | ja          | set→Export enthält sie→Erase→leer (H5).                                                                                        |
| **P11** | **Owner-Seed**            | Owner-`privateNumber` idempotent aus `config.ownerNumber` seeden + Boot-Warnung wenn leer                                                               | `src/store/state-ops.js`, `json.js`+`pg.js` (Seed-Aufruf)    | ja          | Frischer Owner mit `OWNER_NUMBER` → nach Boot `privateNumber(owner)==normNum(config.ownerNumber)` → Call → SMS (M5).           |

### Block C — Sammelpunkt

| #       | Phase                | Ziel                                                                                        | Betroffene Dateien        | Parallel           | Akzeptanz                                                                |
| ------- | -------------------- | ------------------------------------------------------------------------------------------- | ------------------------- | ------------------ | ------------------------------------------------------------------------ |
| **P12** | **Integrationstest** | E2E Inbound → Summary → korrektes Ziel; Owner-Pfad; Dedup-Restart; Cost-Cap; beide Backends | `test/…` (nur neue Tests) | nein (Sammelpunkt) | `node --test` grün für json **und** pg; Owner-, Dedup-, Cost-Pfade grün. |

### Abhängigkeitsgraph

```
P0 ─► P1 ─┬─► P2 ─┬─────────────► P5 ─► P6
          │       │
          ├─► P3 ─┤
          │       └─────────────► P7 ─┬─► P8
          ├─► P4 ──────────────────┐  └─► P9
          ├─► P10 ─────────────────┤
          └─► P11 ─────────────────┴─► P12 (sammelt P4·P5·P6·P7·P8·P9·P10·P11)
```

Kritischer Pfad: **P0 → P1 → {P2,P3} → P7 → P12**. Nach P1 + Facade laufen P4, P5/P6, P7(+P8/P9), P10, P11
parallel (disjunkte Dateien). P12 ist der einzige Sammelpunkt.

### Idiom-Checks (pro Phase)

- **G5 / kein Drift:** Setz-/Validierlogik **einmal** in `state-ops`; json-/pg-Wrapper dünn; Paritäts-Test
  sichert Backend-Gleichheit.
- **fail-closed:** ungültige/leere/Premium-Nummer → Reject; fehlender Tenant → throw; kein Ziel/Opt-Out → SMS skip.
- **kein PII im Log/MCP:** Audit/`console`/`/api/state`/MCP nur Keys/Reason-Marker, nie die Nummer.

---

## 5. Offene Fragen / Owner-Entscheidungen

**(1) Owner-Kontinuität (blockiert den Start NICHT, legt das Zielbild fest).**
Soll der Owner (`config.ownerNumber`) weiterhin Summary-SMS bekommen? „Owner = Tenant Null": Owner ist ein
Tenant (`OWNER_TENANT_ID="owner"`), Inbound-Calls an seine Nummer laufen mit `call.tenantId === "owner"`.

| Option                                             | Verhalten                                                                                                        | Pro                                                                                    | Contra                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| **(a)** Parallele Kopie an `config.ownerNumber`    | finishCall sendet zusätzlich an `config.ownerNumber`                                                             | Owner verliert nie SMS                                                                 | bricht G5 (zwei Zielpfade); **Doppelversand** bei Owner-Calls; Sonderzweig bleibt (widerspricht AK #5).          |
| **(b) — empfohlen** Generischer Pfad + Owner-Seed  | finishCall **ohne** `config.ownerNumber`; Owner-`privateNumber` einmalig aus `config.ownerNumber` geseedet (P11) | maximal G5-konform (ein Pfad); erfüllt AK #5 wörtlich; kein stiller Owner-Verlust (M5) | `config.ownerNumber` bleibt vorerst Seed-Quelle + Owner-View (`api-read.js:64`); spätere Phase entfernt es ganz. |
| **(c)** `config.ownerNumber` als Laufzeit-Fallback | `to = privateNumber                                                                                              |                                                                                        | config.ownerNumber`                                                                                              | keine Lücke; kein Doppelversand | widerspricht AK #5 (kein Fallback); Rest-Sonderzweig bleibt dauerhaft. |

**Empfehlung: (b)** — einzige Option, die „kein Fallback im `finishCall`" wörtlich erfüllt **und** den
stillen Owner-Verlust vermeidet (idempotenter Seed, Muster `seedOwnerIdentity`).

**(2) Opt-Out-Modell.** Implizit (keine `privateNumber` = keine SMS) **oder** explizite Boolean
`smsSummaryOptIn` in `settings` (Muster `allowSummaries`)? Empfehlung: **explizit**, wenn die private Nummer
auch als Login-/Kontaktkanal dient (sonst kann man SMS nicht abbestellen, ohne den Kontakt zu löschen).

**(3) Kosten-Politik.** Default-Ländercode-Allowlist (`+49` only?) und Tages-Cap pro Tenant (z.B. 20
Summary-SMS/Tag)? Werte sind Owner-Entscheidung — sie blockieren P1/P8 nicht, müssen aber vor Launch fix sein.

**(4) Pflicht vs. optional bei Onboard.** Bestätigung: `privateNumber` ist bei `POST /api/onboard`
**optional** (Tenant kann ohne sie onboarden) — korrekt? Falls Pflicht für bestimmte KYC-Stufen gewünscht,
wäre das ein separater Bezug zu `kycLevel` (out of scope F2).

**(5) Maskierung in Self-Service-Read.** Soll `GET /api/self-service/state` die volle eigene Nummer oder
eine maskierte Form (`+49…4567`) zurückgeben? Volle Nummer ist die eigene PII des Eingeloggten (vertretbar);
Maskierung reduziert Schulter-/Log-Leak-Fläche.
