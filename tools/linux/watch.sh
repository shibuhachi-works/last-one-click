#!/usr/bin/env bash
# systemd のユーザータイマーから数分おきに呼ばれる。見張り役(tools/watch.ts)を 1 回動かして終わる。
# 設定はリポジトリ直下の .watch.env(コミットしない)。GitHub のトークンは、
# GNOME のキーリング(secret-tool)か ~/.config/last-one-click/github-token(権限 600)から読む。
# 手順は docs/auto-draft-linux.md。
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/../.."

if [[ ! -f .watch.env ]]; then
  echo "リポジトリ直下に .watch.env がありません(docs/auto-draft-linux.md の 3.)" >&2
  exit 1
fi
# 書いた値を、子のプロセス(npx tsx)にも渡す
set -a
source ./.watch.env
set +a

# private のリポジトリを読むときだけ。どちらにも無ければ付けない
TOKEN_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/last-one-click/github-token"
if command -v secret-tool >/dev/null && TOKEN="$(secret-tool lookup service last-one-click-watch 2>/dev/null)" && [[ -n "$TOKEN" ]]; then
  export GITHUB_TOKEN="$TOKEN"
elif [[ -f "$TOKEN_FILE" ]]; then
  if [[ "$(stat -c %a "$TOKEN_FILE")" != "600" ]]; then
    echo "$TOKEN_FILE は本人だけが読める権限(chmod 600)にしてください" >&2
    exit 1
  fi
  GITHUB_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
  export GITHUB_TOKEN
fi

# ブラウザの窓を出す画面。SSH から動かしたときなど、画面の情報が無いときだけ、デスクトップの :0 にする。
# GNOME(Wayland)では、Xwayland の認証ファイルも要るので、見つかれば付ける
if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  export DISPLAY=:0
fi
if [[ -z "${XAUTHORITY:-}" ]]; then
  for f in "/run/user/$(id -u)"/.mutter-Xwaylandauth.*; do
    if [[ -f "$f" ]]; then
      export XAUTHORITY="$f"
      break
    fi
  done
fi

exec npx tsx tools/watch.ts
