# マージしたら、手元の PC で自動で下書きを作る(見張り役・Debian)

記事のリポジトリに新しい記事をマージすると、手元の PC(Debian のデスクトップ)が 5 分以内に気づいて、note に下書きを作って保存します。
**公開はしません。** 「投稿する」は押しません(押すのは「下書き保存」と、待つモードでの「公開に進む」まで)。確かめて公開するのは、いつも人です(スマホの note からでも公開できます)。

```
記事の PR をマージ(GitHub)
   ↓ 5 分以内に、PC の見張り役(tools/watch.ts)が気づく
PC で `tools/draft.ts --save` が動き、タイトル・本文・見出し画像を入れて「下書き保存」
   ↓ デスクトップの通知「note の下書きを保存しました」
note の「下書き」から開いて確かめ、ハッシュタグ・マガジンを入れて、自分で公開する
```

## 2 つのモード

`.watch.env` の `LOC_WATCH_MODE` で選びます。

| モード | 動き | 公開のしかた |
|---|---|---|
| `save`(既定) | タイトル・本文・見出し画像を入れて「下書き保存」し、窓を閉じる | スマホなどの note で「下書き」を開き、ハッシュタグ・マガジンを入れて、自分で公開する |
| `hold`(待つモード) | 「下書き保存」のあと、「公開に進む」でハッシュタグ・マガジンまで入れて、**窓を開いたまま待つ** | リモートデスクトップで PC の画面につなぎ、確かめて自分で「投稿する」を押し、窓を閉じる(7.) |

どちらも、押すのは「下書き保存」と「公開に進む」までで、「投稿する」は押しません。

## できること・できないこと

- 下書きにするのは、見張るフォルダ(例 `posts/`)の下に**新しく足された** `article.md` だけです。手直し・名前の変更・削除では作りません。同じ記事の下書きを二度は作りません
- `save` では、**ハッシュタグとマガジンは入りません。** note の公開設定の画面は、閉じると入れたものが消えるためです。公開するときに入れてください(`hold` では入ります)
- **本文の画像は、まだ入りません。** 本文の画像とキャプションは、いまは Chrome 拡張だけの機能です。見出し画像は入ります
- 見張り役が使うのは、Playwright 版(専用のブラウザ)です。ふだん使っているブラウザとは別で、note のログイン状態はこのリポジトリの `.profile/` に保存されます(コミットされません)。ログイン状態を、GitHub など PC の外に出すことはありません

## 1. 準備(1 回だけ)

Node.js(22 以上)と git が要ります。Debian の標準の Node.js が古いときは、NodeSource などで 22 以上を入れます。

```bash
sudo apt install git libnotify-bin libsecret-tools
git clone https://github.com/shibuhachi-works/last-one-click.git ~/last-one-click
cd ~/last-one-click
npm ci
npx playwright install --with-deps chromium   # ブラウザと、動かすのに要るライブラリ(sudo を聞かれる)
npm run login      # 開いたブラウザで note にログインして、窓を閉じる
```

`npm run login` は、デスクトップの画面の前で(または画面共有で)行います。SSH だけで入っているときは、窓が手元に出ません。

## 2. 記事のリポジトリが private なら、読み取り専用のトークンを入れる

GitHub の Settings → Developer settings → Fine-grained tokens で、**記事のリポジトリだけ**・**Contents: Read-only** のトークンを作ります。
GNOME のキーリングに入れます(下のコマンドを実行すると、トークンを聞かれるので貼り付けます)。

```bash
secret-tool store --label="Last One Click watch" service last-one-click-watch
```

キーリングが使えないときは、本人だけが読めるファイルに置きます(`watch.sh` は、権限が 600 でなければ止まります)。

```bash
mkdir -p ~/.config/last-one-click
install -m 600 /dev/null ~/.config/last-one-click/github-token
nano ~/.config/last-one-click/github-token    # トークンを貼って保存
```

public のリポジトリなら、この手順はいりません。

## 3. 見張る場所を `.watch.env` に書く

リポジトリ直下に `.watch.env` を作ります(コミットされません)。

```bash
LOC_WATCH_REPO=あなた/記事のリポジトリ
LOC_WATCH_PREFIX=posts/
LOC_WATCH_BRANCH=main
# 待つモードにするときだけ
# LOC_WATCH_MODE=hold
```

設定を確かめます。`LOC_WATCH_DRY_RUN=1` のときは、選んだ記事を表示するだけで、下書きは作らず、覚えた位置も書き換えません。

```bash
LOC_WATCH_DRY_RUN=1 tools/linux/watch.sh
```

よければ、一度ふつうに動かします。1 回目は、いまの位置を覚えるだけで、過去の記事は下書きにしません。

```bash
tools/linux/watch.sh
```

## 4. 5 分おきに動かす(systemd のユーザータイマー)

```bash
mkdir -p ~/.config/systemd/user
cp tools/linux/last-one-click-watch.service tools/linux/last-one-click-watch.timer ~/.config/systemd/user/
# リポジトリを ~/last-one-click 以外に置いたときは、.service の ExecStart を書き換える
systemctl --user daemon-reload
systemctl --user enable --now last-one-click-watch.timer
```

デスクトップにログインしている間だけ動きます(ブラウザの窓を画面に出すため)。止めるときは `systemctl --user disable --now last-one-click-watch.timer`。

## 5. PC の設定

- **スリープしない**: 設定 →「電源」で「自動サスペンド」をオフにする。スリープ中は動かず、起きたときにまとめて処理します
- **自動ログイン**: 再起動したあとも見張り役が動くように、設定 →「ユーザー」で自動ログインをオンにする(GDM の場合)。画面のロックはかかっていても動きます

## 6. 外から(SSH で)見る・動かす

SSH で入った端末から直接 `npm run draft` を動かすと、ブラウザの窓が画面に出ないことがあります。systemd に「いますぐ動かして」と頼みます(デスクトップにログインしている状態で)。

```bash
systemctl --user start last-one-click-watch.service      # いますぐ 1 回動かす
journalctl --user -u last-one-click-watch -n 50           # ログを見る
systemctl --user list-timers last-one-click-watch.timer   # 次にいつ動くか
```

SSH や画面共有の入り口を、インターネットにそのまま開けないでください。外から入るときは、Tailscale などの自分専用のネットワークを使います。

## 7. 待つモード(hold)で、リモートから公開する

1. 設定 →「システム」→「リモートデスクトップ」で「デスクトップ共有」と「リモートコントロール」をオンにし、接続用のユーザー名とパスワードを決める(GNOME の場合。RDP で接続できるようになる)
2. PC と手元の端末の両方に Tailscale などを入れて、自分専用のネットワークでつなぐ。RDP の入り口(3389 番)をインターネットにそのまま開けない
3. 手元の端末から接続する(iPhone・iPad・Mac・Windows は Microsoft の「Windows App」、Linux は Remmina)。接続先は Tailscale の PC の名前か IP
4. 通知「公開の手前で待っています」が出たら接続し、本文と公開設定を確かめて、自分で「投稿する」を押す。終わったら、その窓を閉じる
5. 窓を閉じると、見張り役は次の記事に進む(2 本以上あるときは、1 本ずつ開く)

- 待っている間に時間の上限はありません。窓を閉じるまで、次の見張りは始まりません
- 公開せずに窓を閉じても構いません。下書きは保存済みなので、あとで note から公開できます(このときハッシュタグ・マガジンは消えます)
- 画面がロックされていると、接続したときにロック画面が出ます。パスワードを入れて解除してください

## 困ったとき

| 通知・ログ | すること |
|---|---|
| note にログインしていません | デスクトップで `npm run login` をやり直す。次の回で、その記事から続きます |
| 下書きを作れませんでした | `journalctl --user -u last-one-click-watch` を見る。note の画面が変わったときは `selectors/note.json` を直す。直れば、次の回でその記事からやり直します |
| ブラウザが起動しない(画面が無い) | `systemctl --user show-environment` に `DISPLAY` か `WAYLAND_DISPLAY` があるか見る。無ければ、デスクトップの端末で `systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XAUTHORITY` を実行する |
| タイマーが動かない | `systemctl --user status graphical-session.target` が active か見る。デスクトップによっては active にならないので、そのときは `.timer` の `WantedBy=` を `default.target` に変えて、enable し直す |
| 変更されたファイルが多すぎて… | 一度に 300 ファイル以上が変わったとき。`.watch-state.json` の `lastSha` を、記事のリポジトリの main の先頭に書き換えてやり直す(その間に足された記事は、手で下書きにする) |
| note に弾かれる(ロボットと判断される) | `.watch.env` に `PIGEON_BROWSER_CHANNEL=chrome` を足して、PC に入っている Google Chrome で動かす |
