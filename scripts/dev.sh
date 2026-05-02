#!/bin/bash
# dev.sh -- Tolaria 개발 모드 실행
# 사용법: bash scripts/dev.sh [포트번호]
# 기본 포트: 5202 (tauri.conf.json devUrl과 동일)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

PORT="${1:-5202}"

echo "[1/2] 의존성 확인..."
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm이 설치되어 있지 않습니다."
  exit 1
fi

# 이미 해당 포트를 사용 중인 프로세스가 있으면 안내
if lsof -i :"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "포트 $PORT 가 이미 사용 중입니다."
  echo "기존 프로세스를 종료하거나 다른 포트를 지정하세요: bash scripts/dev.sh 5203"
  exit 1
fi

echo "[2/2] Tauri 개발 모드 시작 (포트: $PORT)..."
echo "종료하려면 Ctrl+C"
echo ""

TAURI_DEV_PORT="$PORT" pnpm tauri dev
