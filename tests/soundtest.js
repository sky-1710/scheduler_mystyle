// 뽀모도로 알림 소리 출력 장치: 위젯 뽀모도로 칸에서 고른 장치가 저장되고, 알람이 그 장치로 요청되는지
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('C:/Users/Owner/scheduler/index.html', 'utf8');

// 셸(QWebChannel 객체)을 흉내 낸다. 메서드는 마지막 인자로 콜백을 받는다
let devices = [
  { id: 'dev-realtek', name: '스피커(Realtek(R) Audio)', default: true },
  { id: 'dev-buds', name: '헤드폰(Galaxy Buds)', default: false },
];
const alarms = [], tests = [];
let devChanged = null;     // 셸의 audioOutputsChanged 신호에 연결된 콜백
const fakeShell = {
  info: cb => cb('{}'),
  load: cb => cb(null),
  save: (_p, cb) => cb('{"ok":true}'),
  gcalStatus: cb => cb('{"configured":false}'),
  notify: (_t, _b, _s, cb) => cb(true),
  audioOutputs: cb => cb(JSON.stringify(devices)),
  audioOutputsChanged: { connect: fn => { devChanged = fn; } },
  testAlarm: (id, name, cb) => { tests.push({ id, name }); cb(name || '스피커(Realtek(R) Audio)'); },
  alarm: (title, body, id, name, cb) => { alarms.push({ title, id, name }); cb(''); },
};

// 셸에서 위젯은 window.open 팝업이다 -> 빈 문서를 하나 돌려준다
const widgetWin = new JSDOM('<!doctype html><html><head></head><body></body></html>',
  { pretendToBeVisual: true }).window;

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  beforeParse(w) {
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.localStorage.setItem('startScreenOff', '1');
    w.open = () => widgetWin;
    w.__shell = fakeShell;
  },
});
const { window } = dom;
let fails = 0;
const step = async (name, fn) => {
  let ok = false, err = '';
  try { ok = await fn(); } catch (e) { err = ' → ' + e.message; }
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${err}`);
};
const tick = () => new Promise(r => setTimeout(r, 30));

setTimeout(async () => {
  const w = window, wd = widgetWin.document;
  const sel = () => wd.getElementById('wSoundSel');
  const pref = () => JSON.parse(w.localStorage.getItem('pomoSound_v1') || 'null');
  const choose = value => {
    sel().value = value;
    sel().dispatchEvent(new widgetWin.Event('change'));
  };

  await step('💾 메뉴에는 더 이상 선택란이 없다', () =>
    !w.document.getElementById('soundRow') && !w.document.getElementById('soundSelect'));

  await step('기록 모드에서는 「소리」 줄이 없다 (뽀모도로 알림 전용)', async () => {
    await w.toggleWidget();
    await tick();
    return !sel() && !!widgetWin.document.querySelector('.w-mode');
  });

  await step('뽀모도로 모드의 설정 칸에 「소리」 줄이 있고, 기본 장치 + 연결된 장치가 나열된다', () => {
    w.setTimerMode('pomo');
    const s = sel();
    const row = s && s.closest('.w-pomo-row');
    const opts = s ? [...s.options].map(o => o.value) : [];
    return !!row && row.querySelector('.w-pomo-k').textContent === '소리' &&
      !!s.closest('.w-pomo') && opts.join('|') === '|dev-realtek|dev-buds' && s.value === '' &&
      /기본 장치 \(스피커\(Realtek/.test(s.options[0].textContent);
  });

  await step('장치를 고르면 id·이름이 저장된다', () => {
    choose('dev-buds');
    const p = pref();
    return p && p.id === 'dev-buds' && p.name === '헤드폰(Galaxy Buds)';
  });

  await step('모드를 바꾸며 다시 그려도 선택이 유지된다', () => {
    w.setTimerMode('loop');
    const on = sel() && sel().value === 'dev-buds';
    w.setTimerMode('rec');
    const hidden = !sel();
    w.setTimerMode('pomo');
    return on && hidden && sel() && sel().value === 'dev-buds';
  });

  await step('뽀모도로 알람이 고른 장치로 요청된다', () => {
    alarms.length = 0;
    w.ringPomodoro('work', 25);
    return alarms.length === 1 && alarms[0].id === 'dev-buds' && alarms[0].name === '헤드폰(Galaxy Buds)';
  });

  await step('▶ 미리 듣기도 고른 장치로 울린다', async () => {
    sel().closest('.w-pomo-row').querySelector('.w-pomo-step').click();
    await tick();
    return tests.length === 1 && tests[0].id === 'dev-buds';
  });

  await step('장치를 빼면 목록이 바로 갱신되고 선택은 "(연결 안 됨)"으로 유지된다', async () => {
    devices = devices.filter(x => x.id !== 'dev-buds');
    devChanged();
    await tick();
    const opt = sel().selectedOptions[0];
    alarms.length = 0;
    w.ringPomodoro('break', 5);
    return sel().value === 'dev-buds' && /연결 안 됨/.test(opt.textContent) &&
      alarms[0].id === 'dev-buds';   // 대체(기본 장치)는 셸이 처리한다
  });

  await step('다시 꽂아 id가 바뀌어도 이름으로 다시 찾는다', async () => {
    devices.push({ id: 'dev-buds-new', name: '헤드폰(Galaxy Buds)', default: false });
    devChanged();
    await tick();
    return sel().value === 'dev-buds-new' && ![...sel().options].some(o => /연결 안 됨/.test(o.textContent));
  });

  await step('기본 장치로 되돌리면 저장값이 지워지고 빈 id로 요청된다', () => {
    choose('');
    alarms.length = 0;
    w.ringPomodoro('work', 25);
    return pref() === null && alarms[0].id === '' && alarms[0].name === '';
  });

  console.log(fails ? `\n${fails} FAILURES` : '\n모든 검증 통과');
  process.exit(fails ? 1 : 0);
}, 1200);
