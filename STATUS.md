# Status — offene Punkte

Das EINZIGE Status-Doc. Abgeschlossene Ketten stehen in der Git-Historie und in der Memory,
nicht hier. Wer einen geloeschten Plan braucht: `git log --diff-filter=D -- <datei>`.

**Stand:** 2026-09-12, lokaler `master` = `4e155d1`. Geldpfad-Kette (GP-P0..P6) und
SEC-Kette (SEC-P0..P6) sind gemergt, gepusht und live.

**Deploy-Weg:** `git push upstream master` (Deploy-Repo ist `jonas986`, ein Push nach
`origin` macht NICHTS live), danach manueller Deploy des Render-Service `vodafone-agent`
(`autoDeploy` = no). Die Website `hermes-web` zieht automatisch mit.

---

## 1. Blocker — nur der Owner kann sie loesen

| # | Punkt | Was zu tun ist |
|---|---|---|
| O1 | **Owner-Account ausgesperrt.** Der CL1-Fix wirkt nur auf kuenftige Ereignisse; der bestehende Datensatz traegt die tote Abo-Referenz weiter (`self_service_subscribe_rejected … reason=already_subscribed`). | `scripts/reconcile-stale-subscriptions.js` einmal gegen Produktion: erst Trockenlauf, dann `--apply`. Erwartet wird `clear … (stripe=canceled)`; meldet der Lauf `keep`/`skip`, **nicht** anwenden. Braucht `STORE_BACKEND=pg`, `DATABASE_URL`, `STRIPE_SECRET_KEY` lokal. |
| O2 | **Telnyx-Plattform-Guthaben leer** (1,99 USD, gemessen 2026-09-07). Jeder Nummernkauf scheitert mit 402, auch der des Owners nach O1. | Aufladen **bevor** der Owner neu abschliesst. |
| O3 | **Endbeweis LLM-Antwort fehlt.** Ausbleibende 402-Zeilen sagen ohne Verkehr nichts. | Echter Testanruf, danach Log auf `[turn]` pruefen. |
| O4 | **P7 `turn_eagerness` ist gebaut, aber nicht gepusht.** | `npm run elevenlabs:push -- --felder=turn_eagerness --ausfuehren`. Genau EIN Feld. Rueckfall: Vorlage auf `"normal"`, erneut pushen. Details `tasks/UEBERGABE-P7-LAERM.md`. |

## 2. Offene Code-Punkte

- **P4b Portugiesisch — BLOCKED**, Branch `phase/p4b-portugiesisch-fix3`, nicht gemergt.
  Zwei Owner-Entscheidungen fehlen: die pt-Stimme (`Azure.pt-PT-RaquelNeural`) ist geraten
  und nicht per Synthese belegt, und der pt-Offenlegungssatz ist nicht freigegeben. Der
  Merge schaltet ihn ohne weiteren Push sofort scharf. Heutiger Zustand (`language:"pt"`
  -> 400) ist korrekt, nur unvollstaendig. Manifest: `PLAN-ANRUFDEFEKTE.md`.
- **Zwei rote Altlast-Tests**: `KV2-10 (d1)`/`(d2)` in `test/kv2-10-tarifpaar.test.js`,
  rot schon vor der Anrufdefekte-Kette (auf `bf96a94` isoliert nachgemessen). Solange sie
  rot sind, verdeckt `npm test` jede echte Regression.
- **`test/al-p10-precall-research.test.js` pinnt `LLM_PROVIDER` nicht.** Mit
  `LLM_PROVIDER=deepseek` in der `.env` scheitern 9 von 12 Faellen beim direkten
  `node --test`-Aufruf. `npm test` ist ueber `BASE_ENV` nicht betroffen. Fix ist eine Zeile.
- **Agenten-Stimme ST0-ST5** nicht gebaut, offene Owner-Entscheidungen im Plan.
  `tasks/PLAN-AGENTEN-STIMME.md`, Befunde `tasks/EL-STIMME-BEFUNDE.md`.
- **Cancel-Lockout**: Entscheidungen 2 und 4 in `PLAN-CANCEL-LOCKOUT.md` Abschnitt 7 sind
  unbeantwortet.
- **Geo-Rufnummern** sind reiner Entwurf, kein Code. Offen: G0-Klaerungen (10.8, 10.9,
  G0-(d) zu 10.12) und die rechtliche Abnahme zu 10.1. `PLAN-GEO-NUMMERN.md`.

## 3. Sicherheit

Launch-Blocker und getragene Risiken stehen vollstaendig in `PLAN-SECURITY.md` — das ist
das lebende Dokument, nicht dieses hier. Der wichtigste offene Eintrag:

- **ID-01, Besitznachweis der eigenen Rufnummer.** Bewusst aus der SEC-Kette
  herausgehalten (Owner-Entscheidung 2026-09-08). Solange er offen ist, bleibt die
  Offenlegungs-Ausnahme fuer Owner-Selbstanrufe an die Tenant-Allowlist
  `OWNER_SELF_CALL_TENANT_IDS` gebunden. Wird ID-01 geschlossen, ohne dass die
  Verifikation gebaut ist, ist die **Ausnahme** zurueckzunehmen, nicht der Eintrag.

## 4. Geparkt — bewusst liegen gelassen

- **DID-Monatsmiete wird nicht gebucht** (`ohne_preis`). Befund 2026-07-28. Beruehrt den
  Geldpfad. Alle betroffenen Nummern gehoeren dem Owner, kein externer Schaden.
- **DSGVO Art. 15 Auskunft** wird von Hand erledigt; es gibt bewusst keinen
  Selbstbedienungs-Export. Ein Werkzeug fuer den manuellen Weg existiert nicht.
- **Infra-Cutover (Track B)**: Repo-Verzeichnis, Render-Service und einige Env-/Pfadnamen
  tragen noch `vodafone-agent`. Der Code-/Doku-Rebrand (Track A) ist erledigt.

---

## Lebende Dokumente (kein Prozessmuell, bleiben)

`PLAN-SECURITY.md` · `PLAN-ANRUFDEFEKTE.md` · `PLAN-CANCEL-LOCKOUT.md` ·
`PLAN-GEO-NUMMERN.md` · `HANDOVER-FLOW-2026-09-07.md` · `tasks/lessons.md` ·
`tasks/gq-chain-state.md` · `tasks/al-env-changes.md` (Env-Protokoll, pflichtig) ·
`docs/RUNBOOK-*.md` · `docs/RELEASE-GATE-killer-test.md`
