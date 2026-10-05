# 복구판 검사 결과와 검증 시점

## Native Port 수정 이후 전체 재검증

2026-10-06 01:53:38부터 Windows/Node 24.15.0/npm 12.1.0 환경에서
아래 portable 전체 명령을 다시 실행했다. 태블릿에서 재현한 native Port의
건설 간격·실제 해안 위치와 미리보기 불일치 수정, 최종 EN/KO 문구를 포함한다.

| 실행                     | 결과                                   | 시간·종료 코드   | 작업 공간 로그                               |
| ------------------------ | -------------------------------------- | ---------------- | -------------------------------------------- |
| 최신 전체 portable 회귀  | 615파일, 7,742검사 통과·1 skip, 실패 0 | 504.81초, exit 0 | `outputs/repair-acceptance-final-full.log`   |
| 별도 `tests/server` 단계 | 81파일, 904검사 통과, 실패 0           | 50.43초, exit 0  | `outputs/repair-acceptance-final-server.log` |
| `npm run lint`           | oxlint와 eslint 통과                   | exit 0           | `outputs/repair-acceptance-final-lint.log`   |

시작·종료 시 같은 범위의 1,590파일 SHA-256을 대조했다. core, tests,
교육·언어 자료와 scripts의 변경은 0개다. 실행 중 `PlayPage.ts` 한 파일만
모바일 헤더에 가린 저장 관리 버튼 위치를 수정했다. 이 후속 UI 수정의
범위 검사·타입 검사·lint·실제 메뉴 클릭은 통합 보고서에 별도로 기록한다.
전체 7,742개 결과를 그 버튼 수정의 완료 증거로 사용하지 않는다.

Manifest는 `outputs/repair-acceptance-final-source-before.json`과
`repair-acceptance-final-source-after.json`이며, 유일한 변경의 SHA-256은
`90fc270d38d23eb3b0db70f2fe4e2062ac9665d68d86607ba10453140b325afa`에서
`be9ff040edf66250a5b600e0c243f9e6e3e88de2a81aadf386357926b9b5746b`이다.
904개 서버 검사는 전체에도 포함되므로 통과 수에 더하지 않는다. 아래의
POSIX 6파일 제외와 snapshot fixture 생성 1개 skip 조건은 이번에도 같다.
Git commit과 실제 브라우저 빌드 식별자는 통합 보고서에서 확인한다.

전체 실행 종료 뒤 `SavePanel.ts`의 쌓임 순서도 추가로 수정했다. 원본 국가
정보 hover보다 위, 최상위 모달보다 아래에 배치하여 고해상도 화면에서 닫기
버튼이 가려진 실제 결함을 처리한 CSS 변경이다. 따라서 마지막 UI 단계와
시작 manifest를 비교하면 `PlayPage.ts`와 `SavePanel.ts` **두 파일**이 다르다.
종료 직후 manifest를 덮어쓰지 않고
`outputs/repair-acceptance-final-ui-source-after.json`에 이 후속 단계를 보존했다.
core/tests/교육·언어 자료/scripts는 같은 상태다.
두 후속 UI 수정까지 포함한 whole `npm run lint`도 exit 0이었다.
로그는 `outputs/repair-acceptance-late-ui-lint.log`이다. 이 후속 lint를
전체 회귀의 재실행으로 표시하지 않는다.

마지막 도움말의 `[`/`]` 표시도 실제 replay 표에서 확인하여
`HelpModal.ts`와 새 `tests/client/HelpInputLabels.test.ts`를 보완했다. 후속
4파일 11검사가 통과했다(39.04초, `outputs/repair-help-label-tests.log`).
최종 manifest `repair-acceptance-final-release-source-after.json`은 1,591파일이며
전체 실행 시작과 다른 경로는 **PlayPage.ts, SavePanel.ts, HelpModal.ts,
HelpInputLabels.test.ts** 네 개다. Utils/KeyLabel은 이 manifest 비교에서 후속
변경이 아니었다. 마지막 두 UI 검사·브라우저 단계와 7,742개 전체 실행의
범위를 구분한다. 최종 client는 `index-BQUAIhRR.js`, 기록 build는
`01021f0de686da860e30a6c96f8a06a16e5771c91d10a30d2a24db95027a5a29`다.

## 최종 공개 저장의 별도 core 복원 조사

오래 사용한 브라우저 자동화 세션의 이어하기 무응답 후보 때문에, 정상 UI에서
내보낸 `output/playwright/repair-release-before.json`을 읽기 전용 Node 조사로
복원했다. 저장 tick 48·paused와 modern hash `3376736265`, 두 육군의 실제
좌표 `579706`/`581706`, 명령 issued tick 36·대기 명령 tick 44를 확인했다.
복원 직후 294개 이름·4,000,000개의 packed 타일 값을 만드는 full View는
종료했고 tick·modern hash를 바꾸지 않았다. 이어서 20개의 tick을 조사 도구에서
명시적으로 요청하여 68까지 실행했으며 무한 반복은 재현되지 않았다.
paused flag를 유지한 직접 core 호출은 실제 LocalServer의 일시정지 동작이나
브라우저의 자동 게임 진행을 검증하는 조건이 아니다.

재인코딩한 바이너리의 객체 키 삽입 순서는 달랐지만, 디코딩한 전체 snapshot
값의 deep comparison은 같은 값이었다(차이 0). 이를 바이너리 일치로 쓰지
않는다. source SHA는
`86d0d1adfedfdedf94d75aed2dfe4985a55dcae50dc0c547a56cc12c6ddcae34`이며
조사 전후 같았다. 로그·결과는 `outputs/repair-release-48-core.log/json`에 있다.
이 조사는 DOM·렌더러·CDP·OS 응답의 원인을 확정하지 않는다. 실제 새 프로필의
공개 파일 가져오기·이어하기·재저장·실제 이동 결과는 통합 브라우저 기록을 따른다.

## 이전 동결 후보의 전체 검사

2026-10-06 Windows 환경, Node 24.15.0/npm 12.1.0에서 실행했다.
검증 빌드 식별자는 `64a4a035a0e4`이며, 작업 브랜치는
`feature/strategic-ai-modern-world`이다. 이 식별자는 Git commit이 아니다.
시작과 종료 시 `src`, `tests`, 교육·언어 자료, `scripts`의 파일별 SHA-256을
대조했다. 1,590개 파일이 같았으며 실행 중 source 변경은 0개다.

| 실행                                    | 결과                                   | 시간·종료 코드   | 작업 공간 로그                         |
| --------------------------------------- | -------------------------------------- | ---------------- | -------------------------------------- |
| 이전 후보 전체 portable 회귀            | 615파일, 7,736검사 통과·1 skip, 실패 0 | 510.01초, exit 0 | `outputs/repair-acceptance-full.log`   |
| package.json의 별도 `tests/server` 단계 | 81파일, 904검사 통과, 실패 0           | 50.69초, exit 0  | `outputs/repair-acceptance-server.log` |
| `npm run lint`                          | oxlint와 eslint 통과                   | exit 0           | `outputs/repair-acceptance-lint.log`   |

이 전체 실행이 끝난 뒤 실제 국가 정보창에서 확인된 AI 성격의 미번역 키
5개를 EN/KO 문구로 추가했다. 이 문구 변경의 번역·교육 검사는 별도 후속
결과이며, 위 1,590파일 동일 확인과 전체 통과는 **해당 실행 시점**의 자료다.
후속 문구를 반영한 전체 재실행으로 표시하지 않는다.

그 뒤 태블릿에서 발견한 native Port의 시설 간격·조정 위치와 현대 건설
미리보기 불일치도 수정했다. 이 후속 변경은 core·패널·native Port·캐시
5파일 85검사 통과(10.04초), TypeScript/변경 파일 lint exit 0으로 확인했다.
`repair-native-port-validation-tests/tsc/lint.log`에 기록하며, 위 전체 동결
실행에 이미 포함된 수정으로 표시하지 않는다. 실제 새 빌드 태블릿 결과는
통합 플레이 보고서에 별도로 기록한다.

별도 서버 단계는 전체 회귀에도 포함된 검사를 다시 실행한 결과다. 904개를
전체 7,736개에 더해 고유 검사 수로 보고하지 않는다. 저장·snapshot migration,
native 전투, 리플레이 codec, Classic 및 최신 군종/터치 입력도 전체 범위에
포함된다. 통과 개수는 실제 브라우저의 발견 가능성·교육 완주·승패·성능 목표
달성의 증거를 대신하지 않는다. 해당 결과와 남은 제한은
[실제 플레이 복구 검증](ModernRepairVerification.md)을 따른다.

## 실행한 명령과 제외 범위

`package.json`의 `test`는 `vitest run && vitest run tests/server`이다.
이번 환경에서는 아래처럼 두 단계를 실행했고, 첫 단계의 POSIX 배포 셸
6파일만 제외했다. 전체 `npm test`를 수정 없이 통과했다고 보고하지 않는다.

```sh
npx vitest run \
  --exclude tests/DeployIdentity.test.ts \
  --exclude tests/GenerateNginxUpstream.test.ts \
  --exclude tests/UpdateFlagLatest.test.ts \
  --exclude tests/UpdateRegister.test.ts \
  --exclude tests/UpdateRestartPolicy.test.ts \
  --exclude tests/UpdateTraefikHostRule.test.ts \
  --maxWorkers=2 --testTimeout=20000 --reporter=dot
npx vitest run tests/server --maxWorkers=2 --testTimeout=20000 --reporter=dot
npm run lint
```

실제 도구 실행은 설치된 `node_modules/vitest/vitest.mjs`를 Node로 호출했으며
위 `npx` 명령과 같은 로컬 Vitest 및 인수를 사용했다. npm lint는 script 그대로
실행했다. 이 환경에는 `sh`와 `jq`가 없고 Windows 시스템 `bash.exe`만 있었다.
앞선 제외 없는 전체 실행에서 이 6파일의 67건은 `sh ENOENT` 또는 배포용
`bash -c`/도구 의존 때문에 실패했다. 이 배포 셸 기능은 최종 portable 통과에
포함하지 않으며 POSIX 도구가 있는 환경에서 별도 검증이 필요하다.

단일 skip은 기존 `tests/core/snapshot/SnapshotFixtures.test.ts`의 fixture
재생성 작업이다. `UPDATE_SNAPSHOT_FIXTURES`가 설정된 경우만 실행하는
`test.runIf`이므로 일반 검증에서 원본 fixture를 덮어쓰지 않는다. 기존 fixture
호환성 검사는 실행했으며, 이번 복구 검사를 건너뛰어 통과 수를 맞추지 않았다.

## 이전 실패와 최종 결과 구분

첫 전체 실행은 613파일 통과·8파일 실패였다. POSIX 6파일 외에는 도움말 번역
누락과 제한적인 ReplayPanel Lit mock의 `query` export 누락을 수정했다.
그 다음 portable 실행의 614파일 통과·ModernInput 2건 실패는 touch 입력
개발 도중의 상태였다. 최종 canvas pointer/RAF/확정 경로 검사와 전체 동결
실행에서 다시 확인했으며, 이 두 실패도 위 최종 실행에서는 재현되지 않았다.

파일별 manifest는 작업 공간 `outputs/repair-acceptance-source-before.json`,
`repair-acceptance-source-after.json`에 있다. 이전 `4bd7f36b1403`의 9회 성능과
최종 `84bebb823344`의 paired 4회는 [실측 표와 미달](benchmarks/repair/perf/REPORT.md)에
서로 다른 source SHA·실행 시점으로 보존한다. 최신 두 mixed의 p95 증가는
+8.60%/+9.40%였으나 이전 mixed +20.60%, low +28.18%와 서로 다른 규모의
v1/v2 전체 비용 목표 미달은 유지한다. 전체 회귀 통과나 좋은 표본 두 개로
전체 설정의 성능 목표를 달성했다고 주장하지 않는다.
