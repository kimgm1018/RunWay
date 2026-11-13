# RUNWAY 로고 에셋

S15P31E105-729에서 확정한 로고다(2026-11-12). 경사진 트랙 심볼(러너 무리 3명과 뒤처진 러너 1명)과 `RUN'WAY"` 워드마크로 이루어진다.
적용 범위는 S15P31E105-744를 따른다. 앱 화면은 워드마크만 쓰고, 랜딩 페이지는 전체 로고와 파비콘을 쓴다.
앱 아이콘과 Android 12 스플래시 아이콘은 아직 이전 로고(`assets/images/`)다.

## 색상

| 용도 | 값 |
|---|---|
| 배경(다크) | `#02050E` |
| 트랙 네이비 | `#081029` |
| 민트(테두리·글로우·러너) | `#4DFFD2`. 앱의 민트와 같다 |
| 레인 선·워드마크 | `#FFFFFF`. 밝은 배경에서는 워드마크만 `#081029` |
| 뒤처진 러너 | `#4DFFD2`, 불투명도 50% |

## 파일

```
source/  runway-logo-final-2048.png       확정 원본(AI 생성 2048px, 배경 #02050E)
         runway-logo-designer.png         디자이너 원본(코스 루프 + RUN'WAY"). 워드마크 경로를 여기서 땄다
svg/     runway-logo.svg                  전체 로고, 다크 배경 포함
         runway-logo-transparent.svg      전체 로고, 배경 없음(어두운 배경 위 전용)
         runway-symbol.svg                심볼만, 배경 없음
         runway-wordmark-white.svg        워드마크 흰색(어두운 배경)
         runway-wordmark-navy.svg         워드마크 네이비(밝은 배경)
png/     runway-logo-{1024,512}.png       전체 로고, 다크 배경
         runway-logo-transparent-2048.png 전체 로고, 투명 배경
         runway-symbol-transparent.png    심볼, 투명 배경
         runway-symbol-dark.png           심볼, 다크 배경
         runway-wordmark-{white,navy}.png 워드마크, 투명 배경
icon/    app-icon-{1024,512,192}.png      앱 아이콘(정사각, 모서리는 스토어·OS가 깎는다)
         adaptive-icon-foreground-1024.png  Android 적응형 아이콘 전경(투명, 66% 안전 영역 안)
         apple-touch-icon-180.png         iOS 홈 화면 아이콘
         favicon-{48,32,16}.png, favicon.ico  웹 파비콘
```

## 참고

- 확정 원본은 AI로 생성한 이미지다. 전체 로고와 심볼 SVG는 원본의 색 영역을 윤곽선으로 따서 만들었다. 트랙·레인 선·러너는 벡터 경로이고, 글로우는 SVG 블러 필터, 안쪽 면은 그라데이션으로 다시 그렸다. 원본보다 글로우가 약간 좁다.
- 워드마크 SVG와 앱의 `src/components/logoPath.ts` `wordmarkPath`는 디자이너 원본에서 글자만 딴 같은 경로다.
- 글로우와 투명 배경 에셋은 어두운 배경 전용이다. 밝은 배경에는 네이비 워드마크만 쓴다.
- 16·32px 파비콘에서는 레인 선과 러너가 거의 보이지 않고 트랙 모양과 민트 테두리만 읽힌다.
