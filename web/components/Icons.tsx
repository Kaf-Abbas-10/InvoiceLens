type P = { className?: string; size?: number };

function Svg({ className, size = 16, children }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  );
}

export const IconUpload = (p: P) => <Svg {...p}><path d="M12 15V4m-4.5 4.5L12 4l4.5 4.5M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></Svg>;
export const IconFile = (p: P) => <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const IconAlert = (p: P) => <Svg {...p}><path d="M12 8v5m0 3.5h.01M10.3 3.9 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></Svg>;
export const IconMinus = (p: P) => <Svg {...p}><path d="M6 12h12" /></Svg>;
export const IconDownload = (p: P) => <Svg {...p}><path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></Svg>;
export const IconLock = (p: P) => <Svg {...p}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IconMenu = (p: P) => <Svg {...p}><path d="M4 7h16M4 12h16M4 17h10" /></Svg>;
export const IconBook = (p: P) => <Svg {...p}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /></Svg>;
export const IconCode = (p: P) => <Svg {...p}><path d="m8 7-5 5 5 5m8-10 5 5-5 5" /></Svg>;
export const IconChevron = (p: P) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const IconArrowUpRight = (p: P) => <Svg {...p}><path d="M7 17 17 7M8 7h9v9" /></Svg>;
export const IconTrace = (p: P) => <Svg {...p}><path d="M4 7h10M4 12h6M4 17h12" /><rect x="13" y="9.5" width="7" height="5" rx="1.2" /></Svg>;

/** The mark: a page with one line picked out by the highlighter. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <rect width="40" height="40" rx="11" fill="#4f46e5" />
      <path d="M11 11.5h13M11 28.5h9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="9" y="17" width="20" height="6" rx="1.8" fill="#fff" />
      <path d="M11.5 20h9" stroke="#4f46e5" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
