"""Natural-language intent is prepared by the agent; this tool fills team MR conventions."""
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.jira.create_issues import read_env, JiraError

LOCAL = ROOT / '.gitlab-local'
TEMPLATE = ROOT / '.gitlab/merge_request_templates/Default.md'
TYPES = 'feat|fix|refactor|test|docs|chore|ci'
SCOPES = {'frontend': 'fe', 'backend': 'be', 'ai': 'ai', 'infra': 'infra', 'docs': 'docs', 'wear': 'wear'}


class GitLabError(Exception):
    """Only safe messages, never raw HTTP responses or credential values."""


@dataclass(frozen=True)
class Config:
    base_url: str
    project: str
    token: str = field(repr=False)

    @classmethod
    def load(cls):
        try:
            settings = {**read_env(ROOT / '.env'), **os.environ}
        except JiraError:
            raise GitLabError('로컬 설정 형식을 확인하세요.') from None
        names = ('GITLAB_BASE_URL', 'GITLAB_PROJECT_ID', 'GITLAB_API_TOKEN')
        missing = [name for name in names if not settings.get(name, '').strip()]
        if missing:
            raise GitLabError('누락된 설정: ' + ', '.join(missing))
        base = settings[names[0]].rstrip('/')
        parsed = urlsplit(base)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.path or parsed.query or parsed.fragment):
            raise GitLabError('GITLAB_BASE_URL에는 HTTPS 사이트 주소만 사용하세요.')
        project = settings[names[1]]
        if not project.isdecimal() or int(project) <= 0:
            raise GitLabError('GITLAB_PROJECT_ID에는 양의 정수를 사용하세요.')
        return cls(base, project, settings[names[2]])


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class Client:
    def __init__(self, config):
        self.config = config
        self.opener = build_opener(NoRedirect())

    def request(self, method, path, *, params=None, body=None):
        if not path.startswith(('/projects/', '/user')) or '..' in path:
            raise GitLabError('지원하지 않는 API 경로입니다.')
        url = self.config.base_url + '/api/v4' + path
        if params:
            url += '?' + urlencode(params)
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
        req = Request(url, data=data, method=method, headers={
            'PRIVATE-TOKEN': self.config.token, 'Accept': 'application/json', 'Content-Type': 'application/json'})
        try:
            with self.opener.open(req, timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except HTTPError as exc:
            raise GitLabError(f'GitLab HTTP {exc.code}. 권한·입력·서버 상태를 확인하세요. 변경 요청은 자동 재시도하지 않습니다.') from None
        except (URLError, TimeoutError, OSError):
            raise GitLabError('GitLab 연결 실패 또는 시간 초과. 변경 요청 후에는 기존 MR을 먼저 확인하세요.') from None
        except (ValueError, UnicodeError):
            raise GitLabError('GitLab 응답 형식을 확인할 수 없습니다. 변경 요청을 재시도하지 마세요.') from None

    def pages(self, path, params=None):
        rows, page = [], 1
        while True:
            batch = self.request('GET', path, params={**(params or {}), 'page': page, 'per_page': 100})
            if not isinstance(batch, list):
                raise GitLabError('목록 응답 형식을 확인하세요.')
            rows.extend(batch)
            if len(batch) < 100:
                return rows
            page += 1


def private_path(path):
    # Never bring actual environment-file contents into agent context, including remote diffs.
    name = Path(path).name
    return name == '.env' or (name.startswith('.env.') and not name.endswith('.example'))


def git_branch():
    p = subprocess.run(['git', 'branch', '--show-current'], cwd=ROOT, capture_output=True, text=True)
    if p.returncode or not p.stdout.strip():
        raise GitLabError('현재 작업 브랜치를 확인할 수 없습니다. source_branch를 지정하세요.')
    return p.stdout.strip()


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def save_record(path, record):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    # Antivirus/indexing can briefly hold the destination open on Windows.
    # Retry only the local atomic replace, never a GitLab mutation.
    for attempt in range(3):
        try:
            temp.replace(path)
            return
        except PermissionError:
            if attempt == 2:
                raise
            time.sleep(0.05)


def split_description(text):
    """Split level-two headings only outside Markdown fenced code blocks."""
    text = text.replace('\r\n', '\n')
    headings, offset, fence = [], 0, None
    for line in text.splitlines(keepends=True):
        content = line.rstrip('\n')
        if fence:
            marker, length = fence
            if re.fullmatch(r' {0,3}' + re.escape(marker) + '{' + str(length) + r',}[ \t]*', content):
                fence = None
        else:
            opening = re.fullmatch(r' {0,3}(`{3,}|~{3,})(.*)', content)
            if opening and (opening[1][0] != '`' or '`' not in opening[2]):
                fence = (opening[1][0], len(opening[1]))
            else:
                heading = re.fullmatch(r'## (.+)', content)
                if heading:
                    headings.append((heading[1], offset, offset + len(line)))
        offset += len(line)
    result = []
    for index, (heading, start, body_start) in enumerate(headings):
        end = headings[index + 1][1] if index + 1 < len(headings) else len(text)
        result.append((heading, text[body_start:end].strip()))
    preamble = text[:headings[0][1]].strip() if headings else text.strip()
    return preamble, result


def render_description(draft, key, existing=''):
    template = TEMPLATE.read_text(encoding='utf-8').replace('\r\n', '\n')
    template_preamble, template_sections = split_description(template)
    defaults = dict(template_sections)
    if not {'관련 이슈', '작업 내용', '테스트', '참고'} <= defaults.keys():
        raise GitLabError('MR 템플릿의 필수 섹션을 확인하세요.')
    preamble, previous = split_description(existing)
    names = {'changes': '작업 내용', 'tests': '테스트', 'notes': '참고'}
    values = {'관련 이슈': 'Closes ' + key}
    for field_name, heading in names.items():
        if field_name in draft:
            values[heading] = '\n'.join('- ' + line for line in draft[field_name])
        elif field_name == 'notes' and not any(name == heading for name, _ in previous):
            values[heading] = '- 없음'
    # Keep the team's checklist without claiming checks have passed.
    if 'tests' in draft:
        supplied = values['테스트']
        for line in defaults['테스트'].splitlines():
            label = re.sub(r'^- \[[ xX]\] ', '', line)
            if label and label not in supplied:
                supplied += '\n' + line
        values['테스트'] = supplied
    result = (template_preamble + '\n\n') if template_preamble else ''
    if preamble:
        result = preamble + '\n\n' + result
    # Keep every existing section in order, including repeated headings. A field
    # edit replaces only its first section; later occurrences remain untouched.
    seen = set()
    for heading, content in previous:
        body = values.get(heading, content) if heading not in seen else content
        result += '## ' + heading + '\n' + body + '\n\n'
        seen.add(heading)
    for heading, content in template_sections:
        if heading not in seen:
            result += '## ' + heading + '\n' + values.get(heading, content) + '\n\n'
            seen.add(heading)
    return result.strip()


def validate_draft(draft):
    allowed = {'jira_key', 'source_branch', 'summary', 'type', 'scope', 'changes', 'tests', 'notes', 'draft', 'iid'}
    if not isinstance(draft, dict) or set(draft) - allowed:
        raise GitLabError('초안 필드가 올바르지 않습니다.')
    for key in ('jira_key', 'source_branch', 'summary', 'type', 'scope'):
        if key in draft and draft[key] is not None and (not isinstance(draft[key], str) or not draft[key].strip() or '\n' in draft[key] or '\r' in draft[key]):
            raise GitLabError('초안 문자열 필드를 확인하세요: ' + key)
    for key in ('changes', 'tests', 'notes'):
        if key in draft and (not isinstance(draft[key], list) or not draft[key] or
                any(not isinstance(x, str) or not x.strip() or '\n' in x or '\r' in x for x in draft[key])):
            raise GitLabError('초안 목록 필드를 확인하세요: ' + key)
    if 'iid' in draft and (type(draft['iid']) is not int or draft['iid'] <= 0):
        raise GitLabError('iid에는 양의 정수를 사용하세요.')
    if 'draft' in draft and type(draft['draft']) is not bool:
        raise GitLabError('draft에는 true 또는 false를 사용하세요.')
    return draft


def compact(mr):
    return {k: mr.get(k) for k in ('iid', 'web_url', 'title', 'state', 'source_branch', 'target_branch',
                                  'has_conflicts', 'detailed_merge_status', 'head_pipeline', 'sha')}


class Workflow:
    def __init__(self, client, local=LOCAL):
        self.client, self.config, self.local = client, client.config, local
        self.project = '/projects/' + self.config.project

    def check(self):
        user = self.client.request('GET', '/user')
        project = self.client.request('GET', self.project)
        return {'connected': True, 'user': {'id': user['id'], 'username': user.get('username')},
                'project': {'id': project['id'], 'path': project.get('path_with_namespace')}, 'gitlab_changed': False}

    def detail(self, iid):
        path = self.project + '/merge_requests/' + str(iid)
        mr = self.client.request('GET', path)
        diffs = self.client.pages(path + '/diffs')
        safe = [x for x in diffs if not private_path(x.get('new_path', '')) and not private_path(x.get('old_path', ''))]
        return {**compact(mr), 'description': mr.get('description'), 'diffs': safe,
                'excluded_private_files': len(diffs) - len(safe),
                'pipelines': self.client.pages(path + '/pipelines'), 'gitlab_changed': False}

    def prepare(self, raw):
        d = validate_draft(dict(raw))
        iid = d.get('iid')
        old = self.client.request('GET', self.project + '/merge_requests/' + str(iid)) if iid else None
        if old and (old.get('state') != 'opened' or str(old.get('source_project_id')) != self.config.project):
            raise GitLabError('열린 동일 프로젝트 작업 MR만 수정할 수 있습니다.')
        source = d.get('source_branch') or (old['source_branch'] if old else git_branch())
        match = re.fullmatch(r'(' + TYPES + r')/([A-Z][A-Z0-9_]*-\d+)-[^\s]+', source)
        if not match or source in ('dev', 'master'):
            raise GitLabError('Jira Key를 포함한 팀 작업 브랜치를 사용하세요.')
        key = d.get('jira_key', match[2])
        if key != match[2]:
            raise GitLabError('브랜치와 Jira Key가 다릅니다.')
        if old and source != old['source_branch']:
            raise GitLabError('수정 시 source_branch를 변경할 수 없습니다.')
        target = 'dev'
        base_path = self.project + '/repository/branches/'
        head = self.client.request('GET', base_path + quote(source, safe=''))['commit']['id']
        target_sha = self.client.request('GET', base_path + target)['commit']['id']
        comparison = self.client.request('GET', self.project + '/repository/compare',
                                         params={'from': target_sha, 'to': head})
        if comparison.get('compare_timeout') or not comparison.get('commits'):
            raise GitLabError('비교 가능한 원격 변경이 없습니다. 커밋·Push는 별도 사용자 요청 범위에서 수행하세요.')
        paths = sorted({x['new_path'] for x in comparison.get('diffs', []) if not private_path(x['new_path']) and not private_path(x.get('old_path', ''))})
        areas = {SCOPES.get(p.split('/')[0], 'other') for p in paths}
        scope = d.get('scope')
        if scope and scope not in SCOPES.values():
            raise GitLabError('팀에서 정한 scope를 사용하세요.')
        if scope and (len(areas) > 1 or areas != {scope}):
            raise GitLabError('변경 영역에 맞춰 scope를 생략하거나 수정하세요.')
        kind = d.get('type', match[1])
        if not re.fullmatch(TYPES, kind):
            raise GitLabError('지원하지 않는 type입니다.')
        summary = d.get('summary')
        if not summary and old:
            title_match = re.fullmatch(r'(?:Draft: )?\[' + re.escape(key) + r'\] (' + TYPES + r')(?:\((' + '|'.join(SCOPES.values()) + r')\))?: (.+)', old.get('title', ''))
            if title_match:
                old_kind, old_scope, summary = title_match.groups()
                kind = d.get('type', old_kind)
                scope = d.get('scope', old_scope)
                if 'scope' not in d and areas != {scope}:
                    scope = None
        if not summary:
            raise GitLabError('사용자 요청과 실제 변경 내용을 요약한 summary가 필요합니다.')
        if not old and 'changes' not in d:
            raise GitLabError('실제 변경 내용을 changes에 작성하세요.')
        is_draft = d.get('draft', old.get('draft', False) if old else False)
        title = ('Draft: ' if is_draft else '') + f'[{key}] {kind}' + (f'({scope})' if scope else '') + ': ' + summary
        user = self.client.request('GET', '/user')
        if user.get('state') != 'active':
            raise GitLabError('현재 GitLab 사용자의 활성 상태를 확인하세요.')
        payload = {'title': title, 'description': render_description(d, key, old.get('description') or '' if old else ''),
                   'target_branch': target, 'assignee_ids': [user['id']], 'squash': True, 'remove_source_branch': True}
        if not old:
            payload['source_branch'] = source
        existing = self.client.pages(self.project + '/merge_requests',
                                     {'state': 'opened', 'source_branch': source, 'target_branch': target, 'scope': 'all'})
        existing = [x for x in existing if str(x.get('source_project_id')) == self.config.project]
        if any(x['iid'] != iid for x in existing):
            return {'existing_mrs': [compact(x) for x in existing], 'gitlab_changed': False,
                    'message': '기존 MR을 재사용하세요. 수정 요청이 있으면 해당 iid로 초안을 준비하세요.'}
        # A new MR must include latest dev. Compare source merge-base to target.
        behind = self.client.request('GET', self.project + '/repository/compare', params={'from': head, 'to': target_sha})
        if behind.get('compare_timeout') or behind.get('commits'):
            raise GitLabError('원격 작업 브랜치에 최신 dev를 반영하고 충돌·관련 검증을 확인하세요.')
        snapshot = {k: old.get(k) for k in ('title', 'description', 'target_branch', 'sha', 'assignees',
                    'squash', 'force_remove_source_branch', 'updated_at', 'state')} if old else None
        plan = {'action': 'update' if iid else 'create', 'iid': iid, 'jira_key': key, 'source_branch': source,
                'head_sha': head, 'target_sha': target_sha, 'payload': payload, 'changed_paths': paths,
                'current_mr': snapshot, 'template_sha256': digest(TEMPLATE.read_text(encoding='utf-8'))}
        approved = {k: v for k, v in plan.items() if k != 'changed_paths'}
        plan['approval_sha256'] = digest({'site': self.config.base_url, 'project': self.config.project, **approved})
        # Full API response is for concurrency comparison only, not printed to the agent.
        return plan

    def receipt_path(self, plan):
        identity = [self.config.base_url, self.config.project, plan['action'],
                    plan['iid'] if plan['iid'] else plan['source_branch'], 'dev']
        return self.local / 'receipts' / (digest(identity) + '.json')

    def verify(self, record):
        if record.get('site') != self.config.base_url or record.get('project') != self.config.project:
            raise GitLabError('기록의 GitLab 사이트·프로젝트가 현재 설정과 다릅니다.')
        iid = record.get('iid')
        if not iid:
            raise GitLabError('생성 결과 불확실. 같은 브랜치의 MR 존재 여부를 먼저 조회하세요. 자동 재생성하지 않습니다.')
        actual = self.client.request('GET', self.project + '/merge_requests/' + str(iid))
        expected = record['payload']
        def same_value(key, expected_value):
            actual_value = actual.get(key)
            if key == 'description' and isinstance(actual_value, str):
                # GitLab strips terminal newlines when persisting Markdown.
                return actual_value.replace('\r\n', '\n').rstrip('\n') == expected_value.replace('\r\n', '\n').rstrip('\n')
            return actual_value == expected_value
        mismatches = [k for k, v in expected.items() if k not in ('remove_source_branch', 'assignee_ids') and not same_value(k, v)]
        if sorted(x['id'] for x in actual.get('assignees', [])) != sorted(expected['assignee_ids']):
            mismatches.append('assignee_ids')
        if actual.get('force_remove_source_branch') is not True:
            mismatches.append('remove_source_branch')
        if actual.get('sha') != record['head_sha']:
            mismatches.append('head_sha')
        return {'iid': iid, 'url': actual.get('web_url'), 'jira_key': record['jira_key'],
                'verified': not mismatches, 'mismatches': mismatches}

    def apply(self, draft, approved):
        plan = self.prepare(draft)
        if 'approval_sha256' not in plan:
            return plan
        if approved != plan['approval_sha256']:
            raise GitLabError('미리보기 이후 초안·브랜치·MR·템플릿이 변경됐습니다. 최신 내용을 확인하세요.')
        path = self.receipt_path(plan)
        path.parent.mkdir(parents=True, exist_ok=True)
        lock = path.with_suffix('.lock')
        try:
            handle = lock.open('x', encoding='utf-8')
        except FileExistsError:
            raise GitLabError('같은 MR 작업이 실행 중이거나 중단됐습니다. 기존 결과를 먼저 확인하세요.') from None
        try:
            handle.close()
            if path.exists():
                previous = json.loads(path.read_text(encoding='utf-8'))
                if previous['status'] != 'verified':
                    raise GitLabError('이전 작업 결과가 불확실하거나 검증되지 않았습니다. 기존 MR을 먼저 검증하세요.')
                if previous['approval_sha256'] == approved:
                    return {**self.verify(previous), 'gitlab_changed': False, 'reused_receipt': True}
            latest = self.prepare(draft)
            if latest.get('approval_sha256') != approved:
                raise GitLabError('실행 직전 원격 상태가 바뀌었습니다. 미리보기를 다시 확인하세요.')
            record = {k: plan[k] for k in ('iid', 'jira_key', 'head_sha', 'payload', 'approval_sha256')}
            record.update(site=self.config.base_url, project=self.config.project, status='uncertain')
            def save():
                save_record(path, record)
            save()  # Persist before sending, never blindly retry an uncertain mutation.
            endpoint = self.project + '/merge_requests' + ('/' + str(plan['iid']) if plan['iid'] else '')
            result = self.client.request('PUT' if plan['iid'] else 'POST', endpoint, body=plan['payload'])
            record['iid'] = result['iid']
            record['status'] = 'unverified'
            save()
            try:
                verified = self.verify(record)
            except GitLabError:
                return {'iid': record['iid'], 'url': result.get('web_url'), 'jira_key': record['jira_key'],
                        'verified': False, 'mismatches': ['verification_unavailable'], 'gitlab_changed': True,
                        'message': 'MR 변경 요청은 처리됐으나 재조회에 실패했습니다. 해당 iid로 재검증하세요.'}
            record['status'] = 'verified' if verified['verified'] else 'unverified'
            save()
            return {**verified, 'gitlab_changed': True}
        finally:
            lock.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_mutually_exclusive_group(required=True)
    commands.add_argument('--check', action='store_true')
    commands.add_argument('--list', action='store_true')
    commands.add_argument('--detail', type=int)
    commands.add_argument('--input', type=Path)
    commands.add_argument('--verify', type=int)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--approved-sha256')
    args = parser.parse_args(argv)
    config = None
    try:
        if (args.apply or args.approved_sha256) and not (args.input and args.apply and args.approved_sha256):
            raise GitLabError('--apply와 --approved-sha256는 --input과 함께 사용하세요.')
        config = Config.load()
        w = Workflow(Client(config))
        if args.check:
            result = w.check()
        elif args.list:
            result = {'merge_requests': [compact(x) for x in w.client.pages(w.project + '/merge_requests', {'state': 'opened', 'scope': 'all'})], 'gitlab_changed': False}
        elif args.detail:
            result = w.detail(args.detail)
        elif args.verify:
            records = []
            for path in (LOCAL / 'receipts').glob('*.json'):
                record = json.loads(path.read_text(encoding='utf-8'))
                if record.get('iid') == args.verify and record.get('site') == config.base_url and record.get('project') == config.project:
                    records.append((path, record))
            if not records:
                raise GitLabError('해당 MR의 로컬 실행 기록이 없습니다. --detail로 먼저 확인하세요.')
            path, record = max(records, key=lambda item: item[0].stat().st_mtime_ns)
            result = {**w.verify(record), 'gitlab_changed': False}
            if result['verified']:
                record['status'] = 'verified'
                save_record(path, record)
        else:
            draft = json.loads(args.input.read_text(encoding='utf-8-sig'))
            result = w.apply(draft, args.approved_sha256) if args.apply else w.prepare(draft)
            result = {k: v for k, v in result.items() if k != 'current_mr'}
            result.setdefault('gitlab_changed', False)
        output = json.dumps(result, ensure_ascii=False, indent=2)
        print(output.replace(config.token, '[REDACTED]'))
        return 2 if result.get('verified') is False else 0
    except (GitLabError, OSError, ValueError, KeyError, TypeError):
        # Never echo raw exception text from parsing, networking, or local file contents.
        exc = sys.exception()
        message = str(exc) if isinstance(exc, GitLabError) else '입력·응답·로컬 기록 형식을 확인하세요. 변경 후 오류라면 기존 MR을 먼저 확인하세요.'
        if config:
            message = message.replace(config.token, '[REDACTED]')
        print(json.dumps({'error': message}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
