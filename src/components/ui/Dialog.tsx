"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function Dialog({ open, title, onClose, children, className = "" }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return <dialog ref={dialog} className={`dialog ${className}`} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <div className="dialog-heading"><div><span className="eyebrow">ATLAS SIGNAL</span><h2>{title}</h2></div><button className="icon-button" aria-label={`Close ${title}`} onClick={onClose}><X size={19} /></button></div>
    {children}
  </dialog>;
}
