// 本文の記法を HTML に変換する。先に全文をエスケープするので任意のHTMLは入らない。
//   |親文字《ルビ》   … ルビ（親文字を明示）
//   漢字《かんじ》     … ルビ（直前の漢字にかかる）
//   《《強調》》       … 傍点
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderMarkup(src: string): string {
  let h = esc(src);
  h = h.replace(/《《(.+?)》》/g, '<em class="boten">$1</em>');
  h = h.replace(/[|｜]([^|｜《》\n]+?)《([^《》\n]+?)》/g, "<ruby>$1<rt>$2</rt></ruby>");
  h = h.replace(/([一-鿿々〆ヵヶ]+)《([^《》\n]+?)》/g, "<ruby>$1<rt>$2</rt></ruby>");
  return h;
}

export const MARKUP_HELP = [
  { name: "ルビ", syntax: "|紅魔館《こうまかん》", note: "縦棒から《》までの文字にルビ" },
  { name: "ルビ（漢字）", syntax: "吸血鬼《きゅうけつき》", note: "直前の漢字にルビ" },
  { name: "傍点", syntax: "《《ここだけ》》", note: "文字の上に点" },
];
