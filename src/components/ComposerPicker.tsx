import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";

type PickerOption = { value: string; label: string; description?: string };

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
    const option =
      root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ||
      root.current?.querySelector<HTMLButtonElement>('[role="option"]');
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: "nearest" });
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
        buttons[next]?.scrollIntoView({ block: "nearest" });
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
        <div className={`composer-picker-menu ${kind}-menu`}>
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
