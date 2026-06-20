# Runbook: Branch-Protection + Required Check (Deploy-Gate)

> Stand 2026-06-20. **Manueller Admin-Schritt — bewusst NICHT committbar.** Branch-Protection
> ist eine GitHub-Repo-Einstellung, kein Repo-Inhalt; sie wird einmalig per `gh api` gesetzt
> und kann nicht im Code versioniert werden. Voraussetzung: `gh auth login` mit **Admin-Rechten**
> auf dem Repo. Quelle: `docs/strategy/p0-2-deploy-gate.md` Abschnitt 3.4-3.5 (Track B, B5).
> Konvention: Deutsch ohne Umlaute.

---

## 0. Warum (Deploy-Kopplung)

Render hat `autoDeploy: true` und deployt **bei jedem master-Push sofort** — die CI laeuft
**parallel**, nicht davor. Ein roter Test stoppt den Deploy heute also **nicht**. Branch-Protection
schliesst genau diese Luecke (Strategie 3.5, Option 1 — die einzige, die ohne bezahlten Plan
funktioniert; Render-Deploy-Hooks waeren paid-only):

- Kein Direkt-Push auf `master` mehr — Aenderungen nur ueber Pull-Request.
- Merge erst, wenn der required Check **`test`** gruen ist (`strict: true` = Branch zusaetzlich
  aktuell).
- Danach greift `autoDeploy` — es wird also nur gruener Stand live.

**Welches Repo:** Render deployt **`jonas986/vodafone-agent`** (Remote `jonas`), NICHT
`origin` (`Antonio20045/vodafone-agent`) — siehe `docs/RUNBOOK-OPERATOR.md` Abschnitt 0. Das
Deploy-Gate gehoert daher zwingend auf **`jonas986/vodafone-agent`**. Branch-Protection auf
`origin` ist optional (Team-Hygiene), aendert aber nichts am Live-Deploy.

---

## 1. Voraussetzung (Reihenfolge beachten)

Der required Check kann erst ausgewaehlt werden, **nachdem der Context `test` GitHub mindestens
einmal bekannt ist** — d.h. die CI muss einmal gelaufen sein (Phase B4 setzt dafuer den
`pull_request`-Trigger in `.github/workflows/ci.yml`).

1. B4 (PR-Trigger) ist auf `master` von `jonas986/vodafone-agent` gemerged.
2. Mindestens ein PR oder Push hat den CI-Job **`test`** einmal durchlaufen lassen.

Wird `contexts: ["test"]` vor dem ersten Lauf gesetzt, akzeptiert die API den Namen zwar, der
Check bleibt aber "Expected" haengen, bis er erstmals real gemeldet wurde.

> Der Context-Name ist die **Job-Id** aus `ci.yml` (`jobs.test:`), nicht der Workflow-Name
> (`name: CI`). Wird der Job spaeter umbenannt oder gesplittet, muss `contexts` hier
> nachgezogen werden.

---

## 2. Branch-Protection setzen

`OWNER/REPO` = `jonas986/vodafone-agent` (Deploy-Repo, siehe 0).

```bash
gh api --method PUT repos/jonas986/vodafone-agent/branches/master/protection --input - <<'EOF'
{ "required_status_checks": { "strict": true, "contexts": ["test"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null }
EOF
```

Was die Felder bewirken:

| Feld | Wirkung |
|---|---|
| `required_status_checks.contexts: ["test"]` | Merge nur bei gruenem CI-Job `test` |
| `required_status_checks.strict: true` | Branch muss vor Merge aktuell sein (Re-Run gegen neuen master) |
| `required_pull_request_reviews` (vorhanden) | erzwingt den **PR-Workflow** (kein Merge ohne PR); Direkt-Push auf master wird durch die Protection-Regel als Ganzes blockiert (fuer Admins erst mit `enforce_admins: true`) |
| `required_approving_review_count: 0` | kein fremdes Approval noetig (Solo-/Kleinteam-tauglich) |
| `enforce_admins: true` | Gate gilt **auch fuer Owner/Admins** (siehe 3 — Entscheidung) |
| `restrictions: null` | keine Push-Allowlist auf bestimmte Personen/Teams |

---

## 3. Offene Entscheidung — `enforce_admins` (Mensch)

Strategie 7.3 / Risiko R8: Branch-Protection bricht den heutigen Solo-Direkt-Push-Workflow von
`DEPLOY.command`. Zwei ehrliche Varianten:

| `enforce_admins` | Verhalten | Konsequenz fuer `DEPLOY.command` |
|---|---|---|
| `true` (oben, sauberstes Gate) | PR-Pflicht **auch fuer den Owner**, CI muss gruen sein | `DEPLOY.command` muss auf Feature-Branch + PR umgestellt werden; kein Direkt-Push mehr |
| `false` | Admin darf direkt auf master pushen; CI laeuft trotzdem, gated aber nur PRs anderer | `DEPLOY.command` bleibt nutzbar; schwaecheres, aber ehrliches Gate |

Standard in diesem Runbook ist `true` (Strategie-Empfehlung). Soll der bestehende
`DEPLOY.command`-Direkt-Push erhalten bleiben, im JSON oben `"enforce_admins": false` setzen —
**bewusste Owner-Entscheidung, hier dokumentieren.**

---

## 4. Verifikation

```bash
gh api repos/jonas986/vodafone-agent/branches/master/protection | jq '.required_status_checks'
```

Erwartet: `"strict": true` und `"contexts": ["test"]`.

Funktions-Smoke (optional, beweist das Gate):

1. Direkt-Push auf `master` versuchen → bei `enforce_admins: true` von GitHub **abgewiesen**.
2. PR mit absichtlich rotem Test oeffnen → Merge-Button **gesperrt**, bis `test` gruen ist.

---

## 5. Rueckbau / Notfall

Protection komplett entfernen (z.B. fuer einen blockierten Hotfix — bewusste Owner-Aktion,
danach wieder setzen):

```bash
gh api --method DELETE repos/jonas986/vodafone-agent/branches/master/protection
```

Alternativ nur das Admin-Gate temporaer loesen: JSON aus Abschnitt 2 mit
`"enforce_admins": false` erneut `PUT`en — Owner kann dann direkt pushen, das CI-Gate fuer PRs
bleibt bestehen.
