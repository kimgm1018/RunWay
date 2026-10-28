"""Offline contract and failure-path tests. Never connects to Jira."""
import contextlib
from copy import deepcopy
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

SCRIPT = Path(__file__).resolve().parents[1] / "create_issues.py"
spec = importlib.util.spec_from_file_location("jira_automation", SCRIPT)
jira = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = jira
spec.loader.exec_module(jira)

CONFIG = jira.Config("https://example.atlassian.net", "TEST", 42, "private@example.com", "SECRET_TOKEN")
DRAFT = {"issue_type": "Task", "summary": "[Jira] 자동화 구현", "description": "업무 등록 흐름 구현",
         "acceptance_criteria": ["승인 후 생성", "결과 검증"], "story_points": 5,
         "assignee": None, "epic": "TEST-1", "sprint_id": 7, "labels": ["automation"]}
TYPES = [{"id": "10002", "name": "작업", "subtask": False},
         {"id": "10000", "name": "에픽", "hierarchyLevel": 1}]
META = [{"fieldId": key, "name": key, "required": key in ("summary", "description", "issuetype", "project")}
        for key in ("project", "issuetype", "summary", "description", "assignee", "parent", "labels")]
META.append({"fieldId": "customfield_10031", "name": "Story Points", "schema": {"type": "number"}})
PRIORITIES = [{"id": "p-high", "name": "High"}, {"id": "p-low", "name": "Low"}]
META.append({"fieldId": "priority", "name": "Priority", "schema": {"type": "priority"},
             "allowedValues": deepcopy(PRIORITIES), "hasDefaultValue": True,
             "defaultValue": {"id": "p-low", "name": "Low"}})


class FakeClient:
    def __init__(self):
        self.config = CONFIG
        self.calls = []
        self.metadata = deepcopy(META)
        self.epic_metadata = [deepcopy(x) for x in META if x["fieldId"] not in ("parent", "customfield_10031")]
        self.epic_metadata.append({"fieldId": "customfield_10011", "name": "에픽의 이름", "required": True,
                                   "schema": {"type": "string"}})
        self.issues = []
        self.created_fields = None
        self.sprint = None
        self.fail_create = False
        self.fail_sprint = False
        self.permissions = True
        self.assignee_active = True
        self.epic_project = "TEST"
        self.sprint_rows = [{"id": 7, "name": "이번 주", "state": "active"}]
        self.change_summary = False
        self.change_priority = False

    def request(self, method, path, *, params=None, body=None):
        self.calls.append((method, path, params, deepcopy(body)))
        if method == "POST" and path == "/rest/api/3/issue":
            if self.fail_create:
                raise jira.JiraError("연결 시간 초과")
            self.created_fields = deepcopy(body["fields"])
            return {"key": "TEST-22"}
        if method == "POST" and path == "/rest/agile/1.0/sprint/7/issue":
            if self.fail_sprint:
                raise jira.JiraError("Jira HTTP 403")
            self.sprint = 7
            return {}
        if method != "GET":
            raise AssertionError("Unexpected write: " + path)
        if path == "/rest/api/3/myself":
            return {"displayName": "Test User", "accountId": "current-user"}
        if path == "/rest/api/3/project/TEST":
            return {"key": "TEST"}
        if path == "/rest/agile/1.0/board/42":
            return {"id": 42, "name": "Team"}
        if path == "/rest/agile/1.0/board/42/configuration":
            return {"filter": {"id": 3}}
        if path == "/rest/api/3/filter/3":
            return {"jql": "project = TEST"}
        if path == "/rest/api/3/mypermissions":
            return {"permissions": {x: {"havePermission": self.permissions} for x in ("BROWSE_PROJECTS", "CREATE_ISSUES")}}
        if path == "/rest/api/3/issue/TEST-1":
            return {"fields": {"project": {"key": self.epic_project}, "issuetype": {"id": "10000", "name": "에픽", "hierarchyLevel": 1}}}
        if path == "/rest/api/3/user/assignable/search":
            return [{"accountId": (params or {}).get("accountId", "user-1"), "displayName": "Test User", "active": self.assignee_active}]
        if path == "/rest/api/3/issue/TEST-22":
            fields = deepcopy(self.created_fields)
            if self.change_summary:
                fields["summary"] = "changed"
            if "priority" in fields:
                fields["priority"]["name"] = "High"
                if self.change_priority:
                    fields["priority"]["id"] = "p-low"
            return {"fields": fields}
        if path == "/rest/agile/1.0/issue/TEST-22":
            return {"fields": {"sprint": {"id": self.sprint} if self.sprint else None}}
        raise AssertionError("Unexpected GET: " + path)

    def pages(self, path, key, params=None):
        self.calls.append(("GET", path, params, None))
        if path.endswith("/issuetypes"):
            return deepcopy(TYPES)
        if path.endswith("/issuetypes/10002"):
            return deepcopy(self.metadata)
        if path.endswith("/issuetypes/10000"):
            return deepcopy(self.epic_metadata)
        if path.endswith("/sprint"):
            return deepcopy(self.sprint_rows)
        raise AssertionError(path)

    def search(self, jql):
        self.calls.append(("GET", "/rest/api/3/search/jql", {"jql": jql}, None))
        return deepcopy(self.issues)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient()
        self.workflow = jira.Workflow(self.client)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = Path(self.directory.name) / "receipts"

    def apply(self, plan=None, allow=False):
        plan = plan or self.workflow.prepare(deepcopy(DRAFT))
        return self.workflow.apply(plan, plan["approval_sha256"], allow, self.state)

    def writes(self):
        return [x for x in self.client.calls if x[0] != "GET"]

    def test_check_and_catalog_are_read_only(self):
        self.assertTrue(self.workflow.check()["connected"])
        catalog = self.workflow.catalog("Test")
        self.assertEqual(catalog["current_user"], {"accountId": "current-user", "displayName": "Test User", "assignable": True})
        self.assertNotIn(CONFIG.email, json.dumps(catalog))
        self.assertNotIn(CONFIG.token, json.dumps(catalog))
        self.assertEqual(catalog["assignable_users"][0]["accountId"], "user-1")
        self.assertFalse(self.writes())

    def test_catalog_marks_inactive_current_user_unassignable(self):
        self.client.assignee_active = False
        self.assertFalse(self.workflow.catalog("")["current_user"]["assignable"])
        self.assertFalse(self.writes())

    def test_current_user_assignment_is_verified_after_create(self):
        catalog = self.workflow.catalog("")
        plan = self.workflow.prepare({**DRAFT, "assignee": catalog["current_user"]["accountId"]})
        self.assertEqual(plan["fields"]["assignee"], {"accountId": "current-user"})
        self.assertTrue(self.apply(plan)["verified"])

    def test_catalog_identity_lookup_failure_asks_without_stopping(self):
        original = self.client.request
        for failure in (None, "identity", "assignability"):
            with self.subTest(failure=failure):
                def request(method, path, **kwargs):
                    if path == "/rest/api/3/myself":
                        if failure == "identity":
                            raise jira.JiraError("SECRET_TOKEN")
                        if failure is None:
                            return {"displayName": "Test User"}
                    if path == "/rest/api/3/user/assignable/search" and failure == "assignability":
                        raise jira.JiraError("SECRET_TOKEN")
                    return original(method, path, **kwargs)
                with patch.object(self.client, "request", side_effect=request):
                    catalog = self.workflow.catalog("")
                self.assertEqual(catalog["current_user"]["question"], "누구를 담당자로 설정할까요?")
                self.assertIsNone(catalog["current_user"]["assignable"])
                self.assertTrue(catalog["issue_types"])
                self.assertNotIn("SECRET_TOKEN", json.dumps(catalog))
                self.assertFalse(self.writes())

    def test_check_fails_without_create_permission(self):
        self.client.permissions = False
        with self.assertRaises(jira.JiraError):
            self.workflow.check()
        self.assertFalse(self.writes())

    def test_preview_resolves_fields_without_writes(self):
        plan = self.workflow.prepare(deepcopy(DRAFT))
        self.assertEqual(plan["fields"]["issuetype"], {"id": "10002"})
        self.assertEqual(plan["fields"]["customfield_10031"], 5)
        self.assertEqual(plan["fields"]["parent"], {"key": "TEST-1"})
        self.assertIsNone(plan["fields"]["assignee"])
        self.assertEqual(plan["fields"]["description"]["content"][-1]["type"], "bulletList")
        self.assertFalse(self.writes())

    def test_create_assign_and_verify_with_receipt(self):
        result = self.apply()
        self.assertTrue(result["verified"])
        self.assertEqual(result["key"], "TEST-22")
        self.assertEqual(len(self.writes()), 2)
        receipt = json.loads(next(self.state.glob("*.json")).read_text(encoding="utf-8"))
        self.assertEqual(receipt["state"], "verified")
        self.assertNotIn(CONFIG.token, json.dumps(receipt))

    def test_backlog_and_unassigned_dont_use_defaults(self):
        draft = {**DRAFT, "sprint_id": None, "epic": None, "labels": []}
        result = self.apply(self.workflow.prepare(draft))
        self.assertTrue(result["verified"])
        self.assertEqual(len(self.writes()), 1)
        self.assertIsNone(self.client.created_fields["assignee"])
        self.assertNotIn("parent", self.client.created_fields)

    def test_receipt_prevents_second_post(self):
        plan = self.workflow.prepare(deepcopy(DRAFT))
        self.apply(plan)
        self.client.issues = [{"key": "TEST-22", "fields": {"summary": DRAFT["summary"]}}]
        second = self.apply()
        self.assertTrue(second["reused_receipt"])
        self.assertEqual(len(self.writes()), 2)

    def test_duplicate_blocks_then_explicit_override_allows(self):
        self.client.issues = [{"key": "TEST-9", "fields": {"summary": "  " + DRAFT["summary"] + "  "}}]
        plan = self.workflow.prepare(deepcopy(DRAFT))
        with self.assertRaisesRegex(jira.JiraError, "같은 제목"):
            self.apply(plan)
        self.assertFalse(self.writes())
        self.assertFalse(list(self.state.glob("*.json")))
        self.assertTrue(self.apply(plan, allow=True)["verified"])

    def test_bad_approval_never_writes_or_reserves(self):
        plan = self.workflow.prepare(deepcopy(DRAFT))
        with self.assertRaises(jira.JiraError):
            self.workflow.apply(plan, "wrong", False, self.state)
        self.assertFalse(self.writes())
        self.assertFalse(self.state.exists())

    def test_ambiguous_create_is_not_retried(self):
        self.client.fail_create = True
        plan = self.workflow.prepare(deepcopy(DRAFT))
        with self.assertRaises(jira.JiraError):
            self.apply(plan)
        with self.assertRaisesRegex(jira.JiraError, "생성 시도 기록"):
            self.apply(plan)
        self.assertEqual(len(self.writes()), 1)

    def test_existing_reserved_record_blocks_concurrent_apply(self):
        plan = self.workflow.prepare(deepcopy(DRAFT))
        self.state.mkdir()
        (self.state / (plan["approval_sha256"] + ".json")).write_text('{"state":"reserved"}', encoding="utf-8")
        with self.assertRaises(jira.JiraError):
            self.apply(plan)
        self.assertFalse(self.writes())

    def test_sprint_failure_preserves_key_and_never_recreates(self):
        self.client.fail_sprint = True
        plan = self.workflow.prepare(deepcopy(DRAFT))
        result = self.apply(plan)
        self.assertFalse(result["verified"])
        self.assertEqual(result["key"], "TEST-22")
        self.assertFalse(self.apply(plan)["verified"])
        self.assertEqual(len(self.writes()), 2)

    def test_verification_detects_mismatch(self):
        self.client.change_summary = True
        result = self.apply()
        self.assertFalse(result["verified"])
        self.assertIn("summary", result["mismatches"])

    def test_additional_required_field_blocks_before_write(self):
        self.client.metadata.append({"fieldId": "customfield_9", "name": "Required area", "required": True})
        with self.assertRaisesRegex(jira.JiraError, "추가 필수"):
            self.workflow.prepare(deepcopy(DRAFT))
        self.assertFalse(self.writes())

    def test_required_reporter_uses_current_authenticated_user(self):
        self.client.metadata.append({"fieldId": "reporter", "name": "보고자", "required": True,
                                     "schema": {"type": "user"}})
        plan = self.workflow.prepare(deepcopy(DRAFT))
        self.assertEqual(plan["fields"]["reporter"], {"accountId": "current-user"})
        self.assertTrue(self.apply(plan)["verified"])

    def test_cross_project_epic_and_wrong_sprint_rejected(self):
        self.client.epic_project = "OTHER"
        with self.assertRaises(jira.JiraError):
            self.workflow.prepare(deepcopy(DRAFT))
        self.client.epic_project = "TEST"
        self.client.sprint_rows = []
        with self.assertRaises(jira.JiraError):
            self.workflow.prepare(deepcopy(DRAFT))
        self.assertFalse(self.writes())

    def test_inactive_assignee_rejected(self):
        self.client.assignee_active = False
        with self.assertRaises(jira.JiraError):
            self.workflow.prepare({**DRAFT, "assignee": "user-1"})
        self.assertFalse(self.writes())

    def test_legacy_epic_link(self):
        self.client.metadata = [x for x in self.client.metadata if x["fieldId"] != "parent"]
        self.client.metadata.append({"fieldId": "customfield_14", "schema": {"custom": "com.pyxis.greenhopper.jira:gh-epic-link"}})
        plan = self.workflow.prepare(deepcopy(DRAFT))
        self.assertEqual(plan["fields"]["customfield_14"], "TEST-1")
        self.assertTrue(self.apply(plan)["verified"])

    def priority_draft(self, **changes):
        return {**DRAFT, "priority": "p-high", "priority_reason": "Blocks a dependent release", **changes}

    def test_catalog_lists_priorities_per_supported_issue_type(self):
        catalog = self.workflow.catalog("")
        self.assertEqual(catalog.get("priorities"), [
            {"issue_type_id": "10002", "issue_type": "작업", "values": PRIORITIES,
             "default": {"id": "p-low", "name": "Low"}},
            {"issue_type_id": "10000", "issue_type": "에픽", "values": PRIORITIES,
             "default": {"id": "p-low", "name": "Low"}},
        ])
        self.assertFalse(self.writes())

    def test_priority_preview_resolves_id_and_name_read_only(self):
        for value in ("p-high", "High"):
            with self.subTest(value=value):
                plan = self.workflow.prepare(self.priority_draft(priority=value))
                self.assertEqual(plan["fields"].get("priority"), {"id": "p-high"})
                self.assertEqual(plan.get("priority"), {"id": "p-high", "name": "High",
                                                       "reason": "Blocks a dependent release"})
        self.assertFalse(self.writes())

    def test_priority_is_saved_and_verified_by_id_with_receipt(self):
        plan = self.workflow.prepare(self.priority_draft())
        self.assertTrue(self.apply(plan)["verified"])
        self.assertEqual(self.client.created_fields["priority"], {"id": "p-high"})
        receipt = json.loads(next(self.state.glob("*.json")).read_text(encoding="utf-8"))
        self.assertEqual(receipt["fields"]["priority"], {"id": "p-high"})
        self.assertTrue(self.apply(plan)["reused_receipt"])
        self.assertEqual(len(self.writes()), 2)

    def test_unknown_or_ambiguous_priority_blocks_before_write(self):
        for value in ("p-missing", "Urgent"):
            with self.subTest(value=value), self.assertRaises(jira.JiraError):
                self.workflow.prepare(self.priority_draft(priority=value))
        self.client.metadata[-1]["allowedValues"].append({"id": "p-other", "name": "High"})
        with self.assertRaises(jira.JiraError):
            self.workflow.prepare(self.priority_draft(priority="High"))
        self.assertFalse(self.writes())

    def test_priority_must_be_allowed_for_selected_issue_type(self):
        priority = next(x for x in self.client.epic_metadata if x["fieldId"] == "priority")
        priority["allowedValues"] = [{"id": "p-low", "name": "Low"}]
        draft = {**self.epic_draft(), "priority": "p-high", "priority_reason": "Dependent work"}
        with self.assertRaises(jira.JiraError):
            self.workflow.prepare(draft)
        self.assertFalse(self.writes())

    def test_unavailable_priority_field_or_values_blocks_explicit_priority(self):
        for metadata in ([x for x in META if x["fieldId"] != "priority"],
                         [dict(x, allowedValues=[]) if x["fieldId"] == "priority" else x for x in META]):
            with self.subTest(metadata=metadata):
                self.client.metadata = deepcopy(metadata)
                with self.assertRaises(jira.JiraError):
                    self.workflow.prepare(self.priority_draft())
        self.assertFalse(self.writes())

    def test_malformed_priority_metadata_blocks_before_write(self):
        for values in (None, {}, [None], [{"id": "p-high"}], [{"id": 1, "name": "High"}]):
            with self.subTest(values=values):
                self.client.metadata[-1]["allowedValues"] = values
                with self.assertRaises(jira.JiraError):
                    self.workflow.prepare(self.priority_draft())
        self.assertFalse(self.writes())

    def test_priority_change_invalidates_previous_approval(self):
        before = self.workflow.prepare(self.priority_draft())
        after = self.workflow.prepare(self.priority_draft(priority="p-low"))
        with self.assertRaises(jira.JiraError):
            self.workflow.apply(after, before["approval_sha256"], False, self.state)
        self.assertFalse(self.writes())
        self.assertFalse(self.state.exists())

    def test_cli_rejects_changed_priority_or_reason_before_network(self):
        draft = self.priority_draft()
        approved = jira.draft_hash(CONFIG, jira.validate_draft(draft))
        for change in ({"priority": "p-low"}, {"priority_reason": "Changed rationale"}):
            with self.subTest(change=change):
                path = Path(self.directory.name) / "draft.json"
                path.write_text(json.dumps({**draft, **change}), encoding="utf-8")
                with patch.object(jira.Config, "load", return_value=CONFIG), \
                        patch.object(jira.Client, "request") as request, \
                        contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(jira.main(["--input", str(path), "--apply", "--approved-sha256", approved]), 1)
                request.assert_not_called()

    def test_null_priority_uses_jira_default_without_requiring_field(self):
        self.client.metadata = [x for x in self.client.metadata if x["fieldId"] != "priority"]
        plan = self.workflow.prepare({**DRAFT, "priority": None, "priority_reason": None})
        self.assertNotIn("priority", plan["fields"])
        self.assertTrue(self.apply(plan)["verified"])

    def test_required_priority_without_default_rejects_legacy_draft(self):
        priority = next(x for x in self.client.metadata if x["fieldId"] == "priority")
        priority.update(required=True, hasDefaultValue=False)
        with self.assertRaisesRegex(jira.JiraError, "추가 필수"):
            self.workflow.prepare(deepcopy(DRAFT))
        self.assertFalse(self.writes())

    def test_catalog_marks_unavailable_priority_field_with_empty_values(self):
        self.client.metadata = [x for x in self.client.metadata if x["fieldId"] != "priority"]
        catalog = self.workflow.catalog("")
        self.assertEqual(catalog["priorities"][0]["values"], [])
        self.assertIsNone(catalog["priorities"][0]["default"])
        self.assertFalse(self.writes())

    def test_priority_mismatch_is_detected_on_create_and_reverification(self):
        plan = self.workflow.prepare(self.priority_draft())
        self.client.change_priority = True
        result = self.apply(plan)
        self.assertFalse(result["verified"])
        self.assertIn("priority", result["mismatches"])
        self.assertIn("priority", self.apply(plan)["mismatches"])
        self.assertEqual(len(self.writes()), 2)

    def test_cli_verify_checks_receipt_priority_and_returns_mismatch(self):
        self.state = Path(self.directory.name) / ".jira" / "receipts"
        plan = self.workflow.prepare(self.priority_draft())
        self.apply(plan)
        self.client.change_priority = True
        output = io.StringIO()
        with patch.object(jira, "ROOT", Path(self.directory.name)), \
                patch.object(jira.Config, "load", return_value=CONFIG), \
                patch.object(jira, "Client", return_value=self.client), contextlib.redirect_stdout(output):
            self.assertEqual(jira.main(["--verify", "TEST-22"]), 2)
        self.assertIn("priority", json.loads(output.getvalue())["mismatches"])
        self.assertEqual(len(self.writes()), 2)

    def test_legacy_draft_keeps_hash_and_omits_priority_for_jira_default(self):
        plan = self.workflow.prepare(deepcopy(DRAFT))
        canonical = json.dumps({"site": CONFIG.base_url, "project": "TEST", "board": 42,
                                "draft": {**DRAFT, "labels": ["automation"]}},
                               sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        import hashlib
        self.assertEqual(plan["approval_sha256"], hashlib.sha256(canonical.encode()).hexdigest())
        self.assertNotIn("priority", plan["fields"])
        self.assertTrue(self.apply(plan)["verified"])

    def test_epic_supports_priority(self):
        draft = {**self.epic_draft(), "priority": "High", "priority_reason": "Dependent work"}
        self.assertTrue(self.apply(self.workflow.prepare(draft))["verified"])

    def test_invalid_priority_draft_fails_before_network(self):
        for changes in ({"priority": ""}, {"priority": " "}, {"priority": 1}, {"priority": True},
                        {"priority": {}}, {"priority": "High\n"}, {"priority_reason": ""},
                        {"priority_reason": None}, {"priority_reason": []},
                        {"priority": None}, {"priority": None, "priority_reason": "Reason"}):
            with self.subTest(changes=changes), self.assertRaises(jira.JiraError):
                self.workflow.prepare(self.priority_draft(**changes))
        self.assertFalse(self.client.calls)

    def epic_draft(self, **changes):
        draft = {"issue_type": "Epic", "summary": "[BE] 러닝 기록 관리", "description": "러닝 기록 업무 관리",
                 "acceptance_criteria": ["관련 업무가 완료되어 기능 제공"], "labels": []}
        return {**draft, **changes}

    def test_epic_preview_and_create_without_story_points(self):
        plan = self.workflow.prepare(self.epic_draft())
        self.assertFalse(self.writes())
        self.assertEqual(plan["fields"]["issuetype"], {"id": "10000"})
        self.assertEqual(plan["fields"]["customfield_10011"], "[BE] 러닝 기록 관리")
        self.assertNotIn("customfield_10031", plan["fields"])
        self.assertNotIn("parent", plan["fields"])
        self.assertTrue(self.apply(plan)["verified"])
        self.assertEqual(len(self.writes()), 1)
        self.assertTrue(self.apply(plan)["reused_receipt"])
        self.assertEqual(len(self.writes()), 1)

    def test_epic_name_override_and_verification(self):
        plan = self.workflow.prepare(self.epic_draft(issue_type="에픽", epic_name="러닝 기록"))
        self.assertEqual(plan["fields"]["customfield_10011"], "러닝 기록")
        self.apply(plan)
        self.client.created_fields["customfield_10011"] = "다른 이름"
        self.assertIn("customfield_10011", self.apply(plan)["mismatches"])

    def test_epic_without_separate_name_field(self):
        self.client.epic_metadata = [x for x in self.client.epic_metadata if x["fieldId"] != "customfield_10011"]
        self.assertTrue(self.apply(self.workflow.prepare(self.epic_draft()))["verified"])
        with self.assertRaises(jira.JiraError):
            self.workflow.prepare(self.epic_draft(epic_name="별도 이름"))

    def test_epic_rejects_points_parent_sprint_before_network(self):
        for changes in ({"story_points": 5}, {"epic": "TEST-1"}, {"sprint_id": 7}):
            with self.subTest(changes=changes), self.assertRaises(jira.JiraError):
                self.workflow.prepare(self.epic_draft(**changes))
        self.assertFalse(self.client.calls)

    def test_epic_duplicate_and_missing_approval_protection(self):
        draft = self.epic_draft()
        self.client.issues = [{"key": "TEST-3", "fields": {"summary": draft["summary"]}}]
        plan = self.workflow.prepare(draft)
        with self.assertRaises(jira.JiraError):
            self.apply(plan)
        with self.assertRaises(jira.JiraError):
            self.workflow.apply(plan, "wrong", True, self.state)
        self.assertFalse(self.writes())

    def test_epic_timeout_keeps_receipt_and_blocks_retry(self):
        self.client.fail_create = True
        plan = self.workflow.prepare(self.epic_draft())
        with self.assertRaises(jira.JiraError):
            self.apply(plan)
        with self.assertRaises(jira.JiraError):
            self.apply(plan)
        self.assertEqual(len(self.writes()), 1)

    def test_task_cannot_have_epic_name(self):
        with self.assertRaises(jira.JiraError):
            self.workflow.prepare({**DRAFT, "epic_name": "이름"})
        self.assertFalse(self.client.calls)


class InputAndTransportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def test_draft_validation_rejects_nonfinite_bool_unknown_subtask(self):
        for override in ({"story_points": True}, {"story_points": float("nan")}, {"story_points": 0},
                         {"unknown": "x"}, {"issue_type": "Subtask"}, {"sprint_id": True}, {"acceptance_criteria": []}):
            with self.subTest(override=override):
                path = self.root / "draft.json"
                path.write_text(json.dumps({**DRAFT, **override}), encoding="utf-8")
                with self.assertRaises(jira.JiraError):
                    jira.load_draft(path)

    def test_hash_changes_with_content_or_site(self):
        original = jira.draft_hash(CONFIG, DRAFT)
        self.assertNotEqual(original, jira.draft_hash(CONFIG, {**DRAFT, "story_points": 8}))
        other = jira.Config("https://other.atlassian.net", "TEST", 42, "email", "token")
        self.assertNotEqual(original, jira.draft_hash(other, DRAFT))

    def test_env_reads_bom_quotes_comments_without_execution(self):
        path = self.root / ".env"
        path.write_text('# comment\nJIRA_API_TOKEN="$(do-not-run)#value" # comment\nexport OTHER = value # comment\n', encoding="utf-8-sig")
        env = jira.read_env(path)
        self.assertEqual(env["JIRA_API_TOKEN"], "$(do-not-run)#value")
        self.assertEqual(env["OTHER"], "value")

    def test_missing_config_does_not_echo_credentials(self):
        with patch.object(jira, "ROOT", self.root), patch.dict(os.environ, {"JIRA_API_TOKEN": "TOP_SECRET"}, clear=True):
            with self.assertRaises(jira.JiraError) as caught:
                jira.Config.load()
            self.assertNotIn("TOP_SECRET", str(caught.exception))

    def test_cli_invalid_approval_stops_before_network(self):
        path = self.root / "draft.json"
        path.write_text(json.dumps(DRAFT), encoding="utf-8")
        with patch.object(jira.Config, "load", return_value=CONFIG), patch.object(jira.Client, "request") as request, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(jira.main(["--input", str(path), "--apply", "--approved-sha256", "wrong"]), 1)
            request.assert_not_called()

    def test_cli_missing_approval_rejected(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            jira.main(["--input", "draft.json", "--apply"])

    def test_http_error_hides_body_and_does_not_retry(self):
        client = jira.Client(CONFIG)
        error = HTTPError("https://example", 400, "SECRET_TOKEN", {}, io.BytesIO(b"SECRET_TOKEN private@example.com"))
        with patch.object(client.opener, "open", side_effect=error) as send:
            with self.assertRaises(jira.JiraError) as caught:
                client.request("POST", "/rest/api/3/issue", body={"fields": {}})
            self.assertNotIn("SECRET_TOKEN", str(caught.exception))
            self.assertNotIn("private@example.com", str(caught.exception))
            self.assertEqual(send.call_count, 1)

    def test_connection_error_hides_raw_reason(self):
        client = jira.Client(CONFIG)
        with patch.object(client.opener, "open", side_effect=URLError("SECRET_TOKEN")):
            with self.assertRaises(jira.JiraError) as caught:
                client.request("GET", "/rest/api/3/myself")
            self.assertNotIn("SECRET_TOKEN", str(caught.exception))

    def test_redirect_is_blocked(self):
        self.assertIsNone(jira.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.example"))

    def test_search_reads_all_pages_and_detects_missing_token(self):
        client = jira.Client(CONFIG)
        with patch.object(client, "request", side_effect=[{"issues": [{"key": "TEST-1"}], "isLast": False, "nextPageToken": "next"},
                                                          {"issues": [{"key": "TEST-2"}], "isLast": True}]) as request:
            self.assertEqual(len(client.search('project = "TEST"')), 2)
            self.assertEqual(request.call_args.kwargs["params"]["nextPageToken"], "next")
        with patch.object(client, "request", return_value={"issues": [], "isLast": False}):
            with self.assertRaises(jira.JiraError):
                client.search("project=TEST")

    def test_metadata_pagination(self):
        client = jira.Client(CONFIG)
        with patch.object(client, "request", side_effect=[{"fields": [{"fieldId": "summary"}], "total": 2},
                                                          {"fields": [{"fieldId": "assignee"}], "total": 2}]) as request:
            self.assertEqual(len(client.pages("/rest/api/3/example", "fields")), 2)
            self.assertEqual(request.call_args.kwargs["params"]["startAt"], 1)

    def test_jql_literal_escapes_quotes_and_backslashes(self):
        self.assertEqual(jira.jql_string('a"b\\c'), '"a\\"b\\\\c"')


if __name__ == "__main__":
    unittest.main()
