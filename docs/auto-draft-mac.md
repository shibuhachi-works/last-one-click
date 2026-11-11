# マージしたら、Mac で自動で下書きを作る(見張り役)

記事のリポジトリに新しい記事をマージすると、手元の Mac が数分以内に気づいて、note に下書きを作って保存します。
**公開はしません。** 押すのは「下書き保存」だけです。確かめて公開するのは、いつも人です(スマホの note からでも公開できます)。

```
記事の PR をマージ(GitHub)
   ↓ 5 分以内に、Mac の見張り役(tools/watch.ts)が気づく
Mac で `tools/draft.ts --save` が動き、タイトル・本文・見出し画像を入れて「下書き保存」
   ↓ Mac の通知「note の下書きを保存しました」
note の「下書き」から開いて確かめ、ハッシュタグ・マガジンを入れて、自分で公開する
```

## できること・できないこと

- 下書きにするのは、見張るフォルダ(例 `posts/`)の下に**新しく足された** `article.md` だけです。手直し・名前の変更・削除では作りません。同じ記事の下書きを二度は作りません
- **ハッシュタグとマガジンは入りません。** note の公開設定の画面は、閉じると入れたものが消えるためです。公開するときに入れてください
- **本文の画像は、まだ入りません。** 本文の画像とキャプションは、いまは Chrome 拡張だけの機能です。見出し画像は入ります
- 見張り役が使うのは、Playwright 版(専用のブラウザ)です。ふだん使っている Chrome とは別で、note のログイン状態はこのリポジトリの `.profile/` に保存されます(コミットされません)。ログイン状態を、GitHub など Mac の外に出すことはありません

## 1. 準備(Mac で 1 回だけ)

Node.js(22 以上)と git が要ります。Homebrew なら `brew install node git`。

```bash
git clone https://github.com/shibuhachi-works/last-one-click.git ~/last-one-click
cd ~/last-one-click
npm ci
npx playwright install chromium
npm run login      # 開いたブラウザで note にログインして、窓を閉じる
```

## 2. 記事のリポジトリが private なら、読み取り専用のトークンをキーチェーンに入れる

GitHub の Settings → Developer settings → Fine-grained tokens で、**記事のリポジトリだけ**・**Contents: Read-only** のトークンを作ります。
ファイルには書かず、Mac のキーチェーンに入れます(下のコマンドを実行すると、トークンを聞かれるので貼り付けます)。

```bash
security add-generic-password -a "$USER" -s last-one-click-watch -w
```

public のリポジトリなら、この手順はいりません。

## 3. 見張る場所を `.watch.env` に書く

リポジトリ直下に `.watch.env` を作ります(コミットされません)。

```bash
LOC_WATCH_REPO=あなた/記事のリポジトリ
LOC_WATCH_PREFIX=posts/
LOC_WATCH_BRANCH=main
```

一度、手で動かして確かめます。1 回目は、いまの位置を覚えるだけで、過去の記事は下書きにしません。

```bash
tools/mac/watch.sh
```

`LOC_WATCH_DRY_RUN=1` を付けると、選んだ記事を表示するだけで、下書きは作りません(設定の確認用)。

## 4. 5 分おきに動かす(launchd)

`tools/mac/last-one-click.watch.plist.example` の `/Users/YOU/last-one-click` を書き換えて、次の場所に保存します。

```bash
cp tools/mac/last-one-click.watch.plist.example ~/Library/LaunchAgents/local.last-one-click.watch.plist
# ファイルの中の /Users/YOU/last-one-click を書き換えてから
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.last-one-click.watch.plist
```

止めるときは `launchctl bootout gui/$(id -u)/local.last-one-click.watch`。

## 5. Mac の設定

- **スリープしない**: システム設定 →「ディスプレイ」または「省エネルギー」で、ディスプレイがオフのときにスリープしないようにする。スリープ中は動かず、起きたときにまとめて処理します
- **自動ログイン**: 再起動したあとも見張り役が動くように、システム設定 →「ユーザとグループ」で自動ログインを有効にする。画面のロックはかかっていても動きます

## 6. 外から(SSH で)見る・動かす

SSH で入った端末から直接 `npm run draft` を動かすと、ブラウザの窓が画面に出ません。launchd に「いますぐ動かして」と頼みます。

```bash
launchctl kickstart -k gui/$(id -u)/local.last-one-click.watch   # いますぐ 1 回動かす
tail -n 50 ~/last-one-click/.watch.log                            # ログを見る
```

SSH や画面共有の入り口を、インターネットにそのまま開けないでください。外から入るときは、Tailscale などの自分専用のネットワークを使います。

## 困ったとき

| 通知・ログ | すること |
|---|---|
| note にログインしていません | Mac で `npm run login` をやり直す。次の回で、その記事から続きます |
| 下書きを作れませんでした | `.watch.log` を見る。note の画面が変わったときは `selectors/note.json` を直す。直れば、次の回でその記事からやり直します |
| 変更されたファイルが多すぎて… | 一度に 300 ファイル以上が変わったとき。`.watch-state.json` の `lastSha` を、記事のリポジトリの main の先頭に書き換えてやり直す(その間に足された記事は、手で下書きにする) |
| note に弾かれる(ロボットと判断される) | `.watch.env` に `PIGEON_BROWSER_CHANNEL=chrome` を足して、Mac に入っている Chrome で動かす |
