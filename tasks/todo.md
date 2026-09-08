# todo: Sicherheitstest Lauf 2 (2026-09-08)

Auftrag: `tasks/sicherheitstest-kickoff.md`. Katalog: `PLAN-SICHERHEITSTEST.md`.
Protokoll: `tasks/sicherheitstest-befunde.md`.

Grenzen (nicht verhandelbar): LUECKEN FINDEN, keine Fixes, keine Regressionstests im Repo.
Proben sind Einmal-Skripte im Scratchpad. Kein POST-mit-Seiteneffekt gegen Produktion, keine
echten Anrufe, kein Geld, kein Lesen von `.env`, kein Push/Deploy.

## Messauftraege (Ergebnis wird NACH der Messung eingetragen)

- [x] **GATE-02** — Outbound fail-open: `store.kycReached` wirft in der Gate-Kette.
      SOLL: Dial-Spion 0 Aufrufe UND Antwort mit Status >= 400.
      Verifikation: Scratchpad-Probe (`makeCallRoutes` + echte `makeOutboundGates`,
      Dial-Ports als Spione), Positiv-Kontrolle "alle Gates passieren -> Spion >= 1".
      ERGEBNIS: Kern BESTANDEN (17/17 sterbende Quellen -> 0 Wahlversuche, 0 Datensaetze),
      Antwortverhalten BEFUND (14/17 ohne jede Antwort statt >= 400).
- [x] **GATE-03** — Inbound fail-open: Budgetquelle stirbt in `/voice/incoming`.
      SOLL: TeXML mit Hangup ODER 5xx, in KEINEM Fall `<Gather>`/`<Stream>`.
      Verifikation: (a) Spawn-Server mit korruptem Usage-Datensatz, signierter
      `/voice/incoming`; (b) In-Process-Harness mit werfendem `budgetExceeded`;
      Positiv-Kontrolle: gesunder Store -> `<Gather>` im Body.
      ERGEBNIS: BESTANDEN in beiden Varianten, beide Engines.
- [x] **REPLAY-02** — Replay der Folge-Callbacks bucht zweite Kosten?
      SOLL: Usage-Stand nach dem zweiten identischen Request == Stand nach dem ersten.
      Verifikation: Spawn-Server, Usage vor/nach, identischer signierter Request 2x.
      ERGEBNIS: BEFUND auf `/voice/turn` (828 -> 1656 Cent, Transkript 2 -> 4 Zeilen);
      `/voice/status` BESTANDEN (billedAt-Anker).
- [x] **GATE-01** (Zusatz, statisch) — mehr als ein Aufrufer der Wahlfunktion?
      SOLL: genau ein Aufrufer je Dial-Implementierung. Verifikation: grep ueber `src/**`.
      ERGEBNIS: BESTANDEN (3 Wege, je 1 Aufrufer, alle hinter der Kette). Nebenbefund:
      `scripts/spike2-anruf.mjs` waehlt direkt beim Anbieter, an allen Gates vorbei.
- [x] **L-03** — Routen-Fuzzing gegen die blinden Flecken des Inventar-Tests.
      Abweichung vom Katalog: `ffuf` nicht installiert -> Node-Fuzzer mit derselben Aussage
      (Wortliste gegen die LOKALE Instanz, Treffer gegen `src/route-policy.js` abgeglichen).
      SOLL: jeder Treffer steht in der Policy oder liefert 401/403/404.
      ERGEBNIS: BESTANDEN. Kein unbekannter dynamischer Pfad, 0 Traversal-Lecks. Messung
      MUSS ueber die LAN-IP laufen (ueber Loopback liefert /api/state 200).
- [~] **DB-05 / OPS-03 / OPS-04** — brauchen Render-/Stripe-Dashboard: Owner-Handlung.
      ERGEBNIS: OPS-03 teilweise selbst gemessen (Aufbewahrung ~7 Tage, Zugriff =
      Workspace + API-Schluessel); DB-05/OPS-04 bleiben offen, Handgriffe stehen im
      Protokoll.
- [ ] **L-04** — Injektions-Bench: braucht echte Schluessel + Geld -> nur nach
      ausdruecklicher Owner-Freigabe.

## Nachtrag (Owner-Vorgabe "hoher Sicherheitsstandard"), alles rein lesend

- [x] **WZ-02 Secret-Scan volle Historie** — 2354 Commits, keine echten Schluessel, `.env` nie
      committet. BESTANDEN. (Reichweite: Praefix-Suche, `gitleaks` nicht installiert.)
- [x] **MCP-Konfiguration** — `.mcp.json` nur Platzhalter (BESTANDEN); `~/.claude.json` traegt
      einen literalen Render-Key mit Produktions-SCHREIBrechten im Klartext (BEFUND).
- [x] **OPS-01 vervollstaendigt** — Render-Konto des Owners: 2FA AUS, kein Passwort, keine
      API-Keys, KEIN Zugriff auf die Produktion (`Access denied` auf `hermes-db`).
- [x] **A-10 Abhaengigkeiten** — 8 Verwundbarkeiten in Produktionsabhaengigkeiten, 3 hoch
      (`nodemailer` direkt, `ip-address` via express-rate-limit, `fast-uri` via ajv,
      `hono` via MCP-SDK). `apps/web`: 0. body-parser-Advisory trifft uns NICHT.
- [x] **WZ-01 Dependabot** — `.github/dependabot.yml` angelegt (npm `/` + `/apps/web`,
      github-actions, woechentlich, gruppiert). Muss zusaetzlich ins Upstream-Repo.
- [x] **CI-Gates gemessen** — jeder CI-Lauf rot, Drift-Waechter stuendlich rot (4 fehlende
      Repo-Secrets), `npm test` rot mit genau EINEM echten Defekt + 1-4 wechselnden Flakes.
- [ ] **OPS-04 Stripe** — Konto `team@sundartha.com`, Google-Weg abgelehnt, Passwort gesperrt.

## Review

Funde nach Schwere (Belege in `tasks/sicherheitstest-befunde.md`, Abschnitt "Lauf 2"):

1. **REPLAY-02, `/voice/turn`** — identische Wiederholung bucht zweites Geld auf die
   Gate-Achse und verdoppelt das Transkript. Tritt auch ohne Angreifer auf (Anbieter-Retry).
2. **GATE-02, Antwortverhalten** — 14 von 17 sterbenden Gate-Quellen lassen den Request
   ohne jede Antwort haengen. Kein Anruf, kein Geld — aber der Aufrufer (MCP `place_call`)
   wartet ins Leere.
3. **`scripts/spike2-anruf.mjs`** — committetes Skript waehlt beim Anbieter an allen Gates
   vorbei.

Bestanden: GATE-03 (beide Varianten), REPLAY-02 auf `/voice/status`, GATE-01, L-03 inkl.
Traversal.

Offen fuer den Owner: DB-05 (Backup-Zeitpunkt + Drill), OPS-04 (Stripe-Dauergutschein),
OPS-03-Rest (Log-Stream zu einem Drittdienst?), L-04 (kostet Geld, braucht Freigabe).

**Korrektur:** DB-05 und OPS-03 sind vom Owner-Konto aus NICHT abrufbar (Render `Access denied`).
Sie brauchen `jonas@kroh-willich.de` - ebenso die vier fehlenden Repo-Secrets des Drift-Waechters
(dort hat der Owner `admin=false`).

**Schwerste Funde des Nachtrags, nach Wirkung:** (1) jeder CI-Lauf rot -> die als blockierend
gefuehrten Gates sind unbeobachtet; (2) der Art.-50-Drift-Waechter hat nie gelaufen (4 Secrets
fehlen) und ist vom Owner nicht reparierbar; (3) 3 High-Advisories in Produktionsabhaengigkeiten,
`nodemailer` direkt auf dem Live-Mailpfad; (4) Render-Vollzugriffsschluessel im Klartext lokal.
