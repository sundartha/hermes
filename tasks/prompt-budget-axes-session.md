# Prompt fuer die naechste Session — Umsetzung PLAN-BUDGET-AXES

Alles ab der Trennlinie ist der Prompt. In einer **frischen Session** einfuegen
(Lean-Lead-Orchestrierung braucht ein leeres Kontextfenster).

---

Lies `PLAN-BUDGET-AXES.md` im Repo-Root. Das ist dein Auftrag. Setze die Phasen
autonom um, eine Phase pro Workflow, mit dir als schlankem Lead.

## Ausgangslage (gemessen, nicht neu herleiten)

Jeder Outbound-Call wird mit HTTP 402 abgelehnt (`grund=reserve`). Der globale
usage-Zaehler steht bei **779 Cent** gegen einen Cap von 800. Reserve fuer ein
+49-Ziel ist 60 Cent: `779 + 60 = 839 > 800` blockt, waehrend `779 >= 800` falsch
ist und das freundlichere `budget`-Gate schweigt. Weil kein Call mehr zustande
kommt, waechst der Zaehler nie weiter — der Zustand ist **permanent eingefroren**.
Empirisch reproduziert (Bucket 700/740 -> passiert, 741/799 -> `grund=reserve`,
800 -> `grund=budget`).

Wurzel: `usage.costCents` hat **null Reset-Stellen**; `MAX_BUDGET_EUR` ist faktisch
ein Lebenszeit-Cap und ein **geteilter Topf ueber alle Tenants** (7,79 EUR belegt,
davon nur 3,50 vom Owner — 55 % halten fremde Tenants). Befunde D1-D9 stehen in
Abschnitt 3 des Plans, das Begriffsmodell in Abschnitt 4.

## Bereits entschieden — nicht neu aufrollen

- **P0 wird NICHT ausgefuehrt.** `MAX_BUDGET_EUR` bleibt bei 8. Der Owner nimmt
  bewusst in Kauf, bis zum Wirksamwerden der Kette nicht telefonieren zu koennen.
  Wenn eine Phase P0 voraussetzt: nicht selbst ausfuehren, sondern melden.
- **Frage 2 (fremde Tenant-Zaehler): NEIN.** Keine Zaehler zuruecksetzen, keine
  `tenant_budget`-Zeilen von Hand, kein SQL gegen Produktivdaten. Der Perioden-Flip
  laesst die 4,29 EUR von allein aus dem Fenster fallen.
- **Frage 6 (hermes-db laeuft am 2026-07-24 ab): der Owner loest das separat.**
  Kein Grund, die Kette zu verzoegern — aber **P4 (Schema-Migration) erst starten,
  wenn die DB-Ablesung geklaert ist**. P1-P3 sind schema-frei und laufen sofort.
- **Fragen 3, 4, 7: Empfehlung des Plans uebernehmen** (Kalendermonat UTC;
  `exit(1)` nur bei echtem Schutzverlust; `DEFAULT_TENANT_BUDGET_CENTS` vor P2a
  verifizieren — ist der Live-Wert 0, ist P2a in Prod ein No-Op, der Code bleibt
  trotzdem richtig; das dann im Phasen-Report festhalten).

## Stopplinie — hier endet die Autonomie

Arbeite **P1 bis P5b autonom durch**. Diese Phasen sind additiv, inert oder rein
absichernd; keine aendert das Verhalten eines Gates zur Laufzeit.

**Stoppe vor P6 und frage den Owner.** P6 (Fruehwarnung) braucht Frage 5: ueber
welchen Kanal ein Mensch erreicht wird. P7 (der Flip) braucht Frage 1: die Hoehe
und Semantik beider Caps. Beides sind Geschaefts- und Risikoentscheidungen, keine
technischen. Das Pre-Mortem des Plans benennt exakt diese Luecke als Todesursache:
eine Warnung, die niemand abonniert hat.

Setze P6-P8 also **nicht** eigenmaechtig um. Melde stattdessen den Stand und lege
dem Owner Frage 1 und Frage 5 mit Optionen vor.

## Orchestrierungs-Modell

Du bist **Lead und liest selbst KEINEN Produktivcode**. Halte dein Kontextfenster
klein (Ziel < 100k). Pro Phase genau ein Lauf der Skill `phase-impl-lean`:
Plan -> Impl im Worktree -> dualer Review (Safety + Clean-Code) -> Self-Fix bis PASS
-> kompakter Report. Der Merge passiert **bei dir im Lead**, nie im Worktree-Agenten.

Modell-Pins **explizit pro `agent()`**, nie erben lassen:
Opus fuer Planung und Safety-Review, Sonnet fuer Implementierung, Audit, Fix, Report.

Reihenfolge strikt nach Abschnitt 7 des Plans. Sie ist so gebaut, dass der
Kostenschutz zu keinem Zeitpunkt schwaecher ist als heute — **diese Invariante
darfst du nicht zur Beschleunigung opfern**, auch nicht, wenn zwei Phasen
unabhaengig aussehen.

## Auflagen VOR dem ersten Workflow

1. **Plan und Prompt sind bereits committet** — du startest auf sicherem Grund.
   Aber im Arbeitsbaum liegen weiterhin ~13 geaenderte und ~55 untrackte Dateien
   aus fremden Workstreams (Animation-Lab, Reports, Analyse-Artefakte), und
   Worktree-Branches klobbern untrackte Dateien. Fasse sie nicht an, committe sie
   nicht mit, und **niemals `git add -A`** in diesem Repo (hat hier schon einen
   Stripe-Kundendump eingesammelt) — immer nur gezielt die Dateien deiner Phase.
2. **Kein `git stash`, solange ein `isolation: "worktree"`-Workflow laeuft.**
   `refs/stash` ist worktree-geteilt und wird sonst ueberschrieben.
3. Ausgangspunkt pruefen: `master`, HEAD ist der Doku-Commit `docs(budget-axes)`
   direkt ueber dem **Code-Stand `6522b60`** (der Doku-Commit aendert keinen Code —
   alle `datei:zeile`-Angaben im Plan gelten unveraendert). Weicht der Stand ab,
   **erst melden**, nicht raten.
4. Der Plan enthaelt **pseudonymisierte** Tenant-IDs (Fremd-Tenant B-E). Das ist
   Absicht. Trage keine echten Kunden-Identifikatoren in Reports oder Commits.

## Definition of Done pro Phase

- Test, der **vor** dem Fix rot ist (Repo-Standard) — rot-vor-Fix im Report belegen.
- `node --check` auf jede geaenderte Datei, danach `npm test` vollstaendig gruen
  (Basis: 343 Test-Dateien). Bei Rot: **isoliert nachpruefen**, bevor du es als
  echten Regress wertest — es gibt einen bekannten ~12 % Voll-Last-Flake
  (Seed-vor-Boot-Race).
- **Vor JEDEM Merge `git diff --stat` gegen den Phasen-Branch.** Ein PASS des
  Workflows ist keine Merge-Freigabe: ein toter Impl-Agent hinterlaesst einen
  leeren Branch, der trotzdem PASS meldet.
- Neue Env-Var? Dann in `src/config.js` **und** `.env.example` **und**
  `render.yaml` **und** `BASE_ENV` in `test/helpers.js` (sonst leakt lokales `.env`
  in Spawn-Tests).
- Sicherheitsrelevante Aenderung? `PLAN-SECURITY.md` nachziehen.
- Report pro Phase nach `tasks/budget-axes-<phase>-report.md`.

## Abschluss

Wenn P5b gemergt ist: kompakte Bilanz — was live-wirksam ist, was noch inert
hinter Flags liegt, welche Tests dazugekommen sind, und die beiden offenen Fragen
an den Owner. **Nicht deployen** ohne ausdrueckliche Freigabe; der Live-Service
ist Dashboard-managed und `render.yaml` ist dort nur Dokumentation.
