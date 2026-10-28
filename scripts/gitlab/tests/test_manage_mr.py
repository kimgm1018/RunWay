import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from scripts.gitlab.manage_mr import (
    Client, Config, GitLabError, NoRedirect, Workflow, main, private_path, render_description, save_record,
)


class FakeClient:
    def __init__(self):
        self.config = Config('https://gitlab.example.com', '42', 'secret-test-value')
        self.calls = []
        self.mr = None
        self.behind = False
        self.head = 'a' * 40
        self.target = 'b' * 40
        self.paths = ['scripts/gitlab/manage_mr.py', 'docs/development/gitlab-automation.md']
        self.fail_write = False
        self.fail_readback = False
        self.written = False
        self.mismatch = False
        self.diffs = []

    def request(self, method, path, *, params=None, body=None):
        self.calls.append((method, path, copy.deepcopy(body)))
        if method in ('POST', 'PUT'):
            self.written = True
            if self.fail_write:
                raise GitLabError('timeout')
            self.mr = {**body, 'iid': 7, 'source_branch': 'feat/S15P31E105-29-mr',
                       'source_project_id': 42, 'state': 'opened', 'draft': False,
                       'assignees': [{'id': 3}], 'force_remove_source_branch': True,
                       'web_url': 'https://gitlab.example.com/group/project/-/merge_requests/7',
                       'sha': self.head}
            if self.mismatch:
                self.mr['squash'] = False
            return copy.deepcopy(self.mr)
        if path == '/user':
            return {'id': 3, 'username': 'runner', 'state': 'active'}
        if '/repository/branches/' in path:
            return {'commit': {'id': self.target if path.endswith('/dev') else self.head}}
        if path.endswith('/repository/compare'):
            behind = params['to'] == self.target
            return {'commits': ([{'id': self.target}] if self.behind else []) if behind else [{'id': self.head}],
                    'diffs': [{'new_path': p, 'old_path': p} for p in self.paths]}
        if path.endswith('/merge_requests/7'):
            if self.fail_readback and self.written:
                raise GitLabError('read-back failed')
            return copy.deepcopy(self.mr)
        if path == '/projects/42':
            return {'id': 42, 'path_with_namespace': 'group/project'}
        raise AssertionError(path)

    def pages(self, path, params=None):
        self.calls.append(('GET', path, None))
        if path.endswith('/diffs'):
            return self.diffs
        if path.endswith('/pipelines'):
            return []
        return [copy.deepcopy(self.mr)] if self.mr else []


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.client = FakeClient()
        self.w = Workflow(self.client, Path(self.tmp.name))
        self.draft = {'source_branch': 'feat/S15P31E105-29-mr', 'summary': 'MR automation',
                      'changes': ['Create and update team MRs'], 'tests': ['[x] Unit tests passed']}

    def create(self):
        p = self.w.prepare(self.draft)
        return self.w.apply(self.draft, p['approval_sha256'])

    def test_preview_fills_team_fields_without_mutation(self):
        p = self.w.prepare(self.draft)
        f = p['payload']
        self.assertEqual(f['title'], '[S15P31E105-29] feat: MR automation')
        self.assertEqual(f['target_branch'], 'dev')
        self.assertEqual(f['assignee_ids'], [3])
        self.assertTrue(f['squash'])
        self.assertTrue(f['remove_source_branch'])
        for h in ('관련 이슈', '작업 내용', '테스트', '참고'):
            self.assertIn('## ' + h, f['description'])
        self.assertIn('Closes S15P31E105-29', f['description'])
        self.assertIn('- [ ] MR 변경 내용과 검증 결과를 한 번 더 확인하고 병합 가능 여부 판단', f['description'])
        self.assertNotIn('[리뷰 시 확인할 사항]', f['description'])
        self.assertTrue(all(x[0] == 'GET' for x in self.client.calls))

    def test_successful_create_and_readback(self):
        result = self.create()
        self.assertTrue(result['verified'])
        self.assertEqual(result['iid'], 7)
        self.assertEqual(sum(x[0] == 'POST' for x in self.client.calls), 1)

    def test_existing_mr_reused_without_post(self):
        self.create()
        result = self.w.prepare(self.draft)
        self.assertEqual(result['existing_mrs'][0]['iid'], 7)
        self.assertNotIn('approval_sha256', result)

    def test_edit_preserves_unspecified_content_and_updates_summary(self):
        self.create()
        self.client.mr['description'] += '\n## 추가 정보\nKeep this\n'
        d = {'iid': 7, 'summary': 'Improved MR automation'}
        p = self.w.prepare(d)
        self.assertIn('Create and update team MRs', p['payload']['description'])
        self.assertIn('[x] Unit tests passed', p['payload']['description'])
        self.assertIn('Keep this', p['payload']['description'])
        result = self.w.apply(d, p['approval_sha256'])
        self.assertTrue(result['verified'])
        self.assertEqual(sum(x[0] == 'PUT' for x in self.client.calls), 1)

    def test_edit_without_summary_preserves_title(self):
        self.create()
        d = {'iid': 7, 'notes': ['New note']}
        p = self.w.prepare(d)
        self.assertEqual(p['payload']['title'], self.client.mr['title'])

    def test_concurrent_remote_edit_invalidates_preview(self):
        self.create()
        d = {'iid': 7, 'summary': 'Updated'}
        p = self.w.prepare(d)
        self.client.mr['description'] += '\nExternal edit'
        with self.assertRaises(GitLabError):
            self.w.apply(d, p['approval_sha256'])

    def test_changed_draft_or_head_rejected(self):
        p = self.w.prepare(self.draft)
        for mode in ('draft', 'head'):
            d = dict(self.draft)
            if mode == 'draft':
                d['summary'] = 'Changed'
            else:
                self.client.head = 'c' * 40
            with self.assertRaises(GitLabError):
                self.w.apply(d, p['approval_sha256'])
        self.assertFalse(self.client.written)

    def test_uncertain_create_cannot_be_bypassed_by_changing_input(self):
        self.client.fail_write = True
        p = self.w.prepare(self.draft)
        with self.assertRaises(GitLabError):
            self.w.apply(self.draft, p['approval_sha256'])
        self.client.fail_write = False
        d = {**self.draft, 'summary': 'Different title'}
        with self.assertRaises(GitLabError):
            self.w.apply(d, self.w.prepare(d)['approval_sha256'])
        self.assertEqual(sum(x[0] == 'POST' for x in self.client.calls), 1)

    def test_created_iid_saved_before_readback_failure(self):
        self.client.fail_readback = True
        p = self.w.prepare(self.draft)
        result = self.w.apply(self.draft, p['approval_sha256'])
        self.assertFalse(result['verified'])
        self.assertEqual(result['iid'], 7)
        record = json.loads(self.w.receipt_path(p).read_text(encoding='utf-8'))
        self.assertEqual(record['iid'], 7)
        self.assertEqual(record['status'], 'unverified')
        self.client.fail_readback = False
        self.assertTrue(self.w.verify(record)['verified'])

    def test_field_mismatch_reported(self):
        self.client.mismatch = True
        result = self.create()
        self.assertFalse(result['verified'])
        self.assertIn('squash', result['mismatches'])

    def test_gitlab_trailing_newline_normalization_is_not_a_content_mismatch(self):
        self.create()
        path = next((Path(self.tmp.name) / 'receipts').glob('*.json'))
        record = json.loads(path.read_text(encoding='utf-8'))
        record['payload']['description'] += '\n'
        self.client.mr['description'] = self.client.mr['description'].rstrip('\n')
        self.assertTrue(self.w.verify(record)['verified'])
        self.client.mr['description'] += '\nChanged content'
        self.assertFalse(self.w.verify(record)['verified'])

    def test_lock_prevents_concurrent_operation(self):
        p = self.w.prepare(self.draft)
        path = self.w.receipt_path(p)
        path.parent.mkdir(parents=True)
        path.with_suffix('.lock').touch()
        with self.assertRaises(GitLabError):
            self.w.apply(self.draft, p['approval_sha256'])
        self.assertFalse(self.client.written)

    def test_behind_dev_and_wrong_jira_rejected(self):
        self.client.behind = True
        with self.assertRaises(GitLabError):
            self.w.prepare(self.draft)
        self.client.behind = False
        with self.assertRaises(GitLabError):
            self.w.prepare({**self.draft, 'jira_key': 'OTHER-1'})

    def test_private_files_not_in_diff_output(self):
        self.create()
        self.client.diffs = [
            {'new_path': '.env', 'old_path': '.env', 'diff': 'NEVER OUTPUT'},
            {'new_path': 'safe.txt', 'old_path': '.env.production', 'diff': 'NEVER OUTPUT'},
            {'new_path': 'file.py', 'old_path': 'file.py', 'diff': 'code'},
        ]
        result = self.w.detail(7)
        self.assertNotIn('NEVER OUTPUT', json.dumps(result))
        self.assertEqual(result['excluded_private_files'], 2)
        self.assertFalse(private_path('.env.example'))

    def test_unsupported_mutations_and_scopes_rejected(self):
        for extra in ({'merge': True}, {'target_branch': 'master'}, {'scope': 'gitlab'}, {'scope': 'docs'}):
            with self.assertRaises(GitLabError):
                self.w.prepare({**self.draft, **extra})

    def test_update_retains_preamble(self):
        self.create()
        self.client.mr['description'] = 'Context before headings\n\n' + self.client.mr['description']
        p = self.w.prepare({'iid': 7, 'notes': ['Updated notes']})
        self.assertTrue(p['payload']['description'].startswith('Context before headings'))

    def test_outdated_scope_not_carried_to_multi_area_edit(self):
        self.create()
        self.client.mr['title'] = '[S15P31E105-29] feat(docs): MR automation'
        p = self.w.prepare({'iid': 7, 'notes': ['Updated']})
        self.assertEqual(p['payload']['title'], '[S15P31E105-29] feat: MR automation')

    def test_token_not_in_receipts(self):
        self.create()
        for path in Path(self.tmp.name).rglob('*.json'):
            self.assertNotIn(self.client.config.token, path.read_text(encoding='utf-8'))

    def test_update_repeated_after_success_does_not_write_again(self):
        self.create()
        draft = {'iid': 7, 'summary': 'Updated'}
        first = self.w.prepare(draft)
        self.w.apply(draft, first['approval_sha256'])
        # A new preview is required after the MR metadata changed.
        with self.assertRaises(GitLabError):
            self.w.apply(draft, first['approval_sha256'])
        self.assertEqual(sum(x[0] == 'PUT' for x in self.client.calls), 1)


class DescriptionTests(unittest.TestCase):
    def test_notes_edit_preserves_repeated_sections_and_their_order(self):
        existing = (
            '## 관련 이슈\nCloses S15P31E105-29\n\n'
            '## 로그\nFirst unique log\n\n'
            '## 작업 내용\n- Original work\n\n'
            '## 로그\nSecond unique log\n\n'
            '## 테스트\n- [x] Passed\n\n'
            '## 참고\n- Old note\n\n'
            '## 작업 내용\n- Additional work\n\n'
            '## 로그\nThird unique log'
        )
        for newline in ('\n', '\r\n'):
            with self.subTest(newline=repr(newline)):
                actual = render_description(
                    {'notes': ['Updated note']}, 'S15P31E105-29',
                    existing.replace('\n', newline),
                )
                self.assertEqual(actual, existing.replace('- Old note', '- Updated note'))

    def test_changes_edit_preserves_later_sections_with_the_same_heading(self):
        existing = (
            '## 관련 이슈\nCloses S15P31E105-29\n\n'
            '## 작업 내용\n- Original work\n\n'
            '## 테스트\n- [x] Passed\n\n'
            '## 작업 내용\n- Additional work\n\n'
            '## 참고\n- Keep note'
        )
        actual = render_description({'changes': ['Updated work']}, 'S15P31E105-29', existing)
        self.assertEqual(actual, existing.replace('- Original work', '- Updated work'))

    def test_notes_edit_preserves_fenced_examples_and_other_sections(self):
        examples = (
            '```bash\n## 실행 예시\necho hello\n```',
            '~~~markdown\n## 테스트\nKeep this example\n~~~',
            '````markdown\n```\n## 실행 예시\n~~~\n````',
            '~~~~markdown\n~~~\n## 실행 예시\n```\n~~~~',
            '   ```bash\n## 실행 예시\necho hello\n   ```',
            '```bash\n## 실행 예시\necho hello\n`````',
        )
        for example in examples:
            for newline in ('\n', '\r\n'):
                with self.subTest(example=example, newline=repr(newline)):
                    existing = (
                        '## 관련 이슈\nCloses S15P31E105-29\n\n'
                        '## 작업 내용\n- 기존 설명\n\n' + example + '\n\n'
                        '## 테스트\n- [x] 통과\n\n'
                        '## 참고\n- 기존 참고\n\n'
                        '## 추가 정보\nKeep this\n'
                    )
                    expected = existing.replace('- 기존 참고', '- 참고만 수정').strip()
                    actual = render_description(
                        {'notes': ['참고만 수정']}, 'S15P31E105-29',
                        existing.replace('\n', newline),
                    )
                    self.assertEqual(actual, expected)

    def test_preamble_with_fenced_heading_is_preserved(self):
        preamble = 'Context\n\n```markdown\n## 예시\n```'
        existing = preamble + '\n\n' + render_description(
            {'changes': ['Original'], 'notes': ['Old note']}, 'S15P31E105-29',
        )
        actual = render_description({'notes': ['New note']}, 'S15P31E105-29', existing)
        self.assertEqual(actual, existing.replace('- Old note', '- New note'))


class ClientTests(unittest.TestCase):
    def test_local_record_replace_retries_without_network(self):
        with patch.object(Path, 'write_text'), patch.object(Path, 'replace', side_effect=[PermissionError(), None]) as replace, patch('scripts.gitlab.manage_mr.time.sleep'):
            save_record(Path('record.json'), {'status': 'verified'})
            self.assertEqual(replace.call_count, 2)

    def test_http_and_connection_errors_do_not_expose_response_or_token(self):
        c = Client(Config('https://example.com', '42', 'PRIVATE-TEST-TOKEN'))
        for error in (HTTPError('https://example.com', 403, 'SECRET BODY', {}, io.BytesIO(b'SECRET BODY')),
                      URLError('PRIVATE-TEST-TOKEN')):
            with patch.object(c.opener, 'open', side_effect=error):
                with self.assertRaises(GitLabError) as caught:
                    c.request('POST', '/projects/42/merge_requests', body={})
                self.assertNotIn('PRIVATE-TEST-TOKEN', str(caught.exception))
                self.assertNotIn('SECRET BODY', str(caught.exception))

    def test_redirects_disabled(self):
        self.assertIsNone(NoRedirect().redirect_request(None, None, None, None, None, None))

    def test_pagination_reads_all_pages(self):
        c = Client(Config('https://example.com', '42', 'token'))
        with patch.object(c, 'request', side_effect=[list(range(100)), [100]]) as request:
            self.assertEqual(len(c.pages('/projects/42/merge_requests')), 101)
            self.assertEqual(request.call_args.kwargs['params']['page'], 2)

    def test_missing_configuration_reports_names_only(self):
        with patch('scripts.gitlab.manage_mr.read_env', return_value={}), patch.dict('os.environ', {}, clear=True):
            with self.assertRaises(GitLabError) as caught:
                Config.load()
            self.assertIn('GITLAB_API_TOKEN', str(caught.exception))

    def test_cli_safe_generic_error(self):
        with patch('scripts.gitlab.manage_mr.Config.load', side_effect=ValueError('SECRET')), patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(main(['--check']), 1)
            self.assertNotIn('SECRET', output.getvalue())


if __name__ == '__main__':
    unittest.main()
