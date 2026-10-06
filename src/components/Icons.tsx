type P = { size?: number };

const base = (size = 24) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const IconX = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconBookmark = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M6 4h12v16l-6-4-6 4z" />
  </svg>
);
export const IconPause = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M9 6v12M15 6v12" />
  </svg>
);
export const IconUp = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M6 14l6-6 6 6" />
  </svg>
);
export const IconBack = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
export const IconHelp = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.3a2.5 2.5 0 014.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17h.01" />
  </svg>
);
export const IconUndo = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 010 12h-3" />
  </svg>
);
