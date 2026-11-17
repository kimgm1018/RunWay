"""데모 토큰을 URL과 Authorization 헤더에서 검사한다."""
import hmac

from fastapi import Request

from app.inference import ApiError


def reject_query_token(request: Request) -> None:
    if "token" in request.query_params or "access_token" in request.query_params:
        raise ApiError(400, "VALIDATION_ERROR", "토큰은 URL에 넣을 수 없습니다.")


def bearer_present(request: Request, expected: str | None) -> bool:
    """900: Authorization 헤더가 없으면 False(공개 경로 판단은 호출한 쪽). 헤더가 있으면 맞을 때만 True, 틀리면 401."""
    if not request.headers.get("authorization", "").strip():
        return False
    require_bearer(request, expected)
    return True


def require_bearer(request: Request, expected: str | None) -> None:
    value = request.headers.get("authorization", "")
    prefix = "Bearer "
    supplied = value[len(prefix):] if value.startswith(prefix) else ""
    if not expected or not hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
        raise ApiError(401, "UNAUTHORIZED", "인증에 실패했습니다.")
