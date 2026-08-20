# PLAN-OWNER-CALL — Anruf an die eigene Nummer des Tenants

Autoritatives Strategiedokument. Stand 2026-08-20, master `ec2ac28`.
Verbindlich fuer die Kette **OC-P1 .. OC-P3**. Jede Bauanweisung liegt in
`tasks/oc-p<N>-spec.md` und ist allein tragfaehig.

Praemisse dieses Plans: **das Produkt ist nicht gelauncht, alle aktiven Accounts gehoeren
uns** (Owner + Jonas). Diese Praemisse traegt genau EINE Entscheidung (Abschnitt 5) und
faellt mit dem Launch — der Nachruest-Eintrag dazu steht in Abschnitt 5.4.

**Korrektur 2026-08-20 nach Review (verbindlich):** die Praemisse ist ein TAGESZUSTAND,
kein Gate. Selbst-Registrierung, Abo und KYC sind live; jeder eingeloggte Tenant darf
heute per `POST /api/self-service/private-number` (`src/self-service-routes.js:401`, nur
`webAuthMw`) jede format-/land-gueltige Nummer eintragen. Es HAT bis heute kein Dritter
getan — es KANN aber jeder. Deshalb wird die Praemisse in dieser Kette in Code gegossen
statt behauptet: die Ausnahme greift nur fuer ausdruecklich gepinnte Tenant-IDs
(`OWNER_SELF_CALL_TENANT_IDS`, Abschnitt 3.6). Leere Liste = niemand.

---

## 0. Kurzfassung

Ein Tenant hinterlegt eine eigene private Rufnummer. Ruft Hermes **genau diese** Nummer
outbound an, dann

1. entfaellt der lange Offenlegungssatz (die Eroeffnung bleibt **KI-identifizierend**:
   "Hallo <Vorname>, hier ist dein KI-Assistent." — s. 1.4), und
2. weiss der Agent, dass die Gegenstelle der Auftraggeber selbst ist, und spricht ihn
   direkt an, und
3. faellt er sofort in den vollstaendigen Offenlegungssatz zurueck, wenn sich zeigt, dass
   am Apparat NICHT der Auftraggeber ist (1.4).

Bei jedem anderen Ziel bleibt alles exakt wie heute.

Der Kern ist ein **serverseitiges, reines Praedikat** ueber dem bereits normalisierten
Anrufziel, EINMAL entschieden, auf dem Anruf-Datensatz festgeschrieben, von allen Engines
gelesen. Kein Client-Flag, kein KI-Ermessen, kein globaler Ausschalter fuer die
Offenlegung.

| Phase | Titel | Datei | Risikoklasse |
|---|---|---|---|
| OC-P1 | Praedikat, Persistenz, Schalter | `tasks/oc-p1-spec.md` | mittel |
| OC-P2 | Wirkung auf dem Live-Pfad (ElevenLabs) | `tasks/oc-p2-spec.md` | hoch |
| OC-P3 | Gleichlauf der uebrigen Outbound-Wege | `tasks/oc-p3-spec.md` | mittel |

Die Live-Schaltung ist KEINE Code-Phase, sondern Abschnitt 8 (Runbook).

---

## 1. Kontext und Owner-Entscheidung

### 1.1 Warum ueberhaupt

Der Offenlegungssatz erfuellt Artikel 50 EU AI Act: wer mit einer KI spricht, muss es
wissen. Gegenueber dem Auftraggeber selbst leistet der Satz das nicht — er teilt ihm
etwas mit, das er per Definition schon weiss, und er teilt es ihm ueber seinen EIGENEN
Assistenten mit. Der Beispiel-Anwendungsfall des Auftrags (morgendliches Briefing durch
den eigenen Assistenten) macht daraus eine absurde Eroeffnung:

> "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Antonio Fotiadis Francisco.
> Das Gespräch wird für meinen Auftraggeber zusammengefasst."
> — gesprochen zu Antonio Fotiadis Francisco.

Beide Saetze sind gegenueber dem Owner nicht nur ueberfluessig, der zweite ist irrefuehrend
("mein Auftraggeber" ist der Zuhoerer).

### 1.2 Die Entscheidung

**Owner-Entscheidung 2026-08-20 (OC).** Der lange Offenlegungssatz bekommt eine ENGE,
serverseitig entschiedene Ausnahme: er entfaellt genau dann, wenn das bereits
normalisierte Anrufziel EXAKT der beim ANRUFENDEN Tenant hinterlegten eigenen Nummer
entspricht UND dieser Tenant ausdruecklich gepinnt ist (3.6). Die KI-Kennzeichnung selbst
entfaellt nie (1.4). Jede Unsicherheit, jedes Fehlen, jeder Fehler im Praedikat fuehrt zur
Offenlegung wie heute.

### 1.3 Textbaustein fuer CLAUDE.md, Absolute Regel 2

Der folgende Block wird in `CLAUDE.md` unter Punkt 2 (**OFFENLEGUNG**) eingefuegt. Er ist
Teil der Abnahme von OC-P2 (nicht frueher: vorher wirkt die Ausnahme nirgends). Wortlaut
zur woertlichen Uebernahme:

```markdown
   **Owner-Entscheidung 2026-08-20 (OC): der Offenlegungssatz entfaellt bei einem Anruf an
   die eigene hinterlegte Nummer des anrufenden Tenants — und NUR dort; die
   KI-Kennzeichnung entfaellt dabei NICHT.** Eine Offenlegung
   gegenueber sich selbst leistet nichts: Artikel 50 EU AI Act schuetzt den Menschen, der
   nicht weiss, dass er mit einer KI spricht. Der Auftraggeber, dessen eigener Assistent
   ihn auf seiner eigenen hinterlegten Nummer anruft, ist dieser Mensch nicht. Der zweite
   Halbsatz ("Das Gespraech wird fuer meinen Auftraggeber zusammengefasst") ist ihm
   gegenueber sogar irrefuehrend — der Auftraggeber ist der Zuhoerer.

   Die Ausnahme ist ENG und fail-closed. Sie greift ausschliesslich, wenn ALLE folgenden
   Bedingungen gleichzeitig erfuellt sind, serverseitig geprueft, VOR dem Waehlen, einmal
   je Anruf und danach unveraenderlich am Anruf-Datensatz (`call.calleeIsOwner`):

   | Bedingung | Quelle |
   |---|---|
   | Der Tenant hat eine eigene Nummer hinterlegt | `store.tenantPrivateNumber(tenantId)` |
   | Das Ziel ist normalisiert | `ctx.to` nach dem `normalize_target`-Gate |
   | Ziel und eigene Nummer sind als E.164-String **exakt** gleich | `src/callee-is-owner.js` |
   | Der ANRUFENDE Tenant ist ausdruecklich gepinnt | `OWNER_SELF_CALL_TENANT_IDS` (Default leer = niemand) |
   | Der Schalter ist an | `OWNER_SELF_CALL_ENABLED` (Default `false`) |

   Alles andere ergibt Offenlegung: kein Treffer, fehlende Nummer, fehlender Tenant,
   nicht gepinnter Tenant, Praedikat-Fehler, Schalter aus, alter Anruf-Datensatz ohne das
   Feld. Der Vergleich ist strikte String-Gleichheit — kein Praefix-Match, kein Fuzzy,
   keine Normalisierung im Praedikat selbst (die ist vorgelagert und geteilt).

   **Was die Ausnahme NICHT tut: sie schaltet die KI-Kennzeichnung nicht ab.** Was
   entfaellt, ist der lange Dritt-Satz ("im Auftrag von ... wird zusammengefasst"). Die
   Owner-Eroeffnung nennt die Maschine weiterhin beim Namen ("hier ist dein
   KI-Assistent"). Grund: das Praedikat beweist, dass die gewaehlte NUMMER die hinterlegte
   Nummer des Tenants ist — nicht, dass die PERSON am Apparat der Auftraggeber ist. Ein
   Festnetz- oder Gemeinschaftsanschluss ist als eigene Nummer zulaessig
   (`normalizePrivateNumber` prueft E.164-Form, Denylist und Laendercode, sonst nichts,
   `src/store/state-ops.js:2127-2136`). Nimmt dort jemand anderes ab, muss der erste Satz
   trotzdem sagen, dass eine KI spricht.

   **Pflicht-Rueckfall im Anrufmoment:** stellt sich im Gespraech heraus, dass am Apparat
   nicht der Auftraggeber ist, spricht der Agent SOFORT den vollstaendigen
   Offenlegungssatz (Wortlaut aus `LOCALES.<lang>.disclosure`) und fuehrt das Gespraech im
   Dritt-Modus weiter. Diese Anweisung steht in JEDEM Owner-Prompt-Baustein (EL-Weg wie
   Budget-/Telnyx-Weg) und ist nicht optional.

   **Was NICHT erlaubt ist und nie erlaubt wird:** kein Client-Flag und kein
   MCP-Parameter entscheidet darueber (der Aufrufer nennt nur `to`, den Rest entscheidet
   der Server); kein KI-Ermessen ueber das Praedikat (das Praedikat ist rein, das Modell
   sieht nur das Ergebnis); kein Setting, das die Offenlegung fuer Dritte abschaltet;
   keine zweite Stelle, die dieselbe Frage noch einmal beantwortet.

   **Preis, bewusst akzeptiert:** die hinterlegte eigene Nummer ist heute Format- und
   land-validiert, aber NICHT eigentums-verifiziert (`normalizePrivateNumber`,
   `src/store/state-ops.js:2127-2136`), und sie ist ueber
   `POST /api/self-service/private-number` von JEDEM eingeloggten Tenant setzbar
   (`src/self-service-routes.js:401`, nur `webAuthMw`). Wer eine fremde Nummer hinterlegt,
   erreichte damit einen KI-Anruf ohne den vollen Offenlegungssatz an einen Dritten.
   Deshalb ist die Ausnahme zusaetzlich an eine ausdrueckliche Tenant-Allowlist gebunden:
   ein nicht gepinnter Account kann sie nicht ausloesen, egal was er eintraegt. Die
   Besitz-Verifikation ist als Launch-Blocker in `PLAN-SECURITY.md` eingetragen. Wird der
   Eintrag dort geschlossen, ohne dass die Verifikation gebaut ist, ist DIESE Ausnahme
   zurueckzunehmen — nicht der Eintrag.
```

### 1.4 Die Restluecke, die das Praedikat NICHT schliesst (Person != Nummer)

Das Praedikat beweist eine Aussage ueber eine NUMMER. Der Rechtssatz "der Mensch am
Apparat weiss, dass er mit einer KI spricht" ist eine Aussage ueber eine PERSON. Zwischen
beiden liegt der gutglaeubige Normalfall: der Auftraggeber hat seinen Festnetz- oder
Familienanschluss als eigene Nummer hinterlegt, und es geht jemand anderes ran.

Dieser Fall ist KEIN Missbrauchsfall (Abschnitt 5) und wird deshalb nicht dort behandelt,
sondern hier — mit drei Textmassnahmen, die die UX nichts kosten:

1. **Die Owner-Eroeffnung identifiziert die Maschine.** Verbindliche Wortlaute (gesprochene
   Strings, DE mit echten Umlauten, wo welche vorkommen):

   | Sprache | Wortlaut |
   |---|---|
   | `de` | `Hallo ${firstName}, hier ist dein KI-Assistent.` |
   | `fr` | `Bonjour ${firstName}, c'est ton assistant IA.` |
   | `en` | `Hi ${firstName}, it's your AI assistant.` |

   Das Wort "Assistent" allein genuegt nicht: es identifiziert keine Maschine. "KI" bzw.
   "AI"/"IA" ist der tragende Teil und darf in keiner Sprachvariante wegfallen.
2. **Pflichtzeile im Owner-Prompt-Block, auf JEDEM Weg** (OC-P2 2.2 fuer den EL-Prompt,
   OC-P3 2.2 fuer `systemPrompt`): ist die Person am Apparat nicht der Auftraggeber, wird
   der vollstaendige Offenlegungssatz sofort gesprochen und im Dritt-Modus weitergefuehrt.
   Der Satz wird dem Modell **fertig** mitgegeben (aus `LOCALES.<lang>.disclosure`), nicht
   umschrieben — kein Modell-Ermessen ueber den Wortlaut einer Rechtspflicht.
3. **Pre-Mortem 7.9** haelt das Szenario als benanntes Risiko fest.

Damit gilt fuer JEDEN Ausgang: entweder der Zuhoerer ist der Auftraggeber (er weiss es
ohnehin und hoert es zusaetzlich in Kurzform), oder er ist es nicht (dann hoert er zuerst
die Kurzform und danach den vollen Satz). Es gibt keinen Ausgang, in dem ein ahnungsloser
Mensch eine Maschine fuer einen Menschen halten kann.

---

## 2. Begriffe (verbindlich)

Im Bestand heisst **"Owner-Call"** bereits etwas anderes: ein Anruf, der dem
Owner-*Tenant* (`BOOTSTRAP_TENANT_ID`) gehoert — so verwendet in
`test/claude-identity.test.js:57`, `test/i9-self-service.test.js:90`,
`test/read-scope-tenant.test.js`, `test/tenant-erasure*.test.js`. Das ist NICHT dieser
Sachverhalt. Zwei Sachverhalte auf einem Label sind in diesem Repo schon einmal teuer
geworden (Memory `live-cost-tracing-chain-complete`: "nie 2 Sachverhalte auf 1 Label").

Deshalb gilt fuer den gesamten Code dieser Kette:

| Begriff | Bedeutung | Verboten |
|---|---|---|
| `calleeIsOwner` | Die GEGENSTELLE dieses Anrufs ist der Auftraggeber selbst | `ownerCall`, `isOwnerCall`, `selfCall` |
| `callee_is_owner` | dieselbe Sache als Postgres-Spalte | — |
| `{{callee_relation}}` | die daraus abgeleitete Prompt-Sektion (Text, nicht Boolean) | — |
| "Owner-Call" | BESTANDSBEGRIFF: Anruf des Owner-Tenants | in NEUEM Code gar nicht verwenden |

Der Dateiname dieses Plans (`PLAN-OWNER-CALL.md`) traegt den Auftragsnamen und bleibt so;
im Code gilt die Tabelle.

---

## 3. Architektur des Praedikats

### 3.1 Ein Modul, ein Vergleich

Neues, **reines** Modul `src/callee-is-owner.js` — kein Store, kein `config`, kein IO,
kein Import ausser Node-Builtins. Vorbild und Nachbar: `src/diagnostic-retention.js`
(dessen Modulkopf genau diese Bauart begruendet).

```
export function calleeIsOwner({ to, ownNumber })
export function ownerSelfCallGranted({ to, ownNumber, tenantId, enabled, allowedTenantIds })
```

`calleeIsOwner` liefert `true` nur bei: beide Werte nicht-leere Strings UND
`to === ownNumber`. Alles andere `false`. Keine Ausnahme, kein Wurf, kein Log.

`ownerSelfCallGranted` ist die vollstaendige Bedingung dieses Plans, an EINER Stelle und
ebenfalls rein (die Werte werden hereingereicht, das Modul importiert kein `config`):

```
enabled === true  &&  tenantId ist in allowedTenantIds  &&  calleeIsOwner({ to, ownNumber })
```

Warum zwei Exporte statt einem: `diagnostic-retention.js` braucht NUR den Nummern-
Vergleich und darf nicht am Offenlegungs-Schalter haengen (sonst faellt mit dem Flag-Flip
still ein Bestandsfeature aus, s. 5.3). `api-calls.js` braucht NUR die vollstaendige
Bedingung und darf sie nicht selbst zusammensetzen (sonst gibt es zwei Wahrheiten
darueber, was "Owner-Anruf" heisst). Eine Datei, ein Vergleich, zwei klar benannte
Zugaenge.

**Warum ein eigenes Modul und keine Erweiterung von `diagnostic-retention.js`:** die
Diagnose-Retention entscheidet, ob ein Transkript laenger liegen bleibt. Das hier
entscheidet, ob ein gesetzlicher Pflichtsatz gesprochen wird. Zwei Risikoklassen, zwei
Module — aber EIN Vergleich.

**Deshalb wird `diagnosticRetentionGranted` auf dieses Modul umgestellt**
(`src/diagnostic-retention.js:52`, heute `Boolean(ownNumber) && to === ownNumber`).
Verhalten byte-identisch; der Gewinn ist, dass es ab dann strukturell unmoeglich ist,
dass die zwei Vergleiche auseinanderlaufen (z.B. weil jemand einen davon
gross-/kleinschreibungs-tolerant macht). G5, eine Quelle.

### 3.2 Wo das Praedikat ausgewertet wird — genau einmal

In `src/routes/api-calls.js`, **nach der Gate-Schleife** (heute Zeile 161-172), direkt
neben dem bereits existierenden, strukturgleichen `diagnosticRetentionGranted`-Aufruf
(Zeile 190-199). An dieser Stelle und nur dort:

- `ctx.to` ist normalisiert (`normalize_target`, `src/telephony/outbound-gates.js:584-601`),
- `ctx.tenantId` steht fest (`resolve_identity` / `tenant_reject`),
- der Anruf ist durch ALLE Safety-/Geld-Gates.

**Kein neues Gate.** Die Gate-Kette ist reihenfolge-gepinnt
(`test/outbound-gates-order.test.js`) und ihre Glieder lehnen ab; dieses Praedikat lehnt
nie ab. Es waere kein Gate, sondern eine Verbreiterung der Kette — dieselbe Begruendung,
die der Bestandskommentar an `diagnostic` bereits fuehrt (`src/routes/api-calls.js:195-198`).

### 3.3 Warum das Ergebnis persistiert wird

`call.calleeIsOwner` wird in `createCall` gesetzt und danach nie mehr geschrieben.

Alternative waere: jede Engine rechnet selbst nach. Verworfen, aus drei Gruenden.

1. **Zeitliche Stabilitaet.** Zwischen `POST /api/calls` und dem tatsaechlichen Klingeln
   liegt die Eroeffnungszeilen-Erzeugung, das Pre-Call-Briefing und der Anrufstart. Ein
   Tenant, der in diesem Fenster seine private Nummer aendert (`POST
   /api/self-service/private-number`), wuerde eine zweite Auswertung kippen lassen — in
   BEIDE Richtungen.
2. **Eine Entscheidung, ein Beleg.** Der Wert steht am Datensatz und ist nachtraeglich
   pruefbar (Dashboard, Art.-15-Export, Forensik). Eine nur fluechtig berechnete
   Entscheidung ueber eine Rechtspflicht hinterlaesst keine Spur.
3. **Alle Engines lesen dasselbe.** Der `else`-Zweig (Budget/TeXML) haengt an KEINEM Flag
   (`src/routes/api-calls.js:322-338`) — faellt ElevenLabs aus, faehrt jeder Outbound dort
   hinein. Ein zweiter Rechenweg dort waere ein Blindfleck genau im Rueckfall.

**Fail-closed beim LESEN:** jeder Verbraucher prueft strikt `call.calleeIsOwner === true`.
`undefined` (alter Datensatz, JSON-Store-Roundtrip, fremde Quelle) heisst NICHT-Owner
heisst Offenlegung.

### 3.4 Verbraucherliste (vollstaendig, Stand `ec2ac28`)

| Verbraucher | Datei | Wirkung bei `true` | Phase |
|---|---|---|---|
| EL-Anrufstart, `first_message` | `src/elevenlabs/outbound.js` (`startCallBody`) | Owner-Eroeffnung statt Offenlegungs-Rahmen | OC-P2 |
| EL-Prompt-Sektion | `src/elevenlabs/outbound.js` (`dynamicVariables`) | `{{callee_relation}}` traegt den Owner-Block | OC-P2 |
| EL-Whitelist-Waechter | `src/elevenlabs/convai.js` | erlaubt `agent.first_message` NUR dann | OC-P2 |
| EL-Rueckfrage-Tor | `src/elevenlabs/outbound.js` (`consultAllowed`) | `unavailable` (niemand zum Rueckfragen) | OC-P2 |
| Erst-Turn Budget/TeXML + C-Telnyx | `src/claude.js` (`openingText`) | Owner-Eroeffnung statt Offenlegung+Bruecke | OC-P3 |
| Systemprompt (Budget + Realtime + Shim) | `src/claude.js` (`systemPrompt`) | Owner-Persona statt Dritt-Persona | OC-P3 |
| Realtime-Opener | `src/bridge.js:222-227` | **bewusst unveraendert** — s. 3.5 | — |

### 3.5 Bewusst nicht angefasst: `disclosureSentence` und der Realtime-Opener

`disclosureSentence(call)` (`src/claude.js:392-397`) bleibt **unbedingt**. Es ist der
Wortlaut-Lieferant, nicht die Entscheidung, ob gesprochen wird. Die Verzweigung sitzt
ausschliesslich bei den Zusammensetzern (`openingText`, EL-`first_message`). Damit gilt
weiter: wer `disclosureSentence` aufruft, bekommt den Satz — es gibt keine Variante, die
"" liefert.

`src/bridge.js:222-227` (Realtime-Opener) ruft `disclosureSentence` und bleibt
unveraendert. Realtime ist am Telnyx-Provider produktiv blockiert (Memory
`voice-stack-strategy`) und `VOICE_ENGINE` steht auf `budget`. Wuerde der Zweig doch
fahren, bekaeme der Owner eine ueberfluessige Offenlegung — die HARMLOSE Richtung. Kein
Overengineering fuer einen toten Pfad; die Richtung des Fehlers ist benannt und
akzeptiert. Die Persona dort folgt `systemPrompt` und wird in OC-P3 automatisch
mit-korrekt — das ist Beifang, keine Zusage.

### 3.6 Der Schalter — und die Tenant-Allowlist

Zwei neue Env-Variablen, beide **fail-closed per Default**, beide im Namespace
`voice` (`src/config.js:1917`):

| Variable | Typ | Default | Bedeutung |
|---|---|---|---|
| `OWNER_SELF_CALL_ENABLED` | Boolean | `false` | der Notaus/Scharfschalter der ganzen Ausnahme |
| `OWNER_SELF_CALL_TENANT_IDS` | Komma-Liste von Tenant-IDs | **leer** | WELCHE Tenants die Ausnahme ueberhaupt ausloesen duerfen |

Beide sitzen IM Praedikat (`ownerSelfCallGranted`, 3.1), nicht davor und nicht an den
Verbrauchern. `false` ODER leere Liste heisst `calleeIsOwner === false` fuer jeden Anruf,
also Offenlegung ueberall — das exakte Bestandsverhalten. Damit sind OC-P1..OC-P3 einzeln
mergebar und einzeln deploybar, ohne dass sich live irgendetwas aendert; die
Scharfstellung ist ein Flag-Flip im Render-Dashboard (Abschnitt 8) und ebenso ein Rueckzug
ohne Deploy.

**Warum ZWEI Schalter und nicht einer.** Sie beantworten verschiedene Fragen und werden
von verschiedenen Ereignissen gedreht. Der Boolean ist die ENTSCHEIDUNG ("Feature an/aus")
und der Notaus, der in einer Minute gefunden werden muss. Die Liste ist DEPLOYMENT-DATEN
("fuer wen gilt die Vor-Launch-Ausnahme") und waechst/schrumpft mit unseren eigenen
Accounts. Beide sind Konjunktion, beide fail-closed — es gibt keinen Zustand, in dem einer
den anderen aufweicht.

**Warum die Liste ueberhaupt existiert (das ist der Kern, nicht Beiwerk).** Ohne sie waere
die einzige Absicherung des akzeptierten Risikos ein Mensch, der sich an einen Env-Flip
erinnert: `POST /api/self-service/private-number` haengt allein hinter `webAuthMw`
(`src/self-service-routes.js:401`), Selbst-Registrierung ist live, und keine Zeile Code
wuerde einen fremden Account bemerken, waehrend `OWNER_SELF_CALL_ENABLED=true` steht. Mit
der Liste kann ein fremder Account die Ausnahme strukturell nicht ausloesen — er ist nicht
darin. Das ist die operative Form des akzeptierten Risikos, in Code statt in einer Notiz.

Bewusst NICHT gebaut: ein Boot-/Laufzeit-Waechter, der "fremde Tenants" ZAEHLT und den
Schalter dann selbst umlegt. Er muesste den Store scannen, koennte einen erst nach dem
Boot entstandenen Tenant nur mit einer zweiten periodischen Pruefung sehen und beantwortet
am Ende eine schwaechere Frage ("gibt es Fremde?") als die Allowlist ("wer darf?"). Eine
Allowlist ist gegen genau diese Fehlerklasse die einfachere und schaerfere Antwort
(Memory `streaming-armierung-allowlist`: eine Allowlist BLEIBT eine Allowlist, sonst ist
sie fail-open).

Beim Launch verschwindet die Liste nicht ersatzlos, sondern wird von der Besitz-
Verifikation (5.3) abgeloest: der Pin am Tenant-Record (`privateNumberVerifiedAt`) ist
dieselbe Aussage, nur pro Tenant verdient statt von Hand vergeben.

Pflichtstellen je Variable (alle vier, sonst driftet es): `src/config.js` (Wert +
`CONFIG_NAMESPACES`-Eintrag unter `voice`), `.env.example`, `render.yaml`, `test/helpers.js`
`BASE_ENV` (Memory `test-base-env-drift`: eine neue Env-Variable ohne `BASE_ENV`-Pin
laesst die lokale `.env` in jeden Spawn-Test lecken).

`render.yaml`: **beide** mit `sync: false` — Muster `ELEVENLABS_AGENT_ID`
(`render.yaml:106-107`), NICHT `ELEVENLABS_OUTBOUND_ENABLED` (das traegt
`value: "false"`, `render.yaml:103-104`). Der Unterschied ist nicht kosmetisch: ein im
Blueprint gepinnter Wert wird von einem Blueprint-Sync ueber das im Dashboard gedrehte
`true` zurueckgeschrieben — der Rueckzugsweg 8.5 und der Scharfschaltweg 8.3/Schritt 5
laufen beide ueber das Dashboard.

### 3.7 Kommentare, die durch diese Kette still veralten (Nachzieh-Pflicht)

Drei Bestandskommentare behaupten nach dieser Kette etwas Falsches. Jeder ist einer Phase
zugewiesen; "faellt beim Lesen auf" ist keine Zuweisung.

| Stelle | heutige Aussage | Wer zieht nach |
|---|---|---|
| `src/elevenlabs/outbound.js:693` | "Es sind genau die zwoelf" (dynamische Variablen) | OC-P2 (werden dreizehn) |
| `src/elevenlabs/call-locale.js:105-108` | "`agent.first_message` steht NICHT auf der weissen Liste (convai.js) und darf es nicht" | OC-P2 — genau das dreht die Phase um; der Kommentar muss die neue, engere Wahrheit sagen (erlaubt NUR im Owner-Kontext, `OVERRIDE_OWNER_ONLY_LEAF_PATHS`). Die Funktion `providerOpeningFor` selbst bleibt unveraendert; die Ausnahme betrifft nur diesen Kommentar |
| `_besitz.felder[feld=conversation_config_override_erlaubnisse]._hinweis` in der Vorlage | "ZWEI ABWEICHUNGEN VOM LIVE-ZUSTAND (tts.voice_id, conversation.text_only)" | OC-P2, **aber erst nach lesender Messung** — der Drift-Lauf vom 2026-08-20 meldete 38/38 mit nur `retention_days`/`record_voice` (`tasks/gq-chain-state.md:1612-1620`), der Hinweis ist also vermutlich ueberholt |

Der dritte Punkt ist runbook-relevant und nicht nur Kosmetik: der Push schreibt die GANZE
Karte (`scripts/push-elevenlabs.mjs`, Kopfkommentar: "Dict- und Listenfelder ERSETZT es").
Stimmt der Hinweis doch noch, flippt derselbe Push zusaetzlich `tts.voice_id` — und unser
Code sendet `tts.voice_id` bereits bei jedem Anruf (`src/elevenlabs/outbound.js`,
`conversationConfigOverride`). Das waere eine Stimm-Aenderung fuer ALLE Anrufe im selben
Zug. Deshalb steht im Runbook (8.3, Schritt 1b) eine LESENDE Messung der Live-Karte VOR
dem Push (Memory `provider-config-needs-doc-before-diagnosis`: erst GET + Schnappschuss,
dann patchen).

---

## 4. Datenmodell

### 4.1 Feld-Wiederverwendung `private_number`: JA

Entschieden: die Ausnahme haengt am **bestehenden** `tenant.privateNumber` /
`tenant.private_number`. Kein zweites Nummernfeld.

**Dafuer:**

- Es ist bereits das Feld "meine eigene Nummer" und wird bereits so gelesen: SMS-Ziel der
  Anruf-Zusammenfassung (`src/sms-summary.js:26`), Heimatland-Anker der
  Ziel-Normalisierung (`src/telephony/outbound-gates.js:592`) und — entscheidend — bereits
  heute als **exakter Ziel-Vergleich** fuer die Diagnose-Retention
  (`src/diagnostic-retention.js:52`). Genau dieselbe Frage, dieselbe Antwort.
- Es hat genau zwei authentifizierte Schreibwege mit EINER gemeinsamen
  Validierungsquelle: `POST /api/self-service/private-number` (`webAuthMw`,
  `src/self-service-routes.js:401-414`) und `POST /api/onboard` (`webAuthMw`+`adminMw`,
  `src/routes/api-onboard.js:150-163`), beide ueber `normalizePrivateNumber`
  (`src/store/state-ops.js:2127-2136`). **Achtung, das ist KEINE Zugangsbeschraenkung:**
  der Self-Service-Weg steht jedem eingeloggten Tenant offen. "Zwei Schreibwege" heisst
  hier "eine Validierungsquelle", nicht "wenige Schreiber".
- Es lebt am Tenant-Record und ausdruecklich NICHT in `settings` (H4: `settings` leakt
  vollstaendig ueber `/api/state` und MCP). Ein Nummernfeld, das ueber MCP sichtbar
  waere, duerfte diese Entscheidung nicht tragen.
- Ein zweites Feld waere zwei Wahrheiten ueber dieselbe Nummer, mit dem sicheren Ergebnis,
  dass eines davon irgendwann veraltet.

**Dagegen — und das ist real:** das Feld wechselt die Risikoklasse. Bis heute steuert es
Bequemlichkeit (wohin die SMS geht, welches Land beim Normalisieren angenommen wird) und
eine Datenschutz-Feinheit (Retention). Ab OC-P2 steuert es die Erfuellung einer
gesetzlichen Pflicht. Ein falscher Wert kostete bisher eine SMS am falschen Ort; danach
kostet er eine unterlassene Offenlegung.

**Konsequenzen, die daraus PFLICHT werden (Teil von OC-P1):**

1. Der bestehende Aenderungs-Audit-Pfad bleibt und wird belegt: `outcome=set|cleared|rejected`,
   nie der Wert (`src/self-service-routes.js:412`). Ein Test pinnt, dass die Nummer
   weiterhin nicht ins Audit-Log gelangt.
2. Der Wert verlaesst den Server weiterhin nur maskiert (`maskPrivateNumber`,
   `src/self-service-routes.js:324`). Kein neuer Leser darf ihn roh ausliefern; insbesondere
   erscheint auf dem Anruf-Datensatz nur der **Boolean**, nie die Nummer.
3. Die Dashboard-Oberflaeche muss sagen, was das Feld jetzt zusaetzlich bewirkt (Text in
   `apps/web/src/components/app/SettingsIsland.astro`). Ein Feld, dessen Wirkung sich
   verdoppelt, ohne dass die Beschriftung es sagt, ist eine Falle. **Scope OC-P3.**

### 4.2 Neues Feld am Anruf: `calleeIsOwner`

| Ebene | Name | Typ | Default |
|---|---|---|---|
| Call-Record (beide Backends) | `calleeIsOwner` | Boolean | `false` |
| Postgres | `call.callee_is_owner` | `BOOLEAN NOT NULL DEFAULT FALSE` | `FALSE` |

Muster woertlich `diagnostic`: `src/db/schema.sql:270` (Tabellendefinition) **und**
`src/db/schema.sql:377` (`ALTER TABLE call ADD COLUMN IF NOT EXISTS ...` — die Migration
laeuft beim Boot, Memory `no-automatic-db-migration`), Zeilen-Mapper `src/store/pg.js:1358`
(`r.diagnostic === true`), Insert-Bind `src/store/pg.js:1752`, Spaltenliste
`src/store/pg.js:1851`.

`NOT NULL DEFAULT FALSE` ist die fail-closed Form: ein Bestands-Anruf und jede Zeile, die
den Wert nicht mitbringt, ist NICHT-Owner. Deshalb braucht dieses Feld — anders als die
DID-Miete (Memory `did-miete-ohne-preis`) — **keinen Backfill**: der Default IST die
richtige Antwort fuer alles Alte.

`publicCall` (`src/store/views.js:28-47`) ist eine Denylist-Projektion. Das Boolean
erscheint dort automatisch. Das ist gewollt (es traegt keine PII, und es erklaert dem
Nutzer, warum dieser eine Anruf anders klang) und wird von einem Test festgehalten —
zusammen mit der Zusage, dass die Nummer selbst NICHT mitkommt.

---

## 5. Die Verifikationsfrage

### 5.1 Befund

Es existiert **keine** Mechanik, die belegt, dass die hinterlegte Nummer dem Tenant
gehoert. `normalizePrivateNumber` prueft E.164-Form, Denylist (Notruf/Premium) und
Laendercode-Allowlist — mehr nicht (`src/store/state-ops.js:2127-2136`). Insbesondere
gibt es **keine** Mobilfunk-Beschraenkung und keinen Geraetebezug: ein Festnetz- oder
Gemeinschaftsanschluss ist zulaessig (deshalb 1.4). Das Wort
"verifiziert" im Bestandskommentar (`src/diagnostic-retention.js:44`) meint genau diese
Format-/Land-Validierung; das "Verifikations-Gate" in
`src/telephony/outbound-gates.js:279-289` prueft die Berechtigung des TENANTS
(Abo + KYC), nicht das Eigentum an einer Zielnummer.

Heute kann ein Tenant jede zulaessige E.164-Nummer eintragen, auch eine fremde.

### 5.2 Entscheidung

**Variante (b): dokumentiertes, begruendetes akzeptiertes Risiko fuer die Vor-Launch-Phase,
mit hartem Nachruest-Eintrag in `PLAN-SECURITY.md` als Launch-Blocker.**

Begruendung, in dieser Reihenfolge:

1. **Das Risiko ist heute leer — als Tageszustand, nicht als Struktur.** Alle aktiven
   Accounts gehoeren uns (Memory `no-existing-customers-premise`). Es HAT bis heute kein
   Dritter eine fremde Nummer eingetragen. **Falsch waere der Satz "es gibt keinen
   Dritten, der es koennte":** `POST /api/self-service/private-number` haengt allein
   hinter `webAuthMw` (`src/self-service-routes.js:401`), Selbst-Registrierung, Abo und
   KYC sind live (Memory `tenant-number-proliferation`,
   `outbound-anyone-autonomous-numbers`). Jeder eingeloggte Tenant darf jede format-/
   land-gueltige Nummer setzen. Genau deshalb steht das akzeptierte Risiko in dieser Kette
   nicht auf einer Erinnerung, sondern auf der Tenant-Allowlist `OWNER_SELF_CALL_TENANT_IDS`
   (3.6): ein nicht gepinnter Account loest die Ausnahme nicht aus, egal was er eintraegt.
2. **Zwei weitere Gates stehen ohnehin davor.** Outbound setzt Abo + KYC voraus
   (`src/store/state-ops.js:1149`, `src/billing/activation.js:87`,
   `src/telephony/outbound-gates.js:317`). Der Missbrauchsfall verlangt also einen
   zahlenden, KYC-gereiften Account — nicht einen Wegwerf-Login. Und
   `normalizePrivateNumber` sperrt vorab Notruf-/Premium-Bereiche und fremde Laender.
3. **Die Verifikation ist eine eigene, ehrliche Phase — keine Beilage.** Ein
   SMS-Bestaetigungscode braucht Zustellung, Frist, Wiederholungs-Deckel,
   Missbrauchs-Ratelimit, eine Re-Verifikations-Regel bei Aenderung und ein
   Verfallsdatum. Das in OC-P1 mit hineinzuschieben, waere die halbgare Variante beider
   Aufgaben.

**Empfehlung in drei Saetzen:** Die Ausnahme jetzt mit dem unverifizierten Feld bauen,
aber hart auf gepinnte Tenant-IDs beschraenken (3.6) — dann hat das Missbrauchs-Szenario
vor dem Launch nicht nur keinen Akteur, sondern auch keinen Pfad, und die Kosten einer
verfruehten, halben Verifikation entfallen. Die Besitz-Verifikation per SMS-Code an genau
diese Nummer als eigene Phase VOR dem ersten gepinnten fremden Account bauen — der
Transportweg existiert bereits (`src/sms-summary.js` mit Tages-Deckel), der Format-/Land-
Filter ist die natuerliche Vorstufe, und der Pin am Tenant-Record loest die Env-Liste dann
ab. Bis dahin gilt: **kein Tenant kommt in `OWNER_SELF_CALL_TENANT_IDS`, der nicht uns
gehoert**, und `OWNER_SELF_CALL_ENABLED` ist der Notaus darueber — das ist die operative
Form des akzeptierten Risikos, und sie steht in Code, nicht in einer Erinnerung.

### 5.3 Skizze der spaeteren Verifikations-Phase (NICHT Teil dieser Kette)

Nur damit die Nachruestung nicht bei null anfaengt: `tenant.privateNumberVerifiedAt`
(Zeitstempel, nullable) + Code-Versand an die zu verifizierende Nummer + Bestaetigungs-Route;
das Praedikat aus 3.1 bekommt eine dritte Bedingung (`verifiedAt` gesetzt); jede Aenderung
der Nummer loescht den Zeitstempel. Die Diagnose-Retention bleibt bewusst an der
UNverifizierten Form haengen (dort ist die Fehlerfolge eine laenger liegende eigene
Transkript-Kopie, keine Rechtsverletzung) — sonst faellt mit der Verschaerfung still ein
Bestandsfeature aus.

### 5.4 Pflicht-Eintrag in `PLAN-SECURITY.md` (Teil der Abnahme von OC-P2)

```markdown
### Offen (Launch-Blocker): Besitz-Verifikation der eigenen Nummer

Seit der Owner-Entscheidung 2026-08-20 (OC, s. CLAUDE.md Regel 2) entscheidet
`tenant.privateNumber` darueber, ob der volle Offenlegungssatz gesprochen wird. Das Feld
ist Format- und land-validiert (`normalizePrivateNumber`, `src/store/state-ops.js:2127`),
aber NICHT eigentums-verifiziert, und es ist ueber
`POST /api/self-service/private-number` von JEDEM eingeloggten Tenant setzbar
(`src/self-service-routes.js:401`, nur `webAuthMw`). Wer eine fremde Nummer eintraegt,
erhielte einen KI-Anruf ohne den vollen Offenlegungssatz an einen Dritten (Artikel 50 EU
AI Act, Bussgeld bis 15 Mio. EUR).

Heute verhindert das die Tenant-Allowlist `OWNER_SELF_CALL_TENANT_IDS` (Default leer):
nur ausdruecklich gepinnte Tenants loesen die Ausnahme aus. Das ist eine
Betriebsdisziplin-Schranke, KEINE Verifikation — sie skaliert nicht ueber unsere eigenen
Accounts hinaus.

Akzeptiert AUSSCHLIESSLICH vor dem Launch, solange in der Allowlist ausschliesslich
Accounts stehen, die uns gehoeren.

Bedingung fuer den Launch, alternativ:
(a) Besitz-Verifikation gebaut (Bestaetigungscode an genau diese Nummer, Zeitstempel am
    Tenant, Praedikat haengt daran, Aenderung setzt zurueck), ODER
(b) `OWNER_SELF_CALL_ENABLED=false` — die Ausnahme ist dann wirkungslos und der
    Offenlegungssatz gilt wieder ausnahmslos.

Ein Eintrag eines fremden Accounts in `OWNER_SELF_CALL_TENANT_IDS` vor (a) ist selbst die
Rechtsverletzung, gegen die dieser Eintrag steht. Ein Schliessen dieses Eintrags ohne (a)
oder (b) ebenfalls — es ist kein Aufraeumen.

Unberuehrt davon bleibt die KI-Kennzeichnung: auch im Ausnahmefall nennt die Eroeffnung
die Maschine ("hier ist dein KI-Assistent"), und der Prompt verpflichtet den Agenten, den
vollen Offenlegungssatz sofort nachzuholen, wenn am Apparat nicht der Auftraggeber ist.
```

---

## 6. Phasenplan

Gemeinsame Randbedingungen fuer ALLE Phasen: ESM, kein Build-Step, keine neuen
Dependencies, Doku/Kommentare deutsch OHNE Umlaute — **Ausnahme: gesprochene deutsche
Strings tragen echte Umlaute** (Memory `umlaut-transliteration-root-cause`,
`test/de-umlaut-orthography.test.js`). Neue Tests tragen KEIN Katalog-ID-Praefix
(`package.json` `config.i18nCatalogPattern` — sonst landen sie im `test:gates`-Lauf,
Memory `catalog-id-prefix-misroutes-tests`) und KEIN `ABNAHME-`-Praefix.

**Gemessene Ausgangsstaende (2026-08-20, master `ec2ac28`) — beide Zahlen sind Abnahme-
Anker, nicht Schaetzungen:**

| Bank | Kommando | Ausgangsstand |
|---|---|---|
| Regression | `LLM_PROVIDER=anthropic npm test` | `korrigiert: tests 4909 / pass 4909 / fail 0` |
| Launch-Gates | `npm run test:gates` | `korrigiert: tests 129 / pass 126 / fail 3` (rot ist hier erlaubt) |

Die Gates-Zahl ist der Riegel gegen ein Katalog-ID-Leck: waechst sie, ist ein neuer Test
in die falsche Bank gewandert. Die 3 roten sind Bestand und nicht Sache dieser Kette.

### OC-P1 — Praedikat, Persistenz, Schalter

**SCOPE.** `src/callee-is-owner.js` (neu, rein, zwei Exporte: `calleeIsOwner` und
`ownerSelfCallGranted`); `diagnostic-retention.js` auf den Nummern-Vergleich umgestellt
(verhaltensgleich); Auswertung in `src/routes/api-calls.js` nach der Gate-Schleife;
`calleeIsOwner` als Parameter von `createCall` und als Feld am Record; Postgres-Spalte +
Migration + Mapper + Insert; `OWNER_SELF_CALL_ENABLED` UND `OWNER_SELF_CALL_TENANT_IDS` in
`config.js`, `.env.example`, `render.yaml`, `BASE_ENV`; Tests json UND pg; Nachweis, dass
die Nummer weder ins Audit noch in eine API-Antwort gelangt.

**ENTSCHEIDUNGEN.** Kein neues Gate. Ein Vergleich, ein Modul. Persistiert, nicht
nachgerechnet. Schalter UND Tenant-Allowlist im Praedikat, nicht an den Verbrauchern.
Kein Backfill.

**DATEI-UMFANG, ausdruecklich benannt.** Diese Phase beruehrt rund 13 Dateien
(`callee-is-owner.js`, `diagnostic-retention.js`, `routes/api-calls.js`,
`store/state-ops.js`, `store/pg.js`, `db/schema.sql`, `config.js`, `.env.example`,
`render.yaml`, `test/helpers.js` + Tests) und liegt damit ueber der Faustgrenze von ~10.
Das ist bewusst und nicht teilbar: Schema, Store-Mapper, Route und Env-Verdrahtung sind
EIN Feld — eine Aufteilung erzeugte einen Zwischenstand, in dem ein Feld geschrieben, aber
nicht gelesen wird (oder umgekehrt). Wer die Phase trotzdem teilen will, teilt an der
falschen Naht.

**INVARIANTEN.** Kein gesprochener Text aendert sich — in keiner Sprache, auf keinem Pfad,
bei keinem Schalterstand. `diagnostic` verhaelt sich byte-identisch zum Bestand.

**ABGRENZUNG.** Keine Locale-Texte, keine Prompt-Aenderung, keine EL-Vorlage, kein
`elevenlabs:push`, keine UI.

**ABNAHME.** Siehe `tasks/oc-p1-spec.md` Abschnitt "Abnahme".

**Risikoklasse: mittel** (Store-Schema + Geldpfad-Route beruehrt, aber keine
Verhaltensaenderung nach aussen).

### OC-P2 — Wirkung auf dem Live-Pfad (ElevenLabs)

**SCOPE.** Owner-Eroeffnung je Sprache (de/fr/en, **KI-identifizierend**, 1.4) in
`src/i18n/locales.js`; Owner-Sektion fuer den EL-Prompt in `LOCALES.en.prompt`
**inklusive der Pflicht-Rueckfallzeile aus 1.4**; `first_message`-Uebersteuerung im
EL-Anrufstart, gebunden an `call.calleeIsOwner === true`; kontextabhaengige Whitelist in
`src/elevenlabs/convai.js`; neue dynamische Variable `{{callee_relation}}`; Rueckfrage-Tor
bei Owner-Anrufen auf `unavailable`; EL-Vorlage (Prompt-Platzhalter + Erlaubnis-Karte +
Hinweis als Geschwister, nie in der Karte); die drei Kommentar-Nachzuege aus 3.7;
Tests; CLAUDE.md-Regel-2-Block (1.3); `PLAN-SECURITY.md`-Eintrag (5.4).

**ENTSCHEIDUNGEN.**

- **Uebersteuerung statt zweitem Agenten.** Der Offenlegungssatz bleibt fuer alle anderen
  Anrufe STATISCHER Text beim Anbieter (`first_message` bzw. `language_presets.<lang>`) —
  ein Totalausfall unseres Codes kann ihn Dritten gegenueber nicht entfernen. Nur der
  Owner-Fall sendet eine Uebersteuerung. Ein zweiter, offenlegungsfreier Agent (die
  Alternative) verdoppelte Prompt, Werkzeuge, Vorlage und Drift-Waechter fuer denselben
  Gewinn und truege dasselbe Restrisiko (ein Praedikat-Fehler routet den Fremden zum
  falschen Agenten). Verworfen; als Rueckfall in 8.4 vorgehalten.
- **Der Offenlegungssatz wird NICHT zur Variablen.** Die naheliegende Variante ("mach
  `first_message` zu `{{opening}}` und komponiere alles serverseitig") ist abgelehnt: sie
  verlegt den Art.-50-Anker aus dem statischen Anbieter-Text in unseren Code, und dann
  entfernt ein einziger Kompositionsfehler die Offenlegung fuer JEDEN. Die
  Vorlagen-Begruendung dazu steht bereits im Repo
  (`elevenlabs/agent_configs/outbound-agent.template.json`, `agent._first_message_hinweis`).
- **Erlaubnis-Karte: `agent.first_message` von `false` auf `true`.** Das ist die eine echte
  Konzession dieser Kette (Verlust der anbieterseitigen letzten Schicht). Kompensiert
  durch: (i) die Uebersteuerung wird nur GEBAUT, wenn `calleeIsOwner === true`; (ii) der
  Waechter in `convai.js` bricht den Anrufstart ab, wenn `agent.first_message` ohne
  Owner-Kontext im Koerper steht — das ist STRENGER als der Anbieter (der ignoriert still);
  (iii) ein leerer/blanker Owner-Text fuehrt dazu, dass gar keine Uebersteuerung gesendet
  wird, also der statische Offenlegungs-Rahmen spricht.
- **Richtung des Restfehlers.** Der Anbieter ignoriert nicht freigeschaltete
  Uebersteuerungen still. Fuer den Offenlegungssatz waere das gefaehrlich (er verschwaende
  still) — fuer die Owner-Eroeffnung ist es harmlos: sie verschwindet, die Offenlegung
  bleibt. Diese Asymmetrie ist der Grund, warum dieser Weg vertretbar ist.
- **Ungeklaert und bewusst offen gelassen: Vorrang zwischen `language_presets` und der
  Uebersteuerung.** Fuer `de`/`fr` traegt die Vorlage ein Preset mit eigenem
  `first_message`. Ob eine Client-Uebersteuerung dieses Preset schlaegt oder umgekehrt, ist
  am Anbieter **nicht gemessen** (Annahme waere geraten). Beide Ausgaenge sind
  ungefaehrlich: gewinnt das Preset, hoert der Owner die Offenlegung — Feature wirkungslos,
  Pflicht uebererfuellt. Gemessen wird das im Runbook (8.3, Schritt 6) an EINEM echten
  Anruf, nicht durch Raten.
- **Rueckfrage-Tor.** Bei `calleeIsOwner === true` geht `consult_available` auf
  `unavailable`. Den eigenen Auftraggeber zu fragen, waehrend man mit ihm telefoniert, ist
  sinnlos; die vorhandene Formulierung deckt es bereits ab, es braucht keinen neuen
  Prompt-Text.
- **Die geteilte Anrufstart-Attrappe wird erweitert, nicht kopiert.**
  `test/helpers/elevenlabs-anrufstart-attrappe.mjs` gibt heute ausschliesslich
  `rumpf.dynamic_variables` zurueck — das Uebersteuerungs-Objekt ist von aussen gar nicht
  erreichbar, und `pinStore().tenantContext` liefert kein `firstName`. Mit dieser Attrappe
  waere der Testplan dieser Phase NICHT ausfuehrbar (Fall B faellt konstruktionsbedingt
  durch). Die Erweiterung ist deshalb ausdruecklich erlaubt und in `tasks/oc-p2-spec.md`
  3.1 als dritte zulaessige Test-Aenderung gefuehrt — mit der Auflage, dass die zwei
  Bestandsnutzer (`test/el-vorlage-variablen-abgleich.test.js`,
  `test/elevenlabs-torzustand.test.js`) UNVERAENDERT gruen bleiben. Eine zweite Attrappe
  bleibt verboten (sie driftet, und dann hoert eine der Suiten still auf zu messen).

**INVARIANTEN.**

- Fuer JEDES Nicht-Owner-Ziel ist der Anfragekoerper des Anrufstarts byte-identisch zum
  Bestand — einschliesslich: KEIN `agent.first_message` im Uebersteuerungs-Objekt, und
  `{{callee_relation}}` ist der leere String (der Prompt am Anbieter rendert dann exakt
  den heutigen Text).
- `providerOpeningFor` bleibt die eine Referenz fuer den statischen Rahmen; T5(c)/(e) in
  `test/elevenlabs-anrufstart.test.js` bleiben unveraendert gruen.
- Die Owner-Eroeffnung enthaelt **keine** `{{...}}`-Platzhalter (sonst Anbieter-Abbruch
  1008, belegt in `test/el-vorlage-variablen-abgleich.test.js` Kopfkommentar).
- Die Owner-Eroeffnung **identifiziert die KI** in jeder Sprache (1.4), per Test gepinnt.
- Der Owner-Prompt-Block traegt die **Pflicht-Rueckfallzeile** (1.4) mit dem
  vollstaendigen Offenlegungssatz der Anrufsprache.
- `disclosureSentence` bleibt unbedingt.
- `test/de-umlaut-orthography.test.js` bleibt UNVERAENDERT — der neue Schluessel wird dort
  nicht eingetragen (der Wortlaut traegt keinen Umlaut; die Gegenprobe `P1-U2` wuerde rot).
  Die Orthografie-Zusage fuer den neuen String bringt der neue Test selbst mit.

**ABGRENZUNG.** Kein Budget-/TeXML-Pfad, kein `systemPrompt`, keine UI, kein `elevenlabs:push`
(das ist Runbook 8.3 und Owner-Handlung), kein Deploy, kein echter Anruf.

**ABNAHME.** Siehe `tasks/oc-p2-spec.md` Abschnitt "Abnahme" (Anker: `npm test` 4909,
`test:gates` 129).

**Risikoklasse: hoch** (Absolute Regel 2, Anbieter-Erlaubnis-Karte, Live-Pfad).

### OC-P3 — Gleichlauf der uebrigen Outbound-Wege

**SCOPE.** `openingText` (`src/claude.js:425-431`) und `systemPrompt` (`src/claude.js:291`)
owner-bewusst; Persona-/Situations-/Identitaets-Bausteine je Sprache in
`src/i18n/prompts/{de,fr,en}.js`; Beschriftung des Nummernfelds im Dashboard
(`apps/web/src/components/app/SettingsIsland.astro`); Tests fuer beide erreichbaren Wege.

**ENTSCHEIDUNGEN.**

- `openingText` deckt mit EINER Aenderung ZWEI Wege ab: `src/routes/voice.js:487`
  (Budget/TeXML) und `src/telnyx-call-control-ingest.js:206` (C-Telnyx-Assistant).
- `systemPrompt` deckt Budget-Turn-Schleife (`src/claude.js:1080`) und Realtime
  (`src/bridge.js:99`) ab. **Der Telnyx-Assistant-Shim ist damit ebenfalls gedeckt —
  belegt, nicht angenommen:** `src/telnyx-llm-shim.js` kapselt `agentTurn` (Modulkopf
  Zeile 2; `agentTurn` ist Abhaengigkeit der Fabrik, `src/telnyx-llm-shim.js:495`), und
  `agentTurn` baut den Prompt ueber `systemPrompt` (`src/claude.js:291` Definition,
  `:1080` `system: systemPrompt(call)`). Der frueher hier gefuehrte Pruefauftrag ist damit
  beantwortet; die Spec fuehrt ihn als **Beleg mit Test**, nicht als offene Frage.
- Der Realtime-Opener in `src/bridge.js:222-227` bleibt unveraendert (3.5).
- Die Pflicht-Rueckfallzeile aus 1.4 (nicht der Auftraggeber am Apparat ⇒ sofort voller
  Offenlegungssatz, dann Dritt-Modus) gehoert in BEIDE neuen Prompt-Bausteine.

**INVARIANTEN.** Fuer jedes Nicht-Owner-Ziel ist der Erst-Turn-Text und der Systemprompt
byte-identisch zum Bestand, in allen drei Sprachen. Der Owner-Baustein traegt in allen
drei Sprachen die Pflicht-Rueckfallzeile aus 1.4. Die bestehenden Offenlegungs-Riegel
(`test/disclosure-outbound.test.js`, `test/disclosure-regression.test.js`,
`test/g1-identity-binding.test.js`, `test/g2-opening-turn.test.js`,
`test/telnyx-p8-opening-contract.test.js`) bleiben unveraendert gruen — ebenso
`test/cq-p5-prompt-redesign.test.js`, die Ratsche fuer die Prompt-Orthografie (NICHT
`test/de-umlaut-orthography.test.js`, die deckt die `LOCALES`-Felder).

**ABGRENZUNG.** Kein EL-Pfad (OC-P2), keine Inbound-Erkennung, keine
Besitz-Verifikation, kein Umbau des Telnyx-Shims (2.3 ist ein Beleg, kein Bauauftrag).

**ABNAHME.** Siehe `tasks/oc-p3-spec.md` Abschnitt "Abnahme" (Anker: `npm test` 4909,
`test:gates` 129).

**Risikoklasse: mittel.**

### Nicht gebaut, bewusst vorgehalten

- **OC-P4 (Rueckfall): zweiter, offenlegungsfreier EL-Agent.** Nur zu bauen, wenn die
  Messung in 8.3/Schritt 6 ergibt, dass `language_presets` die Uebersteuerung schlaegt
  und der Owner sein Briefing deshalb weiterhin mit Offenlegung hoert. Skizze in 8.4.
- **Besitz-Verifikation der eigenen Nummer.** Eigene Kette, s. 5.3.
- **Inbound-Erkennung.** Abschnitt 9.

---

## 7. Pre-Mortem

Ein Jahr weiter. Die Entscheidung war falsch. Was ist passiert?

### 7.1 Ein Kunde hat eine fremde Nummer hinterlegt

**Hergang.** Nach dem Launch traegt jemand die Nummer seiner Ex-Partnerin als "eigene
Nummer" ein und laesst Hermes dort anrufen. Der Anruf eroeffnet ohne Offenlegung, mit
Vornamen-Anrede. Die Angerufene glaubt, mit einem Menschen zu sprechen. Beschwerde,
Aufsichtsbehoerde, Artikel 50.

**Ursache.** Die Ausnahme haengt an einem Feld, das Format und Land prueft, aber nicht
Eigentum — und der Launch-Blocker in `PLAN-SECURITY.md` wurde beim Aufraeumen als
"erledigt" abgehakt, weil das Feature ja lief.

**Gegenmassnahmen in diesem Plan.** (a) Der Eintrag in 5.4 benennt ausdruecklich, dass ein
Schliessen ohne gebaute Verifikation ODER ohne abgeschalteten Schalter eine
Rechtsverletzung ist — nicht "offener Punkt", sondern Blocker. (b)
`OWNER_SELF_CALL_ENABLED` existiert genau dafuer: sobald etwas schiefgeht, ist es EIN
Dashboard-Feld, kein Deploy. (c) Die Vor-Launch-Praemisse steht woertlich im Kopf dieses
Plans und in der CLAUDE.md-Ergaenzung, nicht nur in einer Commit-Message. (d) **Und das
ist die einzige Gegenmassnahme, die nicht auf Gedaechtnis beruht:** der Kunde aus dem
Hergang steht nicht in `OWNER_SELF_CALL_TENANT_IDS`, also loest er die Ausnahme gar nicht
aus — er hoert den vollen Offenlegungssatz wie jeder andere. Damit dieser Hergang
eintritt, muesste jemand einen fremden Account AKTIV in die Liste eintragen; das ist eine
bewusste Handlung mit einem Namen, keine Unterlassung. (e) Selbst wenn er eintraete,
identifiziert die Eroeffnung die KI (1.4) und der Prompt verpflichtet zum Nachholen des
vollen Satzes.

**Restrisiko: akzeptiert, benannt, mit Ausschaltweg — und ohne Pfad fuer einen fremden
Account.**

### 7.2 Ein Praedikat-Fehler legt die Offenlegung fuer Fremde still

**Hergang.** Jemand macht den Vergleich "robuster" — Praefix-Match, letzte-8-Ziffern,
Gross-/Kleinschreibung. Ab da matcht `+4917012345678` auch auf `017012345678` oder auf
irgendeine Nummer mit derselben Endung. Fremde bekommen Anrufe ohne Offenlegung.

**Gegenmassnahmen.** (a) Ein Modul, ein Vergleich, strikte String-Gleichheit, im Kommentar
begruendet. (b) Ein Test, der ausdruecklich die naheliegenden Beinahe-Treffer als `false`
pinnt: gleiche Ziffern ohne `+`, national statt E.164, ein Zeichen Unterschied, Leerstring,
`null`, `undefined`, gleiche Endung. (c) `diagnosticRetentionGranted` haengt am selben
Vergleich — eine Aufweichung wuerde dort ebenfalls rot. (d) Die Normalisierung bleibt
VORGELAGERT (`normalize_target`) und wird nicht ins Praedikat gezogen; ein Praedikat, das
selbst normalisiert, ist ein Praedikat, das irgendwann grosszuegig normalisiert.

### 7.3 Der Schalter wird zum allgemeinen Offenlegungs-Ausschalter

**Hergang.** Irgendwann steht `OWNER_SELF_CALL_ENABLED=true` und jemand "vereinfacht" das
Praedikat, weil die Nummer eines Tenants gerade fehlt und der Testanruf nervt. Aus
"eigenes Ziel UND Schalter" wird "Schalter".

**Gegenmassnahmen.** (a) Der Schalter sitzt IM Praedikat und wird gemeinsam mit der
Ziel-Bedingung getestet: ein Test pinnt "Schalter an + fremdes Ziel => Offenlegung", ein
zweiter "Schalter aus + eigenes Ziel => Offenlegung". (b) Der Name sagt, was er tut
(`OWNER_SELF_CALL_ENABLED`), nicht `DISCLOSURE_...`. (c) Die CLAUDE.md-Ergaenzung nennt
"kein Setting, das die Offenlegung fuer Dritte abschaltet" ausdruecklich. (d) Selbst wenn
jemand die Ziel-Bedingung aufweichte, bliebe die Tenant-Allowlist als zweite, unabhaengige
Konjunktion stehen — ein dritter Test pinnt "Schalter an + eigenes Ziel + Tenant NICHT
gepinnt => Offenlegung".

### 7.4 Vorlagen-Drift bei ElevenLabs

**Hergang.** Die Erlaubnis-Karte steht nach OC-P2 im Repo auf `agent.first_message: true`,
wurde aber nie gepusht — oder jemand dreht sie im Dashboard zurueck. Die Owner-Eroeffnung
verschwindet still. Umgekehrt: der Prompt-Push haengt, `{{callee_relation}}` steht nicht
im Live-Prompt, der Agent redet weiter in der dritten Person, obwohl der Text stimmt.
Oder — schlimmer — jemand pusht `first_message` mit einer Hand-Variante ohne Offenlegung.

**Gegenmassnahmen.** (a) `npm run elevenlabs:drift` misst gegen den LIVE-Agenten, nicht
gegen die Vorlage, und `conversation_config_override_erlaubnisse`, `prompt`,
`first_message` und `language_presets_offenlegung` sind alle besessene Felder. (b) Die
Reihenfolge in 8.3 setzt den Drift-Lauf ans Ende und macht ihn zur Abnahme, nicht zur
Nachschau. (c) `test/elevenlabs-anrufstart.test.js` T5(c)/(e) haelt weiterhin
byte-identisch fest, dass der statische Rahmen mit dem Offenlegungssatz BEGINNT — eine
Hand-Variante ohne Offenlegung faellt dort auf, bevor sie irgendwohin gepusht wird. (d)
Die Zwischenzustaende sind in 8.2 einzeln als harmlos oder nicht-harmlos beurteilt.

### 7.5 Test-Riegel-Konflikte

**Hergang.** Die rund 20 Tests, die die Offenlegung pinnen, werden "angepasst", damit die
neue Ausnahme gruen wird — und dabei verliert einer von ihnen die Zusage, die er
eigentlich haelt.

**Gegenmassnahmen.** (a) Harte Regel fuer alle drei Phasen: **kein bestehender
Offenlegungs-Test wird veraendert.** Die Ausnahme wird ausschliesslich durch NEUE Tests
belegt. Faellt ein Bestandstest um, ist das ein Befund, kein Anpassungsbedarf — er ist im
Phasenbericht zu melden, nicht zu reparieren. (b) Die Bestandstests laufen alle gegen
Ziele, die NICHT die private Nummer des Test-Tenants sind; die Ausnahme kann sie
strukturell nicht treffen — wenn sie es doch tut, ist genau das der Beweis fuer einen zu
weiten Vergleich. (c) `LLM_PROVIDER=anthropic npm test` muss vollstaendig gruen sein
(gemessener Ausgangsstand laut Grounding: 4909/4909).

### 7.6 pg-Speicher-Zustand

**Hergang.** Der Owner traegt seine Nummer per `psql` direkt in die Produktions-DB ein
(schneller als durch die UI), der laufende Prozess sieht sie nicht, der Testanruf hat
Offenlegung, jemand "fixt" daraufhin das Praedikat.

**Gegenmassnahmen.** (a) Memory `pg-store-holds-state-in-memory`: der pg-Store haelt den
Zustand im SPEICHER, hydriert einmalig bei `init()`, und ein naechster `save()`-Flush kann
einen Direkt-Write ueberschreiben. Das ist bei `private_number` schon einmal passiert.
(b) Deshalb steht im Runbook (8.3, Schritt 1) ausdruecklich: die Nummer wird ueber die
ANWENDUNG gesetzt (`POST /api/self-service/private-number` im Dashboard), nie per SQL; und
die Gegenprobe erfolgt lesend ueber die Anwendung, nicht ueber die DB. (c) Ein Direkt-Write
umgeht ausserdem den kompletten Audit-Pfad einer PII-Aenderung.

### 7.7 Der Owner hoert seine eigene Offenlegung trotzdem

**Hergang.** Alles ist gebaut, gepusht, deployt — und der erste Briefing-Anruf beginnt
weiterhin mit "Guten Tag, hier spricht ein KI-Assistent im Auftrag von...". Ursache: das
`de`-Preset schlaegt die Uebersteuerung (7.4/6/OC-P2), oder der Schalter steht aus, oder die
hinterlegte Nummer weicht in einer Ziffer ab.

**Gegenmassnahmen.** Das ist der HARMLOSE Ausgang, und er ist eingeplant: 8.3 Schritt 6
misst genau diese Ursachen in fester Reihenfolge (Schalterstand, **Tenant-Allowlist**,
gespeicherte Nummer ueber die Anwendung gelesen, `transcript[0]` des Gespraechs). Erst
danach wird ueber OC-P4 entschieden. Die Allowlist steht bewusst an zweiter Stelle: sie
ist der neue und damit wahrscheinlichste Vergesser.

### 7.8 Der offene Bestandsbefund

`tasks/gq-chain-state.md:1636-1639`: im ersten Live-Anruf nach dem GQ-Cutover
(`call_mt18soytibps`) hat der Agent mitten im Gespraech ein Fragment des
Offenlegungssatzes wiederholt. Wurzel unbekannt. **Fuer diese Kette relevant, weil:** bei
einem Owner-Anruf steht dieser Satz gar nicht mehr in der `first_message` — taucht er
trotzdem im Gespraech auf, kommt er aus dem PROMPT (`{{owner_name}}`-Persona) und der
Owner-Block in `{{callee_relation}}` muss das ausdruecklich verbieten. OC-P2 nimmt genau
diesen Satz in den Owner-Block auf ("never mention that this call will be summarised for
a third party"). Die Wurzel des Bestandsbefunds bleibt davon unberuehrt und ist NICHT Teil
dieser Kette.

### 7.9 Am eigenen Anschluss geht jemand anderes ran (der gutglaeubige Normalfall)

**Hergang.** Der Auftraggeber hat seinen Festnetzanschluss als eigene Nummer hinterlegt —
zulaessig, `normalizePrivateNumber` kennt keine Mobilfunk-Beschraenkung und keinen
Geraetebezug (`src/store/state-ops.js:2127-2136`). Der Assistent ruft dort an, seine
Mitbewohnerin hebt ab und hoert "Hallo Antonio, hier ist dein Assistent." Das Wort
"Assistent" identifiziert keine Maschine; der Owner-Prompt verbietet dem Agenten
zusaetzlich, sich als Assistent im Auftrag von jemandem vorzustellen. Sie fuehrt ein
Gespraech mit einer KI, ohne es zu wissen. Kein Missbrauch, kein boeser Wille, keine
fremde Nummer — der Normalfall.

**Ursache.** Das Praedikat beweist eine Aussage ueber die NUMMER, der Rechtssatz
behauptete eine Aussage ueber die PERSON. Zwischen beiden lag nichts.

**Gegenmassnahmen (alle in 1.4, alle reine Textaenderungen).** (a) Die Owner-Eroeffnung
identifiziert die Maschine in jeder Sprache ("dein KI-Assistent" / "your AI assistant" /
"ton assistant IA") — schon der erste Satz ist damit fuer jeden Zuhoerer korrekt.
(b) Pflichtzeile in jedem Owner-Prompt-Baustein: ist am Apparat nicht der Auftraggeber,
folgt sofort der vollstaendige Offenlegungssatz, danach Dritt-Modus. Der Wortlaut wird
dem Modell fertig mitgegeben, nicht umschreiben lassen. (c) Ein Test je Sprache pinnt, dass
die Owner-Eroeffnung das KI-Wort traegt — sonst faellt es beim naechsten Kuerzen der
Begruessung heraus, und genau dieser Hergang steht wieder offen.

**Restrisiko.** Zwischen "abgehoben" und "es klaert sich, dass es jemand anderes ist"
liegen ein paar Sekunden, in denen der Zuhoerer nur die Kurzform gehoert hat. Das ist
akzeptiert: die Kurzform sagt bereits "KI", der Rest ist Ergaenzung.

---

## 8. Live-Schaltungs-Runbook

Keine Code-Phase. Owner-Handlung, nach dem Merge von OC-P1..OC-P3.

### 8.1 Vorbedingungen

- OC-P1..OC-P3 auf `master`, `LLM_PROVIDER=anthropic npm test` gruen (Anker gemessen
  2026-08-20: `korrigiert: tests 4909 / pass 4909 / fail 0`).
- `OWNER_SELF_CALL_ENABLED` steht ueberall auf `false` (Repo-Default), auch in Render, und
  `OWNER_SELF_CALL_TENANT_IDS` ist ueberall leer.
- Die Nummer, die der Owner testen will, ist ihm bekannt; die Tenant-ID seines eigenen
  Accounts ist ihm bekannt (sie wird in Schritt 5 eingetragen).

### 8.2 Reihenfolge — GEDREHT gegenueber dem uebrigen Bestand, mit Begruendung

**Bindende Reihenfolge fuer DIESE Kette: (1) Upstream-Push jonas986 + manueller
Render-Deploy, (2) `elevenlabs:push`, (3) `elevenlabs:drift`.**

Der Bestand faehrt sonst Push → Deploy → Drift (zuletzt GQ-E1/B1/B2,
`tasks/gq-chain-state.md`). Fuer diese Kette wird gedreht, weil die uebliche Reihenfolge
genau den einen Zwischenzustand erzeugt, den dieser Plan nicht belegen kann:

| Reihenfolge | Zwischenzustand | Beurteilung |
|---|---|---|
| **Push zuerst** (Bestandsmuster) | Live-Prompt enthaelt `{{callee_relation}}`, der alte Code schickt die Variable nicht mit | **UNGEMESSEN und potenziell toedlich.** Ein Platzhalter ohne gelieferte Variable beendet das Gespraech beim Anbieter mit Code 1008 — der Angerufene hoert Stille (`test/el-vorlage-variablen-abgleich.test.js`, Kopfkommentar Zeilen 9-14). Belegt ist das fuer Platzhalter in der `first_message`; ob es fuer den PROMPT ebenso gilt, ist NICHT gemessen. Das Fenster traefe JEDEN laufenden Anruf, nicht nur Owner-Anrufe. |
| **Deploy zuerst** (fuer diese Kette bindend) | Neuer Code sendet `callee_relation`, der Live-Prompt hat noch keinen Platzhalter dafuer | **Belegt harmlos.** Dieselbe Datei nennt genau diesen Fall "toter Ballast, keine Platzhalter-Aufloesung haengt daran" (`test/el-vorlage-variablen-abgleich.test.js:33` und `:108-109`). Zusaetzlich steht der Schalter in diesem Fenster noch auf `false` (Flag-Flip ist Schritt 5) — es entsteht also nicht einmal eine Uebersteuerung. |

Damit ist die ungemessene Annahme nicht "abgesichert", sondern **beseitigt**: sie tritt in
keinem Zustand dieses Ablaufs auf.

Beurteilung der uebrigen Zwischenzustaende:

| Zustand | Was live ist | Harmlos? |
|---|---|---|
| Nach (1), vor (2) | Neuer Code live, Schalter aus, Vorlage alt. `callee_relation` reist als toter Ballast mit; keine Uebersteuerung, weil `calleeIsOwner` immer `false` ist. | **Ja, belegt** (s. Tabelle oben). Verhalten sonst byte-identisch zum Bestand. |
| Nach (2), vor Flag-Flip | Anbieter kennt Platzhalter + Erlaubnis-Karte, Code liefert die Variable bereits, Schalter aus. | **Ja.** Jeder Anruf laeuft wie heute, mit Offenlegung. |
| Flag an, aber Tenant nicht gepinnt | Schalter an, Allowlist leer. | **Ja.** `calleeIsOwner` bleibt `false`, Offenlegung ueberall. |
| Flag an, Vorlage NICHT gepusht (falls jemand die Reihenfolge doch dreht) | Code sendet die Uebersteuerung, Anbieter ignoriert sie still (Karte `false`). | **Ja, aber wirkungslos.** Der Owner hoert die Offenlegung. Die harmlose Richtung. |

Der Preis der Drehung, benannt: im Fenster nach (1) schickt der Code eine Variable, die
der Live-Prompt nicht benutzt. Faellt in diesem Fenster etwas aus, gibt es zwei Kandidaten
statt einem. Das ist eine Diagnose-Unbequemlichkeit gegen ein potenzielles
Totalausfall-Fenster — der Tausch ist eindeutig.

### 8.3 Ablauf

Jede Aktion mit Kommando. Owner-Handlung; nichts davon gehoert in eine Phase.

1. **Eigene Nummer setzen** — im Dashboard unter Einstellungen, ueber die Anwendung
   (`POST /api/self-service/private-number`). **Niemals per SQL** (7.6: der pg-Store haelt
   den Zustand im Speicher, ein Direkt-`UPDATE` ist fuer den laufenden Prozess unsichtbar
   und umgeht den Audit-Pfad einer PII-Aenderung). Gegenprobe LESEND ueber die Anwendung
   — im Dashboard neu laden, oder mit der Browser-Session:
   ```
   curl -s -b <session-cookie> https://<live-host>/api/state | grep -o '"privateNumberMasked":"[^"]*"'
   ```
   Erwartet: die maskierte Form mit passendem Laendercode und passenden letzten vier
   Ziffern (der Feldname folgt `maskPrivateNumber`, `src/self-service-routes.js:324` — die
   ROHE Nummer erscheint nirgends, das ist Absicht).

   **1b. Live-Stand der Erlaubnis-Karte LESEND belegen, VOR jedem Push** (Memory
   `provider-config-needs-doc-before-diagnosis`; Hintergrund in 3.7):
   ```
   npm run elevenlabs:drift
   ```
   Erwartet als Ausgangsstand: dieselbe Bilanz wie am 2026-08-20 (38/38 verglichen,
   einzige Abweichungen `retention_days`/`record_voice`) PLUS die zwei Felder, die diese
   Kette absichtlich veraendert hat (`prompt`,
   `conversation_config_override_erlaubnisse`). Meldet der Lauf zusaetzlich `tts.voice_id`
   oder `conversation.text_only` als Abweichung, ist der Vorlagen-Hinweis aus 3.7 doch
   noch gueltig — dann wuerde der Push in Schritt 3 **zusaetzlich die Stimme fuer ALLE
   Anrufe drehen**. In diesem Fall: anhalten, Live-Karte in die Vorlage nachziehen, erst
   dann pushen.

2. **Upstream-Push + Deploy (ZUERST, s. 8.2)** — Memory `deploy-repo-split`:
   `git push origin` macht NICHTS live.
   ```
   git push jonas986 master
   ```
   Danach manueller Deploy von `srv-d8m0fhflk1mc73bno570` (autoDeploy AUS) im
   Render-Dashboard. Gegenprobe:
   ```
   curl -s https://<live-host>/healthz
   ```
   Erwartet: `200` und der neue Commit-Stand. **Deploy-Stand nie aus einer Notiz lesen**
   (Memory `kosten-endspiel-live-verified`).

3. **`npm run elevenlabs:push`** — zuerst OHNE `--ausfuehren` (Trockenlauf ist der
   Normalfall) und die Vorschau lesen:
   ```
   npm run elevenlabs:push -- --felder=prompt,conversation_config_override_erlaubnisse
   ```
   Dann gezielt schreibend:
   ```
   npm run elevenlabs:push -- --felder=prompt,conversation_config_override_erlaubnisse --ausfuehren
   ```
   Kein Sammel-Push: `first_message` und `language_presets_offenlegung` werden hier NICHT
   angefasst (die tragen den statischen Offenlegungssatz).

4. **`npm run elevenlabs:drift`** — Abnahme, nicht Nachschau.
   ```
   npm run elevenlabs:drift
   ```
   Erwartet: `prompt` und `conversation_config_override_erlaubnisse` stimmen ueberein;
   `first_message` und `language_presets_offenlegung` unveraendert (also weiterhin mit
   Offenlegungssatz); einzige verbleibende Abweichungen die zwei bewusst ausgenommenen
   (`retention_days`/`record_voice`).

5. **Scharfstellen — beide Env-Werte im Render-Dashboard des Service:**
   `OWNER_SELF_CALL_ENABLED=true` UND `OWNER_SELF_CALL_TENANT_IDS=<eigene Tenant-ID>`
   (nur unsere eigenen Accounts, 5.2 — ein fremder Account in dieser Liste ist selbst die
   Rechtsverletzung, gegen die der `PLAN-SECURITY.md`-Eintrag steht). Danach
   Neustart/Deploy des Service ausloesen — Env-Aenderungen greifen erst mit dem Neustart,
   und der pg-Store hydriert dabei ohnehin neu (Memory `pg-store-holds-state-in-memory`).
   Gegenprobe:
   ```
   curl -s -o /dev/null -w "%{http_code}\n" https://<live-host>/healthz
   ```
   Erwartet: `200`.

6. **Owner-Testanruf auf die eigene Nummer** (ueber das Dashboard oder den
   MCP-Connector, `place_call`) und Messung, in dieser Reihenfolge:
   1. Hoert der Owner den langen Offenlegungssatz? Wenn nein (Kurzform "hier ist dein
      KI-Assistent"): fertig, Feature wirkt.
   2. Wenn ja: Schalterstand UND Tenant-Allowlist im Dashboard pruefen (beide muessen
      stehen; die Liste ist der haeufigere Vergesser).
   3. Wenn beides stimmt: gespeicherte Nummer ueber die ANWENDUNG lesen (maskiert) und mit
      der gewaehlten vergleichen.
   4. Wenn auch das stimmt: `transcript[0]` des ElevenLabs-Gespraechs lesen. Steht dort der
      Offenlegungssatz, hat das `language_presets`-Preset die Uebersteuerung geschlagen →
      Entscheidung ueber OC-P4 (8.4).
7. **Fremd-Gegenprobe im selben Zug** — ein normaler Anruf an eine fremde Nummer
   (derselbe Tenant, gepinnt). Erwartet: der volle Offenlegungssatz als erster Satz, wie
   immer. Ohne diese Gegenprobe ist nur belegt, dass etwas anders ist — nicht, dass es
   eng ist.
8. **Beleg festhalten** — Anruf-IDs (beide), Konversations-IDs, erster gesprochener Satz
   je Anruf, Env-Stand, Deploy-ID, in `tasks/oc-chain-state.md`. Ohne Beleg gilt die
   Schaltung als nicht vollzogen.

### 8.4 Rueckfall OC-P4, falls Schritt 6.4 eintritt

Zweiter EL-Agent mit eigener `agent_id`, dessen `first_message` die Owner-Eroeffnung ist
und der **keine** `language_presets` mit Offenlegung traegt; `el.agentId` wird per Anruf
gewaehlt (`call.calleeIsOwner === true` → Owner-Agent, sonst der bestehende); fehlt die
Kennung, faellt es auf den bestehenden Agenten zurueck (fail-closed → Offenlegung). Kosten:
zweite Vorlage, zweiter Prompt, zweiter Drift-Waechter, doppelte Werkzeug-Registrierung.
Nur bauen, wenn gemessen.

### 8.5 Rueckzug

`OWNER_SELF_CALL_ENABLED=false` + Neustart (alternativ/zusaetzlich
`OWNER_SELF_CALL_TENANT_IDS` leeren — beide Wege sind vollstaendig). Kein Deploy, kein Revert, keine
Anbieter-Aenderung noetig — die Uebersteuerung wird dann fuer keinen Anruf mehr gebaut.
Die Erlaubnis-Karte darf auf `true` stehen bleiben (sie erlaubt nur, sie sendet nicht);
soll auch das zurueck, ist es ein eigener `elevenlabs:push -- --felder=conversation_config_override_erlaubnisse --ausfuehren`.

---

## 9. Ausblick: Inbound (NICHT Teil dieser Kette)

Der Auftrag ist ausdruecklich auf Outbound begrenzt. Der spiegelbildliche Fall — der Owner
ruft SEINEN Assistenten von seiner eigenen Nummer aus an — waere `from ===
tenantPrivateNumber` und ist heute nirgends erkannt. Vier Gruende, warum er nicht
mitgebaut wird:

1. **Andere Rechtslage.** Beim Inbound gilt nicht der Outbound-Offenlegungssatz (Regel 2),
   sondern der Inbound-Pflichtsatz (`LOCALES.<lang>.inboundNotice`, GAP-14/O7) — eine
   getrennte, unabhaengige Achse mit eigener Begruendung und eigenen Tests
   (`test/inbound-disclosure-mandatory.test.js`). Sie hier mitzudrehen, waere zwei
   Entscheidungen in einer.
2. **Andere Vertrauensbasis.** `from` ist die Anrufer-Kennung, die das Netz liefert —
   spoofbar. `to` waehlen WIR. Eine Ausnahme auf `from` zu stuetzen, ist etwas grundlegend
   anderes als eine auf `to`.
3. **Andere Fehlerfolge.** Ein falsch erkannter Inbound-Owner bekaeme Zugriff auf die
   Owner-Persona eines fremden Assistenten — das ist naeher an Identitaets-Uebernahme als
   an einer fehlenden Offenlegung.
4. Der Nutzen ist klein: beim Inbound kennt der Owner die Situation ohnehin.

Wird es je gebaut, ist das Praedikat aus 3.1 wiederverwendbar (`{ to: call.from, ownNumber }`)
— die Ausnahme selbst aber braucht eine eigene Owner-Entscheidung und mindestens die
Besitz-Verifikation aus 5.3 als Vorbedingung.

---

## 10. Offene Punkte

| Punkt | Status |
|---|---|
| Vorrang `language_presets` vs. Uebersteuerung am Anbieter | ungemessen, beide Ausgaenge ungefaehrlich, Messung in 8.3/6 |
| Besitz-Verifikation der eigenen Nummer | bewusst zurueckgestellt, Launch-Blocker in `PLAN-SECURITY.md` (5.4); bis dahin haelt die Tenant-Allowlist (3.6) |
| Person != Nummer (jemand anderes hebt am eigenen Anschluss ab) | **geschlossen, soweit Text es kann**: KI-identifizierende Eroeffnung + Pflicht-Rueckfall im Prompt (1.4, 7.9). Restrisiko benannt |
| Wurzel der Offenlegungs-Wiederholung (`call_mt18soytibps`) | Bestandsbefund, NICHT Teil dieser Kette (7.8) |
| Vorlagen-Hinweis `tts.voice_id`/`conversation.text_only` vermutlich ueberholt | wird in 8.3/1b LESEND belegt, bevor gepusht wird (3.7) |
| `disable_first_message_interruptions` gilt auch fuer die Owner-Eroeffnung | akzeptiert: der Owner kann seine eigene Begruessung ~2 s lang nicht unterbrechen; globales Agentenfeld, nicht pro Anruf setzbar |

Erledigt und deshalb NICHT mehr offen: der Prompt-Bezugsweg des Telnyx-Assistant-Shims ist
am Code belegt (`src/telnyx-llm-shim.js` Kopfzeile 2 und `:495` → `agentTurn` →
`src/claude.js:1080` `system: systemPrompt(call)`); OC-P3 fuehrt ihn als Beleg mit Test,
nicht als Frage.

**Fuer den Owner zu entscheiden: nichts.** Alle Wahlen sind in diesem Dokument getroffen
und begruendet.
