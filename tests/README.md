# 자동 테스트 스위트

`index.html`을 jsdom(가상 브라우저)으로 띄워 실제 UI 동작을 검증합니다.
**기능을 수정한 뒤에는 이 테스트들을 돌려 회귀가 없는지 확인하세요.**

## 실행 방법

```powershell
cd tests
npm init -y
npm install jsdom
node persisttest.js   # 하나씩 실행
```

> 각 테스트는 `C:/Users/Owner/scheduler/index.html` 절대 경로를 읽습니다. 폴더를 옮겼다면 파일 상단의 경로를 수정하세요.

## 테스트 목록

| 파일 | 검증 내용 |
|---|---|
| `persisttest.js` | **JSON 저장 완전성** — 모든 데이터가 저장 경로 7곳에 등록됐는지(정적) + 저장→복원 바이트 일치(왕복). **새 데이터 종류를 추가하면 이 파일의 DATASETS/LS_KEYS 목록에도 추가할 것** |
| `walktest.js` | 6개 뷰 + 모달 + 삭제 정리까지 18단계 UI 워크스루 |
| `monkeytest.js` | 전 화면 무차별 클릭 379회 + 파괴 경로(삭제 승인) — 런타임 에러 0 확인 |
| `modaltest.js` | 모달 저장 경로: N일마다 반복, 정확도 클램프, 범위 할일 규칙, 키보드 가드 등 8종 |
| `rangetest.js` | 기간 일정: 매일 표시, D-day 종료일 기준, 역순 교정, 연속 막대 |
| `scopetest.js` | 월간/주간 할일 패널 표시·숨김·체크 |
| `erasetest.js` | 타임블록 지우개·색칠과 분 단위 장부 정합성 |
| `edgetest.js` | 타이머 30분 백필, 손상된 저장 데이터 부팅, 불완전한 가져오기 파일 |

## jsdom 한계 (테스트 안에서 스텁 처리됨)

- `scrollIntoView`, `URL.createObjectURL` 없음 → beforeParse에서 스텁
- `indexedDB` 없음 → 사진 저장은 콘솔 경고만 나고 무시됨 (정상)
- `documentPictureInPicture` 없음 → 위젯 모드는 자동 테스트 불가 (수동 확인 필요)
