# 진짜공고 (JINJJA-GONGGO)
소상공인 정책자금 사칭 판별 AI — 2026 금융 AI Challenge 출품작

> 문장이 사기처럼 **보이는지**가 아니라, 그 사업이 실제로 **존재하는지**를 확인합니다.

---

## 1. 구성

```
public/index.html        화면 (모바일 우선, 무설치·무가입)
api/verify.js            판별 API — AI 추출 → 공고 대조 → 4단계 판정
api/sample.js            심사·시연용 샘플 4종 (①은 현행 실제 공고에서 자동 생성)
api/health.js            배포 후 상태 점검
api/_lib.js              판별 엔진 (마스킹·유사도·규칙·판정)
data/announcements.json  정부 공고 스냅샷 (기업마당 공개자료)
scripts/sync.mjs         공고 데이터 동기화
scripts/selftest.mjs     판별 엔진 자체 검증
scripts/dev.mjs          로컬 실행용 간이 서버
```

빌드 도구·프레임워크·외부 패키지가 **하나도 없습니다.** 설치할 것이 없으므로 배포 실패 위험이 낮습니다.

---

## 2. 배포 (브라우저만으로 가능 · 약 10분)

### ① GitHub에 파일 올리기
1. https://github.com 가입 → 우측 상단 **+ → New repository**
2. 이름 `jinjja-gonggo`, **Public** 선택 → Create
3. **uploading an existing file** 클릭 → 이 폴더의 **내용물 전체**를 끌어다 놓기
   - 폴더째가 아니라 `api`, `data`, `public`, `scripts`, `package.json`, `vercel.json`을 올립니다.
4. **Commit changes**

### ② Vercel에 연결하기
1. https://vercel.com → **Continue with GitHub** 로 가입
2. **Add New… → Project** → 방금 만든 저장소 **Import**
3. Framework Preset은 **Other** 로 두고, 아래 환경변수만 추가
   | Name | Value |
   |---|---|
   | `GEMINI_API_KEY` | 발급받은 Gemini API 키 |
4. **Deploy** → 1~2분 후 `https://jinjja-gonggo-xxxx.vercel.app` 주소 발급

### ③ 배포 확인
- `https(주소)/api/health` 접속 → `"keyPresent": true` 와 `availableFlash` 목록이 보이면 정상
- 첫 화면에서 **샘플 4종 버튼**을 눌러 판정이 나오는지 확인

> **키가 없거나 오류여도 서비스는 멈추지 않습니다.** AI 추출이 실패하면 규칙 기반으로 자동 전환되어 판별이 계속됩니다(화면 하단에 표시).

---

## 3. 제출 전 점검 (2026. 9. 7. 이전)

- [ ] `npm run sync` 실행 후 `data/announcements.json` 갱신·재업로드 → **공고 데이터 최신화**
- [ ] `/api/health` 정상 응답 확인
- [ ] 샘플 4종 모두 의도한 등급(①②③④)으로 판정되는지 확인
- [ ] 휴대전화에서 접속하여 화면 확인
- [ ] **9. 7. 11:00 ~ 9. 11. 23:59 접속 유지** — Vercel 무료 요금제는 유휴 절전이 없어 상시 접속 가능

---

## 4. 판별 구조

| 계층 | 내용 | 방식 |
|---|---|---|
| 1계층 | 공고 사실 대조 | 정부 공고 데이터와 사업명·기관·기간 대조 (Dice 2-gram 유사도) |
| 2계층 | 사기 수법 패턴 | 여신조건 문구·선정통보·압박문구·의심도메인·회피문자·앱설치 유도 |
| 3계층 | 브로커 개입 | 수수료·대행·선입금 요구, 개인 메신저 상담 유도 |

**판정 4단계** — ① 공고 확인됨 / ② 공고 미확인 / ③ 사기 의심 / ④ 브로커 개입 의심

- **판정은 결정론적 규칙으로 확정**하며, 생성형 AI는 문자에서 사실 정보를 추출하는 역할만 수행합니다 → 환각(Hallucination)이 판정을 좌우하지 않습니다.
- ②를 별도 등급으로 둔 이유: 지자체 자체사업·신규 공고는 공공데이터에 미등재될 수 있으므로 **‘미확인’을 ‘사기’로 단정하지 않기** 위함입니다.
- 스냅샷에서 확인되지 않으면 **기업마당 최신 공고를 실시간으로 재조회**하여 오탐을 한 번 더 줄입니다.

## 5. 개인정보 처리

- 전송 **전** 브라우저에서 휴대전화·전화·주민등록번호·사업자등록번호·카드번호·계좌번호·이메일 자동 마스킹
- 서버에서 동일 규칙으로 **2차 마스킹** (클라이언트 우회 대비)
- 입력 원문·판별 결과 **저장·로깅하지 않음**, 응답 후 즉시 폐기
- 회원가입·로그인 없음 → **수집하는 개인정보 항목 자체가 없음**

## 6. 데이터 출처

- 중소벤처기업부 **기업마당** 지원사업 공고 (공공누리 개방자료)
- (선택) **K-Startup** 지원사업 공고정보 오픈API — `DATA_GO_KR_KEY` 환경변수 설정 시 자동 보강

## 7. 로컬 실행

```bash
node scripts/sync.mjs      # 공고 데이터 수집
node scripts/selftest.mjs  # 판별 엔진 검증
node scripts/dev.mjs       # http://localhost:3000
```
