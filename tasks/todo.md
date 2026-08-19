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
- [ ] 7. OFFEN - Owner-Tenant allowLookup in Prod-DB: DB-Zugriff (psql + Render-
      Query) in dieser Session vom Berechtigungs-Classifier geblockt. VERMUTLICH
      schon true (alte In-Call-Recherche lief seit 08-01 live auf diesem Recht;
      B4-Flip wirkt nicht auf Bestands-Tenants) - UNBELEGT. Readback:
      psql "$(cat ~/.config/hermes/db-url)" -c "SELECT tenant_id, data->'allowLookup' FROM profile;"
- [x] 8. Routen-Smoke: POST lookup/consult ohne Token -> 403 (vorher 404);
      Server-Log zeigt "[el-lookup] abgelehnt grund=token". healthz 200.
- [ ] 9. Prod-Smoke-Anruf: AUSGELASSEN (Eigentuemer-Ansage "kein Testanruf").
      Der naechste MCP-Anruf ist der Beleg - kann zugleich die offene
      get_consult-Probe sein (Frage stellen, die NICHT im Briefing steht).
- [x] 10. Doku (.fortschritt.md Cutover-Eintrag), Commit, Push beide Remotes,
      Caffeinate aus.
