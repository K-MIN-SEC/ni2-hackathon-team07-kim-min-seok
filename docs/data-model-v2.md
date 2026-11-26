# 오토 밸런싱 데이터 구조 v2 (모듈 조합형)

- 작성: 2026-11-26
- 목적: 정해진 게임 하나의 수치를 고치는 계산기(v1)에서, 기획자가 **재화·성장 상태·능력치·모듈을 직접 정의**하는 도구로 확장
- 범위: 완전 범용 State/Action/Rule 엔진이 아니라, 정해진 모듈 종류를 원하는 개수만큼 조합하는 방식
- 원칙: 모든 참조는 **고유 ID**로 한다. 이름은 화면 표시용이라 바꿔도 참조가 끊기지 않는다.

## 1. 프로젝트

```js
{
  schema: 2,
  id, name, genre, description, createdAt, updatedAt,
  sim: { days },                       // 7, 14, 30 등
  resources: [Resource],               // 재화 (입장권도 재화)
  states:    [State],                  // 성장 상태
  stats:     [Stat],                   // 능력치
  modules:   [Module],                 // 수급·소모·성장 모듈
  links:     [Link],                   // 연결 규칙
  players:   [Player], activePlayer,   // 유저 모델
  events:    [Event],                  // 이벤트 실험
}
```

| 구분 | 필드 | 설명 |
|---|---|---|
| Resource (재화) | `id, name, unit, initial, cap` | `cap`이 있으면 보유 한도. 넘는 양은 버린다 |
| State (성장 상태) | `id, name, initial, max` | 정수. 레벨·강화 단계·스킬 레벨·스테이지 등 |
| Stat (능력치) | `id, name, base, unit` | 최종값은 연결 규칙으로 계산 (3장) |

## 2. 수치 공식 (Formula)

모듈 안의 보상·비용·요구치는 모두 공식 객체로 적는다.

```js
{ type: 'const' | 'linear' | 'exp' | 'step', base, growth, ref, offset, step }
```

`x` = 기준 상태(`ref`)의 현재 값. `n = x − offset`.

| type | 값 | 예 |
|---|---|---|
| const | `base` | 일일 골드 500 |
| linear | `base + growth × n` | 레벨당 +10 |
| exp | `base × growth^n` | 필요 경험치 100 × 1.09^(레벨−1) |
| step | `base × growth^⌊n ÷ step⌋` | 던전 보상: 10스테이지마다 2.1배 |

기준 상태가 따로 있는 곳:
- 강화·레벨업 비용: `ref`를 비우면 **대상 상태의 현재 값**
- 진행(스테이지) 요구치: `ref`를 비우면 **대상 상태의 다음 값**

## 3. 연결 규칙 (Link)

한 행 = **참조 → 적용 대상 → 효과 → 변화량**.

```js
{ id, ref, target: { kind: 'stat' | 'module', id, resourceId? }, effect, mode, value, offset, base, min, max, enabled }
```

| 효과 | 참조 | 대상 | mode와 계산 (n = 참조값 − offset) |
|---|---|---|---|
| `add` 능력치 가산 | 상태 | 능력치 | `value × n` |
| `mult` 능력치 배율 | 상태 | 능력치 | linear `1 + value% × n` / compound `(1 + value%)^n` |
| `reward` 보상량 | 상태·능력치 | 사냥·방치·던전·주기 모듈 (특정 재화만 가능) | linear / compound / ratio |
| `cost` 비용 | 상태·능력치 | 레벨업·강화·던전 모듈 | linear / compound / ratio (value가 음수면 할인) |
| `speed` 처치 속도 | 상태·능력치 | 자동사냥 | linear / compound / ratio |
| `duration` 소요 시간 | 상태·능력치 | 던전 | linear / compound / ratio |

- `ratio` 모드: `(참조값 ÷ base)^value`. 예: 공격력 ÷ 1000 의 0.5제곱 = 처치 속도 배율. **공격력 → 처치 속도**를 직접 연결할 수 있다.
- 모든 배율은 `min`·`max`로 제한할 수 있다. 비용·시간 배율은 기본 하한 0.05.
- **적용 순서**: 최종값 = (기본 공식 + 가산 합) × 배율 곱 × 이벤트 배율.
- **순환 참조 방지**: 능력치용 규칙은 **상태만 참조**할 수 있다. 상태는 모듈 실행으로만 바뀐다. 그래서 규칙끼리 순환이 생기지 않는다 (검증에서 막음).

## 4. 모듈

공통 필드: `id, type, name, enabled, priority, unlock: [{ ref, min }]`
- `unlock`: 모든 조건(상태·능력치·재화 ≥ min)을 만족하면 해금. 한 번 해금되면 유지.
- `priority`: 숫자가 클수록 먼저. 같으면 목록 순서.

| type | 이름 | 실행 시점 | 고유 필드 |
|---|---|---|---|
| `hunt` | 자동사냥 | 접속 중 매 분 (던전 중 제외). 해금된 사냥터 중 우선순위 1곳 | `killsPerMin`, `rewards: [{ resourceId, amount: Formula }]` (처치당) |
| `idle` | 오프라인 방치 | 미접속 매 분 쌓임 → 접속 시 수령 | `capHours`, `mode: 'fromHunt' \| 'custom'`, `huntId`, `ratePct`, `rewards` (분당, custom일 때) |
| `periodic` | 주기 보상 | 주기 경계마다 | `period: 'daily' \| 'weekly' \| 'hours'`, `everyHours`, `gen`, `claim`, `fill`, `rewards` |
| `dungeon` | 던전 | 접속 중, 조건을 만족하면 사냥보다 먼저 | `cost: [{ resourceId, amount }]`, `durationMin`, `dailyLimit`, `rewards` |
| `levelup` | 레벨업 | 비용을 낼 수 있으면 **자동** (접속 무관) | `target`(상태), `cost: [{ resourceId, amount: Formula }]` |
| `upgrade` | 강화 | **접속 중**, 유저 정책이 켜져 있을 때 | `target`, `cost` (레벨업과 같음) |
| `progress` | 진행 | 조건을 만족하면 자동 | `target`(상태), `stat`(능력치), `req: Formula` |

- `fromHunt` 방치: 지정한 사냥터의 분당 보상(그 사냥터의 연결 규칙 포함) × `ratePct`%.
- 강화·레벨업은 상태만 올린다. 그 상태가 무엇을 바꾸는지는 연결 규칙으로 정한다 (강화 = 공격력 고정 아님).
- 강화 모듈이 여러 개일 때: 유저 정책 `upgradeMode`가 `roundRobin`(한 단계씩 돌아가며)이면 공평하게, `priority`면 우선순위 순으로 살 수 있는 만큼 산다.

## 5. 보상의 발생 조건과 수령 조건

| 보상 | 발생 (`gen`) | 수령 (`claim`) |
|---|---|---|
| 출석형 주기 보상 | `login`: 그 주기 안에 처음 접속할 때 | 즉시 |
| 자동 지급 주기 보상 | `auto`: 주기 경계에 자동 | `instant` 즉시 반영 / `login` 우편함 보관 → 다음 접속 때 |
| 입장권 충전 | `auto` + `fill: 'refill'` (그 양까지 채움, 넘치면 유지) | `instant` |
| 오프라인 방치 | 미접속 매 분, `capHours`까지 | 실제 접속할 때. 기간 끝까지 못 받은 양은 '미수령' |
| 이벤트 지급 | 시작일 00:00 | `instant` / `login` |
| 사냥·던전·강화 | 접속 중에만 | — |
| 레벨업·진행 | 조건 충족 시 자동 | — |

하루 접속 시간이 0분이면 접속이 일어나지 않을 뿐, 자동 지급·충전은 계속 발생한다.

## 6. 유저 모델 (Player)

```js
{ id, name, onlineMin, loginAt, useDungeons, autoUpgrade, upgradeMode }
```
- 매일 `loginAt`(분, 기본 0 = 00:00)에 접속해서 `onlineMin`분 플레이. 나머지는 오프라인.
- 기본 프리셋: 캐주얼 30분 / 일반 120분 / 헤비 480분.

## 7. 이벤트 (Event)

```js
{ id, name, enabled, type, startDay, days, resourceId, moduleId, value, claim, cond: { ref, max } | null }
```

| type | 내용 |
|---|---|
| `grant` | 시작일에 재화 지급 (`claim`: instant / login) |
| `rewardMult` | 기간 동안 보상 배율. `moduleId`가 비면 사냥·방치·던전 전체, `resourceId`가 비면 전체 재화 |
| `costDiscount` | 기간 동안 비용 할인 %. `moduleId`가 비면 강화 모듈 전체 |
| `dailyGrant` | 기간 동안 매일 00:00에 재화 추가 지급 (입장권 추가 등) |

- 겹치면 배율은 곱하고, 할인은 (1−a)(1−b)로 합친다.
- `cond`: 적용 시점에 참조값 ≤ max 인 유저만 (예: 레벨 100 이하 신규 유저).
- 이벤트가 끝나도 그동안 얻은 재화·성장은 유지된다.

## 8. 처리 순서 (1분 단위)

1. 주기 경계(`t`가 주기의 배수)면: 자동 주기 보상 발생, 던전 하루 횟수 초기화(00:00), 이벤트 지급·매일 지급
2. 접속 시작 시각이면: 방치 보상·우편함·로그인 수령 이벤트 수령, 출석형 보상 지급
3. 1 또는 2가 일어났으면: 자동 모듈(레벨업·진행) → 접속 중이면 강화 → 해금 갱신
4. 접속 중: 진행 중인 던전이 있으면 계속 / 없으면 조건을 만족하는 던전 입장(우선순위 순) / 아니면 사냥 → 다시 3
5. 미접속: 방치 모듈마다 한도까지 누적
6. 60분마다 기록

## 9. 검증 규칙

- ID 중복 없음, 모든 참조(ID)가 존재
- 능력치용 연결 규칙은 상태만 참조
- 상태 초기값 ≤ 최대값, 기간 ≥ 1일, 이벤트 시작일 ≤ 기간
- 숫자는 유한값, 배율(growth) ≥ 0
- 경고(계산은 함): 쓰이지 않는 재화, 소모처만 있고 수급처가 없는 재화, 해금 조건이 최대값보다 큰 모듈

## 10. 결과의 신뢰성

계산 중 무한대·NaN·1e300 초과·반복 한도(10만 회) 초과가 생기면 `reliable: false`와 이유 목록을 돌려준다.
화면은 결과 전체에 경고를 띄우고, 목표 밸런싱은 이런 후보를 쓰지 않는다.

## 11. v1과의 관계

- v1 샘플은 v2 구조로 옮길 수 있고(`fromV1`), **같은 입력이면 v1 엔진과 결과가 같다**는 것을 회귀 테스트로 확인한다.
- v1의 "공격력은 스테이지를 통해서만 보상에 영향" 한계는 v2에서 `speed` 연결 규칙으로 풀 수 있다. 쓰지 않으면 화면에 그 한계를 표시한다.

## 12. 후순위

데이터 테이블 공식, CSV 컬럼 매핑 가져오기, 재화 교환 모듈, 하루 여러 번 접속, 확률·가챠.
