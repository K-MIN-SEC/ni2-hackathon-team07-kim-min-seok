/* 오토 밸런싱 v2 — 프리셋·샘플 프로젝트
 * 모든 수치는 가상 데이터입니다. ㈜에이블게임즈의 실제 데이터가 아닙니다.
 * 프리셋은 편의를 위한 기본값일 뿐, 사용자가 모든 항목을 추가·삭제·수정할 수 있습니다.
 */
(function (root) {
  'use strict';
  const C = base => ({ type: 'const', base });
  const now = () => new Date().toISOString();
  function uid(prefix) { return prefix + '_' + Math.random().toString(36).slice(2, 8); }

  function players() {
    return [
      { id: 'pl_casual', name: '캐주얼', onlineMin: 30, loginAt: 0, useDungeons: true, autoUpgrade: true, upgradeMode: 'roundRobin' },
      { id: 'pl_normal', name: '일반', onlineMin: 120, loginAt: 0, useDungeons: true, autoUpgrade: true, upgradeMode: 'roundRobin' },
      { id: 'pl_heavy', name: '헤비', onlineMin: 480, loginAt: 0, useDungeons: true, autoUpgrade: true, upgradeMode: 'roundRobin' },
    ];
  }
  function shell(name, genre, description) {
    return {
      schema: 2, id: uid('p'), name: name || '새 프로젝트', genre: genre || 'custom', description: description || '',
      createdAt: now(), updatedAt: now(), meta: { setupDone: false, wizardStep: 0, sample: false },
      sim: { days: 7 },
      resources: [], states: [], stats: [], modules: [], links: [],
      players: players(), activePlayer: 'pl_normal', events: [],
    };
  }

  // 빈 프로젝트: 구조는 사용자가 직접 만든다
  function blankProject(name) { return shell(name, 'custom', ''); }

  // 방치형 RPG 기본 구조 (장르 프리셋)
  function idleRpgPreset(name) {
    const p = shell(name || '방치형 RPG 프로젝트', 'idle-rpg', '방치형 RPG 기본 구조에서 시작한 프로젝트');
    p.resources = [
      { id: 'res_gold', name: '골드', unit: 'G', initial: 0, cap: null },
      { id: 'res_exp', name: '경험치', unit: 'EXP', initial: 0, cap: null },
      { id: 'res_ticket_gold', name: '골드 던전 입장권', unit: '장', initial: 0, cap: null },
    ];
    p.states = [
      { id: 'st_level', name: '레벨', initial: 1, max: 300 },
      { id: 'st_enh', name: '강화 단계', initial: 0, max: 1000 },
      { id: 'st_stage', name: '스테이지', initial: 1, max: 1000 },
    ];
    p.stats = [{ id: 'stat_atk', name: '공격력', base: 10, unit: '' }];
    p.modules = [
      { id: 'm_hunt', type: 'hunt', name: '자동사냥', priority: 0, unlock: [], killsPerMin: 6, rewards: [
        { resourceId: 'res_gold', amount: { type: 'exp', base: 5, growth: 1.08, ref: 'st_stage', offset: 1 } },
        { resourceId: 'res_exp', amount: { type: 'exp', base: 4, growth: 1.08, ref: 'st_stage', offset: 1 } },
      ] },
      { id: 'm_idle', type: 'idle', name: '오프라인 방치', priority: 0, unlock: [], mode: 'fromHunt', huntId: 'm_hunt', ratePct: 30, capHours: 8, rewards: [] },
      { id: 'm_daily', type: 'periodic', name: '출석 보상', priority: 0, unlock: [], period: 'daily', everyHours: 24, gen: 'login', claim: 'instant', fill: 'add', rewards: [
        { resourceId: 'res_gold', amount: C(500) }, { resourceId: 'res_exp', amount: C(300) },
      ] },
      { id: 'm_ticket_gold', type: 'periodic', name: '골드 던전 입장권 충전', priority: 0, unlock: [], period: 'daily', everyHours: 24, gen: 'auto', claim: 'instant', fill: 'refill', rewards: [
        { resourceId: 'res_ticket_gold', amount: C(2) },
      ] },
      { id: 'm_dg_gold', type: 'dungeon', name: '골드 던전', priority: 2, unlock: [{ ref: 'st_level', min: 70 }],
        cost: [{ resourceId: 'res_ticket_gold', amount: C(1) }], durationMin: 3, dailyLimit: null, rewards: [
          { resourceId: 'res_gold', amount: { type: 'step', base: 3000, growth: 2.1, step: 10, ref: 'st_stage', offset: 1 } },
        ] },
      { id: 'm_levelup', type: 'levelup', name: '레벨업', priority: 0, unlock: [], target: 'st_level', cost: [
        { resourceId: 'res_exp', amount: { type: 'exp', base: 100, growth: 1.09, offset: 1 } },
      ] },
      { id: 'm_enh', type: 'upgrade', name: '공격력 강화', priority: 1, unlock: [], target: 'st_enh', cost: [
        { resourceId: 'res_gold', amount: { type: 'exp', base: 100, growth: 1.05, offset: 0 } },
      ] },
      { id: 'm_stage', type: 'progress', name: '스테이지 진행', priority: 0, unlock: [], target: 'st_stage', stat: 'stat_atk',
        req: { type: 'exp', base: 10, growth: 1.10, offset: 1 } },
    ];
    p.links = [
      { id: 'l_lv_atk', ref: 'st_level', target: { kind: 'stat', id: 'stat_atk' }, effect: 'add', mode: 'linear', value: 4, offset: 1 },
      { id: 'l_enh_atk', ref: 'st_enh', target: { kind: 'stat', id: 'stat_atk' }, effect: 'mult', mode: 'compound', value: 3, offset: 0 },
    ];
    return p;
  }

  // 샘플 체험: 기본 구조 + 루비·스킬 레벨·체력·경험치 던전·주간 우편·연결 규칙·이벤트
  function sampleProject() {
    const p = idleRpgPreset('샘플: 방치형 RPG (가상 데이터)');
    p.description = '기능 체험용 가상 샘플입니다. 실제 게임 데이터가 아닙니다.';
    p.meta.sample = true;
    p.resources.push(
      { id: 'res_ruby', name: '루비', unit: '개', initial: 0, cap: null },
      { id: 'res_ticket_exp', name: '경험치 던전 입장권', unit: '장', initial: 0, cap: null },
    );
    p.states.splice(2, 0, { id: 'st_skill', name: '스킬 레벨', initial: 0, max: 50 });
    p.stats.push({ id: 'stat_hp', name: '체력', base: 100, unit: '' });
    const daily = p.modules.find(m => m.id === 'm_daily');
    daily.rewards.push({ resourceId: 'res_ruby', amount: C(20) });
    const idx = p.modules.findIndex(m => m.id === 'm_dg_gold') + 1;
    p.modules.splice(idx, 0,
      { id: 'm_weekly', type: 'periodic', name: '주간 우편', priority: 0, unlock: [], period: 'weekly', everyHours: 168, gen: 'auto', claim: 'login', fill: 'add', rewards: [
        { resourceId: 'res_ruby', amount: C(100) },
      ] },
      { id: 'm_ticket_exp', type: 'periodic', name: '경험치 던전 입장권 충전', priority: 0, unlock: [], period: 'daily', everyHours: 24, gen: 'auto', claim: 'instant', fill: 'refill', rewards: [
        { resourceId: 'res_ticket_exp', amount: C(2) },
      ] },
      { id: 'm_dg_exp', type: 'dungeon', name: '경험치 던전', priority: 1, unlock: [{ ref: 'st_stage', min: 105 }],
        cost: [{ resourceId: 'res_ticket_exp', amount: C(1) }], durationMin: 3, dailyLimit: null, rewards: [
          { resourceId: 'res_exp', amount: { type: 'step', base: 2500, growth: 2.1, step: 10, ref: 'st_stage', offset: 1 } },
        ] },
    );
    p.modules.push({ id: 'm_skill', type: 'upgrade', name: '스킬 강화', priority: 0, unlock: [{ ref: 'st_level', min: 20 }], target: 'st_skill', cost: [
      { resourceId: 'res_ruby', amount: { type: 'linear', base: 10, growth: 5, offset: 0 } },
    ] });
    p.links.push(
      { id: 'l_lv_hp', ref: 'st_level', target: { kind: 'stat', id: 'stat_hp' }, effect: 'add', mode: 'linear', value: 20, offset: 1 },
      { id: 'l_skill_hunt', ref: 'st_skill', target: { kind: 'module', id: 'm_hunt' }, effect: 'reward', mode: 'linear', value: 2, offset: 0 },
    );
    p.events = [
      { id: 'ev_exp2', name: '경험치 2배', enabled: true, type: 'rewardMult', startDay: 3, days: 3, resourceId: 'res_exp', moduleId: '', value: 2, claim: 'instant', cond: null },
    ];
    p.meta.setupDone = true;
    return p;
  }

  const GENRES = [
    { id: 'idle-rpg', name: '방치형 RPG', desc: '자동사냥·방치 보상·던전·레벨업·강화·스테이지 기본 구조', make: idleRpgPreset },
    { id: 'custom', name: '빈 프로젝트', desc: '재화·상태·모듈을 처음부터 직접 구성', make: blankProject },
  ];

  const api = { blankProject, idleRpgPreset, sampleProject, GENRES, uid };
  root.ABPresets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
