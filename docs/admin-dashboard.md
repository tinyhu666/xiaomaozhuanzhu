# 管理后台

内置在 Express server 里的简易后台，跑在腾讯云轻量 VPS 上，用于查看所有用户的学习数据。无额外部署。

## 启用步骤

> ⚠️ **图片预览额外要求**：`ADMIN_TOKEN` 只解决登录。要让用户上传的图片能在后台显示，服务需要能把照片的 COS `objectKey` 签成可访问的 URL。第 1 步是必须的；第 2 步只有"图片显示不出来"时才需要做。

1. **设置 admin token**（VPS 上的 `server/.env`）
   - 编辑服务器上的 `server/.env`，新增一项：
     - Key: `ADMIN_TOKEN`
     - Value: 自取一个随机字符串（建议 32+ 字符），例如：
       ```bash
       openssl rand -hex 32
       ```
       或就是一句你能记住的长 passphrase，比如 `cpa-mama-good-luck-2026-spring`
   - 保存 → `pm2 restart cpa --update-env`（或走 `bash scripts/deploy-remote.sh` 重新部署）

2. **图片预览：COS 签名**

   Admin 后台通过签名 COS GET URL 来展示照片的 `objectKey`，并在管理页同源代理（`/admin/api/photos/proxy?key=<objectKey>`），无需额外配置——只要 `server/.env` 里的 `COS_SECRET_ID` / `COS_SECRET_KEY` / `COS_BUCKET` / `COS_REGION` 已就绪（见 [server/.env.example](../server/.env.example)），图片就能正常显示。

   > ⚠️ **不要**在 VPS 的 `server/.env` 里设置 `WECHAT_CLOUD_ENV` 或 `WECHAT_OPENAPI_INTERNAL`——这两个变量属于已下线的微信云托管路径，一旦设置会把存储模式从 COS 切回云托管，导致图片显示不出来。

   > 如果 admin 顶部出现红色横幅"⚠️ 存储未配置"或"调用失败"，说明 COS 环境变量没配齐，检查 `server/.env` 后重启。

3. **访问后台**
   - 浏览器打开：
     ```
     https://api.buffpp.com/admin/
     ```
   - 输入 `ADMIN_TOKEN` → 登录
   - Token 保存在 localStorage，下次直接进入

4. **诊断接口**（如果配置后图片还是显不出来）
   ```bash
   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     https://<domain>/admin/api/diag | jq
   ```
   返回 JSON 直接告诉你：
   - `storageMode`: 当前用的存储模式（`cos` / `default`；`default` 表示 COS 环境变量未配齐）
   - `envFlags`: 各关键 env 变量是否就绪（只显示 true/false，不暴露原值）
   - `probe`: 一次真实的 COS 签名尝试结果（成功的 url 或错误信息）
   - `hint`: 推断出的下一步建议

   截这个 JSON 给我能直接定位问题。

## 功能

### 全局总览
- 总用户数
- 完成过打卡的用户数
- 7 日活跃用户数（最近一次登录在 7 天内）
- 累计学习时长
- 累计打卡次数

### 用户列表
- 每行：昵称 / 累计 / 打卡次数 / 当前连签 / 最长连签 / 最近打卡 / 最近登录 / 识别符（wechat / anon）
- 点表头切换排序（升 / 降序）
- 顶部搜索框：按昵称 / openid / clientUid / 内部 ID 模糊搜索
- 整行点击进入详情页

### 最近打卡（实时流）
- 跨所有用户的最近 10 条已完成 session
- 每条显示：用户昵称（点击跳详情）、识别符、科目、时长、起止时间、总结、标签
- 看一眼就知道"现在大家在学什么"

### 用户详情
- 基本信息：内部 UUID、openid、clientUid、注册时间、最近登录
- 数据汇总：累计学习、完成打卡、当前连签、最长连签
- **科目分布**：每个科目的次数、累计时长、占比进度条
- **标签云**：最常用的标签（按出现次数排序）
- **近 6 个月热力图**（与小程序色阶一致，悬停看时长）
- **完整学习记录**：每次 session 的起止时间、时长、科目、标签、一句话总结、上传的照片缩略图
- 照片通过服务端签名 COS GET URL 展示，并经 `/admin/api/photos/proxy?key=<objectKey>` 同源代理

### CSV 导出
- 用户列表页右上「导出 CSV」 → 下载 `users.csv`（全部用户聚合数据）
- 用户详情页右上「导出 CSV」 → 下载 `user-<uuid>-sessions.csv`（该用户全部 session 流水）
- 文件带 UTF-8 BOM，Excel/Numbers 双击直接打开不乱码
- 中文/逗号/换行/双引号都按 RFC 4180 正确转义

## 安全

- 所有 `/admin/api/*` 请求**强制要求 `Authorization: Bearer <ADMIN_TOKEN>`**，否则 401
- Token 比对使用 **constant-time compare**，防止 timing 侧信道
- 没设置 `ADMIN_TOKEN` 时，admin API 直接 503 — 避免误部署导致裸奔
- 静态 HTML 本身不需要 token（输入框只是用来收集 token 写入 localStorage），但所有数据都来自需要 token 的 API
- 建议**定期轮换 token**：换个新值，旧 token 自然失效，所有已登录设备会被踢出

## 数据接口（如需脚本访问）

```bash
# 列出所有用户
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<domain>/admin/api/users

# 全局统计
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<domain>/admin/api/stats

# 单用户详情（含科目/标签分布）
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<domain>/admin/api/users/<user-uuid>

# 跨用户最近打卡（默认 50 条，最多 200）
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<domain>/admin/api/recent-sessions?limit=20

# CSV 导出
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<domain>/admin/api/export/users.csv -o users.csv

curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<domain>/admin/api/export/users/<uuid>/sessions.csv -o sessions.csv
```

返回 JSON。可以接 jq 做导出 / 报表。

## 后续扩展

当前实现是只读的（list / read）。如果要做：
- 数据导出 CSV → 在 admin 页面增加 "导出" 按钮，前端遍历 `/users` 输出 CSV
- 删除/合并用户 → 加 `/admin/api/users/:id` `DELETE` 和 `/admin/api/users/:id/merge` 接口
- 多管理员 → 把 `ADMIN_TOKEN` 改成 `auth_methods` 表里的 `provider='admin'` 行

这些都不会动用户数据模型。
