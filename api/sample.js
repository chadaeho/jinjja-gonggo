import fs from "node:fs";
import path from "node:path";

let DB = null;
function db() {
  if (DB) return DB;
  DB = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "announcements.json"), "utf-8"));
  return DB;
}

/** 심사자용 샘플 4종 — ①은 실제 현행 공고에서 자동 생성 */
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const D = db();
  const today = new Date().toISOString().slice(0, 10);
  const live =
    D.items.find((i) => i.start && i.end && i.start <= today && i.end >= today && i.name.length < 45) ||
    D.items[0];

  const samples = [
    {
      id: "real",
      label: "진짜 공고 안내",
      desc: "현재 접수 중인 실제 지원사업 (자동 반영)",
      text: `[${live.org}] ${live.name}\n○ 접수기간 : ${live.start} ~ ${live.end}\n○ 신청방법 : 기업마당 누리집에서 온라인 접수\n○ 문의 : ${live.org} 담당부서`,
    },
    {
      id: "fraud",
      label: "사기 의심 문자",
      desc: "존재하지 않는 사업명 + 선정 통보 + 의심 주소",
      text:
        "[국제발신] 귀하께서는 『2026년 소상공인 긴급경영안정 특별보전지원금』 지급 확정 대상자로 선정되어 마감 전 재안내드립니다.\n" +
        "예산 조기 소진 예정으로 금일 18시까지 신청 마감함을 알려드립니다.\n" +
        "▶ 신청 확인 : http://smb-support-kr.shop/apply\n" +
        "※ 미신청 시 지원 대상에서 자동 제외됩니다.",
    },
    {
      id: "broker",
      label: "브로커 개입 의심",
      desc: "신청 대행 및 수수료 요구",
      text:
        "안녕하세요 사장님, 정책자금 컨설팅 담당입니다.\n" +
        "소상공인 정책자금 신청 대행해 드리고 있습니다. 승인율 95% 이상입니다.\n" +
        "착수금 없이 성공보수 수수료 5%만 받습니다.\n" +
        "자세한 상담은 카카오톡 아이디 pmxxx 친구추가 후 1:1 채팅 주세요.",
    },
    {
      id: "unknown",
      label: "공고 미확인 (오탐 방지)",
      desc: "실재할 수 있으나 데이터 미등재 — 사기로 단정하지 않음",
      text:
        "[○○군청] 2026년 관내 소상공인 경영개선 자체지원사업 안내\n" +
        "○ 지원내용 : 점포 환경개선비 최대 200만원\n" +
        "○ 접수기간 : 8월 10일 ~ 8월 29일\n" +
        "○ 접수처 : 군청 지역경제과 방문 접수\n" +
        "자세한 사항은 군청 대표번호로 문의 바랍니다.",
    },
  ];

  res.status(200).json({ ok: true, samples, dataset: { syncedAt: D.syncedAt, count: D.count } });
}
