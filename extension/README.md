# Last One Click(Chrome 拡張)

**The last one click is yours.**

Markdown のファイルを選ぶだけで、note の下書き(タイトル・本文・見出し画像・ハッシュタグ・マガジン)を組み立てる拡張です。
**公開ボタンは押しません。** 最後は自分で確認して押してください。

## ストアから入れる

[Chrome ウェブストアで入手](https://chromewebstore.google.com/detail/last-one-click/jomapffkhcdpnodaffobmpfofnnaihnd)(Chrome と Edge などの Chromium 系ブラウザで使えます)。通常はこちらをお使いください。以下は、開発版を手元でビルドして入れる方法です。

## 認証について

この拡張は note の **Cookie・パスワードに一切触れません**。
content script は「あなたが開いている note.com のタブ」の中で動くので、そのタブが既にログイン済みならそのまま使えます。
サーバーも持っていないので、認証情報がどこかに送られることもありません(`manifest.json` に `cookies` 権限がないことで確認できます)。

## インストール(開発版)

```bash
cd extension
npm install
npm run build        # → dist/ ができる
```

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパーモード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」→ `extension/dist/` を選ぶ

## 使い方

1. note.com に普通にログインしておく
2. ツールバーの拡張アイコンをクリック
3. AI が生成した Markdown のファイル(`.md`)を選ぶ。front matter からタイトル・ハッシュタグ・マガジンが読み取られて下に出る
4. 必要なら見出し画像を選ぶ
5. 「note の下書きを作成」を押す
6. note のエディタが新しいタブで開き、タイトル・本文・見出し画像が入ったところで止まり、右下に緑のバナーが出る
7. 本文を確認する(下書き保存・プレビューもここで)。よければバナーの「公開設定を入れる」を押すと、拡張が「公開に進む」を押し、ハッシュタグ・マガジンを入れて止まる
8. 内容を確認して、**自分で「投稿する」を押す**

「本文の確認を飛ばして、公開設定まで進む」にチェックを入れると、6〜7 で止まらずに公開設定まで一気に進みます(チェックは次回も同じ)。
「記事の最後に『Last One Click で下書きしました』のリンクを入れる」は、既定でチェックが入っています。本文の最後に、区切り線と「この記事は、Last One Click で下書きしました。」の 1 行(ストアへのリンク)を入れます。チェックを外すと入れません(チェックは次回も同じ)。下書きに入るので、公開する前に note の画面で確かめられます。Last One Click を使って書かれた記事の中から、note のマガジン「Last One Click で書かれた記事」で、内容を見て紹介することがあります。リンクを入れているかどうかは、紹介の条件にしません。
目次・埋め込み・最後の 1 行のチェックは、「note の下書きを作成」の下の「記事の設定」にたたんであります(見出しの横に、いまオンになっているものが出ます)。

「記事の先頭に目次を入れる」(既定でチェックあり)は、本文を貼る前に note のエディタの「+」→「目次」を押し、本文の先頭に note の目次を入れます(チェックを外すと入れません。チェックは次回も同じ)。目次は本文の見出し(`##`・`###`)から note が作ります。見出しが無い記事には入れず、バナーで知らせます。目次を入れられなかったときは止まらずに先へ進み、バナーで知らせます。そのときは note の画面で、本文の先頭の行で「+」→「目次」を押してください。
「URL だけの行を埋め込みにする」(既定でチェックあり)は、本文を貼ったあと、URL だけが書かれた行の末尾で Enter を押し、note の埋め込み(カード)にします(チェックは次回も同じ)。文の中のリンクはそのままです。1 記事 20 件までで、それを超えた分と、埋め込みにできなかった URL は行のまま残し、バナーで知らせます。そのときは note の画面で、その URL の行の末尾で Enter を押してください。
公開設定を「キャンセル」で閉じると、入れたハッシュタグとマガジンは note 側で消えます。本文を直したあとは、バナーの「もう一度入れる」を押すと入れ直します(ページを再読み込みした場合は、ポップアップからもう一度実行してください)。

### Markdown の形

書き換えて使える見本は [templates/note/](../templates/note/) にあります。

```markdown
---
title: 記事タイトル
hashtags: [AI, 個人開発]
magazine: マガジン名       # 省略可
---

## 本文はここから
```

- `title` が無ければ本文の最初の `# 見出し` を使う
- `hashtags` は `[a, b]` / `a, b` / `#a #b` / YAML のリスト、どれでも可
- md ファイルを読み込むと「note に入れる内容」(タイトル・ハッシュタグ・マガジン)が md ファイルから埋まった状態で出る。直したければそこで直す(送られるのは欄の値)。md ファイルにタイトルが無いときは赤枠になるので入力する
- 本文で使える記法の一覧はリポジトリ直下の `README.md`「本文で使える記法」を参照。表は note 非対応なので、記事を書く側で「表は箇条書きに展開する」と決めておく

### ドラッグ＆ドロップで渡す

md ファイルと見出し画像は、ポップアップにドロップしても渡せます(2 つ同時でも可)。ツールバーのポップアップは Finder などに切り替えた瞬間に閉じるので、ドロップするときは右上の「ウィンドウで開く」で独立したウィンドウにしてから、そこへドロップしてください。

### 見出し画像

front matter の `thumbnail: ./xxx.png` のような相対パスは、手元のファイルからはブラウザが辿れないので使いません。見出し画像はドロップ領域に落とすか「画像を選ぶ」で選んでください(GitHub から読む場合だけ自動で取ります)。

見出し画像は **1280×670px(note の推奨サイズ)** にしておくと、そのまま全体が使われます。それ以外の比率でも note のトリミング画面の初期状態(ズームなし)で保存するので壊れませんが、切り抜き方を変えたいときは note の編集画面で見出し画像を直してください。アップロード後は、トリミング画面に画像が表示されてから「保存」を押し、記事側に画像が表示されるまで待ちます(確認できなければそこで止まり、画面で確かめてからバナーの「公開設定を入れる」で先へ進めます)。

### GitHub から読む場合(上級者向け。普段は隠れている)

「拡張機能の設定」を開いて「上級者向けの設定を表示する」にチェックを入れると、「GitHub から読み込む」と、selectors の URL・GitHub トークンの設定が出て、読み込んだ内容の欄が編集(貼り付け)できるようになります(チェックを外すと隠れる。状態は覚える)。
「GitHub から読み込む」に記事ディレクトリの URL(`.../tree/main/posts/xxx`)を貼ると md ファイルを取得して textarea に入れます。
front matter の `thumbnail: ./thumbnail.png` も同じディレクトリから自動で取ります。private リポジトリは GitHub トークンを入れてください(`Contents: Read` だけで十分)。

## note の画面が変わって動かなくなったら

セレクタは拡張に埋め込まず、起動時に GitHub 上の `selectors/note.json` を読みます(1時間キャッシュ、失敗時は同梱コピー)。

```
note の DOM が変わる
  → リポジトリの selectors/note.json を直して push
  → 全ユーザーの拡張が次回起動時に新しいセレクタを使う(ストア再申請なし)
```

既定ではこのリポジトリの `main` の `selectors/note.json` を読みます。フォークした場合は `src/lib/selectors.ts` の `DEFAULT_SELECTORS_URL` を変えるか、ポップアップの「拡張機能の設定」で URL を指定してください。
リポジトリが private の間は、「拡張機能の設定」(上級者向けを表示した状態)に GitHub トークン(`Contents: Read`)を入れておくと取得できます。入れていなければ同梱コピーにフォールバックします。

セレクタの差し替えで済まない変更(工程が増えた、入力方式が変わった等)は `src/content.ts` の修正と再ビルド・再配布が必要です。
壊れた箇所の調査は、同じ `selectors/note.json` を読む Playwright 版(`../tools/draft.ts`)のほうが楽です。

## ファイル構成

```
manifest.json          # MV3。権限は storage と note.com / raw.githubusercontent.com のみ
build.mjs              # esbuild でバンドル → dist/
package.mjs            # dist/ を ZIP にする(ストアに上げる用)
icons/                 # icon.svg(全サイズ共通の元)と PNG(render.mjs で生成)
store/                 # ストアの掲載文(listing.md)・スクリーンショット・生成スクリプト
src/
  popup.html/css/ts    # 入力 UI。記事を組み立てて chrome.storage に置き、note を開く
  content.ts           # note.com のタブで動く。pending の記事をエディタに入力して止まる
  background.ts        # service worker。content script に自分のタブ ID を教えるだけ(ポップアップが開いたタブでだけ動かすため)
  lib/
    article.ts         # md → ArticlePayload(GitHub 取得・サムネイルの base64 化。front matter などは ../shared/article.ts)
    selectors.ts       # selectors/note.json の読み込み(remote → cache → bundled)
    types.ts           # 型と storage キー
../shared/                  # Playwright 版と共通の純粋ロジック(front matter、URL、安全装置 など)
../selectors/note.json      # note のセレクタ(Playwright 版と共有)
```

## 動かなくなったとき

`selectors/note.json` の値は 2026-10-29 に実機で全工程 ✓ を確認済みです。note の画面が変わって ✗ になったら、

1. 拡張を実行し、右下のバナーで ✗ になった工程を確認する
2. **その note のタブを開いたまま**、ポップアップの「拡張機能の設定」→「診断(動かないとき)」→「DOM 情報を取得」を押す
3. コピーされたレポート(入力欄・ボタン等の一覧と、今の selectors/note.json が何件マッチしたか)を、修正する人に貼って渡す
4. `selectors/note.json` の該当キーを直す → `npm run build` → `chrome://extensions` で再読み込み(または GitHub に push して拡張を再起動)

公開設定画面の要素は、公開設定を開いた状態でもう一度「DOM 情報を取得」すると取れます。
レポートには認証情報や記事本文は含まれません(URL のクエリも除いています)。

## ストアに出すとき

手順は [../docs/store-submission.md](../docs/store-submission.md)、掲載文と審査の回答は [store/listing.md](store/listing.md)。

```bash
npm run package       # → release/last-one-click-<version>.zip(ストアに上げるファイル)
npm run icons         # icons/icon.svg → icon16/32/48/128.png
npm run screenshots   # store/screenshot-1.png(1280x800)と store/promo-small.png(440x280)
```

`icons` と `screenshots` はリポジトリ直下の Playwright(Chromium)で描画するので、先に直下で `npm ci && npx playwright install chromium` を済ませておく(拡張の依存には入れていない)。

- 説明文に「認証情報を扱わない」「公開ボタンは押さない」「非公式ツール」を明記する(listing.md に入っている)
- `host_permissions` は上記3ドメインから増やさない(増やすほど審査が厳しくなる)
- プライバシーポリシーは [../docs/PRIVACY.md](../docs/PRIVACY.md)(ストアには公開 URL が必要)
