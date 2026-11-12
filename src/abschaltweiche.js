import { isTrustedLocalCaller } from "./routes/_tenant.js";
import { HTTP_SERVICE_UNAVAILABLE } from "./utils/http.ts";

const RETRY_AFTER_SEKUNDEN = "5";

export const OFFENE_WEICHE = (_req, _res, next) => next();

export function makeAbschaltweiche() {
  let eingeschaltet = false;
  return {
    einschalten: () => {
      eingeschaltet = true;
    },
    middleware: (req, res, next) => {
      if (!eingeschaltet || isTrustedLocalCaller(req)) return next();
      res
        .status(HTTP_SERVICE_UNAVAILABLE)
        .set({ "Retry-After": RETRY_AFTER_SEKUNDEN, Connection: "close" })
        .end();
    },
  };
}
