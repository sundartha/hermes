# Grounding: LIVE-Outbound-Pfad (ElevenLabs) von place_call bis zum sprechenden Agenten

Nur-Lesen-Kartierung. Alle Behauptungen mit Datei:Zeile belegt; Annahmen sind explizit
markiert. Praemisse: Produkt nicht gelauncht, alle aktiven Accounts sind Owner+Jonas.

---

## 1. Kette place_call -> REST -> Gates -> src/elevenlabs/outbound.js -> EL-API

### 1.1 MCP-Einstieg

`place_call` (`src/mcp-tools.js:578` ff., Tool-Registrierung ab `:570`) ist ein `uiTool`
(Live-Karte WIDGET_CALL). Sein Handler macht **keinen** direkten Store-Zugriff, sondern ruft
intern REST auf:

```
const r = await call("POST", "/api/calls", args);   // src/mcp-tools.js:141
```

Das ist ein In-Prozess-HTTP-Aufruf gegen den eigenen Server (Loopback), der die
`internalOnly`-Schranke passiert (`src/wiring/internal-only.js`, `isTrustedLocalCaller`) —
`/api/calls` selbst ist in `src/routes/api-calls.js:150` hinter `internalOnly` gemountet.

### 1.2 POST /api/calls — Gate-Kette

Route: `src/routes/api-calls.js:150` (`router.post("/api/calls", internalOnly, ...)`).

```js
let to = normNum(b.to);                                   // roh normalisiert (Format)
...
const ctx = { req, to, objective, b };
for (const gate of outboundGates) {                        // api-calls.js:161-172
  const denial = await gate.run(ctx);
  ...
}
```

`outboundGates` ist das geordnete Array aus `src/telephony/outbound-gates.js:540-820`
(Struct-1, Reihenfolge per `test/outbound-gates-order.test.js` gepinnt). Relevante Glieder,
in Ablaufreihenfolge:

| Gate | Datei:Zeile | Wirkung |
|---|---|---|
| `outbound_frozen` | `outbound-gates.js:541-549` | globaler Kill-Switch `OUTBOUND_FROZEN` |
| `resolve_identity` | `:555-561` | setzt `ctx.requestedBy`, `ctx.tenantId` |
| `tenant_reject` | `:566-575` | unbekannte Identitaet -> 403, fail-closed |
| **`normalize_target`** | `:584-601` | **hier steht `ctx.to` erstmals als normalisiertes E.164 fest** (`ctx.to = normalizeDialTarget(ctx.to, homeCountry)`) |
| `trunk_zero_normalized` | `:603-611` | Formatfehler auf dem normalisierten Ziel |
| `kyc` | `:612-627` | Abo+KYC-Reifegrad des Tenants |
| `owner_name` | `:628-643` | **setzt `ctx.ownerName = store.tenantContext(ctx.tenantId).ownerName`**, lehnt fail-closed ab, wenn leer (Traeger der Offenlegung) |
| `resolve_profile` | `:644-653` | setzt `ctx.profile` (Rechteprofil) |
| `number_gate` | `:654-673` | Denylist/Land/Sperr-Ranges |
| `valid_text` / `valid_mandate` / `assistant_context` | `:673-719` | Freitext-/Struktur-Validierung |
| `resolve_outbound` | `:719-750` | Absendernummer, Provider (`ctx.fromNumber`, `ctx.outboundProvider`) |
| `budget` / `minutes` | `:750-793` | pro-Tenant-Kostendecke |
| `compute_reserve` | `:793-810` | Reserve-Betrag |
| **`reserve_budget`** | `:810 ff.` | **letztes Gate** — reserviert Budget; danach ist der Call unwiderruflich "erlaubt" (Pre-Mortem-Kommentar im Modul-Kopf, kein Gate darf dahinter stehen) |

Nach der Schleife (`api-calls.js:204`, Kommentar *"Ab hier ist ctx vollstaendig durch die
Gate-Kette befuellt"*): `ctx.to` ist das normalisierte Ziel, `ctx.tenantId`, `ctx.ownerName`,
`ctx.profile`, `ctx.fromNumber`, `ctx.outboundProvider`, `ctx.reserveCents` stehen fest. Die
lokale rohe `to`-Variable wird ab hier nicht mehr gelesen.

### 1.3 Nach der Gate-Kette, vor `createCall`

Drei Schritte laufen **nach** den Gates, aber **vor** `store.createCall` (alle mit
Begruendung "keine LLM-/Consult-Kosten fuer einen Call, den ein Gate ablehnt"):

1. `diagnosticRetentionGranted(...)` — `api-calls.js:190-199`
2. `fetchPrecallBriefing(...)` — `api-calls.js:213-227` (nur wenn Owner keinen Kontext gab)
3. **Eroeffnungszeile (EL-spezifisch)** — `api-calls.js:239-256`, nur hinter
   `config.voice.elevenLabsOutbound.enabled`: `callLocaleOf(...)` (siehe 1.5) + `fetchOpeningLine(...)`.

`store.createCall(...)` — `api-calls.js:258-276` — persistiert den Call-Record (Felder s.
Abschnitt 4). `ctx.to` wird hier zu `call.to`, `ctx.ownerName` fliesst NICHT direkt in den
Call-Record (es ist ein Gate-Nebenprodukt, kein Call-Feld — der EL-Weg liest es erneut aus
dem Tenant, s. 1.4).

### 1.4 Engine-Weiche (drei Zweige, EXAKT an derselben Stelle)

`api-calls.js:280-329`, hinter der kompletten, unveraenderten Gate-Kette:

```js
if (config.voice.elevenLabsOutbound.enabled) {
  await originateElevenLabsCall(call);                 // EL-Weg, Abschnitt 1.5
} else if (config.telnyx.telnyxAssistant.enabled && providerSupports(...)) {
  await originateAiAssistantCall({ ... });              // C-Telnyx-Assistant
} else {
  const tw = await voiceControl(ctx.outboundProvider).originateCall({ ... }); // Budget/TeXML
}
```

Siehe Abschnitt 5 zur Live-Bedeutung dieser drei Zweige.

### 1.5 `src/elevenlabs/outbound.js` — der EL-Weg im Detail

`originateCall(call)` — `src/elevenlabs/outbound.js:1226-1263`:

```js
const { ownerName } = store.tenantContext(call.tenantId);            // :1229
const time = callTimeContext({ tenantTimezone: ..., callee: call.to }); // :1232
const locale = callLocaleOf({ store, config, call, ownerName });      // :1236
const consultAllowed = consultAllowedFor(store.resolveProfile(call.tenantId)); // :1241
const lookupAllowed  = lookupAvailableFor(call, store.resolveProfile); // :1245
const { conversationId } = ... startOutboundCall({
  body: startCallBody({ el, call, ownerName, time, locale, consultAllowed, lookupAllowed }), // :1257
});
```

`startCallBody` (`outbound.js:828-845`) baut den vollstaendigen Request-Body fuer
`POST /v1/convai/sip-trunk/outbound-call` (Netzzugriff in `convai.js#startOutboundCall`).
Darin: `to_number: call.to` (dasselbe `ctx.to` von 1.2/1.3, unveraendert seit
`normalize_target`) und `conversation_initiation_client_data.dynamic_variables`.

### 1.6 Die zwoelf dynamischen Variablen

`dynamicVariables(...)` — `src/elevenlabs/outbound.js:742-760`:

```js
return {
  consult_available: consultAllowed === true ? GATE_AVAILABLE : GATE_UNAVAILABLE,
  lookup_available:  lookupAllowed  === true ? GATE_AVAILABLE : GATE_UNAVAILABLE,
  opening_line: verifiedOpeningLine({ call, locale: localeFor(locale.language) }),
  owner_name:   alsText(ownerName) || locale.disclosureOwnerFallback,
  callee:       alsText(call.to),
  objective:    alsText(call.goal),
  constraints:  constraintsText(call.constraints),
  background:   backgroundText({ context: call.context, briefing: call.briefing }),
  mandate:      mandateText(call.mandate),
  owner_timezone:   alsText(time.ownerZone),
  callee_timezone:  calleeTimezoneText(time),
  today:        alsText(time.today),
};
```

12 Namen: `consult_available`, `lookup_available`, `opening_line`, `owner_name`, `callee`,
`objective`, `constraints`, `background`, `mandate`, `owner_timezone`, `callee_timezone`,
`today` — deckungsgleich mit der Agenten-Vorlage (`elevenlabs/agent_configs/
outbound-agent.template.json`, Vokabular-Historie in `_sprachumstellung_hinweis`, Zeile 17,
zuletzt bestaetigt "es bleiben zwoelf" nach Thema E, 2026-08-19).

Daneben, im selben `startCallBody`: `conversationConfigOverride(locale)`
(`outbound.js:816-821`) — die EINZIGEN zwei Werte, die per Call ausserhalb der
Dynamic-Variables gesetzt werden (Sprache, Stimme), fail-closed gegen eine Weisse Liste in
`convai.js#assertOverrideWhitelisted` geprueft.

**Reihenfolge zusammengefasst:** `ctx.to` steht in `normalize_target`
(`outbound-gates.js:584-601`) fest, ist ab da unveraendert `call.to`. Die 12
`dynamicVariables` entstehen NACH allen Gates, NACH `createCall`, unmittelbar vor dem
einzigen EL-Netzzugriff, in `originateCall` (`outbound.js:1226 ff.`) — pro Anruf neu
berechnet, nicht gecacht.

---

## 2. Ansatzpunkt fuer ein serverseitiges Praedikat `isOwnerCall(tenant, to)`

### Anforderungen aus dem Auftrag
(a) nach allen Gates, (b) vor Bau von opening_line/dynamicVariables/Prompt, (c) engine-uebergreifend
wiederverwendbar in einem Modul.

### Der EINE saubere Punkt

`src/routes/api-calls.js:204 ff.` — direkt nach der Gate-Schleife, an derselben Stelle, an
der `diagnosticRetentionGranted(...)` bereits **exakt dasselbe Muster** anwendet
(`api-calls.js:190-199`):

```js
const diagnostic = diagnosticRetentionGranted({
  requested: b.diagnostic,
  to: ctx.to,                                    // NORMALISIERTES Ziel nach dem Gate
  ownNumber: store.tenantPrivateNumber(ctx.tenantId),
  privacy: config.privacy,
});
```

`diagnosticRetentionGranted` (`src/diagnostic-retention.js:39-42`) reduziert intern exakt
auf `Boolean(ownNumber) && to === ownNumber` — das ist bereits die Kernpraedikat-Form von
`isOwnerCall`. Ein neues, analoges Praedikat waere:

```js
// src/owner-call.js (neu, pures Modul nach dem Muster diagnostic-retention.js)
export function isOwnerCall({ to, ownNumber }) {
  return Boolean(ownNumber) && to === ownNumber;
}
```

Aufruf an derselben Stelle wie `diagnosticRetentionGranted`, mit denselben zwei Eingaben
(`ctx.to`, `store.tenantPrivateNumber(ctx.tenantId)`), **noch VOR** dem EL-spezifischen
Eroeffnungszeilen-Block (`api-calls.js:239 ff.`) und **noch VOR** `store.createCall`
(`:258`). Das Ergebnis geht als neues additiv-nullables Feld in `createCall(...)` (s.
Abschnitt 4) — **einmal berechnet, auf dem Call-Record persistiert**, statt in jedem der
drei Engine-Zweige (1.4) einzeln neu abgeleitet zu werden. Das erfuellt (c) strukturell:
jede Engine liest `call.ownerCall` vom fertigen Record, keine zieht `to`/`ownNumber` selbst
noch einmal.

### Warum NICHT `src/elevenlabs/outbound.js`

Das Modul ist laut eigenem Kopfkommentar (`outbound.js:1-31`) bewusst ein
**EL-spezifischer Engine-Zweig**, kein geteilter Ort — "dieses Modul kennt KEIN einziges
Gate und darf keins bekommen" (Zeile 12-17). Ein Praedikat, das auch der Budget-Engine
(`src/claude.js`) und dem C-Telnyx-Zweig (`src/telnyx-origination.js`) zur Verfuegung
stehen soll, darf nicht dort liegen — sonst muessten die anderen beiden Engines
`src/elevenlabs/*` importieren, eine Abhaengigkeitsrichtung, die es heute nirgends gibt.

### Kandidaten-Dateien, geordnet

1. **`src/diagnostic-retention.js`** (Erweiterung) oder **neues Geschwistermodul
   `src/owner-call.js`** — rein, keine Store-/Config-Kopplung (Praezedenzfall: das
   bestehende Modul ist bereits reiner Injection-Empfaenger, offline testbar, exakt das
   Muster, das der Auftrag verlangt).
2. **`src/routes/api-calls.js`** — der Aufrufpunkt (nicht der Ort des Praedikats): Zeile
   ~200, direkt neben dem `diagnostic`-Block, vor `createCall`.
3. **`src/store/state-ops.js`** (`createCall`, `:176 ff.`) — nimmt das Ergebnis als neues
   additives Feld entgegen (Muster `diagnostic`, `openingLine`).
4. NICHT geeignet als Ablageort: `src/elevenlabs/outbound.js` (Begruendung oben),
   `src/telephony/outbound-gates.js` (das ist die Gate-Kette selbst — ein neues Gate wuerde
   laut Modul-Kopf die Reihenfolge-gepinnte Sicherheitskette nur verbreitern, obwohl das
   Praedikat **nie ablehnt**, also kein Gate im Sinne des Vertrags `{name, run}` waere,
   sondern ein reines Derivations-Nebenprodukt wie `diagnostic`).

**Annahme:** `store.tenantPrivateNumber(ctx.tenantId)` ist die richtige Quelle fuer "die
eigene Nummer des Owners" — das ist die bereits etablierte Bedeutung (`diagnostic-retention.js`
nennt sie woertlich "die eigene verifizierte Nummer des Tenants"). Ob "Owner" im Sinne dieses
Praedikats zusaetzlich ueber `tenant.ownerName`/Account-Rolle abgesichert werden soll (falls
ein Tenant mehrere Nutzer hat), ist eine Owner-Entscheidung, keine Code-Tatsache — im
aktuellen Ein-Tenant-Alltag (Owner+Jonas, je eigener Tenant) faellt das zusammen.

---

## 3. System-Prompt des EL-Agenten: statisch vs. dynamisch

### Aufbau

Der EL-Agent (`agent_id`, konfiguriert unter `ELEVENLABS_AGENT_ID`) traegt seinen
**System-Prompt und `first_message` als STATISCHEN Text**, gepflegt in
`elevenlabs/agent_configs/outbound-agent.template.json` und per
`npm run elevenlabs:push` auf den Anbieter geschrieben (NICHT in diesem Lauf ausgefuehrt,
Guardrail). Der Prompt referenziert `{{owner_name}}`, `{{callee}}` etc. als Platzhalter,
die der Anbieter beim Verbindungsaufbau durch `conversation_initiation_client_data.
dynamic_variables` (Abschnitt 1.6) ersetzt — das ist der EINZIGE Weg, wie Anruf-spezifische
Werte den Agenten erreichen: `conversation_config_override` ist auf genau zwei Pfade
(Sprache, Stimme) whitelisted (`outbound.js:798-810`); ein dritter Override-Pfad wuerde vom
Anbieter bei nicht freigeschalteter Karte STILL ignoriert (Kommentar `outbound.js:19-25`).

### Kann eine neue Variable `{{callee_is_owner}}` mitreisen, ohne die Vorlage zu aendern?

**Nein.** Jede neue Variable muss als Platzhalter in der Vorlage NEU deklariert und per
`elevenlabs:push` an den Anbieter geschrieben werden — genau der Mechanismus, ueber den die
bestehenden zwoelf entstanden sind (Vokabular-Historie in `_sprachumstellung_hinweis`,
Zeile 17: von 4 auf 6 auf 9 auf 11 auf 12 Namen, jedes Mal mit Push + Vorlagen-Aenderung).
Ein Wert kann **ohne** Vorlagen-Aenderung nur in einen bereits existierenden Platzhalter
fliessen (z.B. koennte `{{background}}` ODER `{{constraints}}` einen zusaetzlichen Satz
tragen, wenn `isOwnerCall` wahr ist — dieselbe additive Technik wie `constraintsText`/
`backgroundText`, `outbound.js:524-558`, die schon heute bedingt Bloecke ein- oder
ausblenden). Ein **eigener Prompt-Block pro Anruf**, der nicht ueber eine deklarierte
Variable laeuft, ist auf diesem Weg strukturell ausgeschlossen — die Vorlage ist ein
statischer Text, kein Template-Interpreter.

### Was macht der Prompt heute mit `owner_name` (GQ-B2-Regeln)?

Woertlich aus `outbound-agent.template.json:682` (Prompt-Feld, Abschnitt "IF SOMETHING IS
UNCLEAR"):

> *"A detail only {{owner_name}} could know, you handle as described under REACHING YOUR
> PRINCIPAL below. [...] **NEVER offer {{owner_name}} as another way to get that answer.**
> Do not tell the other party to contact them, to call back later, or to bring the missing
> detail along at the appointment."*

Diese Regel ist Teil der GQ-B2-Kette (Drei-Klassen-Briefing, `tasks/gq-chain-state.md`,
Abschnitt "GQ-B2 2026-08-20"): der Owner ist waehrend des Anrufs ABWESEND (Normalfall),
`get_consult` fragt den auftraggebenden ASSISTENTEN (eigene Quellen: Kalender/Mail), nicht
den Menschen live. Die Regel verbietet dem Agenten, die Gegenstelle an `owner_name` zu
verweisen — sie behandelt `owner_name` durchgehend als **Drittperson, die nicht am Anruf
teilnimmt**. Es gibt in der heutigen Vorlage **keine** Fallunterscheidung fuer den Fall, dass
die Gegenstelle SELBST `owner_name` ist (der Anruf also an den Owner geht) — dieser Fall ist
im Prompt schlicht nicht vorgesehen, was das geplante Praedikat erst noetig macht.

**Budget-Engine-Vergleich (Annahme-frei belegt):** `src/i18n/prompts/en.js` — ein Grep nach
"NEVER offer"/"owner_name" liefert dort **keinen Treffer**. Die Budget-Engine
(`src/claude.js:291 ff.`, `systemPrompt`) hat keine analoge, woertliche Regel — sie ist ein
LLM-komponierter Prompt aus Bausteinen, keine statische Vorlage, und traegt heute
ueberhaupt kein "der Angerufene KOENNTE der Auftraggeber sein"-Konzept.

---

## 4. Persistenz am Call-Objekt

`createCall(s, {...})` — `src/store/state-ops.js:176-197` (Signatur) — nimmt entgegen:
`direction, from, to, goal, openingLine, twilioSid, briefing, constraints, context, mandate,
language, maxDurationS, requestedBy, tenantId, provider, reserveCents, diagnostic`.

Relevante gesetzte Felder (`state-ops.js:198 ff.`):

| Feld | Zeile | Bedeutung |
|---|---|---|
| `goal` | `:214` | `objective` aus `place_call` |
| `openingLine` / `openingLineSha256` | `:221-222` | nur EL-Weg, sonst `null` |
| `briefing` | `:223` | roh vom MCP-Client |
| `constraints` | `:224` | Verbote |
| `context` | `:228` | strukturierter Kontext (P3 Personal-Assistant) |
| `mandate` | `:232` | Vorab-Mandat (P6 Conversation-Quality-V2) |
| `diagnostic` | (weiter unten im Objekt) | serverseitig aufgeloest (`diagnosticRetentionGranted`), NIE roh vom Aufrufer |

**Ein neues Feld `ownerCall`** gehoert nach demselben Muster wie `diagnostic`: additiv,
serverseitig berechnet (Abschnitt 2), als eigener Parameter in die `createCall`-Signatur und
im Call-Objekt-Literal gesetzt — mit Kommentar-Praezedenz "additiv NULLABLE ... byte-identisch
zur pg-Hydrierung (`rowToCall`)" (Muster z.B. bei `answeredUnclearReason`, `state-ops.js:249-253`,
oder `lookupLog`, `:263-265`). Auf dem Postgres-Backend muesste `rowToCall` (`src/store/pg.js`)
entsprechend nachgezogen werden (nicht verifiziert in diesem Lauf, aber jedes additive Feld im
JSON-Store hat dort ein Gegenstueck — **Annahme, nicht geprueft**).

### Projektion in `publicCall` — Vorsicht Secrets

`publicCall({...})` — `src/store/views.js:28-47` — ist eine **Denylist-Projektion**: sie
nennt explizit die Felder, die NICHT nach aussen duerfen (`streamToken`, `_finished`,
`summarySmsSentAt`, `summaryMailSentAt`, `telnyxConversationId`, `callerTurns`, die
Kosten-internen Felder `estimatedCost*`/`actualCostMicroCents`/`costTrued*`) und gibt
`...rest` zurueck. Ein neues Feld `ownerCall` (Boolean, kein Secret, kein internes
Buchhaltungsdetail) würde **automatisch** in `publicCall` erscheinen, ohne dass die
Denylist angefasst werden muss — dasselbe gilt fuer `diagnostic`, `mandate`, `context`
heute. Das ist der Punkt, an dem "Vorsicht Secrets-Projektion" konkret zu pruefen ist: kein
neues Feld darf versehentlich etwas tragen, das in die Denylist gehoert (`ownerCall` als
reiner Boolean tut das nicht — es verraet nur, DASS der Angerufene der Owner ist, nicht
WELCHE Nummer).

---

## 5. Rolle von Telnyx-Assistant-Outbound und Budget-Outbound heute

### Die drei Zweige (Wiederholung aus 1.4, `api-calls.js:280-329`)

```
if (elevenLabsOutbound.enabled)         -> EL-Weg (Abschnitt 1.5)
else if (telnyxAssistant.enabled && ...) -> C-Telnyx-Assistant (src/telnyx-origination.js)
else                                      -> Budget/TeXML (voiceControl(...).originateCall)
```

### Flag-Stand in `.env.example` (Repo-Default, NICHT zwingend Live-Wert)

- `ELEVENLABS_OUTBOUND_ENABLED=false` (`.env.example:127`)
- `TELNYX_AI_ASSISTANT_ENABLED=false` (`.env.example:152`)
- `VOICE_ENGINE=budget` (`.env.example:841`)

Diese Repo-Defaults sind fail-closed gedacht — der dokumentierte Bestand (`CLAUDE.md`,
"Live != render.yaml") sagt ausdruecklich, dass Render-Env vom `.env.example`-Wert abweichen
kann und in mehreren Faellen abweicht.

### Live-Stand (belegt ueber `tasks/gq-chain-state.md`, NICHT ueber einen Render-API-Zugriff
in diesem Lauf — Guardrail)

`tasks/gq-chain-state.md`, Abschnitt "LIVE-SCHALTUNG 2026-08-20 — VOLLZOGEN": Owner hat am
2026-08-20 in bindender Reihenfolge (1) `elevenlabs:push`, (2) Deploy, (3) `elevenlabs:drift`
durchgefuehrt und dokumentiert *"GQ-E1, GQ-B1 und GQ-B2 sind damit LIVE"*, gefolgt von einem
Wirkungsbeleg-Testanruf (`call_mt18soytibps`) noch am selben Tag. Das ist nur moeglich, wenn
`ELEVENLABS_OUTBOUND_ENABLED=true` in Produktion (Render) steht — der EL-Zweig ist damit der
**heute tatsaechlich fahrende** Outbound-Weg. **Das ist eine aus der Dokumentation
erschlossene Aussage, kein direkter Env-Read** (Guardrail: keine Render-Zugriffe in diesem
Lauf) — bei Bedarf am Boot-Log/Render-Dashboard gegenzupruefen.

Fuer `TELNYX_AI_ASSISTANT_ENABLED` liegt in diesem Lauf **kein** aktueller Live-Beleg vor.
Historisch (2026-08-04, `tasks/gq-chain-state.md` Abschnitt "Frisches Rohmaterial") lief
**jeder** Outbound-Call ueber den "assistant"-Pfad (C-Telnyx) — das war VOR der EL-Kette.
Seit 2026-08-19 spricht der Kettenstand ausschliesslich von "ElevenLabs-Outbound"-Testanrufen
(`call_mt0ddduxuzgl`, `call_mt18soytibps`), was auf einen bereits vorher vollzogenen Wechsel
weg vom C-Telnyx-Pfad hindeutet. **Nicht in diesem Lauf verifiziert; als Annahme markiert.**

### Reicht es, das Feature NUR auf dem EL-Pfad zu bauen?

**Nein — der Fallback ist kein totes Code-Fragment, sondern ein Pfad, der bei Bedarf real
waehlt:**

1. Der `else`-Zweig (`api-calls.js:322-328`, Budget/TeXML) ist an **kein Feature-Flag**
   gebunden — er ist der bedingungslose Rest-Zweig. Sobald `elevenLabsOutbound.enabled`
   und `telnyxAssistant.enabled` beide falsch sind (Repo-Default, oder ein Rollback der
   Render-Env auf 2026-08-20), fallen ALLE Outbound-Calls automatisch auf diesen Zweig
   zurueck — inklusive Anrufe an die Nummer des Owners.
2. Dieser Zweig macht keinen Trockenlauf: `voiceControl(ctx.outboundProvider).originateCall(...)`
   (`api-calls.js:323`) loest denselben realen Telnyx-Call aus wie jeder andere Outbound-Call
   auf dieser Engine — der Dry-Run-Schalter `FAKE_ORIGINATE` (`src/config.js:1630`, Default
   `false`, `.env.example:828`) ist ein **eigener, unabhaengiger** Schalter fuer genau diesen
   Pfad und steht in Produktion auf `false` (kein Beleg fuer eine Abweichung gefunden).
   `FAKE_ORIGINATE_ELEVENLABS` (`config.js:1640-1642`) deckt NUR den EL-Netzzugriff ab —
   beide Trockenlege-Naehte sind bewusst getrennt (Modulkopf `outbound.js:639-646`).
3. Die Budget-Engine (`src/claude.js`) hat, wie in Abschnitt 3 belegt, **kein**
   `owner_name`-Bewusstsein und keine "NEVER offer owner as an alternative"-Regel — ein
   Anruf an den Owner, der ueber diesen Fallback laeuft, wuerde vom geplanten
   `isOwnerCall`-Feature **nichts** sehen, wenn das Praedikat nur in `src/elevenlabs/
   outbound.js` verdrahtet ist.
4. C-Telnyx-Assistant (`src/telnyx-origination.js:17-30`) bindet nur eine statische
   `assistantId` (`bindAssistantToCall`, Zeile 13-15) — keine per-Call-Variablen-Injektion
   ist an dieser Stelle im Code sichtbar; die Prompt-Konfiguration des Telnyx-Assistant-
   Objekts liegt provider-seitig (aehnlich der EL-Vorlage), aber der Origination-Code selbst
   traegt kein Aequivalent zu `dynamicVariables`. **Nicht vollstaendig exploriert in diesem
   Lauf** (der Custom-LLM-Shim `src/telnyx-llm-shim.js` koennte pro Turn eigene Prompt-Logik
   fahren — das war ausserhalb des Auftragsumfangs dieser Kartierung).

**Konsequenz:** Der Auftrag in Abschnitt 2 (Praedikat zentral, nach den Gates, auf dem
Call-Record persistiert, bevor die Engine-Weiche greift) ist nicht nur "sauberer", sondern
die einzige Variante, die auch bei einem EL-Rollback nicht lautlos wieder unsicher wird —
genau das Muster, das `diagnosticRetentionGranted` fuer die Diagnose-Retention bereits
etabliert hat (serverseitig VOR der Engine-Wahl, additiv am Call-Record, jede Engine liest
denselben Wert statt ihn selbst herzuleiten).

---

## Kernaussagen fuer den Planer

- `ctx.to` steht ab dem Gate `normalize_target` (`src/telephony/outbound-gates.js:584-601`)
  fest; die 12 `dynamicVariables` entstehen ERST in `originateCall`
  (`src/elevenlabs/outbound.js:742-760`, aufgerufen `:1226 ff.`) — deutlicher zeitlicher
  Abstand zwischen beiden.
- MCP `place_call` ruft intern `POST /api/calls` (`src/mcp-tools.js:141`) — die komplette
  Sicherheits-/Geld-Gate-Kette (`src/telephony/outbound-gates.js`) sitzt dort, EINMAL, fuer
  alle drei Engines gemeinsam.
- Der saubere Ansatzpunkt fuer `isOwnerCall` ist `src/routes/api-calls.js` direkt nach der
  Gate-Schleife (Zeile ~204), im selben Muster wie `diagnosticRetentionGranted`
  (`src/diagnostic-retention.js:39-42`, Kern bereits `Boolean(ownNumber) && to === ownNumber`)
  — als neues pures Modul, NICHT in `src/elevenlabs/outbound.js`.
- Das Ergebnis gehoert additiv auf den Call-Record (`createCall`, `src/store/state-ops.js:176 ff.`,
  Muster `diagnostic`) — dann sehen alle drei Engines denselben, einmal berechneten Wert,
  statt ihn dreimal separat herzuleiten.
- `publicCall` (`src/store/views.js:28-47`) ist eine Denylist-Projektion — ein neues
  Boolean-Feld erscheint automatisch, solange es kein Secret traegt; Pruefpflicht bleibt,
  dass `ownerCall` selbst keine Nummer/PII exponiert.
- Eine neue Prompt-Variable am EL-Agenten (`{{callee_is_owner}}`) erfordert zwingend eine
  Vorlagen-Aenderung PLUS `elevenlabs:push` — sie kann nicht "silent" ueber einen
  bestehenden Slot mitreisen, ausser man haengt den Zusatzsatz additiv an `{{background}}`
  oder `{{constraints}}` (bestehende Technik, `outbound.js:524-558`).
- Der EL-Prompt behandelt `owner_name` heute durchgehend als abwesende Drittperson und
  verbietet ausdruecklich, die Gegenstelle an sie zu verweisen ("NEVER offer {{owner_name}}
  as another way to get that answer", `outbound-agent.template.json:682`) — es gibt KEINE
  Fallunterscheidung fuer "die Gegenstelle IST der Owner".
- Die Budget-Engine (`src/claude.js`, `systemPrompt`) hat kein Aequivalent zu dieser Regel
  und keinen owner_name-Bewusstseinsblock (`src/i18n/prompts/en.js` traegt sie nicht).
- Der Budget/TeXML-Fallback (`api-calls.js:322-328`) ist an KEIN Feature-Flag gebunden und
  loest bei jedem EL/C-Telnyx-Ausfall real Anrufe aus (`FAKE_ORIGINATE` default `false`) —
  das Feature NUR im EL-Zweig zu bauen waere bei einem Rollback lautlos wirkungslos.
- Fuer den heutigen Live-Stand von `ELEVENLABS_OUTBOUND_ENABLED=true` liegt kein direkter
  Env-Read vor (Guardrail: kein Render-Zugriff), sondern eine aus `tasks/gq-chain-state.md`
  erschlossene, aber starke Indizienkette (Live-Schaltung + Wirkungsbeleg-Testanruf am
  2026-08-20).
- Fuer `TELNYX_AI_ASSISTANT_ENABLED` und die Prompt-Mechanik des Custom-LLM-Shims
  (`src/telnyx-llm-shim.js`) liegt kein aktueller Live-Beleg bzw. keine vollstaendige
  Exploration in diesem Lauf vor — als offener Punkt markiert, nicht geraten.
