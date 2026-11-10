// ストア掲載用の画像を作る: npm run screenshots(先に npm run build)
//   store/screenshot-1.png  1280x800  ポップアップ(入力例つき)
//   store/screenshot-2..5.png 1280x800 見出し + 画面(公開ボタンは押さない / ドロップ / 運ぶ 5 つ / 触らない 3 つ)
//   store/promo-small.png    440x280  小さなプロモタイル(任意)
//   store/marquee.png       1400x560  マーキー(任意)
// リポジトリ直下の Playwright を使う(先に直下で npm ci && npx playwright install chromium)。
// note の画面そのものは、実機でしか撮れない(人の作業)。
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);
const dist = path.resolve(dir, "../dist");
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
mkdirSync(dir, { recursive: true });

// 1) ポップアップ。popup.js は chrome.* が無いと動かないので読み込まず、静的な HTML に例を入れて撮る
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const html = readFileSync(path.join(dist, "popup.html"), "utf8").replace('<script src="popup.js"></script>', "");
  // popup.css の body 向けの指定を .popup(模した枠)に当てる
  const popupCss = readFileSync(path.join(dist, "popup.css"), "utf8").replace(/\bbody\b/g, ".popup");
  await page.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${popupCss}</style><style>
    html,body{height:100%} body{margin:0;background:linear-gradient(135deg,#e9f8f4,#f6f7f9);display:flex;align-items:center;justify-content:center;gap:48px;padding:0}
    .popup{width:440px;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.15)}
    .side{max-width:520px;color:#1f2d2a} .side h2{font:700 34px/1.3 system-ui,sans-serif;margin:0 0 14px} .side p{font:17px/1.7 system-ui,sans-serif;margin:0 0 10px;color:#3a4a46}
    .side .tag{display:inline-block;background:#41c9b4;color:#fff;border-radius:999px;padding:4px 12px;font:700 13px system-ui,sans-serif;margin-bottom:14px}
  </style></head><body>
    <div class="side"><span class="tag">The last one click is yours.</span><h2>Markdown を選ぶだけで、note の下書きが組み上がる。</h2>
      <p>貼り直し、整え直し、画像のアップロード、ハッシュタグの入力。<br>記事ごとに繰り返していた作業が、ファイルを選ぶ 1 回で済みます。</p>
      <p><b>公開ボタンは押しません。</b><br>最後の 1 クリックはあなたのものです。</p>
      <p>note の Cookie・パスワードには触れません。<br>ログイン済みのタブの中で動くだけです。</p></div>
    <div class="popup">${html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "")}</div>
  </body></html>`);
  // md ファイルを読み込んだ直後の状態を作る(textarea は確認用の readonly なので value を直接入れる)
  await page.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => (d.open = false));
    // 1280x800 に収めるため、確認用の欄を少し低くし、ポップアップ専用の注意書きは出さない
    const ta = document.querySelector("#markdown");
    ta.style.minHeight = "120px";
    ta.value = "---\ntitle: 週 1 本、note を書き続けるためにやったこと\nhashtags: [個人開発, note, 習慣]\nmagazine: 開発日記\n---\n\n## なぜ下書きまでを自動にしたのか\n\n書くのは自分、整えるのは拡張、押すのも自分。\n\n- md ファイルを選ぶ → 下書き完成\n- 公開ボタンは自分で";
    document.querySelector("#markdown-box").hidden = false;
    document.querySelector("#fields").hidden = false;
    document.querySelector("#title").value = "週 1 本、note を書き続けるためにやったこと";
    document.querySelector("#hashtags").value = "個人開発, note, 習慣";
    document.querySelector("#magazine").value = "開発日記";
    const picked = document.querySelector("#picked");
    picked.hidden = false;
    picked.textContent = "受け取り済み: md ファイル: 2026-10-28-weekly-note.md / 見出し画像: thumbnail.png";
    const st = document.querySelector("#status");
    st.hidden = false;
    st.textContent = "2026-10-28-weekly-note.md を読み込みました。\n「note の下書きを作成」を押してください。";
  });
  writeFileSync(path.join(dir, "screenshot-1.png"), await page.screenshot({ type: "png" }));
  console.log("store/screenshot-1.png (1280x800)");
  await page.close();
}

// 2) 文字なしの SVG に掲載用の文言を重ねる。SVG 自体には文字を入れない。
for (const [name, width, height, copy] of [
  ["promo-small", 440, 280, '<h1>Last One Click</h1><p>Markdown を選ぶだけで、<br>note の下書きが完成</p><small>公開ボタンは押しません</small>'],
  ["marquee", 1400, 560, '<small class="eyebrow">The last one click is yours.</small><h1>Markdown の記事を、<br>そのまま note の下書きに</h1><p>タイトル・本文・見出し画像・ハッシュタグまで<br>入力して止まります。</p><small>最後のワンクリックは、あなたの手で。</small>'],
]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const artwork = readFileSync(path.join(dir, name + ".svg"), "utf8");
  await page.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;color:white;font-family:"Noto Sans CJK JP",sans-serif}
    svg{position:absolute;inset:0} .copy{position:absolute;left:50%;right:4%;top:50%;transform:translateY(-50%)}
    h1{font-size:38px;line-height:1.5;margin:24px 0;font-weight:800;overflow-wrap:anywhere}
    p{font-size:21px;line-height:1.8;margin:0 0 30px}small{font-size:20px;opacity:.8}
    .eyebrow{font-size:16px;letter-spacing:.18em;opacity:1}
    .promo-small .copy{left:34%;right:4%}.promo-small h1{font-size:20px;line-height:1.35;margin:0 0 16px;white-space:nowrap;letter-spacing:-.7px}
    .promo-small p{font-size:14px;line-height:1.9;margin:0 0 14px}.promo-small small{font-size:11px;opacity:.9}
  </style></head><body class="${name}">${artwork}<div class="copy">${copy}</div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(path.join(dir, name + ".png"), await page.screenshot({ type: "png" }));
  console.log(`store/${name}.png (${width}x${height})`);
  await page.close();
}
// 3) 追加のスクリーンショット(1280x800、最大 5 枚)。Shazam のストア掲載のように「大きな見出し + 画面」で魅力を伝える。
//    note の画面そのものは撮れないので、拡張の実際の部品(バナー・ポップアップ)と文字なしの SVG 素材を組み合わせる。
const FONT = '"Noto Sans CJK JP","Hiragino Sans",system-ui,sans-serif';
const BASE_CSS = `*{box-sizing:border-box}html,body{margin:0;width:1280px;height:800px;overflow:hidden;font-family:${FONT}}
  .teal{background:linear-gradient(135deg,#1f6f62,#2a9d8b);color:#fff}.light{background:linear-gradient(135deg,#e9f8f4,#f6f7f9);color:#1f2d2a}
  .tag{display:inline-block;border-radius:999px;padding:6px 14px;font:700 14px/1 ${FONT};letter-spacing:.02em;margin-bottom:18px}
  .teal .tag{background:rgba(255,255,255,.16);color:#fff}.light .tag{background:#41c9b4;color:#fff}
  h1{margin:0 0 16px;font-weight:800;font-size:52px;line-height:1.3;letter-spacing:-.5px}
  .sub{font-size:21px;line-height:1.75;margin:0;opacity:.92}.light .sub{color:#3a4a46}
  .banner{position:absolute;max-width:400px;padding:14px 16px;border-radius:12px;background:#1f9d7a;color:#fff;font-size:15px;line-height:1.6;box-shadow:0 10px 30px rgba(0,0,0,.28)}
  .banner b{display:block;margin-bottom:4px}.banner .x{display:block;text-align:right;margin-top:6px;opacity:.8;font-size:14px}`;
async function slide(name, cls, body, css = "", preCss = "") {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  // preCss(ポップアップの CSS など)は BASE_CSS より前に置き、見出しの指定が負けないようにする
  await page.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${preCss}${BASE_CSS}${css}</style></head><body class="${cls}">${body}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(path.join(dir, name + ".png"), await page.screenshot({ type: "png" }));
  console.log(`store/${name}.png (1280x800)`);
  await page.close();
}
const bannerHtml = (kind, text) =>
  `<div class="banner" style="background:${kind === "ok" ? "#1f9d7a" : "#c27c0e"}"><b>Last One Click</b>${text}<span class="x">閉じる</span></div>`;

// screenshot-2: 最後のワンクリックは、あなたの手で(マーキーの素材を背景なしで使い、本物のバナーを重ねる)
{
  const art = readFileSync(path.join(dir, "marquee.svg"), "utf8")
    .replace(/<rect width="1400" height="560" rx="0" fill="url\(#bg\)"\/>/, "")
    .replace(/<circle cx="292" cy="267" r="227" fill="#fff" opacity="\.04"\/>/, "");
  await slide(
    "screenshot-2",
    "teal",
    `<div style="position:absolute;left:72px;top:64px;width:600px"><span class="tag">The last one click is yours.</span>
       <h1>最後のワンクリックは、<br>あなたの手で。</h1>
       <p class="sub" style="font-size:19px">下書きまでを組み立てます。<br>投稿・公開のボタンは、設計上いっさい押しません。<br>内容を確かめて、最後の 1 クリックだけ自分で。</p></div>
     <div style="position:absolute;left:520px;top:220px;width:760px;height:580px;overflow:hidden">
       <div style="position:absolute;left:-160px;top:-10px;width:1150px;height:460px">${art.replace('width="1400" height="560"', 'width="1150" height="460"')}</div>
     </div>
     ${bannerHtml("ok", "✅ 入力が終わりました。内容を確認して、公開ボタンを自分で押してください。<br>タイトル ✓ / 本文 ✓ / 見出し画像 ✓ / 公開設定 ✓").replace('class="banner"', 'class="banner" style="right:56px;bottom:56px;max-width:420px;"')}`,
  );
}

// screenshot-3: md ファイルと見出し画像を、ドラッグ＆ドロップするだけ(ウィンドウ表示のポップアップ。ドロップ中の見た目 + 飛んでくるファイル)
{
  const html = readFileSync(path.join(dist, "popup.html"), "utf8").replace('<script src="popup.js"></script>', "");
  const popupCss = readFileSync(path.join(dist, "popup.css"), "utf8").replace(/\bbody\b/g, ".popup");
  const chip = (x, y, rot, label, color) =>
    `<div style="position:absolute;left:${x}px;top:${y}px;transform:rotate(${rot}deg);background:#fff;border-radius:12px;padding:14px 18px 14px 56px;box-shadow:0 14px 36px rgba(0,0,0,.18);font:700 17px/1 ${FONT};color:#1f2d2a">
       <span style="position:absolute;left:16px;top:11px;width:28px;height:34px;border-radius:4px;background:${color}"></span>${label}</div>`;
  await slide(
    "screenshot-3",
    "light",
    `<div style="position:absolute;left:72px;top:150px;width:620px"><span class="tag">ドラッグ＆ドロップ</span>
       <h1 style="font-size:42px">md ファイルと見出し画像を、<br>ドラッグ＆ドロップするだけ。</h1>
       <p class="sub">2 つ同時でも構いません。<br>タイトル・ハッシュタグ・マガジンも記事ファイルから<br>読み取るので、入力し直す必要はありません。</p></div>
     <div class="popup dropping" style="position:absolute;left:700px;top:200px;width:520px;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.15)">${html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "")}</div>
     ${chip(540, 520, -10, "2026-10-28-weekly-note.md", "#41c9b4")}
     ${chip(590, 610, 7, "thumbnail.png", "#e8b96a")}
     <svg style="position:absolute;left:930px;top:395px" width="28" height="34" viewBox="0 0 28 34"><path d="M2 2 L2 28 L9 21 L14 32 L19 30 L14 19 L24 19 Z" fill="#1f2d2a" stroke="#fff" stroke-width="2"/></svg>`,
    `.popup{width:520px;padding:16px}.popup h1{font-size:15px;margin:0;font-weight:700;line-height:1.4;letter-spacing:0}.popup #open-window,.popup #markdown-box,.popup #fields,.popup details,.popup #submit ~ .hint,.popup .hint-check{display:none!important}
     .popup .dropzone{padding:34px 16px 30px}.popup .dz-icon{width:44px;height:44px}.popup .dz-title{font-size:16px}`,
    popupCss,
  );
}

// screenshot-4: 手でやらなくていいこと、5 つ
{
  const card = (title, sub) =>
    `<div style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22);border-radius:16px;padding:22px 22px 20px">
       <div style="font-size:24px;font-weight:800;margin-bottom:10px"><span style="display:inline-block;width:30px;height:30px;border-radius:50%;background:#fff;color:#1f6f62;text-align:center;line-height:30px;font-size:18px;margin-right:10px">✓</span>${title}</div>
       <div style="font-size:15px;line-height:1.6;opacity:.9">${sub}</div></div>`;
  await slide(
    "screenshot-4",
    "teal",
    `<div style="position:absolute;left:72px;top:96px;width:1136px"><span class="tag">省ける手間</span>
       <h1>手でやらなくていいこと、5 つ。</h1>
       <p class="sub">記事ごとに繰り返していた作業が、まとめてなくなります。<br>note のエディタはここまで入った状態で止まります。</p></div>
     <div style="position:absolute;left:72px;top:360px;width:1136px;display:grid;grid-template-columns:repeat(3,1fr);gap:20px">
       ${card("タイトルを入れ直す", "記事の先頭から自動で入ります")}
       ${card("本文を整え直す", "見出し・太字・箇条書きはそのまま入ります")}
       ${card("見出し画像をアップする", "アップロードからトリミングの保存まで")}
       ${card("ハッシュタグを打つ", "1 つずつ手で入力しなくて済みます")}
       ${card("マガジンに追加する", "指定したマガジンに追加された状態に")}
       <div style="border-radius:16px;padding:22px;background:#fff;color:#1f2d2a;display:flex;align-items:center;font-size:17px;line-height:1.6">そして、公開ボタンは押しません。<br>下書きのまま止まります。</div>
     </div>`,
  );
}

// screenshot-5: 触らないもの、3 つ
{
  const icon = {
    lock: '<svg viewBox="0 0 48 48" width="56" height="56" fill="none" stroke="#1f6f62" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="21" width="28" height="20" rx="4"/><path d="M16 21v-6a8 8 0 0 1 16 0v6"/><path d="M6 6l36 36" stroke="#d9534f"/></svg>',
    server: '<svg viewBox="0 0 48 48" width="56" height="56" fill="none" stroke="#1f6f62" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="32" height="12" rx="3"/><rect x="8" y="28" width="32" height="12" rx="3"/><circle cx="15" cy="14" r="1.5" fill="#1f6f62"/><circle cx="15" cy="34" r="1.5" fill="#1f6f62"/><path d="M6 6l36 36" stroke="#d9534f"/></svg>',
    button: '<svg viewBox="0 0 48 48" width="56" height="56" fill="none" stroke="#1f6f62" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="16" width="36" height="16" rx="8"/><path d="M16 24h16"/><path d="M6 6l36 36" stroke="#d9534f"/></svg>',
  };
  const card = (ic, title, sub) =>
    `<div style="background:#fff;border-radius:18px;padding:30px 28px;box-shadow:0 12px 40px rgba(0,0,0,.08)">
       <div style="margin-bottom:16px">${ic}</div>
       <div style="font-size:26px;font-weight:800;margin-bottom:10px;color:#1f2d2a">${title}</div>
       <div style="font-size:16px;line-height:1.7;color:#3a4a46">${sub}</div></div>`;
  await slide(
    "screenshot-5",
    "light",
    `<div style="position:absolute;left:72px;top:96px;width:1136px"><span class="tag">安心して使えるように</span>
       <h1>触らないもの、3 つ。</h1>
       <p class="sub">あなたがログイン済みの note のタブの中で動くだけです。</p></div>
     <div style="position:absolute;left:72px;top:360px;width:1136px;display:grid;grid-template-columns:repeat(3,1fr);gap:24px">
       ${card(icon.lock, "パスワード・Cookie", "note の認証情報には触れません。<br>ログインはいつもどおり自分で行います。")}
       ${card(icon.server, "記事を送るサーバー", "サーバーを持ちません。<br>記事は Chrome の中に一時的に置かれ、<br>note 以外には送られません。")}
       ${card(icon.button, "公開ボタン", "投稿・公開のボタンは押しません。<br>最後の 1 クリックはあなたのものです。")}
     </div>`,
  );
}

await browser.close();
