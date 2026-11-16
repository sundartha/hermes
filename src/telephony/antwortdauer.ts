import { mitKennung } from "../utils/anfrage-kennung.ts";

const LOG_PREFIX = "[voice-antwort]";

interface AntwortAnfrage {
  route?: { path?: string };
}

interface AntwortAntwort {
  locals: { kennung: string };
  writableFinished: boolean;
  statusCode: number;
  on: (ereignis: "close", weiter: () => void) => unknown;
}

export const makeAntwortdauerMiddleware = (now: () => number) => (req: AntwortAnfrage, res: AntwortAntwort, next: () => void): void => {
  const eingangMs = now();
  Object.assign(res.locals, { eingangMs });
  res.on("close", () => {
    mitKennung(res.locals.kennung, () => {
      const ende = res.writableFinished ? "beendet" : "abgebrochen";
      const weg = req.route?.path ?? "ohne-route";
      console.log(`${LOG_PREFIX} weg=${weg} ms=${String(now() - eingangMs)} status=${String(res.statusCode)} ende=${ende}`);
    });
  });
  next();
};
