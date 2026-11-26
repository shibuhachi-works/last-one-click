# Playwright 版(自分用・開発用)

コマンドから note の下書きを作る版です。ビルドした Chrome 拡張「Last One Click」(`extension/dist`)を読み込んだブラウザを Playwright で開き、拡張のポップアップに記事の URL を渡して、下書きを作るボタンを押します。note の画面に入れるのは拡張なので、**拡張に足した機能は、そのままこちらでも使えます**(目次・本文の画像・埋め込み・PR の URL からの読み込みなど。#178)。
見張り役(マージされた記事を、手元の PC で自動で下書きにする。[auto-draft-linux.md](auto-draft-linux.md))も、これを使います。
ふだん使うのは Chrome 拡張です([../README.md](../README.md))。

**人間がやるのは2つだけ**:記事ディレクトリの URL を渡すことと、最後に公開ボタンを押すこと。

```
記事の md ファイル + サムネイル を git に push
        ↓
npm run draft -- <記事ディレクトリの GitHub URL>
        ↓
拡張を読み込んだ Chromium が開き、拡張がタイトル・本文・見出し画像・ハッシュタグ・マガジンを入れた状態で停止
        ↓
内容を確認して、自分で「公開に進む」→「投稿する」を押す
```

公開ボタンは**設計上、スクリプトからは絶対に押しません**。note には公式の投稿 API がなく、
完全自動公開は利用規約・アカウント凍結のリスクがあるためです。

## セットアップ(初回のみ)

```bash
npm install
(cd extension && npm ci)   # 拡張のビルドに使う(npm run draft が毎回ビルドする)
npx playwright install chromium
npm run login     # 開いた Chromium で note にログイン → ターミナルで Enter
```

ログイン状態は `.profile/` に保存されます(`.gitignore` 済み。Cookie を含むので絶対にコミットしない)。

Playwright 版は自動操作の検知を外す指定を入れていません。拡張を読み込むため、ブラウザは Playwright の Chromium だけです(Google Chrome はコマンドから拡張を読み込めないので、`PIGEON_BROWSER_CHANNEL=chrome` は使えなくなりました)。Chromium で note の画面がうまく開けない場合は、Chrome 拡張版を使ってください。

private リポジトリの記事を扱う場合は `.env.example` を `.env` にコピーして `GITHUB_TOKEN` を設定してください。

## 使い方

```bash
# 1. まず md ファイルが正しく読めるかだけ確認(ブラウザは開かない)
npm run preview -- https://github.com/you/last-one-click/tree/main/posts/2026-10-28-xxx
#    → .preview/index.html を開いて見た目をチェック

# 2. note の下書きを組み立てる
npm run draft -- https://github.com/you/last-one-click/tree/main/posts/2026-10-28-xxx
```

URL は `tree/`(ディレクトリ)でも `blob/.../article.md`(ファイル)でも raw URL でも、PR の URL(`.../pull/123`)でも構いません(拡張の「GitHub から読み込む」と同じ。記事が 2 本以上ある PR は、記事のフォルダの URL を渡してください)。

- 引数なし: 公開設定(ハッシュタグ・マガジン・有料と価格・有料ライン)まで入れて止まります。ブラウザで確かめて「投稿する」を自分で押し、ブラウザを閉じると終わります
- `--save`・`--hold`: 見張り役が使います([auto-draft-linux.md](auto-draft-linux.md))
- 拡張の設定(目次など)は、`.profile/` の中の拡張の設定を使います。ただし、上級者向けの表示・「本文の確認を飛ばして、公開設定まで進む」・GitHub トークンは、実行のあいだだけ変えて、終わったら戻します
- 最後のクレジット(「Last One Click で下書きしました」のリンクと `#LastOneClick`)は、`LOC_CREDIT_LINK=1` を付けたときだけ入れます(今までの Playwright 版は入れていなかったため)
- セレクタは、手元の `selectors/note.json` を使います(拡張が GitHub から読みに行くところを、手元のファイルに差し替えます。直して試すときに push しなくてよい)

## note の画面が変わって動かなくなったら

note の DOM は予告なく変わります。**これは前提**なので、壊れたときの直し方を書いておきます。

1. `npm run draft` を実行し、拡張のバナー(ターミナルにも同じ文が出る)で ✗ になった工程を確かめる
2. **その note のタブを開いたまま**、同じブラウザで拡張のポップアップ(`chrome-extension://<拡張の ID>/popup.html`)を開き、「拡張機能の設定」→「診断(動かないとき)」→「DOM 情報を取得」を押す。結果の一覧から、本来操作したかった要素を探す
3. `selectors/note.json` の該当キーを直す
4. もう一度 `npm run draft`(手元の `selectors/note.json` を使うので、push しなくても効く)

拡張の工程そのものを直すときは `extension/src/content.ts`(中身は `extension/src/lib/content/`)を直します。`npm run draft` は毎回拡張をビルドし直すので、そのまま試せます。

セレクタはすべて `selectors/note.json` に集約してあり、Chrome 拡張も同じファイルを読みます。
値は 2026-10-29 に実機で全工程 ✓ を確認済みです。note の画面が変わって ✗ になったら、この手順で合わせ直してください。

## ファイル構成

```
tools/
  draft.ts          # メイン。拡張をビルド → 拡張を読み込んだブラウザで記事を読み込み、下書きを作るボタンを押す → 公開手前で停止
  preview.ts        # ブラウザなしで md のパース結果を確認
  login.ts          # 初回ログイン用
  lib/
    article.ts      # GitHub から取得してサムネイルを Buffer で持つ(preview.ts が使う。残りは shared/article.ts)
    browser.ts      # 永続プロファイルで Chromium 起動
    extension.ts    # 拡張のビルド・拡張を読み込んだ Chromium の起動・ポップアップの操作・バナーの待ち受け
    selectors.ts    # selectors/note.json のうち、Playwright 版が自分で見るもの(ログインの画面・タイトル欄)
shared/             # 拡張と Playwright 版で共通の純粋ロジック(テストもここ)
  article.ts        # GitHub URL の正規化・front matter・タイトルの決定・md→HTML
  markdown-safe.ts  # 生の HTML を通さない(HTML コメントは取り除く)renderer と、DOM を使わない text/plain 化
  github-url.ts     # トークンを付けてよい送り先の判定
  forbidden-click.ts  # 「投稿する」「公開する」を押さない安全装置
  selectors-schema.ts # selectors/note.json の検査
  text-match.ts     # ボタン文言の完全一致
selectors/note.json      # note の DOM セレクタ(拡張と共有。壊れたらここだけ直す)
extension/          # Chrome 拡張版
templates/note/     # md の見本と見出し画像の見本
```

## 今後の拡張候補

- **サムネイル自動生成**:md の push をトリガーに GitHub Actions で画像生成 API を叩いて commit すれば、人間は md ファイルを push するだけになる
- **壊れ検知**:GitHub Actions で週1回、見本の記事(templates/note)に対して Playwright 版を公開設定画面まで走らせる(公開はしない)。note が変わった翌週には気づける
- **ダブルクリック起動**:ターミナルを開きたくない場合は、URL をダイアログで聞く `.command` / `.bat` を作って `npm run draft` を呼ぶ
