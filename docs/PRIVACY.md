# プライバシーポリシー / Privacy Policy — Last One Click

最終更新: 2026-10-28

## 日本語

**Last One Click**(以下「本拡張」)は、ユーザーが貼り付けた Markdown の記事を note.com のエディタに下書きとして入力する Chrome 拡張です。

### 収集するデータ

本拡張は、個人情報を含むいかなるデータも収集・送信・販売しません。サーバーを持たず、利用状況の計測(アナリティクス)も行いません。

### 拡張の中で扱うデータ

- **記事の内容**(タイトル・本文・見出し画像・ハッシュタグ・マガジン名): ポップアップから note のタブへ渡すため、Chrome の拡張用ストレージ(`chrome.storage.local`)に一時的に保存します。note.com 以外には送りません。
- **GitHub トークン**(任意): private リポジトリの記事を読むときだけユーザーが設定します。拡張のストレージにのみ保存し、`raw.githubusercontent.com` 以外には送りません。
- **設定**(セレクタ定義の URL など): 拡張のストレージにのみ保存します。

### 認証情報

本拡張は note.com の Cookie・パスワード・セッションに一切アクセスしません(`cookies` 権限を持ちません)。ユーザーがログイン済みの note のタブの中で動くだけです。

### 外部との通信

- `note.com` / `editor.note.com`: ユーザーのタブ内で下書きを入力するため(content script)
- `raw.githubusercontent.com`: ユーザーが指定した Markdown・画像と、note の画面構成に追従するためのセレクタ定義(JSON)を読むため

### 公開ボタン

本拡張は、投稿・公開ボタンを押しません。公開はユーザー自身の操作で行います。

### 変更

このポリシーを変更する場合は、このページを更新します。

### 連絡先

https://shibuhachi.works/about/ のお問い合わせ先、または Chrome ウェブストアの掲載ページに表示される開発者の連絡先

## English

**Last One Click** is a Chrome extension that fills a note.com draft (title, body, header image, hashtags, magazine) from Markdown you paste.

- **No data collection.** The extension does not collect, transmit, or sell any data, has no server, and runs no analytics.
- **Data handled locally.** The article you paste is stored temporarily in `chrome.storage.local` to hand it from the popup to the note.com tab, and is sent nowhere except note.com. An optional GitHub token (for private repositories) is stored only in the extension's storage and sent only to `raw.githubusercontent.com`.
- **No credentials.** The extension never accesses note.com cookies, passwords, or sessions (it has no `cookies` permission). It works inside the note.com tab you are already logged into.
- **Network.** `note.com` / `editor.note.com` (filling the draft in your tab) and `raw.githubusercontent.com` (reading the Markdown/images you point to, and a selector definition JSON).
- **It never clicks Publish.** Publishing is always your own click.

Contact: https://shibuhachi.works/about/ or the developer contact shown on the Chrome Web Store listing.
