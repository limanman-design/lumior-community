#!/bin/bash
set -euo pipefail

lumior_project_root="$(cd "$(dirname "$0")/../.." && pwd)"
lumior_signing_profile="$lumior_project_root/.private/apple-developer/signing.env"
if [[ ! -f "$lumior_signing_profile" ]]; then
  printf '%s\n' '尚未找到本机 Lumior 签名配置。请先配置 Developer ID 证书。'
  exit 1
fi
source "$lumior_signing_profile"
if [[ ! "${LUMIOR_SIGNING_TEAM_ID:-}" =~ ^[A-Z0-9]{10}$ ]]; then
  printf '%s\n' '本机签名配置中的 Apple 团队编号无效。'
  exit 1
fi
lumior_notary_profile="${APPLE_KEYCHAIN_PROFILE:-Lumior-Notary}"
printf '%s\n' '配置 Lumior 的 Apple 公证凭据。' \
  '使用同一开发者 Apple 账户的应用专用密码；不要输入 Apple 账户的登录密码。' \
  '凭据由 Apple 官方工具验证并保存在本机登录钥匙串，不写入工程或聊天。'
read -r -p '开发者 Apple 账户邮箱：' lumior_apple_id
if [[ -z "$lumior_apple_id" ]]; then
  printf '%s\n' '未输入账户，配置已取消。'
  exit 1
fi
/usr/bin/xcrun notarytool store-credentials "$lumior_notary_profile" \
  --apple-id "$lumior_apple_id" \
  --team-id "$LUMIOR_SIGNING_TEAM_ID" \
  --keychain "$HOME/Library/Keychains/login.keychain-db" \
  --validate
unset lumior_apple_id
if [[ -z "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
  printf '\nexport APPLE_KEYCHAIN_PROFILE=%q\n' "$lumior_notary_profile" >> "$lumior_signing_profile"
fi
/bin/chmod 600 "$lumior_signing_profile"
printf '\n%s\n' 'Apple 已验证并保存公证凭据。请返回 Codex 告知配置完成，不要发送密码。'
read -r -p '按回车关闭窗口。' lumior_done
