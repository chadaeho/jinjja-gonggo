/** 진짜공고 — 판별 엔진 자체 검증 (AI 없이 규칙 기반으로 실행) */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { maskPII, ruleSignals, matchProgram, judge, guidance, heuristicExtract } from "../api/_lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "announcements.json"), "utf-8"));

function verify(raw) {
  const { text, masked } = maskPII(raw);
  const extracted = heuristicExtract(text);
  const signals = ruleSignals(text);
  let matches = matchProgram(extracted.claimed_program || "", DB);
  if (!matches.length && extracted.claimed_program) matches = matchProgram(text.slice(0, 120), DB);
  const r = judge({ extracted, signals, matches });
  return { masked, extracted, ...r, guide: guidance(r.verdict, r.match) };
}

/* ---------- 테스트 케이스 ---------- */
const today = new Date().toISOString().slice(0, 10);
const live = DB.items.find((i) => i.start <= today && i.end >= today) || DB.items[0];

const CASES = [
  {
    name: "① 진짜 공고 (현행 실데이터)",
    expect: "VERIFIED",
    text: `[${live.org}] ${live.name}\n○ 접수기간 : ${live.start} ~ ${live.end}\n○ 신청방법 : 기업마당 누리집에서 온라인 접수`,
  },
  {
    name: "③ 사기 의심 (부재 사업명 + 선정통보 + 의심도메인)",
    expect: "FRAUD",
    text:
      "[국제발신] 귀하께서는 『2026년 소상공인 긴급경영안정 특별보전지원금』 지급 확정 대상자로 선정되어 마감 전 재안내드립니다.\n예산 조기 소진 예정으로 금일 18시까지 신청 마감함을 알려드립니다.\n▶ 신청 확인 : http://smb-support-kr.shop/apply",
  },
  {
    name: "④ 브로커 (대행 + 수수료 + 카톡 유도)",
    expect: "BROKER",
    text:
      "정책자금 컨설팅 담당입니다. 소상공인 정책자금 신청 대행해 드립니다. 승인율 95%.\n착수금 없이 성공보수 수수료 5%만 받습니다. 카카오톡 아이디 pmxxx 친구추가 후 1:1 채팅 주세요.",
  },
  {
    name: "② 공고 미확인 (지자체 자체사업 — 오탐 방지)",
    expect: "UNKNOWN",
    text:
      "[○○군청] 2026년 관내 소상공인 경영개선 자체지원사업 안내\n○ 지원내용 : 점포 환경개선비 최대 200만원\n○ 접수기간 : 8월 10일 ~ 8월 29일\n○ 접수처 : 군청 지역경제과 방문 접수",
  },
  {
    name: "③ 대출사기형 (회피문자 + 무신용 + 메신저)",
    expect: "BROKER",
    text:
      "최고의 조건으로 이용가능한 자,,금을 전해드립니다. 생,계에 위협이 느껴질때 도움될수 있는 대'출'을 확인해보세요.\n연 이율 5%~8% 내외 / 한도 500만~9천만 / 직업과 소득 확인이 어렵거나 연체중이신 분들도 가능\n카카오톡 ID: pm*** 친구추가 후 일대일 채팅 부탁드립니다. 수수료 별도 안내.",
  },
  {
    name: "마스킹 검증 (개인정보 포함)",
    expect: null,
    text: "김사장님 010-1234-5678로 연락주세요. 국민은행 123-45-678901 입금 바랍니다. abc@test.com",
  },
];

let pass = 0, fail = 0;
console.log(`\n대조 데이터 : ${DB.count}건 (기준 ${String(DB.syncedAt).slice(0, 10)})\n${"=".repeat(72)}`);
for (const c of CASES) {
  const r = verify(c.text);
  const ok = c.expect === null || r.verdict.code === c.expect;
  if (c.expect !== null) ok ? pass++ : fail++;
  console.log(`\n■ ${c.name}`);
  console.log(`  판정   : ${r.verdict.grade} ${r.verdict.label} (${r.verdict.code})  위험도 ${r.risk}` +
    (c.expect ? `  → ${ok ? "PASS" : "FAIL (기대 " + c.expect + ")"}` : ""));
  if (r.masked.length) console.log(`  마스킹 : ${r.masked.join(", ")}`);
  if (r.extracted.claimed_program) console.log(`  추출   : ${r.extracted.claimed_program}`);
  if (r.match) console.log(`  대조   : ${r.match.name.slice(0, 40)} (${(r.match.score * 100).toFixed(0)}%)`);
  for (const [k, v] of Object.entries(r.reasons))
    v.forEach((x) => console.log(`   [${k}] ${x.slice(0, 96)}`));
}
console.log(`\n${"=".repeat(72)}\n결과 : ${pass} PASS / ${fail} FAIL\n`);
process.exit(fail ? 1 : 0);
