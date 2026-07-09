#!/usr/bin/env bash
# =============================================================================
# 小猫专注 · 腾讯云轻量服务器一键部署脚本（M4）
# 目标系统：Ubuntu 22.04 LTS，以 root（或 sudo）运行
#
# 用法：
#   sudo bash deploy-vps.sh setup                 # 首次：装环境+建库+拉代码+启动+nginx
#   sudo bash deploy-vps.sh deploy                # 日常：git pull + build + 重启
#   sudo bash deploy-vps.sh import backup.sql     # 导入云托管 mysqldump（迁数据）
#   sudo bash deploy-vps.sh ssl api.example.com   # 备案后：签 HTTPS + 绑定域名
#   sudo bash deploy-vps.sh expose-mysql 1.2.3.4  # 共享库双跑：允许云托管出口 IP 连库
#   sudo bash deploy-vps.sh status                # 体检
#
# 可用环境变量覆盖（均有默认值）：
#   REPO_URL   仓库地址（私有仓库请改成带 token 的 URL，或先在服务器配 deploy key）
#   APP_DIR    部署目录，默认 /opt/xiaomao
#   DB_NAME / DB_USER / PORT
#
# 说明：
# - 脚本幂等，可重复运行；不会覆盖已存在的 server/.env（只补缺失项）。
# - 备案前：用 http://<服务器IP>/health 冒烟；小程序端在开发者工具勾
#   「不校验合法域名」/ 真机开「调试模式」即可联调，无需等备案。
# - 轻量服务器的「防火墙」在腾讯云控制台配置（本脚本不动 ufw）：
#   放行 80/443（对外）；如走 expose-mysql，再对指定 IP 放行 3306。
# =============================================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/tinyhu666/xiaomaozhuanzhu.git}"
APP_DIR="${APP_DIR:-/opt/xiaomao}"
DB_NAME="${DB_NAME:-cpa}"
DB_USER="${DB_USER:-cpa}"
PORT="${PORT:-3000}"
# 该文件是数据库密码的唯一事实来源：setup/deploy 每次都会按它重置 MySQL
# 用户密码并写回 .env。如果你在 MySQL 里手动改密码，必须同步改这个文件。
DB_PASS_FILE="/root/.xiaomao-db-pass"
NGINX_SITE="/etc/nginx/sites-available/xiaomao"
PM2_APP="cpa"

log()  { echo -e "\033[1;32m[deploy]\033[0m $*"; }
warn() { echo -e "\033[1;33m[deploy]\033[0m $*"; }
die()  { echo -e "\033[1;31m[deploy]\033[0m $*" >&2; exit 1; }

need_root() {
  [ "$(id -u)" = "0" ] || die "请用 root / sudo 运行：sudo bash $0 $*"
}

# --------------------------------------------------------------------------
# 基础环境
# --------------------------------------------------------------------------
setup_swap() {
  # 2G 内存机器上 npm ci + tsc 可能 OOM；无 swap 时补 2G。
  if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
    log "无 swap，创建 2G swapfile（小内存机防 OOM）"
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
}

setup_packages() {
  log "apt 安装 nginx / mysql-server / git 等"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  # gnupg 必装：NodeSource 安装脚本要用它加 APT GPG key，缺了会导致
  # 只装上不带 npm 的发行版 nodejs（经典坑）。
  apt-get install -y nginx mysql-server git curl ca-certificates gnupg
  timedatectl set-timezone Asia/Shanghai || true
  systemctl enable --now nginx mysql
}

setup_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 \
     && [ "$(node -v | sed 's/^v//' | cut -d. -f1)" -ge 20 ]; then
    log "Node $(node -v) + npm 已就绪，跳过安装"
  else
    log "安装 Node 20（NodeSource）"
    # 先下载到文件再执行：`curl | bash` 在下载失败时会把空输入喂给 bash
    # 而静默成功（set -e 抓不到），改成 -o 文件让失败能被捕获。
    curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh \
      || die "NodeSource 安装脚本下载失败（网络？）。重试或手动：apt-get install -y nodejs npm"
    bash /tmp/nodesource_setup.sh
    apt-get install -y nodejs
  fi
  # 显式校验：装完必须有 npm，否则明确报错而不是拖到后面 npm ci 才炸。
  command -v npm >/dev/null 2>&1 \
    || die "Node 安装异常：npm 不存在。排查：node -v；apt-cache policy nodejs（来源应是 nodesource，不是 Ubuntu universe）"
  command -v pm2 >/dev/null 2>&1 || npm install -g pm2
}

# --------------------------------------------------------------------------
# MySQL：建库建用户。密码首次生成后存 /root/.xiaomao-db-pass（重跑复用）。
# 密码用 hex（URL 安全），因为它要拼进 DATABASE_URL=mysql://user:pass@...
# --------------------------------------------------------------------------
db_pass() {
  if [ ! -f "$DB_PASS_FILE" ]; then
    openssl rand -hex 16 > "$DB_PASS_FILE"
    chmod 600 "$DB_PASS_FILE"
  fi
  cat "$DB_PASS_FILE"
}

setup_mysql() {
  local pass; pass="$(db_pass)"
  log "MySQL：确保库 ${DB_NAME} + 用户 ${DB_USER}@localhost"
  mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${pass}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${pass}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
}

# --------------------------------------------------------------------------
# 代码 + .env + 构建
# --------------------------------------------------------------------------
setup_repo() {
  # 国内 VPS 到 github 常见 GnuTLS/TLS reset：用 HTTP/1.1 + 大 postBuffer
  # 缓解，并对 fetch 做重试（这类错多为瞬时）。
  git config --global http.version HTTP/1.1 2>/dev/null || true
  git config --global http.postBuffer 524288000 2>/dev/null || true

  if [ -d "$APP_DIR/.git" ]; then
    log "仓库已存在，拉取最新 main"
    local fetched=""
    for i in 1 2 3 4 5; do
      if git -C "$APP_DIR" fetch origin main; then fetched=1; break; fi
      warn "git fetch 失败（网络/TLS？），3s 后重试 ($i/5)"; sleep 3
    done
    [ -n "$fetched" ] || die \
"git fetch 反复失败——多为 VPS 到 github 的网络不稳（GnuTLS/TLS reset），与代码无关。
手动多试几次：git -C $APP_DIR fetch origin main
或走镜像：git -C $APP_DIR remote set-url origin https://ghproxy.net/https://github.com/tinyhu666/xiaomaozhuanzhu.git（拉完 reset --hard origin/main 后改回原地址）"
    git -C "$APP_DIR" merge --ff-only origin/main || die \
"本地与 origin/main 分叉，无法快进。确认可丢弃本地改动后：
  git -C $APP_DIR reset --hard origin/main
再重跑本命令。"
  else
    log "克隆仓库到 $APP_DIR"
    git clone "$REPO_URL" "$APP_DIR" \
      || die "克隆失败。私有仓库：REPO_URL=https://<token>@github.com/... 重跑；或网络不稳时走 ghproxy 镜像。"
  fi
}

setup_env() {
  local envfile="$APP_DIR/server/.env"
  local pass; pass="$(db_pass)"
  if [ ! -f "$envfile" ]; then
    log "生成 server/.env（基于 .env.example）"
    cp "$APP_DIR/server/.env.example" "$envfile"
  fi
  chmod 600 "$envfile"

  # DATABASE_URL：始终指向本机库（幂等覆盖该行）
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=mysql://${DB_USER}:${pass}@127.0.0.1:3306/${DB_NAME}|" "$envfile"

  # SESSION_SECRET：仅在仍为占位符时生成（64 hex，满足 ≥32 硬校验）
  if grep -q '^SESSION_SECRET=CHANGE_ME' "$envfile"; then
    sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" "$envfile"
    log "已生成 SESSION_SECRET"
  fi

  # 提醒仍是占位符的关键项（不自动填，需要你的密钥）。
  # 用 if 而非 `grep && x=`，避免 set -e 下函数以非零收尾的隐患。
  local missing=""
  if grep -q '^WECHAT_APP_SECRET=CHANGE_ME' "$envfile"; then missing="$missing WECHAT_APP_SECRET"; fi
  if grep -q '^COS_SECRET_ID=CHANGE_ME' "$envfile"; then missing="$missing COS_*"; fi
  if [ -n "$missing" ]; then
    warn "还需手动填写：$missing  → vim $envfile 后执行: sudo bash $0 deploy"
    warn "（不填也能启动：登录/上传接口会返回明确的未配置提示，其余接口正常）"
  fi
}

build_app() {
  log "npm ci + 构建 server"
  cd "$APP_DIR"
  npm ci
  npm run build:server
  # 注意：server/tsconfig.json rootDir="." 且 include 含 tests/**，
  # 产物镜像源码树 → 入口是 dist/src/index.js（与 server/package.json main 一致）
  [ -f "$APP_DIR/server/dist/src/index.js" ] || die "构建产物缺失：server/dist/src/index.js"
}

setup_pm2() {
  cd "$APP_DIR"
  if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
    log "pm2 重启 $PM2_APP"
    pm2 restart "$PM2_APP" --update-env
  else
    log "pm2 首次启动 $PM2_APP"
    # cwd 必须是仓库根：server/src/index.ts 从 cwd 解析 server/.env
    pm2 start server/dist/src/index.js --name "$PM2_APP" --cwd "$APP_DIR"
  fi
  pm2 save
  # 带全参数的 pm2 startup 会直接安装 systemd 单元（裸 `pm2 startup` 才只打印命令）。
  # 失败要给信号：否则重启后进程不拉起、静默丢服务。
  pm2 startup systemd -u root --hp /root >/dev/null 2>&1 \
    || warn "pm2 startup 安装失败（无 systemd？）——重启后需手动 pm2 resurrect"
  pm2 save
}

# --------------------------------------------------------------------------
# nginx：默认 server 反代到 :3000。备案前可用 http://IP/health 冒烟；
# 备案后跑 `ssl <域名>` 由 certbot 补 443 + 跳转。
# --------------------------------------------------------------------------
setup_nginx() {
  log "写入 nginx 反代配置"
  cat > "$NGINX_SITE" <<CONF
server {
    # 不写 default_server：本机只有这一个 site（default 已删），nginx 自动
    # 以首个 server 兜底；同时避免 certbot 改写时出现 duplicate default_server。
    listen 80;
    server_name _;

    client_max_body_size 5m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
CONF
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/xiaomao
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
}

smoke() {
  log "冒烟：GET /health"
  sleep 2
  if curl -fsS --max-time 8 "http://127.0.0.1:${PORT}/health"; then
    echo
    log "✅ 服务已就绪。外网冒烟：curl http://<服务器公网IP>/health"
  else
    warn "健康检查未通过，看日志：pm2 logs $PM2_APP --lines 50"
    exit 1
  fi
}

# --------------------------------------------------------------------------
# 子命令
# --------------------------------------------------------------------------
cmd_setup() {
  need_root setup
  setup_swap
  setup_packages
  setup_node
  setup_mysql
  setup_repo
  setup_env
  build_app
  setup_pm2
  setup_nginx
  smoke
  echo
  log "下一步："
  echo "  1. 腾讯云控制台「防火墙」放行 80（备案后加 443）"
  echo "  2. 填密钥：vim $APP_DIR/server/.env（WECHAT_APP_SECRET / COS_*）→ sudo bash $0 deploy"
  echo "  3. 迁数据：sudo bash $0 import backup.sql"
  echo "  4. 备案通过后：DNS 解析 → sudo bash $0 ssl api.<你的域名>"
}

cmd_deploy() {
  need_root deploy
  setup_repo
  setup_env
  build_app
  setup_pm2
  smoke
}

cmd_import() {
  need_root import
  local file="${1:-}"
  [ -n "$file" ] && [ -f "$file" ] || die "用法：sudo bash $0 import <backup.sql>"
  mysql -e "USE \`${DB_NAME}\`" 2>/dev/null || die "库 ${DB_NAME} 不存在——先执行: sudo bash $0 setup"
  log "导入 $file 到库 ${DB_NAME}"
  mysql "$DB_NAME" < "$file"
  log "导入完成；重启服务触发幂等迁移补齐缺失表/列"
  pm2 restart "$PM2_APP" --update-env
  smoke
}

cmd_ssl() {
  need_root ssl
  local domain="${1:-}"
  [ -n "$domain" ] || die "用法：sudo bash $0 ssl api.example.com（先把 DNS 解析到本机）"
  apt-get install -y certbot python3-certbot-nginx
  # 匹配任意现值而非仅占位符 `_`，保证重跑/换域名时锚点仍在。
  # （证书续期无需重跑本命令：certbot 定时器自动续；重签仅需 certbot --nginx -d 域名）
  sed -i -E "s|server_name [^;]+;|server_name ${domain};|" "$NGINX_SITE"
  nginx -t && systemctl reload nginx
  certbot --nginx -d "$domain" --redirect
  log "✅ HTTPS 就绪。冒烟：curl https://${domain}/health"
  echo
  log "小程序侧收尾（照 docs/migration-to-lighthouse.md）："
  echo "  1. 后台 request 合法域名：https://${domain} + COS 域名；downloadFile：COS 域名"
  echo "  2. runtime.ts 的 apiBaseUrl 填 https://${domain} → 传体验版 → 真机全流程"
  echo "  3. 共享库双跑期间云托管也改连本库（可用 expose-mysql）"
}

cmd_expose_mysql() {
  need_root expose-mysql
  local ip="${1:-}"
  [ -n "$ip" ] || die "用法：sudo bash $0 expose-mysql <云托管固定出口IP>"
  local pass; pass="$(db_pass)"
  log "允许 ${DB_USER}@${ip} 访问 ${DB_NAME}（共享库双跑）"
  sed -i 's/^bind-address.*/bind-address = 0.0.0.0/' /etc/mysql/mysql.conf.d/mysqld.cnf
  mysql <<SQL
CREATE USER IF NOT EXISTS '${DB_USER}'@'${ip}' IDENTIFIED BY '${pass}';
ALTER USER '${DB_USER}'@'${ip}' IDENTIFIED BY '${pass}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'${ip}';
FLUSH PRIVILEGES;
SQL
  systemctl restart mysql
  warn "⚠️ 还需在腾讯云控制台防火墙放行 3306，且【仅对 ${ip}】，不要对全网开放"
  echo
  log "云托管侧环境变量（⚠️ 密码是机密：填完控制台后清一下终端 scrollback）："
  echo "  MYSQL_ADDRESS=<本机公网IP>:3306"
  echo "  MYSQL_USERNAME=${DB_USER}"
  echo "  MYSQL_PASSWORD=${pass}"
  echo "  MYSQL_DATABASE=${DB_NAME}"
  echo
  warn "双跑结束（云托管下线）后回收：控制台防火墙删 3306 规则，并执行："
  echo "  mysql -e \"DROP USER '${DB_USER}'@'${ip}';\" && sed -i 's/^bind-address.*/bind-address = 127.0.0.1/' /etc/mysql/mysql.conf.d/mysqld.cnf && systemctl restart mysql"
}

cmd_status() {
  echo "== pm2 =="; pm2 ls || true
  echo "== health =="; curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/health" && echo || warn "health 不通"
  echo "== mysql =="; mysqladmin ping 2>/dev/null || warn "mysql 不通"
  echo "== nginx =="; nginx -t 2>&1 | tail -1
  echo "== 磁盘/内存 =="; df -h / | tail -1; free -h | sed -n '2p'
}

case "${1:-}" in
  setup)        cmd_setup ;;
  deploy)       cmd_deploy ;;
  import)       shift; cmd_import "$@" ;;
  ssl)          shift; cmd_ssl "$@" ;;
  expose-mysql) shift; cmd_expose_mysql "$@" ;;
  status)       cmd_status ;;
  *)
    sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
