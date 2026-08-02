# PLAN-AUTH-GATE — Kettenstand

Branch `phase/auth-gate`, Worktree `.claude/worktrees/auth-gate`, Basis `8461b69`
(lokaler `master`). **Nichts gemergt, nichts deployed** — der Owner merged.

Je Phase: erwartetes Ergebnis (pruefbar formuliert) + Verifikationsmethode +
beobachtetes Ergebnis. Eine Phase gilt erst als fertig, wenn die Verifikation in
dieser Session gelaufen ist.

---

## P0 — Re-Baseline (fertig)

- **Erwartet:** das Routen-Inventar aus Plan-Abschnitt 3 stimmt mit dem Code ueberein;
  keine als tot eingestufte Route hat einen Aufrufer.
- **Verifikation:** `grep` ueber `src/`, `scripts/`, `apps/web/src/`, `public/`.
- **Ergebnis:** Diff leer (19 "nur Gate"-Zeilen / 21 Endpunkte). Vier handwerkliche
  Befunde (F1-F4). Vollstaendiger Bericht: `tasks/auth-gate-phase0.md`.

## P1 — Routen-Inventar-Test (fertig)

- **Erwartet:**
  1. `npm test` ist gruen und enthaelt den neuen Test.
  2. Eine Route ohne Auth-Middleware und ohne Eintrag in `src/route-policy.js` macht
     den Test **rot** (nicht "faellt auf").
  3. Ein Graph ohne pg-Backend macht den Test **rot** (Positiv-Assertion), sonst
     prueft er den mageren Testgraph und ist wertlos (Befund B3).
- **Verifikation:** `npm test`; zusaetzlich zwei Rot-vor-Fix-Laeufe mit absichtlich
  kaputtem Zustand.
- **Ergebnis:**
  - `npm test`: gruen (3751 Tests, +7 neue).
  - Rot-vor-Fix 1 — `app.get("/probe-rot-vor-fix", ...)` in `src/app.js` eingefuegt:
    **2 Tests rot** (Klassifikation + Fingerprint). Zurueckgesetzt.
  - Rot-vor-Fix 2 — Graph auf `storeBackend: "json"` gedreht: **4 Tests rot**.
    Zurueckgesetzt. **Wichtige Beobachtung:** die Klassifikations-Assertion blieb
    dabei GRUEN — der magere Graph enthaelt die ungeschuetzten Routen ja auch, nur
    die Web-Login-Routen fehlen. Ohne die Positiv-Assertion waere der Test also
    tatsaechlich gruen und wertlos gewesen. B3 ist damit nicht nur uebernommen,
    sondern am eigenen Testaufbau nachgemessen.
  - Ein **Bestandstest** wurde rot und hat einen echten Fehler gefangen:
    `P14: kein Server-Ziel zeigt mehr auf das geloeschte Dashboard` pinnt, dass das
    Literal `"/tenant.html"` nur in `src/portal-paths.js` stehen darf. Der Test pinnt
    den SOLL-Zustand -> mein Code war falsch. Fix: `route-policy.js` importiert
    `LEGACY_PORTAL_PATH` und `APP_PATH` statt die Pfade zu wiederholen.
- **Dateien:** neu `src/route-policy.js`, `test/route-auth-inventory.test.js`,
  `docs/RUNBOOK-AUTH-REVIEW.md`; geaendert `src/app.js` (optionaler
  `createPortalRunner`-Dep), `PLAN-SECURITY.md` (Abschnitt AUTH-P1).

### Abweichung vom Plantext (Owner-Entscheidung noetig, blockiert P1 nicht)

Der Plan beschreibt **zwei** Klassen: "hat Auth-Middleware" oder "steht in der
Oeffentlich-Liste". Umgesetzt sind **drei**. Grund: heute haengen 21 Routen allein am
Basic-Auth-Gate. Sie sind nicht oeffentlich — sie sind geschuetzt, nur eben von der
Sicherung, die dieser Plan aufloest. Haette ich sie in `PUBLIC_ROUTES` geschrieben,
haette die Liste 21-mal etwas Falsches behauptet, und beim Wegfall des Gates in P7
haette der Test gruen gemeldet, was in Wahrheit eine offene Tuer ist.

Stattdessen: `GATE_ONLY_ROUTES`. Der Test laesst sie durch (sie SIND heute geschuetzt)
und haelt sie sichtbar. Nebeneffekt, der mir den Ausschlag gab: **die Liste ist die
Arbeitsliste von P4/P5/P6 und macht P7 mechanisch pruefbar** — das Gate darf erst
fallen, wenn sie leer ist. Wer sie leert, ohne die Route abzusichern, faellt in
`UNPROTECTED` und macht `npm test` rot.

---

## P2 — Live-Probe `scripts/probe-auth.sh` (fertig)

- **Erwartet:**
  1. Lauf gegen Live mit **Exit 0** (Ist-Aufnahme, Gate steht noch).
  2. Manipulierter Erwartungswert -> **Exit 1**.
  3. Falscher Commit -> **Exit 2**, ohne weitere Anfrage.
  4. Die Erwartungstabelle widerspricht `src/route-policy.js` nirgends.
- **Verifikation:** alle drei Exit-Faelle vorgefuehrt (nicht behauptet); `npm test`;
  drei Rot-vor-Fix-Laeufe gegen den Tabellen-Test.
- **Ergebnis:**
  - **Live-Lauf 2026-08-02**, `https://app.sundartha.com`, Commit `44a7d09`
    (= 16 Commits hinter dem lokalen `master`, **ohne** P1 — der Live-Stand kommt aus
    dem Upstream-Remote): **59 Routen, 0 Abweichungen, Exit 0. Kein Befund.**
    Belegt nebenbei, dass P1 kein Laufzeitverhalten geaendert hat: dieselbe Tabelle
    passt auf einen Deploy ohne `route-policy.js`.
  - Exit 1 vorgefuehrt: `/healthz`-Erwartung lokal von 200 auf 503 gedreht -> Zeile
    kippt von OK auf ABWEICHUNG, Zaehler 20 -> 21, Exit-Code 1. Zurueckgesetzt.
  - Exit 2 vorgefuehrt: falscher SHA (`ABBRUCH: Ziel-Pin verletzt`), fehlendes
    Argument, unbekannter Modus — je Exit 2, keine Messung.
  - `npm test`: gruen, 3763 Tests (Basis vor der Phase: 3758, +5 neue).
- **Dateien:** neu `scripts/probe-auth.sh`, `test/probe-auth-table.test.js`; geaendert
  `docs/RUNBOOK-AUTH-REVIEW.md` (Deploy-Schritt), `PLAN-SECURITY.md` (AUTH-P2).

### Entwurfsentscheidung, die ueber den Plantext hinausgeht

Der Plan verlangt "404 ist ein Fehlschlag" als W6-Detektor. **Solange das Gate steht,
ist dieser 404 nicht messbar**: das Gate haengt vor dem 404-Handler und beantwortet
jeden unbekannten Pfad mit 401 — eine fehlende Route sieht exakt aus wie eine
geschuetzte. Der Plan-Satz "die Probe ist der einzige Ort, an dem dieser Zustand
auffaellt" waere heute also unwahr gewesen.

Deshalb traegt jede Tabellenzeile zusaetzlich die **erwartete antwortende Schicht**
(`gate` / `webauth` / `mcpauth` / `keine`), geprueft ueber `WWW-Authenticate: Basic` —
den Fingerabdruck des Gates. Antwortet das Gate fuer eine Route, die der
Sitzungs-Cookie schuetzen soll, ist der Web-Login-Block nicht gemountet. Genau dieser
Durchfall ist lokal vorgefuehrt: gegen einen Server ohne pg-Backend melden alle 11
Web-Login-Routen `DURCHFALL ... W6`, obwohl sie mit 401 antworten. Ab P7 uebernimmt die
404-Regel; der Modus `nach-p7` verlangt dann, dass die Challenge ueberall fehlt.

Zweite Zugabe: `test/probe-auth-table.test.js`. Ohne ihn haetten Probe und
`route-policy.js` zwei Wahrheiten ueber dieselbe Route sagen koennen — die Probe waere
gruen ueber genau die Tuer gelaufen, die sie finden soll.

---

## P3 — Bootstrap-Fallback fail-closed (fertig, gemergt `8baf654`)

- **Erwartet:** eine fehlende Identitaet bindet nur noch den genuin lokalen
  In-Process-Aufrufer an den Bootstrap-Tenant; jeder andere identitaetslose Request
  bekommt `TENANT_REJECT` — **auch bei entferntem Gate**.
- **Verifikation:** `phase-impl-lean` (Plan/Safety auf Opus, Impl/Audit auf Sonnet),
  dualer Review, Mutationsprobe, `npm test` auf master.
- **Ergebnis:** Gate **PASS** ohne Fix-Runde. `npm test` gruen (3759 korrigiert).
  Eine benannte Quelle `operatorChannelTenant` an **beiden** Stellen; keine zweite
  Vertrauensquelle. Mutationsprobe: alter Fallback zurueckgedreht -> 11 von 16 neuen
  Tests rot, die 5 In-Process-Pins blieben gruen (genau die Trennung, die der Plan
  verlangt). Politik-Dateien (`route-policy.js`, `probe-auth.sh`, `auth-gate.js`)
  nachweislich unberuehrt.
- **Von aussen sichtbar heute: nichts.** Das Gate antwortet weiterhin zuerst. Die Phase
  zieht den Boden ein, auf dem P7 stehen wird.
- **Drei Befunde aus der Konsumenten-Enumeration, die offen bleiben:**
  1. `POST /mcp` lebt live nur deshalb weiter, weil `MCP_AUTH=oauth` laeuft (`req.auth`
     gesetzt, der geaenderte Zweig wird nicht betreten). Bei `MCP_AUTH=token/off` waere
     der Connector still tot. **Keine Boot-Sonde** deckt das ab.
  2. `GET /api/billing/checkout-return` liefert einem VOR dem Deploy geoeffneten
     Legacy-Checkout jetzt 403 statt Karten-Bindung. Kein Live-Regress (die aktive
     Kartenerfassung laeuft ueber den Self-Service-Pfad), aber der Grund, warum P9 die
     30 Tage Karenz hat.
  3. Zwei Tests in `test/security.test.js` bleiben gruen, messen aber weniger als ihr
     Name verspricht (sie pruefen nur `status===200`). Bewusst nicht angefasst
     (Scope-Grenze), in `PLAN-SECURITY.md` als Befund benannt.

---

## Owner-Entscheidung 2026-08-02 (bindend, fuer P7)

**Plan-Entscheidung 5 ist beantwortet: alle vorgeschlagenen Umleitungen kommen mit.**

| Pfad | Ziel |
| --- | --- |
| `/login`, `/signin`, `/sign-in` | 302 `/auth/login` |
| `/dashboard`, `/account`, `/portal`, `/admin` | 302 `/app` |

Pfade als benannte Konstanten in `src/portal-paths.js`, Mount VOR dem statischen
Serving (Muster `LEGACY_PORTAL_PATH`). Die drei `fehlt`-Zeilen der Probe (`/login`,
`/dashboard`, plus die vier neuen) werden im P7-Commit auf 302 gedreht (H10).

---

## P4 — tote, aber scharfe Routen loeschen (fertig, gemergt `9eb68c9`)

- **Erwartet:** die sechs anonymen Schreibflaechen sind weg, der Boot bleibt heil, und
  die vier Sicherungs-Stellen sagen danach dasselbe.
- **Verifikation:** `phase-impl-lean`, dualer Review, Spawn-Test mit echtem Serverstart,
  `npm test` auf master nach dem Merge.
- **Ergebnis:** Gate **PASS** ohne Fix-Runde. `npm test` gruen (3756 korrigiert).
  **Kein lebender Aufrufer** gefunden — die Enumeration lief ueber `src/`, `scripts/`,
  `apps/web/src/`, `public/`, `test/`, `src/mcp-tools.js`, `docs/`; alle Treffer waren
  Kommentare, Doku oder Tests. `validIdentity`/`IDENTITY_MAX_LEN` sind nach
  `src/routes/_validation.js` gezogen, der Boot per Spawn-Test belegt (nicht per
  `node --check` — das faengt keinen fehlenden Export).
- **Von aussen sichtbar heute: nichts.** Das Gate haengt vor dem 404-Handler; eine
  geloeschte Route ist von einer geschuetzten nicht zu unterscheiden. Die sechs
  Probe-Zeilen stehen deshalb jetzt als `fehlt` mit **Status 401 / Schicht gate** —
  erst P7 dreht sie auf 404. Sie wurden bewusst **nicht geloescht**: als
  Negativkontrolle sind sie mehr wert denn je.
- **Preis, den diese Phase kostet:** 13 Bestandstests entfielen oder wurden umgestellt
  (jeder einzeln begruendet im Bericht). Zwei Zusagen wanderten von der HTTP-Naht auf
  die Store-Ebene (Settings-Whitelist, Sprach-Code-Filter). Ein gruener Mechanismus-Test
  aus dem `test:gates`-Katalog (`VOICE-09`) faellt weg; seine Zusage haelt
  `test/f1-geo-store.test.js` weiter.

---

## Betriebsnotiz: die Parallel-Bahn hat waehrenddessen gemergt

Waehrend AUTH-P4 lief, hat die AL-Kette **AL-D3** nach `master` gebracht. Zwei Folgen,
die beim naechsten Mal Zeit sparen:

1. `git diff master..branch` (zwei Punkte) zeigte dadurch die AL-D3-Arbeit als
   **Loeschungen** — es sah aus, als wuerde die Phase fremde Arbeit zuruecknehmen.
   Richtig ist `git diff master...branch` (drei Punkte, gegen die Merge-Basis).
2. Der Merge war trotzdem gefahrlos: **keine einzige Datei** wurde von beiden Seiten
   angefasst (mit `comm -12` ueber die beiden Dateilisten geprueft). Deshalb
   `--no-ff`-Merge statt Fast-Forward, danach `npm test` auf dem **kombinierten** Stand
   — der Lauf der Phase kannte AL-D3 ja noch nicht.

---

## Naechste Phase

**P5 — `internalOnly` + Audit-Ersatz.** Vorbedingung (P4 gemergt) erfuellt.
Spec: `tasks/auth-gate-p5-spec.md`. Dort steht auch, warum die Erwartungstabelle der
Probe in P5 **nicht** von 401 auf 403 wechselt — der Plantext ist an dieser Stelle
ungenau, das Gate antwortet weiterhin zuerst.

**Offener Owner-Entscheid (erst fuer P7):** Plan-Entscheidung 5 laesst `/signin`,
`/sign-in`, `/account`, `/portal`, `/admin` als zusaetzliche Redirect-Ziele
ausdruecklich offen.

---

## P5 — `internalOnly` + Audit-Ersatz (fertig, gemergt `e7915b5`)

- **Erwartet:** die sieben MCP-Routen sind fuer externe Aufrufer geschlossen, und
  abgelehnte Anfragen hinterlassen eine Spur, die den Gate-Wegfall ueberlebt.
- **Ergebnis:** Gate **PASS** ohne Fix-Runde, `npm test` gruen (3770 korrigiert).
  `internalOnly` (`src/wiring/internal-only.js`) haengt vor allen sieben Routen;
  `auditAuthFailed` (`src/util.js`) ist die **eine** Stelle, die die Audit-Zeile baut,
  mit vier festen Grund-Token (`no_session`, `not_active`, `not_admin`, `not_local`).
- **W9 dreifach belegt:** `?session_id=XYZ&code=ABC` taucht in keiner Audit-Zeile auf
  (drei Tests fuer internalOnly, webAuth und adminOnly). Die Mutationsprobe
  `req.path -> req.originalUrl` faerbte genau diese drei rot.
- **Fuenf Mutationsproben** einzeln vorgefuehrt und zurueckgenommen — darunter
  `isTrustedLocalCaller -> isLocalSocket`, was die AM1-Regression reproduziert
  (hinter Render ist auch externer Verkehr Loopback).
- **Die Probe-Tabelle blieb unveraendert**, wie in der Spec begruendet: das Gate
  antwortet weiterhin zuerst. Der 403 ist heute nur im Test belegt und wird erst mit P7
  von aussen sichtbar.
- **P3-Restluecke geschlossen:** `AUTH-P3-16` liess `GET /api/state` mit `X-Forwarded-For`
  bewusst noch mit 200 (ohne Owner-Daten) durch — `internalOnly` macht daraus 403.

---

## Naechste Phase

**P6 — Betreiber-Routen auf Admin-Session.** Vorbedingung (P5 gemergt) erfuellt.
Spec: `tasks/auth-gate-p6-spec.md`.

**Offene Pruefung vor dem Deploy von P6 (Owner):** ueber welchen Weg gilt der
Owner-Account als Admin — `account.role='admin'` in der Produktions-DB oder
`ADMIN_EMAILS` in der Render-Env? Ist beides unklar, sperrt der Deploy den Owner aus dem
Onboarding aus.

---

## P6 — Betreiber-Routen auf Admin-Session (fertig, gemergt `0d16ef4`)

- **Ergebnis:** Gate **PASS** ohne Fix-Runde, `npm test` gruen (3782). Die sechs
  Betreiber-Routen tragen `webAuthMw` + `adminMw`. Neu: `src/wiring/operator-routes.js`
  — ein `guarded()`-Wrapper, der die Route **gar nicht registriert**, wenn die
  Middlewares fehlen (`operatorAuth` wird nur im `guardedBoot`-Callback gesetzt).
- **Vier Mutationsproben**, jede mit zwei unabhaengigen Detektoren. Die wichtigste:
  `if (!operatorAuth) return;` durch ungeschuetztes Mounten ersetzt -> die Mount-Tests
  **und** der P1-Inventar-Test wurden rot (die sechs Routen als `UNPROTECTED`).
- **Mount-Position bewusst unveraendert** (hinter dem Gate): das haelt die Staffelung
  Gate + Sitzung bis P7 und trennt "welche Sicherung greift" (P6) von "welche Schicht
  antwortet" (P7) in zwei Commits. Ein Live-Befund bleibt damit zuordenbar. Folge: die
  Probe-Tabelle aendert sich **strukturell nicht** (`sitzung | 401 | gate`), nur die
  Begruendungsspalte wurde praezisiert.
- **`GATE_ONLY_ROUTES` enthaelt jetzt genau das Legacy-Checkout-Paar** — maschinell
  gemessen, nicht behauptet. Das ist der Zwischenstand, den P7 vorfindet.
- **Preis:** ~12 Bestandstest-Dateien mussten von Spawn- auf In-Process-Mount
  umgestellt werden, weil die Routen im json-Backend-Spawn nicht mehr existieren.
  Jede Umstellung ist im Bericht einzeln begruendet.

### BLOCKER VOR DEM DEPLOY VON P6 — am 2026-08-02 gemessen, nicht vermutet

`adminOnlyMiddleware` laesst durch, wenn `account.role === 'admin'` **oder** die
E-Mail in `ADMIN_EMAILS` steht. Ich habe die Produktions-DB gelesen:

```
select tenant_id, role from account;
t_user_01KX600834GCJFV9GTZQKWZMTH | member
t_user_01KXH2B75WJ75W3JYYXDPPSK3R | member
```

**Kein einziger Account traegt `role='admin'`.** Ob `ADMIN_EMAILS` im Render-Dashboard
des Dienstes `vodafone-agent` gesetzt ist, laesst sich von hier **nicht** lesen (die
Render-API bietet kein Lese-Werkzeug fuer Env-Variablen, und `/healthz` liefert nur
einen Einweg-Hash). In den Request-Logs der letzten 30 Tage gibt es **keinen einzigen**
Aufruf von `/api/admin/*` — es gibt also auch keinen empirischen Beleg, dass
Admin-Zugang heute funktioniert.

**Vor dem Deploy zu tun, sonst sperrt er den Owner aus dem Onboarding aus:** entweder
`ADMIN_EMAILS` im Render-Dashboard auf die eigene Login-Adresse setzen, oder
`scripts/grant-admin.js` gegen die Produktions-DB fahren. Zweite Falle: `webAuthMw` ist
active-only — ein `suspended` Account bekommt 403 **vor** `adminOnly`, egal welche
Rolle er traegt. Nach einem direkten DB-`UPDATE` gehoert ein Neustart dazu (der
pg-Store haelt Zustand im Speicher).

**Betriebsfolge:** `scripts/sweep-jetzt.sh` (curl mit Basic-Auth) wird mit diesem Deploy
wirkungslos. Das ist konsistent — P7 streicht das Skript ohnehin ersatzlos.

---

## Naechste Phase

**P7 — das Gate entfernen.** Vorbedingung erfuellt: P3-P6 gemergt, P1+P2 gruen gegen den
aktuellen Prod-Commit (`44a7d09`, gemessen 2026-08-02). Spec: `tasks/auth-gate-p7-spec.md`.
