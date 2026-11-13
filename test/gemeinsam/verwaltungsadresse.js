import { POSTGRES_VARIABLE } from "./echtes-postgres.js";

export function verwaltungsAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}
