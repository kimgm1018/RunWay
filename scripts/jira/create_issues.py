"""Read-only planning by default; create one explicitly approved Jira Cloud issue."""
from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass, field
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[2]


class JiraError(Exception):
    """A message safe to display without an HTTP response body or credentials."""


def read_env(path: Path) -> dict[str, str]:
    """Read simple dotenv entries, without executing or expanding their values."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            raise JiraError(f".env {number}행: KEY=VALUE 형식이 필요합니다.")
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise JiraError(f".env {number}행: 잘못된 설정 이름입니다.")
        if value.startswith(("'", '"')):
            delimiter = value[0]
            end = value.find(delimiter, 1)
            if end < 0 or (value[end + 1:].strip() and not value[end + 1:].strip().startswith("#")):
                raise JiraError(f".env {number}행: 따옴표를 확인하세요.")
            value = value[1:end]
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
        values[key] = value
    return values


@dataclass(frozen=True)
class Config:
    base_url: str
    project: str
    board: int
    email: str = field(repr=False)
    token: str = field(repr=False)
    api_url: str = ""
    points_field: str = ""

    @classmethod
    def load(cls) -> Config:
        env = {**read_env(ROOT / ".env"), **os.environ}
        required = ("JIRA_BASE_URL", "JIRA_PROJECT_KEY", "JIRA_BOARD_ID", "JIRA_EMAIL", "JIRA_API_TOKEN")
        missing = [key for key in required if not env.get(key, "").strip()]
        if missing:
            raise JiraError("로컬 .env에 필요한 설정: " + ", ".join(missing))
        base = env["JIRA_BASE_URL"].rstrip("/")
        parsed = urlsplit(base)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.path or parsed.query or parsed.fragment or parsed.port not in (None, 443)):
            raise JiraError("JIRA_BASE_URL에는 HTTPS Jira 사이트 주소만 입력하세요.")
        api = env.get("JIRA_API_BASE_URL", base).rstrip("/")
        if api != base and not re.fullmatch(r"https://api\.atlassian\.com/ex/jira/[0-9a-fA-F-]{36}", api):
            raise JiraError("JIRA_API_BASE_URL은 Jira 사이트 또는 scoped token용 Atlassian gateway여야 합니다.")
        project = env["JIRA_PROJECT_KEY"]
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", project):
            raise JiraError("JIRA_PROJECT_KEY 형식을 확인하세요.")
        try:
            board = int(env["JIRA_BOARD_ID"])
        except ValueError:
            raise JiraError("JIRA_BOARD_ID는 양의 정수여야 합니다.") from None
        if board <= 0:
            raise JiraError("JIRA_BOARD_ID는 양의 정수여야 합니다.")
        points = env.get("JIRA_STORY_POINTS_FIELD", "")
        if points and not re.fullmatch(r"customfield_\d+", points):
            raise JiraError("JIRA_STORY_POINTS_FIELD 형식을 확인하세요.")
        return cls(base, project, board, env["JIRA_EMAIL"], env["JIRA_API_TOKEN"], api, points)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward Basic credentials to a redirect target.
        return None


class Client:
    def __init__(self, config: Config):
        self.config = config
        self.opener = build_opener(NoRedirect())

    def request(self, method: str, path: str, *, params=None, body=None):
        if not path.startswith("/rest/"):
            raise JiraError("지원하지 않는 API 경로입니다.")
        url = (self.config.api_url or self.config.base_url) + path
        if params:
            url += "?" + urlencode(params)
        auth = base64.b64encode(f"{self.config.email}:{self.config.token}".encode()).decode()
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = Request(url, data=data, method=method, headers={
            "Authorization": "Basic " + auth, "Accept": "application/json", "Content-Type": "application/json",
        })
        try:
            with self.opener.open(req, timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except HTTPError as exc:
            hints = {400: "입력값과 Jira 생성 필드를 확인하세요.", 401: "이메일·토큰·토큰 만료 및 API 주소를 확인하세요.",
                     403: "프로젝트 권한과 토큰 권한을 확인하세요.", 404: "프로젝트·보드·API 주소를 확인하세요.",
                     429: "요청 제한입니다. 잠시 후 읽기 작업부터 확인하세요."}
            raise JiraError(f"Jira HTTP {exc.code}. " + hints.get(exc.code, "Jira 응답을 확인하세요.")
                            + " 생성·변경 요청은 자동 재시도하지 않습니다.") from None
        except (URLError, TimeoutError, OSError):
            raise JiraError("Jira 연결 실패 또는 시간 초과. 생성 요청 후에는 재실행 전에 Jira에서 생성 여부를 확인하세요.") from None
        except (ValueError, UnicodeError):
            raise JiraError("Jira가 유효한 JSON 응답을 반환하지 않았습니다. 생성 요청을 무작정 재시도하지 마세요.") from None

    def pages(self, path: str, key: str, params=None) -> list[dict]:
        result, start = [], 0
        while True:
            page = self.request("GET", path, params={**(params or {}), "startAt": start, "maxResults": 50})
            rows = page.get(key, page.get("values", []))
            if not isinstance(rows, list):
                raise JiraError("Jira 목록 응답 형식을 확인하세요.")
            result.extend(rows)
            start += len(rows)
            if page.get("isLast") is True or start >= page.get("total", math.inf):
                return result
            if not rows:
                if page.get("total", start) > start or page.get("isLast") is False:
                    raise JiraError("Jira 목록을 끝까지 조회하지 못했습니다.")
                return result

    def search(self, jql: str) -> list[dict]:
        result, token, seen = [], None, set()
        while True:
            params = {"jql": jql, "maxResults": 100, "fields": "summary,issuetype,status"}
            if token:
                params["nextPageToken"] = token
            page = self.request("GET", "/rest/api/3/search/jql", params=params)
            result.extend(page.get("issues", []))
            if page.get("isLast") is True:
                return result
            token = page.get("nextPageToken")
            if not token:
                if page.get("isLast") is False:
                    raise JiraError("Jira 검색 페이지가 누락됐습니다.")
                return result
            if token in seen:
                raise JiraError("Jira 검색 페이지가 반복됩니다.")
            seen.add(token)


def jql_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def load_draft(path: Path) -> dict:
    try:
        draft = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError, UnicodeError):
        raise JiraError("업무 초안 JSON 파일을 읽을 수 없습니다.") from None
    return validate_draft(draft)


def validate_draft(draft: dict) -> dict:
    allowed = {"issue_type", "summary", "description", "acceptance_criteria", "story_points", "assignee", "epic", "sprint_id", "labels", "epic_name", "priority", "priority_reason"}
    if not isinstance(draft, dict) or set(draft) - allowed:
        raise JiraError("지원하지 않는 초안 항목입니다. docs/development/jira-automation.md를 확인하세요.")
    for key in ("issue_type", "summary", "description"):
        if not isinstance(draft.get(key), str) or not draft[key].strip():
            raise JiraError(f"초안에 {key} 문자열이 필요합니다.")
    if draft["issue_type"] not in ("Task", "Story", "Epic", "작업", "스토리", "에픽"):
        raise JiraError("Task/Story/Epic만 지원합니다. Subtask는 생성하지 않습니다.")
    is_epic = draft["issue_type"] in ("Epic", "에픽")
    if len(draft["summary"]) > 255 or any(ord(c) < 32 for c in draft["summary"]):
        raise JiraError("제목은 줄바꿈 없이 255자 이하여야 합니다.")
    criteria = draft.get("acceptance_criteria")
    if not isinstance(criteria, list) or not criteria or any(not isinstance(x, str) or not x.strip() for x in criteria):
        raise JiraError("acceptance_criteria에 한 개 이상의 완료 조건이 필요합니다.")
    points = draft.get("story_points")
    if is_epic and points is not None:
        raise JiraError("Epic에는 story_points를 지정하지 않습니다.")
    if not is_epic and (isinstance(points, bool) or not isinstance(points, (int, float)) or not math.isfinite(points) or points <= 0):
        raise JiraError("story_points에는 팀 기준에 따른 양의 숫자가 필요합니다.")
    if is_epic and (draft.get("epic") is not None or draft.get("sprint_id") is not None):
        raise JiraError("Epic에는 상위 Epic이나 스프린트를 지정하지 않습니다.")
    if "epic_name" in draft:
        name = draft["epic_name"]
        if not is_epic or not isinstance(name, str) or not name.strip() or len(name) > 255 or any(ord(c) < 32 for c in name):
            raise JiraError("epic_name은 Epic에서만 사용하는 255자 이하의 한 줄 이름입니다.")
    for key in ("assignee", "epic"):
        value = draft.get(key)
        if value is not None and (not isinstance(value, str) or not value or any(ord(c) < 32 for c in value)):
            raise JiraError(f"{key}에는 식별자 또는 null을 입력하세요.")
    if draft.get("epic") and not re.fullmatch(r"[A-Z][A-Z0-9_]*-\d+", draft["epic"]):
        raise JiraError("epic에는 Jira Key를 입력하세요.")
    sprint = draft.get("sprint_id")
    if sprint is not None and (type(sprint) is not int or sprint <= 0):
        raise JiraError("sprint_id에는 양의 정수 또는 null을 입력하세요.")
    labels = draft.get("labels", [])
    if not isinstance(labels, list) or any(not isinstance(x, str) or not x or re.search(r"\s", x) for x in labels):
        raise JiraError("labels에는 공백 없는 문자열 목록이 필요합니다.")
    priority, reason = draft.get("priority"), draft.get("priority_reason")
    if priority is not None:
        if (not isinstance(priority, str) or not priority.strip() or priority != priority.strip()
                or any(ord(c) < 32 for c in priority)):
            raise JiraError("priority에는 조회한 우선순위 ID 또는 이름 문자열을 입력하세요.")
        if not isinstance(reason, str) or not reason.strip():
            raise JiraError("우선순위를 지정하면 priority_reason에 선정 이유가 필요합니다.")
    elif reason is not None:
        raise JiraError("priority_reason은 priority와 함께 지정하세요.")
    return {**draft, "story_points": points, "assignee": draft.get("assignee"), "epic": draft.get("epic"),
            "sprint_id": sprint, "labels": sorted(set(labels))}


def draft_hash(config: Config, draft: dict) -> str:
    canonical = json.dumps({"site": config.base_url, "project": config.project, "board": config.board,
                            "draft": draft}, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def adf_description(draft: dict) -> dict:
    def paragraph(text):
        return {"type": "paragraph", "content": [{"type": "text", "text": text}]}
    content = [paragraph(line) for line in draft["description"].splitlines() if line.strip()]
    content.append({"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "완료 조건"}]})
    content.append({"type": "bulletList", "content": [
        {"type": "listItem", "content": [paragraph(text)]} for text in draft["acceptance_criteria"]]})
    return {"type": "doc", "version": 1, "content": content}


def priority_options(metadata: dict) -> list[dict]:
    values = metadata.get("priority", {}).get("allowedValues", [])
    if not isinstance(values, list) or any(
            not isinstance(x, dict) or not isinstance(x.get("id"), str) or not x["id"].strip()
            or not isinstance(x.get("name"), str) or not x["name"].strip() for x in values):
        raise JiraError("생성 화면의 우선순위 목록 형식을 확인하세요.")
    return [{"id": x["id"], "name": x["name"]} for x in values]


class Workflow:
    def __init__(self, client: Client):
        self.client, self.config = client, client.config

    def types(self):
        return self.client.pages(f"/rest/api/3/issue/createmeta/{self.config.project}/issuetypes", "issueTypes")

    def create_metadata(self, issue_type: str) -> dict:
        rows = self.client.pages(f"/rest/api/3/issue/createmeta/{self.config.project}/issuetypes/{issue_type}", "fields")
        return {x.get("fieldId", x.get("key")): x for x in rows}

    def check(self) -> dict:
        user = self.client.request("GET", "/rest/api/3/myself")
        project = self.client.request("GET", f"/rest/api/3/project/{self.config.project}")
        board = self.client.request("GET", f"/rest/agile/1.0/board/{self.config.board}")
        board_config = self.client.request("GET", f"/rest/agile/1.0/board/{self.config.board}/configuration")
        filter_id = board_config.get("filter", {}).get("id")
        if not filter_id:
            raise JiraError("보드 필터를 확인할 수 없습니다.")
        # Reading this filter also confirms access; cross-project boards are supported.
        self.client.request("GET", f"/rest/api/3/filter/{filter_id}")
        permissions = self.client.request("GET", "/rest/api/3/mypermissions", params={
            "projectKey": self.config.project, "permissions": "BROWSE_PROJECTS,CREATE_ISSUES"})
        if not all(permissions.get("permissions", {}).get(x, {}).get("havePermission")
                   for x in ("BROWSE_PROJECTS", "CREATE_ISSUES")):
            raise JiraError("프로젝트 조회 또는 이슈 생성 권한이 없습니다.")
        return {"connected": True, "user": user.get("displayName"), "project": project.get("key"),
                "board": {"id": board.get("id"), "name": board.get("name")}, "issue_types": self.types(),
                "jira_changed": False}

    def users(self, query: str) -> list:
        result, start = [], 0
        while True:
            rows = self.client.request("GET", "/rest/api/3/user/assignable/search", params={
                "project": self.config.project, "query": query, "startAt": start, "maxResults": 50})
            result.extend({"accountId": x["accountId"], "displayName": x.get("displayName"),
                           "active": x.get("active")} for x in rows)
            if len(rows) < 50:
                return result
            start += len(rows)

    def catalog(self, user_query: str) -> dict:
        current_user = {"accountId": None, "displayName": None, "assignable": None}
        try:
            user = self.client.request("GET", "/rest/api/3/myself")
            account_id = user.get("accountId")
            if account_id:
                current_user.update(accountId=account_id, displayName=user.get("displayName"))
                assignable = self.client.request("GET", "/rest/api/3/user/assignable/search", params={
                    "project": self.config.project, "accountId": account_id, "maxResults": 50})
                current_user["assignable"] = any(x.get("accountId") == account_id and x.get("active") for x in assignable)
        except JiraError:
            # Identity lookup is optional; never echo raw errors or assume an assignee.
            pass
        if current_user["assignable"] is not True:
            current_user["question"] = "누구를 담당자로 설정할까요?"
        types = self.types()
        priorities = []
        for issue_type in types:
            if issue_type.get("subtask") or issue_type.get("name") not in ("Task", "작업", "Story", "스토리", "Epic", "에픽"):
                continue
            meta = self.create_metadata(str(issue_type["id"]))
            options = priority_options(meta)
            default_id = (meta.get("priority", {}).get("defaultValue") or {}).get("id")
            priorities.append({"issue_type_id": str(issue_type["id"]), "issue_type": issue_type["name"],
                               "values": options, "default": next((x for x in options if x["id"] == default_id), None)})
        epic_types = [x for x in types if x.get("name") in ("Epic", "에픽") or x.get("hierarchyLevel") == 1]
        epics = self.client.search(f"project = {jql_string(self.config.project)} AND issuetype = {jql_string(str(epic_types[0]['id']))}") if len(epic_types) == 1 else []
        sprints = self.client.pages(f"/rest/agile/1.0/board/{self.config.board}/sprint", "values", {"state": "active,future"})
        return {"current_user": current_user, "issue_types": types, "priorities": priorities, "epics": epics, "sprints": sprints,
                "assignable_users": self.users(user_query) if user_query else [],
                "hint": "담당자 검색은 --user-query 이름 또는 이메일을 사용하세요."}

    def prepare(self, draft: dict) -> dict:
        draft = validate_draft(draft)
        is_epic = draft["issue_type"] in ("Epic", "에픽")
        aliases = {"Task": ("Task", "작업"), "작업": ("Task", "작업"),
                   "Story": ("Story", "스토리"), "스토리": ("Story", "스토리"),
                   "Epic": ("Epic", "에픽"), "에픽": ("Epic", "에픽")}
        matches = [x for x in self.types() if x["name"] in aliases[draft["issue_type"]] and not x.get("subtask")]
        if len(matches) != 1:
            raise JiraError("프로젝트에서 요청한 Task/Story/Epic 유형을 유일하게 확인할 수 없습니다.")
        issue_type = str(matches[0]["id"])
        meta = self.create_metadata(issue_type)
        points = [key for key, item in meta.items() if (
            key == self.config.points_field if self.config.points_field else
            item.get("name", "").casefold() in ("story points", "story point estimate", "스토리 포인트"))]
        fields = {"project": {"key": self.config.project}, "issuetype": {"id": issue_type},
                  "summary": draft["summary"], "description": adf_description(draft)}
        priority = None
        if draft.get("priority") is not None:
            options = priority_options(meta)
            matches = [x for x in options if draft["priority"] in (x["id"], x["name"])]
            if len(matches) != 1:
                raise JiraError("선택한 우선순위를 사용할 수 없거나 유일하지 않습니다. --catalog에서 대상 업무 유형의 값을 확인하세요.")
            fields["priority"] = {"id": matches[0]["id"]}
            priority = {**matches[0], "reason": draft["priority_reason"]}
        if not is_epic:
            if len(points) != 1:
                raise JiraError("생성 가능한 Story Points 필드를 확인하세요. 필요하면 JIRA_STORY_POINTS_FIELD를 설정하세요.")
            if meta[points[0]].get("schema", {}).get("type") != "number":
                raise JiraError("Story Points 필드는 숫자 필드여야 합니다.")
            fields[points[0]] = draft["story_points"]
        else:
            names = [key for key, item in meta.items() if (
                item.get("schema", {}).get("custom", "").endswith(":gh-epic-label")
                or item.get("name", "").casefold() in ("epic name", "에픽 이름", "에픽의 이름"))]
            if len(names) > 1:
                raise JiraError("Epic Name 필드를 유일하게 확인할 수 없습니다.")
            if names:
                fields[names[0]] = draft.get("epic_name", draft["summary"])
            elif "epic_name" in draft:
                raise JiraError("이 프로젝트의 생성 화면에는 별도 Epic Name 필드가 없습니다. summary를 사용하세요.")
        reporter = meta.get("reporter", {})
        if reporter.get("required") and not reporter.get("hasDefaultValue"):
            account_id = self.client.request("GET", "/rest/api/3/myself").get("accountId")
            if not account_id:
                raise JiraError("현재 사용자의 보고자 ID를 확인할 수 없습니다.")
            fields["reporter"] = {"accountId": account_id}
        if "assignee" not in meta:
            raise JiraError("생성 화면에 assignee 필드가 필요합니다. 담당자 미지정도 명시적으로 처리합니다.")
        fields["assignee"] = None
        if draft["assignee"]:
            users = self.client.request("GET", "/rest/api/3/user/assignable/search", params={
                "project": self.config.project, "accountId": draft["assignee"], "maxResults": 50})
            if not any(x.get("accountId") == draft["assignee"] and x.get("active") for x in users):
                raise JiraError("선택한 담당자는 이 프로젝트에 배정할 수 없습니다.")
            fields["assignee"] = {"accountId": draft["assignee"]}
        if draft["labels"]:
            fields["labels"] = draft["labels"]
        if draft["epic"]:
            epic = self.client.request("GET", f"/rest/api/3/issue/{draft['epic']}", params={"fields": "project,issuetype"})["fields"]
            epic_type = epic["issuetype"]
            if epic["project"]["key"] != self.config.project or not (epic_type.get("hierarchyLevel") == 1 or epic_type.get("name") in ("Epic", "에픽")):
                raise JiraError("선택한 Epic은 같은 프로젝트의 Epic이어야 합니다.")
            if "parent" in meta:
                fields["parent"] = {"key": draft["epic"]}
            else:
                links = [key for key, item in meta.items() if item.get("schema", {}).get("custom", "").endswith(":gh-epic-link")]
                if len(links) != 1:
                    raise JiraError("생성 화면에서 Epic 연결 필드를 확인할 수 없습니다.")
                fields[links[0]] = draft["epic"]
        missing = [x.get("name", key) for key, x in meta.items()
                   if x.get("required") and not x.get("hasDefaultValue") and key not in fields]
        if missing:
            raise JiraError("추가 필수 필드가 있습니다: " + ", ".join(missing))
        unknown = set(fields) - set(meta) - {"project", "issuetype"}
        if unknown:
            raise JiraError("생성 화면에 요청 필드가 없습니다: " + ", ".join(sorted(unknown)))
        if draft["sprint_id"] is not None:
            sprints = self.client.pages(f"/rest/agile/1.0/board/{self.config.board}/sprint", "values", {"state": "active,future"})
            if not any(x["id"] == draft["sprint_id"] for x in sprints):
                raise JiraError("스프린트는 지정 보드의 활성/예정 스프린트여야 합니다.")
        # Compare all project summaries, rather than hiding duplicates with a narrow text search.
        issues = self.client.search(f"project = {jql_string(self.config.project)} ORDER BY created DESC")
        normalized = lambda text: " ".join(text.casefold().split())
        exact = [x for x in issues if normalized(x["fields"].get("summary", "")) == normalized(draft["summary"])]
        # Korean word stems and scope are reviewed by the AI using the full candidate list.
        return {"fields": fields, "exact_duplicates": exact, "project_issues": issues,
                "sprint_id": draft["sprint_id"], "approval_sha256": draft_hash(self.config, draft),
                "draft": draft, "priority": priority, "jira_changed": False}

    def verify(self, key: str, fields: dict, sprint_id: int | None) -> dict:
        if not re.fullmatch(re.escape(self.config.project) + r"-\d+", key):
            raise JiraError("이슈 Key는 설정한 프로젝트의 Key여야 합니다.")
        actual = self.client.request("GET", f"/rest/api/3/issue/{key}", params={"fields": ",".join(fields)})["fields"]
        mismatches = []
        for name, expected in fields.items():
            got = actual.get(name)
            if name in ("project", "parent"):
                got = (got or {}).get("key")
                expected = expected["key"]
            elif name in ("issuetype", "priority"):
                got = (got or {}).get("id")
                expected = expected["id"]
            elif name in ("assignee", "reporter"):
                got = (got or {}).get("accountId")
                expected = (expected or {}).get("accountId")
            elif name == "labels":
                got = sorted(got or [])
            if got != expected:
                mismatches.append(name)
        if sprint_id is not None:
            agile = self.client.request("GET", f"/rest/agile/1.0/issue/{key}")
            if (agile.get("fields", {}).get("sprint") or {}).get("id") != sprint_id:
                mismatches.append("sprint")
        return {"key": key, "url": f"{self.config.base_url}/browse/{key}",
                "verified": not mismatches, "mismatches": mismatches}

    def apply(self, plan: dict, approval: str, allow_duplicates: bool, state_dir: Path) -> dict:
        digest = plan["approval_sha256"]
        if approval != digest:
            raise JiraError("승인된 초안 해시가 다릅니다. 최신 초안을 다시 제안하고 확인받으세요.")
        state_dir.mkdir(parents=True, exist_ok=True)
        receipt = state_dir / f"{digest}.json"
        # Exclusive creation also prevents concurrent invocations from sending two POSTs.
        try:
            with receipt.open("x", encoding="utf-8") as file:
                json.dump({"state": "reserved", "site": self.config.base_url, "project": self.config.project,
                           "fields": plan["fields"], "sprint_id": plan["sprint_id"]}, file, ensure_ascii=False)
        except FileExistsError:
            try:
                existing = json.loads(receipt.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                raise JiraError("로컬 생성 기록을 읽을 수 없습니다. Jira에서 생성 여부를 확인하세요.") from None
            if existing.get("key"):
                result = self.verify(existing["key"], existing["fields"], existing["sprint_id"])
                return {**result, "reused_receipt": True, "jira_changed": False}
            raise JiraError("이 초안의 생성 시도 기록이 있습니다. 결과가 불확실하므로 Jira에서 확인하기 전 재생성하지 마세요.") from None
        if plan["exact_duplicates"] and not allow_duplicates:
            receipt.unlink()  # No write request was sent.
            raise JiraError("같은 제목의 업무가 있습니다. 사용자에게 중복 후보를 확인받으세요.")
        record = {"state": "submitting", "site": self.config.base_url, "project": self.config.project,
                  "fields": plan["fields"], "sprint_id": plan["sprint_id"]}
        self.save_receipt(receipt, record)
        created = self.client.request("POST", "/rest/api/3/issue", body={"fields": plan["fields"]})
        key = created.get("key")
        if not isinstance(key, str) or not re.fullmatch(re.escape(self.config.project) + r"-\d+", key):
            raise JiraError("생성 응답에서 Key를 확인하지 못했습니다. Jira에서 생성 여부를 확인하세요.")
        record.update(state="created", key=key)
        self.save_receipt(receipt, record)
        try:
            if plan["sprint_id"] is not None:
                self.client.request("POST", f"/rest/agile/1.0/sprint/{plan['sprint_id']}/issue", body={"issues": [key]})
            result = self.verify(key, plan["fields"], plan["sprint_id"])
        except JiraError as exc:
            return {"key": key, "url": f"{self.config.base_url}/browse/{key}", "verified": False,
                    "warning": str(exc), "jira_changed": True, "hint": "이미 생성됐습니다. 재생성하지 말고 --verify로 확인하세요."}
        record["state"] = "verified" if result["verified"] else "verification_failed"
        self.save_receipt(receipt, record)
        return {**result, "jira_changed": True}

    @staticmethod
    def save_receipt(path: Path, record: dict):
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Jira Cloud 업무 연동. 기본 동작은 조회/미리보기입니다.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="인증·프로젝트·보드·권한 확인 (읽기 전용)")
    mode.add_argument("--catalog", action="store_true", help="유형·Epic·스프린트·담당자 조회")
    mode.add_argument("--input", type=Path, help="AI가 준비한 초안 JSON. 기본은 미리보기")
    mode.add_argument("--verify", metavar="KEY", help="로컬 생성 기록으로 결과 재검증 (읽기 전용)")
    parser.add_argument("--user-query", default="")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--approved-sha256", default="")
    parser.add_argument("--allow-duplicates", action="store_true")
    args = parser.parse_args(argv)
    if (args.apply or args.approved_sha256 or args.allow_duplicates) and not args.input:
        parser.error("생성 옵션은 --input과 함께 사용하세요.")
    if (args.approved_sha256 or args.allow_duplicates) and not args.apply:
        parser.error("승인 옵션은 --apply와 함께 사용하세요.")
    if args.apply and not args.approved_sha256:
        parser.error("생성에는 --approved-sha256가 필요합니다.")
    if args.user_query and not args.catalog:
        parser.error("--user-query는 --catalog에서 사용하세요.")
    try:
        if sys.version_info < (3, 11):
            raise JiraError("Python 3.11 이상이 필요합니다.")
        config = Config.load()
        workflow = Workflow(Client(config))
        state_dir = ROOT / ".jira" / "receipts"
        if args.check:
            result = workflow.check()
        elif args.catalog:
            result = workflow.catalog(args.user_query)
        elif args.verify:
            records = []
            for path in state_dir.glob("*.json"):
                record = json.loads(path.read_text(encoding="utf-8"))
                if (record.get("key") == args.verify and record.get("site") == config.base_url
                        and record.get("project") == config.project):
                    records.append(record)
            if len(records) != 1:
                raise JiraError("이 Key의 로컬 생성 기록이 없습니다. Jira에서 직접 확인하세요.")
            record = records[0]
            result = workflow.verify(args.verify, record["fields"], record["sprint_id"])
        else:
            draft = load_draft(args.input)
            if args.apply and args.approved_sha256 != draft_hash(config, draft):
                raise JiraError("승인된 초안과 입력 파일이 다릅니다. 변경 내용을 다시 확인받으세요.")
            plan = workflow.prepare(draft)
            result = workflow.apply(plan, args.approved_sha256, args.allow_duplicates, state_dir) if args.apply else plan
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get("verified", True) else 2
    except JiraError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, TypeError):
        print('{"error": "로컬 파일 또는 Jira 응답 형식을 확인하세요. 생성 시도 후에는 Jira에서 결과를 먼저 확인하세요."}', file=sys.stderr)
        return 1


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
