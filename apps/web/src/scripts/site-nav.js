// Menue der Unterseiten (layouts/Hermes.astro) unter 1000 px.
//
// Das Blatt steht immer im DOM und wird nur ueber das hidden-Attribut gezeigt;
// aria-expanded und die Beschriftung des Knopfs folgen dem Zustand. Die
// Beschriftungen kommen aus data-label-open/-close (Sprache der Seite), nicht
// aus diesem Modul. Escape schliesst und gibt den Fokus an den Knopf zurueck,
// ein Klick ausserhalb oder auf einen Link im Blatt schliesst ebenfalls.
// Externes Modul: die Produktions-CSP laesst kein Inline-Script zu.

const toggle = document.querySelector("[data-nav-toggle]");
const sheet = toggle && document.getElementById(toggle.getAttribute("aria-controls"));

if (toggle && sheet) {
  const isOpen = () => !sheet.hidden;

  const setOpen = (open, { returnFocus = false } = {}) => {
    sheet.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    const label = open ? toggle.dataset.labelClose : toggle.dataset.labelOpen;
    if (label) toggle.setAttribute("aria-label", label);
    if (!open && returnFocus) toggle.focus();
  };

  toggle.addEventListener("click", () => setOpen(!isOpen()));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      setOpen(false, { returnFocus: true });
    }
  });

  document.addEventListener("click", (event) => {
    if (!isOpen()) return;
    if (toggle.contains(event.target) || sheet.contains(event.target)) return;
    setOpen(false);
  });

  sheet.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });

  // Wird das Fenster breiter als die Menue-Grenze, gibt es den Knopf nicht mehr:
  // ein offenes Blatt darf dann nicht unsichtbar offen bleiben.
  const wide = window.matchMedia("(min-width: 1001px)");
  wide.addEventListener("change", (event) => {
    if (event.matches && isOpen()) setOpen(false);
  });
}
