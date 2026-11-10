"""오류 코드·HTTP 상태·사용자용 한국어 메시지. BE Route 내부 계약(MR !183, docs/design/api/ai-service.md
"Route 코스 생성 내부 HTTP 계약 초안")을 따른다.

응답 모양: non-2xx + {"code", "message", "details"} (details는 없으면 null). ok 필드는 없다.
  400 VALIDATION_ERROR                 요청 형식 오류(details.fields = [{name, reason}])
  422 업무 오류                         요청 내용으로 코스를 만들 수 없음(아래 STATUS)
  503 NOT_READY / BUSY / TIMEOUT / UNAVAILABLE
  500 INTERNAL / SAFETY_CHECK / SNAP_NODE_NOT_IN_GENERATION_GRAPH
코드와 메시지는 예전 데모(route_demo/app_runway.py)와 같다. ROUTE_DEBUG=1이면 최상위에 debug가 붙는다(개발용).
"""
from fastapi.responses import JSONResponse

REROLL_NO_ROUTE_MESSAGE = "이 조건으로 더 보여 드릴 다른 코스가 없어요."
# basemap(S15P31E105-612) 문구. code는 기존 OUT_OF_AREA / UNAVAILABLE을 쓴다.
BASEMAP_OUT_OF_AREA_MESSAGE = "요청한 지도 범위가 전국 지도 자료 범위 밖이에요."
BASEMAP_UNSUPPORTED_MESSAGE = "이 Route 서비스 설정(부산 모드)에서는 지도 바탕 자료를 제공하지 않아요."
BASEMAP_BUSY_MESSAGE = "다른 지도 바탕 자료를 만드는 중이에요. 잠시 후 다시 시도해 주세요."
BASEMAP_INTERNAL_MESSAGE = "지도 바탕 자료를 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요."

NO_ROAD_MESSAGE = "고른 위치 주변에 달릴 수 있는 길이 없어요 (바다나 산속일 수 있어요). 길 가까이를 눌러 주세요."
END_SNAP_MESSAGE = "도착 위치 근처에서 안전하게 달릴 수 있는 길을 찾지 못했어요. 도착 위치를 길 가까이로 옮겨 주세요."
SHAPE_FAIL = {  # 새 모양(왕복·편도)의 blocking issue code -> 사용자 메시지 (code는 그대로 쓴다)
    "OUT_OF_APP_RANGE": "현재 앱 범위를 벗어난 목적지입니다. 21.1 km 안쪽의 도착 위치를 골라 주세요.",
    "END_SNAP_PE1": END_SNAP_MESSAGE, "END_SNAP_PE2": END_SNAP_MESSAGE, "END_SNAP_PE4": END_SNAP_MESSAGE,
    "END_SNAP_PE5": END_SNAP_MESSAGE,
    "SNAP_NODE_NOT_IN_GENERATION_GRAPH": "코스를 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
}
MESSAGES = {
    "NOT_READY": "추천 엔진을 준비하는 중이에요. 잠시 후 다시 눌러 주세요.",
    "BUSY": "다른 코스를 만드는 중이에요. 잠시 후 다시 시도해 주세요.",
    "TIMEOUT": "코스를 만들 시간이 부족해요. 잠시 후 다시 시도해 주세요.",
    "UNAVAILABLE": "추천 엔진을 시작하지 못했어요. 개발자에게 알려 주세요.",
    "INTERNAL": "코스를 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
    "DESTINATION_REQUIRED": "편도 코스는 도착 위치를 정해 주세요.",
    "OUT_OF_AREA": "현재 위치는 아직 추천 지역(부산) 밖이에요. 지도에서 부산 안의 출발 위치를 골라 주세요.",
    "SAFETY_CHECK": "안전 확인을 통과하지 못한 길이 섞여 있어 추천을 멈췄어요.",
    "USABILITY_GATE_ALL_FAILED": "이 위치와 거리로는 안전 기준을 통과한 코스를 찾지 못했어요. 거리나 출발 위치를 바꿔 보세요.",
    "NO_ROUTE": "이 위치와 거리로는 코스를 만들지 못했어요. 거리를 바꾸거나 큰길·공원 근처로 출발 위치를 옮겨 보세요.",
    "NO_ROAD_NEARBY": NO_ROAD_MESSAGE,
    "VALIDATION_ERROR": "요청 값이 유효하지 않습니다.",
    **SHAPE_FAIL,
}
STATUS = {
    "VALIDATION_ERROR": 400,
    # 422 업무 오류
    "DISTANCE_RANGE": 422, "DESTINATION_REQUIRED": 422, "OUT_OF_APP_RANGE": 422, "OUT_OF_AREA": 422,
    "NO_ROAD_NEARBY": 422, "DESTINATION_TOO_FAR": 422, "END_SNAP_PE1": 422, "END_SNAP_PE2": 422,
    "END_SNAP_PE4": 422, "END_SNAP_PE5": 422, "USABILITY_GATE_ALL_FAILED": 422, "NO_ROUTE": 422,
    # 503 준비·혼잡·시간·시작 실패
    "NOT_READY": 503, "BUSY": 503, "TIMEOUT": 503, "UNAVAILABLE": 503,
    # 500 서버 쪽 문제
    "INTERNAL": 500, "SAFETY_CHECK": 500, "SNAP_NODE_NOT_IN_GENERATION_GRAPH": 500,
}


def fail(code: str, message: str | None = None, *, details: dict | None = None, debug=None,
         include_debug: bool = False) -> JSONResponse:
    """오류 응답. debug는 include_debug(ROUTE_DEBUG=1)일 때만 붙인다."""
    body = {"code": code, "message": MESSAGES[code] if message is None else message, "details": details}
    if include_debug and debug is not None:
        body["debug"] = debug
    return JSONResponse(body, status_code=STATUS[code])
