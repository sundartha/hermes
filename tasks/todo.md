# KV2-11: EL-Settlement freigeben + Deploy KV2-10/11 (2026-09-02)

- [x] 1. KV2-11 gebaut und gemergt (merge d0bf81b, Phase phase/task-impl 4c0ed9d):
      EL-Riegel aus sweepDarfKorrigieren entfernt, B6-Schutz lebt in
      istVollBelegt/dataComplete. Gate PASS (Safety FREIGABE, Clean-Code PASS),
      Suite auf master 5683/5683 gruen. Spec tasks/kostenv2/spec-kv2-11.md,
      Tests test/kv2-11-el-settlement.test.js (6 Faelle).
      VERIFIKATION: npm test -> "# pass 5683 / # fail 0".
- [x] 2. Deploy KV2-10+11: ERLEDIGT 2026-09-02 12:26 MESZ. gh-Login (Antonio20045)
      erneuert; upstream-Divergenz (2 Website-Commits, Analytics-Consent +
      Login-Redirect-Guard) sauber gemergt (9b6b197), beide Suiten gruen
      (Backend 5664/5664, Web 195/195), push zu BEIDEN Remotes, Render-Deploy
      dep-dabvj9btqb8s73dn7fn0 live auf 9b6b197.
      BELEG: /healthz -> {"ok":true,"commit":"9b6b197..."}; DB-Migration gelaufen
      (call_cost_evidence-Tabelle + cost_profile-Spalte in Prod-DB je count=1).
- [ ] 3. Nach dem Deploy: erster Sweep schreibt Kosten-Buch fuer neue EL-Anrufe
      (el_reifung= in der Sweep-Zeile); Erstattungen erst ab Anrufen NACH dem
      Deploy (heutiger Testanruf call_mtjsvfkpuzm8 bleibt bewusst ohne Erstattung
      - sein EL-Beleg wurde nie geschrieben).

# Durchgang 2026-08-19 (2): EL-Weg LIVE bringen — ERLEDIGT bis auf 2 Restpunkte

Auftrag: "mache alles, was du jetzt gesagt hast"; Nachtrag: KEIN Testanruf.

- [x] 1. Merge upstream/master: Richtung GEDREHT (HEAD=upstream, Commit 047f8c6) -
      Begruendung und Hergang in .fortschritt.md (Suppressions-Gate zaehlt beim
      Merge die Gegenseite als Bewegung). 7 Konflikte aufgeloest, ingest-Datei
      regulaer bereinigt (recordHangupOutcome/endStatusFor auf Modulebene).
      BELEG: Hook gruen ohne neuen Altlast-Eintrag; 57 Ingest-Tests gruen.
- [x] 2. Suite: 4888/4888 gruen auf dem Endbaum. (Huerde: nodemailer fehlte -
      npm install, nicht nur lockfile; dazu Zombie-Suite von 09:25 gekillt.)
- [x] 3. Push origin + upstream: beide auf 047f8c6.
- [x] 4. Render-Inventur: Service vodafone-agent srv-d8m0fhflk1mc73bno570,
      autoDeploy=no; hermes-web hat NICHT mitdeployt (Marketing-Gate intakt).
- [x] 5. Env additiv gesetzt (merge): EL-Outbound-Flag+IDs+Tool-Token,
      LOOKUP_ENABLED, EXA_API_KEY, Consult-Flags. BELEG: Boot-Banner
      "In-Call-Nachschlag: AKTIV ... EXA_API_KEY gesetzt".
- [x] 6. Deploy dep-da2rc3b7uimc73b91g50 live; /healthz zeigt 047f8c6.
- [x] 7. Owner-Tenant allowLookup: BELEGT per psql-Readback (19.08. abends,
      nach Allowlist-Fix): Admin-Tenant t_user_01KX600834GCJFV9GTZQKWZMTH traegt
      allowLookup=true SEIT der AL-Aera - live wirksam seit dem 15:57-Boot,
      kein Write, kein Neustart noetig. Die zwei Member-Tenants (weitere
      WorkOS-Logins des Owners) stehen auf false; optionaler Owner-Befehl ist
      in der Session uebergeben (DB-Writes blockt der Classifier fuer Agenten).
      NEBENBEFUND: DB-Allowlist jetzt 0.0.0.0/0 (Owner selbst, s. PLAN-SECURITY);
      Render-API-Key liegt in ~/.config/hermes/render-api-key.
- [x] 8. Routen-Smoke: POST lookup/consult ohne Token -> 403 (vorher 404);
      Server-Log zeigt "[el-lookup] abgelehnt grund=token". healthz 200.
- [ ] 9. Prod-Smoke-Anruf: AUSGELASSEN (Eigentuemer-Ansage "kein Testanruf").
      Der naechste MCP-Anruf ist der Beleg - kann zugleich die offene
      get_consult-Probe sein (Frage stellen, die NICHT im Briefing steht).
- [x] 10. Doku (.fortschritt.md Cutover-Eintrag), Commit, Push beide Remotes,
      Caffeinate aus.

## Geo-Nummern-Strategie (Start 2026-09-01, Workflow geo-nummern-strategie)

- [x] 1. Strategie-Doc PLAN-GEO-NUMMERN.md erstellt: Telnyx-Regulatorik (KYC/Requirement
      Groups), Laender-Matrix, Interims-US-Nummer-Konzept, Zustandsmaschine Swap,
      Phasenplan mit Gates, Pre-Mortem, offene Owner-Entscheidungen.
      ERWARTET: Datei existiert, alle Pflichtabschnitte vorhanden, Abnahme-Agent
      pass=true und blockers=[].
      VERIFIKATION: Workflow-Abnahme-Verdict; grep '^## ' PLAN-GEO-NUMMERN.md zeigt
      die Pflichtabschnitte; grep -c '[äöüÄÖÜß]' = 0.
      BELEG: Abnahme pass=true, geprueft=8/8, blockers=[] (Run wf_31f308d2-6b8);
      11 H2-Pflichtabschnitte vorhanden; Umlaut-Grep = 0; 768 Zeilen.
- [x] 2. Fakten gesichert: jede Telnyx-Kernaussage im Doc traegt eine Quelle,
      Unsicherheiten als UNBESTAETIGT markiert, file:line-Referenzen stimmen.
      ERWARTET: Fakten-Check-Linse und Abnahme melden 0 Abweichungen nach Fix-Runde.
      VERIFIKATION: Abnahme-Verdict blockers=[]; Stichprobe per grep im Repo.
      BELEG: Fakten-Check-Linse 6 Befunde, alle in Fix-Runde 1 eingearbeitet
      (23/23 angewandt, 0 widerlegt); Abnahme-Stichprobe 5 file:line ok.
