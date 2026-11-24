# AGENTS.md

このリポジトリで作業する AI エージェント向けの決まり。

## 絶対に守ること

- **公開ボタン(「投稿する」「公開する」)をスクリプト・拡張から押さない。** 設計の芯。全媒体に適用する
- クリックは必ず `safeClick()` を通す(`shared/forbidden-click.ts`)。押さない文字の一覧はコードに直接書き、`selectors/*.json` からは変えられない
- 拡張の `host_permissions` を増やさない（`shared/manifest-permissions.test.ts` で権限を検査する）
- `selectors/note.json` は 2026-10-29 に実機で全工程 ✓ を確認済み。note の画面が変わって ✗ になったときの実機での確認は人の作業(`human-task` の Issue を立てて人に渡す)
- `selectors/note.json` は、ストアに出ている版の拡張も main から読む。**足すだけにする。** 今ある項目の値を、新しい版の都合で変えない(note の画面が変わって直すときは別)。出ている版の読み込み処理で読めること・今ある項目の値が出ている版のとき(`shared/released/note.v<版>.json`)と同じことは `shared/selectors-released.test.ts` で検査する。画面が変わって値を直すときは、同じ PR でその写しも直す
- `selectors/note.json` に足す項目は、無くても動くようにする(`shared/selectors-schema.ts` で省略できるようにし、既定値を持つ。`magazineAddButtonText` と同じ形)
- このリポジトリは公開。記事・トークン・Cookie(`.profile/`)・個人の情報・社内の運用の情報を置かない。記事はこのリポジトリの外に置く
- Issue・PR の本文とコメントも公開される。製品の内容だけを書き、ほかのリポジトリや事業の名前・社内の連絡先や運用の情報を書かない

## 機能を足すとき

- 記事の見た目に関わる機能(本文の書き方、拡張の画面のチェックで入るものなど)を足したら、見本 `templates/note/article.md` にその使い方を足し、`shared/template-note.test.ts` の `FEATURES` にも足す。見本 1 本で、拡張でできることを全部試せるようにしておく

## まだストアに出していない機能

main の README・見本は、マージした時点で新しい機能を説明する。ストアで新しい版が公開されるまでは、ストアから入れた拡張では動かないので、次のようにする。

- 拡張の動きを変える PR は、同じ PR で `docs/releases/next.md` に 1 行足す(見張り役(`tools/`)・テストだけの変更は書かない)
- `README.md`・`extension/README.md`・`templates/note/` で、まだ出していない機能を説明するときは「(v0.1.7 から)」のように版を付ける。版は `extension/manifest.json` の今の版の次
- リリースの PR で、`docs/releases/next.md` を `docs/releases/v0.1.x.md` にし、空の `next.md` を作り直す。README などの「(v0.1.x から)」は、その版がストアで公開されたあとに外す(手順は `docs/store-submission.md`)

## PR の決まり(org 共通)

- 返事・PR・Issue は日本語。PR 本文の冒頭に `## 要約`(3 行以内)
- マージするのは人だけ。AI はマージしない
- マージできる状態になったら `merge-ready` ラベルを付ける。push したら外す
- Codex にレビューを頼むときは、コメントの 1 行目を `@codex review` だけにする
- commit と push は別のコマンドで行う
- 書かないもの: トークン・API キー・金額・法人名・アフィリエイトの URL や ID・家族の情報
