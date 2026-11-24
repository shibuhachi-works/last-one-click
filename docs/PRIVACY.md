# プライバシーポリシー / Privacy Policy — Last One Click

最終更新: 2026-11-23

## 日本語

**Last One Click**(以下「本拡張」)は、ユーザーが貼り付けた Markdown の記事を note.com のエディタに下書きとして入力する Chrome 拡張です。

### 収集するデータ

本拡張は、個人情報を含むいかなるデータも収集・送信・販売しません。サーバーを持たず、利用状況の計測(アナリティクス)も行いません。

### 拡張の中で扱うデータ

- **記事の内容**(タイトル・本文・見出し画像・本文の画像・ハッシュタグ・マガジン名): ポップアップから note のタブへ渡すため、Chrome の拡張用ストレージ(`chrome.storage.local`)に一時的に保存します。note.com 以外には送りません。
- **GitHub トークン**(任意): private リポジトリの記事を読むときだけユーザーが設定します。拡張のストレージにのみ保存し、`raw.githubusercontent.com` 以外には送りません。
- **設定**(セレクタ定義の URL など): 拡張のストレージにのみ保存します。
- **ログイン中の note アカウントの名前・ID・アイコンの画像の URL**: 違うアカウントで投稿しないよう、拡張のウィンドウと note の編集画面のバナーに出すためだけに読みます。画面に出すだけで、保存しません(拡張のストレージにも入れません)。note.com 以外には送りません。アイコンは、note の応答にある画像の URL をそのまま表示します。

### 認証情報

本拡張は note.com の Cookie を読みません(`cookies` 権限を持ちません)。パスワードにも触れません。ユーザーがログイン済みの note のタブの中で動くだけです。

ただし、ログイン中のアカウントの名前とアイコンを表示するため、ユーザーの note のタブの中から note.com に、ログイン中のユーザーの情報を返す問い合わせ(GET。書き込みはしません)を 1 回行います。拡張のウィンドウを開いたときに note のタブが無ければ(またはタブから返事が無ければ)、拡張(バックグラウンド)から note.com に同じ問い合わせを 1 回行います。このとき、ログインの状態(Cookie)はブラウザが note.com に付けて送るだけで、本拡張はその中身を読みません。結果は画面に出すだけで、保存も、note.com 以外への送信もしません。問い合わせるのは、拡張のウィンドウを開いたとき・下書きを入れ終えたとき・公開設定を入れたあと・診断のときだけです。定期的には問い合わせません。

### 外部との通信

- `note.com` / `editor.note.com`: ユーザーのタブ内で下書きを入力するため(content script)。また、ログイン中のアカウントの名前とアイコンを表示するため、ユーザーのタブの中から(拡張のウィンドウを開いたときに note のタブが無ければ拡張から)note.com のログイン中のユーザーの情報を 1 回読むため
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
- **Data handled locally.** The article you paste (including its images) is stored temporarily in `chrome.storage.local` to hand it from the popup to the note.com tab, and is sent nowhere except note.com. An optional GitHub token (for private repositories) is stored only in the extension's storage and sent only to `raw.githubusercontent.com`.
- **No credentials.** The extension never reads note.com cookies (it has no `cookies` permission) and never touches your password. It works inside the note.com tab you are already logged into.
- **Logged-in account.** To help you avoid posting from the wrong account, the extension shows the name and icon of the note account you are logged into, in its popup and in the banner on the note editor. To get them, it makes one read-only (GET) request from your note.com tab to note.com's "current user" endpoint (when you open the popup and no note.com tab is open, or the tab does not answer, the extension's background makes that same single request to note.com instead); your browser attaches its own login state (cookies) to that request, and the extension does not read them. The name, ID and icon URL are only shown on screen: they are not stored (not even in the extension's storage) and are sent nowhere except note.com. The icon is displayed directly from the image URL in note's response. The request is made only when you open the popup, when a draft has been filled in, after the publish settings have been filled in, and when you run the diagnostics. It never polls.
- **Network.** `note.com` / `editor.note.com` (filling the draft in your tab, and reading the logged-in account once, from your tab or, when no note.com tab is open, from the extension) and `raw.githubusercontent.com` (reading the Markdown/images you point to, and a selector definition JSON).
- **It never clicks Publish.** Publishing is always your own click.

Contact: https://shibuhachi.works/about/ or the developer contact shown on the Chrome Web Store listing.
