# 管理后台

内置在云托管 server 里的简易后台，用于查看所有用户的学习数据。无额外部署。

## 启用步骤

1. **设置 admin token**（云托管环境变量）
   - 微信云托管控制台 → 服务管理 → `cpa-study-checkin` → 服务设置
   - 找到 **环境变量** 区域，新增一项：
     - Key: `ADMIN_TOKEN`
     - Value: 自取一个随机字符串（建议 32+ 字符），例如：
       ```bash
       openssl rand -hex 32
       ```
       或就是一句你能记住的长 passphrase，比如 `cpa-mama-good-luck-2026-spring`
   - 保存 → 触发滚动更新（容器会带新环境变量重启）

2. **访问后台**
   - 浏览器打开：
     ```
     https://<your-cloud-run-domain>/admin/
     ```
     例如：`https://cpa-study-checkin-247395-5-1422934587.sh.run.tcloudbase.com/admin/`
   - 输入 `ADMIN_TOKEN` → 登录
   - Token 保存在 localStorage，下次直接进入

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

### 用户详情
- 基本信息：内部 UUID、openid、clientUid、注册时间、最近登录
- 数据汇总：累计学习、完成打卡、当前连签、最长连签
- **近 6 个月热力图**（与小程序色阶一致，悬停看时长）
- **完整学习记录**：每次 session 的起止时间、时长、科目、标签、一句话总结、上传的照片缩略图
- 照片自动通过 WeChat OpenAPI 转换为可访问的临时 URL

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

# 单用户详情
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<domain>/admin/api/users/<user-uuid>
```

返回 JSON。可以接 jq 做导出 / 报表。

## 后续扩展

当前实现是只读的（list / read）。如果要做：
- 数据导出 CSV → 在 admin 页面增加 "导出" 按钮，前端遍历 `/users` 输出 CSV
- 删除/合并用户 → 加 `/admin/api/users/:id` `DELETE` 和 `/admin/api/users/:id/merge` 接口
- 多管理员 → 把 `ADMIN_TOKEN` 改成 `auth_methods` 表里的 `provider='admin'` 行

这些都不会动用户数据模型。
