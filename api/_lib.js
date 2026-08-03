/** 진짜공고 — 판별 엔진 (결정론적 규칙 + 공고 사실 대조) */

/* ---------------------------------------------- 1. 개인정보 마스킹(서버 2차) */
export const MASK_RULES = [
  [/(01[016-9])[-. ]?(\d{3,4})[-. ]?(\d{4})/g, "$1-****-****", "휴대전화"],
  [/(0(?:2|[3-6][1-5]))[-. ]?(\d{3,4})[-. ]?(\d{4})/g, "$1-***-****", "전화번호"],
  [/\d{6}[-\s]?[1-4]\d{6}/g, "******-*******", "주민등록번호"],
  [/\d{3}[-\s]\d{2}[-\s]\d{5}/g, "***-**-*****", "사업자등록번호"],
  [/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, "****-****-****-****", "카드번호"],
  [/\b\d{2,3}[-\s]\d{2,6}[-\s]\d{2,6}(?:[-\s]\d{2,6})?\b/g, "***-****-******", "계좌번호(추정)"],
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, "****@****", "이메일"],
];

export function maskPII(text) {
  let out = String(text || "");
  const hit = [];
  for (const [re, rep, label] of MASK_RULES) {
    if (re.test(out)) hit.push(label);
    re.lastIndex = 0;
    out = out.replace(re, rep);
  }
  return { text: out, masked: [...new Set(hit)] };
}

/* ---------------------------------------------- 2. 사업명 정규화·유사도 */
export function normalize(s) {
  return (s || "")
    .replace(/\[[^\]]{1,12}\]/g, " ")
    .replace(/\([^)]{0,30}\)/g, " ")
    .replace(/[^가-힣A-Za-z0-9]/g, "")
    .replace(/(제?\d+차|\d{4}년도?|\d+회)/g, "")
    .toUpperCase();
}

/** 정규화 문자열의 2-gram 집합 */
function grams(s) {
  const g = new Set();
  for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
  return g;
}

export function similarity(a, b) {
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size); // Dice 계수
}

/** 공고 DB 대조 — 상위 후보 반환 */
export function matchProgram(claimed, db, topN = 3) {
  const key = normalize(claimed);
  if (key.length < 3) return [];
  return db.items
    .map((it) => ({ item: it, score: similarity(key, it.key) }))
    .filter((x) => x.score > 0.28)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

/* ---------------------------------------------- 3. 규칙 신호 */
const RE = {
  broker: /(수수료|성공보수|착수금|선입금|대행\s*(료|비|신청|접수)|신청\s*대행|컨설팅\s*비용|알선|브로커|수임료)/g,
  channel: /(카카오톡\s*(아이디|ID)|카톡\s*(아이디|ID)|오픈\s*채팅|오픈채팅|텔레그램|친구\s*추가|1:1\s*(상담|채팅)|일대일\s*채팅)/g,
  credit: /(무담보|무보증|무신용|신용\s*무관|연체\s*(중|자)?\s*(도)?\s*가능|저신용|햇살론|정부\s*지원\s*대출|저금리\s*대환)/g,
  pressure: /(마감\s*임박|선착순|조기\s*소진|오늘\s*까지|금일\s*마감|한정|긴급|즉시\s*지급|당일\s*지급|미신청|재안내|최종\s*안내)/g,
  selected: /(대상자로?\s*선정|확정\s*대상|선정\s*통보|지급\s*확정|승인\s*완료|한도\s*조회\s*완료)/g,
  evasion: /[가-힣]['`.,·]{1,3}[가-힣]|[가-힣]\s{1}[가-힣]{1}\s{1}[가-힣]{1}\s{1}[가-힣]/g,
  intlSend: /\[?(국제\s*발신|국외\s*발신)\]?/g,
  install: /(앱\s*설치|APK|어플\s*설치|원격\s*(제어|지원)\s*(앱|프로그램))/gi,
};

const GOV_TLD = /(^|\.)((go|or|re)\.kr|k-startup\.go\.kr|bizinfo\.go\.kr)$/i;
const RISK_TLD = /\.(pw|shop|top|xyz|cc|icu|click|link|site|online|store|cyou|sbs)$/i;
const SHORTENER = /(bit\.ly|me2\.do|url\.kr|han\.gl|vo\.la|buly\.kr|abit\.ly|c11\.kr|zrr\.kr|m\.site\.naver\.com|naver\.me|kko\.to)/i;

export function analyzeUrls(text) {
  const urls = [...String(text).matchAll(/https?:\/\/[^\s<>"')\]]+/gi)].map((m) => m[0]);
  const bare = [...String(text).matchAll(/\b(?:[\w-]+\.)+(?:kr|com|net|org|pw|shop|top|xyz|cc|icu|click|link|site|online|store|info|io)\b(?:\/[^\s]*)?/gi)]
    .map((m) => m[0])
    .filter((u) => !urls.some((x) => x.includes(u)));
  const all = [...new Set([...urls, ...bare])];
  return all.map((u) => {
    let host = u.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].toLowerCase();
    return {
      url: u,
      host,
      gov: GOV_TLD.test(host),
      riskTld: RISK_TLD.test(host),
      shortener: SHORTENER.test(host),
    };
  });
}

export function ruleSignals(text) {
  const t = String(text || "");
  const pick = (re) => [...new Set((t.match(re) || []).map((s) => s.replace(/\s+/g, " ").trim()))];
  const urls = analyzeUrls(t);
  return {
    broker: pick(RE.broker),
    channel: pick(RE.channel),
    credit: pick(RE.credit),
    pressure: pick(RE.pressure),
    selected: pick(RE.selected),
    intlSend: pick(RE.intlSend),
    install: pick(RE.install),
    evasion: (t.match(RE.evasion) || []).length >= 2,
    urls,
    badUrls: urls.filter((u) => !u.gov && (u.riskTld || u.shortener)),
    nonGovUrls: urls.filter((u) => !u.gov),
  };
}

/* ---------------------------------------------- 4. 판정 */
export const VERDICT = {
  VERIFIED: { code: "VERIFIED", grade: "①", label: "공고 확인됨", tone: "safe" },
  UNKNOWN: { code: "UNKNOWN", grade: "②", label: "공고 미확인", tone: "caution" },
  FRAUD: { code: "FRAUD", grade: "③", label: "사기 의심", tone: "danger" },
  BROKER: { code: "BROKER", grade: "④", label: "브로커 개입 의심", tone: "warn" },
};

const today = () => new Date().toISOString().slice(0, 10);

export function judge({ extracted, signals, matches }) {
  const reasons = { L1: [], L2: [], L3: [] };
  let risk = 0;

  /* ── 1계층 : 공고 사실 대조 ── */
  const best = matches[0];
  const strong = best && best.score >= 0.55;
  const weak = best && best.score >= 0.38 && best.score < 0.55;
  let expired = false;

  if (strong) {
    const it = best.item;
    expired = it.end && it.end < today();
    reasons.L1.push(
      `정부 공고 데이터에서 「${it.name}」 확인 (${it.org}${it.start ? `, 접수 ${it.start}~${it.end}` : ""})`
    );
    if (expired) {
      reasons.L1.push(`다만 해당 공고의 접수기간이 ${it.end}자로 이미 종료됨 — 현재 접수 중인 사업이 아님`);
      risk += 30;
    }
  } else if (weak) {
    reasons.L1.push(
      `유사한 명칭의 공고(「${best.item.name}」)가 있으나 사업명이 정확히 일치하지 않음 — 실제 사업명을 미세 변형한 사칭일 수 있음`
    );
    risk += 25;
  } else if (extracted.claimed_program) {
    reasons.L1.push(
      `문자가 언급한 「${extracted.claimed_program}」은(는) 정부 공고 데이터에서 확인되지 않음`
    );
    risk += 35;
  } else {
    reasons.L1.push("문자에 대조 가능한 구체적 사업명이 제시되지 않음 — 공식 공고 안내의 통상 형식과 상이");
    risk += 20;
  }

  /* ── 2계층 : 수법 패턴 ── */
  if (signals.credit.length) {
    reasons.L2.push(`정책자금·공적 지원에서 사용하지 않는 여신 조건 문구 사용 (${signals.credit.join(", ")})`);
    risk += 25;
  }
  if (signals.selected.length) {
    reasons.L2.push(`사전 신청 없이 '선정·확정'을 통보하는 형식 (${signals.selected.join(", ")}) — 공적 지원은 신청 절차 없이 선정되지 않음`);
    risk += 20;
  }
  if (signals.pressure.length) {
    reasons.L2.push(`즉시 행동을 압박하는 문구 (${signals.pressure.slice(0, 4).join(", ")})`);
    risk += 12;
  }
  if (signals.badUrls.length) {
    reasons.L2.push(`공공기관 도메인이 아닌 의심 주소 포함 (${signals.badUrls.map((u) => u.host).join(", ")})`);
    risk += 30;
  } else if (signals.nonGovUrls.length && !strong) {
    reasons.L2.push(`정부·공공기관 도메인(go.kr·or.kr)이 아닌 주소 포함 (${signals.nonGovUrls.map((u) => u.host).join(", ")})`);
    risk += 15;
  }
  if (signals.install.length) {
    reasons.L2.push(`앱·프로그램 설치를 요구 (${signals.install.join(", ")}) — 악성앱 설치 유도 수법`);
    risk += 30;
  }
  if (signals.intlSend.length) {
    reasons.L2.push("국제발신 표시 — 국내 공공기관 안내에서는 사용되지 않음");
    risk += 15;
  }
  if (signals.evasion) {
    reasons.L2.push("단어 사이에 특수문자·공백을 삽입한 흔적 — 스팸 필터 회피 기법");
    risk += 20;
  }

  /* ── 3계층 : 브로커 개입 ── */
  if (signals.broker.length) {
    reasons.L3.push(`수수료·대행 관련 요구 확인 (${signals.broker.join(", ")}) — 정부 지원사업 신청은 전액 무료`);
    risk += 35;
  }
  if (signals.channel.length) {
    reasons.L3.push(`공식 창구가 아닌 개인 메신저 상담으로 유도 (${signals.channel.join(", ")})`);
    risk += 25;
  }
  if (extracted.requests_money) {
    reasons.L3.push("금전 송금 또는 선입금을 요구");
    risk += 30;
  }

  /* ── 등급 결정 ── */
  let v;
  const brokerHit = signals.broker.length > 0 || extracted.requests_money;
  const fraudScore =
    signals.credit.length * 2 +
    signals.selected.length * 2 +
    signals.badUrls.length * 3 +
    signals.install.length * 3 +
    (signals.evasion ? 2 : 0) +
    signals.intlSend.length +
    (signals.pressure.length ? 1 : 0);

  if (brokerHit) v = VERDICT.BROKER;
  else if (strong && !expired && fraudScore < 3) v = VERDICT.VERIFIED;
  else if (!strong && fraudScore >= 3) v = VERDICT.FRAUD;
  else if (strong && expired) v = VERDICT.UNKNOWN;
  else if (strong) v = VERDICT.VERIFIED;
  else v = VERDICT.UNKNOWN;

  risk = Math.max(0, Math.min(100, v.code === "VERIFIED" ? Math.min(risk, 15) : risk));

  return {
    verdict: v,
    risk,
    reasons,
    match: strong || weak ? { ...best.item, score: Number(best.score.toFixed(3)), strong, expired } : null,
    candidates: matches.slice(0, 3).map((m) => ({ name: m.item.name, org: m.item.org, url: m.item.url, score: Number(m.score.toFixed(3)) })),
  };
}

/* ---------------------------------------------- 5. 안내 문안 */
export function guidance(v, match) {
  switch (v.code) {
    case "VERIFIED":
      return {
        headline: "정부 공고 데이터에서 동일한 사업이 확인되었습니다.",
        action: "다만 문자 속 링크는 누르지 마시고, 아래 공식 공고 페이지에서 직접 신청하십시오.",
        cta: match ? { text: "공식 공고 확인하기", url: match.url } : null,
      };
    case "UNKNOWN":
      return {
        headline: "공고 데이터에서 확인되지 않았습니다. 사기로 단정할 수는 없습니다.",
        action:
          "지방자치단체 자체사업이나 신규 공고는 아직 수집되지 않았을 수 있습니다. 문자에 적힌 번호가 아니라 소관기관 대표번호로 직접 확인하십시오.",
        cta: { text: "기업마당에서 직접 검색", url: "https://www.bizinfo.go.kr/sii/siia/selectSIIA200View.do" },
      };
    case "FRAUD":
      return {
        headline: "사기로 의심됩니다. 링크를 누르거나 회신하지 마십시오.",
        action:
          "해당 문자를 삭제하지 말고 화면을 캡처해 두신 뒤 신고하십시오. 이미 링크를 눌렀다면 즉시 통신사·금융회사에 알리시기 바랍니다.",
        cta: { text: "불법스팸 신고 (KISA 118)", url: "https://spam.kisa.or.kr" },
      };
    case "BROKER":
      return {
        headline: "수수료·대행을 요구하는 제3자 개입이 의심됩니다.",
        action:
          "정부 지원사업 신청은 전액 무료이며, 대행 수수료를 요구하는 행위는 부당개입에 해당합니다. 직접 신청이 가능합니다.",
        cta: { text: "제3자 부당개입 신고", url: "https://www.semas.or.kr" },
      };
    default:
      return { headline: "", action: "", cta: null };
  }
}

/* ---------------------------------------------- 6. AI 미사용 시 대체 추출 */
const ORG_RE = /(중소벤처기업부|중소기업벤처부|소상공인시장진흥공단|중소벤처기업진흥공단|기술보증기금|신용보증기금|창업진흥원|[가-힣]{2,10}(?:테크노파크|진흥원|공단|재단|센터|청|시청|군청|구청|도청))/;

export function heuristicExtract(text) {
  const t = String(text || "").replace(/['`·]{1,3}(?=[가-힣])/g, "").replace(/([가-힣]),{1,3}(?=[가-힣])/g, "$1");
  let name = "";

  // ① 『』「」 인용부호 — 가장 강한 신호
  let m = t.match(/[『「]([^』」]{4,50})[』」]/);
  if (m) name = m[1];

  // ② 사업명 접미어 패턴
  if (!name) {
    m = t.match(/([가-힣A-Za-z0-9·\-\s]{4,50}?(?:지원사업|지원금|정책자금|보조금|융자사업|융자|바우처|특별자금|보상금|보전금|모집\s*공고|지원\s*공고))/);
    if (m) name = m[1];
  }

  // ③ 대괄호 — 기관명만 들어 있으면 제외
  if (!name) {
    m = t.match(/\[([^\]]{4,50})\]/);
    if (m && !ORG_RE.test(m[1]) && !/발신/.test(m[1])) name = m[1];
  }

  name = name.replace(/^\s*(?:\[[^\]]{1,14}\]|○|◦|▶|※)\s*/g, "").trim();

  return {
    claimed_program: name,
    claimed_org: (t.match(ORG_RE) || [])[1] || "",
    claimed_amount: (t.match(/[\d,.]+\s*(?:만원|억원|천만원|%|퍼센트)/) || [])[0] || "",
    claimed_period: (t.match(/\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2}|\d{1,2}\s*월\s*\d{1,2}\s*일\s*(?:까지|마감)?/) || [])[0] || "",
    is_policy_fund_claim: /정책자금|지원금|보조금|융자|소상공인|손실보상|대출|지원사업/.test(t),
    requests_money: /(수수료|선입금|착수금|성공보수|송금|입금\s*바랍)/.test(t),
    requests_personal_info: /(주민등록|신분증|통장\s*사본|사업자등록증|개인정보)/.test(t),
    summary: "",
    _engine: "rule",
  };
}

/* ---------------------------------------------- 7. 최신 공고 실시간 보강 */
const unesc = (s) => s.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
  .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim();

export function parseBizinfoHtml(html) {
  const rows = [];
  const trRe = /<tr>([\s\S]*?)<\/tr>/g; let m;
  while ((m = trRe.exec(html))) {
    const tr = m[1];
    if (!tr.includes("selectSIIA200Detail")) continue;
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => unesc(x[1].replace(/<[^>]+>/g, " ")));
    const idm = tr.match(/pblancId=(PBLN_\d+)/);
    const nm = tr.match(/<a[^>]*>([\s\S]*?)<\/a>/);
    if (!idm || !nm) continue;
    const period = (tds.find((t) => /\d{4}-\d{2}-\d{2}\s*~/.test(t)) || "").trim();
    const [start, end] = period.split("~").map((s) => (s || "").trim());
    const name = unesc(nm[1]);
    rows.push({ src:"기업마당(실시간)", id:idm[1], name, field:tds[1]||"", start:start||"", end:end||"",
      region:tds[4]||"", org:tds[5]||"", key:normalize(name),
      url:"https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId="+idm[1] });
  }
  return rows;
}

let LIVE = { at: 0, items: [] };
export async function liveTopUp(pages = 3, ttlMs = 300000, timeoutMs = 4500) {
  if (Date.now() - LIVE.at < ttlMs && LIVE.items.length) return LIVE.items;
  const out = [];
  try {
    for (let p = 1; p <= pages; p++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(
        "https://www.bizinfo.go.kr/sii/siia/selectSIIA200View.do?schEndAt=N&cpage=" + p,
        { headers: { "User-Agent": "Mozilla/5.0 (compatible; JinjjaGonggo/1.0)" }, signal: ctrl.signal }
      );
      clearTimeout(t);
      if (!r.ok) break;
      out.push(...parseBizinfoHtml(await r.text()));
    }
  } catch { /* 실패 시 스냅샷만 사용 */ }
  if (out.length) LIVE = { at: Date.now(), items: out };
  return LIVE.items;
}
