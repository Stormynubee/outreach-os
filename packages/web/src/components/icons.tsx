/**
 * Hand-drawn icon set (no icon library). Every icon is decorative:
 * the accessible name always comes from the surrounding button/link.
 */
import type { ReactElement, ReactNode } from 'react';

export interface IconProps {
  className?: string;
  strokeWidth?: number;
}

function Svg({
  className,
  strokeWidth = 1.8,
  children,
}: IconProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ?? 'h-5 w-5'}
    >
      {children}
    </svg>
  );
}

export const IconHome = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M4 10.6 12 4l8 6.6V19a1.6 1.6 0 0 1-1.6 1.6h-3.7v-5.4H9.3v5.4H5.6A1.6 1.6 0 0 1 4 19z" />
  </Svg>
);

export const IconCompass = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.7 8.3-2.3 5.1-5.1 2.3 2.3-5.1z" />
  </Svg>
);

export const IconLeads = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <circle cx="9.5" cy="8.5" r="3.5" />
    <path d="M3.5 20v-1.3A4.2 4.2 0 0 1 7.7 14.5h3.6a4.2 4.2 0 0 1 4.2 4.2V20" />
    <path d="M16.5 5.2a3.2 3.2 0 0 1 0 6.4M18 14.8a4 4 0 0 1 2.5 3.7V20" />
  </Svg>
);

export const IconSend = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M21 3 10.4 13.6" />
    <path d="M21 3l-6.6 18-3.9-7.5L3 9.6z" />
  </Svg>
);

export const IconSliders = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M4 8h5M15 8h5M4 16h7M17 16h3" />
    <circle cx="12" cy="8" r="2.6" />
    <circle cx="14" cy="16" r="2.6" />
  </Svg>
);

export const IconBolt = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M13.4 2.5 5.8 13.2h4.7l-1 8.3 7.7-11.2h-4.6z" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconPlus = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconCheck = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M20 6.5 9.2 17.3 4 12.1" />
  </Svg>
);

export const IconSearch = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <circle cx="11" cy="11" r="6.8" />
    <path d="m20 20-3.7-3.7" />
  </Svg>
);

export const IconDownload = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M12 3.5v11m0 0 4-4m-4 4-4-4M4.5 19.5h15" />
  </Svg>
);

export const IconBell = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M6.3 9.6a5.7 5.7 0 0 1 11.4 0c0 4.2 1.6 5.6 1.6 5.6H4.7s1.6-1.4 1.6-5.6z" />
    <path d="M10 18.6a2 2 0 0 0 4 0" />
  </Svg>
);

export const IconCalendar = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <rect x="3.6" y="5.2" width="16.8" height="15" rx="3" />
    <path d="M8 3.2v4M16 3.2v4M3.6 10.4h16.8" />
  </Svg>
);

export const IconChevronDown = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="m6 9.5 6 6 6-6" />
  </Svg>
);

export const IconChevronRight = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="m9 5.5 6.5 6.5L9 18.5" />
  </Svg>
);

export const IconArrowLeft = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M15 4.5 7.5 12 15 19.5" />
  </Svg>
);

export const IconExternal = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M14 4h6v6M20 4l-8.6 8.6" />
    <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19V7.5A1.5 1.5 0 0 1 5.5 6H10" />
  </Svg>
);

export const IconPhone = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M5 3.5h3l1.8 4.4-2.2 1.4a12.4 12.4 0 0 0 6.1 6.1l1.4-2.2 4.4 1.8v3a2 2 0 0 1-2.2 2A16.7 16.7 0 0 1 3 5.7a2 2 0 0 1 2-2.2z" />
  </Svg>
);

export const IconMail = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <rect x="3" y="5.5" width="18" height="13" rx="2.4" />
    <path d="m3.8 7.4 8.2 5.6 8.2-5.6" />
  </Svg>
);

export const IconGlobe = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3.2 12h17.6" />
    <path d="M12 3c2.4 2.6 2.4 15.4 0 18M12 3c-2.4 2.6-2.4 15.4 0 18" />
  </Svg>
);

export const IconRefresh = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M20 5.5v5h-5" />
    <path d="M19.4 10.5A7.7 7.7 0 1 0 12 19.7c3.1 0 5.8-1.8 7-4.5" />
  </Svg>
);

export const IconAlert = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M12 4.2 3.2 19.4h17.6z" />
    <path d="M12 10v4.2" />
    <path d="M12 17.2h.01" strokeWidth={2.4} />
  </Svg>
);

export const IconInfo = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.4" />
    <path d="M12 7.9h.01" strokeWidth={2.4} />
  </Svg>
);

export const IconLock = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.6" />
    <path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" />
  </Svg>
);

export const IconClock = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.4V12l3 1.8" />
  </Svg>
);

export const IconCopy = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <rect x="8.8" y="8.8" width="11.4" height="11.4" rx="2.6" />
    <path d="M15.2 5.4H6.6A2.6 2.6 0 0 0 4 8v8.6" />
  </Svg>
);

export const IconClose = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const IconFlame = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M12 3.2s4.6 4.6 4.6 8.4a4.6 4.6 0 0 1-9.2 0c0-1 .4-2.1.4-2.1s1.2 1.3 1.2-.5S12 3.2 12 3.2z" />
    <path d="M9.6 16.6a2.6 2.6 0 0 0 4.9 0" />
  </Svg>
);

export const IconMapPin = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M12 21s6.4-5.6 6.4-10.4a6.4 6.4 0 1 0-12.8 0C5.6 15.4 12 21 12 21z" />
    <circle cx="12" cy="10.4" r="2.4" />
  </Svg>
);

export const IconTag = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M11.6 3.5H20v8.4l-8.6 8.6-8.4-8.4z" />
    <path d="M16.2 7.8h.01" strokeWidth={2.4} />
  </Svg>
);

export const IconList = (props: IconProps): ReactElement => (
  <Svg {...props}>
    <path d="M8 6.5h12M8 12h12M8 17.5h12" />
    <path d="M4 6.5h.01M4 12h.01M4 17.5h.01" strokeWidth={2.4} />
  </Svg>
);
