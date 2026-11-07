const EXIT_BEFUND = 1;

export function befundeMeldenUndScheitern(befunde) {
  for (const befund of befunde) console.error(befund);
  if (befunde.length > 0) process.exitCode = EXIT_BEFUND;
}
