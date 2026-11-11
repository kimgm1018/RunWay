#!/usr/bin/env python3
"""Publish Docker resource metrics and allowlisted log fields from the host."""

import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

from route_catalog import read_routes


ROOT = Path("/var/lib/runway-monitoring")
LOGS = ROOT / "container-logs"
SOURCES = {
    "nginx": (
        "runway-nginx-1",
        re.compile(r'^\S+ .*? "(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) [^" ]+ HTTP/[0-9.]+" ([1-5][0-9]{2}) '),
        "method={} status={}",
    ),
    "backend-backend": (
        "runway-backend-backend-1",
        re.compile(r"^\d{4}-\d{2}-\d{2}T\S+\s+(WARN|ERROR)\s+\d+\s+---\s+(?:\[[^\]\r\n]*\]\s*)+([A-Za-z0-9_.]{1,120})\s+:"),
        "level={} logger={}",
    ),
}


def docker(*args):
    return subprocess.run(
        ["/usr/bin/docker", *args], check=True, timeout=10,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, errors="replace",
    ).stdout


def replace(path, content, mode):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            output.write(content)
            output.close()
            temporary.chmod(mode)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def collect_metrics():
    metrics = []
    for line in docker("stats", "--no-stream", "--format", "{{json .}}").splitlines():
        stat = json.loads(line)
        cpu = re.fullmatch(r"(\d+(?:\.\d+)?)%", stat["CPUPerc"])
        memory = re.match(r"(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB)\s*/", stat["MemUsage"])
        if cpu is None or memory is None:
            continue
        name = json.dumps(stat["Name"])
        value, unit = memory.groups()
        memory_bytes = int(float(value) * 1024 ** ("B", "KiB", "MiB", "GiB", "TiB").index(unit))
        metrics.append(f"runway_container_cpu_percent{{name={name}}} {cpu[1]}")
        metrics.append(f"runway_container_memory_bytes{{name={name}}} {memory_bytes}")
    replace(ROOT / "containers.prom", "\n".join(metrics) + "\n", 0o644)


def monitored_routes():
    try:
        return set(read_routes(ROOT / "routes/active/api-routes.json")) | {"unknown"}
    except (OSError, ValueError):
        return {"unknown"}


NGINX_FIELDS = re.compile(
    r" runway_route=(unknown|/api/v1/[A-Za-z0-9_/{}.-]+) runway_seconds=([0-9]{1,9}\.[0-9]{3})$"
)


def nginx_details(message, routes):
    fields = NGINX_FIELDS.search(message)
    if not fields or fields[1] not in routes:
        return ""
    route, seconds = fields.groups()
    whole, milliseconds = seconds.split(".")
    return f" route={route} duration_ms={int(whole) * 1000 + int(milliseconds)}"


SPRING_ERROR_CODES = {"INTERNAL_ERROR", "SERVICE_UNAVAILABLE", "UPLOAD_UNAVAILABLE", "UNKNOWN"}
SPRING_FIELDS = re.compile(
    r"\s+runway_route=(unknown|/api/v1/[A-Za-z0-9_/{\}.-]{1,160})"
    r" runway_error=([A-Z][A-Z0-9_]{0,79})(?: |$)"
)


def spring_details(message, match, routes):
    if not match[2].endswith(".GlobalExceptionHandler") and match[2] != "GlobalExceptionHandler":
        return ""
    fields = SPRING_FIELDS.match(message, match.end())
    if not fields or fields[2] not in SPRING_ERROR_CODES:
        return ""
    route = fields[1] if fields[1] in routes else "unknown"
    return f" route={route} error={fields[2]}"


def collect_logs(service, container, pattern, template, now):
    cursor = ROOT / f"{service}.cursor"
    since = int(cursor.read_text()) if cursor.exists() else now - 30
    since = max(since, now - 300)
    if since >= now:
        return
    routes = monitored_routes()
    lines = []
    for line in docker("logs", "--since", str(since), "--until", str(now),
                       "--tail", "500", "--timestamps", container).splitlines():
        timestamp, _, message = line.partition(" ")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z", timestamp):
            continue
        match = pattern.match(message)
        if match:
            details = nginx_details(message, routes) if service == "nginx" else spring_details(message, match, routes)
            lines.append(f"{timestamp} {template.format(*match.groups())}{details}\n")
    if lines:
        path = LOGS / f"{service}-{now // 86400}.log"
        with path.open("a") as output:
            output.writelines(lines)
    replace(cursor, f"{now}\n", 0o600)


def main():
    os.umask(0o022)
    LOGS.mkdir(exist_ok=True)
    now = int(time.time()) - 2
    failed = []
    try:
        collect_metrics()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError):
        (ROOT / "containers.prom").unlink(missing_ok=True)
        failed.append("metrics")
    for service, (container, pattern, template) in SOURCES.items():
        try:
            collect_logs(service, container, pattern, template, now)
        except (ValueError, OSError, subprocess.SubprocessError):
            failed.append(service)
    for path in LOGS.glob("*.log"):
        if path.stat().st_mtime < now - 172800:
            path.unlink()
    if failed:
        raise SystemExit("Collection failed: " + ", ".join(failed))


if __name__ == "__main__":
    main()
