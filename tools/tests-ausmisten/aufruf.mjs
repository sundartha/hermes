export function gewaehlterBefehl({ values, positionals }, { pflicht, aufruf }) {
  const [name] = positionals;
  const bekannt = Object.hasOwn(pflicht, name) && positionals.length === 1;
  if (bekannt && pflicht[name].every((option) => values[option] !== undefined)) return name;
  console.error(aufruf);
  return undefined;
}
