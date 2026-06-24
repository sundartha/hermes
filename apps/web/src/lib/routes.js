// Zentrale interne Routen-Ziele des Frontends. EINE Quelle, damit der Login-/
// Funnel-Einstieg an genau einer Stelle umschaltbar ist (heute Gateway-OIDC-
// Redirect; W3 macht /auth/login lauffaehig). Kein verstreutes /auth/login-
// Literal mehr (Clean-Code G5/S2). Bewusst abhaengigkeitsfrei (kein fetch/DOM),
// damit SSG-Frontmatter UND Browser-Inseln dieselbe Konstante teilen.

// Login = Registrierung (Account entsteht beim ersten OIDC-Login). Get-started/
// Log-in/Sign-in-CTAs zeigen alle hierher.
export const LOGIN_URL = "/auth/login";
