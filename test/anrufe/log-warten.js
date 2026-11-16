export function logBisOderFrist(instanz, bedingung, fristMs) {
  const log = () => instanz.stdout;
  if (bedingung(log())) return Promise.resolve(true);
  return new Promise((fertig) => {
    const frist = AbortSignal.timeout(fristMs);
    const quellen = [instanz.child.stdout, instanz.child.stderr];
    const ende = () => {
      frist.removeEventListener("abort", ende);
      for (const quelle of quellen) quelle.off("data", pruefe);
      fertig(bedingung(log()));
    };
    const pruefe = () => bedingung(log()) && ende();
    frist.addEventListener("abort", ende);
    for (const quelle of quellen) quelle.on("data", pruefe);
  });
}
