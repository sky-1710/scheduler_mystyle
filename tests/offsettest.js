// 1분 단위 타임블록: 임의의 분에서 시작하는 칠하기와 장부(timeLog) 정합성 검증
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('C:/Users/Owner/scheduler/index.html', 'utf8');

const pad2 = n => String(n).padStart(2, '0');
const now = new Date();
const ds = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  beforeParse(w) {
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.localStorage.setItem('startScreenOff', '1'); // 시작 화면이 UI를 가리지 않게
    w.localStorage.setItem('sched_v1', JSON.stringify([
      { id: 'T1', title: '공부', date: ds, isTodo: true, color: '#448361', priority: 'normal' },
      { id: 'T2', title: '운동', date: ds, isTodo: true, color: '#D44C47', priority: 'normal' },
    ]));
  },
});
const { window } = dom;
let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

setTimeout(() => {
  const w = window;
  // `blocks` 등은 let 이라 window 에 없다 -> 저장 후 localStorage 로 확인한다
  const snap = () => {
    w.saveEvents();
    const g = k => JSON.parse(w.localStorage.getItem(k) || '{}')[ds] || {};
    return { b: g('sched_blocks_v1'), m: g('sched_blockmin_v1'),
             o: g('sched_blockoff_v1'), x: g('sched_blockextra_v1'), t: g('sched_timelog_v1') };
  };

  // ---- 10:07 ~ 10:13 (7분) : 두 칸에 걸치고 첫 칸은 오프셋 7 ----
  w.paintTaskId = 'T1';
  w.paintSpan(ds, 10 * 60 + 7, 10 * 60 + 14, 'T1');
  check('10:07~10:14 첫 칸 소유', snap().b['10:00'], 'T1');
  check('10:07~10:14 첫 칸 오프셋', snap().o['10:00'], 7);
  check('10:07~10:14 첫 칸 길이', snap().m['10:00'], 3);
  check('10:07~10:14 둘째 칸 오프셋 없음', snap().o['10:10'], undefined);
  check('10:07~10:14 둘째 칸 길이', snap().m['10:10'], 4);
  check('장부 합계 = 7분', (snap().t['T1'] || 0), 7);

  // ---- 한 칸 안에서만: 14:02 ~ 14:05 (3분) ----
  w.paintSpan(ds, 14 * 60 + 2, 14 * 60 + 5, 'T1');
  check('14:02 오프셋', snap().o['14:00'], 2);
  check('14:02 길이', snap().m['14:00'], 3);
  check('장부 누적 = 10분', (snap().t['T1'] || 0), 10);

  // ---- 다른 작업이 일부를 덮어쓰면 겹친 분만 회수되고 나머지는 남는지 ----
  // T1 14:02~14:05 위에 T2 14:04~14:08 -> T1 14:02~14:04 + T2 14:04~14:08
  w.paintSpan(ds, 14 * 60 + 4, 14 * 60 + 8, 'T2');
  check('덮어쓴 뒤 첫 구간은 T1 그대로', snap().b['14:00'], 'T1');
  check('T1 구간 오프셋', snap().o['14:00'], 2);
  check('T1 구간 길이 2 (겹친 1분만 줄어듦)', snap().m['14:00'], 2);
  check('T2 는 같은 칸의 추가 구간', snap().x['14:00'], [{ id: 'T2', off: 4, len: 4 }]);
  check('T1 장부에서 겹친 1분만 회수', (snap().t['T1'] || 0), 9);
  check('T2 장부 4분', (snap().t['T2'] || 0), 4);

  // ---- 지우기: 칸 안의 모든 구간과 장부가 같이 0으로 ----
  w.clearCell(ds, '14:00');
  check('지운 뒤 칸 비어있음', snap().b['14:00'], undefined);
  check('지운 뒤 오프셋 제거', snap().o['14:00'], undefined);
  check('지운 뒤 추가 구간 제거', snap().x['14:00'], undefined);
  check('지운 뒤 T1 장부 7', (snap().t['T1'] || 0), 7);
  check('지운 뒤 T2 장부 0', (snap().t['T2'] || 0), 0);

  // ---- 자정 넘김 방어: 23:58 ~ 24:00 ----
  w.paintSpan(ds, 23 * 60 + 58, 24 * 60, 'T1');
  check('23:50 칸 오프셋', snap().o['23:50'], 8);
  check('23:50 칸 길이', snap().m['23:50'], 2);

  // ---- 저장 왕복: blockOff 가 localStorage 에 남는지 ----
  const stored = JSON.parse(w.localStorage.getItem('sched_blockoff_v1') || '{}');
  check('blockOff 저장됨', (stored[ds] || {})['10:00'], 7);

  console.log(fails ? `\n${fails} FAILURES` : '\n모든 검증 통과');
  process.exit(fails ? 1 : 0);
}, 1200);
