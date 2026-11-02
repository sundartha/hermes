const ABHAENGIGKEITEN_OHNE_BELANG = [
  "callFinish lifecycle provisioning ttsStore directiveSynth voiceRender messaging",
  "elevenLabsOutbound inboundBridges consultDelivery durableAuditFor",
].flatMap((zeile) => zeile.split(" "));

const leererDienst = new Proxy(function leererDienst() {}, {
  get: (_ziel, name) => (name === "then" ? undefined : leererDienst),
  apply: () => leererDienst,
});

async function stummGebaut(abhaengigkeiten) {
  const { buildApp } = await import("../../src/app.js");
  const echtesLog = console.log;
  const echterFehler = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return (await buildApp(abhaengigkeiten)).app;
  } finally {
    console.log = echtesLog;
    console.error = echterFehler;
  }
}

export async function appOhneAbhaengigkeiten(t, abhaengigkeiten) {
  const app = await stummGebaut({
    ...Object.fromEntries(ABHAENGIGKEITEN_OHNE_BELANG.map((name) => [name, leererDienst])),
    ...abhaengigkeiten,
  });
  const server = await new Promise((fertig) => {
    const lauscht = app.listen(0, "127.0.0.1", () => fertig(lauscht));
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}
