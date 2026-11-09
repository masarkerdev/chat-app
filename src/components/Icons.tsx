type P = { size?: number; className?: string };

const base = (size = 22) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const SendIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 12 20 4l-4 16-4-7-8-1Z" fill="currentColor" stroke="none" />
  </svg>
);

export const ImageIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="m21 16-5-5-9 9" />
  </svg>
);

export const MoreIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="5" r="1.4" fill="currentColor" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    <circle cx="12" cy="19" r="1.4" fill="currentColor" />
  </svg>
);

export const ArrowDownIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const CloseIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const ClockIcon = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className} strokeWidth={2.2}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

/** একটি টিক = পাঠানো হয়েছে */
export const TickIcon = ({ size = 16, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
    <path d="m3 8.5 3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** দুটি টিক = দেখা হয়েছে */
export const DoubleTickIcon = ({ size = 18, className }: P) => (
  <svg width={size} height={size * (16 / 20)} viewBox="0 0 20 16" fill="none" className={className} aria-hidden>
    <path d="m1.5 8.5 3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m8.5 11.5 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m7 10 1.5 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const AlertIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5v.01" />
  </svg>
);

export const BellIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </svg>
);

export const BellOffIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M8.5 4.2A6 6 0 0 1 18 9c0 2.6.5 4.3 1.1 5.3M17 17.5H4S6 14 6 9c0-.6.1-1.2.3-1.8" />
    <path d="M10 19a2 2 0 0 0 4 0M3 3l18 18" />
  </svg>
);

export const KeyIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9M17 6l3 3M15 8l2 2" />
  </svg>
);

export const ReplyIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 7 4 12l5 5" />
    <path d="M4 12h10a6 6 0 0 1 6 6v1" />
  </svg>
);

export const PaletteIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3Z" />
    <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
    <circle cx="10" cy="7" r="1.2" fill="currentColor" />
    <circle cx="15" cy="7.5" r="1.2" fill="currentColor" />
  </svg>
);

export const LockIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    <circle cx="12" cy="15.5" r="1.3" fill="currentColor" />
  </svg>
);

export const DevicesIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="2.5" y="5" width="13" height="10" rx="1.5" />
    <path d="M1.5 18.5h10" />
    <rect x="15.5" y="8" width="6.5" height="12" rx="1.5" />
  </svg>
);

export const SearchIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </svg>
);

export const PinIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 3h6l-1 6 3.5 3.5V14h-11v-1.5L10 9 9 3Z" />
    <path d="M12 14v7" />
  </svg>
);

export const HeartIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z" />
  </svg>
);

export const TimerIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2M9.5 2.5h5" />
  </svg>
);

export const ChatClearIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z" />
    <path d="m9.5 9.5 5 5M14.5 9.5l-5 5" />
  </svg>
);

export const PenIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
  </svg>
);

export const LogoutIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 16l-4-4 4-4M6 12h10" />
  </svg>
);

export const TrashIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
);

export const CopyIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </svg>
);

export const RetryIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4" />
  </svg>
);

export const MailIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m4 7 8 6 8-6" />
  </svg>
);

export const EyeIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </svg>
);

export const EyeOffIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.3 7.3C3.9 8.9 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1" />
    <path d="M9.9 10a2.8 2.8 0 0 0 4 4" />
    <path d="m3 3 18 18" />
  </svg>
);

export const PaperclipIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m20.5 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.7-7.7" />
  </svg>
);

export const FileIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
  </svg>
);

export const MicIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </svg>
);

export const PlayIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.8l-10-6.5A1 1 0 0 0 8 5.5Z" fill="currentColor" stroke="none" />
  </svg>
);

export const PauseIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" />
    <rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const DownloadIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />
  </svg>
);
