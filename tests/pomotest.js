// 뽀모도로: 모드 켜기 → 할일 클릭으로 시작, 집중/휴식 각각 설정, 각 구간 끝에 한 번씩만 울리는지
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('C:/Users/Owner/scheduler/index.html', 'utf8');

const pad2 = n => String(n).padStart(2, '0');
const real = new Date();
const ds = `${real.getFullYear()}-${pad2(real.getMonth() + 1)}-${pad2(real.getDate())}`;

// 위젯(Document PiP) 창 대신 쓸 빈 문서
const widgetWin = new JSDOM('<!doctype html><html><head></head><body></body></html>',
  { pretendToBeVisual: true }).window;

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  beforeParse(w) {
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.documentPictureInPicture = { requestWindow: async () => widgetWin };
    w.localStorage.setItem('startScreenOff', '1');
    w.localStorage.setItem('sched_v1', JSON.stringify([
      { id: 'P1', title: '집중할 일', date: ds, isTodo: true, color: '#448361', priority: 'normal' },
    ]));
  },
});
const { window } = dom;
let fails = 0;
const step = (name, fn) => {
  let ok = false, err = '';
  try { ok = fn(); } catch (e) { err = ' → ' + e.message; }
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${err}`);
};

setTimeout(async () => {
  const w = window;
  const Real = w.Date;
  const T0 = new Real(real.getFullYear(), real.getMonth(), real.getDate(), 14, 0, 0).getTime();

  // 시계를 고정해 만료를 재현한다
  function at(ms) {
    w.Date = class extends Real {
      constructor(...a) { return a.length ? new Real(...a) : new Real(ms); }
      static now() { return ms; }
    };
    w.Date.prototype = Real.prototype;
  }

  // `pomo` 등은 let 이라 window 에 없다 -> 저장된 상태로 확인한다
  const saved = () => JSON.parse(w.localStorage.getItem('pomo_v1') || 'null');
  const minsPref = () => w.localStorage.getItem('pomoMins_v1');

  // 알림 횟수를 센다 (jsdom 에는 Notification 이 없어 showToast 로 떨어진다)
  const rings = [];
  w.showToast = msg => { if (/집중 완료|휴식 끝/.test(String(msg))) rings.push(String(msg)); };

  at(T0);

  step('기본은 모드 꺼짐 · 할일을 눌러도 세션이 안 생긴다', () => {
    const off = w.localStorage.getItem('pomoMode_v1') !== '1';
    w.startRecording('P1');
    const none = saved() === null;
    w.stopRecording();
    return off && none;
  });

  step('모드를 켜는 것만으로는 세션이 시작되지 않는다', () => {
    w.setPomoMode(true);
    return w.localStorage.getItem('pomoMode_v1') === '1' && saved() === null;
  });

  step('할일을 누르면 집중 25분이 시작된다', () => {
    w.startRecording('P1');
    const st = saved();
    return st && st.mins === 25 && st.phase === 'work' && st.endsAt === T0 + 25 * 60000;
  });

  step('할일을 다시 눌러 멈추면 세션도 끝난다', () => {
    w.stopRecording();
    return saved() === null;
  });

  step('모드를 끄면 진행 중 세션도 정리된다', () => {
    w.startRecording('P1');
    const running = saved() !== null;
    w.setPomoMode(false);
    const cleared = saved() === null;
    w.stopRecording();
    w.setPomoMode(true);
    return running && cleared;
  });

  step('집중 시간만 따로 조절된다', () => {
    w.adjustPomoWork(5);
    const up = w.localStorage.getItem('pomoWork_v1') === '30';
    const breakUntouched = w.localStorage.getItem('pomoBreak_v1') === null ||
                           w.localStorage.getItem('pomoBreak_v1') === '5';
    w.adjustPomoWork(-5);
    return up && breakUntouched && w.localStorage.getItem('pomoWork_v1') === '25';
  });

  step('휴식 시간만 따로 조절된다', () => {
    w.adjustPomoBreak(5);
    const up = w.localStorage.getItem('pomoBreak_v1') === '10';
    const workUntouched = w.localStorage.getItem('pomoWork_v1') === '25';
    w.adjustPomoBreak(-5);
    return up && workUntouched && w.localStorage.getItem('pomoBreak_v1') === '5';
  });

  step('범위: 집중 5~120 · 휴식 0~60', () => {
    for (let i = 0; i < 30; i++) w.adjustPomoWork(-5);
    const wFloor = w.localStorage.getItem('pomoWork_v1') === '5';
    for (let i = 0; i < 40; i++) w.adjustPomoWork(5);
    const wCeil = w.localStorage.getItem('pomoWork_v1') === '120';
    for (let i = 0; i < 5; i++) w.adjustPomoBreak(-5);
    const bFloor = w.localStorage.getItem('pomoBreak_v1') === '0';   // 휴식 없음
    for (let i = 0; i < 20; i++) w.adjustPomoBreak(5);
    const bCeil = w.localStorage.getItem('pomoBreak_v1') === '60';
    w.adjustPomoWork(-95); w.adjustPomoBreak(-55);
    return wFloor && wCeil && bFloor && bCeil &&
           w.localStorage.getItem('pomoWork_v1') === '25' &&
           w.localStorage.getItem('pomoBreak_v1') === '5';
  });

  step('집중 중에는 울리지 않는다', () => {
    w.startRecording('P1');
    at(T0 + 24 * 60000);
    w.pomoTick();
    return rings.length === 0 && saved().phase === 'work';
  });

  step('집중이 끝나면 울리고 휴식 대기 상태가 된다 (자동 전환 아님)', () => {
    at(T0 + 25 * 60000 + 500);
    w.pomoTick();
    const st = saved();
    return rings.length === 1 && rings[0].includes('집중 완료') &&
           st && st.phase === 'ready' && st.taskId === 'P1';
  });

  step('완료 알림이 휴식을 안내한다', () => rings[0].includes('휴식을 시작'));

  step('휴식 대기 중엔 할일 기록이 멈춘다 (휴식이 공부로 안 잡히게)', () =>
    w.localStorage.getItem('recording_v1') === null);

  step('대기 상태는 시간이 흘러도 저절로 넘어가지 않는다', () => {
    at(T0 + 40 * 60000);
    w.pomoTick(); w.pomoTick();
    return rings.length === 1 && saved().phase === 'ready';
  });

  step('휴식 시작 버튼을 눌러야 휴식이 돈다', () => {
    w.takeBreak();
    const st = saved();
    return st.phase === 'break' && st.mins === 5 &&
           st.endsAt === T0 + 40 * 60000 + 5 * 60000;
  });

  step('휴식 중에는 추가로 울리지 않는다', () => {
    at(T0 + 42 * 60000);
    w.pomoTick(); w.pomoTick();
    return rings.length === 1;
  });

  step('휴식이 끝나면 울리고 같은 할일로 집중이 다시 시작된다', () => {
    at(T0 + 45 * 60000 + 500);
    w.pomoTick();
    const st = saved();
    const rec = JSON.parse(w.localStorage.getItem('recording_v1') || 'null');
    return rings.length === 2 && rings[1].includes('휴식 끝') &&
           st && st.phase === 'work' && st.taskId === 'P1' &&
           rec && rec.id === 'P1';
  });

  step('중지하기 전까지 계속 돈다 (2바퀴째도 동일)', () => {
    at(T0 + 45 * 60000 + 500 + 25 * 60000 + 500);
    w.pomoTick();
    const ready = saved().phase === 'ready' && rings.length === 3;
    w.takeBreak();
    at(T0 + 45 * 60000 + 500 + 25 * 60000 + 500 + 5 * 60000 + 500);
    w.pomoTick();
    const again = saved().phase === 'work' && rings.length === 4;
    w.stopRecording();
    return ready && again && saved() === null;
  });

  step('휴식 0분이면 집중만 하고 끝난다', () => {
    rings.length = 0;
    for (let i = 0; i < 2; i++) w.adjustPomoBreak(-5);   // 0분
    at(T0 + 60 * 60000);
    w.startRecording('P1');
    at(T0 + 60 * 60000 + 25 * 60000 + 500);
    w.pomoTick();
    const only = rings.length === 1 && saved() === null;
    w.adjustPomoBreak(5);
    w.stopRecording();
    return only;
  });

  step('앱의 1초 틱이 뽀모도로를 진행시킨다', () => {
    rings.length = 0;
    w.stopRecording();
    at(T0 + 200 * 60000);
    w.startRecording('P1');
    at(T0 + 200 * 60000 + 25 * 60000 + 500);
    w.updateClock();
    const rang = rings.length === 1 && saved() && saved().phase === 'ready';
    w.stopPomo(); w.setPomoMode(false);
    return rang;
  });

  // ---------- 집중 모드: 중지할 때까지 같은 할일로 버튼 없이 연속 ----------
  const loopPref = () => w.localStorage.getItem('pomoLoop_v1');
  const rec = () => JSON.parse(w.localStorage.getItem('recording_v1') || 'null');
  const MIN = 60000;
  let t = T0 + 300 * MIN;

  step('집중 모드를 켜면 뽀모도로 모드도 같이 켜진다 (세션은 아직 없음)', () => {
    w.setPomoLoop(true);
    return loopPref() === '1' && w.localStorage.getItem('pomoMode_v1') === '1' && saved() === null;
  });

  step('집중 모드: 할일을 누르면 집중이 시작된다', () => {
    rings.length = 0;
    at(t);
    w.startRecording('P1');
    const st = saved();
    return st && st.phase === 'work' && st.taskId === 'P1' && st.endsAt === t + 25 * MIN;
  });

  step('집중이 끝나면 버튼 없이 바로 휴식이 시작되고, 기록은 멈춘다', () => {
    t += 25 * MIN + 500;
    at(t);
    w.pomoTick();
    const st = saved();
    return rings.length === 1 && rings[0].includes('5분 휴식을 시작합니다') &&
           st && st.phase === 'break' && st.mins === 5 && st.endsAt === t + 5 * MIN &&
           st.taskId === 'P1' && rec() === null;
  });

  step('휴식이 끝나면 같은 할일로 집중이 다시 시작된다', () => {
    t += 5 * MIN + 500;
    at(t);
    w.pomoTick();
    const st = saved();
    return rings.length === 2 && rings[1].includes('휴식 끝') &&
           st && st.phase === 'work' && st.taskId === 'P1' && rec() && rec().id === 'P1';
  });

  step('손대지 않아도 3·4바퀴째까지 계속 돈다 (대기 상태 없음)', () => {
    const phases = [];
    for (let i = 0; i < 2; i++) {
      t += 25 * MIN + 500; at(t); w.pomoTick(); phases.push(saved().phase);
      t += 5 * MIN + 500;  at(t); w.pomoTick(); phases.push(saved().phase);
    }
    return phases.join(',') === 'break,work,break,work' && rings.length === 6 &&
           rec() && rec().id === 'P1';
  });

  step('집중 모드에서도 할일을 다시 눌러 멈추면 끝난다', () => {
    w.stopRecording();
    t += 60 * MIN; at(t); w.pomoTick();
    return saved() === null && rings.length === 6;
  });

  step('휴식 중 「중지」로도 끝난다', () => {
    at(t);
    w.startRecording('P1');
    t += 25 * MIN + 500; at(t); w.pomoTick();     // -> break
    const inBreak = saved() && saved().phase === 'break';
    w.stopPomo();
    t += 60 * MIN; at(t); w.pomoTick();
    return inBreak && saved() === null && rec() === null && rings.length === 7;
  });

  step('집중 모드 + 휴식 0분: 기록을 끊지 않고 집중만 연달아 이어진다', () => {
    w.adjustPomoBreak(-5);                         // 휴식 없음
    rings.length = 0;
    at(t);
    w.startRecording('P1');
    const started = rec().startedAt;
    const phases = [];
    for (let i = 0; i < 2; i++) {
      t += 25 * MIN + 500; at(t); w.pomoTick();
      phases.push(saved().phase);
    }
    const ok = phases.join(',') === 'work,work' && rings.length === 2 &&
               rings[0].includes('바로 다음 집중') &&
               saved().endsAt === t + 25 * MIN && rec() && rec().startedAt === started;
    w.stopRecording();
    w.adjustPomoBreak(5);
    return ok;
  });

  step('뽀모도로 모드를 끄면 집중 모드도 꺼지고, 다시 켜면 버튼 대기 방식으로 돌아온다', () => {
    w.setPomoMode(false);
    const off = loopPref() === '0';
    w.setPomoMode(true);
    rings.length = 0;
    at(t);
    w.startRecording('P1');
    t += 25 * MIN + 500; at(t); w.pomoTick();
    const ready = saved() && saved().phase === 'ready' && rings[0].includes('위젯에서 휴식을 시작');
    w.stopPomo(); w.setPomoMode(false);
    return off && loopPref() === '0' && ready;
  });

  // 위젯: 「기록·뽀모도로·집중 모드」 세 칸 전환이 동작하는지 (PiP 창은 빈 문서로 대체)
  const widgetOk = await (async () => {
    await w.toggleWidget();
    const wd = widgetWin.document;
    const modes = () => [...wd.querySelectorAll('.w-mode')];
    const pomoPref = () => w.localStorage.getItem('pomoMode_v1');
    const before = modes().map(e => e.textContent.trim()).join('|') === '기록|뽀모도로|집중 모드' &&
                   modes()[0].classList.contains('on');
    modes()[2].click();
    const both = modes()[2].classList.contains('on') && pomoPref() === '1' && loopPref() === '1';
    const hint = (wd.querySelector('.w-pomo-hint') || {}).textContent || '';
    at(t);
    w.startRecording('P1');                         // 위젯은 집중 화면으로 바뀐다
    const focusLoop = !!wd.querySelector('.w-focus-pomo .w-loop');   // 반복 표시
    t += 25 * MIN + 500; at(t); w.pomoTick();     // 휴식: 본 위젯에 진행 표시
    const lab = (wd.querySelector('.w-pomo-lab') || {}).textContent || '';
    w.stopPomo();
    modes()[1].click();                             // 뽀모도로: 집중 모드만 꺼진다
    const pomoOnly = modes()[1].classList.contains('on') && pomoPref() === '1' && loopPref() === '0';
    modes()[0].click();                             // 기록: 둘 다 꺼진다
    const off = modes()[0].classList.contains('on') && pomoPref() === '0' && loopPref() === '0';
    return before && both && /중지할 때까지 계속/.test(hint) && focusLoop &&
           /휴식 중/.test(lab) && /집중 모드/.test(lab) && pomoOnly && off;
  })();
  step('위젯 「기록·뽀모도로·집중 모드」 전환: 집중 모드는 둘 다 켜고, 뽀모도로는 집중 모드만 끄고, 기록은 모두 끈다', () => widgetOk);

  step('카운트다운 표기', () =>
    w.fmtCountdown(90000) === '01:30' && w.fmtCountdown(0) === '00:00' &&
    w.fmtCountdown(25 * 60000) === '25:00');

  // 셸에서는 네이티브 알람 토스트로 울린다 (jsdom 에서는 실행 불가하므로 코드로 확인)
  step('셸 경로는 전용 alarm 호출을 쓴다', () =>
    /ringPomodoro[\s\S]{0,900}shell\.alarm\(/.test(html));

  step('위젯을 닫아도 틱이 돈다 (메인 페이지 소속)', () =>
    /function updateClock\(\)[\s\S]{0,900}pomoTick\(\);/.test(html));

  console.log(fails ? `\n${fails} FAILURES` : '\n모든 검증 통과');
  process.exit(fails ? 1 : 0);
}, 1200);
