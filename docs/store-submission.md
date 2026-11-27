# Chrome ウェブストアに出す手順(人の作業)

拡張をストアに置くまでの手順。**ストアに上げる・公開するのは人の作業**(AI はやらない)。2 回目以降の版は、人が起動する Actions の「ストアに申請する」で、ZIP を上げて審査に出すところまでできる(3. の「Actions で申請する」)。掲載文・画像・プライバシーの回答は API では変えられないので、変えるときは今までどおりダッシュボードで直す。
掲載文・権限の理由・プライバシーの回答はすべて `extension/store/listing.md` にある。画面に貼るだけ。

## 0. 先に決めること

- **公開範囲**: 「公開」にする(ストアの検索で見つかり、誰でも無料で入れられる)。`selectors/note.json` は 2026-10-29 に実機で全工程 ✓ を確認済み。note の画面が変わって ✗ になったときは、`selectors/note.json` を直して main に push すれば、拡張を出し直さずに全員に届く。限定公開(URL を知っている人だけ)にしたいときは、公開範囲だけを切り替えられる
- **料金**: 「料金なし」。拡張の中に購入の機能は無い
- **プライバシーポリシーの URL**: 審査で必須。https://shibuhachi.works/last-one-click/privacy/ を使う(portfolio リポジトリの `src/pages/last-one-click/privacy.astro`。文面は `docs/PRIVACY.md` と同じに保つ)。ホームページ URL は https://shibuhachi.works/last-one-click/

## 1. 準備(1 回だけ)

1. Chrome ウェブストアのデベロッパー登録(Google アカウント、登録料は 1 回だけ): https://chrome.google.com/webstore/devconsole
2. 登録後、デベロッパー ダッシュボードの「アカウント」で、メールアドレスの確認と、公開者名の設定を済ませる(公開者名はストアに表示される)

## 2. ZIP を作る

**ストアに上げる ZIP は、GitHub のリリースに添えたものを使う。** `release.yml`(Actions の「リリースを作る」)が、指定したコミットから ZIP を作ってリリースに添える。手元で作り直さない(ZIP は作るたびに中身の時刻が変わるので、リリースの ZIP と、ストアに上げた ZIP が別のものになる)。

1. `manifest.json` の `version` を上げた PR(リリースの PR)をマージする。`docs/releases/v<version>.md`(リリースの本文)も、その PR で置く
   - `docs/releases/next.md`(main にためてきた、まだ出していない変更)を `docs/releases/v<version>.md` に名前を変えて、リリースの本文にする(冒頭の説明を版の紹介に直し、`v0.1.5.md` と同じ形で「入手」などを足す)。同じ PR で、空の `next.md`(冒頭の説明と、「変わったこと」「変えていないもの」の見出しだけ)を作り直す
   - README などの「(v<version> から)」は、この PR では外さない(ストアで公開されるまで、ストアの版では使えないため。外すのは 5. の 5)
   - その前に、`extension/store/listing.md`(説明文)が、この版の機能と合っているかを見直す(機械では確かめられない)
   - ストアの画像が古いと、「リリースを作る」が止まる。`extension/` で `npm run build && npm run screenshots` を実行し、作り直した画像と `screenshots.lock` を PR に入れる(ふだんの CI では、古いと注意が出る)
2. Actions の「リリースを作る」を、タグ(例: `v0.1.2`)とコミット(40 文字の SHA)を指定して起動する
3. できたリリースから `last-one-click-<version>.zip` をダウンロードして、3. でストアに上げる。本文の末尾に SHA-256 が書いてあるので、ダウンロードした ZIP と合うか確かめる

手元で動作を確かめたいときだけ、次で ZIP を作れる(ストアには上げない)。

```bash
cd extension
npm ci
npm run package     # → extension/release/last-one-click-<version>.zip
```

- `manifest.json` の `version` を上げるのは、ストアに上げ直すとき(同じ version は再アップロードできない)
- ZIP の中身は `dist/` の中身そのもの(`manifest.json` が直下)。中に `.map` やソースは入らない
- 画像(アイコン・スクリーンショット)を作り直すときだけ、リポジトリ直下で `npm ci && npx playwright install chromium` をしてから `npm run icons` / `npm run screenshots`(画像はコミット済みなので、普段は不要)。`npm run screenshots` は画像の元のファイルの指紋を `extension/store/screenshots.lock` に残し、`npm run check-screenshots` がそれを今の指紋と比べる

## 3. ストアに上げる

### Actions で申請する(2 回目以降の版)

ZIP を上げて審査に出すだけなら、ダッシュボードを開かずにできる。

1. 掲載文(`listing.md`)・画像・プライバシーの回答を、この版で変えたなら、先にダッシュボードで直して保存する(API では変えられない)
2. Actions の「ストアに申請する」を、タグ(例: `v0.1.9`)と「審査に通ったあと」(止めておく / すぐ公開する)を選んで起動する
   - リリースに添えた ZIP を取ってきて、SHA256SUMS と合うか、`manifest.json` の version がタグと同じかを確かめてから上げる
   - 「止めておく」を選ぶと、審査に通っても公開されない。ダッシュボードで「公開」を押した時点で公開される(告知の日に合わせたいとき)
3. 終わったら、ダッシュボードで「審査待ち」になっているかを見る。失敗したら、Actions のログの文を Issue に貼れば AI が直す
   - ZIP を上げたあとで、審査に出すところだけ失敗したときは、ダッシュボードで「審査のため送信」を押す(同じ版の ZIP は 2 回目を上げられない)
   - ダッシュボードで公開範囲(公開・限定公開など)を変えたあとは、一度ダッシュボードで公開するまで API では審査に出せない

#### 準備(1 回だけ)

API の鍵を作って、リポジトリの Secrets に入れる。値は Secrets にだけ入れ、Issue・PR・チャットには貼らない。

1. ストアのデベロッパー アカウントで、2 段階認証を有効にする
2. Google Cloud でプロジェクトを作り、「Chrome Web Store API」を有効にする
3. 「OAuth 同意画面」を作る(外部。テストユーザーに、ストアのデベロッパー アカウントの Google アカウントを足す)
4. 「認証情報」→「OAuth クライアント ID」を作る。種類は「ウェブ アプリケーション」、承認済みのリダイレクト URI に `https://developers.google.com/oauthplayground` を足す。クライアント ID とシークレットを控える
5. https://developers.google.com/oauthplayground を開き、右上の歯車で「Use your own OAuth credentials」をオンにして 4. の ID とシークレットを入れる。左の欄に `https://www.googleapis.com/auth/chromewebstore` を入れて「Authorize APIs」→ デベロッパー アカウントでログイン →「Exchange authorization code for tokens」で出たリフレッシュトークンを控える
   - 同意画面が「テスト」のままだと、リフレッシュトークンが 7 日で切れることがある。切れたら 5. をやり直すか、同意画面を「本番」にする
6. 公開者 ID を控える(ダッシュボードの「パブリッシャー」→「設定」)
7. GitHub のリポジトリの Settings → Secrets and variables → Actions に、次の 4 つを入れる
   - `CWS_CLIENT_ID`(4. のクライアント ID)
   - `CWS_CLIENT_SECRET`(4. のシークレット)
   - `CWS_REFRESH_TOKEN`(5. のリフレッシュトークン)
   - `CWS_PUBLISHER_ID`(6. の公開者 ID)
   - アイテム ID は `jomapffkhcdpnodaffobmpfofnnaihnd`(ストアの URL の末尾)を使う。変えるときだけ、同じ画面の Variables に `CWS_ITEM_ID` を足す

### ダッシュボードで申請する

1. ダッシュボード →(初回は「新しいアイテム」。2 回目以降は、アイテムの「パッケージ」→「新しいパッケージをアップロード」)→ ZIP を上げる。名前を変えた版も、新しいアイテムは作らず、同じアイテムを更新する(ID とストアの URL が変わらない)
2. **ストアの掲載情報**: `extension/store/listing.md` の「基本」「詳細な説明」を貼る。カテゴリは「仕事効率化」、言語は「日本語」
3. **画像**: スクリーンショット `extension/store/screenshot-1.png` 〜 `screenshot-5.png`(1280x800、5 枚とも)を番号順に上げる。可能なら実機で note のエディタに入力された状態も 1 枚撮って足す(記事本文・アカウント名が写らないもの)。小さなプロモタイルは `extension/store/promo-small.png`。動画の欄には `listing.md` の「画像」にある YouTube の URL を入れる
4. **プライバシーへの取り組み**: `listing.md` の「単一の目的」「権限の理由」「リモートコード」「データの使用」をそのまま回答する。プライバシーポリシー URL を入れる
5. **公開設定**: 決済方法は「料金なし」、公開範囲は「公開」(0. の判断どおり)。配布地域はすべて
6. 「審査のため送信」。「審査の合格後に自動的に公開する」を外すと、合格後に自分で公開を押すまで待てる(告知の日に合わせたいとき)

## 4. 審査中・審査後

- 審査は通常 1〜3 日。ホスト権限が付いているので、権限の理由が薄いと差し戻される。差し戻しのメールが来たら、本文を Issue に貼れば AI が回答案と修正 PR を作る
- 公開されたら、ストアの URL を AI に渡す。紹介ページ(portfolio リポジトリ)の `storeUrl` を入れる PR と、`docs/ROADMAP.md` の「Chrome ウェブストアに公開」にチェックを入れる PR を作る
- 版のタグとリリースは、`docs/releases/<タグ名>.md` に本文を置く PR をマージしたあと、Actions の「リリースを作る」を起動して作る(タグ名と、ストアに上げた版のコミットの SHA を入れる)。AI の作業環境からはタグもリリースも直接は作れないので、この workflow を使う。main の先頭なら workflow がタグも作る。古いコミット(main と workflow ファイルが違う)にリリースを作るときは、人が先に `git tag -a <タグ名> <SHA>` → `git push origin <タグ名>` でタグを打ってから起動する(Actions の token では作れない)

## 5. 次に上げ直すとき

1. `manifest.json` の `version` を上げる(例: 0.1.0 → 0.1.1)
2. リリースの PR をマージして「リリースを作る」を起動し、3. の「Actions で申請する」で審査に出す(ダッシュボードで上げるときは、リリースに添えた ZIP を「パッケージ」→「新しいパッケージをアップロード」)
3. 掲載情報・プライバシーの回答に変更があれば `listing.md` を先に直してから画面に反映する
4. ストアで新しい版が公開されたら、`shared/released/selectors-schema.v<版>.ts` を、その版のタグの `shared/selectors-schema.ts` の写しに、`shared/released/note.v<版>.json` を、その版のタグの `selectors/note.json` の写しに置き換える(ファイル名の版と、`shared/selectors-released.test.ts` の import と `RELEASED` も変える)
5. ストアで新しい版が公開されたら、`README.md`・`extension/README.md`・`templates/note/` の「(v<版> から)」を外す(公開の前には外さない)
6. ストアで新しい版が公開されたら、使い方を紹介する公開済みの記事のうち、その版で変わった画面・動きを書いている所を直す(公開の前には直さない。ストアの版を使う読者とずれるため)。探し方: `docs/releases/v<版>.md` の「変わったこと」に出てくるボタン・欄の名前で記事を検索し、画面の画像も見る

## 守ること(AGENTS.md / extension/README と同じ)

- 説明文に「認証情報を扱わない」「公開ボタンは押さない」「非公式ツール」を明記する(listing.md に入っている)
- `host_permissions` を増やさない(増やすと審査が厳しくなる)
- セレクタの修正だけなら、`selectors/note.json` を main に push すれば全ユーザーに届く。ストアの再申請は不要
