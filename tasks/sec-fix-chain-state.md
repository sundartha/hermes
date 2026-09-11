# Kettenstand: Behebungskette Sicherheitstest (SEC-P0..SEC-P6)

**Diese Datei ist die Uebergabe.** Wer neu einsteigt, liest sie und sonst nichts, um den Stand
zu kennen. Stand: 2026-09-11.

Zugehoerige Dokumente:
`PLAN-SEC-FIX.md` (Manifest der Kette, Phasen + Abnahmekriterien) ·
`tasks/sicherheitstest-befunde.md` (die urspruenglichen Messungen) ·
`PLAN-SICHERHEITSTEST.md` (Testkatalog, 15 Angriffspfade) ·
`PLAN-SECURITY.md` (die bindenden Owner-Entscheidungen, Abschnitte `## SEC-P1`..`## SEC-P6`) ·
`tasks/lessons.md` (Prozess-Lehren) ·
`tasks/sec-fix-kickoff.md` (die Lead-Rolle, verbraucht).

---

## Kurzfassung

Alle sieben Phasen sind gebaut, gemergt, deployt und **wirksam**. Jede Abnahme wurde vom Lead
selbst nachgemessen, nicht vom Workflow geglaubt. Die Kette ist abgeschlossen.

- Code live auf `28503fa` (Upstream `jonas986/vodafone-agent`, Branch `master`).
- Gateway `vodafone-agent` laeuft, Marketing `hermes-web` ebenso.
- `npm test` gruen (s. "Verlaesslichkeit der Testbank" — unter voller Parallelitaet flaky).
- `npm audit --omit=dev --audit-level=high` -> Exit 0.
- Die zwei Schalter dieser Kette stehen live: `CSRF_ENFORCE=true` (Default),
  `ELEVENLABS_TENANT_TOKEN_REQUIRED=true`.

**Was noch offen ist, gehoert alles dem Owner** (naechster Abschnitt). Es gibt keine offene
Bau-Aufgabe aus dieser Kette.

---

## 1. Offen, nur vom Owner erledigbar

| # | Was | Wirkung solange offen |
|---|---|---|
| 1 | Vier Repo-Secrets `TELNYX_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `PLATFORM_ANI_E164` auf `jonas986/vodafone-agent` setzen | der Art.-50-Offenlegungs-Drift-Waechter ist **nie** gelaufen und scheitert stuendlich |
| 2 | Render-Zugang fuer den Owner (Workspace gehoert `jonas@kroh-willich.de`) | DB-05 (Backup + Drill) und der OPS-03-Rest sind nicht messbar |
| 3 | **Render-API-Schluessel rotieren** — liegt im Klartext in `~/.claude.json`, mit Schreibrechten auf die Produktion, ohne Ablauf | ein lokaler Schluessel-Abfluss ist ein Produktions-Vollzugriff |
| 4 | Stripe-Zugang (`team@sundartha.com`) | OPS-04 offen |
| 5 | Zwei-Faktor am Render-Konto | die Kontosicherheit ist die des Google-Kontos |

**Produktfrage, kein Defekt:** sollen zahlende Plaene die In-Call-Recherche (`allowLookup`)
bekommen? Heute traegt nur das Owner-Profil das Recht. Details im Befund A weiter unten.

**Naechste sinnvolle Bau-Arbeit** (nicht Teil dieser Kette): die Spawn-Race in
`test/helpers.js`, s. "Verlaesslichkeit der Testbank".

---

## 2. Stand je Phase

| Phase | Titel | Merge-Commit | Abnahme | Bemerkung |
|---|---|---|---|---|
| SEC-P0 | Testbank gruen | `98cf2bd` | **ja** | Teil (b) Flakes offen, s. Befund B |
| SEC-P1 | Webhook-Idempotenz | `105c839` | **ja** | 14 neue Faelle; Entscheidung in `PLAN-SECURITY.md` `## SEC-P1` |
| SEC-P2 | Lieferkette | `e9dc392` | **ja** | `audit high` Exit 0; 8 -> 2 Befunde, beide moderat |
| SEC-P3 | Eingabegrenzen + CSRF | `7b88c32` | **ja** | 21 neue Faelle; `CSRF_ENFORCE` als Rueckfall-Hebel |
| SEC-P4 | EL-Token je Mandant | `bd807a5` | **ja, scharf** | 18 Faelle; Anbieter-Push + Schalter am 09-11 bewiesen |
| SEC-P5 | Web-Haertung | `320be0a` | **ja, live gemessen** | Aussenmessung 09-10 bestanden |
| SEC-P6 | Antwort statt Haenger + Waechter | `4345c98` | **ja** | 18 neue Faelle; Legacy-Pin gesenkt statt angehoben |

Danach: Merge mit upstream FW1/FW2 -> `7937e9c`, Deploy 09-10; Merge mit CL2 -> `28503fa`.

---

## 3. Was live steht, und wie es belegt ist

**Deploy.** Gateway `vodafone-agent` am 09-10 um 20:02 manuell auf `7937e9c`, am 09-11 um
09:04 auf `2aee07f` (enthaelt die Kette). Auto-Deploy ist bei diesem Service **aus** — ein
Push allein deployt ihn NICHT. `hermes-web` deployt dagegen automatisch bei jedem Commit.

**SEC-P5, von aussen gemessen am 09-10, alle drei Oberflaechen bestanden:**

| Oberflaeche | HSTS | `script-src` |
|---|---|---|
| `sundartha.com` | `max-age=15552000; includeSubDomains` | `'self'` |
| `app.sundartha.com` | dito | `'self'` |
| `vodafone-agent.onrender.com` | dito | `'self'` |

Kein `'unsafe-inline'`, kein `'unsafe-eval'` mehr. Der Ausgangsbefund (HSTS fehlte auf allen
dreien, `'unsafe-inline'` auf zweien) ist geschlossen.

Der HSTS-Header der statischen Site sitzt im **Render-Dashboard** unter `hermes-web` ->
**Headers** — ein eigener Navigationspunkt unter "Manage", NICHT in Settings. Er wirkte sofort
ohne Redeploy. Achtung: das ist eine DRITTE Kopie des Wertes neben `src/middleware.js` und
`render.yaml`; kein Test kann sie sehen, ein Tippfehler dort bliebe unentdeckt.

**SEC-P4, am laufenden Dienst bewiesen am 09-11.** Beide Live-Werkzeuge (`look_up` =
`tool_6601m0bpfeqme9ssbpw9z8qhreyy`, `get_consult` = `tool_8801m00mvv3zfxhbcwbszpvfg9ae`)
tragen `tenant_token` im `request_body_schema` ueber `dynamic_variable`.
`ELEVENLABS_TENANT_TOKEN_REQUIRED=true` steht live.

Beweisform, falls so etwas wieder zu zeigen ist: Instanz `-jpgnv` startete 09:11:34 mit dem
scharfen Schalter; der Testanruf `call_mtwqs9qn0a6a` lief 09:17:03 auf DEMSELBEN Prozess und
lieferte `[el-lookup] ok=true` **ohne eine einzige `mandant_`-Zeile**. Bei scharfem Schalter
waere `FEHLT` abgelehnt worden — das Urteil war also `PASSEND`. Die Quer-Mandanten-Reichweite
ist geschlossen, nicht nur verschleiert.

**Wie der Anbieter-Push gemacht wurde, und wie NICHT:** gezielter
`PATCH /v1/convai/tools/{id}` — GET-Schnappschuss, EIN Feld ergaenzt, Live-Stand zurueck,
danach erneuter GET und Feld-fuer-Feld-Diff (nur die neun Felder der neuen Eigenschaft neu,
nichts entfernt, nichts geaendert). **Nicht** ueber `scripts/push-elevenlabs.mjs` — das
schriebe die GANZE Live-Konfiguration aus der lokalen `.env`.

---

## 4. Offene Befunde

### Befund A: `allowLookup` ist fuer zahlende Plaene aus (Produktfrage)

Der erste Testanruf am 09-11 scheiterte (`look_up` -> 404), und zwar NICHT wegen SEC-P4: der
Ablehnungsgrund war `kanal_nicht_freigegeben`, also die Faehigkeits-Stufe HINTER der
Mandanten-Pruefung. Ursache war das Rechteprofil in der DB.

Das ist Absicht, kein Fehler: `plans.js` gibt bezahlten Plaenen `allowLookup: false`, nur das
Owner-Profil traegt das Recht. Der Tenant `t_user_01KX600834GCJFV9GTZQKWZMTH` loeste auf ein
Plan-Profil auf. Gesetzt per

```sql
UPDATE profile SET data = jsonb_set(data,'{allowLookup}','true'::jsonb,true)
WHERE tenant_id = 't_user_01KX600834GCJFV9GTZQKWZMTH';
```

plus **Neustart** — der pg-Store haelt das Profil im Speicher. Danach funktioniert das
Nachschlagen, zweimal belegt (Eiffelturm 330 m, Koelner Dom 157 m).

Offen ist nur die Produktfrage, ob zahlende Plaene die Recherche bekommen sollen. Ein Flip in
`plans.js` allein reicht dafuer NICHT — Profilrechte sind ein DB-Schnappschuss je Tenant,
bestehende Kunden braeuchten zusaetzlich einen Backfill.

Nebenbei bestaetigt: die Tenant-RLS greift. Von 18 Tenants sah genau EINER den Anruf.

### Befund B: Verlaesslichkeit der Testbank (F-1)

**`npm test` ist unter voller Parallelitaet nicht mehr verlaesslich gruen.** Am Kettenende
gemessen, gleicher Commit, dieselbe Bank:

| Lauf | Parallelitaet | Ergebnis | Dauer |
|---|---|---|---|
| 1 | Standard (15 Kerne) | 5880/5883, **3 rot** | 150 s |
| 2 | Standard | 5881/5883, **2 rot** | 150 s |
| 3 | Standard | 5881/5883, **2 rot** | 150 s |
| 4 | `--test-concurrency=4` | **5883/5883, Exit 0** | 410 s |

Die Fehlermenge WECHSELT je Lauf (`AL-P10-1`, `dial-target-normalization`, `OC-P1-60`,
`INBOX-P2 C2`); jeder Fall ist isoliert drei- bis viermal gruen, und keine der Dateien liegt im
Diff der Phase, in der sie auffiel. **Es sind Rennen, keine Regressionen** — die gedrosselte
Messung beweist es.

Die urspruenglich katalogisierten fuenf Dateien (`auth-p5-internal-only`,
`el-consult-timeout-spur`, `el-geldpfad-s1`, `telnyx-p5-origination`,
`al-p10-precall-research`) sind **nicht die Menge**. Der gemeinsame Nenner ist die BAUART:
Spawn-Tests, die einen echten Server starten — davon gibt es 146.

**Die Kette hat den Druck selbst erhoeht** (51 beruehrte Testdateien, mehrere neue
Spawn-Tests) und damit den Schwellwert ueberschritten, ab dem die vorhandene Race kippt.
SEC-P0 konnte das nicht fixen: damals feuerte keine einzige Flake, und ohne Reproduktion ist
keine Wurzel zu belegen. Jetzt IST sie reproduzierbar.

**Fuer die Abnahmen dieser Kette heisst das nichts.** Jede Phase hatte ihren eigenen gruenen
Volllauf, und die neuen Faelle jeder Phase sind deterministisch gruen — sie starten keine
Serverfarm.

**Triage-Regel bis zum Fix:** ein roter Fall in einem Spawn-Test zaehlt erst, wenn er ISOLIERT
(`node --test test/<datei>.test.js`) ebenfalls rot ist (Bestandslehre
`suite-flake-p5-gate-proof`).

**Empfehlung:** die Wurzel sitzt in der Spawn-/Bereitschafts-Mechanik von `test/helpers.js` —
deterministische Bereitschaftspruefung statt Zeitfenster, eigener Zustand je Test, sauberes
Abraeumen des Kindprozesses. Eine dauerhafte Drosselung ist NICHT die Loesung (verdeckt die
Ursache, verdreifacht die Laufzeit), aber ein brauchbarer Hebel, wenn ein einzelner CI-Lauf
verlaesslich sein muss.

Verwandte Wurzelklasse: der SEC-P0-Defekt war eine **Zeitbombe** (Fixture gegen Wanduhr statt
gegen den Fixture-Anker). Es kann weitere geben — sie zeigen sich als Test, der ohne
Code-Aenderung rot wird.

### Befund C: zwei moderate Lieferketten-Advisories bleiben

`qs` via `express` 4.22.2. Die Abnahme verlangt nur `--audit-level=high` Exit 0; diese zwei
werden nicht ueber einen weiteren brechenden Sprung gejagt. `npm audit fix` haette express
faelschlich auf 4.22.1 ZURUECKgestuft, ohne das qs-Advisory zu beheben — deshalb wurde gezielt
aktualisiert statt pauschal gefixt.

### Befund D: die Legacy-Pin-Kurve laeuft weiter

SEC-P1 hob `makePgStore` 591 -> 596 Zeilen, `rowToCall` 37 -> 38, `callRowValues` 37 -> 39,
`makeVoiceRoutes` 269 -> 273. Keine NEUE abgeschaltete Sicherung, keine neue Regel-Kategorie —
das dokumentierte Bestandsverfahren. Die seit 2026-08-15 gemessene lineare Kurve laeuft aber
weiter: jedes persistierte Feld kostet einen weiteren Punkt in Mapper und Werteliste. Der
G30-Split von `makePgStore` bleibt die einzige echte Abhilfe und ist eine Owner-Entscheidung.

(SEC-P6 hat die Pins dagegen **gesenkt**: `makeCallRoutes` 243 -> 234, Komplexitaet 28 -> 26.)

---

## 5. Nebenbefunde, die anderswo Geld sparen

**ElevenLabs verwirft dynamische Variablen, die nichts referenziert.** `tenant_token` fehlte
im Anruf um 20:36 nicht wegen eines Fehlers, sondern weil der Prompt ihn bewusst nie nennt und
die Werkzeug-Definition ihn noch nicht kannte — null Abnehmer. Erst der Patch gab ihm einen.
Wer kuenftig eine Variable NUR an ein Werkzeug schickt, muss sie dort referenzieren, sonst
kommt sie nie an — und das sieht im Log aus wie ein eigener Fehler. Die Form abschreiben, nicht
raten: Vorbild ist `conversation_id` mit `system__conversation_id`, eine Eigenschaft traegt
NEUN Felder. Nicht ins `required` aufnehmen.

**Waechter 3 war im Plan falsch spezifiziert.** `PLAN-SEC-FIX.md` verlangte, `toolDefs("de")`
liefere vier Namen. Gemessen liefert `toolDefs` nur den Basissatz (`end_call`,
`take_message`); die bedingten Werkzeuge haengt erst `agentTools(call)` an. Ein Waechter auf
`toolDefs` waere sofort rot gewesen — also genau der, den man am naechsten Tag abschaltet.
Gepinnt ist deshalb `agentTools` in beiden Endzustaenden (Kanaele offen = vier Namen, zu =
Basissatz); die Faelle sind einander Positiv-Kontrolle. Dafuer ist `agentTools` aus
`src/claude.js` exportiert (eine Zeile, kein neuer Aufrufer).

**Der SEC-P6-Fehlerpfad hatte ZWEI Haelften.** Ein try/catch nur um die Gate-Schleife haette
14 der 17 Faelle nicht behoben: die Ablehnungs-Senke ruft nach dem Gate erneut
`store.tenantGeo` (ueber `denialDimensions`) — selbst eine der sterbenden Datenquellen — und
warf dort ein zweites Mal, ausserhalb jedes Gates. Beide Haelften gefixt und einzeln gepinnt
(`SEC-P6-4`, `SEC-P6-5`).

**Merge-Falle bei Ketten-Zusammenfuehrungen.** Beim Merge mit FW1/FW2 hatten beide Ketten
dieselben Zaehlwerte (`EXPECTED_TOTAL_KEYS`, eslint-Pins) unabhaengig von derselben Basis
hochgezogen und zufaellig DIESELBE Zahl eingetragen. Git fuehrt eine identische Zeile ohne
Konflikt zusammen — die Werte waren um die Haelfte der Ergaenzungen zu niedrig. Solche Zaehler
beim Merge **neu messen, nie addieren**, und dem konfliktfreien Automerge nicht glauben.

**Fertige Arbeit uncommittet ist keine Arbeit** — s. `tasks/lessons.md`, kostete in SEC-P3 eine
ganze Fix-Runde (45 Mio Token).

---

## 6. Prozess und Kosten

| Phase | Lauf | Gesamt | Turns | groesster Agent |
|---|---|---|---|---|
| SEC-P0 | `wf_c5b100fd-9b3` | 17,9 Mio | 192 | 9,8 Mio / 80 Turns |
| SEC-P1 | `wf_a691e1ef-a9a` | 106,9 Mio | 722 | 41,3 Mio / 184 Turns |
| SEC-P2 | `wf_80044ac7-77d` | 23,9 Mio | 270 | 9,3 Mio / 85 Turns |
| SEC-P3 | `wf_a8b13fc0-9a4` | 90,3 Mio | 650 | 45,1 Mio / 270 Turns |
| SEC-P4 | `wf_19c04dce-0ce` | 58,4 Mio | 370 | 32,3 Mio / 150 Turns |
| SEC-P5 | `wf_2b6d8a49-c2b` | 42,4 Mio | 352 | 20,4 Mio / 134 Turns |
| SEC-P6 | `wf_b57ea129-640` | 66,4 Mio | 430 | 35,0 Mio / 185 Turns |
| **Summe** | | **406,2 Mio** | **2986** | |

Gemessen mit `node scripts/workflow-kosten.mjs <lauf-id>`; die Zahl `subagent_tokens` des
Workflow-Werkzeugs ist als Kostenanzeige unbrauchbar.

**SEC-P3, Fix-Agent bei 270 Turns — bewusst NICHT abgebrochen.** Der Kickoff verlangt
`TaskStop` ab rund 250. Vor dem Abbruch nachgesehen statt der Zahl geglaubt: null
Warteschleifen, null volle Suite-Laeufe, echte Arbeit. Die Wurzel war nicht Weglaufen, sondern
uncommittete Arbeit des Impl-Agenten. Ein Abbruch haette 45 Mio verworfen; er committete vier
Minuten spaeter. **Die 250er-Schwelle ist der Anlass zum HINSEHEN, nicht zum reflexhaften
Abbrechen.**

**Effizienz-Riegel, die gehalten haben:** kein Agent fuhr die volle Suite, kein
Warteschleifen-Muster in irgendeinem Transkript. Das per-run-Skript
`.claude/workflows/runs/sec-fix.js` trug sie; es ist am Kettenende geloescht und liegt in der
Historie (`d50d4db`, `a8b9c39`).

**Grenze des Riegels:** in SEC-P0 verhinderte er Teil (b) — der Impl-Agent durfte die volle
Suite nicht fahren und konnte die Flakes deshalb nicht reproduzieren. Fuer Phasen, in denen
der volle Suite-Lauf das MESSINSTRUMENT ist und nicht nur die Regressionsprobe, muss der
Riegel gelockert werden.

---

## 7. Ausdruecklich nicht Teil der Kette

`ID-01` (Besitznachweis eigene Nummer, Owner-Entscheidung 2026-09-08), `L-04`, `GATE-04`, `W4`.

---

## 8. Betriebswissen in einem Absatz

Render deployt aus dem **Upstream**-Repo `jonas986/vodafone-agent`; `git push origin` bewirkt
live nichts. Gateway `vodafone-agent`: Auto-Deploy **aus**, braucht Manual Deploy. Marketing
`hermes-web`: Auto-Deploy **an**, baut bei jedem Commit auf `master`. Beide Services sind
**dashboard-managed** — `render.yaml` ist Dokumentation, kein Live-Zustand. Der pg-Store haelt
Zustand im Speicher: nach einem direkten DB-Schreibzugriff muss der Dienst neu starten. Die
Tenant-Tabellen tragen FORCE-RLS (`SET app.current_tenant` noetig), die Tabelle `profile`
dagegen eine permissive Policy (kein `SET` noetig).
