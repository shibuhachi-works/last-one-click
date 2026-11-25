# Playwright 版(自分用・開発用)

Chrome 拡張「Last One Click」と同じ `selectors/note.json`(note の画面のセレクタ)を使う、Playwright で動かす版です。
自分用・開発用で、note の画面が変わって壊れた箇所を、Playwright Inspector で調べられます。
ふだん使うのは Chrome 拡張です([../README.md](../README.md))。

**人間がやるのは2つだけ**:記事ディレクトリの URL を渡すことと、最後に公開ボタンを押すこと。

```
記事の md ファイル + サムネイル を git に push
        ↓
npm run draft -- <記事ディレクトリの GitHub URL>
        ↓
Chrome が開き、タイトル・本文・サムネイル・ハッシュタグ・マガジンが入力された状態で停止
        ↓
内容を確認して、自分で「公開に進む」→「投稿する」を押す
```

公開ボタンは**設計上、スクリプトからは絶対に押しません**。note には公式の投稿 API がなく、
完全自動公開は利用規約・アカウント凍結のリスクがあるためです。

## セットアップ(初回のみ)

```bash
npm install
npx playwright install chromium
npm run login     # 開いた Chrome で note にログイン → ターミナルで Enter
```

ログイン状態は `.profile/` に保存されます(`.gitignore` 済み。Cookie を含むので絶対にコミットしない)。

Playwright 版は自動操作の検知を外す指定を入れていません。Chromium で note の画面がうまく開けない場合は、`PIGEON_BROWSER_CHANNEL=chrome` を付けて実 Chrome で起動するか、Chrome 拡張版を使ってください。

private リポジトリの記事を扱う場合は `.env.example` を `.env` にコピーして `GITHUB_TOKEN` を設定してください。

## 使い方

```bash
# 1. まず md ファイルが正しく読めるかだけ確認(ブラウザは開かない)
npm run preview -- https://github.com/you/last-one-click/tree/main/posts/2026-10-28-xxx
#    → .preview/index.html を開いて見た目をチェック

# 2. note の下書きを組み立てる
npm run draft -- https://github.com/you/last-one-click/tree/main/posts/2026-10-28-xxx
```

URL は `tree/`(ディレクトリ)でも `blob/.../article.md`(ファイル)でも raw URL でも構いません。

## note の画面が変わって動かなくなったら

note の DOM は予告なく変わります。**これは前提**なので、壊れたときの直し方を書いておきます。

1. `npm run draft` を実行すると、失敗したステップで Playwright Inspector が開いて止まる
2. Inspector の「Pick locator」で、本来操作したかった要素をクリックする
3. 表示されたセレクタをリポジトリ直下の `selectors/note.json` の該当キーに貼る
4. もう一度 `npm run draft`

セレクタはすべて `selectors/note.json` に集約してあり、Chrome 拡張も同じファイルを読みます。
値は 2026-10-29 に実機で全工程 ✓ を確認済みです。note の画面が変わって ✗ になったら、この手順で合わせ直してください。

## ファイル構成

```
tools/
  draft.ts          # メイン。取得 → 入力 → 公開手前で停止
  preview.ts        # ブラウザなしで md のパース結果を確認
  login.ts          # 初回ログイン用
  lib/
    article.ts      # GitHub から取得してサムネイルを Buffer で持つ(残りは shared/article.ts)
    browser.ts      # 永続プロファイルで Chromium 起動
    selectors.ts    # selectors/note.json を読んで Playwright 用セレクタに変換
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
