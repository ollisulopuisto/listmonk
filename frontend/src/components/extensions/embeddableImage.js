import { Image } from '@tiptap/extension-image';

/**
 * Image node that preserves the `data-embed` attribute.
 *
 * Images marked with `data-embed` are attached to the outgoing e-mail as inline
 * CID parts by the backend (internal/manager: applyInlineImages) instead of
 * being linked remotely. Tiptap drops attributes it doesn't know about when
 * parsing and re-rendering, so the attribute has to be declared on the node or
 * it is silently lost the first time the campaign body round-trips through the
 * editor.
 *
 * The backend matches on attribute *presence* (`\bdata-embed\b`), so the value
 * is normalised to "true" on render.
 */
export const EmbeddableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      dataEmbed: {
        default: null,
        parseHTML: (element) => (element.hasAttribute('data-embed') ? 'true' : null),
        renderHTML: (attributes) => (attributes.dataEmbed ? { 'data-embed': 'true' } : {}),
      },
    };
  },
});

export default EmbeddableImage;
