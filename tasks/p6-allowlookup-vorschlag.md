# P6 — `allowLookup` freischalten: Analyse + fertiger Umsetzungsvorschlag

Stand: 2026-08-11. Grundlage: `tasks/PLAN-WERKZEUGWAHL.md` Abschnitt P6 (Owner-Entscheidung
2026-08-11). Diese Datei ist ein **Vorschlag**, nichts davon ist ausgefuehrt. Kein Produktivcode
geaendert, kein Commit, kein Schreibzugriff auf die Prod-DB.

---

## 1. Die entscheidende Frage: gewinnt die DB oder die Konstante?

**Die gespeicherte DB-Zeile gewinnt. Ein reiner Code-Flip in `src/plans.js` bleibt fuer den
bestehenden Live-Tenant WIRKUNGSLOS.**

Die Aufloesungskette, vollstaendig am Code:

| Schritt | Datei:Zeile | Was passiert |
|---|---|---|
| Lesepunkt im Anruf | `src/research/in-call.js:68` | `store.resolveProfile(call.tenantId)?.allowLookup === true` |
| Store-Fassade | `src/store/state-ops.js:3677-3679` | `resolveProfileFrom(tenantId, s.profiles[tenantId])` |
| Merge-Regel | `src/store/defaults.js:974-977` | siehe unten |

```js
// src/store/defaults.js:974-977
export function resolveProfileFrom(tenantId, storedProfile) {
  if (tenantId === BOOTSTRAP_TENANT_ID) return { ...OWNER_PROFILE }; // R2: Owner nie gesperrt
  return storedProfile ? { ...DEFAULT_PROFILE, ...storedProfile } : { ...DEFAULT_PROFILE };
}
```

**`resolveProfileFrom` sieht `PLAN_PROFILE` NIE.** Es kennt genau drei Quellen: `OWNER_PROFILE`
(hart, nur `BOOTSTRAP_TENANT_ID`), das **gespeicherte** Profil und `DEFAULT_PROFILE` als
restriktiven Boden. Die Plan-Konstante steht nicht im Lesepfad — sie ist ausschliesslich eine
**Schreib-Vorlage**.

Beleg dafuer, dass es keinen zweiten Lesepfad gibt: `planProfileFor` (`src/plans.js:133-135`) hat
projektweit genau **einen** Aufrufer, `src/billing/plan-profile-resolver.js:26`. Der wiederum wird
von genau **zwei** Stellen gerufen — `src/billing/activation.js:39` und
`src/billing/backfill-profiles.js:57`. Beide sind Schreibpfade.

Damit ist das gespeicherte Profil ein **Schnappschuss** der Konstante zum Zeitpunkt der letzten
Aktivierung. Das ist exakt das Muster, das das Repo als "additiv-nullable braucht IMMER Backfill"
schon einmal teuer gelernt hat — nur mit einem existierenden statt einem fehlenden Feld.

### Verschaerfend: der pg-Store haelt den Zustand im Speicher UND schreibt ihn zurueck

- `src/store/pg.js:72-106` — `init()` hydriert den Spiegel **einmal** beim Boot
  (`hydrateProfiles`, `src/store/pg.js:813-816`: `SELECT tenant_id, data FROM profile`).
- `src/store/pg.js:61-64` — jeder Lesezugriff geht ueber `requireState()`, also gegen den
  **Speicher**, nie gegen die DB.
- `src/store/pg.js:118-136` + `:1270-1294` — jede Mutation flusht den **kompletten** Spiegel;
  `flushProfiles` (`src/store/pg.js:1705-1715`) ist ein Voll-Upsert
  (`ON CONFLICT (tenant_id) DO UPDATE SET data=EXCLUDED.data`) mit vorgeschaltetem
  `deleteMissingProfiles` (`:1740-1746`).

**Folge:** ein von Hand abgesetztes `UPDATE profile ...` waehrend der Server laeuft ist (a) fuer
den laufenden Prozess unsichtbar und (b) wird beim naechsten beliebigen `save()` — ein Anruf, ein
Transkript-Segment, ein Usage-Buchung — wieder **ueberschrieben**. Der Handgriff sieht aus wie ein
Erfolg und ist innerhalb von Minuten weg.

---

## 2. Wird das gespeicherte Profil je neu geschrieben?

Nur ueber `store.setProfile`. Genau zwei Aufrufer:

| Ausloeser | Datei:Zeile | Schreibt das Profil neu? |
|---|---|---|
| Stripe `customer.subscription.created/updated` mit Status `active`/`trialing` | `webhook.js:106-132` -> `:285` -> `activation.js:106` -> `:41` | **JA** |
| Self-Service-Subscribe / Checkout-Return | `subscribe.js:181`, `:199`; `self-service-routes.js:150` -> `activation.js:41` | **JA** |
| Backfill-Skript `--apply` | `scripts/backfill-plan-profiles.js:42-43` -> `backfill-profiles.js:71` | **JA** |
| **Login** (Browser/OIDC) | — | **NEIN.** Kein `setProfile` im Login-Pfad. |
| **Admin-approve** | `web-auth.js:797` (Kommentar sagt es woertlich: laeuft NICHT durch `activatePaidTenant`) | **NEIN** |
| **`POST /api/onboard/retry`** | `routes/api-onboard.js:257-277` — ruft nur `triggerTenantProvisioning` | **NEIN** |
| **Abo-Erneuerung** | `invoice.paid` / `invoice.payment_succeeded` stehen **nicht** in der Ereignistabelle (`webhook.js:21-24`, nur `invoice.payment_failed`) | **NUR indirekt**, wenn Stripe zusaetzlich ein `customer.subscription.updated` sendet — **UNBELEGT** fuer die hier verwendete API-Version. Nicht als Mechanismus darauf verlassen. |

`setProfile` ist formal ein Merge (`state-ops.js:3720-3724`), wirkt hier aber wie ein Replace:
`PAID_PLAN_PROFILE` traegt **jedes** `PROFILE_FIELDS`-Feld explizit (`plans.js:105-120`,
begruendet im Kopfkommentar `:76-77`).

---

## 3. HARTE VORBEDINGUNG, heute NICHT erfuellt

`PLAN-WERKZEUGWAHL.md:228`: "P1 ist gemergt. Sonst laeuft `look_up` live in HTTP 400."

Gemessener Git-Stand:

```
$ git branch --show-current      -> phase/werkzeugwahl
$ git log --oneline -1 636e739   -> fix(werkzeugwahl): P1 - rekonstruierte tool_calls tragen type:function
$ git merge-base --is-ancestor 636e739 master  -> FALSCH  ("P1 NICHT in master")
$ git log --oneline -1 master    -> d407cda docs(kickoff): Uebergabe der Kappungs-Kette
```

**P1 ist committet, aber nur auf `phase/werkzeugwahl`. `master` traegt ihn nicht, also traegt ihn
auch kein Deploy.** Zusaetzlich (Repo-Lehre `deploy-repo-split`): Render deployt **upstream**
(`jonas986`), `git push origin` macht nichts live. Wer P6 vor dem Merge + Deploy von P1 scharf
schaltet, produziert genau das Pre-Mortem-Szenario 1 des Plans.

---

## 4. Umsetzung — die exakten Schritte

### Schritt 0 (Vorbedingung, nicht verhandelbar)

P1 (`636e739`) nach `master` mergen **und** upstream deployen. Danach am Boot-Log oder am
Deploy-Commit belegen, dass der laufende Prozess ihn traegt. Deploy-Stand **nie** aus einer Notiz
lesen (Repo-Lehre `kosten-endspiel-live-verified`).

### Schritt 1 — Code-Flip (`src/plans.js`)

```diff
@@ src/plans.js:89-93 (Kopfkommentar von PAID_PLAN_PROFILE)
 //   allowConsult=true        - Owner-Entscheidung 2026-08-11: Kernfunktion des Produkts,
 //                              fuer alle Plaene freigeschaltet (kein Owner-Vorbehalt mehr)
-//   allowLookup=false        - AL-P10b: dasselbe fuer den In-Call-Nachschlag (er bringt
-//                              einen ZWEITEN Auftragsverarbeiter mit)
+//   allowLookup=true         - Owner-Entscheidung 2026-08-11 (P6): dasselbe fuer den
+//                              In-Call-Nachschlag. Der ZWEITE Auftragsverarbeiter (Exa)
+//                              ist damit bewusst akzeptiert; die Deckel bleiben:
+//                              LOOKUP_MAX_PER_CALL=2 je Anruf, Egress-Filter, Gebuehr
+//                              auf die Tenant-Kostendecke.
```

```diff
@@ src/plans.js:115-117 (im Objekt)
-  // AL-P10b: der Nachschlag bleibt eine Owner-Faehigkeit, bis Testanruf und
-  // Datenschutzerklaerung durch sind (zweiter Auftragsverarbeiter) - kein Plan-Freibrief.
-  allowLookup: false,
+  // Owner-Entscheidung 2026-08-11 (P6): der Nachschlag ist keine Owner-Faehigkeit mehr.
+  // Der zweite Auftragsverarbeiter (Exa) bleibt bestehen und ist bewusst akzeptiert;
+  // die Datenschutzerklaerung traegt der Owner separat. Unveraendert wirksam bleiben:
+  // LOOKUP_MAX_PER_CALL=2 (research/in-call.js:24), der Egress-Filter
+  // (research/lookup-guard.js), die Richtungs-/Status-Gates (in-call.js:60-70) und die
+  // Gebuehrenbuchung auf die pro-Tenant-Kostendecke (llm-usage.js:132-134).
+  allowLookup: true,
```

Keine weitere Code-Aenderung noetig: `LOOKUP_ENABLED`, `ASSISTANT_CONTEXT_ENABLED` und
`EXA_API_KEY` sind laut Boot-Banner Deploy `a3e3ee5` live gesetzt (Beleg aus
`PLAN-WERKZEUGWAHL.md:32-34`, von mir **nicht** neu gemessen).

### Schritt 2 — Test, der den SOLL-Zustand pinnt (`test/plan-profile.test.js`)

Direkter Spiegel des bestehenden `allowConsult`-Tests (`test/plan-profile.test.js:39-44`), damit
ein spaeteres stilles Zuruecksetzen rot wird:

```js
test("Owner-Entscheidung 2026-08-11 (P6): allowLookup ist fuer JEDEN Katalog-Slug true", () => {
  for (const slug of CATALOG_SLUGS) {
    const profile = planProfileFor(slug);
    assert.equal(profile.allowLookup, true, `${slug}: allowLookup != true`);
  }
});
```

Gegengeprueft: **kein** Bestandstest pinnt heute `allowLookup === false` fuer einen Katalog-Slug
(`grep -rn "allowLookup" test/` -> nur `al-p10b-lookup.test.js:260` (Kommentar zu einem
profillosen Tenant), `werkzeugwahl-p0-bench-config.test.js:79/86`,
`profile-a2-activation.test.js:89` (Feld-ANZAHL 8, nicht der Wert)).

```
node --check src/plans.js
npm test
```

### Schritt 3 — Merge + Deploy

`master` -> upstream deployen. Der Deploy startet den Prozess neu; er hydriert die Profile aus der
DB und liest dort weiterhin `allowLookup:false`. **Nach diesem Schritt ist noch nichts wirksam.**
Das ist der Punkt, an dem ein Schein-Fix als Erfolg verbucht wuerde.

### Schritt 4 — das gespeicherte Profil neu schreiben lassen (der eigentliche Schritt)

Drei Wege, in dieser Reihenfolge empfohlen:

**Weg A (empfohlen): den vorhandenen Schreibpfad ausloesen — kein DB-Handgriff, kein Neustart.**

In Stripe fuer die Subscription dieses Tenants ein `customer.subscription.updated` mit
Status `active` erzeugen (Metadaten-Aenderung an der Subscription oder Re-Delivery des letzten
solchen Events aus dem Stripe-Dashboard). Der Webhook laeuft **im laufenden Prozess**:

`stripe-webhook`-Route -> `webhook.js:285` -> `activation.js:106` -> `provisionPlanProfile`
-> `activation.js:41` `store.setProfile(tenant, tier)` -> `save()` -> `flushProfiles`.

Damit sind Speicher **und** DB in einem Zug korrekt. Kein Clobber-Fenster, kein Neustart.

Dedupe beachten: `webhook.js:420-439` verwirft eine Re-Delivery **derselben** `event.id`, solange
der Prozess laeuft (`lastAppliedByKey`, in-process, `webhook.js:395-400`). Nach dem Deploy aus
Schritt 3 ist die Map leer — eine Re-Delivery direkt danach greift. Ein **neues** Event (echte
Subscription-Aenderung) greift immer.

**Weg B: Backfill-Skript.** Nur wenn Weg A ausfaellt.

```
# Dry-Run zuerst, IMMER (Default ist Dry-Run):
node scripts/backfill-plan-profiles.js
# erwartete Zeile:  [backfill] mode=DRY-RUN scanned=N changes=1 ...
#                   replace t_user_01KX600834GCJFV9GTZQKWZMTH
node scripts/backfill-plan-profiles.js --apply
```

Zwei harte Randbedingungen:

1. Das Skript braucht `STORE_BACKEND=pg` + `DATABASE_URL` (bei `json` ist es ein bewusster No-Op,
   `scripts/backfill-plan-profiles.js:15-18`). Lokal ist heute **weder** `~/.config/hermes/db-url`
   **noch** ein `DATABASE_URL` in `.env` vorhanden (geprueft) — die Prod-DB haengt zusaetzlich an
   einer IP-Allowlist. Auf Render existiert im Free-Tier keine Shell/kein Job (Repo-Lehre
   `owner-removal-chain`). **Der Ausfuehrungsort ist damit UNBELEGT und muss vorher geklaert
   werden.**
2. **Clobber-Gefahr:** laeuft der Server waehrenddessen, ueberschreibt sein naechster `save()` das
   Ergebnis mit dem alten Speicherstand (`pg.js:1270-1294`). Reihenfolge daher zwingend:
   Backfill -> **sofort** Neustart/Deploy des Dienstes -> Verifikation. Sauberer: den Dienst fuer
   die Dauer suspendieren.

**Weg C (NICHT empfohlen): `UPDATE profile SET data = ... WHERE tenant_id = ...` von Hand.**
Gleiche Clobber-Gefahr wie Weg B, zusaetzlich ohne Sanitizing/Idempotenz-Vergleich und ohne
Report. Nur als Notnagel, und dann ausschliesslich bei gestopptem Dienst.

### Schritt 5 — Verifikation (siehe Abschnitt 7)

---

## 5. Nebenwirkungen des Flips

**Wer bekommt `look_up`?**

- **Sofort niemand.** Der Flip aendert nur die Schreib-Vorlage. Betroffen ist ein Tenant erst,
  wenn sein Profil neu geschrieben wird (Abschnitt 2).
- **Danach: jeder Tenant auf `starter` ODER `business`** — beide Slugs zeigen auf dasselbe Objekt
  (`plans.js:125-128`). Es gibt keinen Weg, nur einen Tarif freizuschalten, ohne die Objekt-Teilung
  aufzubrechen.
- **Alle kuenftigen Aktivierungen** tragen `allowLookup:true` ab Deploy automatisch.
- Wie viele bezahlte Tenants es heute gibt: **UNBELEGT** — kein Prod-DB-Zugriff verfuegbar
  (`~/.config/hermes/db-url` fehlt, kein `DATABASE_URL` lokal). Laut Repo-Lehre
  `no-existing-customers-premise` sind alle aktiven Accounts wir selbst; das ist eine Notiz, kein
  frischer Messwert.

**Wo `look_up` trotz `allowLookup:true` NICHT erscheint** (`src/research/in-call.js:60-70`,
Schnittmenge, fail-closed in jedem Faktor):

`LOOKUP_ENABLED` aus | `ASSISTANT_CONTEXT_ENABLED` aus | Realtime-Engine | `direction !== "outbound"`
(**Inbound ist strukturell ausgeschlossen**) | `status !== "active"` | Kontingent
`callLookups(call) >= 2` erschoepft | `EXA_API_KEY` leer (`research/registry.js:53-56`).

**Kosten.**

- Preis je Suche: `LOOKUP_SEARCH_FEE_CENTS`, Default **1 Cent**, hergeleitet und belegt gegen die
  Exa-Preisliste (`src/config.js:519-529`: $7/1k Anfragen + $1/1k Seiten, bei 3 Treffern = genau
  1,0 US-Cent). Ab 4 Treffern muesste der Wert steigen; der Test AL-P10c-3 haelt die Relation zu
  `LOOKUP_MAX_FACTS` fest.
- Harter Deckel je Anruf: `LOOKUP_MAX_PER_CALL = 2` (`research/in-call.js:24`), bewusst **ohne**
  Env-Knopf. Also **hoechstens 2 Cent je Anruf**.
- Die Gebuehr wird **vor** dem Absenden gebucht (`research/in-call.js:108-111`) — eine ausgeloeste
  Suche ist bezahlt, auch ohne Antwort.
- Buchungsachse: `bookLookupSearchFee` -> `addResearchFeeCostCents` (`llm-usage.js:132-134`) —
  dieselbe Live-Cent-Achse, die die **pro-Tenant-Kostendecke** liest. Der Deckel greift also.
  **Nicht** gebucht wird auf den Stripe-Ledger (`usage_event` kennt keine research-Art) — bewusst,
  dokumentiert: Unterbuchung dort ist Umsatzverlust, kein Schutzverlust.
- Kein Sicherheits-Gate wird beruehrt: nicht `OUTBOUND_FROZEN`, nicht die Verifikation, nicht die
  Signaturpruefung, nicht die Offenlegung.

**Welche Daten gehen an welchen Dienst (sachlich, ohne Bewertung).**

Empfaenger: **Exa** (`https://api.exa.ai/search`, `research/adapters/exa-search.js:21,42-61`),
`POST` mit `x-api-key`.

Gesendet wird ausschliesslich `{ query, type:"auto", numResults:3, contents:{highlights:true} }`.
`query` ist ein vom Modell **formulierter** Suchstring, kein Transkript-Auszug. Vorher laeuft der
Egress-Filter `sanitizeLookupQuery` (`research/lookup-guard.js:66-74`), der deterministisch
verwirft: Ziffernfolgen ab 5 Stellen (auch mit Trennzeichen geschrieben), E-Mail-artige Muster,
die Rufnummer des Angerufenen und woertliche Uebernahmen aus dem Transkript; danach Kappung auf
120 Zeichen. **Nicht** gesendet: Rufnummern, Call-ID, Tenant-ID, Transkript, Namen.
Die Datei benennt ihre Reichweite selbst ehrlich (`lookup-guard.js:5-14`): es gibt **keinen**
Namensfilter und **keine** Schlagwortliste fuer Gesundheits-/Finanz-/Personenbezug — diese
Restflaeche traegt allein die Werkzeug-Beschreibung ("ohne Personenbezug"). Zurueck kommen
hoechstens 3 Zeilen "Titel: Auszug" **ohne URL** (`exa-search.js:29-34`), gefiltert durch
`lookupFactsFrom` und gekappt auf die `key_facts`-Laenge.

Die Rechts-/Datenschutzbewertung traegt laut Plan der Owner; hier steht nur der Sachverhalt.

---

## 6. Pre-Mortem — ein Jahr weiter, der Flip war ein Fehler

1. **Der Flip wirkte nie, und niemand hat es gemerkt.**
   `src/plans.js` wurde geaendert, deployt, abgehakt. Das gespeicherte Profil des Live-Tenants
   blieb `false`, `look_up` stand nie im Werkzeugsatz. Monate spaeter wurde die Ursache wieder im
   Prompt gesucht — dritte Prompt-Runde, wieder ohne Wirkung.
   *Gegenmittel:* Schritt 4 ist nicht optional, und Schritt 5 verlangt **einen Beleg aus einem
   echten Anruf** (`offeredToolNames` enthaelt `look_up`), nicht den Deploy-Commit.

2. **Der Backfill wurde vom laufenden Server ueberschrieben.**
   `UPDATE`/Backfill lief bei laufendem Dienst, die DB-Zeile war 20 Minuten lang richtig, dann
   flushte der naechste Anruf den alten Speicherstand zurueck. Der Befund "es war doch richtig
   gesetzt" hat die Diagnose vergiftet.
   *Gegenmittel:* Weg A (Schreibpfad im Prozess) statt Handgriff; bei Weg B zwingend
   Backfill -> sofort Neustart, besser Dienst vorher suspendieren.

3. **P6 ging vor P1 live.**
   `look_up` wurde angeboten, feuerte, und die zweite Tool-Runde brach im Stream-Pfad mit
   HTTP 400 "missing field `type`" ab. Der Anrufer hoerte Stille; das sah aus wie ein
   Modellproblem. Heute belegt: `636e739` liegt **nicht** in `master`.
   *Gegenmittel:* Schritt 0 mit `git merge-base --is-ancestor` pruefen, nicht aus einer Notiz
   lesen.

4. **Ein Tarif hat mitgehangen, den niemand freischalten wollte.**
   `starter` und `business` teilen **ein** Objekt (`plans.js:125-128`). Wer glaubte, nur den
   teuren Tarif zu oeffnen, oeffnete beide — und mit der naechsten Aktivierung jeden Neukunden.
   *Gegenmittel:* im Commit ausdruecklich festhalten, dass beide Tarife gemeint sind; wer das
   nicht will, braucht zwei Profil-Objekte, nicht ein `if`.

5. **Eine Suchanfrage trug doch Personenbezug nach draussen.**
   Der Egress-Filter faengt Ziffern, Mails, Zielnummer und Zitate — **keine Namen**
   (`lookup-guard.js:5-14`, selbst so dokumentiert). Ein Modell formulierte "Oeffnungszeiten
   Praxis Dr. <Nachname> <Ort>" und schickte damit einen Personen-/Gesundheitsbezug an Exa.
   *Gegenmittel:* die Restflaeche ist bekannt und akzeptiert — sie gehoert vor der Freischaltung
   in `PLAN-SECURITY.md` als benanntes Restrisiko, nicht als Ueberraschung in ein Post-Mortem.
   Zusaetzlich: `[lookup] fertig`-Zeilen der ersten Woche auf Trefferzahl/Frequenz sichten
   (die Query selbst wird bewusst nie geloggt).

6. **Der Schnappschuss-Mechanismus schlaegt beim naechsten Recht wieder zu.**
   Die naechste Rechte-Aenderung an `PAID_PLAN_PROFILE` lief in exakt dieselbe Falle, weil die
   Lehre am Einzelfall statt am Mechanismus notiert wurde.
   *Gegenmittel:* die Lehre "Plan-Profil ist ein Schnappschuss, kein Live-Recht — jede Aenderung
   braucht einen Rewrite-Schritt" in `tasks/lessons.md`. Die strukturelle Alternative (das
   Tier-Profil bei `resolveProfileFrom` **lesend** ueberlagern) ist ein eigener Umbau mit
   Sicherheits-Blast-Radius — hier ausdruecklich **nicht** vorgeschlagen, nur benannt.

---

## 7. Verifikation — womit belege ich, dass `look_up` WIRKLICH im Satz steht?

**V1 — Speicher/DB-Stand (notwendig, nicht hinreichend).** Nur lesend:

```sql
-- profile steht unter policy profile_global (USING true) -> naives SELECT liefert Zeilen,
-- anders als bei den tenant-scoped FORCE-RLS-Tabellen.
SELECT data->>'allowLookup' FROM profile WHERE tenant_id = 't_user_01KX600834GCJFV9GTZQKWZMTH';
-- ERWARTET: true
```

Beweist die **Zeile**, nicht den **Prozess**. Bei Weg B ohne Neustart kann der Prozess weiter
`false` im Speicher halten.

**V2 — der Beleg, auf den es ankommt: ein echter Outbound-Anruf.**
Die unconditional Log-Zeile (`telnyx-llm-shim.js:347-349`, Format `formatLogLine`:
`"[telnyx-shim] turn_ok " + JSON.stringify(payload)`) traegt `offeredToolNames`
(`telnyx-llm-shim.js:191-193`, gespeist aus `claude.js:1170`):

```
[telnyx-shim] turn_ok {"callId":"...","turnSeq":1,...,"offeredToolNames":["end_call","take_message","look_up","get_consult"],...}
```

Suchbefehl in den Render-Logs (bzw. auf der Log-Datei):

```
grep 'turn_ok' <log> | grep 'look_up'
```

**Positiv-Kontrolle mitfuehren** (Repo-Lehre `pruefkommando-ohne-positiv-kontrolle`: "nichts
gefunden" sieht aus wie "sucht nichts"):

```
grep -c 'turn_ok' <log>          # muss > 0 sein, sonst sucht der Befehl ins Leere
grep -c 'offeredToolNames' <log> # muss > 0 sein
```

**V3 — hat es auch gefeuert?** (`research/in-call.js:81-83`)

```
grep '\[lookup\] fertig' <log>
# [lookup] fertig call=<id> ok=true dauer_ms=<n> fakten=<n>
```

`ok=false` + `fakten=0` heisst: angeboten und ausgeloest, aber der Anbieter hat nichts geliefert —
das ist ein **Anbieter**-Befund, kein Freischalt-Befund. `[lookup] verworfen grund=egress`
(`:76-78`) heisst: der Egress-Filter hat die Query gestoppt — ebenfalls kein Freischalt-Befund.

**V4 — Gegenprobe am Prompt.** Ist `look_up` freigeschaltet, rendert `b.noLookup` nicht mehr,
sondern `b.lookupAllowed` (`claude.js:172-177`). Der Prompt wird nicht geloggt; diese Probe laeuft
nur ueber einen Renderer-Test oder den Bench, nicht am Live-Log. Als **Ergaenzung** zu V2 zu
verstehen, nicht als Ersatz.

Bewusst **kein** Beleg: der Deploy-Commit, das Boot-Banner (`boot.js:549` zeigt nur die globalen
Schalter, ausdruecklich mit dem Zusatz "wirkt nur mit allowLookup am Tenant") und ein gruener
`npm test` — alle drei sind mit einem wirkungslosen Flip vollstaendig vereinbar.

---

## 8. Rueckweg

Der Rueckweg braucht **zwei** Handgriffe — derselbe Grund wie der Hinweg:

1. **Sofort und global, ohne Deploy:** `LOOKUP_ENABLED=false` am Dienst setzen. `look_up`
   verschwindet aus dem Werkzeugsatz jedes Tenants (`research/registry.js:54`,
   `research/in-call.js:61`), es entsteht kein Egress und keine Gebuehr. Das ist der Notaus.
   (Er beruehrt einen Env-Wert, nicht die Profile — der Kunde behaelt sein Recht formal.)
2. **Dauerhaft:** `src/plans.js` zuruecksetzen (`allowLookup: false`), Test zuruecknehmen, mergen,
   deployen — **und danach denselben Rewrite-Schritt 4 erneut fahren.** Ohne ihn behaelt der
   bestehende Tenant `allowLookup:true` in der DB, und der Code-Rueckbau ist genauso wirkungslos
   wie der Flip es ohne Schritt 4 gewesen waere. Das ist die Symmetrie, die man beim Rollback
   erfahrungsgemaess vergisst.

Kein Gate, kein Secret und keine Auth-Route ist an diesem Vorgang beteiligt; ein Rollback hat
keinen Datenverlust zur Folge.
