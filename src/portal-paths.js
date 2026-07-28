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
