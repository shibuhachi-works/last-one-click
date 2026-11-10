# Last One Click(ラストワンクリック)

**The last one click is yours.** — 下書きまでは拡張が組み立てる。最後のワンクリックは、あなたの手で。

**AI で書いた投稿を、そのまま各 SNS の投稿画面に届けるツール群です。** 整形・画像・タグまで入力して止まります。
**投稿・公開ボタンは絶対に押しません。** 内容を確認して最後の1クリックをするのは、いつも人間です。

**入れ方**:[Chrome ウェブストアで入手](https://chromewebstore.google.com/detail/last-one-click/jomapffkhcdpnodaffobmpfofnnaihnd)(Chrome と Edge などの Chromium 系ブラウザで使えます)。通常はストアから入れてください。ZIP から手で入れる方法は [extension/README.md](extension/README.md) にあります。

対象は「AI を使って投稿する人」。入力は AI の出力そのもの(Markdown)で、人が手で整形する前提にしません。
現在対応している媒体は **note** です(説明文のとおり、現在は note に対応しています)。X / TikTok / Instagram も同じ方針(下書きまで作り、投稿は本人のクリック)で順次追加します。
現状と今後の計画は [docs/ROADMAP.md](docs/ROADMAP.md) にまとめています。

| | 用途 | 入口 |
|---|---|---|
| **[extension/](extension/)** Chrome 拡張「Last One Click」 | 配布用。普段の Chrome で動き、認証情報に触れない | md ファイル(貼り付け・GitHub URL は上級者向け) |
| **tools/** Playwright 版 | 自分用・開発用。壊れた箇所を Inspector で調べられる | GitHub URL |

どちらも `selectors/note.json`(note の DOM セレクタ)を共有しています。以下は Playwright 版の説明です。拡張は [extension/README.md](extension/README.md) を見てください。

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

## 記事の書き方

`posts/<日付-スラッグ>/` に `article.md` と 見出し画像を置きます。

md の見本(書き換えて使う型と説明)は [templates/note/](templates/note/) にあります。拡張でできることを全部入れてあるので、そのまま読み込んで試すこともできます(Chrome 拡張版・Playwright 版のどちらでも)。

```markdown
---
title: 記事タイトル
hashtags: [AI, 個人開発]
magazine: マガジン名       # 省略可
thumbnail: ./thumbnail.png  # 省略可(1280x670 推奨)
---

## 本文はここから
```

| front matter | 必須 | 備考 |
|---|---|---|
| `title` | △ | 無ければ本文の最初の `# 見出し` を使う |
| `hashtags` | - | 配列 or カンマ区切り。`#` は付けても付けなくてもよい |
| `magazine` | - | note 上のマガジン名と完全一致させる |
| `thumbnail` | - | md ファイルからの相対パス |

### 本文で使える記法

Markdown(GFM)を note のエディタが受け付ける形に変換して貼ります。実機で確認したのは「確認済み」の印のあるものです。

| 記法 | 書き方 | note での扱い |
|---|---|---|
| 見出し(確認済み) | `## ` / `### ` | 大見出し / 小見出し。本文の最初の `# ` はタイトルに使う(front matter に `title` が無いとき) |
| 段落・改行(確認済み) | 空行 / 行末の改行 | 空行で段落。行末の改行もそのまま改行(`breaks: true`) |
| 太字(確認済み) | `**太字**` | 太字。日本語のかぎかっこや句読点を含む形(`**「…」**`)も太字になる |
| 取り消し線 | `~~文字~~` | 取り消し線 |
| 箇条書き・番号リスト(確認済み) | `- ` / `1. ` | リスト |
| 引用(確認済み) | `> ` | 引用 |
| 区切り線(確認済み) | `---` | 区切り線 |
| コード(確認済み) | ```` ``` ```` / `` `code` `` | コードブロック / インラインコード |
| リンク(確認済み) | `[文字](https://…)` | リンク。http(s) と mailto 以外は文字だけ残す |
| 画像(本文中) | `![説明](https://…)` | URL 指定のみ。手元のファイルは見出し画像としてだけ渡せる |
| 表 | `\| a \| b \|` | **入らない**(note 非対応)。記事を書く側で「表は箇条書きに展開する」と決めておく |
| 斜体 | `*文字*` | note に斜体が無いため文字だけ残る |
| 生の HTML | `<img …>` など | 文字としてそのまま表示(安全のため実行しない) |
| 脚注・チェックボックス | `[^1]` / `- [ ]` | 文字として残る |

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
  markdown-safe.ts  # 生の HTML を通さない renderer と、DOM を使わない text/plain 化
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

## ライセンス

[MIT License](LICENSE)
