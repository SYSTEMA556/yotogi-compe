#!/usr/bin/env bash
# Linux / Mac / Codespaces 用：ビルドしてデモデータ付きで起動
set -e
cd "$(dirname "$0")/web"
npm install
npm run build
cd ../server
export ADMIN_TOKEN="${ADMIN_TOKEN:-dev-admin}"
export HASH_SECRET="${HASH_SECRET:-dev-secret}"
echo ""
echo "起動します（管理画面のトークン: $ADMIN_TOKEN／止めるときは Ctrl+C）"
go run . -demo
