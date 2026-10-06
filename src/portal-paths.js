export const APP_PATH = "/app";

export const LEGACY_PORTAL_PATH = "/tenant.html";

export const CHECKOUT_RETURN = Object.freeze({
  CARD_OK: `${APP_PATH}?card=ok`,
  CARD_CANCELED: `${APP_PATH}?card=canceled`,
  CARD_ERROR: `${APP_PATH}?card=error`,
  SUB_OK: `${APP_PATH}?sub=ok`,
  SUB_FAILED: `${APP_PATH}?sub=failed`,
});

export const LOGIN_ALIAS_PATHS = Object.freeze(["/login", "/signin", "/sign-in"]);
export const APP_ALIAS_PATHS = Object.freeze(["/dashboard", "/account", "/portal", "/admin"]);
