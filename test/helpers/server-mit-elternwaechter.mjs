const PRUEFINTERVALL_MS = 2000;
const INIT_PPID = process.ppid;
const WAISEN_PPID = 1;

const waechter = setInterval(() => {
  if (process.ppid === INIT_PPID && process.ppid !== WAISEN_PPID) return;
  clearInterval(waechter);
  process.exit(0);
}, PRUEFINTERVALL_MS);

waechter.unref();

await import("../../src/server.js");
