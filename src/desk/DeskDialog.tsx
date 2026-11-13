import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export function DeskDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="desk-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="desk-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="desk-icon-button" aria-label="Close dialog" onClick={onClose}><X size={16} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}
