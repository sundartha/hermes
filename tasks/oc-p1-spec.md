# OC-P1 — Praedikat, Persistenz, Schalter

Bauanweisung. Allein tragfaehig: du brauchst NUR diese Datei und den Code.
Basis: master `ec2ac28`. Repo-Konventionen: ESM, kein Build-Step, keine neuen
Dependencies, Kommentare/Doku deutsch OHNE Umlaute.

---

## 1. Worum es geht

Ein Tenant kann eine eigene private Rufnummer hinterlegen (`tenant.privateNumber`). Ruft
Hermes outbound GENAU diese Nummer an, soll spaeter (OC-P2/OC-P3) der Offenlegungssatz
entfallen und der Agent den Auftraggeber direkt ansprechen.

**Diese Phase baut NUR die Entscheidung, nicht ihre Wirkung.** Nach OC-P1 aendert sich
kein einziger gesprochener Satz, in keiner Sprache, auf keinem Pfad, bei keinem
Schalterstand. Was entsteht, ist ein reines Praedikat, sein Ergebnis am Anruf-Datensatz
und ein Schalter, der es scharfstellt.

Begriffe sind verbindlich (im Bestand heisst "Owner-Call" bereits etwas anderes, naemlich
"Anruf des Owner-Tenants" — z.B. `test/claude-identity.test.js:57`):

| verwenden | NICHT verwenden |
|---|---|
| `calleeIsOwner` (JS-Feld/Funktion) | `ownerCall`, `isOwnerCall`, `selfCall` |
| `callee_is_owner` (Postgres-Spalte) | — |

---

## 2. Was zu bauen ist

### 2.1 Neues Modul `src/callee-is-owner.js`

Rein: kein Store, kein `config`, kein IO, kein Import ausser (falls ueberhaupt noetig)
Node-Builtins. Vorbild ist `src/diagnostic-retention.js` — lies dessen Modulkopf, er
begruendet genau diese Bauart.

Exportiere ZWEI Funktionen:

```js
export function calleeIsOwner({ to, ownNumber }) { ... }
export function ownerSelfCallGranted({ to, ownNumber, tenantId, enabled, allowedTenantIds }) { ... }
```

Vertrag `calleeIsOwner` (der nackte Nummern-Vergleich):

- `true` **nur** wenn `to` und `ownNumber` beide nicht-leere Strings sind UND
  `to === ownNumber` gilt.
- sonst `false`. Immer. Kein Wurf, kein Log, kein `null`, kein `undefined`.
- **Strikte String-Gleichheit.** Kein Praefix-Match, kein Vergleich der letzten n
  Ziffern, keine Gross-/Kleinschreibungs-Toleranz, keine Normalisierung IM Praedikat.
  Die Normalisierung ist vorgelagert (`normalize_target`-Gate) und geteilt; ein
  Praedikat, das selbst normalisiert, wird irgendwann grosszuegig normalisieren.

Vertrag `ownerSelfCallGranted` (die vollstaendige Bedingung dieses Plans):

```
enabled === true
  && tenantId ist ein nicht-leerer String und in allowedTenantIds enthalten
  && calleeIsOwner({ to, ownNumber })
```

- Rueckgabe strikt Boolean. `allowedTenantIds` fehlt / ist keine Liste / ist leer ⇒
  `false` (fail-closed: leere Allowlist heisst NIEMAND, nicht JEDER).
- Der Vergleich der Tenant-ID ist ebenfalls strikte String-Gleichheit, kein Trim-Zauber im
  Praedikat (das Trimmen/Splitten der Env-Liste passiert in `config.js`, einmal).
- Auch hier: kein Wurf, kein Log.
- Die Funktion importiert **kein** `config` — die Werte werden hereingereicht. Damit
  bleibt das Modul rein und ohne Spawn testbar.

**Warum zwei Exporte und nicht einer.** `diagnostic-retention.js` (2.2) braucht NUR den
Nummern-Vergleich und darf ausdruecklich NICHT am Offenlegungs-Schalter haengen — sonst
faellt mit einem Flag-Flip still ein Bestandsfeature aus. `api-calls.js` (2.3) braucht NUR
die vollstaendige Bedingung und darf sie nicht selbst zusammensetzen — sonst gibt es zwei
Wahrheiten darueber, was "Owner-Anruf" heisst. Eine Datei, ein Vergleich, zwei benannte
Zugaenge.

Der Modulkopf haelt in deutschen Kommentaren fest: was das Praedikat entscheidet (ob ein
gesetzlicher Pflichtsatz gesprochen wird), warum es rein ist, warum der Vergleich strikt
ist, warum die Tenant-Allowlist Teil der Bedingung und nicht ein Aufrufer-Detail ist, und
dass jede Unsicherheit `false` ergibt (fail-closed = Offenlegung bleibt).

### 2.2 `src/diagnostic-retention.js` auf dasselbe Praedikat umstellen

`diagnosticRetentionGranted` (`src/diagnostic-retention.js:49-53`) endet heute mit

```js
return Boolean(ownNumber) && to === ownNumber;
```

Das ist derselbe Vergleich. Stelle ihn auf `calleeIsOwner({ to, ownNumber })` um.

- Verhalten muss **byte-identisch** bleiben. Die bestehenden Tests dieses Moduls duerfen
  nicht angefasst werden und muessen gruen bleiben.
- Grund im Kommentar festhalten: zwei Kopien desselben Vergleichs koennten
  auseinanderlaufen (jemand macht einen davon "robuster"), und ab OC-P2 haengt an genau
  diesem Vergleich eine Rechtspflicht. G5, eine Quelle.
- Der Bestandskommentar an `ownNumber` (`src/diagnostic-retention.js:44`) nennt die Nummer
  "verifiziert". Das stimmt nur im Sinn von Format-/Land-validiert. Praezisiere den
  Kommentar entsprechend (kein Verhaltens-, nur ein Wahrheitsgehalt-Fix).

### 2.3 Auswertung in `src/routes/api-calls.js`

Ort: **nach** der Gate-Schleife (heute `src/routes/api-calls.js:161-172`), direkt neben
dem strukturgleichen `diagnosticRetentionGranted`-Aufruf (heute Zeile 190-199).

```js
const ownNumber = store.tenantPrivateNumber(ctx.tenantId);
```

`ownNumber` wird bereits fuer `diagnostic` geholt — **hole es genau einmal** und reiche es
an beide Stellen. Zwei `store`-Aufrufe waeren zwei Momentaufnahmen.

Das Ergebnis:

```js
const calleeIsOwnerOfThisCall = ownerSelfCallGranted({
  to: ctx.to,
  ownNumber,
  tenantId: ctx.tenantId,
  enabled: config.voice.ownerSelfCallEnabled,
  allowedTenantIds: config.voice.ownerSelfCallTenantIds,
});
```

Zwingend:

- **`ctx.to`, nicht `to`.** Die lokale `to` ist die ROHE Eingabe; `ctx.to` ist die vom
  `normalize_target`-Gate (`src/telephony/outbound-gates.js:584-601`) aufgeloeste E.164.
  Der Bestandskommentar an Zeile 181-183 sagt das ausdruecklich.
- **`ctx.tenantId`, nicht irgendeine andere Tenant-Quelle.** Es ist der ANRUFENDE Tenant,
  festgestellt von `resolve_identity` in derselben Gate-Kette. Die Allowlist beantwortet
  "darf DIESER Account die Ausnahme ausloesen", nicht "wem gehoert die Zielnummer".
- **Kein neues Gate.** Die Gate-Kette ist reihenfolge-gepinnt
  (`test/outbound-gates-order.test.js`); ihre Glieder lehnen ab, dieses Praedikat lehnt
  nie ab. Dieselbe Begruendung fuehrt der Bestandskommentar bereits fuer `diagnostic`
  (Zeile 195-198). `test/outbound-gates-order.test.js` bleibt unveraendert.
- Der Wert geht als neues Feld in `store.createCall({...})` (heute Zeile 258-276).

### 2.4 Persistenz — Muster woertlich `diagnostic`

**Call-Record** (`src/store/state-ops.js`, `createCall` ab Zeile 176): neuer Parameter
`calleeIsOwner`, gesetzt als `calleeIsOwner === true` (nie der Rohwert), Default `false`.
Danach nie wieder geschrieben — set-once.

**Postgres**, alle vier Stellen (grep nach `diagnostic`, dort steht jeweils das Vorbild):

| Stelle | heute (Vorbild) |
|---|---|
| Tabellendefinition | `src/db/schema.sql:270` |
| Migration | `src/db/schema.sql:377` (`ALTER TABLE call ADD COLUMN IF NOT EXISTS ...`) |
| Zeilen-Mapper | `src/store/pg.js:1358` (`diagnostic: r.diagnostic === true`) |
| Insert-Bind + Spaltenliste | `src/store/pg.js:1752` und `:1851` |

Spalte: `callee_is_owner BOOLEAN NOT NULL DEFAULT FALSE`.

**Kein Backfill.** `DEFAULT FALSE` ist fuer jeden Bestands-Anruf die richtige Antwort
(NICHT-Owner → Offenlegung). Die Migration laeuft beim Boot mit.

**`publicCall`** (`src/store/views.js:28-47`) ist eine Denylist-Projektion: das neue
Boolean erscheint dort automatisch. Das ist gewollt. Nimm es NICHT in die Denylist auf.
Was NICHT erscheinen darf, ist die Nummer selbst — sie kommt gar nicht erst auf den
Call-Record.

### 2.5 Schalter `OWNER_SELF_CALL_ENABLED` + Allowlist `OWNER_SELF_CALL_TENANT_IDS`

Zwei Variablen, beide fail-closed per Default, jede an vier Stellen — acht Pflichtstellen
insgesamt:

| Variable | Typ | Default | Bedeutung |
|---|---|---|---|
| `OWNER_SELF_CALL_ENABLED` | Boolean | `false` | Notaus/Scharfschalter der ganzen Ausnahme |
| `OWNER_SELF_CALL_TENANT_IDS` | Komma-Liste | **leer** | welche Tenants die Ausnahme ueberhaupt ausloesen duerfen |

1. `src/config.js` — beide Werte lesen (Boolean nach dem Muster der uebrigen Flags; die
   Liste EINMAL hier splitten/trimmen/leere Elemente verwerfen, sodass
   `config.voice.ownerSelfCallTenantIds` immer ein Array of Strings ist, nie `undefined`)
   UND **beide Schluessel** in `CONFIG_NAMESPACES` unter `voice` eintragen
   (`src/config.js:1917`). Ohne den Namespace-Eintrag ist der Wert unter `config.voice.*`
   `undefined` — und `undefined` liest im Praedikat als fail-closed, das Feature waere
   also stumm tot.
2. `.env.example` — beide, mit Erklaerung, in der Naehe der uebrigen Outbound-/Voice-
   Schalter. Schreib dazu: Default aus bzw. leer; an + gepinnter Tenant heisst, dass bei
   einem Anruf an die eigene hinterlegte Nummer dieses Tenants der lange Offenlegungssatz
   entfaellt (wirkt erst ab OC-P2); die KI-Kennzeichnung entfaellt nie. Und ausdruecklich:
   **leere Liste = niemand**, und in die Liste gehoert vor dem Launch ausschliesslich ein
   Account, der uns gehoert.
3. `render.yaml` — beide mit `sync: false`. **Muster ist `ELEVENLABS_AGENT_ID`
   (`render.yaml:106-107`), NICHT `ELEVENLABS_OUTBOUND_ENABLED`** — das traegt
   `value: "false"` (`render.yaml:103-104`) und waere hier falsch: ein im Blueprint
   gepinnter Wert wird von einem Blueprint-Sync ueber das im Dashboard gedrehte `true`
   zurueckgeschrieben, und beide Wege dieser Kette (Scharfstellen wie Rueckzug) laufen
   ueber das Dashboard.
4. `test/helpers.js` `BASE_ENV` (ab Zeile 49) — `OWNER_SELF_CALL_ENABLED` auf `"false"`,
   `OWNER_SELF_CALL_TENANT_IDS` auf `""` pinnen. Ohne diesen Pin leckt eine lokale `.env`
   ueber `dotenv` in jeden Spawn-Test.

Beide sitzen **im Praedikat** (`ownerSelfCallGranted`, 2.1/2.3), nicht an den spaeteren
Verbrauchern. Schalter aus ODER Liste leer ODER Tenant nicht in der Liste ⇒
`calleeIsOwner` ist fuer jeden Anruf `false` ⇒ exaktes Bestandsverhalten.

**Warum die Liste kein Beiwerk ist:** `POST /api/self-service/private-number` haengt allein
hinter `webAuthMw` (`src/self-service-routes.js:401`) — jeder eingeloggte Tenant darf jede
format-/land-gueltige Nummer eintragen. Ohne Allowlist waere die einzige Absicherung des
akzeptierten Risikos ein Mensch, der sich an einen Env-Flip erinnert. Mit ihr kann ein
fremder Account die Ausnahme strukturell nicht ausloesen.

---

## 3. Entscheidungen (nicht neu aufrollen)

- **Eigenes Modul statt Erweiterung von `diagnostic-retention.js`:** zwei Risikoklassen
  (laengere Transkript-Aufbewahrung vs. gesetzlicher Pflichtsatz), aber EIN Vergleich.
- **Persistiert statt in jeder Engine nachgerechnet:** zwischen `POST /api/calls` und dem
  Klingeln liegen Eroeffnungszeilen-Erzeugung, Briefing und Anrufstart; ein Tenant, der in
  diesem Fenster seine Nummer aendert (`POST /api/self-service/private-number`), wuerde
  eine zweite Auswertung in BEIDE Richtungen kippen lassen. Ausserdem: der `else`-Zweig
  in `src/routes/api-calls.js:322-338` (Budget/TeXML) haengt an keinem Flag und faengt
  jeden Ausfall der anderen Engines auf — ein zweiter Rechenweg dort waere ein Blindfleck
  genau im Rueckfall.
- **Feld-Wiederverwendung `privateNumber`:** ja. Es ist bereits das Feld "meine eigene
  Nummer", hat zwei authentifizierte Schreibwege mit EINER Validierungsquelle
  (`normalizePrivateNumber`, `src/store/state-ops.js:2127-2136` — eine gemeinsame
  VALIDIERUNG, ausdruecklich KEINE Zugangsbeschraenkung), lebt am Tenant-Record
  und nicht in `settings` (das leckt vollstaendig ueber `/api/state` + MCP), und wird
  bereits heute exakt so verglichen (`src/diagnostic-retention.js:52`).
- **Kein Backfill, kein Gate, kein Client-Flag.** Der Aufrufer nennt nur `to`; alles
  andere entscheidet der Server.

---

## 4. Invarianten (verletzen = Phase durchgefallen)

1. **Kein gesprochener Text aendert sich.** Weder `disclosureSentence`, noch `openingText`,
   noch der EL-Anrufstart, noch ein Prompt werden in dieser Phase angefasst.
2. **`diagnostic` verhaelt sich byte-identisch zum Bestand** — bei jedem Schalterstand.
3. **Kein bestehender Test wird veraendert.** Faellt einer um, ist das ein Befund fuer den
   Phasenbericht, kein Anpassungsbedarf. Das gilt besonders fuer alles, was Offenlegung
   oder Gate-Reihenfolge pinnt.
4. **Die private Nummer erscheint nirgends neu.** Nicht auf dem Call-Record, nicht in
   einer API-Antwort, nicht im Audit-Log, nicht in einem Log. Auf dem Call-Record steht
   nur das Boolean.
5. `LLM_PROVIDER=anthropic npm test` ist vollstaendig gruen (gemessener Ausgangsstand
   2026-08-20: `korrigiert: tests 4909 / pass 4909 / fail 0`); `npm run test:gates` faehrt
   weiterhin exakt `korrigiert: tests 129` (`pass 126 / fail 3`).
6. **Leere Allowlist heisst NIEMAND.** Es gibt keinen Codepfad, in dem eine fehlende, leere
   oder unlesbare `OWNER_SELF_CALL_TENANT_IDS` als "alle Tenants" gelesen wird. Das ist
   die haeufigste Art, eine Allowlist in eine fail-open-Attrappe zu verwandeln (Memory
   `streaming-armierung-allowlist`).

---

## 5. Abgrenzung — ausdruecklich NICHT in dieser Phase

- Keine Locale-/Prompt-Texte, keine Owner-Eroeffnung, keine Owner-Persona.
- Keine Aenderung an `src/elevenlabs/*`, `src/claude.js`, `src/bridge.js`,
  `src/telnyx-call-control-ingest.js`, `src/routes/voice.js`.
- Keine Aenderung an `elevenlabs/agent_configs/outbound-agent.template.json`, kein
  `npm run elevenlabs:push`, kein `npm run elevenlabs:drift` (Netzzugriff).
- Keine UI, kein `apps/web`.
- Keine Besitz-Verifikation der Nummer (bewusst zurueckgestellt, eigene spaetere Kette).
- Kein `CLAUDE.md`- oder `PLAN-SECURITY.md`-Eintrag (der gehoert zu OC-P2, wenn die
  Ausnahme wirklich wirkt).
- Kein echter Anruf, kein Deploy, kein `git push`.

---

## 6. Tests

Neue Datei `test/callee-is-owner.test.js` (Einheitstests, offline, kein Spawn) plus
Ergaenzungen dort, wo Store/Route beruehrt sind. **Kein Katalog-ID-Praefix** am
Testnamen (`^(Charakterisierung )?(DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD)-[0-9]`
landet sonst im `test:gates`-Lauf statt in `npm test`) und **kein `ABNAHME-`-Praefix**.

Pflicht-Faelle:

**A. Praedikat (`test/callee-is-owner.test.js`)**

| Fall | erwartet |
|---|---|
| `to` und `ownNumber` identische E.164 | `true` |
| `ownNumber` fehlt (`null`/`undefined`/`""`) | `false` |
| `to` fehlt (`null`/`undefined`/`""`) | `false` |
| beide fehlen | `false` |
| gleiche Ziffern, aber ohne `+` (`4917...` vs `+4917...`) | `false` |
| nationale Schreibweise (`017...`) gegen `+4917...` | `false` |
| gleiche letzten acht Ziffern, anderer Laendercode | `false` |
| ein Zeichen Unterschied | `false` |
| Leerzeichen am Rand (`" +4917..."`) | `false` |
| Nicht-String (Zahl, Objekt) auf einer Seite | `false` |

Diese Tabelle ist der Riegel gegen den gefaehrlichsten Umbau der Zukunft ("mach den
Vergleich robuster"). Schreib genau das als Kommentar dazu.

**A2. Vollstaendige Bedingung (`ownerSelfCallGranted`, Einheitstest, kein Spawn)**

| Fall | erwartet |
|---|---|
| `enabled: true`, Tenant in der Liste, Ziel = eigene Nummer | `true` |
| `enabled: false`, sonst alles wie oben | `false` |
| `enabled: true`, Liste **leer** | `false` |
| `enabled: true`, Liste ohne diesen Tenant (aber mit einem anderen) | `false` |
| `enabled: true`, `allowedTenantIds` fehlt / kein Array | `false` |
| `enabled: true`, Tenant in der Liste, Ziel FREMD | `false` |
| `enabled: "true"` (String!) | `false` |
| `tenantId` leer/`null`/`undefined` | `false` |

Die dritte und vierte Zeile sind der Riegel gegen "leere Liste heisst alle" — die
haeufigste Fehlinterpretation einer Allowlist und in diesem Repo schon einmal Thema
(Memory `streaming-armierung-allowlist`).

**B. Schalter + Allowlist ueber den Anruf-Datensatz**

- Schalter aus + Ziel IST die eigene Nummer (Tenant gepinnt) ⇒ `call.calleeIsOwner === false`.
- Schalter an + Ziel ist NICHT die eigene Nummer (Tenant gepinnt) ⇒ `call.calleeIsOwner === false`.
- Schalter an + Ziel IST die eigene Nummer + Tenant **nicht** gepinnt ⇒ `call.calleeIsOwner === false`.
- Schalter an + Ziel IST die eigene Nummer + Tenant gepinnt ⇒ `call.calleeIsOwner === true`.

**C. Store-Roundtrip, beide Backends.** Vorbild fuer das Doppel ist
`test/persona-style.test.js` + `test/persona-style-pg.test.js`; ausserdem existiert
`test/store-pg-json-parity.test.js`. Gepinnt wird: geschrieben `true` ⇒ gelesen `true`;
gar nicht gesetzt ⇒ gelesen `false` (nie `undefined`, nie `null`); ein Call-Datensatz
OHNE das Feld (Bestandsform) liest `false`.

**D. Route.** Ueber `POST /api/calls`: bei Ziel = eigene Nummer (Schalter an, Tenant
gepinnt) traegt der erzeugte Call `calleeIsOwner: true`, bei fremdem Ziel `false`. Nutze
den vorhandenen Trockenlege-Weg (`FAKE_ORIGINATE`), damit kein echter Anruf entsteht —
und setze im Spawn-Env zusaetzlich `ELEVENLABS_OUTBOUND_ENABLED=false` und
`TELNYX_AI_ASSISTANT_ENABLED=false`, sonst verzweigt die Route vor dem trockengelegten
TeXML-Zweig (`src/routes/api-calls.js:290` bzw. `:304`).

**E. Nicht-Leak.** `publicCall` liefert das Boolean, aber nirgends die Nummer; das Audit
zu `POST /api/self-service/private-number` traegt weiterhin nur `outcome`, nie den Wert
(`src/self-service-routes.js:412`).

**F. `diagnostic` unveraendert.** Ein Test, der belegt, dass `diagnostic` bei
`OWNER_SELF_CALL_ENABLED=false` UND `=true` und bei leerer wie gefuellter Allowlist exakt
dasselbe Ergebnis liefert wie heute — die Diagnose-Retention haengt NICHT am neuen
Schalter und NICHT an der Allowlist. Das ist die Zusage aus 2.2 (zwei Exporte, ein
Vergleich) in Testform.

---

## 7. Abnahme (deterministisch)

Jeder Punkt ist ein Kommando mit erwarteter Ausgabe. Alle vom Repo-Wurzelverzeichnis aus.

1. **Syntax**
   ```
   node --check src/callee-is-owner.js && node --check src/diagnostic-retention.js && node --check src/routes/api-calls.js && node --check src/store/state-ops.js && node --check src/store/pg.js && node --check src/config.js
   ```
   Erwartet: keine Ausgabe, Exit 0.

2. **Neue Einheitstests**
   ```
   NODE_ENV=test LLM_PROVIDER=anthropic node --test test/callee-is-owner.test.js
   ```
   Erwartet: `fail 0`, `pass` >= 22 (10 Vergleichs-Faelle aus A + 8 Bedingungs-Faelle aus
   A2 + 4 Faelle aus B).

3. **Volle Regressionsbank**
   ```
   LLM_PROVIDER=anthropic npm test
   ```
   Erwartet: `fail 0`. **Gemessener Ausgangsstand 2026-08-20 (master `ec2ac28`):
   `korrigiert: tests 4909 / pass 4909 / fail 0`.** Die korrigierte Gesamtzahl liegt
   danach um die Zahl der neuen Faelle ueber 4909 — sie darf NICHT darunter liegen (das
   hiesse: ein Test ist verschwunden oder in den `test:gates`-Lauf abgewandert).

4. **Kein Testkatalog-Leck**
   ```
   npm run test:gates
   ```
   Erwartet: **exakt `korrigiert: tests 129`** — der am 2026-08-20 gemessene
   Ausgangsstand (`pass 126 / fail 3`). Keiner der neuen Tests darf hier auftauchen. Die
   drei roten sind Bestand; rot/gruen ist in dieser Bank erlaubt, die ANZAHL nicht.

5. **Schalter + Allowlist greifen, Ende zu Ende, ohne echten Anruf.** Vorbereitung: den
   Test-Tenant anlegen/einloggen und seine private Nummer ueber die Anwendung setzen
   (`POST /api/self-service/private-number`) — ohne hinterlegte Nummer misst dieser
   Schritt nichts. Seine Tenant-ID kommt in die Allowlist. Dann:
   ```
   PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true FAKE_ORIGINATE=true \
     FAKE_ORIGINATE_ELEVENLABS=true ELEVENLABS_OUTBOUND_ENABLED=false \
     TELNYX_AI_ASSISTANT_ENABLED=false \
     OWNER_SELF_CALL_ENABLED=true OWNER_SELF_CALL_TENANT_IDS=<tenant-id> npm start
   ```
   Die drei zusaetzlichen Variablen sind **nicht optional**: `FAKE_ORIGINATE` legt nur den
   TeXML-Zweig trocken. Steht in der lokalen `.env` `ELEVENLABS_OUTBOUND_ENABLED=true`
   oder `TELNYX_AI_ASSISTANT_ENABLED=true`, verzweigt die Route vorher
   (`src/routes/api-calls.js:290` bzw. `:304`) — und dann waere das ein **echter Anruf**
   mit echten Kosten (Absolute Regel 1).

   Erwartet: der Call an die hinterlegte eigene Nummer traegt in `GET /api/state`
   `calleeIsOwner: true`, der an eine fremde Nummer `false`, derselbe Call mit leerer
   Allowlist wieder `false`, und in **keiner** der Antworten taucht die private Nummer
   auf.

6. **Nichts Gesprochenes hat sich bewegt**
   ```
   git diff --stat master -- src/claude.js src/bridge.js src/elevenlabs src/i18n src/routes/voice.js src/telnyx-call-control-ingest.js elevenlabs/
   ```
   Erwartet: **leer**. Wird hier irgendetwas angezeigt, ist die Abgrenzung (Abschnitt 5)
   verletzt.

7. **Beide neuen Env-Variablen sind vollstaendig verdrahtet**
   ```
   grep -c OWNER_SELF_CALL_ENABLED .env.example render.yaml test/helpers.js src/config.js
   grep -c OWNER_SELF_CALL_TENANT_IDS .env.example render.yaml test/helpers.js src/config.js
   ```
   Erwartet: in BEIDEN Laeufen meldet jede der vier Dateien mindestens 1. Zusaetzlich:
   ```
   grep -n "ownerSelfCallEnabled\|ownerSelfCallTenantIds" src/config.js
   ```
   Erwartet: beide Namen erscheinen sowohl bei der Wertbildung als auch in der
   `voice`-Zeile von `CONFIG_NAMESPACES` (`src/config.js:1917`) — fehlt der
   Namespace-Eintrag, ist der Wert zur Laufzeit `undefined` und das Feature stumm tot.

8. **Datei-Umfang bewusst ueber der Faustgrenze.** Diese Phase beruehrt rund 13 Dateien.
   Das ist im Plan (Abschnitt 6, OC-P1) begruendet und KEIN Befund: Schema, Store-Mapper,
   Route und Env-Verdrahtung sind EIN Feld. Der Phasenbericht nennt die Liste; er
   rechtfertigt sie nicht neu.

---

## 8. Fallen aus der Projekthistorie

- **`BASE_ENV`-Drift:** eine neue Env-Variable ohne Pin in `test/helpers.js` laesst die
  lokale `.env` in jeden Spawn-Test lecken. Das hat hier schon einmal zugeschlagen.
- **Katalog-ID-Praefix:** ein Testname, der mit `LAW-`, `PROMPT-`, `OUT-` usw. beginnt,
  wandert stumm in den `test:gates`-Lauf und wird von `npm test` nicht mehr gefahren.
- **`git add -A` ist in diesem Repo verboten.** Dateien einzeln adden, vorher auf
  Secrets/PII pruefen.
- **pg-Store haelt Zustand im Speicher.** Er hydriert einmalig bei `init()`; ein
  Direkt-`UPDATE` per `psql` ist fuer den laufenden Prozess unsichtbar und kann vom
  naechsten `save()`-Flush ueberschrieben werden. Fuer Tests spielt das keine Rolle
  (frische Prozesse), fuer manuelles Probieren schon.
- **Verwaiste Testserver:** Spawn-Tests lassen gelegentlich Serverprozesse zurueck. Nach
  langen Laeufen pruefen (`ps`, nicht `pgrep` — das ist in der Sandbox blind).
