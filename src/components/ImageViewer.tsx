'use client';

import { useEffect } from 'react';
import { CloseIcon } from './Icons';

export function ImageViewer({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="ছবি" onClick={onClose}>
      <button className="icon-btn viewer-close" aria-label="বন্ধ করুন" onClick={onClose}>
        <CloseIcon />
      </button>
      <a className="viewer-open" href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        আসল ছবি খুলুন
      </a>
      <img src={url} alt="পাঠানো ছবি" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
