"use client";

import { useEffect, useRef, useState } from "react";

interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface Props {
  items: MenuItem[];
  align?: "left" | "right";
  buttonLabel?: string;
  buttonClassName?: string;
  ariaLabel?: string;
}

/**
 * Menú overflow simple — un botón ⋮ que abre un popover con acciones
 * raras / secundarias. Usado en headers para mantener visibles solo
 * las acciones recurrentes mientras conserva accesibilidad a las que
 * importan poco frecuentemente.
 *
 * Cierra al click fuera o al ejecutar una acción. Sin animaciones,
 * sin keyboard nav avanzada — pragmático para v1.
 */
export function OverflowMenu({
  items,
  align = "right",
  buttonLabel = "⋮",
  buttonClassName,
  ariaLabel = "más opciones",
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOut);
    return () => document.removeEventListener("mousedown", onClickOut);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={
          buttonClassName ??
          "flex h-8 w-8 items-center justify-center rounded text-base text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
        }
      >
        {buttonLabel}
      </button>
      {open && (
        <div
          className={`absolute z-50 mt-1 min-w-[11rem] rounded border border-neutral-200 bg-white py-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              disabled={it.disabled}
              onClick={() => {
                it.onClick();
                setOpen(false);
              }}
              className={`block w-full px-3 py-2 text-left text-sm ${
                it.danger
                  ? "text-red-600 hover:bg-red-50"
                  : "text-neutral-700 hover:bg-neutral-100"
              } disabled:opacity-40`}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
