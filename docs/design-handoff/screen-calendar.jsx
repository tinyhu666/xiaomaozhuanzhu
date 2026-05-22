/* global React, StatusBar, TabBar, IconChevL, IconChevR, IconCamera */

// Deterministic-looking heatmap data for May 2026 (level 0-5)
const MAY_DATA = (() => {
  // 31 days; pre-seeded counts so they look real
  const raw = [
    0,2,3,1,4,4,3, // wk1 (Fri May 1 → Thu May 7)
    2,5,4,3,0,2,3,
    4,3,2,5,3,4,4,
    1,0,2,3,3,4,5,
    3,4,2,
  ];
  return raw;
})();

function HeatCell({ level, day, selected, onClick, isToday, dark }) {
  const colors = dark
    ? ["var(--hm-d-0)", "var(--hm-d-1)", "var(--hm-d-2)", "var(--hm-d-3)", "var(--hm-d-4)", "var(--hm-d-5)"]
    : ["var(--hm-0)",   "var(--hm-1)",   "var(--hm-2)",   "var(--hm-3)",   "var(--hm-4)",   "var(--hm-5)"];
  const bg = day == null ? "transparent" : colors[level];
  const isDarkCell = level >= 3;
  const cellText = dark
    ? (isDarkCell ? "rgba(255,255,255,0.95)" : "var(--c-text-2-dark)")
    : (isDarkCell ? "rgba(255,255,255,0.9)"  : "var(--c-text-1)");
  return (
    <button onClick={onClick} disabled={day == null}
      style={{
        position: "relative",
        height: 40, borderRadius: 8,
        background: bg,
        border: selected
          ? `1.5px solid ${dark ? "var(--c-accent)" : "var(--c-primary)"}`
          : "1.5px solid transparent",
        color: cellText,
        fontSize: 11, fontWeight: day != null && (selected || isToday) ? 700 : 500,
        fontFamily: "var(--ff-num)", fontVariantNumeric: "tabular-nums",
        display: "flex", alignItems: "flex-start", justifyContent: "flex-end",
        padding: "4px 6px",
        cursor: day == null ? "default" : "pointer",
        transition: "transform 100ms var(--ease-std), border-color 220ms var(--ease-std)",
      }}
      onMouseDown={(e) => { if (day != null) e.currentTarget.style.transform = "scale(0.96)"; }}
      onMouseUp={(e) => e.currentTarget.style.transform = ""}
      onMouseLeave={(e) => e.currentTarget.style.transform = ""}
    >
      {day}
      {isToday && day != null && (
        <span style={{
          position: "absolute", bottom: 5, left: "50%", transform: "translateX(-50%)",
          width: 4, height: 4, borderRadius: 2,
          background: isDarkCell ? "#fff" : (dark ? "var(--c-accent)" : "var(--c-primary)"),
        }}/>
      )}
    </button>
  );
}

function Calendar({ dark = false }) {
  const [selected, setSelected] = React.useState(22); // Thu May 22 = "today"
  // May 1 2026 = Friday → idx 5
  const firstDayIdx = 5;
  const daysInMonth = 31;
  // 7×6 grid = 42; pad with nulls
  const cells = [];
  for (let i = 0; i < firstDayIdx; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, level: MAY_DATA[d - 1] });
  }
  while (cells.length < 42) cells.push({ day: null });

  const selectedData = cells.find(c => c.day === selected);
  const totalMin = selectedData ? selectedData.level * 38 + 22 : 0;
  const sessions = selectedData && selectedData.level > 0 ? [
    { time: "07:42", dur: "00:48:12", subject: "会计", note: "做完第六章习题，金融资产复杂" },
    { time: "12:18", dur: "00:32:05", subject: "审计", note: "" },
    { time: "20:55", dur: "01:14:30", subject: "财管", note: "净现值计算公式背了三遍" },
  ].slice(0, Math.min(3, selectedData.level)) : [];

  return (
    <div className={`app${dark ? " dark" : ""}`} data-screen-label={dark ? "03b Calendar dark" : "03 Calendar"}>
      <StatusBar dark={dark}/>
      <main style={{ paddingBottom: 96, height: "calc(100% - 44px)", overflowY: "auto" }}>
        {/* Month nav */}
        <header className="page-pad" style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "10px 16px 18px",
        }}>
          <button style={navBtn(dark)} aria-label="Previous month"><IconChevL size={16}/></button>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.3 }}>2026 年 5 月</div>
            <div className="caption">本月已打卡 23 天</div>
          </div>
          <button style={navBtn(dark)} aria-label="Next month"><IconChevR size={16}/></button>
        </header>

        {/* Weekday header */}
        <div className="page-pad" style={{
          display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4,
          marginBottom: 6,
        }}>
          {["一","二","三","四","五","六","日"].map((d, i) => (
            <div key={i} className="caption" style={{ textAlign: "center", fontWeight: 600 }}>{d}</div>
          ))}
        </div>

        {/* 7×6 heatmap grid */}
        <div className="page-pad" style={{
          display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4,
          marginBottom: 18,
        }}>
          {cells.map((c, i) => (
            <HeatCell key={i} {...c} dark={dark}
              selected={c.day === selected}
              isToday={c.day === 22}
              onClick={() => c.day != null && setSelected(c.day)}
            />
          ))}
        </div>

        {/* Legend */}
        <div className="page-pad" style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          marginBottom: 24, color: dark ? "var(--c-text-2-dark)" : "var(--c-text-2)", fontSize: 11,
        }}>
          <span>少</span>
          {[0,1,2,3,4,5].map(l => (
            <span key={l} style={{
              width: 14, height: 14, borderRadius: 4,
              background: dark
                ? ["var(--hm-d-0)","var(--hm-d-1)","var(--hm-d-2)","var(--hm-d-3)","var(--hm-d-4)","var(--hm-d-5)"][l]
                : ["var(--hm-0)","var(--hm-1)","var(--hm-2)","var(--hm-3)","var(--hm-4)","var(--hm-5)"][l],
            }}/>
          ))}
          <span>多</span>
        </div>

        {/* Day detail */}
        <section className="page-pad" style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              5 月 {selected} 日
              {selected === 22 && <span className="caption" style={{ marginLeft: 6 }}>今天</span>}
            </span>
            <span className="num caption" style={{ fontWeight: 600, color: "var(--c-primary)" }}>
              {Math.floor(totalMin / 60)}h {totalMin % 60}m
            </span>
          </div>

          {sessions.length === 0 ? (
            <div className="card" style={{ padding: "32px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "var(--c-text-2)", marginBottom: 4 }}>这天没有打卡记录</div>
              <div className="caption">休息也是备考的一部分。</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {sessions.map((s, i) => (
                <article key={i} className="card" style={{ padding: 14, display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{
                    width: 44, height: 44, flex: "0 0 44px",
                    background: dark ? "var(--c-soft-mint-deep)" : "var(--c-soft-mint)",
                    borderRadius: 10,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: dark ? "var(--c-accent)" : "var(--c-primary)",
                  }}>
                    <IconCamera size={18}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{s.subject}</span>
                      <span className="num caption" style={{ fontWeight: 600 }}>{s.dur}</span>
                    </div>
                    <div className="caption" style={{ marginBottom: s.note ? 6 : 0 }}>开始于 {s.time}</div>
                    {s.note && (
                      <div style={{
                        fontSize: 12,
                        color: dark ? "var(--c-text-1-dark)" : "var(--c-text-1)",
                        background: dark ? "rgba(232,239,236,0.06)" : "var(--c-bg-light)",
                        borderRadius: 8, padding: "6px 10px", lineHeight: 1.5,
                      }}>{s.note}</div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
      <TabBar active="calendar"/>
    </div>
  );
}

const navBtn = (dark) => ({
  width: 36, height: 36, borderRadius: 18,
  border: 0,
  background: dark ? "var(--c-soft-mint-deep)" : "var(--c-soft-mint)",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  color: dark ? "var(--c-accent)" : "var(--c-primary)", cursor: "pointer",
});

Object.assign(window, { Calendar });
