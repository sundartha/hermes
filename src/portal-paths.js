// ---- Kunden-Portal-Pfade (EINE Quelle, G5/G25) ---------------------------------
// Nach dem Loeschen von public/tenant.html ist die App-Shell des apps/web-Builds
// das EINZIGE Kunden-Dashboard. Drei Module brauchen dieselben Pfade: das statische
// Serving + der Post-Login (src/app.js), die Stripe-Rueckkehr im Self-Service
// (src/self-service-routes.js) und die Karten-Erfassung (src/routes/api-billing.js).
// Eigenes Modul, weil src/app.js die Routen-Module importiert - der Import in die
// Gegenrichtung waere ein Zyklus.

// App-Shell im apps/web-Build (WEB_DIST_DIR).
export const APP_PATH = "/app";

// Altpfad des geloeschten Dashboards. Bleibt als 302 auf APP_PATH bestehen - NICHT
// aus Nostalgie: Stripe-Checkout-Sessions, die VOR dem Deploy geoeffnet wurden,
// tragen die alte Rueckkehr-Adresse IN der Stripe-Session. Ohne den Redirect landet
// genau der Kunde, der gerade bezahlt hat, auf einem 404. Zusaetzlich: Bookmarks.
export const LEGACY_PORTAL_PATH = "/tenant.html";

// Rueckkehr-Ziele nach Stripe Checkout. Die App-Shell wertet ?card / ?sub aus
// (apps/web BillingIsland). EINE Quelle, damit Server-Ziel und ausgewerteter
// Parameter nicht auseinanderdriften koennen - test/p14-checkout-return-app-shell.
// test.js prueft genau diese Kopplung gegen den echten Shell-Quelltext.
export const CHECKOUT_RETURN = Object.freeze({
  CARD_OK: `${APP_PATH}?card=ok`,
  CARD_CANCELED: `${APP_PATH}?card=canceled`,
  CARD_ERROR: `${APP_PATH}?card=error`,
  SUB_OK: `${APP_PATH}?sub=ok`,
  SUB_FAILED: `${APP_PATH}?sub=failed`,
});

// ---- Eingetippte Sackgassen (AUTH-P7, Owner-Entscheidung 2026-08-02) -------------
// Wer eine dieser Adressen von Hand in die Adresszeile tippt, landete bis AUTH-P7 im
// Basic-Auth-Dialog und danach auf einem 404 - beides fuer einen Menschen wertlos.
// Diese Phase leitet sie um. EINE Quelle fuer die Pfade (G5/G25): src/app.js mountet
// daraus, src/route-policy.js ordnet daraus ein - kein Stringliteral an zwei Orten.
//
// NUR die QUELL-Pfade stehen hier. Die Ziele bleiben, wo sie schon leben (APP_PATH
// oben, das Login-Ziel in src/app.js) - eine vierte Definition von "/auth/login"
// waere genau die Duplizierung, die diese Tabelle vermeiden soll.
//
// Wer hier einen Pfad ergaenzt, muss pruefen, dass apps/web keine gleichnamige Seite
// ausliefert: der Mount liegt VOR express.static und wuerde sie beschatten.
export const LOGIN_ALIAS_PATHS = Object.freeze(["/login", "/signin", "/sign-in"]);
export const APP_ALIAS_PATHS = Object.freeze(["/dashboard", "/account", "/portal", "/admin"]);
