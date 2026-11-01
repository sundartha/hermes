import path from "node:path";

export default async function* roteDateienReporter(quelle) {
  const rot = new Set();
  for await (const { type, data } of quelle) {
    if (type === "test:fail" && data?.file) rot.add(path.relative(process.cwd(), data.file));
  }
  yield `${JSON.stringify([...rot].sort())}\n`;
}
