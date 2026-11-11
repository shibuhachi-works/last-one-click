#!/bin/zsh
# Mac の launchd から数分おきに呼ばれる。見張り役(tools/watch.ts)を 1 回動かして終わる。
# 設定はリポジトリ直下の .watch.env(コミットしない)、GitHub のトークンはキーチェーンから読む。
# 手順は docs/auto-draft-mac.md。
set -eu
cd "${0:A:h}/../.."

# launchd は PATH が短いので、Homebrew の node を見えるようにする
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

if [[ ! -f .watch.env ]]; then
  echo "リポジトリ直下に .watch.env がありません(docs/auto-draft-mac.md の 3.)" >&2
  exit 1
fi
# 書いた値を、子のプロセス(npx tsx)にも渡す
set -a
source ./.watch.env
set +a

# private のリポジトリを読むときだけ。キーチェーンに無ければ付けない
if TOKEN="$(security find-generic-password -s last-one-click-watch -w 2>/dev/null)"; then
  export GITHUB_TOKEN="$TOKEN"
fi

exec npx tsx tools/watch.ts
