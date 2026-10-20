function leiteFehlerausgabeUm() {
  const zeilen = [];
  const bisher = console.error;
  console.error = (...teile) => zeilen.push(teile.map(String).join(" "));
  return {
    zeilen,
    stelleWiederHer: () => {
      console.error = bisher;
    },
  };
}

export function fehlerausgabeVon(aufgabe) {
  const { zeilen, stelleWiederHer } = leiteFehlerausgabeUm();
  try {
    aufgabe();
  } finally {
    stelleWiederHer();
  }
  return zeilen;
}

export async function fehlerausgabeVonAsync(aufgabe) {
  const { zeilen, stelleWiederHer } = leiteFehlerausgabeUm();
  try {
    await aufgabe();
  } finally {
    stelleWiederHer();
  }
  return zeilen;
}
