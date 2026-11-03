import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const storageKey = "codex-web:sidebar-width";
const defaultWidth = 272;
const minWidth = 240;
const maxWidth = () => Math.max(minWidth, Math.min(480, window.innerWidth - 420));
const clamp = (width: number) => Math.max(minWidth, Math.min(maxWidth(), width));

export function useSidebarResize() {
  const [savedWidth, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved >= minWidth) return Math.min(480, saved);
    } catch {
      // Resizing still works when browser storage is unavailable.
    }
    return defaultWidth;
  });
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const [limit, setLimit] = useState(maxWidth);
  const width = Math.min(savedWidth, limit);

  useEffect(() => {
    const resize = () => {
      setLimit(maxWidth());
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (resizing) return;
    try {
      localStorage.setItem(storageKey, String(savedWidth));
    } catch {
      // Keep the current width even if it cannot be saved.
    }
  }, [savedWidth, resizing]);

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
  };

  return {
    width,
    resizing,
    handleProps: {
      role: "separator",
      tabIndex: 0,
      "aria-label": "Resize sidebar",
      "aria-orientation": "vertical" as const,
      "aria-valuemin": minWidth,
      "aria-valuemax": limit,
      "aria-valuenow": width,
      title: "Drag to resize · Double-click to reset",
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, width };
        setResizing(true);
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (start?.pointerId === event.pointerId)
          setWidth(clamp(start.width + event.clientX - start.x));
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onDoubleClick: () => setWidth(clamp(defaultWidth)),
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 40 : 10;
        const next =
          event.key === "ArrowLeft"
            ? width - step
            : event.key === "ArrowRight"
              ? width + step
              : event.key === "Home"
                ? minWidth
                : event.key === "End"
                  ? maxWidth()
                  : undefined;
        if (next === undefined) return;
        event.preventDefault();
        setWidth(clamp(next));
      },
    },
  };
}
