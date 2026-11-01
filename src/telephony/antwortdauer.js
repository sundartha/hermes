import { mitKennung } from "../utils/anfrage-kennung.js";

const LOG_PREFIX = "[voice-antwort]";

export function antwortdauerMiddleware(req, res, next) {
  const eingangMs = Date.now();
  Object.assign(res.locals, { eingangMs });
  res.on("close", () =>
    mitKennung(res.locals.kennung, () => {
      const ende = res.writableFinished ? "beendet" : "abgebrochen";
      const weg = req.route?.path ?? "ohne-route";
      console.log(`${LOG_PREFIX} weg=${weg} ms=${Date.now() - eingangMs} status=${res.statusCode} ende=${ende}`);
    }),
  );
  next();
}
