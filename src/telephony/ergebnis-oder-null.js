export function ergebnisOderNull(versprechen, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), Math.max(0, ms));
    timer.unref?.();
    const beende = (ergebnis) => {
      clearTimeout(timer);
      resolve(ergebnis);
    };
    versprechen.then(beende, () => beende(null));
  });
}
