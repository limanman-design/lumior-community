#!/bin/bash
set -euo pipefail

lumior_project_root="$(cd "$(dirname "$0")/../.." && pwd)"
lumior_signing_profile="$lumior_project_root/.private/apple-developer/signing.env"
lumior_node="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
lumior_exit_status=0

if [[ -f "$lumior_signing_profile" ]]; then
  source "$lumior_signing_profile"
fi
if [[ ! -x "$lumior_node" ]]; then
  lumior_node="$(command -v node || true)"
fi
if [[ -z "$lumior_node" ]]; then
  printf '%s\n' '未找到状态查询需要的本机运行环境，请返回 Codex 查看构建日志。'
  lumior_exit_status=1
else
  "$lumior_node" "$lumior_project_root/desktop/scripts/check-notarization.mjs" "$@" || lumior_exit_status=$?
fi
if [[ -t 0 ]]; then
  printf '\n'
  read -r -p '按回车关闭窗口。' lumior_done || true
fi
exit "$lumior_exit_status"
