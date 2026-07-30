import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/vue-2';
import StarterKit from '@tiptap/starter-kit';
import { Image } from '@tiptap/extension-image';

import { EmbeddableImage } from './embeddableImage';

// Round-trip HTML through a Tiptap editor configured with the given image node.
// Mirrors how RichtextEditor.vue builds its editor (StarterKit + image node).
const roundTrip = (imageExt, html) => {
  const editor = new Editor({
    extensions: [StarterKit, imageExt],
    content: html,
  });
  const out = editor.getHTML();
  editor.destroy();
  return out;
};

const EMBEDDED = '<img src="https://example.com/logo.png" data-embed="true">';
const PLAIN = '<img src="https://example.com/logo.png">';

describe('EmbeddableImage', () => {
  // Guards the actual bug: the backend keys inline CID embedding off the
  // presence of `data-embed` (internal/manager: applyInlineImages). Tiptap
  // silently drops attributes a node doesn't declare, so with the stock Image
  // node the flag is lost the moment a campaign body is opened and re-saved,
  // and the image is linked remotely instead of embedded.
  it('preserves data-embed through an edit round-trip', () => {
    expect(roundTrip(EmbeddableImage, EMBEDDED)).toContain('data-embed');
  });

  it('demonstrates that the stock Image node drops data-embed', () => {
    expect(roundTrip(Image, EMBEDDED)).not.toContain('data-embed');
  });

  it('does not add data-embed to images that were not marked', () => {
    expect(roundTrip(EmbeddableImage, PLAIN)).not.toContain('data-embed');
  });

  it('normalises the attribute value to "true"', () => {
    const out = roundTrip(EmbeddableImage, '<img src="https://example.com/a.png" data-embed>');
    expect(out).toContain('data-embed="true"');
  });

  it('keeps the src intact so the backend can resolve the filename', () => {
    expect(roundTrip(EmbeddableImage, EMBEDDED)).toContain('src="https://example.com/logo.png"');
  });
});
