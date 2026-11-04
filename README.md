# 장애인식개선 퀴즈

교직원 연수용 실시간 퀴즈. 진행자는 `host.html`을 열고, 참가자는 QR(또는 PIN)로 들어와 닉네임으로 참여합니다.

- 문제 내용: `quiz.js`
- Firebase 연결: `config.js`
- 점수: 정답 500~1000점(빨리 낼수록 높음), 오답 0점, `double: true` 문제는 2배

## 초등학교 편
- 진행자 화면: `host.html?quiz=elem` (참가자 QR에도 `quiz=elem`이 자동으로 붙습니다)
- 문제 내용: `quiz-elem.js` (고등학교 기준 문항을 초등학교 기준으로 바꾼 버전)
