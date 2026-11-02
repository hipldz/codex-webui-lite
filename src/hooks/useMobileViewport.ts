import { useEffect } from "react";

export const MOBILE_LAYOUT_QUERY = "(max-width: 700px), (max-width: 1000px) and (pointer: coarse)";

export function useMobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const mobile = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const root = document.documentElement;
    let frame = 0;
    const clear = () => {
      root.style.removeProperty("--viewport-height");
      root.style.removeProperty("--viewport-top");
    };
    const update = () => {
      frame = 0;
      if (!mobile.matches) {
        clear();
        return;
      }
      // Pinch zoom should magnify the existing layout instead of resizing it.
      if (Math.abs(viewport.scale - 1) > 0.01) return;
      root.style.setProperty("--viewport-height", `${viewport.height}px`);
      root.style.setProperty("--viewport-top", `${viewport.offsetTop}px`);
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    mobile.addEventListener("change", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      mobile.removeEventListener("change", schedule);
      clear();
    };
  }, []);
}
