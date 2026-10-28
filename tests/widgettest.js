// 위젯 창: 셸에서는 투명 카드(float), 접기(알약), 창 끌기·높이 맞춤 요청, 줄 조작(체크·빠른 추가·두 번 눌러 삭제),
// 불러오기(다른 날짜·월간 할일을 오늘로)
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('C:/Users/Owner/scheduler/index.html', 'utf8');

const pad2 = n => String(n).padStart(2, '0');
const real = new Date();
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ds = ymd(real);
const yesterday = ymd(new Date(real.getFullYear(), real.getMonth(), real.getDate() - 1));

// 셸(QWebChannel 객체)을 흉내 낸다. 위젯 창 조작 요청을 기록한다
const calls = [];
const fakeShell = {
  info: cb => cb('{}'),
  load: cb => cb(null),
  save: (_p, cb) => cb('{"ok":true}'),
  gcalStatus: cb => cb('{"configured":false}'),
  notify: (_t, _b, _s, cb) => cb(true),
  audioOutputs: cb => cb('[]'),
  audioOutputsChanged: { connect: () => {} },
  testAlarm: (_i, _n, cb) => cb(''),
  alarm: (_t, _b, _i, _n, cb) => cb(''),
  widgetDrag: cb => { calls.push('drag'); cb(); },
  widgetFit: (h, cb) => { calls.push(['fit', h]); cb(); },
};

let widgetWin = null;
let closed = 0;
const newWidget = () => {
  widgetWin = new JSDOM('<!doctype html><html><head></head><body></body></html>',
    { pretendToBeVisual: true }).window;
  widgetWin.close = () => { closed++; };
  return widgetWin;
};

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  beforeParse(w) {
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.localStorage.setItem('startScreenOff', '1');
    w.localStorage.setItem('sched_v1', JSON.stringify([
      { id: 'T1', title: '첫 할일', date: ds, isTodo: true, color: '#448361', priority: 'normal' },
      { id: 'T2', title: '지울 할일', date: ds, isTodo: true, color: '#2383E2', priority: 'normal' },
      { id: 'Y1', title: '어제 못한 보고서', date: yesterday, isTodo: true, color: '#D9730D', priority: 'normal' },
      { id: 'Y2', title: '어제 끝낸 일', date: yesterday, isTodo: true, color: '#D9730D', priority: 'normal', completed: true },
      { id: 'M1', title: '이달의 독서', date: ds.slice(0, 8) + '01', scope: 'month', isTodo: true, color: '#9065B0', priority: 'normal' },
    ]));
    w.open = newWidget;
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
  const w = window;
  const wd = () => widgetWin.document;
  const q = s => wd().querySelector(s);
  const titles = () => [...wd().querySelectorAll('.w-item .w-title')].map(e => e.textContent);
  const down = el => el.dispatchEvent(new widgetWin.MouseEvent('mousedown', { bubbles: true, button: 0 }));

  await step('셸에서는 투명 카드(float)로 열리고, 아이콘 스프라이트가 위젯 문서에 복사된다', async () => {
    await w.toggleWidget();
    await tick();
    return wd().body.classList.contains('float') && !!q('.widget') &&
      !!wd().getElementById('iconSprite') && !!wd().getElementById('i-check');
  });

  await step('그린 뒤 카드 높이를 셸에 요청한다 (같은 높이는 다시 보내지 않음)', () => {
    const fits = () => calls.filter(c => c[0] === 'fit').length;
    const first = fits();
    w.renderWidget();
    return first >= 1 && fits() === first;
  });

  await step('제목 줄·시계 영역을 누르면 창 끌기를 요청하고, 버튼은 끌기를 시작하지 않는다', async () => {
    calls.length = 0;
    down(q('.w-top-lab'));
    down(q('.w-clock'));
    down(q('.w-top-btn'));
    await tick();
    return calls.filter(c => c === 'drag').length === 2;
  });

  await step('동그라미를 누르면 완료 체크, 카운트가 1/2로 바뀐다', () => {
    q('.w-item .w-circle').click();
    return q('.w-item.done .w-title').textContent === '첫 할일' &&
      q('.w-list .w-sec-n').textContent === '1/2';
  });

  await step('빠른 추가: 입력 후 Enter로 오늘 할일이 생긴다', () => {
    const input = q('.w-add-input');
    input.value = '새 할일';
    input.dispatchEvent(new widgetWin.KeyboardEvent('keydown', { key: 'Enter' }));
    return titles().includes('새 할일');
  });

  await step('✕는 한 번 누르면 「확인」, 두 번째에 삭제된다', () => {
    const row = [...wd().querySelectorAll('.w-item')].find(r => r.textContent.includes('지울 할일'));
    const del = row.querySelector('.w-del');
    del.click();
    const armed = del.dataset.armed === '1' && del.textContent === '확인' && titles().includes('지울 할일');
    del.click();
    return armed && !titles().includes('지울 할일');
  });

  const picks = () => [...wd().querySelectorAll('.w-pick')].filter(r => r.style.display !== 'none')
    .map(r => r.querySelector('.w-title').textContent);

  await step('불러오기: 오늘 것이 아닌 미완료 할일(다른 날짜·월간)만 나온다', () => {
    q('.w-pick-btn').click();
    const list = picks();
    return q('.w-pick-btn').classList.contains('on') && list.includes('어제 못한 보고서') &&
      list.includes('이달의 독서') && !list.includes('어제 끝낸 일') && !list.includes('첫 할일');
  });

  await step('불러오기: 입력창에 치면 목록이 걸러진다', () => {
    const input = q('.w-add-input');
    input.value = '보고';
    input.dispatchEvent(new widgetWin.Event('input'));
    return picks().join('|') === '어제 못한 보고서';
  });

  await step('불러오기: 누르면 오늘에 들어가고(체크 표시), 검색어는 유지된다', () => {
    [...wd().querySelectorAll('.w-pick')].find(r => r.textContent.includes('어제 못한 보고서')).click();
    const picked = w.eval("(dayTasks[todayStr()] || []).includes('Y1')");
    return picked && q('.w-pick.picked .w-title').textContent === '어제 못한 보고서' &&
      q('.w-add-input').value === '보고' && picks().join('|') === '어제 못한 보고서';
  });

  await step('완료를 누르면 오늘 할일 목록에 불러온 할일이 보이고, ✕는 오늘에서만 뺀다', () => {
    q('.w-add-input').value = '';
    q('.w-pick-btn').click();
    const shown = titles().includes('어제 못한 보고서');
    const row = [...wd().querySelectorAll('.w-item')].find(r => r.textContent.includes('어제 못한 보고서'));
    row.querySelector('.w-del').click();
    row.querySelector('.w-del').click();
    return shown && !titles().includes('어제 못한 보고서') &&
      w.eval("events.some(e => e.id === 'Y1')");      // 할일 자체는 남아 있다
  });

  await step('불러오기 중 Enter는 새 할일로 추가하고 오늘 목록으로 돌아온다', () => {
    q('.w-pick-btn').click();
    const input = q('.w-add-input');
    input.value = '검색하다 새로';
    input.dispatchEvent(new widgetWin.KeyboardEvent('keydown', { key: 'Enter' }));
    return !q('.w-pick') && !q('.w-pick-btn.on') && titles().includes('검색하다 새로');
  });

  await step('접기: 알약 하나로 줄고, 다시 열어도 접힌 채로 유지된다', async () => {
    q('.w-top-btn').click();                       // 「접기」
    const mini = !!q('.widget.mini .w-mini') && !q('.w-list') && !!q('#wClock');
    const saved = w.localStorage.getItem('widgetMini_v1') === '1';
    await w.toggleWidget();                        // 닫기
    await w.toggleWidget();                        // 다시 열기
    await tick();
    return mini && saved && !!q('.widget.mini');
  });

  await step('접힌 상태에서 기록하면 할일 이름·경과 시간·중지 버튼이 보이고, 중지가 동작한다', () => {
    w.startRecording('T1');
    const shows = /첫 할일/.test(q('.w-mini-name').textContent) && !!q('#wElapsed');
    q('.w-mini .w-top-btn[title="기록 중지"]').click();
    return shows && w.localStorage.getItem('recording_v1') === null && !!q('#wClock');
  });

  await step('접힌 채 뽀모도로: 알약은 그대로(이름·남은 시간)이고 아래에 남은 시간 바가 붙는다', () => {
    const noBarIdle = !q('#wPomoBar');
    w.setTimerMode('pomo');
    w.startRecording('T1');
    const bar = q('.widget.mini .w-mini-bar #wPomoBar');
    const ok = !!bar && parseFloat(bar.style.width) > 99 &&
      /첫 할일/.test(q('.w-mini-name').textContent) && !!q('#wPomoTime');
    w.stopRecording();
    w.setTimerMode('rec');
    w.startRecording('T1');                       // 뽀모도로 없이 기록만: 바 없음
    const noBarRec = !q('#wPomoBar');
    w.stopRecording();
    return noBarIdle && ok && noBarRec;
  });

  await step('펼치기: 원래 위젯으로 돌아온다', () => {
    q('.w-top-btn[title="펼치기"]').click();
    return !q('.widget.mini') && !!q('.w-list') && w.localStorage.getItem('widgetMini_v1') === '0';
  });

  await step('✕(위젯 닫기)는 창을 닫는다', () => {
    const before = closed;
    q('.w-top-btn.close').click();
    return closed === before + 1;
  });

  console.log(fails ? `\n${fails} FAILURES` : '\n모든 검증 통과');
  process.exit(fails ? 1 : 0);
}, 1200);
