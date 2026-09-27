# 손글씨 영상 메이커

손글씨 사진을 넣으면 한 획씩 써지는 영상(MP4)으로 만드는 무료 웹 도구입니다.

- 주소: https://tools.musicits.com/handwriting-video/
- 설치 없이 윈도우 엣지·크롬 최신판에서 바로 씁니다. 사진·소리·영상은 브라우저 밖으로 나가지 않습니다.
- 종이: 원본 사진 · 줄공책 · 모눈 노트 · 편지지 · 양피지 · 항공 엽서 · 크라프트지 · 화이트보드 · 초록 칠판 · 검은 칠판
- 소리: 녹음 파일이나 글씨 쓰는 동영상을 올리면 소리 나는 부분만 골라 획이 써질 때만 붙입니다.

## 파일

- `index.html` 화면 · `app.js` 화면 동작 · `engine.js` 인식·렌더링·MP4 인코딩
- `lib/mp4-muxer.js` MP4 묶기 ([mp4-muxer](https://github.com/Vanilagy/mp4-muxer) 5.2.1, MIT)

인터넷 없이 쓰려면 폴더째 받아 `index.html` 을 엣지·크롬으로 엽니다.

Crafted by [쭈뉘의 뮤직잇츠 music ITs](https://blog.naver.com/musicits) · © 2026 music ITs
