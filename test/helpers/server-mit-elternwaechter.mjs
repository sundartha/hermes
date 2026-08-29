// Test-Einstiegspunkt statt "src/server.js" direkt: installiert einen Eltern-Waechter und
// startet danach den unveraenderten Server.
//
// WARUM: test/helpers.js#startServer raeumt sauber auf - 393 startServer()-Aufrufe stehen 440
// .stop()-Aufrufen gegenueber. Aber stop() laeuft nur auf dem GUTEN Pfad. spawn() legt das Kind
// nicht in eine eigene Prozessgruppe, und stirbt der Testrunner ABNORMAL (SIGKILL durch ein
// Sitzungslimit, ein gestoppter Workflow, ein pkill), ueberlebt sein Serverkind und wird an
// launchd durchgereicht. Am 29.08.2026 liefen so 19 verwaiste Server gleichzeitig, drei davon
// ueber einen Tag.
//
// WAS DAS KOSTET: nicht nur Speicher. Verwaiste Server treiben die Maschinenlast hoch (gemessen:
// Load 24). Ueberschreitet ein Serverstart dann STARTUP_TIMEOUT_MS (15 s), scheitert ein Test mit
// "Server-Start Timeout" - ein Fehler, der nichts mit der Aenderung des Agenten zu tun hat. Der
// Agent debuggt ein Phantom und verbrennt dabei Token (s. .claude/refs/workflow.md 2a).
//
// NICHT das Problem: Port-Kollisionen. BASE_ENV setzt PORT=0, jeder Server bekommt vom
// Betriebssystem einen freien Port. Zwei Testserver streiten sich nie um einen Port.
//
// MECHANIK: stirbt der Elternprozess, reicht das Betriebssystem das Kind an PID 1 durch. Genau
// das prueft der Waechter - und beendet sich dann selbst. Er lebt AUSSCHLIESSLICH in dieser
// Datei; die Produktion laedt sie nie, deshalb braucht es weder eine Env-Variable noch einen
// Eintrag in src/config.js.

const PRUEFINTERVALL_MS = 2000;
const INIT_PPID = process.ppid;
// Wird ein Prozess verwaist, uebernimmt ihn init/launchd unter dieser PID.
const WAISEN_PPID = 1;

const waechter = setInterval(() => {
  if (process.ppid === INIT_PPID && process.ppid !== WAISEN_PPID) return;
  // Der Testrunner ist weg. Ohne diesen Ausstieg liefe der Server unbegrenzt weiter.
  clearInterval(waechter);
  process.exit(0);
}, PRUEFINTERVALL_MS);

// Haelt den Prozess nicht kuenstlich am Leben: laeuft der Server reguelaer aus, endet auch er.
waechter.unref();

await import("../../src/server.js");
