#!/bin/bash
# build-install.sh -- Tolaria 빌드 후 /Applications에 설치
# 사용법: bash scripts/build-install.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

APP_NAME="Tolaria"
BUNDLE_DIR="src-tauri/target/release/bundle"

# PATH 설정 (Volta, Cargo)
export PATH="$HOME/.cargo/bin:$HOME/.volta/bin:$PATH"

echo "[1/4] 의존성 확인..."
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm이 설치되어 있지 않습니다."
  exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo(Rust)가 설치되어 있지 않습니다."
  exit 1
fi

echo "[2/4] Tauri 릴리스 빌드..."
pnpm tauri build 2>&1

echo "[3/4] 빌드 산출물 확인..."

# macOS: .dmg 또는 .app 탐색
DMG_FILE=$(find "$BUNDLE_DIR" -name "*.dmg" -type f 2>/dev/null | head -1)
APP_FILE=$(find "$BUNDLE_DIR" -name "*.app" -type d 2>/dev/null | head -1)

if [ -n "$DMG_FILE" ]; then
  echo "DMG 발견: $DMG_FILE"
  echo "[4/4] DMG 마운트 후 설치..."

  # 기존 앱 종료 (실행 중이면)
  pkill -x "$APP_NAME" 2>/dev/null || true
  sleep 1

  # DMG 마운트
  MOUNT_POINT=$(hdiutil attach "$DMG_FILE" -nobrowse -noverify 2>/dev/null | grep "/Volumes" | awk '{print $NF}')
  if [ -z "$MOUNT_POINT" ]; then
    # 출력 형식이 다를 수 있음
    MOUNT_POINT="/Volumes/$APP_NAME"
  fi

  MOUNTED_APP="$MOUNT_POINT/${APP_NAME}.app"
  if [ ! -d "$MOUNTED_APP" ]; then
    # Volumes 내 .app 탐색
    MOUNTED_APP=$(find "$MOUNT_POINT" -maxdepth 1 -name "*.app" -type d 2>/dev/null | head -1)
  fi

  if [ -d "$MOUNTED_APP" ]; then
    # 기존 앱 제거 후 복사
    rm -rf "/Applications/${APP_NAME}.app"
    cp -R "$MOUNTED_APP" "/Applications/"
    echo "설치 완료: /Applications/${APP_NAME}.app"
  else
    echo "DMG 내에서 .app을 찾을 수 없습니다. 수동으로 설치하세요: $DMG_FILE"
  fi

  # DMG 언마운트
  hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true

elif [ -n "$APP_FILE" ]; then
  echo ".app 발견: $APP_FILE"
  echo "[4/4] 직접 설치..."

  pkill -x "$APP_NAME" 2>/dev/null || true
  sleep 1

  rm -rf "/Applications/${APP_NAME}.app"
  cp -R "$APP_FILE" "/Applications/"
  echo "설치 완료: /Applications/${APP_NAME}.app"

else
  echo "빌드 산출물을 찾을 수 없습니다."
  echo "번들 디렉터리 내용:"
  find "$BUNDLE_DIR" -type f -name "*.dmg" -o -name "*.app" 2>/dev/null || echo "(없음)"
  exit 1
fi

echo ""
echo "---- 완료 ----"
echo "앱 실행: open /Applications/${APP_NAME}.app"
echo "또는 바로 실행하려면: bash scripts/build-install.sh && open /Applications/${APP_NAME}.app"
