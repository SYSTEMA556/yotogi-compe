#!/usr/bin/env bash
# Codespaces / Mac / Linux 用の起動スクリプト：bash run.sh
set -e
cd "$(dirname "$0")/web"
npm install
npm run build
cd ../server
export ADMIN_TOKEN="${ADMIN_TOKEN:-dev-admin}"
export HASH_SECRET="${HASH_SECRET:-dev-secret}"
echo "管理画面のトークン: $ADMIN_TOKEN（止めるときは Ctrl+C）"
go run . -demo
