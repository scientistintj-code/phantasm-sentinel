import { useEffect } from "react";

export function useButtonRipple(): void {
  useEffect(() => {
    const reduce =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const timers = new Set<number>();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (!(button instanceof HTMLButtonElement) || button.disabled) return;
      const bounds = button.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "button-ripple";
      ripple.style.left = `${event.clientX - bounds.left}px`;
      ripple.style.top = `${event.clientY - bounds.top}px`;
      button.appendChild(ripple);
      const timer = window.setTimeout(() => {
        ripple.remove();
        timers.delete(timer);
      }, 500);
      timers.add(timer);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);
}
