"""실제 JSON/HTTP 판정 코드를 실행해 오류 응답이 통과하지 않는지 확인한다."""
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

CHECK = Path(__file__).resolve().parents[1] / 'check.sh'
PROBE = CHECK.read_text(encoding='utf-8').split("<<'PY'\n", 1)[1].split('\nPY\n', 1)[0]

class Response:
    def __init__(self, status=200, body=b'{"status":"UP"}'):
        self.status = status
        self.body = body
    def read(self, limit):
        return self.body[:limit]
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass

class ProbeTests(unittest.TestCase):
    def probe(self, responses, mode='readiness'):
        with patch.object(sys, 'argv', ['probe', mode]), patch('urllib.request.urlopen', side_effect=responses):
            with self.assertRaises(SystemExit) as outcome:
                exec(compile(PROBE, str(CHECK), 'exec'), {})
            return outcome.exception.code

    def test_200_up_and_responding_main_server_pass(self):
        self.assertEqual(self.probe([Response(), Response(200)]), 0)
        self.assertEqual(self.probe([Response(), HTTPError('test', 404, '', {}, io.BytesIO())]), 0)

    def test_down_invalid_json_wrong_type_and_oversized_body_fail(self):
        for body in [b'{"status":"DOWN"}', b'', b'not-json', b'"UP"',
                     b'{"status":"UP","details":"unexpected"}', b' ' * 4097]:
            with self.subTest(body=body[:40]):
                self.assertEqual(self.probe([Response(body=body)]), 1)

    def test_wrong_status_timeout_and_disconnection_fail(self):
        for value in [Response(503), HTTPError('test', 404, '', {}, io.BytesIO()),
                      TimeoutError(), URLError('synthetic-offline')]:
            with self.subTest(value=type(value).__name__):
                self.assertEqual(self.probe([value]), 1)

    def test_healthy_management_with_dead_or_failing_main_server_fails(self):
        for value in [URLError('synthetic-offline'), HTTPError('test', 500, '', {}, io.BytesIO())]:
            self.assertEqual(self.probe([Response(), value]), 1)

    def test_legacy_requires_main_404_and_does_not_call_readiness(self):
        self.assertEqual(self.probe([HTTPError('test', 404, '', {}, io.BytesIO())], 'legacy'), 0)
        self.assertEqual(self.probe([Response(200)], 'legacy'), 1)
