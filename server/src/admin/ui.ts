/**
 * Admin SPA — single self-contained HTML document. No external assets,
 * no build step. Vanilla JS uses fetch + DOM manipulation. The token
 * is held in localStorage so a refresh stays authenticated.
 *
 * Views:
 *   1. /admin/        — login + users list
 *   2. (in-page)      — user detail (calendar + sessions + photos)
 *
 * Routing is hash-based (#/users/:id) so a deep-link can be shared.
 */
export const adminIndexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CPA 学习数据 · 管理后台</title>
<style>
  :root {
    --bg: #f6fff9;
    --card: rgba(255,255,255,0.95);
    --line: rgba(46,169,133,0.18);
    --text: #21473f;
    --text-sub: #5e7d75;
    --mint-100: #b3e3c7;
    --mint-300: #2ea985;
    --mint-500: #1a7558;
    --mint-700: #0a4631;
    --danger: #b8423a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background:
      radial-gradient(circle at top right, rgba(188,234,217,0.4), transparent 30%),
      linear-gradient(180deg, #f8fffb 0%, #effcf6 100%);
    color: var(--text);
    min-height: 100vh;
  }
  .container { max-width: 1200px; margin: 0 auto; padding: 32px 24px 80px; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  h2 { font-size: 20px; margin: 32px 0 12px; color: var(--text); }
  .sub { color: var(--text-sub); font-size: 14px; }
  .card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: 0 8px 24px rgba(46,169,133,0.06);
    padding: 20px;
    margin-bottom: 16px;
  }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .stat {
    background: rgba(46,169,133,0.06);
    border-radius: 10px;
    padding: 14px 16px;
  }
  .stat__label { font-size: 12px; color: var(--text-sub); text-transform: uppercase; letter-spacing: 0.5px; }
  .stat__value { font-size: 28px; font-weight: 700; color: var(--mint-500); margin-top: 4px; }

  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); }
  th { font-weight: 600; color: var(--text-sub); cursor: pointer; user-select: none; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  th:hover { color: var(--mint-500); }
  td.mono { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 12px; color: var(--text-sub); }
  tr.row-link { cursor: pointer; }
  tr.row-link:hover td { background: rgba(46,169,133,0.06); }

  input, button {
    font: inherit;
  }
  input[type="password"], input[type="text"] {
    width: 100%;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: #fff;
    font-size: 16px;
    color: var(--text);
  }
  button.primary {
    padding: 12px 24px;
    background: var(--mint-500);
    color: #fff;
    border: none;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  button.primary:hover { background: var(--mint-700); }
  button.ghost {
    padding: 8px 14px;
    background: transparent;
    color: var(--mint-500);
    border: 1px solid var(--mint-300);
    border-radius: 8px;
    font-size: 13px;
    cursor: pointer;
  }
  button.ghost:hover { background: rgba(46,169,133,0.08); }

  .login {
    max-width: 420px;
    margin: 80px auto 0;
  }
  .field { margin-bottom: 16px; }
  .field label { display: block; font-size: 13px; color: var(--text-sub); margin-bottom: 6px; }

  .toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .toolbar input { flex: 1; }

  .alert { padding: 10px 14px; border-radius: 8px; font-size: 14px; margin-bottom: 12px; }
  .alert--err { background: rgba(184,66,58,0.08); color: var(--danger); border: 1px solid rgba(184,66,58,0.18); }
  .alert--info { background: rgba(46,169,133,0.08); color: var(--mint-500); border: 1px solid var(--line); }

  /* Compact heat-map: fixed-cell grid sized so a full month is ~210px
     wide instead of stretching the card. Click target is still 28px
     which is fine for a desktop admin tool. */
  .heat-month { margin-bottom: 14px; }
  .heat-month:last-child { margin-bottom: 0; }
  .heat-grid {
    display: grid;
    grid-template-columns: repeat(7, 28px);
    gap: 4px;
    margin: 6px 0 0;
    justify-content: start;
  }
  .heat-cell {
    width: 28px;
    height: 28px;
    border-radius: 5px;
    background: #f0f6f3;
    border: 1px solid #d8e8e0;
    font-size: 10px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-sub);
  }
  .heat-cell.l1 { background: #b3e3c7; }
  .heat-cell.l2 { background: #6fc99a; }
  .heat-cell.l3 { background: #2ea985; color: #fff; }
  .heat-cell.l4 { background: #1a7558; color: #fff; }
  .heat-cell.l5 { background: #0a4631; color: #fff; }
  .heat-cell.faded { opacity: 0.3; border-color: transparent; background: transparent; }

  .session {
    border-top: 1px solid var(--line);
    padding: 14px 0;
  }
  .session:first-child { border-top: none; padding-top: 4px; }
  .session__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .session__when { font-size: 14px; font-weight: 600; }
  .session__dur { color: var(--mint-500); font-weight: 700; }
  .session__sub { font-size: 12px; color: var(--text-sub); margin-top: 2px; }
  .session__summary { font-size: 14px; margin: 8px 0 0; line-height: 1.6; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .tag { padding: 3px 10px; border-radius: 999px; background: rgba(46,169,133,0.1); color: var(--mint-500); font-size: 12px; }
  .photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .photos img {
    width: 96px; height: 96px; object-fit: cover; border-radius: 8px;
    border: 1px solid var(--line); cursor: zoom-in;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  .photos img:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0,0,0,0.12); }

  /* Lightbox: full-screen image viewer for session photos */
  .lightbox-overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0, 0, 0, 0.88);
    display: flex; align-items: center; justify-content: center;
    animation: lb-fade 0.18s ease;
  }
  @keyframes lb-fade { from { opacity: 0; } to { opacity: 1; } }
  .lightbox-img {
    max-width: 92vw; max-height: 88vh;
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    user-select: none;
    -webkit-user-drag: none;
  }
  .lightbox-btn {
    position: absolute;
    background: rgba(255,255,255,0.16);
    color: #fff;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    font-size: 28px;
    line-height: 1;
    width: 48px; height: 48px;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s ease;
  }
  .lightbox-btn:hover { background: rgba(255,255,255,0.28); }
  .lightbox-btn[hidden] { display: none; }
  .lightbox-close { top: 24px; right: 24px; }
  .lightbox-prev { left: 24px; top: 50%; transform: translateY(-50%); }
  .lightbox-next { right: 24px; top: 50%; transform: translateY(-50%); }
  .lightbox-counter {
    position: absolute;
    bottom: 28px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.55);
    color: #fff;
    padding: 6px 14px;
    border-radius: 999px;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .lightbox-meta {
    position: absolute;
    top: 28px; left: 50%; transform: translateX(-50%);
    color: rgba(255,255,255,0.78);
    font-size: 13px;
    background: rgba(0,0,0,0.4);
    padding: 6px 14px;
    border-radius: 999px;
    max-width: 70vw;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    pointer-events: none;
  }
  .photo-fallback {
    width: 96px; height: 96px; border-radius: 8px;
    background: rgba(46,169,133,0.06); border: 1px dashed var(--line);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; color: var(--text-sub); text-align: center; padding: 6px;
    word-break: break-all;
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    margin-right: 4px;
  }
  .badge--wechat { background: rgba(46,169,133,0.12); color: var(--mint-500); }
  .badge--anon { background: rgba(118,134,128,0.12); color: var(--text-sub); }
  .badge--running { background: #fff3cd; color: #8a6d3b; }
  .badge--paused { background: #fde2e2; color: #8a3b3b; }
  .badge--completed { background: rgba(46,169,133,0.12); color: var(--mint-500); }
  .badge--abandoned { background: #eee; color: #888; }
  .badge--makeup { background: #f0e8f7; color: #6a4ba0; }

  .remark-editor {
    margin-top: 18px;
    padding: 14px 16px;
    border-radius: 12px;
    background: rgba(46, 169, 133, 0.06);
    border: 1px solid var(--line);
  }
  .remark-editor__label {
    display: block;
    font-size: 12px;
    color: var(--text-sub);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .remark-editor__row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .remark-editor__row input {
    flex: 1;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: #fff;
    font-size: 14px;
    color: var(--text);
  }
  .remark-editor__row input:focus {
    outline: none;
    border-color: var(--mint-500);
    box-shadow: 0 0 0 3px rgba(46, 169, 133, 0.12);
  }
  .remark-editor__row button {
    padding: 8px 18px;
    background: var(--mint-500);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .remark-editor__row button:hover { background: var(--mint-700); }
  .remark-editor__row button:disabled { opacity: 0.6; cursor: not-allowed; }
  .remark-editor__status {
    min-height: 14px;
    margin-top: 6px;
    font-size: 12px;
  }
</style>
</head>
<body>
<div class="container" id="app"></div>
<script>
(function() {
  const TOKEN_KEY = "cpa.adminToken";

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  async function api(path) {
    const token = getToken();
    if (!token) throw new Error("NO_TOKEN");
    const res = await fetch("/admin/api" + path, {
      headers: { Authorization: "Bearer " + token }
    });
    if (res.status === 401) { clearToken(); throw new Error("UNAUTHORIZED"); }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message || "HTTP " + res.status);
    }
    return res.json();
  }

  // CSV downloads need to carry the admin token, so we fetch as a Blob
  // and trigger a synthetic anchor click rather than relying on a
  // plain <a download href> (which can't set headers).
  async function downloadCsv(path, suggestedName) {
    const token = getToken();
    if (!token) { renderLogin("请先登录"); return; }
    try {
      const res = await fetch("/admin/api" + path, {
        headers: { Authorization: "Bearer " + token }
      });
      if (res.status === 401) { clearToken(); renderLogin("Token 已失效，请重新登录"); return; }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      alert("下载失败：" + err.message);
    }
  }

  function formatMinutes(min) {
    if (!min || min <= 0) return "0m";
    if (min < 60) return min + "m";
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? h + "h" : h + "h " + m + "m";
  }
  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  }
  function formatDay(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
  }
  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function shortId(id) { return id ? id.slice(0, 8) : "—"; }

  // ---- Tiny inline-SVG charts (no external library) ----------------
  // We compose them as one SVG string per chart, with small helpers for
  // axis ticks, polyline path, etc. Keeps the admin SPA dependency-free.

  function pad2(n) { return String(n).padStart(2, "0"); }
  function dateKey(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

  /** Daily-minutes trend: filled area + line + dots, last N days. */
  function buildDailyTrendSvg(dailyStats, days) {
    var today = new Date();
    var byDate = {};
    (dailyStats || []).forEach(function (s) { byDate[s.date] = s.totalMinutes; });

    var data = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      data.push({
        key: dateKey(d),
        date: d,
        minutes: byDate[dateKey(d)] || 0,
        isToday: i === 0
      });
    }

    var max = data.reduce(function (m, p) { return Math.max(m, p.minutes); }, 60);
    // Round max up to nice y-axis mark (60/120/180/...)
    var step = max <= 60 ? 30 : max <= 180 ? 60 : max <= 360 ? 90 : 120;
    var yMax = Math.ceil(max / step) * step;

    var w = 600, h = 220;
    var padL = 44, padR = 16, padT = 16, padB = 32;
    var iw = w - padL - padR;
    var ih = h - padT - padB;

    var xFor = function (i) { return padL + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw); };
    var yFor = function (m) { return padT + ih - (m / yMax) * ih; };

    // Y-axis grid lines + labels
    var grid = "";
    for (var t = 0; t <= yMax; t += step) {
      var gy = yFor(t);
      grid += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (w - padR) + '" y2="' + gy + '" stroke="rgba(46,169,133,0.08)" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (gy + 4) + '" font-size="10" fill="#7a8e88" text-anchor="end">' + t + 'm</text>';
    }

    // Line + area paths
    var pts = data.map(function (p, i) { return xFor(i) + "," + yFor(p.minutes); });
    var linePath = "M " + pts.join(" L ");
    var areaPath = "M " + xFor(0) + "," + yFor(0) + " L " + pts.join(" L ") + " L " + xFor(data.length - 1) + "," + yFor(0) + " Z";

    // X-axis date ticks (every ~5 days)
    var xTicks = "";
    var tickEvery = days <= 14 ? 2 : days <= 30 ? 5 : 10;
    data.forEach(function (p, i) {
      if (i === data.length - 1 || i % tickEvery === 0) {
        var label = (p.date.getMonth() + 1) + "/" + p.date.getDate();
        xTicks += '<text x="' + xFor(i) + '" y="' + (h - 10) + '" font-size="10" fill="#7a8e88" text-anchor="middle">' + label + '</text>';
      }
    });

    // Dots
    var dots = data.map(function (p, i) {
      if (p.minutes <= 0) return "";
      var cx = xFor(i), cy = yFor(p.minutes);
      if (p.isToday) {
        return '<circle cx="' + cx + '" cy="' + cy + '" r="6" fill="rgba(46,169,133,0.18)" />' +
               '<circle cx="' + cx + '" cy="' + cy + '" r="3.5" fill="#155946" stroke="#fff" stroke-width="1.5" />';
      }
      return '<circle cx="' + cx + '" cy="' + cy + '" r="2.4" fill="#2ea985" />';
    }).join("");

    return '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;">' +
      '<defs>' +
        '<linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#2ea985" stop-opacity="0.28" />' +
          '<stop offset="100%" stop-color="#2ea985" stop-opacity="0" />' +
        '</linearGradient>' +
      '</defs>' +
      grid +
      '<path d="' + areaPath + '" fill="url(#trendGrad)" />' +
      '<path d="' + linePath + '" fill="none" stroke="#2ea985" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />' +
      dots +
      xTicks +
      '</svg>';
  }

  /** Weekday-pattern bars: average minutes per Monday..Sunday. */
  function buildWeekdayPatternSvg(dailyStats) {
    // Aggregate: total minutes per weekday + count of distinct dates
    // (so the bar represents an average rather than absolute total —
    // counting all distinct dates we have stats for, including 0-min
    // days, would be misleading; we average over recorded days).
    //
    // IMPORTANT: weekday must be computed timezone-independently. The
    // previous version used "new Date(date+T08:00:00+08:00).getDay()"
    // which returns weekday in the *browser* local zone — admins on
    // e.g. UTC-5 saw all dates shifted one weekday back, which is
    // why Tuesday and Saturday looked empty even when sessions on
    // those days existed. Parse the YYYY-MM-DD parts directly and
    // use Date.UTC + getUTCDay() so the result is identical no
    // matter where the admin opens the dashboard from.
    var totals = [0,0,0,0,0,0,0];
    var counts = [0,0,0,0,0,0,0];
    (dailyStats || []).forEach(function (s) {
      if (!s.date) return;
      var parts = String(s.date).slice(0, 10).split("-");
      if (parts.length !== 3) return;
      var y = +parts[0], m = +parts[1], d = +parts[2];
      if (!y || !m || !d) return;
      var utcDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
      var idx = (utcDay + 6) % 7;                                // 0=Mon..6=Sun
      totals[idx] += s.totalMinutes || 0;
      counts[idx] += 1;
    });
    var avgs = totals.map(function (t, i) { return counts[i] ? Math.round(t / counts[i]) : 0; });
    var labels = ["一","二","三","四","五","六","日"];

    var max = avgs.reduce(function (m, v) { return Math.max(m, v); }, 60);
    var step = max <= 60 ? 30 : max <= 120 ? 60 : 90;
    var yMax = Math.ceil(max / step) * step;

    var w = 480, h = 200;
    var padL = 44, padR = 16, padT = 18, padB = 32;
    var iw = w - padL - padR;
    var ih = h - padT - padB;
    var slotW = iw / 7;
    var barW = Math.min(slotW * 0.6, 38);

    var grid = "";
    for (var t = 0; t <= yMax; t += step) {
      var gy = padT + ih - (t / yMax) * ih;
      grid += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (w - padR) + '" y2="' + gy + '" stroke="rgba(46,169,133,0.08)" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (gy + 4) + '" font-size="10" fill="#7a8e88" text-anchor="end">' + t + 'm</text>';
    }

    var bars = avgs.map(function (val, i) {
      var cx = padL + slotW * (i + 0.5);
      var bx = cx - barW / 2;
      var bh = (val / yMax) * ih;
      var by = padT + ih - bh;
      var labelY = padT + ih + 18;
      var valueY = by - 6;
      var fill = "#5fc491";
      return (val > 0
          ? '<rect x="' + bx + '" y="' + by + '" width="' + barW + '" height="' + bh + '" rx="4" fill="' + fill + '" />' +
            '<text x="' + cx + '" y="' + valueY + '" font-size="10" fill="#155946" font-weight="600" text-anchor="middle">' + val + 'm</text>'
          : '<rect x="' + bx + '" y="' + (padT + ih - 4) + '" width="' + barW + '" height="4" rx="2" fill="rgba(46,169,133,0.16)" />'
        ) +
        '<text x="' + cx + '" y="' + labelY + '" font-size="11" fill="#7a8e88" text-anchor="middle">' + labels[i] + '</text>';
    }).join("");

    return '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;">' +
      grid + bars +
      '</svg>';
  }
  // ----------------------------------------------------------------
  function statusBadge(status) {
    return '<span class="badge badge--' + status + '">' + status + '</span>';
  }

  /**
   * Resolve the admin-facing display label for a user record.
   * Priority: admin remark → user nickname → fallback "用户 #shortId".
   * The user's own nickname (if set) is not shown when an admin remark
   * exists, because the admin chose the remark deliberately.
   */
  function displayLabel(user) {
    if (!user) return "—";
    var remark = (user.adminRemark || "").trim();
    if (remark) return remark;
    var nickname = (user.nickname || "").trim();
    if (nickname) return nickname;
    return "用户 #" + (user.id ? user.id.slice(0, 8) : "—");
  }

  // Single-instance fullscreen image viewer. Re-used for every photo
  // click; previous instance is torn down before opening a new one
  // so we never leak event listeners onto the document.
  let lightboxState = null;

  function openLightbox(urls, startIndex, meta) {
    if (!urls || !urls.length) return;
    closeLightbox();
    let index = Math.max(0, Math.min(startIndex | 0, urls.length - 1));
    const overlay = document.createElement("div");
    overlay.className = "lightbox-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";

    function render() {
      const url = urls[index];
      overlay.innerHTML =
        (meta ? '<div class="lightbox-meta">' + escapeHtml(meta) + '</div>' : '') +
        '<button class="lightbox-btn lightbox-close" aria-label="关闭">×</button>' +
        '<button class="lightbox-btn lightbox-prev" aria-label="上一张"' +
          (index === 0 ? ' hidden' : '') + '>‹</button>' +
        '<img class="lightbox-img" src="' + escapeHtml(url) + '" alt="" draggable="false" />' +
        '<button class="lightbox-btn lightbox-next" aria-label="下一张"' +
          (index === urls.length - 1 ? ' hidden' : '') + '>›</button>' +
        (urls.length > 1
          ? '<div class="lightbox-counter">' + (index + 1) + ' / ' + urls.length + '</div>'
          : '');
    }

    function go(delta) {
      const next = index + delta;
      if (next < 0 || next >= urls.length) return;
      index = next;
      render();
    }

    function onClick(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.classList.contains("lightbox-close") || target === overlay) {
        closeLightbox();
      } else if (target.classList.contains("lightbox-prev")) {
        go(-1);
      } else if (target.classList.contains("lightbox-next")) {
        go(1);
      }
    }
    function onKey(event) {
      if (event.key === "Escape") closeLightbox();
      else if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
    }

    overlay.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    lightboxState = { overlay, onKey };
    render();
  }

  function closeLightbox() {
    if (!lightboxState) return;
    document.removeEventListener("keydown", lightboxState.onKey);
    lightboxState.overlay.remove();
    lightboxState = null;
    document.body.style.overflow = "";
  }

  const app = document.getElementById("app");
  let state = { route: "list", users: [], stats: null, detail: null, sortKey: "lastLoginAt", sortDir: "desc", filter: "" };

  function navigate() {
    const hash = location.hash || "#/";
    if (hash.startsWith("#/users/")) {
      state.route = "detail";
      state.detailId = hash.slice("#/users/".length);
    } else {
      state.route = "list";
      state.detailId = null;
    }
    render();
  }
  window.addEventListener("hashchange", navigate);

  function logout() { clearToken(); render(); }

  function renderLogin(error) {
    app.innerHTML = '\\
      <div class="login">\\
        <h1>管理后台登录</h1>\\
        <p class="sub">输入 <code>ADMIN_TOKEN</code> 进入查看用户与学习数据。</p>\\
        ' + (error ? '<div class="alert alert--err">' + escapeHtml(error) + '</div>' : '') + '\\
        <div class="card">\\
          <div class="field">\\
            <label for="t">Admin Token</label>\\
            <input id="t" type="password" autocomplete="off" placeholder="" />\\
          </div>\\
          <button class="primary" id="loginBtn">登录</button>\\
        </div>\\
      </div>';
    const input = document.getElementById("t");
    const btn = document.getElementById("loginBtn");
    input.focus();
    function attempt() {
      const v = input.value.trim();
      if (!v) return;
      setToken(v);
      api("/whoami").then(() => {
        navigate();
      }).catch((err) => {
        clearToken();
        renderLogin(err.message === "UNAUTHORIZED" ? "Token 无效" : err.message);
      });
    }
    btn.onclick = attempt;
    input.onkeydown = (e) => { if (e.key === "Enter") attempt(); };
  }

  async function renderList() {
    app.innerHTML = '<div class="card"><div class="sub">加载中…</div></div>';
    try {
      const [stats, usersResp, recentResp, diag] = await Promise.all([
        api("/stats"),
        api("/users"),
        api("/recent-sessions?limit=20"),
        api("/diag").catch(() => null)
      ]);
      state.stats = stats;
      state.users = usersResp.users;
      state.recent = recentResp.items;
      state.diag = diag;
      drawList();
    } catch (err) {
      if (err.message === "UNAUTHORIZED" || err.message === "NO_TOKEN") {
        renderLogin();
        return;
      }
      app.innerHTML = '<div class="alert alert--err">加载失败：' + escapeHtml(err.message) + '</div>';
    }
  }

  function drawList() {
    const s = state.stats;
    const filter = state.filter.toLowerCase();
    const sortKey = state.sortKey;
    const dir = state.sortDir === "asc" ? 1 : -1;
    const filtered = state.users.filter((u) => {
      if (!filter) return true;
      return (u.nickname || "").toLowerCase().includes(filter)
        || (u.openid || "").toLowerCase().includes(filter)
        || (u.clientUid || "").toLowerCase().includes(filter)
        || (u.id || "").toLowerCase().includes(filter);
    }).sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });

    const recent = state.recent || [];
    const recentHtml = recent.length ? recent.slice(0, 10).map((item) => {
      const tagsHtml = (item.tags || []).map((t) => '<span class="tag">' + escapeHtml(t) + '</span>').join("");
      const userLink = '#/users/' + encodeURIComponent(item.userId);
      return '<div class="session" style="padding:10px 0;">\\
        <div class="session__head">\\
          <div>\\
            <div class="session__when"><a href="' + userLink + '" style="color:inherit;text-decoration:none;border-bottom:1px dashed var(--mint-300);">' + escapeHtml(displayLabel({ id: item.userId, nickname: item.nickname, adminRemark: item.adminRemark })) + '</a> ' +
              (item.identityKind === "wechat" ? '<span class="badge badge--wechat">wechat</span>' : '<span class="badge badge--anon">anon</span>') + '</div>\\
            <div class="session__sub">' + escapeHtml(item.subject || "—") + ' · ' + formatDate(item.endedAt) + '</div>\\
          </div>\\
          <div class="session__dur">' + item.durationMinutes + ' 分钟</div>\\
        </div>' +
        (item.summary ? '<div class="session__summary">' + escapeHtml(item.summary) + '</div>' : '') +
        (tagsHtml ? '<div class="tags">' + tagsHtml + '</div>' : '') +
      '</div>';
    }).join("") : '<div class="sub">暂无打卡记录。</div>';

    const diag = state.diag;
    const diagBanner = (function buildDiagBanner() {
      if (!diag) return "";
      if (diag.storageMode === "cos" && !diag.probe.error) return "";
      const reason = diag.storageMode === "default"
        ? "存储未配置（图片代理会显示占位图）"
        : (diag.probe.error || "存储调用失败");
      const hint = diag.hint || "";
      return '<div class="alert alert--err" style="margin-bottom:16px;">⚠️ ' +
        escapeHtml(reason) +
        (hint ? '<div class="sub" style="margin-top:4px;">' + escapeHtml(hint) + '</div>' : '') +
        '</div>';
    })();

    app.innerHTML = diagBanner + '\\
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px;">\\
        <div>\\
          <h1>CPA 学习数据 · 管理后台</h1>\\
          <p class="sub">共 ' + s.totalUsers + ' 位用户 · 数据时间 ' + formatDate(s.generatedAt) + '</p>\\
        </div>\\
        <div style="display:flex;gap:8px;">\\
          <button class="ghost" id="exportUsers">导出 CSV</button>\\
          <button class="ghost" onclick="window.__admin.logout()">退出登录</button>\\
        </div>\\
      </div>\\
      \\
      <div class="card">\\
        <h2 style="margin-top:0;">总览</h2>\\
        <div class="stats">\\
          <div class="stat"><div class="stat__label">总用户</div><div class="stat__value">' + s.totalUsers + '</div></div>\\
          <div class="stat"><div class="stat__label">完成过打卡</div><div class="stat__value">' + s.activeWithSessions + '</div></div>\\
          <div class="stat"><div class="stat__label">7 日活跃</div><div class="stat__value">' + s.activeWeekly + '</div></div>\\
          <div class="stat"><div class="stat__label">累计学习时长</div><div class="stat__value">' + formatMinutes(s.totalMinutes) + '</div></div>\\
          <div class="stat"><div class="stat__label">累计打卡次数</div><div class="stat__value">' + s.totalSessions + '</div></div>\\
        </div>\\
      </div>\\
      \\
      <div class="card">\\
        <h2 style="margin-top:0;">最近打卡（' + recent.length + '）</h2>\\
        ' + recentHtml + '\\
      </div>\\
      \\
      <div class="card">\\
        <div class="toolbar">\\
          <input id="filter" type="text" placeholder="按昵称 / openid / clientUid / 内部ID 搜索" value="' + escapeHtml(state.filter) + '" />\\
        </div>\\
        <table>\\
          <thead><tr>\\
            <th data-k="nickname">昵称</th>\\
            <th data-k="totalMinutes">累计</th>\\
            <th data-k="completedSessions">打卡次数</th>\\
            <th data-k="currentStreakDays">当前连签</th>\\
            <th data-k="longestStreakDays">最长连签</th>\\
            <th data-k="lastSessionAt">最近打卡</th>\\
            <th data-k="lastLoginAt">最近登录</th>\\
            <th>识别符</th>\\
          </tr></thead>\\
          <tbody id="rows"></tbody>\\
        </table>\\
      </div>';

    const tbody = document.getElementById("rows");
    tbody.innerHTML = filtered.map((u) => {
      const ident = (u.openid ? '<span class="badge badge--wechat">wechat</span>' : '')
        + (u.clientUid ? '<span class="badge badge--anon">anon</span>' : '');
      return '<tr class="row-link" onclick="location.hash=\\'#/users/' + escapeHtml(u.id) + '\\'">' +
        '<td><strong>' + escapeHtml(displayLabel(u)) + '</strong>' +
          (u.adminRemark && u.nickname ? '<div class="sub" style="font-size:12px;margin-top:2px;">原昵称：' + escapeHtml(u.nickname) + '</div>' : '') +
        '<div class="mono">' + shortId(u.id) + '</div></td>' +
        '<td>' + formatMinutes(u.totalMinutes) + '</td>' +
        '<td>' + u.completedSessions + '</td>' +
        '<td>' + u.currentStreakDays + ' 天</td>' +
        '<td>' + u.longestStreakDays + ' 天</td>' +
        '<td>' + formatDay(u.lastSessionAt) + '</td>' +
        '<td>' + formatDay(u.lastLoginAt) + '</td>' +
        '<td>' + ident + '</td>' +
      '</tr>';
    }).join("");

    const exportBtn = document.getElementById("exportUsers");
    if (exportBtn) {
      exportBtn.onclick = () => downloadCsv("/export/users.csv", "users.csv");
    }

    document.getElementById("filter").oninput = (e) => {
      state.filter = e.target.value;
      drawList();
      const inp = document.getElementById("filter");
      inp.focus();
      inp.setSelectionRange(state.filter.length, state.filter.length);
    };
    document.querySelectorAll("th[data-k]").forEach((th) => {
      th.onclick = () => {
        const k = th.getAttribute("data-k");
        if (state.sortKey === k) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else { state.sortKey = k; state.sortDir = "desc"; }
        drawList();
      };
    });
  }

  async function renderDetail(userId) {
    app.innerHTML = '<div class="card"><a class="ghost" style="text-decoration:none;display:inline-block;" href="#/">← 返回</a><div class="sub" style="margin-top:8px;">加载中…</div></div>';
    try {
      const data = await api("/users/" + encodeURIComponent(userId));
      drawDetail(data);
    } catch (err) {
      if (err.message === "UNAUTHORIZED" || err.message === "NO_TOKEN") {
        renderLogin();
        return;
      }
      app.innerHTML = '<div class="alert alert--err">加载失败：' + escapeHtml(err.message) + '</div>';
    }
  }

  function drawDetail(d) {
    const u = d.user;
    const s = d.summary;
    // Heat-map: current calendar month only by default. The 6-month
    // historical grid was eating too much vertical space; the user can
    // toggle "查看更多月份" if they need historical context.
    const stats = d.dailyStats || [];
    const today = new Date();
    const expanded = !!state.detailHeatExpanded;
    const monthsBack = expanded ? 5 : 0;
    const months = [];
    for (let i = monthsBack; i >= 0; i--) {
      const dt = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push({ y: dt.getFullYear(), m: dt.getMonth() + 1 });
    }
    const statByDate = {};
    for (const st of stats) statByDate[st.date] = st;

    const heatHtml = months.map(({ y, m }) => {
      const monthLabel = y + '-' + String(m).padStart(2, "0");
      const last = new Date(y, m, 0).getDate();
      const cells = [];
      const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday-first
      for (let i = 0; i < firstDow; i++) cells.push('<div class="heat-cell faded"></div>');
      for (let day = 1; day <= last; day++) {
        const date = monthLabel + '-' + String(day).padStart(2, "0");
        const stat = statByDate[date];
        const lvl = stat?.heatLevel ?? 0;
        const minutes = stat?.totalMinutes ?? 0;
        const titleAttr = date + (minutes > 0 ? ' · ' + formatMinutes(minutes) : '');
        cells.push('<div class="heat-cell ' + (lvl > 0 ? 'l' + lvl : '') + '" title="' + titleAttr + '">' + day + '</div>');
      }
      return '<div class="heat-month"><div class="sub" style="margin-bottom:6px;">' + monthLabel + '</div><div class="heat-grid">' + cells.join("") + '</div></div>';
    }).join("");

    const sessions = (d.sessions || []).filter((x) => x.status === "completed" || x.status === "makeup")
      .sort((a, b) => (b.endedAt || "").localeCompare(a.endedAt || ""));
    const sessionsHtml = sessions.length ? sessions.map((x) => {
      const photos = (x.photos || []).map((p, i) => p.url
        ? '<img src="' + escapeHtml(p.url) + '" alt="" loading="lazy"' +
          ' data-session-id="' + escapeHtml(x.id) + '" data-photo-index="' + i + '" />'
        : '<div class="photo-fallback">' + escapeHtml(p.objectKey) + '</div>'
      ).join("");
      const tags = (x.tags || []).map((t) => '<span class="tag">' + escapeHtml(t) + '</span>').join("");
      return '<div class="session">' +
        '<div class="session__head">' +
          '<div>' +
            '<div class="session__when">' + formatDate(x.endedAt) + ' ' + statusBadge(x.status) + '</div>' +
            '<div class="session__sub">科目：' + escapeHtml(x.subject || "—") + ' · 起止 ' + formatDate(x.startedAt) + ' → ' + formatDate(x.endedAt) + '</div>' +
          '</div>' +
          '<div class="session__dur">' + x.durationMinutes + ' 分钟</div>' +
        '</div>' +
        (x.summary ? '<div class="session__summary">' + escapeHtml(x.summary) + '</div>' : '') +
        (tags ? '<div class="tags">' + tags + '</div>' : '') +
        (photos ? '<div class="photos">' + photos + '</div>' : '') +
      '</div>';
    }).join("") : '<div class="sub">该用户还没有完成过打卡。</div>';

    const breakdown = d.breakdown || { subjects: [], tags: [] };
    const subjectsHtml = breakdown.subjects.length ? breakdown.subjects.map((row) => {
      const pct = s.totalMinutes > 0 ? Math.round((row.totalMinutes / s.totalMinutes) * 100) : 0;
      return '<tr>\\
        <td><strong>' + escapeHtml(row.subject) + '</strong></td>\\
        <td>' + row.count + ' 次</td>\\
        <td>' + formatMinutes(row.totalMinutes) + '</td>\\
        <td><div style="width:120px;background:rgba(46,169,133,0.1);border-radius:6px;height:8px;overflow:hidden;">\\
          <div style="background:var(--mint-300);height:100%;width:' + pct + '%;"></div>\\
        </div></td>\\
        <td>' + pct + '%</td>\\
      </tr>';
    }).join("") : '<tr><td colspan="5" class="sub">暂无科目数据</td></tr>';

    const tagsHtml = breakdown.tags.length
      ? breakdown.tags.map((row) =>
          '<span class="tag">' + escapeHtml(row.tag) + ' · ' + row.count + '</span>'
        ).join(" ")
      : '<span class="sub">暂无标签数据</span>';

    app.innerHTML = '\\
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:8px;">\\
        <a class="ghost" style="text-decoration:none;display:inline-block;" href="#/">← 返回</a>\\
        <button class="ghost" id="exportSessions">导出 CSV</button>\\
      </div>\\
      <div class="card">\\
        <h1>' + escapeHtml(displayLabel(u)) + '</h1>\\
        <p class="sub mono">' + escapeHtml(u.id) + '</p>\\
        ' + (u.adminRemark && u.nickname ? '<p class="sub" style="margin-top:4px;">用户原昵称：<strong style="color:var(--text-main);">' + escapeHtml(u.nickname) + '</strong></p>' : '') + '\\
        <div class="sub" style="margin-top:8px;">\\
          ' + (u.openid ? '<span class="badge badge--wechat">wechat</span> ' + '<span class="mono">' + escapeHtml(u.openid) + '</span>' : '') + '<br>' +
          (u.clientUid ? '<span class="badge badge--anon">anon</span> ' + '<span class="mono">' + escapeHtml(u.clientUid) + '</span>' : '') + '\\
        </div>\\
        <div class="sub" style="margin-top:8px;">注册：' + formatDate(u.createdAt) + ' · 最近登录：' + formatDate(u.lastLoginAt) + '</div>\\
        \\
        <div class="remark-editor">\\
          <label class="remark-editor__label" for="remarkInput">管理员备注</label>\\
          <div class="remark-editor__row">\\
            <input id="remarkInput" type="text" maxlength="60" placeholder="给该用户起个易记的名字（仅你自己可见）" value="' + escapeHtml(u.adminRemark || "") + '" />\\
            <button class="primary" id="remarkSaveBtn">保存</button>\\
          </div>\\
          <div id="remarkStatus" class="remark-editor__status sub"></div>\\
        </div>\\
        \\
        <div class="stats" style="margin-top:18px;">\\
          <div class="stat"><div class="stat__label">累计学习</div><div class="stat__value">' + formatMinutes(s.totalMinutes) + '</div></div>\\
          <div class="stat"><div class="stat__label">完成打卡</div><div class="stat__value">' + s.completedSessions + '</div></div>\\
          <div class="stat"><div class="stat__label">当前连签</div><div class="stat__value">' + s.currentStreakDays + ' 天</div></div>\\
          <div class="stat"><div class="stat__label">最长连签</div><div class="stat__value">' + s.longestStreakDays + ' 天</div></div>\\
        </div>\\
      </div>\\
      \\
      <div class="card">\\
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;">\\
          <h2 style="margin:0;">学习趋势（近 30 天）</h2>\\
          <span class="sub" style="font-size:12px;">每日累计学习分钟</span>\\
        </div>\\
        ' + buildDailyTrendSvg(d.dailyStats || [], 30) + '\\
      </div>\\
      \\
      <div class="card">\\
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;">\\
          <h2 style="margin:0;">周内分布</h2>\\
          <span class="sub" style="font-size:12px;">各周天的平均学习时长</span>\\
        </div>\\
        ' + buildWeekdayPatternSvg(d.dailyStats || []) + '\\
      </div>\\
      \\
      <div class="card">\\
        <h2 style="margin-top:0;">科目分布</h2>\\
        <table>\\
          <thead><tr><th>科目</th><th>次数</th><th>时长</th><th>占比</th><th></th></tr></thead>\\
          <tbody>' + subjectsHtml + '</tbody>\\
        </table>\\
        <div style="margin-top:14px;"><span class="sub" style="margin-right:8px;">标签：</span>' + tagsHtml + '</div>\\
      </div>\\
      \\
      <div class="card">\\
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;">\\
          <h2 style="margin:0;">学习热力图（' + (expanded ? '近 6 个月' : '本月') + '）</h2>\\
          <button class="ghost" id="heatToggleBtn">' + (expanded ? '只看本月' : '查看 6 个月') + '</button>\\
        </div>\\
        ' + heatHtml + '\\
      </div>\\
      \\
      <div class="card">\\
        <h2 style="margin-top:0;">学习记录（' + sessions.length + '）</h2>\\
        ' + sessionsHtml + '\\
      </div>';

    const exportSessionsBtn = document.getElementById("exportSessions");
    if (exportSessionsBtn) {
      exportSessionsBtn.onclick = () => downloadCsv(
        "/export/users/" + encodeURIComponent(u.id) + "/sessions.csv",
        "user-" + u.id.slice(0, 8) + "-sessions.csv"
      );
    }

    const heatToggleBtn = document.getElementById("heatToggleBtn");
    if (heatToggleBtn) {
      heatToggleBtn.onclick = () => {
        state.detailHeatExpanded = !state.detailHeatExpanded;
        drawDetail(d);
      };
    }

    // Admin remark editor: PATCH the new value, then update the local
    // state and re-render so the page header (and breadcrumb-style
    // header) reflects the new label without a full reload.
    const remarkInput = document.getElementById("remarkInput");
    const remarkBtn = document.getElementById("remarkSaveBtn");
    const remarkStatus = document.getElementById("remarkStatus");
    function showRemarkStatus(message, kind) {
      if (!remarkStatus) return;
      remarkStatus.textContent = message;
      remarkStatus.style.color = kind === "ok"
        ? "var(--mint-500)"
        : kind === "err"
          ? "var(--danger)"
          : "var(--text-sub)";
    }
    if (remarkInput && remarkBtn) {
      remarkBtn.onclick = async () => {
        const next = (remarkInput.value || "").trim();
        if (next.length > 60) {
          showRemarkStatus("最多 60 个字符", "err");
          return;
        }
        remarkBtn.disabled = true;
        showRemarkStatus("保存中…");
        try {
          const token = getToken();
          const res = await fetch("/admin/api/users/" + encodeURIComponent(u.id) + "/remark", {
            method: "PATCH",
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ remark: next })
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error?.message || "HTTP " + res.status);
          }
          showRemarkStatus("已保存 ✓", "ok");
          // Reflect the change in the local cache + re-render so the
          // big H1 picks up the new label immediately.
          d.user.adminRemark = next;
          if (state.detail) state.detail.user.adminRemark = next;
          drawDetail(d);
          setTimeout(() => showRemarkStatus("", ""), 2200);
        } catch (err) {
          showRemarkStatus("保存失败：" + err.message, "err");
          remarkBtn.disabled = false;
        }
      };
    }

    // Delegated click handler: every photo thumbnail in any session
    // opens a fullscreen lightbox scoped to that session photo set.
    app.querySelectorAll(".photos img").forEach((img) => {
      img.addEventListener("click", (event) => {
        const target = event.currentTarget;
        const sessionId = target.getAttribute("data-session-id");
        const photoIndex = Number(target.getAttribute("data-photo-index") || 0);
        const session = sessions.find((s) => s.id === sessionId);
        if (!session) return;
        const urls = (session.photos || []).map((p) => p.url).filter(Boolean);
        if (!urls.length) return;
        const meta = (session.subject || "学习") + " · " + formatDate(session.endedAt);
        openLightbox(urls, photoIndex, meta);
      });
    });
  }

  function render() {
    if (!getToken()) { renderLogin(); return; }
    if (state.route === "detail") renderDetail(state.detailId);
    else renderList();
  }

  window.__admin = { logout };
  navigate();
})();
</script>
</body>
</html>`;
