import { after, before } from "node:test";

const stoppeServer = (srv) => srv.stop();
const IGNORIERE_STARTFEHLER = () => {};

export function serverJeDatei(startFn, stoppeFn = stoppeServer) {
  const halter = {};
  let start;

  before(() => {
    start = startFn().then((srv) => {
      halter.srv = srv;
    });
    return start;
  });

  after(async () => {
    await start?.catch(IGNORIERE_STARTFEHLER);
    if (halter.srv) await stoppeFn(halter.srv);
  });

  return halter;
}
