# 장애인식개선 퀴즈

교직원 연수용 실시간 퀴즈. 진행자는 `host.html`을 열고, 참가자는 QR(또는 PIN)로 들어와 닉네임으로 참여합니다.

- 문제 내용: `quiz.js`
- Firebase 연결: `config.js`
- 점수: 정답 500~1000점(빨리 낼수록 높음), 오답 0점, `double: true` 문제는 2배

## 초등학교 편 (별도 폴더)
- `elem/` 폴더에 고등 버전과 완전히 따로 들어 있습니다. 주소: `.../live-quiz/elem/host.html`
- 문제 내용: `elem/quiz.js` (고등 `quiz.js`는 건드리지 않습니다)
