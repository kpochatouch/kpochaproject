// apps/web/src/components/KpochaIcons.jsx
import React from "react";

function base(props) {
  const { className = "w-6 h-6", ...rest } = props || {};
  return {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    ...rest,
  };
}

export function IconDiscover(props) {
  // compass
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9.5l-2 5-5 2 2-5 5-2z" />
    </svg>
  );
}

export function IconPros(props) {
  // user badge
  return (
    <svg {...base(props)}>
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="8" r="4" />
      <path d="M18 8h3" />
      <path d="M19.5 6.5v3" />
    </svg>
  );
}

export function IconForYou(props) {
  // sparkles
  return (
    <svg {...base(props)}>
      <path d="M12 3l1.2 3.6L17 8l-3.8 1.4L12 13l-1.2-3.6L7 8l3.8-1.4L12 3z" />
      <path d="M18 13l.8 2.4L21 16l-2.2.6L18 19l-.8-2.4L15 16l2.2-.6L18 13z" />
    </svg>
  );
}

export function IconInbox(props) {
  return (
    <svg {...base(props)}>
      <path d="M4 4h16v12H4z" />
      <path d="M4 16l4-4h8l4 4" />
    </svg>
  );
}

export function IconBookings(props) {
  // calendar
  return (
    <svg {...base(props)}>
      <path d="M7 3v3" />
      <path d="M17 3v3" />
      <path d="M4 8h16" />
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M8 12h4" />
    </svg>
  );
}

export function IconWallet(props) {
  return (
    <svg {...base(props)}>
      <path d="M3 7h18v12H3z" />
      <path d="M3 9V7a2 2 0 0 1 2-2h14" />
      <path d="M16 13h3" />
    </svg>
  );
}

export function IconProfile(props) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </svg>
  );
}

export function IconSettings(props) {
  return (
    <svg {...base(props)}>
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
      <path d="M19.4 15a7.7 7.7 0 0 0 .1-2l2-1.2-2-3.4-2.3.6a7.8 7.8 0 0 0-1.7-1l-.3-2.3H10l-.3 2.3a7.8 7.8 0 0 0-1.7 1l-2.3-.6-2 3.4 2 1.2a7.7 7.7 0 0 0 .1 2l-2 1.2 2 3.4 2.3-.6c.5.4 1.1.7 1.7 1l.3 2.3h4.9l.3-2.3c.6-.3 1.2-.6 1.7-1l2.3.6 2-3.4-2-1.2z" />
    </svg>
  );
}

export function IconProDashboard(props) {
  // gauge
  return (
    <svg {...base(props)}>
      <path d="M20 13a8 8 0 1 0-16 0" />
      <path d="M12 13l3-3" />
      <path d="M8 16h8" />
    </svg>
  );
}

export function IconAdmin(props) {
  // shield
  return (
    <svg {...base(props)}>
      <path d="M12 3l8 4v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4z" />
      <path d="M9 12h6" />
    </svg>
  );
}
