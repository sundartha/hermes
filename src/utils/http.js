export const HTTP_OK = 200;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_PAYMENT_REQUIRED = 402;
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const HTTP_CONFLICT = 409;
export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_SERVER_ERROR = 500;
export const HTTP_SERVICE_UNAVAILABLE = 503;

export function antworteFehler(res, status, code) {
  return res.status(status).json({ error: code });
}

export function lehneEingabeAb(res, ungueltig, meldung) {
  if (ungueltig) antworteFehler(res, HTTP_BAD_REQUEST, meldung);
  return ungueltig;
}
