// Tenant-/Identitaets-Resolver (T4 Phase 1 — Konsolidierung der A4-Extraktion).
//
// Konsolidiert den vormals in src/request-tenant.js (A4) extrahierten Resolver an
// seinen T4-Zielort src/routes/_tenant.js (siehe docs/strategy/t4-server-decomposition.md
// §3.2). src/request-tenant.js bleibt als reiner Re-Export bestehen, damit alle
// A4-Importe (server.js, request-tenant-unit.test.js) byte-identisch weiterlaufen.
//
// Seiteneffektfrei: kein app.listen, kein DB-/Netz-Zugriff. Ein Import von server.js
// startet ueber app.listen() den HTTP-Server (deshalb laden alle Tests server.js per
// Spawn) - der Resolver bleibt damit nicht unit-testbar. Hier liegt er ohne Boot
// importierbar. Der store wird per Factory injiziert (Repo-Muster makeProfileRoutes/
// makeSelfServiceRoutes), config wird per DI gereicht (T4-Vertrag
// makeTenantResolver({ store, config })) und defaultet auf das config-Singleton - das
// haelt das Modul DB-frei und vermeidet einen Zirkel-Import mit server.js.
import { config as defaultConfig } from "../config.js";
import { BOOTSTRAP_TENANT_ID } from "../store/defaults.js";

// === Reine Helfer / Konstanten (ohne store/config) =============================

// Localhost anhand der echten Socket-Adresse erkennen - req.ip ist hinter trust proxy
// aus X-Forwarded-For abgeleitet und damit von Clients faelschbar. Reine Funktion ohne
// Deps: von Middleware UND Resolver genutzt -> EINE Quelle (T4 R1.3), nicht doppeln.
export const isLocalSocket = (req) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

// Identitaet eines internen Aufrufers (Rechteprofile, Phase 2). Die MCP-Tools
// laufen im selben Prozess und rufen die localhost-REST-API mit dem verifizierten
// X-Internal-Identity-Header (aus req.auth.email im /mcp-Handler). Der Header wird
// NUR von localhost-Sockets akzeptiert - von extern ist er faelschbar und wird
// ignoriert (-> Owner). Body-Felder (requestedBy/email) NIE als Identitaet nutzen.
export function internalIdentity(req) {
  if (!isLocalSocket(req)) return null;
  const id = req.headers["x-internal-identity"];
  return typeof id === "string" && id ? id : null;
}

// requestedBy-Marker fuer den Owner (localhost/stdio ohne Identitaet).
export const OWNER_ID = "owner";
// Sentinel fuer ein verifiziertes Token OHNE email UND sub: bewusst NICHT Owner
// (fail-closed), sondern restriktiv (resolveProfile -> DEFAULT_PROFILE).
export const ANON_IDENTITY = "anon";

// Tenant-Achse (I4), getrennt von der Profile-Achse. Marker fuer eine VORHANDENE,
// aber unbekannte/unaufloesbare Identitaet: kein Tenant -> REJECT (NIE Owner).
// In I4 filtert noch KEIN Endpunkt; I5/I6/I7 machen daraus 404/403.
export const TENANT_REJECT = "reject";

// Ownership-Regel fuer einen Call (I5): gehoert der Call dem Request-Tenant?
// Reine Funktion ohne Deps, Teil des Resolver-Vertrags (T4 §3.2). server.js haelt
// heute noch eine inline-Kopie (Z. 371); T4 Phase 5 stellt cancel + /api/calls/:id
// auf tenant.tenantOwnsCall um und entfernt die Kopie. Hier ist die kanonische Quelle.
export const tenantOwnsCall = (call, tenant) => call.tenantId === tenant;

// === Factory ====================================================================

// makeTenantResolver({ store, config }) — kanonische T4-Naht. Liefert die an store
// (+ config) gebundenen Resolver plus die reinen Helfer/Konstanten als EIN Objekt
// (T4 §3.2: server.js baut EINE Instanz, nutzt sie in Middleware/mcp und injiziert
// dieselbe Instanz in jede Route-Factory -> kein zweiter Resolver, G5/DIP).
// config defaultet auf das config-Singleton, damit der A4-Kompat-Pfad
// (makeRequestTenant) ohne explizite config byte-identisch dieselbe Quelle liest
// (Tests mutieren config.multiTenant live auf dem Singleton).
export function makeTenantResolver({ store, config = defaultConfig }) {
  // EXPLIZITE Bindung an den konfigurierten Single-Tenant-Bootstrap (P3). Genau EINE
  // Stelle, an der der Flag-aus-/Single-Tenant-Pfad an einen Tenant gebunden wird -
  // benannt statt als roher BOOTSTRAP_TENANT_ID-Constant-Return verstreut (G5/N3).
  const singleTenantBootstrap = () => BOOTSTRAP_TENANT_ID;

  // Request-Tenant aus der Auth-Identitaet aufloesen (Geschwister zu internalIdentity).
  // Aufloesungs-Reihenfolge (load-bearing):
  //   (1) Flag aus -> explizite Bootstrap-Bindung (singleTenantBootstrap, kein
  //       Aufloesungs-Pfad; muss ZUERST stehen, sonst kaeme bei Flag aus ein
  //       Session-Tenant statt des Bootstrap-Tenants -> R5).
  //   (2) req.tenant (Web-Session, A4): VOR der req.auth-Logik. req.tenant wird im
  //       ganzen src/ NUR von webAuthMiddleware gesetzt (web-auth.js) - erst nach
  //       signiertem Cookie + gueltiger, nicht-invalidierter DB-Session + aktivem
  //       Account. Das ist die STAERKERE, jederzeit invalidierbare Identitaet und hat
  //       darum Vorrang vor req.auth (nur ein gueltiges JWT, dessen sub erst per
  //       resolveTenant nachgeschlagen wuerde). req.tenant.tenantId wird DIREKT
  //       zurueckgegeben - kein zweiter resolveTenant-Lookup, sonst koennte ein
  //       zweiter Resolver bei einem Tenant ohne idpSubject von der DB-Session
  //       divergieren (R7). fail-closed: leere/fehlende tenantId -> TENANT_REJECT,
  //       NIE Owner. Bewusst `||`, NICHT `??` - `??` liesse `""` durch (R2).
  //   (3) req.auth.sub (MCP-Achse) bzw. localhost-internalIdentity. FEHLENDE Identitaet
  //       (kein req.auth UND kein localhost-internal, also der localhost-/stdio-
  //       Single-Operator-Kanal) -> explizite Bootstrap-Bindung (P3, singleTenantBootstrap;
  //       vormals roher BOOTSTRAP_TENANT_ID-Constant-Return). VORHANDENE, aber
  //       unbekannte/leere Identitaet -> TENANT_REJECT (resolveTenant liefert null).
  // Hinweis (I5-Vorbereitung): der REST-X-Internal-Identity-Kanal traegt heute
  // email-first (mcp-tools), die Tenant-Achse keyt aber auf sub. I4 nutzt sub nur
  // auf dem /mcp-Pfad (req.auth direkt); die REST-seitige sub-Durchreichung folgt
  // in I5, wenn ein Lesepfad sie tatsaechlich filtert.
  function requestTenant(req) {
    if (!config.multiTenant) return singleTenantBootstrap();
    if (req.tenant) return req.tenant.tenantId || TENANT_REJECT; // Web-Session, fail-closed
    const sub = req.auth ? req.auth.sub : null;
    const internal = req.auth ? null : internalIdentity(req);
    // FEHLENDE Identitaet (kein req.auth UND kein localhost-internal, also der
    // localhost-/stdio-Single-Operator-Kanal): EXPLIZITE Bindung an den Bootstrap-
    // Tenant (P3, singleTenantBootstrap), NICHT mehr als roher BOOTSTRAP_TENANT_ID-
    // Constant-Return. Das ist KEIN Leck: ohne Identitaet ist dies der vertraute
    // Owner-/Betreiber-Kanal (V4-Kontrakt, von I4 security-reviewed). Der echte
    // fail-closed-Riegel sitzt eine Zeile tiefer: eine VORHANDENE, aber unbekannte
    // Identitaet -> TENANT_REJECT (NIE Owner).
    if (!sub && !internal) return singleTenantBootstrap();
    const tenantId = store.resolveTenant(sub || internal);
    return tenantId || TENANT_REJECT; // vorhanden-aber-unbekannt -> Reject, NIE Owner
  }

  // I6: Request-Tenant fuer Schreib-/Steuer-Pfade aufloesen UND fail-closed gaten.
  // Eine VORHANDENE, aber unbekannte Identitaet (TENANT_REJECT) wird hart mit 403
  // abgewiesen, statt in einen Pseudo-Tenant-Bucket zu schreiben (Owner-Entscheidung).
  // Liefert den Tenant ODER null (dann ist 403 bereits gesendet -> Handler returnt).
  // Flag AUS / fehlende Identitaet -> requestTenant === singleTenantBootstrap(), nie
  // REJECT -> Guard inert -> Owner-Pfad byte-identisch. Nur eine VORHANDENE, aber
  // unbekannte Identitaet -> REJECT -> 403. Eigenstaendig von I5's call-404-Helper
  // (requireTenantOwnsCall vergleicht call.tenantId); dieser wrappt nur requestTenant.
  function requireTenant(req, res) {
    const tenant = requestTenant(req);
    if (tenant === TENANT_REJECT) {
      res.status(403).json({ error: "Keine Tenant-Zuordnung fuer diese Identitaet." });
      return null;
    }
    return tenant;
  }

  return {
    isLocalSocket,
    internalIdentity,
    requestTenant,
    requireTenant,
    tenantOwnsCall,
    OWNER_ID,
    ANON_IDENTITY,
    TENANT_REJECT,
  };
}

// Alias auf makeTenantResolver (T4-Namenskonvention create*; identische Semantik).
export const createTenantResolver = makeTenantResolver;

// makeRequestTenant(store) — A4-Kompat-Naht: byte-identische Signatur und Rueckgabe
// (nur { requestTenant, requireTenant }), damit server.js (Z. 55) und
// request-tenant-unit.test.js unveraendert weiterlaufen. Delegiert an
// makeTenantResolver mit default-config (dasselbe config-Singleton wie zuvor).
export function makeRequestTenant(store) {
  const { requestTenant, requireTenant } = makeTenantResolver({ store });
  return { requestTenant, requireTenant };
}
