// Canvas 과제 가져오기: 💾 메뉴의 연결·가져오기, 피드 항목 → 할일 병합 규칙, 「학교」 아래 과목 카테고리 연결, 수정 시 출처 보존
// 셸(파이썬)은 가짜 객체로 대체 — 네트워크·파싱은 tests/canvastest.py 가 맡는다
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('C:/Users/Owner/scheduler/index.html', 'utf8');

const pad = n => String(n).padStart(2, '0');
const day = off => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const OS = 'Operating Systems_ABC1001_01(김교수)';
const SEM = 'Engineering Seminar_ABC2002_01(이교수)';
const DM = '데이터마이닝_XYZ3003_01(박교수)';
const EDU = '2026 Online Education for Human Rights (for students)';   // 과목 코드 없음

// 셸이 돌려줄 피드. isNew=false 는 "전에 이미 보여줬던 것"(= 사용자가 지운 것)
let feed = [
  { uid: 'event-assignment-1', title: `Homework 3 [${OS}]`, course: OS, date: day(3), time: '23:59', url: 'https://c/x/1', isNew: true },
  { uid: 'event-assignment-2', title: `Project 4 [${OS}]`, course: OS, date: day(10), time: '23:59', url: 'https://c/x/2', isNew: true },
  { uid: 'event-assignment-3', title: `Seminar Report [${SEM}]`, course: SEM, date: day(5), time: '', url: 'https://c/x/3', isNew: true },
  { uid: 'event-assignment-4', title: `Old Quiz [${SEM}]`, course: SEM, date: day(-2), time: '10:00', url: 'https://c/x/4', isNew: true },
  { uid: 'event-assignment-5', title: `Deleted One [${OS}]`, course: OS, date: day(4), time: '23:59', url: 'https://c/x/5', isNew: false },
  { uid: 'event-assignment-8', title: `Quiz [${EDU}]`, course: EDU, date: day(40), time: '', url: 'https://c/x/8', isNew: true },
];
let status = { connected: false };
let resultCb = null;
const fetches = [], seenCalls = [], urlCalls = [];
let disconnects = 0;

const fakeShell = {
  info: cb => cb('{}'),
  load: cb => cb(null),
  save: (_p, cb) => cb('{"ok":true}'),
  gcalStatus: cb => cb('{"configured":false}'),
  notify: (_t, _b, _s, cb) => cb(true),
  audioOutputs: cb => cb('[]'),
  canvasStatus: cb => cb(JSON.stringify(status)),
  canvasSetUrl: (url, cb) => {
    urlCalls.push(url);
    if (!/\/feeds\/calendars\/.+\.ics$/.test(url)) return cb(JSON.stringify({ ok: false, error: '캘린더 피드 주소가 아닙니다' }));
    status = { connected: true, host: 'canvas.example.ac.kr', count: 0, lastFetch: null, error: '' };
    cb(JSON.stringify({ ok: true, ...status }));
  },
  canvasDisconnect: cb => { disconnects++; status = { connected: false }; cb('{"ok":true}'); },
  canvasMarkSeen: (json, cb) => { seenCalls.push(JSON.parse(json)); cb('{"ok":true}'); },
  canvasFetchAsync: auto => {
    fetches.push(auto);
    const items = JSON.parse(JSON.stringify(feed));
    setTimeout(() => resultCb(JSON.stringify({ ok: true, auto, items })), 5);
  },
  canvasResult: { connect: fn => { resultCb = fn; } },
};

// 이미 쓰던 카테고리: 공부 > 운영체제(자습 시간 측정용), 학교.
// 그리고 카테고리 기능 전에 가져온 Canvas 할일 하나 (카테고리 없음)
const seedCats = [
  { id: 'c-study', name: '공부', color: '#84CC16', parentId: null },
  { id: 'c-os', name: '운영체제', color: '#06B6D4', parentId: 'c-study', weeklyGoalH: 10 },
  { id: 'c-school', name: '학교', color: '#64748B', parentId: null, weeklyGoalH: null },
];
const seedEvents = [
  { id: 'old-dm', title: `Homework 4 [${DM}]`, isTodo: true, date: day(20), time: '', endTime: '', endDate: '',
    repeat: 'none', repeatN: 1, repeatEnd: '', notifyBefore: 0, color: '#CB912F', priority: 'normal',
    accuracy: null, categoryId: null, desc: '', completed: false, scope: null,
    source: 'canvas', extId: 'event-assignment-9', extDue: `${day(20)} `, extTitle: `Homework 4 [${DM}]`, course: DM, url: '' },
  { id: 'study-os', title: '운영체제 복습', isTodo: true, date: day(1), time: '', endTime: '', endDate: '',
    repeat: 'none', repeatN: 1, repeatEnd: '', notifyBefore: 0, color: '#06B6D4', priority: 'normal',
    accuracy: null, categoryId: 'c-os', desc: '', completed: false, scope: null },
];

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  beforeParse(w) {
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.localStorage.setItem('startScreenOff', '1');
    w.localStorage.setItem('sched_categories_v1', JSON.stringify(seedCats));
    w.localStorage.setItem('sched_v1', JSON.stringify(seedEvents));
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
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));

setTimeout(async () => {
  const w = window, doc = w.document;
  const $ = id => doc.getElementById(id);
  const evs = () => w.eval('events');
  const cats = () => w.eval('categories');
  const catOf = course => cats().find(c => c.canvasCourse === course);
  const canvasEvs = () => evs().filter(e => e.source === 'canvas');
  const byUid = uid => evs().find(e => e.extId === uid);
  const toast = () => $('toast').textContent;

  await step('셸이면 💾 메뉴에 Canvas 줄이 보이고, 연결 전엔 자동 요청이 없다', () =>
    $('canvasRow').style.display === '' && $('canvasLabel').textContent === 'Canvas 과제 가져오기' &&
    fetches.length === 0);

  await step('시작할 때: 카테고리 없던 옛 Canvas 할일 → 학교 > 데이터마이닝 (색은 원래 색 유지)', () => {
    const e = evs().find(x => x.id === 'old-dm'), c = catOf(DM);
    return c && c.name === '데이터마이닝' && c.parentId === 'c-school' && e.categoryId === c.id &&
      c.color === '#CB912F' && e.color === '#CB912F';
  });

  await step('기존 「학교」를 그대로 쓴다 (새 「학교」 안 만듦)', () =>
    cats().filter(c => c.name === '학교').length === 1 && cats().find(c => c.id === 'c-school').canvasRoot === true);

  await step('누르면 주소 입력칸이 열린다', async () => {
    $('canvasBtn').click(); await tick();
    return $('canvasSetup').style.display === '';
  });

  await step('피드 주소가 아니면 거절하고 이유를 보여준다', async () => {
    $('canvasUrl').value = 'https://canvas.example.ac.kr/api/v1/calendar_events?type=assignment';
    $('canvasSaveBtn').click(); await tick();
    return status.connected === false && $('canvasNote').textContent.startsWith('⚠') && canvasEvs().length === 1;
  });

  await step('올바른 주소 → 연결 → 바로 가져오기(수동) → 입력칸 비움', async () => {
    $('canvasUrl').value = 'https://canvas.example.ac.kr/feeds/calendars/user_AbC.ics';
    $('canvasUrl').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter' }));
    await tick(80);
    return status.connected && fetches.length === 1 && fetches[0] === false &&
      $('canvasUrl').value === '' && $('canvasSetup').style.display === 'none' &&
      $('canvasLabel').textContent === 'Canvas 과제 지금 가져오기';
  });

  await step('마감이 남은 새 과제만 할일로 (지난 것·지운 것 제외)', () => {
    const uids = canvasEvs().map(e => e.extId).sort();
    return JSON.stringify(uids) === JSON.stringify(
      ['event-assignment-1', 'event-assignment-2', 'event-assignment-3', 'event-assignment-8', 'event-assignment-9']);
  });

  await step('할일 모양: 날짜·마감 시각·출처 기록, 미완료, 범위 없음', () => {
    const e = byUid('event-assignment-1');
    return e.isTodo === true && e.date === day(3) && e.time === '23:59' && e.completed === false &&
      e.scope === null && e.repeat === 'none' && e.course === OS && e.url === 'https://c/x/1' &&
      e.extDue === `${day(3)} 23:59` && e.title === `Homework 3 [${OS}]`;
  });

  await step('과목마다 학교 아래 카테고리: 이름은 과목명만, 할일 색 = 카테고리 색', () => {
    const os = catOf(OS), sem = catOf(SEM);
    return os && sem && os.name === 'Operating Systems' && sem.name === 'Engineering Seminar' &&
      os.parentId === 'c-school' && sem.parentId === 'c-school' && os.color !== sem.color &&
      byUid('event-assignment-1').categoryId === os.id && byUid('event-assignment-2').categoryId === os.id &&
      byUid('event-assignment-3').categoryId === sem.id &&
      byUid('event-assignment-1').color === os.color && byUid('event-assignment-3').color === sem.color;
  });

  await step('새 카테고리 색은 기존 카테고리 색과 겹치지 않는다', () => {
    const colors = cats().map(c => c.color.toUpperCase());
    return new Set(colors).size === colors.length;
  });

  await step('과목 코드 없는 항목(교육 퀴즈)은 학교에 바로', () =>
    byUid('event-assignment-8').categoryId === 'c-school' && !catOf(EDU));

  await step('공부 > 운영체제는 그대로 (과제 안 들어감, 자습 할일도 그대로)', () => {
    const os = cats().find(c => c.id === 'c-os');
    return os.parentId === 'c-study' && !os.canvasCourse && os.weeklyGoalH === 10 &&
      canvasEvs().every(e => e.categoryId !== 'c-os') &&
      evs().find(e => e.id === 'study-os').categoryId === 'c-os';
  });

  await step('본 항목은 전부(지난 것 포함) 셸에 기록 요청', () =>
    seenCalls.length === 1 && seenCalls[0].length === feed.length);

  await step('결과 토스트', () => toast().includes('새 과제 4건'));

  await step('버튼 다시 → 이미 있는 건 중복 생성 안 함, 카테고리도 그대로', async () => {
    const nCats = cats().length;
    feed.forEach(it => { it.isNew = false; });
    $('canvasBtn').click(); await tick(80);
    return canvasEvs().length === 5 && cats().length === nCats && toast().includes('새 과제가 없습니다');
  });

  await step('모달로 고쳐 저장해도 Canvas 출처·카테고리가 남는다', async () => {
    const e = byUid('event-assignment-2');
    w.eval(`openEdit(events.find(e => e.extId === 'event-assignment-2'))`);
    $('evTitle').value = '프로젝트 4 (내가 바꾼 제목)';
    $('evSaveBtn').click(); await tick();
    const after = byUid('event-assignment-2');
    return after && after.id === e.id && after.title === '프로젝트 4 (내가 바꾼 제목)' &&
      after.extTitle === `Project 4 [${OS}]` && after.course === OS && after.source === 'canvas' &&
      after.categoryId === catOf(OS).id;
  });

  await step('Canvas가 마감을 미루면 따라가고, 내가 바꾼 제목·완료는 그대로', async () => {
    w.eval(`setTodoDone(events.find(e => e.extId === 'event-assignment-1'), '${day(3)}', true)`);
    feed[0].date = day(6); feed[0].time = '18:00';   // HW3 연장
    feed[1].date = day(12);                            // 프로젝트 연장 (제목은 Canvas에서 그대로)
    $('canvasBtn').click(); await tick(80);
    const hw = byUid('event-assignment-1'), pj = byUid('event-assignment-2');
    return hw.date === day(6) && hw.time === '18:00' && hw.completed === true &&
      pj.date === day(12) && pj.title === '프로젝트 4 (내가 바꾼 제목)' &&
      toast().includes('마감 변경 2건');
  });

  await step('Canvas에서 제목이 바뀌면 그건 따라간다', async () => {
    feed[2].title = `Seminar Report (수정) [${SEM}]`;
    $('canvasBtn').click(); await tick(80);
    return byUid('event-assignment-3').title === `Seminar Report (수정) [${SEM}]`;
  });

  await step('카테고리 이름·색을 바꿔도 연결 유지 — 새 과제는 그 카테고리·그 색', async () => {
    const os = catOf(OS), n = cats().length;
    w.eval(`(() => { const c = categories.find(c => c.canvasCourse === ${JSON.stringify(OS)}); c.name = '운영체제 과제'; c.color = '#D9730D'; })()`);
    feed.push({ uid: 'event-assignment-6', title: `Lab [${OS}]`, course: OS, date: day(8), time: '23:59', url: '', isNew: true });
    $('canvasBtn').click(); await tick(80);
    const e = byUid('event-assignment-6');
    return e && e.categoryId === os.id && e.color === '#D9730D' && cats().length === n;
  });

  await step('직접 다른 카테고리로 옮긴 Canvas 할일은 그대로 둔다', async () => {
    w.eval(`events.find(e => e.extId === 'event-assignment-3').categoryId = 'c-study'`);
    $('canvasBtn').click(); await tick(80);
    return byUid('event-assignment-3').categoryId === 'c-study';
  });

  await step('지운 할일은 다음 가져오기에서 되살아나지 않는다', async () => {
    w.eval(`events = events.filter(e => e.extId !== 'event-assignment-6')`);
    feed[feed.length - 1].isNew = false;   // 셸이 기록해 둔 상태
    $('canvasBtn').click(); await tick(80);
    return !byUid('event-assignment-6');
  });

  await step('백그라운드 결과: 새 과목 과제 → 새 카테고리와 함께 조용히 추가 + 토스트', async () => {
    const NET = 'Computer Networks_ABC4004_01(홍길동)';
    feed.push({ uid: 'event-assignment-7', title: `Lab 11 [${NET}]`, course: NET, date: day(2), time: '09:00', url: '', isNew: true });
    w.eval('canvasAutoCheck()'); await tick(80);
    const e = byUid('event-assignment-7'), c = catOf(NET);
    return fetches[fetches.length - 1] === true && e && c && c.name === 'Computer Networks' &&
      c.parentId === 'c-school' && e.categoryId === c.id && toast().includes('새 과제 1건');
  });

  await step('일간 할일 목록에도 나온다', () =>
    w.eval(`getDayTaskList('${day(2)}')`).some(e => e.extId === 'event-assignment-7'));

  await step('연결 해제 → 할일·카테고리는 남고, 자동 확인도 멈춘다', async () => {
    const n = canvasEvs().length, nc = cats().length, f = fetches.length;
    $('canvasOffBtn').click(); await tick();
    w.eval('canvasAutoCheck()'); await tick();
    return disconnects === 1 && canvasEvs().length === n && cats().length === nc && fetches.length === f &&
      $('canvasLabel').textContent === 'Canvas 과제 가져오기' && $('canvasOffBtn').style.display === 'none';
  });

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
}, 400);
