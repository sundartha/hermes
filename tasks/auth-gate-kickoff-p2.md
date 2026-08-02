# Kickoff: PLAN-AUTH-GATE fortsetzen ab P2

Diesen Text in einer **frischen Session** als ersten Prompt verwenden. Er funktioniert
ohne Kenntnis vorheriger Gespraeche.

---

## Prompt

Du setzt `PLAN-AUTH-GATE.md` fort. **P0 und P1 sind fertig** — du beginnst bei **P2**.

### Kontext in fuenf Saetzen

Hermes ist ein autonomer Telefon-KI-Agent, der echte Anrufe fuehrt und Gespraechs-Transkripte
speichert; das Gateway laeuft oeffentlich erreichbar auf Render. Das Basic-Auth-Gate
(`src/wiring/auth-gate.js`) soll fallen — Ziel ist **ein einziger Auth-Mechanismus** fuer
menschliche Nutzer: die WorkOS/OIDC-Browser-Session. Das geht nicht in einem Schritt, weil das
Gate heute die **einzige** Sicherung von 21 Routen ist: ohne es liefert `POST /api/calls` eine
200 und originiert einen **echten Anruf**, weil eine fehlende Identitaet auf den
Bootstrap-Tenant zurueckfaellt (empirisch belegt, Plan-Abschnitt 1). **Die Phasenreihenfolge
im Plan ist deshalb bindend** — Messbarkeit (P1 Inventar-Test, P2 Live-Probe) steht vor dem
Umbau, tote Routen fallen vor dem Gate; wer umsortiert, oeffnet ein Zeitfenster, in dem das
System schwaecher ist als heute.

### Wo die Arbeit steht

- **Worktree:** `.claude/worktrees/auth-gate`, **Branch:** `phase/auth-gate`, HEAD `47dc12c`.
  Sauber, nichts uncommitted. **Arbeite dort weiter, leg keinen neuen an.**
- **P0** (Re-Baseline) fertig — Bericht `tasks/auth-gate-phase0.md`, vier handwerkliche
  Befunde F1-F4.
- **P1** (Routen-Inventar-Test) fertig und committed. Neu: `src/route-policy.js`,
  `test/route-auth-inventory.test.js`, `docs/RUNBOOK-AUTH-REVIEW.md`; geaendert `src/app.js`
  (optionaler `createPortalRunner`-Dep), `PLAN-SECURITY.md`. `npm test` war dort gruen.
- **Nichts gemergt, nichts deployed.** Der Owner merged und deployed.
- **Der Branch ist 3 Commits hinter `master`** (`master` = `a327334`). **Erste Handlung:**
  im Worktree `git merge master` fahren (kein `--ff-only`, der Branch hat einen eigenen
  Commit), danach `git merge-base --is-ancestor master HEAD` pruefen. Ein Worktree landet
  nicht zuverlaessig auf dem aktuellen Stand — pruef es, verlass dich nicht darauf.
- **`npm test` vor der ersten Aenderung einmal fahren** und die Zahl notieren. Sie ist deine
  Baseline; ohne sie kannst du spaeter nicht sagen, ob du etwas kaputtgemacht hast.

### Owner-Entscheidungen vom 2026-08-02 (bindend, nicht neu aufrollen)

1. **Probe-Sicherheit: POST mit ungueltigem Body.** Die Probe deckt die **vollstaendige**
   Routenliste ab, inklusive der Geld-Routen. Sie schickt POST **ohne Pflichtfelder**.
   Gesetzt -> 401/403 = geschuetzt. 400 = **ungeschuetzt, Alarm** — aber es wurde nichts
   gekauft und nichts angerufen. 200/201 = ungeschuetzt und darf nie vorkommen.
   **Die Praemisse ist am Code verifiziert, du musst sie nicht erneut pruefen — aber du
   darfst sie nicht brechen:** `src/routes/api-onboard.js:102` (tenantId-Guard vor
   `registerTenant`/`requestNumber`) und `src/routes/api-calls.js:111` (`to`/`objective` vor
   der Gate-Kette und vor dem Dial). Beide 400er liegen **vor** jedem Seiteneffekt.
2. **Die Probe wird gegen Live gefahren** (`app.sundartha.com`). Du baust sie, testest sie
   lokal, und faehrst dann **einen** Lauf gegen die Live-Instanz und meldest die
   Ist-Aufnahme. Guardrails unten.
3. **Die drei Routenklassen aus P1 bleiben.** `GATE_ONLY_ROUTES` ist die maschinenlesbare
   Arbeitsliste von P4/P5/P6 und macht P7 mechanisch pruefbar: das Gate darf erst fallen,
   wenn die Liste leer ist. Nicht auf zwei Klassen zurueckbauen.

### Was zu lesen ist — und was NICHT

Lies vollstaendig, in dieser Reihenfolge:

1. `CLAUDE.md` — Absolute Regeln sind bindend, besonders 1 (SAFETY-GATES), 3 (AUTH
   FAIL-CLOSED), 4 (SECRETS) und 6 (SCOPE)
2. `.claude/refs/workflow.md` und `.claude/refs/clean-code.md` — Pflicht, nicht Empfehlung
3. `PLAN-AUTH-GATE.md` **Abschnitt 7, Unterabschnitt P2 (Z. 490-521)** — deine Aufgabe im
   Wortlaut, inklusive Erwartungstabelle
4. `tasks/auth-gate-chain.md` — der Kettenstand der Vorsession (74 Zeilen, ganz lesen)
5. `src/route-policy.js` und `test/route-auth-inventory.test.js` — was P1 gebaut hat; die
   Erwartungstabelle der Probe muss dazu passen, sonst hast du zwei Wahrheiten
6. `scripts/sweep-jetzt.sh` — der Stilvorbild-Vorgaenger (entfaellt in P7)

**Token-Disziplin — lies das ausdruecklich NICHT am Stueck:** `PLAN-AUTH-GATE.md` ist
65 KB. Lies Abschnitt 7/P2 und danach gezielt per `grep -n`, was du brauchst (Abschnitt 3 =
Routen-Inventar, Abschnitt 5 = stille Fehler, Abschnitt 10 = Owner-Entscheidungen). Dasselbe
gilt fuer `PLAN-SECURITY.md` und `tasks/auth-gate-phase0.md`. Keine Zusammenfassungen von
Dateien schreiben, die du gerade gelesen hast.

### Auftrag P2 — Live-Probe `scripts/probe-auth.sh`

Aendert **kein** Laufzeitverhalten. Reines `curl` + Statuscode-Vergleich, **keine neue
Dependency**. Kernpunkte aus dem Plan, die du nicht uebersehen darfst:

- **Ziel-Pin (W7):** URL **und** erwarteter Commit-SHA sind **Pflichtargumente**. Das Skript
  ruft zuerst `GET /healthz` (`app.js` liefert `commit`). Weicht der SHA ab ->
  **sofortiger Abbruch, Exit 2, keine weitere Pruefung.** Ohne das laeuft die Probe gruen
  gegen einen alten Deploy, waehrend Produktion offen steht.
- **404 ist ein Fehlschlag, kein Erfolg (W6).** Fuer jede Route, die geschuetzt sein SOLL,
  gilt "401 oder 403" als bestanden und **404 als Durchfall** — ein 404 heisst, dass
  `guardedBoot` (fail-open) den Web-Login-Block verschluckt hat und die Route gar nicht
  gemountet ist. `/healthz` bliebe dabei 200 und der Ausfall unsichtbar. **Die Probe ist der
  einzige Ort, an dem dieser Zustand auffaellt.**
- **Zusatzpruefung auf jeder Antwort:** Header `WWW-Authenticate` MUSS fehlen — aber **erst
  ab P7**. Heute laeuft die Probe im Modus **"Ist-Aufnahme"**, das Gate steht noch, der Header
  ist also erwartet **vorhanden**. Bau den Modus explizit, nicht als auskommentierte Zeile.
- **H10 — Erwartungswechsel benennen, nicht wegklicken:** die Erwartung fuer `/api/state`
  wechselt in P5 von 401 auf 403, ohne dass ein Defekt vorliegt. Regel: die Erwartungstabelle
  wird **im selben Commit** geaendert wie die Phase, die sie aendert. Eine Probe, die nach
  einem Deploy "halt anders" ist, trainiert die Geste, rote Sicherheitsproben wegzuklicken.
- **Abnahme:** laeuft gegen Live mit Exit 0 · manipulierter Erwartungswert -> Exit 1 ·
  falscher Commit -> Exit 2. Alle drei **vorfuehren**, nicht behaupten.

### Guardrails fuer den Live-Lauf

- **Der Live-Stand ist NICHT dein lokaler `master`.** Render deployt aus dem
  **Upstream**-Remote; lokal liegen 10 Commits, die nicht live sind. Der Commit-SHA fuer den
  Pin kommt aus `GET /healthz` der Live-Instanz, **nicht** aus `git rev-parse HEAD`. Live
  kennt weder P1 noch `route-policy.js` — die Ist-Aufnahme misst den deployten Zustand, und
  Abweichungen zum lokalen Code sind erwartet, kein Befund.
- **Ein Lauf, nicht zehn.** Kein Schleifen, kein Retry-Sturm. Der Endpunkt ist Produktion.
- **Keine Credentials im Skript, keine im Aufruf, keine im Log.** Die Probe laeuft
  ausdruecklich **ohne** Session — das ist ihr Sinn.
- **Der Lauf erzeugt `auth_failed`-Zeilen im Render-Log.** Das ist erwartet und kein
  Vorfall; sag es im Bericht dazu, damit es niemand spaeter als Angriff fehldeutet.
- **Rohausgabe nicht committen**, wenn sie Antwortkoerper enthaelt — dort koennen
  Tenant-Daten stehen. Committe das Skript und eine Statuscode-Tabelle, nicht den Dump.
- Faellt eine Route unerwartet durch: **melden, nicht fixen.** P2 aendert kein Verhalten. Ein
  Fund gehoert als Befund in den Bericht und steuert P3-P7.

### Wie du arbeitest

**Regel 0 — Isolation.** Am Repo arbeitet moeglicherweise eine zweite Session (die AL-Kette,
Phase AL-D3). Du bleibst in `.claude/worktrees/auth-gate` auf `phase/auth-gate`.

- **NIEMALS `git stash`.** `refs/stash` ist zwischen Worktrees geteilt; ein Stash hier reisst
  der anderen Session die Arbeit weg.
- **NIEMALS `git add -A`.** Im Repo liegen untrackte Dateien mit Kundendaten. Jede Datei
  einzeln und bewusst hinzufuegen.
- **Kein Merge nach `master`, kein Push, kein Deploy.** Du lieferst den Branch ab.
- Untrackte Dateien anderer Sessions nicht anfassen und nicht mitcommitten.
- **Lastgrenze:** laeuft parallel ein Phasen-Workflow der AL-Kette, fahr keine vollen
  `npm test`-Laeufe gleichzeitig — zwei Bahnen erzeugen zusammen ~35 `node --test`-Prozesse
  und ueberlasten die Maschine. Im Zweifel kurz `ps aux | grep "[n]ode --test" | wc -l`.
- **Nach vollen Laeufen aufraeumen:** Spawn-Tests lassen `node src/server.js` zurueck
  (`ps aux | grep "[n]ode src/server.js"`).

**Rhythmus.** Wie die Vorsession: eine Phase zur Zeit, am Ende jeder Phase den Kettenstand
`tasks/auth-gate-chain.md` fortschreiben — erwartetes Ergebnis, Verifikationsmethode,
**beobachtetes** Ergebnis. Eine Phase gilt erst als fertig, wenn die Verifikation in dieser
Session gelaufen ist. Bei sicherheitsrelevanten Aenderungen `PLAN-SECURITY.md` nachziehen.

**Rot-vor-Fix ist Pflicht**, wie in P1: zeig, dass die Probe den Fehler wirklich faengt, bevor
du sie fuer fertig erklaerst. Ein gruener Sicherheitstest, der nie rot war, ist ein
Platzhalter.

**Du bleibst duenn.** Statusmeldungen kurz, keine Optionen aufzaehlen, die du nicht verfolgst.

### Danach

**P3 (Bootstrap-Fallback fail-closed)** verlangt laut Plan, dass **P1 und P2 gemergt sind** —
das ist eine Owner-Handlung. Melde dich nach P2 mit dem Ergebnis und lauf nicht weiter.

### Wenn etwas unklar ist

Fragen, nicht raten — auch wenn die Frage trivial wirkt. Eine Annahme ist hier immer
schlechter als eine Rueckfrage. Die drei oben genannten Entscheidungen sind allerdings
getroffen; die rollst du nicht neu auf.
