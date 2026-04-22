import type { AdminDateUserRow, AdminSelectedUser, AdminUserSummary } from "./view-models";

type LoginPageInput = {
  error?: string | null;
  disabled?: boolean;
};

type DashboardPageInput = {
  activeView: "users" | "date";
  selectedDate: string;
  search: string;
  users: AdminUserSummary[];
  selectedUser: AdminSelectedUser | null;
  dateRows: AdminDateUserRow[];
};

export function renderAdminLoginPage(input: LoginPageInput = {}) {
  return renderDocument({
    title: "管理员登录",
    body: `
      <main class="login-shell">
        <section class="login-card">
          <h1>管理员登录</h1>
          <p class="muted">只读后台，用于查看用户近 7 天打卡信息和上传内容。</p>
          ${
            input.disabled
              ? `<div class="alert">后台未启用，请先配置 <code>ADMIN_PASSWORD</code>。</div>`
              : `
                ${input.error ? `<div class="alert">${escapeHtml(input.error)}</div>` : ""}
                <form method="post" action="/admin/login" class="stack">
                  <label for="password">管理员密码</label>
                  <input id="password" name="password" type="password" autocomplete="current-password" required />
                  <button type="submit">进入后台</button>
                </form>
              `
          }
        </section>
      </main>
    `
  });
}

export function renderAdminDashboardPage(input: DashboardPageInput) {
  return renderDocument({
    title: "管理后台",
    body: `
      <main class="dashboard-shell">
        <header class="topbar">
          <div>
            <h1>管理后台</h1>
            <p class="muted">默认查看最近 7 天用户打卡和上传内容</p>
          </div>
          <div class="topbar__actions">
            <a class="tab ${input.activeView === "users" ? "tab--active" : ""}" href="/admin">用户视图</a>
            <a class="tab ${input.activeView === "date" ? "tab--active" : ""}" href="/admin?view=date&date=${encodeURIComponent(
              input.selectedDate
            )}">按日期查看</a>
            <form method="post" action="/admin/logout">
              <button type="submit" class="ghost-button">退出登录</button>
            </form>
          </div>
        </header>

        ${
          input.activeView === "date"
            ? renderDateView(input.selectedDate, input.dateRows)
            : renderUserView(input.search, input.users, input.selectedUser)
        }
      </main>
    `
  });
}

function renderUserView(search: string, users: AdminUserSummary[], selectedUser: AdminSelectedUser | null) {
  return `
    <section class="grid-layout">
      <aside class="panel sidebar">
        <h2>用户列表</h2>
        <form method="get" action="/admin" class="stack">
          <input type="hidden" name="view" value="users" />
          <label for="search">搜索昵称或 OpenID</label>
          <input id="search" name="search" value="${escapeHtml(search)}" placeholder="输入昵称或 OpenID" />
          <button type="submit">搜索</button>
        </form>
        <div class="metric-row">
          <span class="metric">用户数 ${users.length}</span>
          <span class="metric">默认范围 7 天</span>
        </div>
        <div class="user-list">
          ${
            users.length
              ? users
                  .map((user) => {
                    const isActive = selectedUser?.userId === user.userId;
                    return `
                      <a class="user-row ${isActive ? "user-row--active" : ""}" href="/admin?view=users&search=${encodeURIComponent(
                        search
                      )}&user=${encodeURIComponent(user.userId)}">
                        <img src="${escapeAttribute(user.avatarUrl || fallbackAvatar())}" alt="" />
                        <div class="user-row__body">
                          <strong>${escapeHtml(displayName(user.nickname))}</strong>
                          <span>最近打卡日期: ${escapeHtml(user.latestCheckinDate ?? "暂无")}</span>
                          <span>近 7 天打卡天数: ${user.recentCheckinDays}</span>
                          <span>近 7 天上传数: ${user.recentUploadCount}</span>
                        </div>
                      </a>
                    `;
                  })
                  .join("")
              : `<div class="empty-state">没有符合条件的用户。</div>`
          }
        </div>
      </aside>

      <section class="panel detail-panel">
        ${
          selectedUser
            ? renderSelectedUser(selectedUser)
            : `<div class="empty-state">请选择左侧用户查看最近 7 天详情。</div>`
        }
      </section>
    </section>
  `;
}

function renderSelectedUser(user: AdminSelectedUser) {
  return `
    <div class="detail-header">
      <div class="identity">
        <img src="${escapeAttribute(user.avatarUrl || fallbackAvatar())}" alt="" class="identity__avatar" />
        <div>
          <h2>${escapeHtml(displayName(user.nickname))}</h2>
          <p class="muted">OpenID: <code>${escapeHtml(user.openid)}</code></p>
          <p class="muted">最后登录: ${escapeHtml(user.lastLoginAt || "暂无")}</p>
        </div>
      </div>
      <div class="detail-meta">
        <span class="metric">${user.profileCompleted ? "已完成建档" : "未完成建档"}</span>
        <span class="metric">分享页: ${user.publicProfile?.isPublic ? "公开" : "未公开"}</span>
        <span class="metric">微信鉴权: ${user.publicProfile?.requireWechatAuth ? "开启" : "关闭"}</span>
      </div>
    </div>

    <h3>近 7 天</h3>
    <div class="day-groups">
      ${user.recentDays.map(renderDayGroup).join("")}
    </div>
  `;
}

function renderDayGroup(day: AdminSelectedUser["recentDays"][number]) {
  return `
    <article class="day-card">
      <div class="day-card__header">
        <div>
          <h4>${escapeHtml(day.date)}</h4>
          <p class="muted">总时长 ${day.totalMinutes} 分钟 / 打卡 ${day.sessionCount} 次 / 上传 ${day.uploadCount} 张</p>
        </div>
      </div>
      ${
        day.sessions.length
          ? day.sessions
              .map(
                (session) => `
                  <section class="session-card">
                    <div class="session-card__head">
                      <strong>${escapeHtml(session.summary || "未填写摘要")}</strong>
                      <span class="metric">${session.totalMinutes} 分钟</span>
                    </div>
                    <p class="muted">科目: ${escapeHtml(session.subjects.length ? session.subjects.join("、") : "未设置")} / 标签: ${escapeHtml(
                      session.tags.length ? session.tags.join("、") : "无"
                    )}</p>
                    <p class="muted">结束时间: ${escapeHtml(session.endedAt ?? "未结束")}</p>
                    ${
                      session.photos.length
                        ? `
                          <div class="photo-grid">
                            ${session.photos
                              .map(
                                (photo) => `
                                  <a href="${escapeAttribute(photo.tempUrl || "#")}" target="_blank" rel="noreferrer" class="photo-card">
                                    <img src="${escapeAttribute(photo.tempUrl || fallbackAvatar())}" alt="${escapeAttribute(photo.objectKey)}" />
                                    <span>${escapeHtml(photo.objectKey)}</span>
                                  </a>
                                `
                              )
                              .join("")}
                          </div>
                        `
                        : `<p class="muted">无上传内容</p>`
                    }
                  </section>
                `
              )
              .join("")
          : `<p class="muted">这一天没有打卡记录。</p>`
      }
    </article>
  `;
}

function renderDateView(selectedDate: string, rows: AdminDateUserRow[]) {
  return `
    <section class="panel">
      <div class="date-view__header">
        <div>
          <h2>按日期查看</h2>
          <p class="muted">查看某一天里有哪些用户打卡并上传内容</p>
        </div>
        <form method="get" action="/admin" class="date-form">
          <input type="hidden" name="view" value="date" />
          <label for="date">日期</label>
          <input id="date" name="date" type="date" value="${escapeAttribute(selectedDate)}" />
          <button type="submit">切换日期</button>
        </form>
      </div>

      <div class="date-summary">当前日期: <strong>${escapeHtml(selectedDate)}</strong></div>

      ${
        rows.length
          ? rows
              .map(
                (row) => `
                  <article class="date-user-card">
                    <div class="date-user-card__head">
                      <div class="identity">
                        <img src="${escapeAttribute(row.avatarUrl || fallbackAvatar())}" alt="" class="identity__avatar identity__avatar--small" />
                        <div>
                          <strong>${escapeHtml(displayName(row.nickname))}</strong>
                          <p class="muted"><code>${escapeHtml(row.openid)}</code></p>
                        </div>
                      </div>
                      <div class="detail-meta">
                        <span class="metric">${row.totalMinutes} 分钟</span>
                        <span class="metric">${row.sessionCount} 次打卡</span>
                        <span class="metric">${row.uploadCount} 张上传</span>
                      </div>
                    </div>
                    <div class="session-list">
                      ${row.sessions
                        .map(
                          (session) => `
                            <section class="session-card">
                              <div class="session-card__head">
                                <strong>${escapeHtml(session.summary || "未填写摘要")}</strong>
                                <span class="metric">${session.totalMinutes} 分钟</span>
                              </div>
                              <p class="muted">科目: ${escapeHtml(session.subjects.length ? session.subjects.join("、") : "未设置")} / 标签: ${escapeHtml(
                                session.tags.length ? session.tags.join("、") : "无"
                              )}</p>
                              ${
                                session.photos.length
                                  ? `
                                    <div class="photo-grid">
                                      ${session.photos
                                        .map(
                                          (photo) => `
                                            <a href="${escapeAttribute(photo.tempUrl || "#")}" target="_blank" rel="noreferrer" class="photo-card">
                                              <img src="${escapeAttribute(photo.tempUrl || fallbackAvatar())}" alt="${escapeAttribute(
                                                photo.objectKey
                                              )}" />
                                              <span>${escapeHtml(photo.objectKey)}</span>
                                            </a>
                                          `
                                        )
                                        .join("")}
                                    </div>
                                  `
                                  : `<p class="muted">无上传内容</p>`
                              }
                            </section>
                          `
                        )
                        .join("")}
                    </div>
                  </article>
                `
              )
              .join("")
          : `<div class="empty-state">这一天没有用户打卡记录。</div>`
      }
    </section>
  `;
}

function renderDocument(input: { title: string; body: string }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f8f6;
        --surface: #ffffff;
        --surface-strong: #eef7f2;
        --border: #d8e5de;
        --text: #173026;
        --muted: #5f746c;
        --accent: #1f8f68;
        --accent-soft: #e7f5ef;
        --danger: #b13c3c;
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        background: linear-gradient(180deg, #f7fbf8 0%, var(--bg) 100%);
        color: var(--text);
      }

      a { color: inherit; text-decoration: none; }
      code {
        font-family: "Cascadia Code", "Consolas", monospace;
        background: #f3f6f4;
        padding: 0.1rem 0.35rem;
        border-radius: 6px;
      }

      .dashboard-shell, .login-shell {
        max-width: 1400px;
        margin: 0 auto;
        padding: 28px;
      }

      .login-shell {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .login-card, .panel {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 24px;
        box-shadow: 0 18px 48px rgba(23, 48, 38, 0.08);
      }

      .login-card {
        width: min(460px, 100%);
        padding: 32px;
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
        margin-bottom: 20px;
      }

      .topbar__actions {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .tab, button {
        border-radius: 12px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        font: inherit;
        padding: 10px 16px;
        cursor: pointer;
      }

      .tab--active, button[type="submit"] {
        background: var(--accent);
        border-color: var(--accent);
        color: white;
      }

      .ghost-button {
        background: transparent;
      }

      .grid-layout {
        display: grid;
        grid-template-columns: 360px minmax(0, 1fr);
        gap: 20px;
        align-items: start;
      }

      .sidebar, .detail-panel, .panel {
        padding: 20px;
      }

      .stack {
        display: grid;
        gap: 10px;
      }

      input {
        width: 100%;
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 10px 12px;
        font: inherit;
        background: #fcfefd;
      }

      h1, h2, h3, h4, p {
        margin: 0;
      }

      h1 { font-size: 30px; margin-bottom: 6px; }
      h2 { font-size: 22px; margin-bottom: 16px; }
      h3 { font-size: 18px; margin-bottom: 14px; }
      h4 { font-size: 16px; margin-bottom: 6px; }

      .muted {
        color: var(--muted);
        line-height: 1.5;
      }

      .alert {
        margin: 16px 0;
        padding: 12px 14px;
        border-radius: 14px;
        background: #fff3f3;
        border: 1px solid #f0c8c8;
        color: var(--danger);
      }

      .metric-row, .detail-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .metric {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 13px;
        font-weight: 600;
      }

      .user-list, .day-groups, .session-list {
        display: grid;
        gap: 12px;
      }

      .user-list {
        margin-top: 16px;
      }

      .user-row {
        display: grid;
        grid-template-columns: 52px minmax(0, 1fr);
        gap: 12px;
        padding: 12px;
        border-radius: 18px;
        border: 1px solid var(--border);
        background: #fbfdfc;
      }

      .user-row--active {
        border-color: var(--accent);
        background: var(--accent-soft);
      }

      .user-row img, .identity__avatar {
        width: 52px;
        height: 52px;
        border-radius: 16px;
        object-fit: cover;
        background: #eef3f0;
      }

      .user-row__body {
        display: grid;
        gap: 4px;
        font-size: 13px;
      }

      .detail-header, .date-view__header, .date-user-card__head, .session-card__head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
      }

      .identity {
        display: flex;
        gap: 12px;
        align-items: center;
      }

      .identity__avatar {
        width: 60px;
        height: 60px;
      }

      .identity__avatar--small {
        width: 44px;
        height: 44px;
        border-radius: 14px;
      }

      .day-card, .session-card, .date-user-card {
        border: 1px solid var(--border);
        background: #fcfefd;
        border-radius: 18px;
        padding: 16px;
      }

      .day-card {
        display: grid;
        gap: 14px;
      }

      .photo-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px;
        margin-top: 12px;
      }

      .photo-card {
        display: grid;
        gap: 8px;
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 10px;
        background: white;
      }

      .photo-card img {
        width: 100%;
        aspect-ratio: 1;
        border-radius: 10px;
        object-fit: cover;
        background: #eef3f0;
      }

      .photo-card span {
        font-size: 12px;
        color: var(--muted);
        word-break: break-all;
      }

      .date-form {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .date-summary {
        margin: 14px 0 18px;
        color: var(--muted);
      }

      .empty-state {
        padding: 28px;
        text-align: center;
        border: 1px dashed var(--border);
        border-radius: 18px;
        color: var(--muted);
        background: #fbfdfc;
      }

      @media (max-width: 1100px) {
        .grid-layout {
          grid-template-columns: 1fr;
        }

        .topbar, .date-view__header, .detail-header, .date-user-card__head, .session-card__head {
          flex-direction: column;
        }

        .date-form {
          width: 100%;
          flex-wrap: wrap;
        }
      }
    </style>
  </head>
  <body>
    ${input.body}
  </body>
</html>`;
}

function displayName(value: string) {
  return value.trim() || "未命名用户";
}

function fallbackAvatar() {
  return "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='20' fill='%23e5efe9'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2394aca1'/%3E%3Cpath d='M18 66c5-12 18-18 22-18s17 6 22 18' fill='%2394aca1'/%3E%3C/svg%3E";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
}
