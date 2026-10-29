// DOM regression tests for <richtext-editor>, focused on the link
// dialog: valid URLs are inserted via Squire's insertElement() path and
// dangerous URL schemes are rejected before anything reaches the DOM.
// Runs under Node's built-in runner with jsdom: `bun run test` or
// `node --test test/` from static/admin/.

import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// The real Go partial, with template directives stripped. The strip can
// leave a bare `disabled` attribute behind; mount() removes it.
const fragment = readFileSync(new URL('../partials/richtext-editor.html', import.meta.url), 'utf8')
  .replace(/\{\{[^}]*\}\}/g, '');

function boot() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://listmonk.test/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  // Expose the DOM globals the module expects at import time.
  for (const k of [
    'window', 'document', 'HTMLElement', 'HTMLDialogElement', 'customElements',
    'localStorage', 'getComputedStyle', 'Range', 'Node', 'NodeFilter',
    'MutationObserver', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent',
    'Selection', 'Text', 'DocumentFragment', 'Element', 'SVGElement',
    'requestAnimationFrame', 'cancelAnimationFrame', 'CSS',
    'navigator', 'InputEvent', 'HTMLOListElement', 'CharacterData',
    'HTMLAnchorElement', 'HTMLInputElement', 'DOMParser', 'XMLSerializer',
  ]) {
    if (window[k] !== undefined) {
      try { globalThis[k] = window[k]; } catch { /* read-only global */ }
    }
  }
  // Polyfills for APIs jsdom lacks.
  // CSS Custom Highlight API: jsdom has none; a Map satisfies has/get/set.
  globalThis.CSS = { highlights: new Map(), escape: (x) => x };
  window.CSS = globalThis.CSS;
  if (!globalThis.Highlight) {
    globalThis.Highlight = class { constructor() { this.priority = 0; } };
    window.Highlight = globalThis.Highlight;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    globalThis.ResizeObserver = window.ResizeObserver;
  }
  for (const el of ['showModal', 'close']) {
    if (!window.HTMLDialogElement.prototype[el]) {
      window.HTMLDialogElement.prototype[el] = function () {
        if (el === 'showModal') this.setAttribute('open', ''); else this.removeAttribute('open');
      };
    }
  }
  // jsdom's focus() is irrelevant here (selections are set programmatically)
  // and its interaction with detached/foreign-document nodes throws; stub it.
  window.HTMLElement.prototype.focus = function () {};
  if (!window.HTMLElement.prototype.showPopover) {
    window.HTMLElement.prototype.showPopover = function () {};
    window.HTMLElement.prototype.hidePopover = function () {};
  }
  return { dom, window, document: window.document };
}

const { window, document } = boot();
await import('../assets/js/richtext-editor.js');

function mount(value = '') {
  const wrap = document.createElement('div');
  wrap.innerHTML = fragment;
  const el = wrap.querySelector('richtext-editor');
  // The Go template renders `disabled` conditionally; our static strip left
  // the bare word behind, so remove it. Seed content via the source textarea,
  // exactly how the real template delivers the body.
  el.removeAttribute('disabled');
  if (value) el.querySelector('[data-rte-source]').value = value;
  // jsdom lacks HTMLFormElement named getters; mirror browser behavior on
  // every form in the fragment before any handler can touch them.
  for (const form of el.querySelectorAll('form')) {
    for (const c of form.querySelectorAll('[name]')) {
      if (!form[c.name]) Object.defineProperty(form, c.name, { value: c, configurable: true });
    }
  }
  document.body.appendChild(el);
  return el;
}

function caretToEnd(ed) {
  const root = ed.getRoot();
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  ed.setSelection(range);
}

function openLink(el) {
  el.querySelector('.rte-toolbar [data-cmd="link"]').click();
  const d = el.querySelector('[data-rte-dialog="link"]');
  return { d, f: d.querySelector('form') };
}

function links(el) {
  return [...el.querySelectorAll('[data-rte-content] a')].map((a) => ({
    href: a.getAttribute('href'),
    text: a.textContent,
    title: a.getAttribute('title'),
    onmouseover: a.getAttribute('onmouseover'),
  }));
}

test('new link with valid https URL is inserted as an element (insertElement path)', () => {
  const el = mount('<p>Hello world</p>');
  const ed = el.editor;
  caretToEnd(ed);
  const { f } = openLink(el);
  f.url.value = 'https://example.com/page?x=1';
  f.text.value = 'Example';
  el.querySelector('[data-rte-act="submit"]').click();
  const ls = links(el);
  assert.equal(ls.length, 1);
  assert.equal(ls[0].href, 'https://example.com/page?x=1');
  assert.equal(ls[0].text, 'Example');
  // Keep the editor attached; detaching makes deferred Squire timers throw in jsdom.
});

test('new link with javascript: URL is rejected; nothing is inserted', () => {
  const el = mount('<p>Hello world</p>');
  const ed = el.editor;
  caretToEnd(ed);
  const before = ed.getHTML();
  const { f } = openLink(el);
  f.url.value = 'javascript:alert(1)';
  f.text.value = 'Click';
  el.querySelector('[data-rte-act="submit"]').click();
  assert.equal(links(el).length, 0);
  assert.equal(ed.getHTML(), before);
  // Keep the editor attached; detaching makes deferred Squire timers throw in jsdom.
});

test('obfuscated javascript: variants are rejected at the dialog', () => {
  for (const bad of ['  javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x']) {
    const el = mount('<p>Hi</p>');
    caretToEnd(el.editor);
    const { f } = openLink(el);
    f.url.value = bad;
    f.text.value = 'x';
    el.querySelector('[data-rte-act="submit"]').click();
    assert.equal(links(el).length, 0, bad);
    // keep attached: disconnect nulls the editor while a ready-microtask is queued
  }
});

test('editing an existing link to javascript: is rejected and the original href survives', () => {
  const el = mount('<p><a href="https://old.example">Old</a></p>');
  const ed = el.editor;
  // Caret inside the existing anchor text.
  const a = el.querySelector('[data-rte-content] a');
  const range = document.createRange();
  range.setStart(a.firstChild, 2);
  range.collapse(true);
  ed.setSelection(range);
  const { f } = openLink(el);
  assert.equal(f.url.value, 'https://old.example');
  f.url.value = 'javascript:alert(1)';
  el.querySelector('[data-rte-act="submit"]').click();
  assert.equal(links(el)[0].href, 'https://old.example');
  // Keep the editor attached; detaching makes deferred Squire timers throw in jsdom.
});

test('editing an existing link to a new https URL works (makeLink path)', () => {
  const el = mount('<p><a href="https://old.example">Old</a></p>');
  const ed = el.editor;
  const a = el.querySelector('[data-rte-content] a');
  const range = document.createRange();
  range.setStart(a.firstChild, 2);
  range.collapse(true);
  ed.setSelection(range);
  const { f } = openLink(el);
  f.url.value = 'https://new.example';
  el.querySelector('[data-rte-act="submit"]').click();
  const ls = links(el);
  assert.equal(ls.length, 1);
  assert.equal(ls[0].href, 'https://new.example');
  assert.equal(ls[0].text, 'Old');
  // Keep the editor attached; detaching makes deferred Squire timers throw in jsdom.
});

test('mailto: link is allowed again', () => {
  const el = mount('<p>Hi</p>');
  caretToEnd(el.editor);
  const { f } = openLink(el);
  f.url.value = 'mailto:user@example.com';
  f.text.value = 'Mail';
  el.querySelector('[data-rte-act="submit"]').click();
  assert.equal(links(el)[0].href, 'mailto:user@example.com');
  // Keep the editor attached; detaching makes deferred Squire timers throw in jsdom.
});

test('hostile title attribute stays an inert attribute on the insertElement path', () => {
  const el = mount('<p>Hi</p>');
  caretToEnd(el.editor);
  const { f } = openLink(el);
  f.url.value = 'https://example.com';
  f.text.value = 'x';
  f.title.value = 't" onmouseover="alert(1)';
  el.querySelector('[data-rte-act="submit"]').click();
  const ls = links(el);
  assert.equal(ls.length, 1);
  assert.equal(ls[0].title, 't" onmouseover="alert(1)');
  assert.equal(ls[0].onmouseover, null);
  // Serialized title text may contain the substring, so assert structurally:
  // no element anywhere gained an onmouseover attribute.
  assert.equal(el.querySelector('[data-rte-content] [onmouseover]'), null);
  // Keep the editor attached; detaching makes deferred Squire timers throw in jsdom.
});

// Let pending editor timers settle before the runner closes the file.
await new Promise((r) => setTimeout(r, 100));
