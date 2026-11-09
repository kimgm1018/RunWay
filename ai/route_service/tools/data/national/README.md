# 전국 저장소 빌드

Python 3.12와 서비스의 `requirements.txt`, `constraints.txt`를 사용한다. 원본과 출력은 별도 폴더다.
기존 완성 저장소와 `store_prep`를 덮어쓰지 않는다. 서비스는 자료를 만들거나 수정하지 않는다.

입력 폴더에는 highway PBF 하나(`*highways*.osm.pbf`), `env_layers_national.geojson`,
`env_layers_national.json`(원본 extract의 `bbox_wsen`, `osm_data_timestamp`),
`copernicus_glo30_national.tif`(EPSG:4326, 회전 없는 DEM)가 필요하다.
PBF node/way ID는 오름차순이며 모든 way의 node 참조가 있어야 한다.

서비스 폴더(`ai/route_service`)에서 순서대로 실행한다.

```powershell
python -B tools/data/national/build_store.py --input-dir C:\data\national-input --output-dir C:\data\national-bundle
python -B tools/data/national/build_prep.py --national-dir C:\data\national-bundle
python -B tools/data/national/build_prep.py --national-dir C:\data\national-bundle --verify
```

출력은 다음과 같다.

- `store/`: network·grid·envcache·DEM의 무압축 `.npy`, 문자열 표, 공간 색인 `envcache/layers.gpkg`, 마지막에 생성하는 `MANIFEST.json`. 약 4.5 GiB.
- `store_prep/`: way별 attrs/status/reason/flags/table, 문자열 표, 코드·패키지·원본 manifest와 출력 크기·SHA256을 기록한 manifest. 약 0.4 GiB.
- `env_layers_national.json`: 원본 범위·시점 메타데이터. 새 store manifest에도 그 내용을 넣는다.

기본 출력은 `ai/route_service/artifacts/national/`이며 Git에서 제외한다. 원본이나 출력 자료를 Git에 넣지 않는다.
빌드는 network → grid → envcache → DEM → manifest → prep 순서다. 중단한 store는 같은 출력 폴더에서
`--stage network|grid|envcache|dem|manifest`로 단계별 실행할 수 있지만 입력은 바꾸면 안 된다.
envcache 진행 파일의 원본/코드 식별자가 달라지면 새 출력 폴더에서 다시 빌드한다.
완료된 manifest가 있는 store는 수정하지 않는다. prep 중단 폴더도 보존하고 별도 폴더에서 새로 만든다.

메모리는 큰 Python dict 대신 배열과 mmap을 사용하며 prep은 기본 8,192 ways씩 처리한다
(`--chunk 1..32768`). 단계 경계에서 기록된 peak RSS가 4 GiB를 넘으면 중단한다.
이 검사는 단계 도중 메모리 상승을 막는 한도가 아니다. 검토자는 Windows 작업 관리자 또는
Linux `/usr/bin/time -v`로 실제 최고 RSS와 빌드 시간을 측정해야 한다. 현재 코드의 실측값은 아직 없다.
프로토타입의 서울 15 km 요청 최고 RSS 약 1.3 GiB는 빌더 메모리나 현재 버전의 측정값이 아니다.

`--verify`는 store와 prep 파일의 전체 SHA256을 확인한다. 배포 전 한 번 실행한다.
서비스 시작에는 format/version, 코드·패키지, 원본 manifest, 파일 크기와 배열 모양을 확인하고
읽기 전용 mmap을 연다. 매 요청에 전국 파일을 다시 해싱하지 않는다.
배포 후 파일을 같은 크기로 바꾸는 경우까지 시작 시 탐지하는 것은 아니므로 검증한 자료를 불변·읽기 전용으로 마운트한다.

기존 `route_kr_store_v1`의 B2 자료는 `national/legacy.py`에 등록된 store/prep manifest 한 쌍과
호환 코드·패키지 조건을 만족할 때만 허용한다. 절대 경로와 mtime을 재사용하지 않아 폴더를 옮길 수 있다.
이 스냅샷에는 루트 env JSON이 없어 당시 확인된 범위·시점을 연결한다. 다른 구버전 자료는 자동 허용하지 않는다.
새 빌더는 현재 생성자로 표를 만들며 프로파일 실행 파일이나 과거 코드 폴더를 요구하지 않는다.

NumPy 2.5.4의 mmap/고급 인덱싱 문서는 Context7의 `/numpy/numpy/v2.5.4`로 2026-11-09 확인했다.
선택 위치 인덱싱은 창 크기의 복사본을 만들며 원본 mmap은 `mmap_mode='r', allow_pickle=False`로 연다.
