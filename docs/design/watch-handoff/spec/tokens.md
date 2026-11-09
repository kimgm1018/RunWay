# 디자인 토큰

기계 판독용: `tokens.json`

## 색
| 토큰 | 값 |
| --- | --- |
| background | #050D14 |
| surface | #111D27 |
| text | #FFFFFF |
| textSecondary | rgba(255,255,255,0.62) |
| textDim | rgba(255,255,255,0.45) |
| primary | #4DFFD2 |
| onPrimary | #000000 |
| warning | #FF5C7A |
| onWarning | #000000 |
| heart | #FF5C7A |
| rimGauge | #4DC4FF |
| rimTrack | rgba(77,196,255,0.2) |
| line | rgba(255,255,255,0.18) |

### 색 사용 규칙
- 민트(primary)는 화면의 핵심 숫자 1개와 하단 주 버튼(러닝 시작·재개·다시 확인·닫기 등)에만 사용
- 블루(rimGauge)는 테두리 진행 호 4개·끝 동그라미·페이스 점 눈금에만 사용
- 핑크(warning)는 실패·경고 문구, 취소 버튼, 심박 하트에 사용. 상태는 색만이 아니라 아이콘·문구를 같이 씀
- 그 밖의 칩·문구·단계 표시·작은 숫자는 흰색/흰색 62%

## 글꼴
- 숫자·영문: **Rajdhani** 400/500/600/700 — ′ ″ 대신 ’ ” 사용
- 한글: **Noto Sans KR** 400/500/700

## 글자 크기 (px, 454 화면 기준 · 1dp = 2px)
| 역할 | px |
| --- | --- |
| hero_single_char | 150 |
| hero_2to4_chars | 132 |
| hero_long | 116 |
| hero_pace | 104 |
| detail_number | 104 |
| title | 30–34 (bold) |
| status_strong | 20–24 (bold) |
| body_secondary | 16 |
| label | 16 |
| chip | 20 |
| button | 22 |

## 레이아웃·부품 (454 화면 기준)
```json
{
 "screen": {
  "size": 454,
  "shape": "circle"
 },
 "content_box": "top 50–72 · bottom 84–104(버튼 있을 때 104) · left/right 70",
 "bottom_button": {
  "left": 107,
  "top": 358,
  "width": 240,
  "height": 96,
  "radius": "24 24 0 0",
  "note": "227dp 기준 좌표. Wear OS에서는 EdgeButton 등 적응형으로"
 },
 "confirm_split_buttons": {
  "top": 358,
  "each_width": 118,
  "gap": 4,
  "left_radius": "24 6 0 0",
  "right_radius": "6 24 0 0"
 },
 "edge_handle": {
  "right": 0,
  "top": 179,
  "visible": "44×88",
  "touch": "96×96",
  "use": "러닝 중 ❚❚ = 일시정지 요청 / 일시정지 중 ■ = 종료 확인"
 },
 "rim_arcs": {
  "radius": 208,
  "stroke": 8,
  "quadrants_start_deg": {
   "tl": -78,
   "tr": 22,
   "br": 102,
   "bl": 202
  },
  "span_deg": 56,
  "knob_r": 7,
  "meaning": {
   "tl": "목표 거리 진행",
   "tr": "목표 시간 진행",
   "bl": "심박(기준 범위 미정)",
   "br": "케이던스(기준 범위 미정)"
  },
  "opacity": {
   "normal": 0.85,
   "dim": 0.4
  }
 },
 "pace_ticks": {
  "radius": 172,
  "count": 41,
  "from_deg": -130,
  "to_deg": 130,
  "on": "rimGauge, width 5",
  "off": "white 14%, width 4",
  "range": "8’00” → 4’00” (시안 범위)"
 },
 "page_dots": {
  "radius": 208,
  "spacing_deg": 7,
  "size_current": 12,
  "size_other": 8,
  "position": "위쪽 호"
 },
 "touch_min": "48dp (96px)"
}
```
