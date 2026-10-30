import { lexicalHTMLField } from '@payloadcms/richtext-lexical';
import type { CollectionConfig } from 'payload';
import { publishedOrEditor, signedIn } from './access';

export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * A page of one website. "home" is the start page. Editors save drafts and
 * publish; the public websites only ever see published versions.
 */
export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug', '_status', 'updatedAt'] },
  versions: { drafts: true, maxPerDoc: 25 },
  access: {
    read: publishedOrEditor,
    create: signedIn,
    update: signedIn,
    delete: signedIn,
  },
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 200 },
    {
      name: 'slug',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'The address of the page: "home" for the start page, "about" for /about.' },
      validate: (value: unknown) =>
        typeof value === 'string' && value.length <= 80 && SLUG.test(value)
          ? true
          : 'Lower-case words joined by dashes, for example "lunch-menu".',
    },
    {
      name: 'navOrder',
      type: 'number',
      admin: { description: 'Position in the website menu; leave empty to keep the page out of the menu.' },
    },
    { name: 'body', type: 'richText' },
    // The web app renders this HTML; it is made from the rich text, never typed in.
    lexicalHTMLField({ htmlFieldName: 'bodyHtml', lexicalFieldName: 'body' }),
  ],
};
