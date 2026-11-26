// Builds data/reviews.json, data/opinions.json, data/categories.json and prints stats.
// Usage: node build-data.js <outDir>
const fs = require('fs');
const path = require('path');
const out = process.argv[2];
const COLLECTED = '2026-11-26';

const GP = { maple: 'com.nexon.ma', daltoki: 'com.AbleGames.DalToKi' };
const AS = { maple: '6739616715', daltoki: '1599684924' };
const gpUrl = (g, id) => `https://play.google.com/store/apps/details?id=${GP[g]}&hl=ko&gl=KR&reviewId=${id}`;
const asUrl = (g) => `https://apps.apple.com/kr/app/id${AS[g]}?see-all=reviews&platform=iphone`;

// [code, game, platform, externalId, rating, publishedAt, summary]
const R = [
  ['MK-G01','maple','google','040edbe8-eeb1-4080-b3ae-992ae7e80c06',1,'2026-11-25','플레이할 때마다 보안인증 실패 오류 메시지가 반복된다는 불만'],
  ['MK-G02','maple','google','9e123f54-07bb-41fb-919d-b4ee0df5135c',1,'2026-11-25','길드 스킬 비중과 길드 대항전 참여 압박 때문에 자주 접속해야 해서 방치형답지 않다는 불만'],
  ['MK-G03','maple','google','0d09a80b-0217-4525-9374-5d4f9a894a70',5,'2026-11-24','직업 변경권 추가 요청'],
  ['MK-G04','maple','google','ba484d6f-5cc9-4ae0-af90-db3928ef367a',1,'2026-11-24','튕긴 뒤 재설치하자 연동 계정이 튜토리얼부터 다시 시작되었다는 불만(월간·연간 상품 구매 언급)'],
  ['MK-G05','maple','google','e8a6a203-12e8-4ae7-80df-0ad6b492f855',5,'2026-11-24','짧은 긍정 평가'],
  ['MK-G06','maple','google','3f4f9c9d-42b4-4eae-9780-cc46e5a78523',5,'2026-11-23','재미있다는 짧은 평가'],
  ['MK-G07','maple','google','000fecbf-8149-47eb-b280-b6fc4a35a4db',1,'2026-11-23','구글 연동 후 4개월 만에 복귀했더니 캐릭터가 사라지고 처음부터 시작되었다는 불만(과금 언급)'],
  ['MK-G08','maple','google','d29b7e09-a88f-4518-9a46-e283b4b3bd2a',3,'2026-11-22','과금 요소가 있지만 하기에 나쁘지 않다는 평가'],
  ['MK-G09','maple','google','6602893f-4163-461a-996b-18a03e7ba37c',5,'2026-11-22','좋다는 짧은 평가'],
  ['MK-G10','maple','google','92b9bb2f-7c76-4b7c-9cc8-cc18d57d0216',3,'2026-11-22','멤버십 결제 단위와 쿠폰 사용 범위 질문, 3차 전직 시 스킬 슬롯 부족 지적'],
  ['MK-G11','maple','google','2a84030e-08bd-4374-a458-6eb4bfbdf6dd',5,'2026-11-22','같은 계정 부캐릭터 생성 시 능력치 혜택 추가 건의'],
  ['MK-G12','maple','google','f2a7f4f7-f835-4ebe-96a6-7dd7b82218d2',1,'2026-11-22','미지급된 외형 아이템 2종을 우편으로 받고 싶다는 요청'],
  ['MK-G13','maple','google','da74cf07-2b98-41a3-84bb-b9e38cc4099b',5,'2026-11-21','친구와 함께 하면 재미있고 경쟁심을 자극한다는 평가'],
  ['MK-G14','maple','google','834b08d4-1e3e-4ce9-9575-54121aa1114f',5,'2026-11-21','시간 보내기 좋다는 평가'],
  ['MK-G15','maple','google','401c7661-0ae1-4384-a8fd-3f02218270a2',5,'2026-11-21','재미있다는 짧은 평가'],
  ['MK-G16','maple','google','6ae5aa12-48d0-43e9-afa7-43610e204617',5,'2026-11-21','매우 재미있다는 짧은 평가'],
  ['MK-G17','maple','google','4a262550-0c9b-4622-8cb9-3a83bb6f504f',1,'2026-11-20','뽑기 운으로는 고점이 나오지 않고 과금으로만 돌파되는 구조처럼 느껴진다는 불만'],
  ['MK-G18','maple','google','1145755a-8471-4abf-ad65-9d8f83d0224f',5,'2026-11-20','소액 과금을 하면 아기자기하게 즐길 수 있다는 평가'],
  ['MK-G19','maple','google','7cc841aa-53e5-4267-a8cc-f9e8de350cc7',1,'2026-11-20','광고가 길고 재미없다는 평가'],
  ['MK-G20','maple','google','ef74f6a5-8404-40b9-ac77-5dcbdecd3386',5,'2026-11-20','짧은 긍정 평가'],

  ['MK-A01','maple','apple','13665640978',5,'2026-01-23T09:01:23.000Z','과금 유도가 심하고 상위권과 격차가 크며 길드 가입·장비 뽑기가 어렵지만 나름 할 만하다는 평가, 동료 위주 뽑기 팁'],
  ['MK-A02','maple','apple','13364350163',5,'2025-11-06T16:40:34.000Z','과금 유도·결제 팝업, 기기 발열과 배터리 소모, 서버 불안정을 지적'],
  ['MK-A03','maple','apple','13365806278',5,'2025-11-07T00:58:57.000Z','매우 재미있다는 평가와 서버 선택·파티 사냥 기능 건의'],
  ['MK-A04','maple','apple','13464405342',2,'2025-12-01T23:38:56.000Z','과금 유도와 운영 불만, 무과금 성장 정체, 뽑기 확률 스트레스, 콘텐츠 확장성 부족 지적'],
  ['MK-A05','maple','apple','13423274210',5,'2025-11-21T09:41:14.000Z','무과금으로도 재미있고 효과음·엘리트 몬스터 사냥이 좋지만 가방 공간 확장을 원함'],
  ['MK-A06','maple','apple','14333814478',5,'2026-07-22T10:24:20.000Z','서버 오류로 처음부터 접속이 안 된다는 문의'],
  ['MK-A07','maple','apple','13446761143',5,'2025-11-27T13:07:45.000Z','업데이트 후 튕김이 심해졌다는 불만과 조치 요청'],
  ['MK-A08','maple','apple','13370064710',4,'2025-11-08T01:36:04.000Z','게임은 재미있지만 방향키·점프 입력이 늦거나 먹히지 않는다는 지적'],
  ['MK-A09','maple','apple','14030636026',1,'2026-05-05T11:46:45.000Z','아이패드에서 로딩 중 튕겨 접속이 안 된다는 불만'],
  ['MK-A10','maple','apple','13395018078',1,'2025-11-14T02:49:53.000Z','광고 제거·시간 단축 등 과금 유도가 심하다는 불만'],

  ['DT-G01','daltoki','google','eeb3f6b8-a124-42fa-b865-7bb156532e8d',5,'2026-11-17','아기자기하고 귀엽지만 캐릭터가 작아 보기 불편하다는 평가'],
  ['DT-G02','daltoki','google','5ce4f8c0-410c-46d2-b79a-5541bcacc8d8',5,'2026-11-04','엄지 이모지만 작성'],
  ['DT-G03','daltoki','google','db1010a6-e9bc-4c15-b52c-5696de3f304e',3,'2026-10-31','짧은 긍정 평가'],
  ['DT-G04','daltoki','google','6f5bdb23-abfb-4824-874c-2ffa84df3883',1,'2026-10-27','어지럽다는 한 단어 평가(대상 불명)'],
  ['DT-G05','daltoki','google','60bb6ea0-d8bc-4f05-abda-c08e59af1363',5,'2026-10-22','의미를 확인할 수 없는 짧은 문자열'],
  ['DT-G06','daltoki','google','27a53072-c165-49ac-b99b-93fa39d344b3',3,'2026-10-03','서버 연결 불안정과 광고 환경이 게임성을 해친다는 평가'],
  ['DT-G07','daltoki','google','0b03b549-c56f-473e-861c-43e7dc016408',3,'2026-09-21','재설치 후 진행·결제 내역이 사라져 복구를 요청, 게임 자체는 재미있다는 평가'],
  ['DT-G08','daltoki','google','a9f6af61-3b3c-41bc-8d18-a50050aa3911',1,'2026-09-16','양산형 게임이라는 평가와 음악·그래픽·UI(텍스트 과다)에 대한 불만'],
  ['DT-G09','daltoki','google','4458425d-a555-4d5b-96ae-a56acf0c7dbd',1,'2026-09-13','앱 용량이 너무 크다는 불만(비유적 표현)'],
  ['DT-G10','daltoki','google','75b6eda4-ced3-4c6b-b347-7778ae5209c1',3,'2026-09-07','화면(요소)이 너무 작다는 평가'],
  ['DT-G11','daltoki','google','ba345450-508c-498f-ad47-da159aec1fbc',1,'2026-09-05','업데이트 후 접속이 안 되어 재설치했더니 과금 아이템을 포함한 데이터가 사라졌다는 불만'],
  ['DT-G12','daltoki','google','12bdaa06-dad5-4498-9fab-4056868778fe',5,'2026-09-05','재미있다는 짧은 평가'],
  ['DT-G13','daltoki','google','891d740c-b997-4e25-be16-7ae29f5cac6d',5,'2026-08-31','재미있다는 짧은 평가'],
  ['DT-G14','daltoki','google','45f63d4c-8999-4991-ab02-4de78da0c52a',5,'2026-08-27','매우 좋은 게임이라는 짧은 평가'],
  ['DT-G15','daltoki','google','74318450-ea41-45db-8d9d-c8efeac2c3cc',5,'2026-08-26','심심할 때 할 만하다는 평가'],
  ['DT-G16','daltoki','google','798e68e8-f7b0-478e-a499-5eb2f2f2725f',1,'2026-08-25','신규 이벤트 미션 일정과 동료 영입 조건이 맞지 않아 과금 없이 기한 내 달성이 어렵다는 불만'],
  ['DT-G17','daltoki','google','12bf43c5-437e-4cab-89da-1165c11cbdd7',5,'2026-08-23','할 만하다는 평가'],
  ['DT-G18','daltoki','google','48a3a02f-f6ba-4c65-83f4-d8a5d72305a7',5,'2026-08-21','다른 방치형과 달리 캐릭터가 예쁘고 스킬이 좋으며 운영진의 정성이 보인다는 평가'],
  ['DT-G19','daltoki','google','c8843d6a-b922-4ca8-869a-932f60226334',5,'2026-08-18','짧은 긍정 평가'],
  ['DT-G20','daltoki','google','2e2606e1-daf6-4dce-8552-5e6a1ef1e201',1,'2026-08-16','눈이 아프다는 짧은 평가(원인 불명)'],

  ['DT-A01','daltoki','apple','8768911073',5,'2022-06-13T05:39:41.000Z','방치형 중 가장 재미있고 무과금으로도 즐길 수 있으며 보상을 많이 준다는 평가'],
  ['DT-A02','daltoki','apple','8867236098',5,'2022-07-12T19:29:11.000Z','게임 품질이 높고 캐릭터가 예쁘며 성장하며 외형이 변하는 재미, 커뮤니티 활성화를 칭찬'],
  ['DT-A03','daltoki','apple','8816260241',5,'2022-06-27T16:32:22.000Z','게임은 재미있지만 갑자기 접속이 되지 않는다는 문의'],
  ['DT-A04','daltoki','apple','11327790554',5,'2024-05-31T15:29:28.000Z','기기 변경 후 같은 계정으로 로그인했는데 새로 시작되어 계정 복구 방법을 묻는 내용'],
  ['DT-A05','daltoki','apple','10233066005',5,'2023-08-08T10:23:43.000Z','다른 방치형보다 발열이 적고 스토리 해석이 신선하다는 평가'],
  ['DT-A06','daltoki','apple','10637864862',5,'2023-11-29T11:16:00.000Z','스킬 사용과 이동의 손맛이 좋고, 끝난 랜덤 스킬 이벤트 던전을 다시 열어 달라는 요청'],
  ['DT-A07','daltoki','apple','12665553277',5,'2025-05-17T09:57:40.000Z','문의 대응이 빠르고 과금 유도가 적어 무과금도 상위권이 가능하며 쿠폰을 많이 준다는 평가'],
  ['DT-A08','daltoki','apple','9923495780',4,'2023-05-13T18:47:01.000Z','네트워크 오류로 튕긴 뒤 초기 화면으로 돌아가고 연동도 되지 않아 계정 복구를 요청(원문에 닉네임 포함, 저장 제외)'],
  ['DT-A09','daltoki','apple','9566333034',4,'2023-01-31T06:11:39.000Z','광고 시청 중 튕김, 닫기 버튼 없는 확대 광고, 낮 시간대 점검 불편 지적, 게임은 재미있다는 평가'],
  ['DT-A10','daltoki','apple','9509349467',3,'2023-01-15T08:51:20.000Z','조작 유연성·코스튬·적은 튕김은 장점이지만 버퍼링이 잦고 경쟁작보다 부족해 이탈했다는 평가'],
];

// [reviewCode, categoryId, sentiment, otherType, keyword, summary]
const P = 'positive', N = 'negative', O = 'other';
const OP = [
  ['MK-G01','CAT-007',N,null,'보안인증 오류','실행 중 보안인증 실패 오류가 반복된다'],
  ['MK-G02','CAT-005',N,null,'접속 부담','길드 가입·대항전 참여가 사실상 강제되어 자주 접속해야 한다'],
  ['MK-G03','CAT-001',O,'suggestion','직업 변경','직업 변경권을 추가해 달라'],
  ['MK-G04','CAT-007',N,null,'비정상 종료','게임이 튕겼다'],
  ['MK-G04','CAT-011',N,null,'진행 데이터 손실','재설치 후 연동 계정의 진행 상황이 초기화되었다'],
  ['MK-G05','CAT-012',P,null,'전반적 만족','전반적으로 좋다'],
  ['MK-G06','CAT-012',P,null,'재미','재미있다'],
  ['MK-G07','CAT-011',N,null,'진행 데이터 손실','연동 계정의 캐릭터가 사라져 처음부터 시작되었다'],
  ['MK-G08','CAT-003',O,'neutral','과금 요소 존재','과금 요소가 있다'],
  ['MK-G08','CAT-012',P,null,'전반적 만족','하기에 나쁘지 않다'],
  ['MK-G09','CAT-012',P,null,'전반적 만족','좋다'],
  ['MK-G10','CAT-003',O,'question','멤버십 결제 단위','멤버십을 캐릭터별로 결제해야 하는가'],
  ['MK-G10','CAT-008',O,'question','쿠폰 사용 범위','쿠폰은 계정당 한 번만 쓸 수 있는가'],
  ['MK-G10','CAT-004',N,null,'스킬 슬롯 부족','3차 전직만 해도 스킬 슬롯이 부족하다'],
  ['MK-G11','CAT-001',O,'suggestion','부캐릭터 혜택','같은 계정 부캐릭터에 능력치 혜택을 달라'],
  ['MK-G12','CAT-008',N,null,'보상 미지급','외형 아이템이 지급되지 않았다'],
  ['MK-G13','CAT-010',P,null,'친구와 함께 플레이','친구와 함께 하면 재미있고 경쟁심이 생긴다'],
  ['MK-G14','CAT-012',P,null,'전반적 만족','시간 보내기 좋다'],
  ['MK-G15','CAT-012',P,null,'재미','재미있다'],
  ['MK-G16','CAT-012',P,null,'재미','매우 재미있다'],
  ['MK-G17','CAT-003',N,null,'확률형 아이템 불만','뽑기로는 고점이 나오지 않고 과금으로만 돌파되는 구조로 느껴진다'],
  ['MK-G18','CAT-012',P,null,'재미','소액 과금으로 아기자기하게 즐길 수 있다'],
  ['MK-G19','CAT-003',N,null,'광고 부담','광고가 너무 길다'],
  ['MK-G19','CAT-012',N,null,'재미 없음','재미없다'],
  ['MK-G20','CAT-012',P,null,'전반적 만족','좋다'],

  ['MK-A01','CAT-003',N,null,'과금 유도','과금 없이는 하기 어렵다'],
  ['MK-A01','CAT-001',N,null,'유저 간 격차','상위 유저와 전투력 격차가 커서 따라잡기 어렵다'],
  ['MK-A01','CAT-010',N,null,'길드 가입 어려움','정착할 길드에 들어가기 어렵다'],
  ['MK-A01','CAT-003',N,null,'확률형 아이템 불만','무기·동료 뽑기 확률이 낮다'],
  ['MK-A01','CAT-012',P,null,'전반적 만족','나름 재미있고 할 만하다'],
  ['MK-A01','CAT-004',O,'neutral','동료 중요도','동료 성능이 전투 결과에 가장 중요하다(팁)'],
  ['MK-A02','CAT-003',N,null,'과금 유도','과금 유도와 결제 팝업이 심하다'],
  ['MK-A02','CAT-007',N,null,'발열','기기 발열과 배터리 소모가 심하다'],
  ['MK-A02','CAT-007',N,null,'서버 불안정','서버가 불안정해 연결이 자주 끊긴다'],
  ['MK-A03','CAT-012',P,null,'재미','매우 재미있다'],
  ['MK-A03','CAT-008',O,'suggestion','서버 선택','서버를 선택할 수 있게 해 달라'],
  ['MK-A03','CAT-010',O,'suggestion','파티 사냥','친구와 함께하는 파티 사냥을 추가해 달라'],
  ['MK-A04','CAT-003',N,null,'과금 유도','재미보다 과금 유도에 집중되어 있다'],
  ['MK-A04','CAT-008',N,null,'운영 불만','운영이 제대로 되지 않는다'],
  ['MK-A04','CAT-001',N,null,'성장 정체','과금 없이는 진행되지 않고 같은 맵에 오래 머문다'],
  ['MK-A04','CAT-003',N,null,'확률형 아이템 불만','뽑기 확률 때문에 스트레스를 받는다'],
  ['MK-A04','CAT-005',N,null,'콘텐츠 확장성 부족','맵·보스 범위가 정해져 정답 세팅만 남았다'],
  ['MK-A05','CAT-012',P,null,'재미','무과금으로도 재미있다'],
  ['MK-A05','CAT-009',P,null,'효과음','사냥 효과음이 귀엽다'],
  ['MK-A05','CAT-004',P,null,'엘리트 몬스터 사냥','엘리트 몬스터 사냥이 재미있다'],
  ['MK-A05','CAT-006',O,'suggestion','인벤토리 확장','가방 저장 공간을 늘려 달라'],
  ['MK-A06','CAT-007',N,null,'접속 불가','서버 오류로 접속이 되지 않는다'],
  ['MK-A07','CAT-007',N,null,'비정상 종료','업데이트 후 튕김이 심해졌다'],
  ['MK-A08','CAT-012',P,null,'재미','게임 자체는 재미있다'],
  ['MK-A08','CAT-006',N,null,'조작 입력 지연','방향키·점프 입력이 늦거나 먹히지 않는다'],
  ['MK-A09','CAT-007',N,null,'비정상 종료','아이패드에서 로딩 중 튕겨 접속할 수 없다'],
  ['MK-A10','CAT-003',N,null,'과금 유도','광고 제거·시간 단축 등 과금 유도가 심하다'],

  ['DT-G01','CAT-009',P,null,'캐릭터·외형 디자인','아기자기하고 귀엽다'],
  ['DT-G01','CAT-006',N,null,'화면 요소 작음','캐릭터가 작아 보기 불편하다'],
  ['DT-G02','CAT-012',P,null,'전반적 만족','엄지 이모지'],
  ['DT-G03','CAT-012',P,null,'전반적 만족','좋다'],
  ['DT-G04','CAT-013',N,null,'어지러움','어지럽다(대상 불명)'],
  ['DT-G05','CAT-013',O,'unknown','판단 불가','의미를 확인할 수 없음'],
  ['DT-G06','CAT-007',N,null,'서버 불안정','서버 연결이 불안정하다'],
  ['DT-G06','CAT-003',N,null,'광고 부담','광고 환경이 게임성을 해친다'],
  ['DT-G07','CAT-011',N,null,'진행 데이터 손실','재설치 후 진행·결제 내역이 사라졌다'],
  ['DT-G07','CAT-012',P,null,'재미','게임은 재미있다'],
  ['DT-G08','CAT-012',N,null,'양산형','흔한 양산형 게임이다'],
  ['DT-G08','CAT-009',N,null,'음악','음악이 평범하다'],
  ['DT-G08','CAT-009',N,null,'그래픽','그래픽이 매력 없다'],
  ['DT-G08','CAT-006',N,null,'텍스트 과다 UI','UI가 흔하고 텍스트가 많다'],
  ['DT-G09','CAT-007',N,null,'앱 용량','앱 용량이 너무 크다'],
  ['DT-G10','CAT-006',N,null,'화면 요소 작음','화면(요소)이 너무 작다'],
  ['DT-G11','CAT-007',N,null,'접속 불가','업데이트 후 접속이 되지 않았다'],
  ['DT-G11','CAT-011',N,null,'진행 데이터 손실','재설치 후 과금 아이템을 포함한 데이터가 사라졌다'],
  ['DT-G12','CAT-012',P,null,'재미','재미있다'],
  ['DT-G13','CAT-012',P,null,'재미','재미있다'],
  ['DT-G14','CAT-012',P,null,'전반적 만족','매우 좋은 게임이다'],
  ['DT-G15','CAT-012',P,null,'전반적 만족','심심할 때 할 만하다'],
  ['DT-G16','CAT-008',N,null,'이벤트 미션 설계','신규 이벤트 미션 일정이 과금 없이는 달성하기 어렵게 짜여 있다'],
  ['DT-G17','CAT-012',P,null,'전반적 만족','할 만하다'],
  ['DT-G18','CAT-009',P,null,'캐릭터·외형 디자인','캐릭터가 예쁘다'],
  ['DT-G18','CAT-004',P,null,'스킬','스킬이 좋다'],
  ['DT-G18','CAT-008',P,null,'운영 정성','운영진의 정성이 보인다'],
  ['DT-G19','CAT-012',P,null,'전반적 만족','좋다'],
  ['DT-G20','CAT-013',N,null,'눈 피로','눈이 아프다(원인 불명)'],

  ['DT-A01','CAT-012',P,null,'재미','방치형 중 가장 재미있다'],
  ['DT-A01','CAT-003',P,null,'무과금 친화','무과금으로도 충분히 즐길 수 있다'],
  ['DT-A01','CAT-002',P,null,'보상 풍부','보상을 많이 준다'],
  ['DT-A02','CAT-012',P,null,'전반적 만족','게임 품질이 높고 재미있다'],
  ['DT-A02','CAT-009',P,null,'캐릭터·외형 디자인','캐릭터가 예쁘다'],
  ['DT-A02','CAT-001',P,null,'성장 외형 변화','성장할수록 캐릭터 외형이 변하는 재미가 있다'],
  ['DT-A02','CAT-010',P,null,'커뮤니티 활성','공식 카페에 사람이 많아 함께하는 재미가 있다'],
  ['DT-A03','CAT-012',P,null,'재미','게임은 재미있다'],
  ['DT-A03','CAT-007',N,null,'접속 불가','데이터 확인 화면에서 멈춰 접속이 되지 않는다'],
  ['DT-A04','CAT-011',N,null,'진행 데이터 손실','기기 변경 후 로그인하니 새로 시작되었다'],
  ['DT-A05','CAT-007',P,null,'발열 적음','다른 방치형보다 발열이 적다'],
  ['DT-A05','CAT-005',P,null,'스토리','스토리 해석이 신선하다'],
  ['DT-A06','CAT-004',P,null,'스킬','스킬 사용과 이동의 손맛이 좋다'],
  ['DT-A06','CAT-005',P,null,'이벤트 던전','랜덤 스킬 이벤트 던전이 재미있었다'],
  ['DT-A06','CAT-005',O,'suggestion','이벤트 던전 재개','이벤트 던전을 다시 열어 달라'],
  ['DT-A07','CAT-008',P,null,'빠른 고객 대응','커뮤니티 문의에 빠르게 대응한다'],
  ['DT-A07','CAT-003',P,null,'무과금 친화','과금 유도가 적어 무과금도 상위권이 가능하다'],
  ['DT-A07','CAT-008',P,null,'쿠폰 지급','쿠폰을 많이 준다'],
  ['DT-A07','CAT-012',P,null,'전반적 만족','게임 자체가 좋다'],
  ['DT-A08','CAT-007',N,null,'비정상 종료','네트워크 오류로 튕겼다'],
  ['DT-A08','CAT-011',N,null,'진행 데이터 손실','연동 계정인데 초기 화면으로 돌아가고 연동되지 않는다'],
  ['DT-A09','CAT-007',N,null,'비정상 종료','광고 시청 중 자주 튕긴다'],
  ['DT-A09','CAT-003',N,null,'광고 부담','닫기 버튼 없이 확대되는 광고가 있다'],
  ['DT-A09','CAT-008',N,null,'점검 시간','낮 시간대 점검이 불편하다'],
  ['DT-A09','CAT-012',P,null,'재미','게임은 재미있다'],
  ['DT-A10','CAT-006',P,null,'조작 유연','캐릭터 조작이 유연하다'],
  ['DT-A10','CAT-009',P,null,'캐릭터·외형 디자인','코스튬이 화려하고 예쁘다'],
  ['DT-A10','CAT-007',P,null,'튕김 적음','튕김이 별로 없다'],
  ['DT-A10','CAT-007',N,null,'버퍼링','버퍼링이 자주 생긴다'],
  ['DT-A10','CAT-012',N,null,'경쟁작 대비 부족','경쟁작에 비해 부족하다'],
];

// evidenceText: 원문의 연속 구간을 그대로 옮긴 짧은 발췌(최대 40자, 닉네임 등 개인정보 제외).
// App Store는 리뷰 제목에서 발췌한 경우가 있다(DT-A01-1, DT-A02-1, DT-A02-2).
const EXCERPT_MAX = 40;
const EV = {
  'MK-G01-1':'보안인증 실패라고 게임할때마다 에러 메세지가 계속 뜨네요',
  'MK-G02-1':'길드 스킬 중점을 크게두어 필수적으로 가입하게 해놓고',
  'MK-G03-1':'직업변경권주세요제발',
  'MK-G04-1':'갑자기 튕겨져가지고',
  'MK-G04-2':'연동된 계정으로 갔더니 처음부터',
  'MK-G05-1':'굿',
  'MK-G06-1':'잼있어요',
  'MK-G07-1':'키워놨던 캐릭사라지고 다시 태초마을부터 시작이네',
  'MK-G08-1':'과금요소있는데',
  'MK-G08-2':'걍 하기 나쁘지 않은듯하네요',
  'MK-G09-1':'좋아요',
  'MK-G10-1':'멤버십은 캐릭터별로 결제해야되고',
  'MK-G10-2':'쿠폰 사용은 계정당 한번 씩인가요?',
  'MK-G10-3':'플위는 3차만 돼도 스킬창이 부족한데',
  'MK-G11-1':'같은 계정에서 부캐 생성시 메이플처럼 능력치 혜택이 있으면 좋겠어요',
  'MK-G12-1':'미지급된 비단 조바위 모자하고',
  'MK-G13-1':'친구들이랑 함께하면 너무재밌소',
  'MK-G14-1':'시간때우기좋다',
  'MK-G15-1':'재밌긴해',
  'MK-G16-1':'너무 내미있음',
  'MK-G17-1':'뽑기운빨로 고점찍는경우는 절때없는것같고',
  'MK-G18-1':'아기자기하게 게임재밌게 즐길수있음',
  'MK-G19-1':'광고가 너무 긺',
  'MK-G19-2':'재미없음',
  'MK-G20-1':'GOOD!!!',
  'MK-A01-1':'과금 없이는 할 수 없는 게임이라 보면 됩니다',
  'MK-A01-2':'기본 유저들 전투력이 10억 위다 보니 따라잡기가 쉽지 않습니다',
  'MK-A01-3':'정착할만한 길드에 들어가는 것도 어려울뿐더러',
  'MK-A01-4':'동료 뽑는 확률도 낮고',
  'MK-A01-5':'나름 뭐 재미있고 할만하지만',
  'MK-A01-6':'동료가 제일 중요하더라고요',
  'MK-A02-1':'돈슨게임답게 과금유도가 매우 심합니다',
  'MK-A02-2':'엄청난 발열과 베터리 소모를 보여줍니다',
  'MK-A02-3':'서버도 매우 불안정하여 연결이 자주 끊기곤 합니다',
  'MK-A03-1':'메이플 키우기는 나에게 너무 재미있는 게임이었다',
  'MK-A03-2':'서버를 선택할 수 있으면 좋겠습니다',
  'MK-A03-3':'친구들과 같이 몹들을 잡는 그런 시스템',
  'MK-A04-1':'현질 유도에만 집중되어 있는 게 좀 정떨 포인트임',
  'MK-A04-2':'제대로 된 운영도 안되면서',
  'MK-A04-3':'내 캐릭터 5일째 똑같은 맵에 갇혀있음',
  'MK-A04-4':'뽑기 확률 때문에 스트레스 받아야 되는 게임',
  'MK-A04-5':'맵의 범위나 보스도 끝이 정해져 있어서',
  'MK-A05-1':'무과금으로 하고있는데도 너무 재밌어요',
  'MK-A05-2':'잡았을때 효과음도 귀엽고',
  'MK-A05-3':'엘리트 몬스터도 잡을때 재밌습니다',
  'MK-A05-4':'가장 저장 공간을 늘려줬으면 더 좋겠어용',
  'MK-A06-1':'계속 서버 오류라면서 처음부터 안 들어가 집니다',
  'MK-A07-1':'업데이트 후 튕김현상이 너무 심해졌습니다',
  'MK-A08-1':'겜 자체는 너무 만족하면서 재밌게 잘 하고 있는데',
  'MK-A08-2':'방향키 점키 컨트롤이 반응 반박자 느린거랑',
  'MK-A09-1':'처음화면에서 로딩하다가 팅겨서 접속도 안되네요',
  'MK-A10-1':'현질유도 하면할수록 빡세게 들어옵니다',
  'DT-G01-1':'아기자기하고 귀여운데',
  'DT-G01-2':'캐릭이 작아서 보기불편하네요',
  'DT-G02-1':'👍',
  'DT-G03-1':'굿',
  'DT-G04-1':'어지러움',
  'DT-G05-1':'앙김모띠',
  'DT-G06-1':'불안정한 서버의 연결성',
  'DT-G06-2':'최악의 광고환경이 게임성을 갉아먹고 있음',
  'DT-G07-1':'진행한거랑 결제한거까지 다 날아갔네요',
  'DT-G07-2':'겜은 진짜 재밌어요',
  'DT-G08-1':'걍 돈벌이용 흔한 양산형 모바일겜',
  'DT-G08-2':'음악은 양산형 그 이상도 이하도 아니고',
  'DT-G08-3':'그래픽도 매력없고',
  'DT-G08-4':'양산형게임 특인 텍스트 범벅까지',
  'DT-G09-1':'너는 용량이 너무 무거워서',
  'DT-G10-1':'화면이 넘 작아효',
  'DT-G11-1':'업데이트하고 접속안돼서 다시 깔았더니',
  'DT-G11-2':'다 날아감;;;; 내 현질템!!!!!',
  'DT-G12-1':'잼나네요~',
  'DT-G13-1':'그냥 재밌음',
  'DT-G14-1':'갓겜',
  'DT-G15-1':'심심할때할만해요',
  'DT-G16-1':'당일에 현질이 없으면 클리어 못하게 만들어 놓은',
  'DT-G17-1':'할만해요',
  'DT-G18-1':'여기는이쁘고',
  'DT-G18-2':'스킬이좋네요',
  'DT-G18-3':'운영자님이애정으로잘만들것노력이잘보여요',
  'DT-G19-1':'굿',
  'DT-G20-1':'눈이 너무 아픔',
  'DT-A01-1':'방치형중 가장 재밌는 게임',
  'DT-A01-2':'무자본도 충분히 즐길수 있고',
  'DT-A01-3':'많이 퍼주기 때문에',
  'DT-A02-1':'진짜 게임 퀄리티 최고!!!!!!',
  'DT-A02-2':'캐릭터 넘 예쁘고',
  'DT-A02-3':'캐릭터 가 점점 더 예쁘게 변해가는게 너무 좋아요',
  'DT-A02-4':'까페에 사람도 엄청 많아서 함께하는 재미가 있네요',
  'DT-A03-1':'게임은 재밌어서 열심히 하고 있는데',
  'DT-A03-2':'갑자기 방금 전부터 게임 접속이 안되네요',
  'DT-A04-1':'다시 로그인하니까 새로 시작하네요',
  'DT-A05-1':'상대적으로 적은 느낌이 들어서 좋았고',
  'DT-A05-2':'달토끼를 이런 식으로도 바라볼 수 있구나',
  'DT-A06-1':'스킬쓰는 재미로는 최고',
  'DT-A06-2':'랜덤스킬 뜨는거 골라서 깨는거 너무 잼있었는데',
  'DT-A06-3':'또했음좋겠어요!',
  'DT-A07-1':'커뮤에 글 딸깍 올리면 바로 해결해줘서 넘 좋당',
  'DT-A07-2':'현질유도도 적은편이라서 무과금도 랭커찍기 쌉가능',
  'DT-A07-3':'쿠폰도 많이 퍼줘서 부족할게 없음',
  'DT-A07-4':'게임 자체도 좋고',
  'DT-A08-1':'갑자기 네트워크 에러 뜨더니 튕기고',
  'DT-A08-2':'연동을 해놨는데도 연동도 안되고',
  'DT-A09-1':'광고 보면서 튕기는 경우도 너무 많고',
  'DT-A09-2':'광고가 크게 확대 되어 나오면서 x 버튼 없어서',
  'DT-A09-3':'자꾸 게임 많이 할 낮 시간에 갑자기 점검해서 불편해요',
  'DT-A09-4':'게임은 정말 재밌게 잘 하고 있습니다',
  'DT-A10-1':'캐릭터 컨트롤이 기존 게임보다 좀 더 유연한 것',
  'DT-A10-2':'화려하고 예쁜 코스튬',
  'DT-A10-3':'팅김현상이 별로 없음',
  'DT-A10-4':'버퍼링이 자주 생김',
  'DT-A10-5':'솔직히 옆 동네 못 따라 오네요',
};

// 판단 보류(B-02): verificationStatus = 'on_hold', holdReason 필수. categoryId·sentiment는 잠정값.
const STATUSES = ['unreviewed', 'verified', 'corrected', 'on_hold'];
const HOLD = {
  'DT-G04-1': '평가 대상 불명(GAP-03). 잠정 기타',
  'DT-G05-1': '의미 확인 불가. 카테고리·감성 모두 판단 불가',
  'DT-G20-1': '평가 대상 불명(GAP-03). 잠정 기타',
};

// B-06 키워드 정규화 사전: [대표 키워드, 카테고리]. 의견 키워드는 반드시 사전에 있어야 하며 카테고리가 일치해야 한다.
const KEYWORD_LIST = [
  ['전반적 만족','CAT-012'],['재미','CAT-012'],['재미 없음','CAT-012'],['양산형','CAT-012'],['경쟁작 대비 부족','CAT-012'],
  ['직업 변경','CAT-001'],['부캐릭터 혜택','CAT-001'],['유저 간 격차','CAT-001'],['성장 정체','CAT-001'],['성장 외형 변화','CAT-001'],
  ['보상 풍부','CAT-002'],
  ['과금 요소 존재','CAT-003'],['멤버십 결제 단위','CAT-003'],['확률형 아이템 불만','CAT-003'],['광고 부담','CAT-003'],['과금 유도','CAT-003'],['무과금 친화','CAT-003'],
  ['스킬 슬롯 부족','CAT-004'],['동료 중요도','CAT-004'],['엘리트 몬스터 사냥','CAT-004'],['스킬','CAT-004'],
  ['접속 부담','CAT-005'],['콘텐츠 확장성 부족','CAT-005'],['스토리','CAT-005'],['이벤트 던전','CAT-005'],['이벤트 던전 재개','CAT-005'],
  ['인벤토리 확장','CAT-006'],['조작 입력 지연','CAT-006'],['화면 요소 작음','CAT-006'],['텍스트 과다 UI','CAT-006'],['조작 유연','CAT-006'],
  ['보안인증 오류','CAT-007'],['비정상 종료','CAT-007'],['발열','CAT-007'],['서버 불안정','CAT-007'],['접속 불가','CAT-007'],['앱 용량','CAT-007'],['발열 적음','CAT-007'],['튕김 적음','CAT-007'],['버퍼링','CAT-007'],
  ['쿠폰 사용 범위','CAT-008'],['보상 미지급','CAT-008'],['서버 선택','CAT-008'],['운영 불만','CAT-008'],['이벤트 미션 설계','CAT-008'],['운영 정성','CAT-008'],['빠른 고객 대응','CAT-008'],['쿠폰 지급','CAT-008'],['점검 시간','CAT-008'],
  ['효과음','CAT-009'],['캐릭터·외형 디자인','CAT-009'],['음악','CAT-009'],['그래픽','CAT-009'],
  ['친구와 함께 플레이','CAT-010'],['길드 가입 어려움','CAT-010'],['파티 사냥','CAT-010'],['커뮤니티 활성','CAT-010'],
  ['진행 데이터 손실','CAT-011'],
  ['어지러움','CAT-013'],['판단 불가','CAT-013'],['눈 피로','CAT-013'],
];
const KEYWORD_ALIASES = {
  '전반적 만족': ['무난함', '시간 보내기 좋음', '게임 품질'],
  '확률형 아이템 불만': ['확률형 아이템 불신', '뽑기 확률 낮음'],
  '광고 부담': ['광고 길이', '광고 과다', '광고 표시 불편'],
  '화면 요소 작음': ['캐릭터 크기 작음'],
  '캐릭터·외형 디자인': ['귀여운 디자인', '캐릭터 디자인', '코스튬'],
  '접속 부담': ['길드 참여 강제'],
};

const CATS = [
  ['CAT-001','성장','레벨업, 강화, 성장 속도'],['CAT-002','경제','재화 수급, 소비, 강화 비용, 게임 내 상점'],
  // B-06 적용(2026-11-26): CAT-003·005·007·010 분류 대상 보완
  ['CAT-003','수익화','과금, 유료 상품, 확률형 아이템(뽑기), 광고'],['CAT-004','전투','전투 재미, 스킬, 난이도, 캐릭터 성능'],
  ['CAT-005','콘텐츠','스테이지, 던전, 스토리, 반복성, 일일 과제·접속 부담(방치 가능성)'],['CAT-006','UX/UI','인터페이스, 가시성, 조작, 편의성'],
  ['CAT-007','기술·안정성','버그, 서버, 발열, 프레임, 튕김, 로딩, 앱 용량, 기기 호환'],['CAT-008','운영','점검, 공지, 이벤트, 고객 대응'],
  ['CAT-009','아트·사운드','그래픽, 디자인, 음악, 효과음'],['CAT-010','소셜','길드, 파티, 유저 간 상호작용, PVP·랭킹·길드전 등 경쟁 시스템'],
  ['CAT-011','계정·데이터','로그인, 연동, 계정 복구, 데이터 손실'],['CAT-012','전체 경험','특정 요소를 지칭하지 않는 게임 전체 평가'],
  ['CAT-013','기타','기존 카테고리에 포함되지 않는 의견'],
];

// B-05: 게임·수집 메타데이터를 별도 파일(games.json, collections.json)로 분리.
const GAMES = [
  { gameId: 'maple', name: '메이플 키우기',
    companyRelation: '넥슨과 에이블게임즈 공동 개발(에이블게임즈 공식 홈페이지 연혁 2025.11). 스토어 개발자 표기는 NEXON Company',
    storeListings: [
      { platform: 'Google Play', storeAppId: GP.maple, storeUrl: `https://play.google.com/store/apps/details?id=${GP.maple}`, storeDeveloperName: 'NEXON Company',
        snapshot: { checkedAt: COLLECTED, rating: 4.6, ratingCountText: '리뷰 12.3만개', downloadsText: '500만+', lastUpdated: '2026-11-21' } },
      { platform: 'App Store', storeAppId: AS.maple, storeUrl: `https://apps.apple.com/kr/app/id${AS.maple}`, storeDeveloperName: null,
        snapshot: { checkedAt: COLLECTED, rating: 4.5, ratingCountText: '2.6만개의 평가', downloadsText: null, lastUpdated: null } },
    ] },
  { gameId: 'daltoki', name: '달토끼 키우기',
    companyRelation: '에이블게임즈 자체 개발·서비스(공식 홈페이지 연혁 2021.06 국내 출시)',
    storeListings: [
      { platform: 'Google Play', storeAppId: GP.daltoki, storeUrl: `https://play.google.com/store/apps/details?id=${GP.daltoki}`, storeDeveloperName: 'Ablegames',
        snapshot: { checkedAt: COLLECTED, rating: 4.7, ratingCountText: '리뷰 7.34만개', downloadsText: '100만+', lastUpdated: '2026-10-29' } },
      { platform: 'App Store', storeAppId: AS.daltoki, storeUrl: `https://apps.apple.com/kr/app/id${AS.daltoki}`, storeDeveloperName: null,
        snapshot: { checkedAt: COLLECTED, rating: 4.7, ratingCountText: '2.5천개의 평가', downloadsText: null, lastUpdated: null } },
    ] },
];
const GP_METHOD = { selectionMethod: '웹 스토어 > 리뷰 모두 보기 > 기기 "전화"(기본값) > 정렬 "최신" > 처음 로드된 20건', sortOrder: 'newest', deviceFilter: '전화', requestedCount: 20 };
const AS_METHOD = { selectionMethod: '웹 스토어 평가 및 리뷰 페이지(see-all=reviews, iPhone)의 기본 노출 리뷰 전체. 정렬 옵션 없음', sortOrder: 'store_default', deviceFilter: 'iPhone', requestedCount: null };
const COLLECTIONS = [
  { collectionId: 'C-maple-google', gameId: 'maple', platform: 'Google Play', ...GP_METHOD },
  { collectionId: 'C-maple-apple', gameId: 'maple', platform: 'App Store', ...AS_METHOD },
  { collectionId: 'C-daltoki-google', gameId: 'daltoki', platform: 'Google Play', ...GP_METHOD },
  { collectionId: 'C-daltoki-apple', gameId: 'daltoki', platform: 'App Store', ...AS_METHOD },
].map(c => ({ ...c, locale: 'ko-KR', collectedAt: COLLECTED, collectionTool: '브라우저 화면 열람(자동 수집 도구·비공식 API 미사용)',
  excludedFields: ['작성자 닉네임', '프로필 이미지', '유용함 수', '개발자 답변', '리뷰 원문 전문'], dataType: 'actual' }));
const collectionIdOf = (g, pf) => `C-${g}-${pf}`;

// B-03: publishedAt = KST(UTC+9) 기준 날짜 'YYYY-MM-DD'. 스토어 원래 값은 publishedAtRaw에 보존.
// Google Play 화면 날짜는 이미 한국 시간 날짜(hl=ko, gl=KR, 한국 PC 브라우저) → 그대로 사용.
// App Store datetime 속성은 UTC 시각 → +9시간 후 날짜만 사용.
function toKstDate(raw) {
  if (raw == null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const t = Date.parse(raw);
  if (Number.isNaN(t) || !/Z$/.test(raw)) throw new Error('unsupported date ' + raw);
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
const reviews = R.map(([code, g, pf, ext, rating, pub, summary]) => ({
  reviewId: 'R-' + code, externalReviewId: ext, gameId: g, collectionId: collectionIdOf(g, pf),
  platform: pf === 'google' ? 'Google Play' : 'App Store', rating,
  originalText: null, summary, publishedAt: toKstDate(pub), publishedAtRaw: pub, collectedAt: COLLECTED,
  sourceUrl: pf === 'google' ? gpUrl(g, ext) : asUrl(g), appVersion: null, dataType: 'actual',
  helpfulCount: null, sampleRole: 'distribution', labelSource: 'gvl_manual',
}));
const counter = {};
const opinions = OP.map(([code, cat, s, ot, kw, sum]) => {
  counter[code] = (counter[code] || 0) + 1;
  const key = `${code}-${counter[code]}`;
  const ev = EV[key];
  if (!ev) throw new Error('missing excerpt ' + key);
  if ([...ev].length > EXCERPT_MAX) throw new Error(`excerpt too long (${[...ev].length}) ${key}`);
  return { opinionId: `O-${key}`, reviewId: 'R-' + code, categoryId: cat, sentiment: s,
    otherType: ot, keyword: kw, summary: sum, evidenceText: ev,
    verificationStatus: HOLD[key] ? 'on_hold' : 'unreviewed', holdReason: HOLD[key] || null, labelSource: 'gvl_manual' };
});
for (const k of Object.keys(HOLD)) if (!opinions.some(o => o.opinionId === 'O-' + k)) throw new Error('hold without opinion ' + k);
for (const o of opinions) {
  if (!STATUSES.includes(o.verificationStatus)) throw new Error('status ' + o.opinionId);
  if ((o.verificationStatus === 'on_hold') !== (o.holdReason !== null)) throw new Error('holdReason ' + o.opinionId);
}
const unusedEv = Object.keys(EV).filter(k => !opinions.some(o => o.opinionId === 'O-' + k));
if (unusedEv.length) throw new Error('excerpt without opinion: ' + unusedEv.join(', '));
const categories = CATS.map(([id, name, scope]) => ({ categoryId: id, name, scope }));

// ---- 데이터 확장(2026-11-26): 스토어 웹 열람 확인 리뷰 + 팀원 라벨 변환분 병합 ----
// 생성: python tools/convert_team_labels.py → tools/generated/team_web_import.json
const IMPORT_PATH = path.join(__dirname, 'generated', 'team_web_import.json');
const WEB_COLLECTIONS = {
  gp_web_newest: { collectionId: 'C-daltoki-gp-web-newest', platform: 'Google Play', sortOrder: 'newest', deviceFilter: '전화', requestedCount: null,
    selectionMethod: '웹 스토어 > 리뷰 모두 보기 > 기기 "전화" > 정렬 "최신" > 화면에 로드된 처음 200건 (실제 분포용)' },
  gp_web_rating1_supplement: { collectionId: 'C-daltoki-gp-web-rating1', platform: 'Google Play', sortOrder: 'newest', deviceFilter: '전화', requestedCount: null,
    selectionMethod: '웹 스토어 > 리뷰 모두 보기 > 정렬 "최신" > 별표 평점 "별 1개" > 처음 150건 (부정 보강용, 분포 계산 제외)' },
  gp_web_rating2_supplement: { collectionId: 'C-daltoki-gp-web-rating2', platform: 'Google Play', sortOrder: 'newest', deviceFilter: '전화', requestedCount: null,
    selectionMethod: '웹 스토어 > 리뷰 모두 보기 > 정렬 "최신" > 별표 평점 "별 2개" > 표시된 118건 전체 (부정 보강용, 분포 계산 제외)' },
  ios_web_default: { collectionId: 'C-daltoki-ios-web', platform: 'App Store', sortOrder: 'store_default', deviceFilter: 'iPhone', requestedCount: null,
    selectionMethod: '웹 스토어 평가 및 리뷰 페이지 기본 노출 10건' },
};
let imported = null;
if (fs.existsSync(IMPORT_PATH)) {
  imported = JSON.parse(fs.readFileSync(IMPORT_PATH, 'utf8'));
  for (const [g, c] of Object.entries(WEB_COLLECTIONS)) {
    COLLECTIONS.push({ ...c, gameId: 'daltoki', locale: 'ko-KR', collectedAt: COLLECTED, dataType: 'actual',
      collectionTool: '브라우저 화면 열람 + 지문 대조 검증(review-analysis/data/data-sources.md 9장)',
      excludedFields: ['작성자 닉네임', '프로필 이미지', '앱 버전(웹 미표시)', '개발자 답변', '리뷰 원문 전문'], collectionGroup: g });
  }
  for (const r of imported.reviews) {
    const c = WEB_COLLECTIONS[r.collectionGroup];
    if (!c) throw new Error('unknown collection group ' + r.collectionGroup);
    reviews.push({
      reviewId: 'R-' + r.code, externalReviewId: r.externalReviewId, gameId: r.gameId, collectionId: c.collectionId,
      platform: r.platform, rating: r.rating, originalText: null, summary: r.summary,
      publishedAt: r.publishedAt, publishedAtRaw: r.publishedAtRaw, collectedAt: r.collectedAt || COLLECTED,
      sourceUrl: r.sourceUrl, appVersion: null, dataType: 'actual',
      helpfulCount: r.helpfulCount, sampleRole: r.sampleRole, labelSource: r.labelSource, collectionGroups: r.collectionGroups,
    });
  }
  for (const o of imported.opinions) {
    if (o.evidenceText !== null && [...o.evidenceText].length > EXCERPT_MAX) throw new Error('import excerpt too long ' + o.opinionCode);
    if ((o.verificationStatus === 'on_hold') !== (o.holdReason !== null)) throw new Error('import holdReason ' + o.opinionCode);
    opinions.push({ opinionId: 'O-' + o.opinionCode, reviewId: 'R-' + o.reviewCode, categoryId: o.categoryId, sentiment: o.sentiment,
      otherType: o.otherType, keyword: o.keyword, summary: o.summary, evidenceText: o.evidenceText,
      verificationStatus: o.verificationStatus, holdReason: o.holdReason, labelSource: o.labelSource });
  }
  for (const k of imported.keywords) {
    const ex = KEYWORD_LIST.find(([kw]) => kw === k.keyword);
    if (ex && ex[1] !== k.categoryId) throw new Error(`import keyword category conflict ${k.keyword}`);
    if (!ex) KEYWORD_LIST.push([k.keyword, k.categoryId]);
  }
}

// integrity checks
const rid = new Set(reviews.map(r => r.reviewId));
const ext = new Set();
for (const r of reviews) { const k = r.platform + r.externalReviewId; if (ext.has(k)) throw new Error('dup ' + k); ext.add(k); }
for (const o of opinions) {
  if (!rid.has(o.reviewId)) throw new Error('orphan ' + o.opinionId);
  if ((o.sentiment === 'other') !== (o.otherType !== null)) throw new Error('otherType ' + o.opinionId);
  if (!CATS.find(c => c[0] === o.categoryId)) throw new Error('cat ' + o.opinionId);
}
for (const r of reviews) if (!opinions.some(o => o.reviewId === r.reviewId)) throw new Error('no opinion ' + r.reviewId);

// collections: 실제 리뷰에서 건수·작성일 범위 계산, 참조 검증
const collections = COLLECTIONS.map(c => {
  if (!GAMES.some(g => g.gameId === c.gameId)) throw new Error('collection game ' + c.collectionId);
  const rs = reviews.filter(r => r.collectionId === c.collectionId);
  const d = rs.map(r => r.publishedAt).filter(Boolean).sort();
  if (c.requestedCount != null && rs.length !== c.requestedCount) throw new Error('count mismatch ' + c.collectionId);
  return { ...c, collectedCount: rs.length, publishedAtMin: d[0] || null, publishedAtMax: d[d.length - 1] || null };
}).filter(c => c.collectedCount > 0 || !c.collectionGroup); // 웹 묶음 중 리뷰가 모두 직접 분류분과 겹쳐 비는 묶음은 제외
for (const r of reviews) {
  const c = collections.find(x => x.collectionId === r.collectionId);
  if (!c || c.gameId !== r.gameId || c.platform !== r.platform) throw new Error('review collection ' + r.reviewId);
}

fs.mkdirSync(out, { recursive: true });
// keyword dictionary: 중복·카테고리 일치·사용 여부 검증
const keywords = KEYWORD_LIST.map(([keyword, categoryId]) => ({ keyword, categoryId, aliases: KEYWORD_ALIASES[keyword] || [] }));
const kwMap = new Map();
for (const k of keywords) {
  if (kwMap.has(k.keyword)) throw new Error('dup keyword ' + k.keyword);
  if (!CATS.some(c => c[0] === k.categoryId)) throw new Error('keyword cat ' + k.keyword);
  kwMap.set(k.keyword, k);
}
for (const a of Object.keys(KEYWORD_ALIASES)) if (!kwMap.has(a)) throw new Error('alias target ' + a);
const allAliases = keywords.flatMap(k => k.aliases);
for (const o of opinions) {
  const k = kwMap.get(o.keyword);
  if (!k) throw new Error(`keyword not in dictionary ${o.opinionId}: ${o.keyword}` + (allAliases.includes(o.keyword) ? ' (alias — use canonical)' : ''));
  if (k.categoryId !== o.categoryId) throw new Error(`keyword category mismatch ${o.opinionId}`);
}
for (const k of keywords) if (!opinions.some(o => o.keyword === k.keyword)) throw new Error('unused keyword ' + k.keyword);
fs.writeFileSync(path.join(out, 'keywords.json'), JSON.stringify(keywords, null, 2));
fs.writeFileSync(path.join(out, 'games.json'), JSON.stringify(GAMES, null, 2));
fs.writeFileSync(path.join(out, 'collections.json'), JSON.stringify(collections, null, 2));
fs.writeFileSync(path.join(out, 'reviews.json'), JSON.stringify(reviews, null, 2));
fs.writeFileSync(path.join(out, 'opinions.json'), JSON.stringify(opinions, null, 2));
fs.writeFileSync(path.join(out, 'categories.json'), JSON.stringify(categories, null, 2));

// stats
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : 'N/A';
function stats(label, rs) {
  const ids = new Set(rs.map(r => r.reviewId));
  const ops = opinions.filter(o => ids.has(o.reviewId));
  const rated = rs.filter(r => r.rating != null);
  const avg = rated.length ? (rated.reduce((a, r) => a + r.rating, 0) / rated.length).toFixed(2) : 'N/A';
  const dist = [1,2,3,4,5].map(s => `${s}★${rated.filter(r => r.rating === s).length}`).join(' ');
  const c = s => ops.filter(o => o.sentiment === s).length;
  console.log(`\n## ${label}: 리뷰 ${rs.length}, 평균 ${avg} (${dist}), 의견 ${ops.length} | 긍정 ${c(P)} ${pct(c(P),ops.length)} / 부정 ${c(N)} ${pct(c(N),ops.length)} / 기타 ${c(O)} ${pct(c(O),ops.length)} (건의 ${ops.filter(o=>o.otherType==='suggestion').length})`);
  return ops;
}
const all = stats('전체', reviews);
stats('메이플 키우기', reviews.filter(r => r.gameId === 'maple'));
stats('달토끼 키우기', reviews.filter(r => r.gameId === 'daltoki'));
stats('Google Play', reviews.filter(r => r.platform === 'Google Play'));
stats('App Store', reviews.filter(r => r.platform === 'App Store'));
console.log('\n## 카테고리별 (전체)');
for (const [id, name] of CATS) {
  const ops = all.filter(o => o.categoryId === id);
  const c = s => ops.filter(o => o.sentiment === s).length;
  console.log(`${id} ${name}: ${ops.length} (${pct(ops.length, all.length)}) | +${c(P)} -${c(N)} o${c(O)}`);
}
console.log('\n## 키워드 상위 (부정)');
const kw = s => Object.entries(all.filter(o => o.sentiment === s).reduce((m, o) => (m[o.keyword] = (m[o.keyword] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', ');
console.log(kw(N));
console.log('## 키워드 상위 (긍정)'); console.log(kw(P));
console.log('\n## 별점-감성 불일치: 5★ 리뷰 중 부정 의견 포함', reviews.filter(r => r.rating === 5 && opinions.some(o => o.reviewId === r.reviewId && o.sentiment === N)).map(r => r.reviewId).join(', '));
console.log('## 의견 수별 리뷰', JSON.stringify(Object.entries(reviews.reduce((m, r) => { const n = opinions.filter(o => o.reviewId === r.reviewId).length; m[n] = (m[n] || 0) + 1; return m; }, {}))));
