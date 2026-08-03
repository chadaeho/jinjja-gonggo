/**
 * 진짜공고 — 공고 데이터 동기화 (기업마당 오픈API)
 *   BIZINFO_KEY    : 기업마당 오픈API 인증키 (필수)
 *   DATA_GO_KR_KEY : K-Startup 오픈API 키 (선택 보강)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "announcements.json");
const UA = "Mozilla/5.0 (compatible; JinjjaGonggo/1.0)";

export function normalize(s) {
  return (s || "")
    .replace(/\[[^\]]{1,12}\]/g, " ")
    .replace(/\([^)]{0,30}\)/g, " ")
    .replace(/[^가-힣A-Za-z0-9]/g, "")
    .replace(/(제?\d+차|\d{4}년도?|\d+회)/g, "")
    .toUpperCase();
}

const stripTag = (s) =>
  String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();

async function fetchBizinfo(key) {
  const url = `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=${encodeURIComponent(key)}&dataType=json`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("bizinfo HTTP " + r.status);
  const j = await r.json();
  if (j.reqErr) throw new Error("bizinfo: " + j.reqErr);
  return (j.jsonArray || []).map((it) => {
    const [start, end] = String(it.reqstBeginEndDe || "").split("~").map((s) => (s || "").trim());
    return {
      src: "기업마당", id: it.pblancId, name: String(it.pblancNm || "").trim(),
      org: String(it.jrsdInsttNm || "").trim(),
      exec: String(it.excInsttNm || "").trim(),
      field: String(it.pldirSportRealmLclasCodeNm || "").trim(),
      target: String(it.trgetNm || "").trim(),
      start: start || "", end: end || "",
      apply: String(it.reqstMthPapersCn || "").trim().slice(0, 60),
      tel: String(it.refrncNm || "").trim().slice(0, 80),
      url: it.pblancUrl || "", site: it.rceptEngnHmpgUrl || "",
      tags: String(it.hashtags || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12),
      summary: stripTag(it.bsnsSumryCn).slice(0, 160),
    };
  });
}

async function fetchKStartup() {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) return [];
  const out = [];
  for (let page = 1; page <= 10; page++) {
    try {
      const r = await fetch(
        "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01" +
        `?serviceKey=${encodeURIComponent(key)}&page=${page}&perPage=100&returnType=json`,
        { headers: { "User-Agent": UA } });
      const j = await r.json();
      const items = j?.data || [];
      if (!items.length) break;
      for (const it of items) {
        const name = it.biz_pbanc_nm || it.intg_pbanc_biz_nm || "";
        if (!name) continue;
        out.push({
          src: "K-Startup", id: String(it.pbanc_sn || name), name,
          org: it.pbanc_ntrp_nm || "창업진흥원", exec: "", field: it.supt_biz_clsfc || "",
          target: it.aply_trgt || "",
          start: String(it.pbanc_rcpt_bgng_dt || "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
          end: String(it.pbanc_rcpt_end_dt || "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
          apply: "", tel: "", url: it.detl_pg_url || "https://www.k-startup.go.kr",
          site: "", tags: [], summary: String(it.pbanc_ctnt || "").slice(0, 160),
        });
      }
    } catch { break; }
  }
  return out;
}

const run = async () => {
  const key = process.env.BIZINFO_KEY;
  if (!key) { console.error("환경변수 BIZINFO_KEY 가 필요합니다."); process.exit(1); }
  const biz = await fetchBizinfo(key);
  console.log("기업마당 오픈API 수집:", biz.length, "건");
  const ks = await fetchKStartup();
  if (ks.length) console.log("K-Startup 보강:", ks.length, "건");

  const seen = new Set(); const items = [];
  for (const a of [...biz, ...ks]) {
    const k = a.src + "|" + a.id;
    if (seen.has(k) || !a.name) continue;
    seen.add(k);
    items.push({ ...a, key: normalize(a.name) });
  }
  const orgs = [...new Set(items.flatMap((i) => [i.org, i.exec]).filter(Boolean))];
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ syncedAt: new Date().toISOString(), count: items.length, orgs, items }), "utf-8");
  console.log("저장 완료:", items.length, "건 / 기관", orgs.length, "개");
};
run();
