function istwertDesFehlschlags({ details }) {
  return details.error.cause?.actual ?? null;
}

export default async function* fehlschlagWerte(source) {
  for await (const { type, data } of source) {
    if (type === "test:fail") yield `${JSON.stringify(istwertDesFehlschlags(data))}\n`;
  }
}
