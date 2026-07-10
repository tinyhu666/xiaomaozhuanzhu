#!/usr/bin/env bash
# =============================================================================
# 从本机（Mac）一键部署服务端到腾讯云 VPS —— 绕开「VPS 拉 GitHub 老失败」
#
#   rsync 源码（仅 server/ + 根 package 文件）→ VPS → 构建 → 重启 pm2
#
# 用法：  bash scripts/deploy-remote.sh
# 覆盖：  VPS_HOST=root@1.2.3.4  VPS_KEY=~/.ssh/xxx  VPS_APP_DIR=/opt/xiaomao
#
# 安全：
#   - 只同步 server/ + 根 package 文件（不传 miniprogram/docs/.omc 等杂物）。
#   - 显式排除 server/.env（密钥只在服务器上，本脚本绝不覆盖）+ dist + node_modules。
#   - IP 非机密；私钥留在本机 ~/.ssh，不入库。
# =============================================================================
set -euo pipefail

VPS="${VPS_HOST:-root@118.89.94.251}"
KEY="${VPS_KEY:-$HOME/.ssh/xiaomao_deploy}"
APP="${VPS_APP_DIR:-/opt/xiaomao}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_CMD="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20"

echo "[deploy-remote] rsync server/ + package 文件 → $VPS:$APP"
CHANGES="$(rsync -az --itemize-changes \
  --exclude 'server/.env' \
  --exclude 'server/dist' \
  --exclude 'node_modules' \
  --exclude '.DS_Store' \
  -e "$SSH_CMD" \
  "$ROOT/server" "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/tsconfig.base.json" \
  "$VPS:$APP/")"
echo "$CHANGES"

# 仅当依赖清单变化时才 npm ci（否则跳过，省时）。
NEED_CI=""
echo "$CHANGES" | grep -qE 'package(-lock)?\.json' && NEED_CI=1

echo "[deploy-remote] 服务器上：构建 + 重启"
# 把是否 npm ci 通过环境变量传进远端。
$SSH_CMD "$VPS" "APP='$APP' NEED_CI='$NEED_CI' bash -s" <<'REMOTE'
set -e
cd "$APP"
# .env 兜底自检：绝不因部署丢失密钥。
[ -f server/.env ] || { echo "!! server/.env 不存在，中止（密钥缺失）"; exit 1; }
if [ -n "$NEED_CI" ]; then echo "[deploy] 依赖变化 → npm ci"; npm ci; fi
npm run build:server >/tmp/xiaomao-build.log 2>&1 || { echo "构建失败："; tail -25 /tmp/xiaomao-build.log; exit 1; }
pm2 restart cpa --update-env >/dev/null
sleep 3
printf '[deploy] health: '; curl -s --max-time 8 http://127.0.0.1:3000/health && echo
REMOTE
echo "[deploy-remote] ✅ 完成"
