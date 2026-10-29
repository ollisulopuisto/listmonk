import test from 'node:test';
import assert from 'node:assert/strict';

import { isSafeLinkUrl } from './url.js';

test('allows http(s), mailto, relative and anchor URLs', () => {
  for (const u of [
    'https://example.com/x?y=1',
    'http://example.com',
    'mailto:user@example.com',
    '/relative/path',
    'relative/path',
    '#section',
    '//cdn.example.com/a.css',
  ]) {
    assert.equal(isSafeLinkUrl(u), true, u);
  }
});

test('rejects executable and non-web schemes', () => {
  for (const u of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com/x',
    '',
    null,
    undefined,
  ]) {
    assert.equal(isSafeLinkUrl(u), false, String(u));
  }
});
