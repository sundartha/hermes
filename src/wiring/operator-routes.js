// ---- operatorRoutes (AUTH-P6) -----------------------------------------------------
// Sechs Betreiber-Routen (4x /api/billing/*, 2x /api/onboard*) brauchen eine echte
// Admin-Sitzung: webAuthMw (Browser-Session) UND adminMw (role='admin' ODER
// ADMIN_EMAILS) - seit AUTH-P7 die EINZIGE Sicherung dieser Routen. Beide Middlewares
// entstehen HEUTE nur im
// guardedBoot-Block (src/wiring/web-login.js, wireWebLogin) - und der ist fail-OPEN
// (src/boot-guard.js): wirft ein Mount-Schritt dort, faengt guardedBoot es ab und die
// Wurzel bekommt operatorAuth NIE zugewiesen (bleibt null).
//
// HARTE INVARIANTE: fehlt operatorAuth, werden die sechs Routen GAR NICHT gemountet -
// niemals ungeschuetzt. Ein 404 ist damit der Meldeweg fuer einen verschluckten
// guardedBoot: die Live-Probe (scripts/probe-auth.sh) wertet ihn als DURCHFALL
// (W6). Waeren die Routen stattdessen ungeschuetzt gemountet, waere derselbe Ausfall
// eine offene Tuer, die niemandem auffaellt - das ist der Unterschied, den diese Datei
// erzwingt.
//
// EINE Stelle (G5/G27): die Bedingung "Sicherung da -> mounten, sonst nicht" steht hier
// genau einmal, nicht an sechs Registrierungsstellen in api-billing.js/api-onboard.js.
// Wer eine siebte Betreiber-Route kuenftig mit dem rohen Express-Router statt ueber
// diesen Registrar mountet, landet in ROUTE_CLASS.UNPROTECTED
// (src/route-policy.js) - die zweite, von Disziplin unabhaengige Sicherung
// (test/route-auth-inventory.test.js).
//
// KEINE Wrapper-Arrow um operatorAuth.webAuthMw/adminMw: sie werden nur durchgereicht,
// nicht umgehuellt. AUTH_MIDDLEWARE_NAMES (src/route-policy.js) erkennt Auth-Middleware
// an handler.name im Express-Stack - eine Arrow waere dort "<anonymous>" und der
// Inventar-Test fuer diese sechs Routen blind (s. Kopfkommentar dort).
export function operatorRoutes({ router, operatorAuth }) {
  const guarded = (register) => (path, handler) => {
    if (!operatorAuth) return; // fail-closed: Route existiert nicht (404) statt ungeschuetzt
    register(path, operatorAuth.webAuthMw, operatorAuth.adminMw, handler);
  };
  return {
    get: guarded(router.get.bind(router)),
    post: guarded(router.post.bind(router)),
  };
}
