/**
 * 진짜공고 — 공고 데이터 동기화
 *   1) 기업마당(bizinfo) 공개 목록 : 인증키 불요
 *   2) K-Startup 오픈API          : DATA_GO_KR_KEY 있을 때만 (보강)
 * 결과: data/announcements.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "announcements.json");
const UA = "Mozilla/5.0 (compatible; JinjjaGonggo/1.0)";
const PAGES = Number(process.env.SYNC_PAGES || 60);

const unesc = (s) =>
  s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();

/** 사업명 정규화 — 대조 키 생성 */
export function normalize(s) {
  return (s || "")
    .replace(/\[[^\]]{1,12}\]/g, " ")          // [지역] 태그 제거
    .replace(/\([^)]{0,30}\)/g, " ")           // 괄호 보조설명 제거
    .replace(/[^가-힣A-Za-z0-9]/g, "")         // 특수문자·공백 제거
    .replace(/(제?\d+차|\d{4}년도?|\d+회)/g, "")
    .toUpperCase();
}

async function fetchBizinfoPage(cpage) {
  const url =
    "https://www.bizinfo.go.kr/sii/siia/selectSIIA200View.do?schEndAt=N&cpage=" + cpage;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error("bizinfo " + res.status);
  const html = await res.text();

  const rows = [];
  const trRe = /<tr>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = trRe.exec(html))) {
    const tr = m[1];
    if (!tr.includes("selectSIIA200Detail")) continue;
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => unesc(x[1].replace(/<[^>]+>/g, " ")));
    const idm = tr.match(/pblancId=(PBLN_\d+)/);
    const nm = tr.match(/<a[^>]*>([\s\S]*?)<\/a>/);
    if (!idm || !nm) continue;
    const name = unesc(nm[1]);
    const period = (tds.find((t) => /\d{4}-\d{2}-\d{2}\s*~/.test(t)) || "").trim();
    const [start, end] = period.split("~").map((s) => (s || "").trim());
    rows.push({
      src: "기업마당",
      id: idm[1],
      name,
      field: tds[1] || "",
      start: start || "",
      end: end || "",
      region: tds[4] || "",
      org: tds[5] || "",
      url: "https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=" + idm[1],
    });
  }
  return rows;
}

async function fetchKStartup() {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) return [];
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const url =
      "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01" +
      `?serviceKey=${encodeURIComponent(key)}&page=${page}&perPage=100&returnType=json`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      const j = await r.json();
      const items = j?.data || j?.response?.body?.items || [];
      if (!items.length) break;
      for (const it of items) {
        const name = it.biz_pbanc_nm || it.intg_pbanc_biz_nm || "";
        if (!name) continue;
        out.push({
          src: "K-Startup",
          id: String(it.pbanc_sn || it.id || name),
          name,
          field: it.supt_biz_clsfc || "",
          start: String(it.pbanc_rcpt_bgng_dt || "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
          end: String(it.pbanc_rcpt_end_dt || "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
          region: it.supt_regin || "",
          org: it.pbanc_ntrp_nm || "창업진흥원",
          url: it.detl_pg_url || "https://www.k-startup.go.kr",
        });
      }
    } catch (e) {
      console.error("kstartup page", page, e.message);
      break;
    }
  }
  return out;
}

const run = async () => {
  const all = [];
  for (let p = 1; p <= PAGES; p++) {
    try {
      const rows = await fetchBizinfoPage(p);
      if (!rows.length) break;
      all.push(...rows);
      process.stdout.write(`\r기업마당 수집 ${p}p / 누적 ${all.length}건`);
      await new Promise((r) => setTimeout(r, 120));
    } catch (e) {
      console.error("\npage", p, e.message);
      break;
    }
  }
  console.log("");
  const ks = await fetchKStartup();
  if (ks.length) console.log("K-Startup 보강", ks.length, "건");
  all.push(...ks);

  const seen = new Set();
  const items = [];
  for (const a of all) {
    const k = a.src + "|" + a.id;
    if (seen.has(k)) continue;
    seen.add(k);
    items.push({ ...a, key: normalize(a.name) });
  }

  // 기관명 사전(대조 보조)
  const orgs = [...new Set(items.map((i) => i.org).filter(Boolean))];

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      { syncedAt: new Date().toISOString(), count: items.length, orgs, items },
      null,
      0
    ),
    "utf-8"
  );
  console.log("저장 완료:", OUT, items.length, "건");
};

run();
