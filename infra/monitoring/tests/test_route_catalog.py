"""경로 목록의 입력 경계와 Nginx·수집기 공통 사용을 검증한다."""

import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from route_catalog import nginx_map, validate_routes


class RouteCatalogTests(unittest.TestCase):
    def test_catalog_versions_are_immutable_and_restore_together(self):
        import base64
        import contextlib
        import io
        import json
        import os
        import tempfile
        from unittest.mock import patch
        import route_catalog

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def command(action, routes=None, version=None):
                environment = {}
                if routes is not None:
                    environment["ROUTES_BASE64"] = base64.b64encode(json.dumps(routes).encode()).decode()
                if version:
                    environment["ROUTES_VERSION"] = version
                with patch.object(route_catalog, "CATALOG_ROOT", root), patch.object(
                    sys, "argv", ["catalog", action]
                ), patch.dict(os.environ, environment), contextlib.redirect_stdout(io.StringIO()):
                    route_catalog.catalog_command()

            command("install", ["/api/v1/courses/{courseId}"])
            old = (root / "active").resolve()
            files = [old / "api-routes.json", old / "nginx.map"]
            timestamps = [path.stat().st_mtime_ns for path in files]
            command("install", ["/api/v1/courses/{courseId}"])
            self.assertEqual(timestamps, [path.stat().st_mtime_ns for path in files])
            with self.assertRaises(ValueError):
                command("install", ["/api/v1/{bad:regex}"])
            self.assertEqual((root / "active").resolve(), old)
            command("install", ["/api/v1/new-api"])
            self.assertNotEqual((root / "active").resolve(), old)
            command("restore", version=old.name)
            self.assertEqual((root / "active").resolve(), old)
            self.assertIn("/api/v1/courses/{courseId}", (root / "active/api-routes.json").read_text())

    def test_fixed_path_precedes_variable(self):
        output = nginx_map(["/api/v1/courses/{courseId}", "/api/v1/courses/recommendations"])
        self.assertLess(output.index("recommendations"), output.index("[^/]+"))
        self.assertIn('"/api/v1/courses/{courseId}"', output)

    def test_unsafe_or_unsupported_patterns_are_rejected(self):
        for path in (
            "/api/v1/courses/{id:[0-9]+}", "/api/v1/courses/*",
            "/api/v1/courses/{*path}", "/api/v1/courses/{id}.json",
            "/api/v1/courses?token=value", '/api/v1/x"; include secret;',
            "/other/api", "/api/v1/courses\ninclude", "/api/v1/{id",
        ):
            with self.subTest(path=path), self.assertRaises(ValueError):
                validate_routes([path])

    def test_no_routes_or_duplicates_are_rejected(self):
        for routes in ([], {}, ["/api/v1/courses", "/api/v1/courses"]):
            with self.subTest(routes=routes), self.assertRaises(ValueError):
                validate_routes(routes)

    def test_collector_only_enriches_from_catalog(self):
        spec = importlib.util.spec_from_file_location("collector", ROOT / "collect-container-observability.py")
        collector = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(collector)
        routes = set(validate_routes(["/api/v1/courses/{courseId}", "/api/v1/new-api"])) | {"unknown"}
        self.assertEqual(
            collector.nginx_details(" runway_route=/api/v1/new-api runway_seconds=0.012", routes),
            " route=/api/v1/new-api duration_ms=12",
        )
        self.assertEqual(
            collector.nginx_details(" runway_route=/api/v1/courses/123 runway_seconds=0.012", routes), "",
        )
        prefix = "2026-11-05T00:00:00Z ERROR 1 --- [main] c.r.GlobalExceptionHandler : "
        pattern = collector.SOURCES["backend-backend"][1]
        for path, code, expected in (
            ("/api/v1/new-api", "INTERNAL_ERROR", " route=/api/v1/new-api error=INTERNAL_ERROR"),
            ("/api/v1/courses/123", "INTERNAL_ERROR", " route=unknown error=INTERNAL_ERROR"),
            ("/api/v1/new-api", "SECRET_VALUE", ""),
        ):
            line = prefix + f"runway_route={path} runway_error={code} private-body"
            self.assertEqual(collector.spring_details(line, pattern.match(line), routes), expected)


if __name__ == "__main__":
    unittest.main()
