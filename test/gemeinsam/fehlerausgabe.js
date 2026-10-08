export function fehlerausgabeVon(aufgabe) {
  const zeilen = [];
  const bisher = console.error;
  console.error = (...teile) => zeilen.push(teile.join(" "));
  try {
    aufgabe();
  } finally {
    console.error = bisher;
  }
  return zeilen;
}
