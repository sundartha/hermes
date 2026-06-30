// ---- makeProfileRoutes (AC7) ----------------------------------------------------
// Extrahierte /api/profiles-Route-Gruppe (Rechteprofile verwalten, Phase 2) als
// Factory mit Dependency-Injection - gleiches Muster wie makeWebAuthRoutes/
// makeAdminRoutes/makeSelfServiceRoutes (web-auth.js ist die bewaehrte Vorlage).
// Template fuer die laufende server.js-Decomposition (P4/OT-5): EINE kohaerente
// Route-Gruppe, behavior-preserving (reine Verschiebung, keine Logik-Aenderung).
//
// Hinter Basic-Auth (server.js deckt /api/* ab). OAuth-MCP-Nutzer erreichen nur
// /mcp, nie /api/* -> kein Self-Service. Es gibt bewusst KEIN MCP-Tool dafuer.
// Der Profil-Schluessel ist seit Phase S die tenantId (vormals die email-/sub-Identitaet);
// resolveProfile/place_call lesen unter genau diesem Schluessel. validIdentity prueft nur
// die identitaets-foermige Gestalt (nicht-leerer String ohne Whitespace, <=254) - eine
// tenantId (z.B. "t_user_01...") erfuellt sie; KEINE strikte Email-Form. Derselbe Validator
// gilt im Onboard-Pfad fuer idpSubject/tenantId (server.js), daher generisch benannt.
import { Router } from "express";

export const IDENTITY_MAX_LEN = 254; // RFC 5321 (Email-Obergrenze, reicht auch fuer sub/tenantId)
export const validIdentity = (e) =>
  typeof e === "string" && e.length > 0 && e.length <= IDENTITY_MAX_LEN && !/\s/.test(e);

// deps: { store, audit }. store traegt listProfiles/setProfile/deleteProfile;
// audit ist die util.audit-Funktion (loggt nur Keys, keine Werte/PII).
export function makeProfileRoutes({ store, audit }) {
  const router = Router();

  router.get("/api/profiles", (_req, res) => res.json(store.listProfiles()));

  router.post("/api/profiles", (req, res) => {
    const { tenantId, ...fields } = req.body || {};
    if (!validIdentity(tenantId))
      return res.status(400).json({ error: "tenantId (Profil-Schluessel) ist Pflicht" });
    const { profile, changed } = store.setProfile(tenantId, fields);
    // Nur tenantId + Keys loggen - Profil-Werte (z.B. Nummern) gehoeren nicht ins Log.
    audit("profile_update", req, `tenantId=${tenantId} keys=${changed.join(",") || "-"}`);
    res.json({ tenantId, profile });
  });

  router.delete("/api/profiles/:tenantId", (req, res) => {
    const { tenantId } = req.params;
    if (!store.deleteProfile(tenantId)) return res.status(404).json({ error: "not found" });
    audit("profile_delete", req, `tenantId=${tenantId}`);
    res.json({ ok: true });
  });

  return router;
}
