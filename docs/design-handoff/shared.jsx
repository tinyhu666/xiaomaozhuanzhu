/* global React, IconHome, IconCal, IconUser, IconPlay, IconChevR, IconBook */

// Shared tab bar (3 tabs — focus mode hides it via parent)
function TabBar({ active = "home", dark = false, onChange }) {
  const items = [
    { id: "home", label: "首页", Icon: IconHome },
    { id: "calendar", label: "日历", Icon: IconCal },
    { id: "profile", label: "我的", Icon: IconUser },
  ];
  return (
    <nav className="tab-bar" role="tablist" aria-label="Bottom navigation">
      {items.map(({ id, label, Icon: I }) => (
        <button key={id} className={`tab-btn ${active === id ? "active" : ""}`}
          onClick={() => onChange && onChange(id)}>
          <I size={16} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

// Tiny iOS-ish status bar painted in foreground color
function StatusBar({ dark = false, time = "9:41" }) {
  const c = dark ? "#E8EFEC" : "#1F2624";
  return (
    <div style={{
      height: 44, padding: "0 20px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      color: c, fontFamily: "var(--ff-num)", fontWeight: 600, fontSize: 14,
    }}>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{time}</span>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        {/* signal */}
        <svg width="16" height="10" viewBox="0 0 16 10" fill={c}>
          <rect x="0" y="6" width="2.6" height="3.5" rx="0.5"/>
          <rect x="4" y="4" width="2.6" height="5.5" rx="0.5"/>
          <rect x="8" y="2" width="2.6" height="7.5" rx="0.5"/>
          <rect x="12" y="0" width="2.6" height="9.5" rx="0.5"/>
        </svg>
        {/* wifi */}
        <svg width="14" height="10" viewBox="0 0 14 10" fill={c}>
          <path d="M7 3.4C8.9 3.4 10.6 4.2 11.9 5.4l1-1C11.4 3 9.3 2 7 2C4.7 2 2.6 3 1.1 4.4l1 1C3.4 4.2 5.1 3.4 7 3.4z"/>
          <path d="M7 6c1 0 1.9.4 2.6 1.1l1-1C9.6 5.2 8.4 4.7 7 4.7c-1.4 0-2.6.5-3.6 1.4l1 1C5.1 6.4 6 6 7 6z"/>
          <circle cx="7" cy="8.7" r="1.2"/>
        </svg>
        {/* battery */}
        <svg width="24" height="11" viewBox="0 0 24 11">
          <rect x="0.5" y="0.5" width="20" height="10" rx="2.5" fill="none" stroke={c} strokeOpacity="0.45"/>
          <rect x="2" y="2" width="17" height="7" rx="1.4" fill={c}/>
          <path d="M22 4v3c.7-.3 1.1-1 1.1-1.5S22.7 4.3 22 4z" fill={c} fillOpacity="0.45"/>
        </svg>
      </div>
    </div>
  );
}

// Subject mini-bar row
function SubjectBar({ name, pct, hours, dark }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
        <span className="num" style={{ fontSize: 11, color: dark ? "var(--c-text-2-dark)" : "var(--c-text-2)", fontWeight: 600 }}>
          {hours}h
        </span>
      </div>
      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

// Placeholder image tile (striped, monospace label)
function ImagePlaceholder({ w = "100%", h = 80, label = "image", dark, style }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 12,
      background: dark
        ? "repeating-linear-gradient(135deg, #2A2F2D 0px, #2A2F2D 8px, #232826 8px, #232826 16px)"
        : "repeating-linear-gradient(135deg, #ECF5F0 0px, #ECF5F0 8px, #E3EBE7 8px, #E3EBE7 16px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
      fontSize: 10, letterSpacing: 0.04, color: dark ? "#8FA59C" : "#5E7D75",
      ...style,
    }}>
      {label}
    </div>
  );
}

// Cat-breed illustration — REAL photos from Oxford-IIIT Pet Dataset,
// stored at assets/breeds/{breed}.jpg. Object-fit covers the tile;
// inline SVG renders instantly as a placeholder behind, so there's
// never a blank flash.
function CatPhoto({ breed, locked = false, size = 64 }) {
  const src = `assets/breeds/${encodeURIComponent(breed)}.jpg`;
  return (
    <div style={{
      width: size, height: size, borderRadius: 12,
      overflow: "hidden", position: "relative",
      background: "var(--c-soft-mint)",
      flex: "0 0 auto",
      filter: locked ? "grayscale(0.95)" : "none",
      opacity: locked ? 0.55 : 1,
      transition: "filter var(--d-2) var(--ease-std), opacity var(--d-2) var(--ease-std)",
    }}>
      {/* SVG placeholder (renders instantly, hidden behind photo) */}
      <div style={{ position: "absolute", inset: 0 }}>
        <CatBreedSVG breed={breed}/>
      </div>
      {/* Real photo */}
      <img src={src} alt={breed} loading="lazy"
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: "cover",
          // gentle treatment for visual cohesion in the tile grid
          filter: "saturate(1.04) contrast(1.02)",
        }}
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
    </div>
  );
}

// Cat-breed placeholder for achievements: paw icon centered + breed name
function BreedTile({ name, locked = false, rarity = "common", size = 64 }) {
  // Kept around for back-compat / fallback if photos disabled.
  return <CatPhoto breed={name} locked={locked} size={size}/>;
}

Object.assign(window, { TabBar, StatusBar, SubjectBar, ImagePlaceholder, BreedTile, CatPhoto });
