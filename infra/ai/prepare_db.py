"""EC2에서 AI 읽기 계정과 Secret을 준비한다. 실제 접속 정보는 출력하지 않는다."""
import argparse
import os
from pathlib import Path
import secrets
import subprocess
from urllib.parse import unquote, urlsplit


def psql(container, sql):
    result = subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
         "-U", "runway_admin", "-d", "runway"],
        input=sql, text=True, capture_output=True, timeout=30,
    )
    if result.returncode:
        # 드라이버·SQL 오류 원문에는 접속 정보가 포함될 수 있어 외부에 전달하지 않는다.
        raise RuntimeError("AI DB 계정 준비 실패")
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--secret-file", type=Path, required=True)
    parser.add_argument("--container", required=True)
    args = parser.parse_args()
    if not hasattr(os, "geteuid") or os.geteuid() != 0:
        raise RuntimeError("EC2 root 실행 필요")
    path = args.secret_file
    if not path.is_absolute() or path.is_symlink():
        raise ValueError("Secret 절대 경로 필요")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        # 재실행 시 기존 Secret을 프로그램 내부에서만 사용한다. 값은 AI에게 전달하지 않는다.
        parsed = urlsplit(path.read_text(encoding="utf-8").strip())
        if (parsed.scheme != "postgresql" or parsed.hostname != "db" or parsed.port != 5432
                or parsed.username != "runway_ai" or parsed.path != "/runway" or not parsed.password):
            raise ValueError("기존 AI DB Secret 형식 확인 필요")
        password = unquote(parsed.password)
    else:
        password = secrets.token_hex(32)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(f"postgresql://runway_ai:{password}@db:5432/runway")
    quoted_password = "'" + password.replace("'", "''") + "'"
    psql(args.container, f"""
SET log_statement = 'none';
SET log_min_duration_statement = -1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'runway_ai') THEN
    CREATE ROLE runway_ai;
  END IF;
END $$;
ALTER ROLE runway_ai LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION
  NOBYPASSRLS CONNECTION LIMIT 4 PASSWORD {quoted_password};
ALTER ROLE runway_ai SET default_transaction_read_only = on;
ALTER ROLE runway_ai SET statement_timeout = '2s';
GRANT CONNECT ON DATABASE runway TO runway_ai;
GRANT USAGE ON SCHEMA public TO runway_ai;
GRANT SELECT ON public.courses TO runway_ai;
""")
    os.chown(path.parent, 10001, 10001)
    path.parent.chmod(0o700)
    os.chown(path, 10001, 10001)
    path.chmod(0o400)
    print("AI DB 계정·courses 조회 권한·Secret 준비 완료")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("AI DB 준비 실패: " + type(exc).__name__)
        raise SystemExit(1)
