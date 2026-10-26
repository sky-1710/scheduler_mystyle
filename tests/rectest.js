// 타이머 기록: 칸 중간에서 시작하면 그 분 위치에 남아야 한다 (왼쪽부터 쌓이면 안 됨)
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
    w.localStorage.setItem('startScreenOff', '1');
    w.localStorage.setItem('sched_v1', JSON.stringify([
      { id: 'R1', title: '기록대상', date: ds, isTodo: true, color: '#448361', priority: 'normal' },
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

// 기준 시각을 고정해 틱을 재현한다
function at(h, m) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 30);
  const Real = Date;
  window.Date = class extends Real {
    constructor(...a) { return a.length ? new Real(...a) : new Real(d); }
    static now() { return d.getTime(); }
  };
  window.Date.prototype = Real.prototype;
}

setTimeout(() => {
  const w = window;
  const snap = () => {
    w.saveEvents();
    const g = k => JSON.parse(w.localStorage.getItem(k) || '{}')[ds] || {};
    return { b: g('sched_blocks_v1'), m: g('sched_blockmin_v1'), o: g('sched_blockoff_v1') };
  };

  // 19:57 에 시작 -> 19:50 칸을 선점하되 오프셋 7 이어야 한다
  at(19, 57);
  w.startRecording('R1');
  w.recordTick();
  check('시작 즉시: 칸 주인', snap().b['19:50'], 'R1');
  check('시작 즉시: 오프셋 = 7 (왼쪽 쌓임 아님)', snap().o['19:50'], 7);

  // 3분 경과 -> 19:57~20:00
  at(20, 0);
  w.recordTick();
  check('3분 뒤: 오프셋 유지', snap().o['19:50'], 7);
  check('3분 뒤: 길이 3', snap().m['19:50'], 3);

  // 다음 칸으로 넘어가면 그 칸은 처음부터 채워져야 한다
  at(20, 2);
  w.recordTick();
  check('다음 칸: 오프셋 없음', snap().o['20:00'], undefined);
  check('다음 칸: 길이 2', snap().m['20:00'], 2);

  // 첫 칸은 3분을 넘겨 커지지 않는다 (오프셋 7 + 길이 3 = 칸 끝)
  check('첫 칸 길이는 3을 넘지 않음', snap().m['19:50'], 3);

  w.stopRecording();

  // 정각에 시작하면 오프셋이 생기지 않아야 한다
  at(21, 0);
  w.startRecording('R1');
  w.recordTick();
  check('정각 시작: 오프셋 없음', snap().o['21:00'], undefined);
  w.stopRecording();

  console.log(fails ? `\n${fails} FAILURES` : '\n모든 검증 통과');
  process.exit(fails ? 1 : 0);
}, 1200);
