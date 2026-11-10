// note の目次は、本文の見出し(大見出し・小見出し)から note が作る。
// 見出しが無い記事に目次を入れると中身の無い目次になるので、そのときは入れない。

/** 本文の HTML に、目次の元になる見出し(h2・h3)があるか */
export function hasTocHeadings(html: string): boolean {
  return /<h[23][\s>]/i.test(html);
}
