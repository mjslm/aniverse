const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
let lastPage = "";
export function animatePage(root, page) {
  if (page === lastPage) return;
  lastPage = page;
  if (reduced()) return;
  root.querySelector("main")?.animate([{ opacity: 0.35, translate: "0 7px" }, { opacity: 1, translate: "0 0" }], { duration: 210, easing: "cubic-bezier(.2,.7,.3,1)" });
}
export // Skip decorative movement when the device requests reduced motion.
function installFeedback() {
  document.addEventListener("pointerdown", (event) => {
    if (reduced() || event.button !== 0) return;
    const button = event.target.closest(".btn,.chip,.quick-action,.payment-method,.option-list button");
    if (!button || button.disabled) return;
    const rect = button.getBoundingClientRect(), ripple = document.createElement("span"), size = Math.max(rect.width, rect.height) * 2;
    ripple.className = "interaction-ripple";
    ripple.setAttribute("aria-hidden", "true");
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX - rect.left - size / 2}px;top:${event.clientY - rect.top - size / 2}px`;
    button.append(ripple);
    setTimeout(() => ripple.remove(), 550);
  }, { passive: true });
}
