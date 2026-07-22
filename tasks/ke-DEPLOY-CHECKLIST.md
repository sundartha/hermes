# Deploy-Checkliste Kosten-Endspiel (KE-P0 .. KE-P8)

> **UEBERHOLT ab 2026-07-22, 08:15 UTC:** KE-P0..P8 sind LIVE (Deploy `5c2c59e`,
> Boot-Banner verifiziert). Der Satz "nicht deployed" unten galt bis zu diesem
> Deploy. Die Live-Verifikation nach Kap. 4 ist gelaufen und BESTANDEN, ihr
> Ergebnis steht in Kap. 7. **Einzige Wahrheit ueber den Live-Stand ist immer der
> `[boot] deployed commit=<sha>`-Banner im Render-Log, nie diese Datei.**
>
> **Offen und NICHT deployed: KE-P9** (Merge `65f4aff`) — s. Kap. 8.

Stand 2026-07-22. Code auf `master`, **nicht deployed**. Live laeuft weiterhin `3516c31`.

Diese Liste ist fuer den Owner. Alles darin ist Owner-Aktion — die Umsetzung hat bewusst
**nicht** deployed, keine Render-Env angefasst und keinen Sweep ausgeloest.

---

## 0. Was ueberhaupt live geht

| Klammer | Phasen | Wirkung |
| --- | --- | --- |
| **Klammer 1** | KE-P0 + KE-P1 | Beobachtbarkeit (Fehlerpfad sichtbar) + tote Sicherung ersetzt. Macht das System **konservativer**: mehr `incomplete`, weniger Rueckerstattungen. Die Abweichung geht zulasten der Marge, nie zulasten des Kunden. |
| **Klammer 2** | KE-P2, P3, P4, P5, P6, P6B, P8 | Der eigentliche Fix: ein Belegabruf je Sweep statt je Kandidat, Paginierung, Drossel, Zeitschranke, ElevenLabs je Tenant, kuerzere Kadenz, Bruchpunkt-Waechter. |

Die Klammern sind **unabhaengig deploybar**. Klammer 1 allein ist sinnvoll (Empfehlung 6 des
Plans), weil eine tote fail-closed-Sicherung der einzige Befund ist, der ohne Weiterarbeit
gefaehrlich bleibt.

**Wenn beides zusammen deployt wird, ist das ebenfalls in Ordnung** — die Reihenfolge der
Phasen ist im Code bereits eingehalten.

---

## 1. Env-Auflagen (Render-Dashboard) — VOR oder MIT dem Deploy

### 1.1 PFLICHT: `COST_TRUING_MAX_ATTEMPTS` zurueck auf **5**

Am 2026-07-21 wurde der Wert auf **20** gesetzt (Fristverlaengerung, damit der historische
Bestand von 29 offenen Calls nicht abgeschrieben wird, Plan-Entscheidung 5c).

**Nach dem Deploy von Klammer 2 muss er zurueck auf 5.** Sonst bleibt das abzudeckende
Fenster W bei `3 h + 20 x 1 h = 23 h` statt der geplanten **8 h** — der Pool und damit die
Seitenzahl je Sweep waechst unnoetig mit.

> Der Zaehler selbst ist persistiert; ein Neustart nullt ihn NICHT.

### 1.2 NEU: `COST_TRUING_SWEEP_INTERVAL_MS`

| | |
| --- | --- |
| Wert | `3600000` (1 h) |
| Default im Code | `3600000` — **wenn nicht gesetzt, gilt genau dieser Wert** |
| Vorher | 6 h, hartkodiert in `cost-truing.js` |
| Riegel | `< 60000` -> **Boot-Refusal** (fatal). Obergrenze auf die Node-Timer-Grenze `2147483647` geklemmt. |

**Setzen ist optional** (der Default ist der gewuenschte Wert). Wer ihn setzt, startet den
Dienst neu — und der Neustart setzt die Sweep-Uhr zurueck (beim Boot laeuft bewusst kein
Sweep).

### 1.3 GEAENDERTER DEFAULT: `COST_TRUING_DELAY_MINUTES`

| | |
| --- | --- |
| Neuer Default | **30** (vorher 180) |
| Begruendung | Plan F3: Belege sind spaetestens nach **133 s** vollstaendig UND wertrichtig. 30 min sind ein 13-facher Sicherheitsabstand. |

**Achtung:** ist die Variable im Render-Dashboard **explizit auf 180 gesetzt**, wirkt der
neue Default NICHT. Dann entweder loeschen (Default greift) oder auf `30` setzen.
**Vor dem Deploy im Dashboard nachsehen.**

### 1.4 Unveraendert, aber Vorbedingung fuer die Abnahme

`COST_TRUING_REQUIRED_RECORD_TYPES` = `sip-trunking,call-control` (Owner-Auskunft
2026-07-21). Ohne diesen Wert ist `gemessen>0` nicht interpretierbar. Ist er **leer**,
verweigert der Dienst den Start (fatal, by design — lokal verifiziert).

### 1.5 Keine weiteren neuen Env-Variablen

Die Kette fuehrt **genau eine** neue Variable ein (1.2). Alles andere sind Konstanten im
Code, bewusst ohne Env-Schalter — insbesondere die Drossel (30 von 40) und die
Waechter-Schwelle (1440): eine Warnschwelle, die sich hochdrehen laesst, ist die Sicherung,
die an ihre eigene Verletzung angepasst wird.

---

## 2. Schema-Aenderung — laeuft automatisch, aber kennen

KE-P6 fuegt **eine Spalte** hinzu:

```sql
ALTER TABLE usage ADD COLUMN IF NOT EXISTS tts_characters BIGINT NOT NULL DEFAULT 0;
```

- `IF NOT EXISTS` + `DEFAULT 0` -> idempotent, kein Datenverlust, kein Rueckbau noetig.
- **Spalte** statt neuer Tabelle: erbt damit die bestehende `tenant_isolation`-RLS der
  `usage`-Tabelle, statt eine neue Policy zu brauchen.
- Reine Sichtbarkeit: **kein Gate liest sie**.

---

## 3. Deploy

1. Deploy ausloesen (Render-Dashboard). `autoDeploy` war am 2026-07-21 **AUS** — ein Push
   allein hat also nichts live gebracht. **Deploy-Status trotzdem selbst nachsehen:** der
   Live-Service hatte schon einmal `autoDeploy` an trotz `render.yaml: false`.
2. `[boot]`-Banner auf den erwarteten Commit pruefen (`[boot] deployed commit=<sha>`).
3. `/healthz` -> `200 {"ok":true}`.

---

## 4. Phase 7 — Live-Verifikation (OWNER, woertliches Abnahmekriterium)

### 4.1 Befehl

**Einen** manuellen Sweep ausloesen (hinter Basic-Auth):

```
POST /api/billing/cost-truing/sweep
```

**NICHT** `scripts/sweep-jetzt.sh` verwenden, solange Klammer 2 nicht live ist — das Skript
loest den alten Pfad mit 224 Anfragen aus.

### 4.2 Die Log-Zeile, auf die es ankommt

```
[cost-truing] sweep trigger=manual kandidaten=<n> gemessen=<n> unvollstaendig=<n> \
  ohne_schaetzung=<n> unbestimmt=<n> uebersprungen=<n> \
  anfragen=<n> seiten=<n> pool=<n> vollstaendig=<bool>
```

Die vier Felder ab `anfragen=` sind neu (KE-P6). Die Bestandsfelder stehen unveraendert
davor — Log-Konsumenten brechen nicht.

### 4.3 GRUEN heisst (alle vier Bedingungen)

| # | Bedingung | Wert |
| --- | --- | --- |
| 1 | `anfragen=` | **einstellig bis niedrig zweistellig** (erwartet 6–14). Vorher gemessen: **224**. |
| 2 | `vollstaendig=` | **`true`** |
| 3 | `gemessen=` | **> 0** (vorher: `gemessen=0` bei 33 Kandidaten, ohne Fehlergrund) |
| 4 | kein `status=429` | in keiner `[telnyx/voice] getVoiceCostRecords fehler`-Zeile |

### 4.4 Zusaetzlich pruefen: die Geld-relevante Sonde

In der Zeile

```
[telnyx/voice] getVoiceCostRecords ok records=<n> via_anchor=<n> via_telnyx_session_id=<n> via_call_session_id=<n> rejected={...}
```

muss `via_anchor` gegenueber den Session-Wegen **in derselben Groessenordnung bleiben wie
gemessen** (Plan F4: 3 Anker zu 9 Session-Belegen; live zuvor 4 von 7 bzw. 9 von 10).

**Ein Sprung dort ist das Frueherkennungssignal fuer fremde Belege** — also fuer eine
Fehlbuchung auf einen fremden Tenant. Der Grund: `call-control` traegt keinen Anker und ist
Pflicht-Typ, damit haengt **jede Rueckerstattung am Session-Weg**.

### 4.5 ABBRUCH / ROLLBACK

Erscheint **`status=429`** oder **`vollstaendig=false`**:

> **Nicht nachjustieren, sondern zurueckrollen** und Phase 3/4 nachbessern.

Das ist die Regel aus dem Plan, woertlich. Grund: beides heisst, dass der Abruf die Menge
nicht sicher einsammelt — und ein "wir drehen mal an der Schwelle" waere genau die Sicherung,
die an ihre eigene Verletzung angepasst wird.

### 4.6 Was NICHT als Fehler zu werten ist

- `unvollstaendig=<n>` > 0 bei `vollstaendig=true`: das sind Calls, deren **Pflicht-Typmenge**
  nicht komplett ist — eine Aussage ueber den einzelnen Call, nicht ueber den Abruf.
- Deckungsquote < 80 % im ersten Lauf: die Quote ist eine Lebenszeit-Groesse ueber alle
  beendeten Outbound-Calls. Sie kann strukturell nie ueber **90,9 %** steigen, weil 3
  `failed`-Calls ohne Leg-Referenz dauerhaft im Nenner stehen.

---

## 5. Erwartete Wirkung nach dem Deploy

| Groesse | vorher | nachher |
| --- | --- | --- |
| Anfragen je Sweep (32 Kandidaten) | 224 gemessen | **6–14** |
| Anfragen je Seitenrunde | 7 | **6** (`inference` entfaellt) |
| Sweep-Kadenz | 6 h | **1 h** |
| Verzug bis zum ersten Versuch | 180 min | **30 min** |
| Abzudeckendes Fenster W | 33 h | **8 h** (nur mit Auflage 1.1!) |
| Deckungsquote | 0 % | > 0 erwartet |
| ElevenLabs-Zeichen je Tenant | nicht erfasst | erfasst (auch Assistant-Pfad) |

---

## 6. Rollback

`git revert` des jeweiligen Merge-Commits, oder Deploy des vorherigen Commits. Die
Schema-Spalte kann bleiben (`DEFAULT 0`, kein Leser ausserhalb der neuen Achse) — sie muss
fuer einen Rollback **nicht** entfernt werden.

---

## 7. Ergebnis der Live-Verifikation (2026-07-22, Deploy `5c2c59e`)

Erster Sweep nach dem Deploy, `trigger=interval` um 09:15:15 UTC (Deploy 08:15 +
1 h Kadenz — der neue `COST_TRUING_SWEEP_INTERVAL_MS`-Default greift):

```
kandidaten=33 gemessen=3 unvollstaendig=0 ohne_schaetzung=27 unbestimmt=0
uebersprungen=3 anfragen=16 seiten=16 pool=697 vollstaendig=true
```

Abnahme gegen Kap. 4.3:

| # | Bedingung | Ist | |
| --- | --- | --- | --- |
| 1 | `anfragen=` einstellig bis niedrig zweistellig (vorher 224) | **16** | knapp ueber der Erwartung 6–14, Ursache in Kap. 8 |
| 2 | `vollstaendig=true` | ja | OK |
| 3 | `gemessen= > 0` (vorher 0) | **3** | OK |
| 4 | kein `status=429` | keiner | OK |

Kap. 4.4 (Geld-Sonde): `via_anchor=3` von 7 Belegen — dieselbe Groessenordnung wie
die Vormessung (4/7 bzw. 9/10). **Kein Sprung, kein Fremdbeleg-Verdacht.**

Die Korrekturbuchung ist an einem echten Anruf belegt (`call_mrvtfqleeurd`,
Outbound 08:23:48 UTC):

```
Kosten-Drift ist_usd_mikrocent=9426030 schaetzung_eur_cent=20 abweichung=52%
korrektur    delta_eur_cent=-11 gebucht=true
```

9,426 USD-ct x 0,92 = 8,67 -> 9 EUR-ct Ist gegen 20 ct Schaetzung. Die 2,5-fache
Ueber-Reservierung ist damit real geheilt. Der Verzug von 30 min (KE-P6B) ist
mitbewiesen: mit den alten 180 min waere der Anruf in diesem Sweep nicht faellig
gewesen.

Nicht als Fehler gewertet (Kap. 4.6): Deckung 11 % (vor dem Sweep 2 %) unter der
80-%-Schwelle, `ohne_schaetzung=27` aus dem Altbestand.

---

## 8. KE-P9 — gemergt, NICHT deployed

Die Live-Verifikation hat einen Folgedefekt sichtbar gemacht, den der Sweep
danach zeigte:

```
10:15:15  kandidaten=3 gemessen=0 ... uebersprungen=3
          anfragen=11 seiten=11 pool=474 vollstaendig=true
```

**11 Anfragen und 474 Belege, um 3 Calls zu ueberspringen** — stuendlich, dauerhaft.
Uebersprungene Calls (keine Leg-Referenz) werden nie geschlossen und bleiben
Kandidaten; `poolSinceFor` bildete die Zeitschranke aber ueber ALLE Kandidaten.
Ein einziger solcher Call fror `since` damit dauerhaft ein, der Pool waechst mit
dem gesamten Kontoverkehr — bis ein Typ die Seitenobergrenze reisst, dann kippt
`vollstaendig` auf `false` und **keine Rueckerstattung ist mehr moeglich**
(Kap. 4.5 nennt genau das einen Rollback-Grund). Der Bruchpunkt-Waechter aus
KE-P8 greift dabei nicht: er misst die Anfragezahl, die zweistellig bleibt.

Das erklaert zugleich `anfragen=16` in Kap. 7 — nicht `COST_TRUING_MAX_ATTEMPTS`
(der steht auf 5).

**Fix:** Merge `65f4aff` (Spec `tasks/ke-p9-spec.md`, Report
`tasks/ke-p9-report.md`). Eine Bedingung (`isRetrievable`) bestimmt Abruf-Umfang,
Zeitschranke und Buchungsschleife. Suite 2935/0, Gate PASS ohne Fix-Runde,
Rot-vor-Gruen im Wegwerf-Worktree unabhaengig nachgestellt.

**Erwartete Wirkung nach dem Deploy — das Abnahmekriterium:**

```
kandidaten=3 ... uebersprungen=3 anfragen=0 seiten=0 pool=0 vollstaendig=true
```

Keine Env-Aenderung, keine Schema-Aenderung, keine neue Variable. Rollback:
`git revert` des Merge-Commits.
