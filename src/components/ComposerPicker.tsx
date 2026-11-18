import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";

type PickerOption = { value: string; label: string; description?: string };

function scrollOptionIntoView(option?: HTMLButtonElement | null) {
  const list = option?.closest<HTMLElement>('[role="listbox"]');
  if (!option || !list) return;
  const optionBounds = option.getBoundingClientRect();
  const listBounds = list.getBoundingClientRect();
  if (optionBounds.top < listBounds.top) list.scrollTop -= listBounds.top - optionBounds.top;
  else if (optionBounds.bottom > listBounds.bottom)
    list.scrollTop += optionBounds.bottom - listBounds.bottom;
}

export function ComposerPicker({
  kind,
  label,
  icon: Icon,
  value,
  options,
  disabled = false,
  placeholder,
  title,
  note,
  onChange,
}: {
  kind: "model" | "effort" | "permission";
  label: string;
  icon: LucideIcon;
  value: string;
  options: PickerOption[];
  disabled?: boolean;
  placeholder?: string;
  title?: string;
  note?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selected = options.find((option) => option.value === value);
  const activeLabel = selected?.label || value || placeholder || label;
  const unavailable = disabled || !options.length;

  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const element = menu.current;
    if (!element) return;
    const viewport = window.visualViewport;
    const container = element.closest(".chat-main");
    const updateHeight = () => {
      const top = Math.max(viewport?.offsetTop || 0, container?.getBoundingClientRect().top || 0);
      const available = element.getBoundingClientRect().bottom - top - 12;
      element.style.setProperty("--picker-available-height", `${Math.max(0, available)}px`);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    observer.observe(root.current?.closest(".composer-wrap") || element);
    if (container) observer.observe(container);
    window.addEventListener("resize", updateHeight);
    viewport?.addEventListener("resize", updateHeight);
    viewport?.addEventListener("scroll", updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
      viewport?.removeEventListener("resize", updateHeight);
      viewport?.removeEventListener("scroll", updateHeight);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const option =
      root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ||
      root.current?.querySelector<HTMLButtonElement>('[role="option"]');
    option?.focus({ preventScroll: true });
    scrollOptionIntoView(option);
  }, [open]);

  const closeMenu = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };

  return (
    <div
      className={`composer-picker ${kind}-control`}
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || unavailable) return;
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
        );
        const current = buttons.findIndex((button) => button === document.activeElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
        scrollOptionIntoView(buttons[next]);
      }}
    >
      <button
        ref={trigger}
        className={`composer-picker-trigger ${kind}-trigger`}
        type="button"
        disabled={unavailable}
        aria-label={`${label}: ${activeLabel}`}
        title={title || `${label}: ${activeLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon aria-hidden="true" />
        <span>{activeLabel}</span>
        <ChevronDown className="trigger-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className={`composer-picker-menu ${kind}-menu`} ref={menu}>
          <div className="composer-picker-title">
            <Icon aria-hidden="true" />
            {label}
          </div>
          {note && <small className="composer-picker-note">{note}</small>}
          <div id={menuId} role="listbox" aria-label={label}>
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                tabIndex={-1}
                onClick={() => {
                  onChange(option.value);
                  closeMenu();
                }}
              >
                <span>
                  <b>{option.label}</b>
                  {option.description && <small>{option.description}</small>}
                </span>
                {option.value === value && <Check aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
