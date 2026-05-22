/* global React */
// icons.jsx — small, line-style icon set for 小猫专注.
// All icons are 18×18 stroke-based at 1.6px, color = currentColor.

const Icon = ({ d, fill, size = 18, strokeWidth = 1.6, viewBox = "0 0 24 24", style }) => (
  <svg width={size} height={size} viewBox={viewBox}
    fill={fill ? "currentColor" : "none"}
    stroke={fill ? "none" : "currentColor"}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}>
    {d}
  </svg>
);

const IconHome = (p) => <Icon {...p} d={<><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></>} />;
const IconCal = (p) => <Icon {...p} d={<><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></>} />;
const IconUser = (p) => <Icon {...p} d={<><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.5 3.6-8 8-8s8 3.5 8 8"/></>} />;
const IconPlay = (p) => <Icon {...p} fill d={<path d="M7 4.5v15l13-7.5z"/>} />;
const IconPause = (p) => <Icon {...p} d={<><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></>} />;
const IconStop = (p) => <Icon {...p} fill d={<rect x="6" y="6" width="12" height="12" rx="2"/>} />;
const IconChevR = (p) => <Icon {...p} d={<path d="M9 6l6 6-6 6"/>} />;
const IconChevL = (p) => <Icon {...p} d={<path d="M15 6l-6 6 6 6"/>} />;
const IconChevD = (p) => <Icon {...p} d={<path d="M6 9l6 6 6-6"/>} />;
const IconPlus = (p) => <Icon {...p} d={<path d="M12 5v14M5 12h14"/>} />;
const IconMinus = (p) => <Icon {...p} d={<path d="M5 12h14"/>} />;
const IconClose = (p) => <Icon {...p} d={<path d="M6 6l12 12M18 6L6 18"/>} />;
const IconCamera = (p) => <Icon {...p} d={<><path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></>} />;
const IconCheck = (p) => <Icon {...p} d={<path d="M5 12.5l5 5 9-11"/>} />;
const IconFlame = (p) => <Icon {...p} d={<path d="M12 3c0 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>} />;
const IconTrophy = (p) => <Icon {...p} d={<><path d="M8 4h8v4a4 4 0 0 1-8 0z"/><path d="M16 4h3v2a3 3 0 0 1-3 3M8 4H5v2a3 3 0 0 0 3 3M10 13h4M9 20h6M10 13l-1 7M14 13l1 7"/></>} />;
const IconBell = (p) => <Icon {...p} d={<><path d="M6 10a6 6 0 1 1 12 0v4l2 3H4l2-3z"/><path d="M10 20a2 2 0 0 0 4 0"/></>} />;
const IconMoon = (p) => <Icon {...p} d={<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>} />;
const IconChart = (p) => <Icon {...p} d={<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>} />;
const IconBook = (p) => <Icon {...p} d={<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/>} />;
const IconPaw = (p) => <Icon {...p} d={<><ellipse cx="7" cy="8" rx="1.7" ry="2.4"/><ellipse cx="12" cy="6" rx="1.7" ry="2.4"/><ellipse cx="17" cy="8" rx="1.7" ry="2.4"/><ellipse cx="5" cy="13" rx="1.4" ry="2"/><path d="M12 11c-3 0-5 2.5-5 5a3 3 0 0 0 4 2.8c.6-.2 1.2-.2 1.8 0A3 3 0 0 0 17 16c0-2.5-2-5-5-5z"/></>} />;
const IconStar = (p) => <Icon {...p} fill d={<path d="M12 3l2.6 5.7 6.1.6-4.6 4.2 1.3 6.1L12 16.7 6.6 19.6l1.3-6.1L3.3 9.3l6.1-.6z"/>} />;
const IconLock = (p) => <Icon {...p} d={<><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></>} />;

Object.assign(window, {
  Icon,
  IconHome, IconCal, IconUser, IconPlay, IconPause, IconStop,
  IconChevR, IconChevL, IconChevD, IconPlus, IconMinus, IconClose,
  IconCamera, IconCheck, IconFlame, IconTrophy, IconBell, IconMoon,
  IconChart, IconBook, IconPaw, IconStar, IconLock,
});
