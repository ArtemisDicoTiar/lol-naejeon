import { useEffect, useRef } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="bg-lol-gray border border-lol-border rounded-lg p-0 backdrop:bg-black/60 text-lol-gold-light max-w-lg w-full"
    >
      <div className="px-4 py-3 border-b border-lol-border flex items-center justify-between">
        <h3 className="text-lol-gold font-medium">{title}</h3>
        <button
          onClick={onClose}
          className="text-lol-gold-light/60 hover:text-lol-gold-light text-xl cursor-pointer"
        >
          &times;
        </button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}
