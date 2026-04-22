import React from 'react';

// Common Icon Props
const defaultProps = {
  xmlns: "http://www.w3.org/2000/svg",
  width: "20",
  height: "20",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  className: "lucide-icon"
};

export const DashboardIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <rect width="7" height="9" x="3" y="3" rx="1" />
    <rect width="7" height="5" x="14" y="3" rx="1" />
    <rect width="7" height="9" x="14" y="12" rx="1" />
    <rect width="7" height="5" x="3" y="16" rx="1" />
  </svg>
);

export const KeyIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="m21 2-2 2" /><path d="m21 7-3 3" /><path d="m15 13 5.7 5.7c.4.4.4 1.1 0 1.5l-.6.6c-.4.4-1.1.4-1.5 0L13 15.1" /><circle cx="7.5" cy="15.5" r="5.5" />
  </svg>
);

export const VaultIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M8 4v16" />
    <circle cx="15" cy="12" r="2.5" />
    <path d="M12.5 12h-2" />
    <path d="M15 9.5v-2" />
    <path d="M15 14.5V17" />
  </svg>
);

export const TicketIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0 -2-2H4a2 2 0 0 0 -2 2Z" /><path d="M13 5v2" /><path d="M13 17v2" /><path d="M13 11v2" />
  </svg>
);

export const WandIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="m2 22 1-1" /><path d="M14 12l2 2" /><path d="M12 14l2 2" /><path d="M10 16l2 2" /><path d="M8 18l2 2" /><path d="M15 3h4" /><path d="M15 7h4" /><path d="M13 5h4" /><path d="M9 3h1" /><path d="M5 3h1" /><path d="M2.5 6h1" /><path d="M2.5 10h1" /><path d="M5 19H4" /><path d="M9 19H7" />
  </svg>
);

export const GeneratorIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="M12 3v4" />
    <path d="M12 17v4" />
    <path d="M5.5 6.5 8 9" />
    <path d="M16 15l2.5 2.5" />
    <path d="M3 12h4" />
    <path d="M17 12h4" />
    <path d="M5.5 17.5 8 15" />
    <path d="M16 9l2.5-2.5" />
    <path d="m12 8 1.6 2.4L16 12l-2.4 1.6L12 16l-1.6-2.4L8 12l2.4-1.6Z" />
  </svg>
);

export const SettingsIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" />
  </svg>
);

export const LockIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

/** Stacked envelopes — bulk email OTP flow */
export const BulkAuthIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="M4 6h16v10H4z" />
    <path d="M4 8l8 5 8-5" />
    <path d="M6 4h12v2H6z" opacity="0.5" />
  </svg>
);

export const PowerIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
  </svg>
);

export const WalletIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 2 2h2v-4h-2a2 2 0 0 0-2 2Z" />
  </svg>
);

export const CreditsIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <rect width="20" height="14" x="2" y="5" rx="2" /><line x1="2" x2="22" y1="10" y2="10" />
  </svg>
);

export const DatabaseIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
  </svg>
);

export const ShieldIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  </svg>
);

export const EyeIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
  </svg>
);

export const TrashIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" />
  </svg>
);

export const InfoIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
  </svg>
);

export const HelpIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" />
  </svg>
);

export const PlusIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="M12 5V19" /><path d="M5 12h14" />
  </svg>
);

export const NetworkIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <rect x="16" y="16" width="6" height="6" rx="1" />
    <rect x="2" y="16" width="6" height="6" rx="1" />
    <rect x="9" y="2" width="6" height="6" rx="1" />
    <path d="M5 16v-4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v4" />
    <path d="M12 8v3" />
  </svg>
);

export const CopyIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

export const RefreshIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </svg>
);

export const AlertIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" /><path d="M12 17h.01" />
  </svg>
);

export const ActivityIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

export const HydraIcon = (props) => (
  <svg {...defaultProps} {...props} viewBox="0 0 24 24">
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
  </svg>
);

export const EditIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

export const EyeOffIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

export const UserIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const ChevronDownIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const SearchIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const SyncIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="M21 2v6h-6" />
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M3 22v-6h6" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
  </svg>
);

export const GlobeIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </svg>
);

export const ChevronRightIcon = (props) => (
  <svg {...defaultProps} {...props}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);
