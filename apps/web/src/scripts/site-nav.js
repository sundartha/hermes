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

  const wide = window.matchMedia("(min-width: 1001px)");
  wide.addEventListener("change", (event) => {
    if (event.matches && isOpen()) setOpen(false);
  });
}
