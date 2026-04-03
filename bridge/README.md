# LoL 클라이언트 브릿지

LoL 클라이언트의 챔피언 셀렉트 데이터를 눈오는 헤네시스 웹앱에 실시간 전달합니다.

## 사용법

```bash
cd bridge
npm install
node index.js
```

그 다음 웹앱 밴픽 화면에서 **🔌 클라이언트 연결** 버튼을 클릭하세요.

## 요구 사항
- Node.js 18+
- LoL 클라이언트가 실행 중이어야 함
- 브릿지와 웹앱이 같은 PC에서 실행

## 작동 방식
1. `league-connect`로 LoL 클라이언트의 LCU API에 연결
2. 챔피언 셀렉트 이벤트를 WebSocket으로 구독
3. 밴/픽 변경 시 `ws://localhost:8234`로 웹앱에 전달
4. 웹앱에서 자동으로 밴/픽 슬롯에 반영
