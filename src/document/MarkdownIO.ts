/**
 * Markdown I/O — Bidirectional Markdown ↔ Yjs conversion
 *
 * Converts between raw Markdown text and Yjs XmlFragment
 * structure. This is the serialization layer that makes
 * the "markdown view" possible in the editor.
 */

import { QDoc, QMap, QArray, QText } from '@a0n/gnosis/crdt';
import type { AeonDocument } from './document';

// ── Types ───────────────────────────────────────────────────────────

/** A parsed markdown block */
interface MarkdownBlock {
  type: string;
  content: string;
  attributes: Record<string, string>;
  children?: MarkdownBlock[];
}

// ── Markdown → Yjs ──────────────────────────────────────────────────

/**
 * Parse a markdown string into an AeonDocument.
 * Each markdown block becomes an XmlElement in the fragment.
 */
export function markdownToDocument(
  markdown: string,
  doc: AeonDocument,
  generateId: () => string
): void {
  const blocks = parseMarkdownBlocks(markdown);

  doc.ydoc.transact(() => {
    // Clear existing content
    while (doc.fragment.length > 0) {
      doc.fragment.delete(0, 1);
    }

    // Insert parsed blocks
    for (const block of blocks) {
      const element = blockToXmlElement(block, generateId);
      doc.fragment.push([element]);
    }
  }, 'local');
}

/**
 * Simple markdown block parser.
 * Handles headings, paragraphs, lists, code blocks, blockquotes, dividers.
 * (Full implementation would use pulldown-cmark in WASM for performance.)
 */
function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty lines — skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Headings (# ... ######)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        content: headingMatch[2],
        attributes: { level: String(headingMatch[1].length) },
      });
      i++;
      continue;
    }

    // Horizontal rules
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({
        type: 'divider',
        content: '',
        attributes: {},
      });
      i++;
      continue;
    }

    // Fenced code blocks
    const codeMatch = line.match(/^```(\w*)$/);
    if (codeMatch) {
      const language = codeMatch[1] || 'text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        type: 'code',
        content: codeLines.join('\n'),
        attributes: { language },
      });
      continue;
    }

    // Blockquotes
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].substring(2));
        i++;
      }
      blocks.push({
        type: 'blockquote',
        content: quoteLines.join('\n'),
        attributes: {},
      });
      continue;
    }

    // Unordered list items
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      const indent = Math.floor(ulMatch[1].length / 2);
      blocks.push({
        type: 'list-item',
        content: ulMatch[2],
        attributes: { indent: String(indent), 'list-type': 'unordered' },
      });
      i++;
      continue;
    }

    // Ordered list items
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (olMatch) {
      const indent = Math.floor(olMatch[1].length / 2);
      blocks.push({
        type: 'list-item',
        content: olMatch[2],
        attributes: { indent: String(indent), 'list-type': 'ordered' },
      });
      i++;
      continue;
    }

    // Task items
    const taskMatch = line.match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      blocks.push({
        type: 'task-item',
        content: taskMatch[2],
        attributes: { checked: taskMatch[1] !== ' ' ? 'true' : 'false' },
      });
      i++;
      continue;
    }

    // Default: paragraph (collect consecutive non-empty lines)
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('> ') &&
      !lines[i].match(/^[-*+]\s/) &&
      !lines[i].match(/^\d+\.\s/)
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    blocks.push({
      type: 'paragraph',
      content: paraLines.join(' '),
      attributes: {},
    });
  }

  return blocks;
}

// TODO: QDoc migration — XmlElement/XmlText constructors not yet available in QDoc
/** Convert a parsed block to an XmlElement */
function blockToXmlElement(
  block: MarkdownBlock,
  generateId: () => string
): any {
  // TODO: QDoc migration — replace with QDoc XmlElement equivalent when available
  const element = { type: block.type, attributes: {} as Record<string, string>, children: [] as any[] } as any;
  element.setAttribute = (k: string, v: string) => { element.attributes[k] = v; };
  element.insert = (pos: number, items: any[]) => { element.children.splice(pos, 0, ...items); };
  element.setAttribute('id', generateId());
  element.setAttribute('embedding-id', generateId());

  for (const [key, value] of Object.entries(block.attributes)) {
    element.setAttribute(key, value);
  }

  if (block.content) {
    // TODO: QDoc migration — replace with QDoc XmlText equivalent when available
    const textNode = { content: block.content, toString: () => block.content };
    element.insert(0, [textNode]);
  }

  return element;
}

// ── Yjs → Markdown ──────────────────────────────────────────────────

/**
 * Export an AeonDocument as a markdown string.
 */
export function documentToMarkdown(doc: AeonDocument): string {
  const blocks = doc.getAllBlocks();
  return blocks.map(xmlElementToMarkdown).join('\n\n');
}

/** Convert an XmlElement back to markdown text */
function xmlElementToMarkdown(element: any): string {
  const type = element.nodeName;
  const text = extractText(element);

  switch (type) {
    case 'heading': {
      const level = parseInt(element.getAttribute('level') || '1', 10);
      const prefix = '#'.repeat(Math.min(level, 6));
      return `${prefix} ${text}`;
    }

    case 'paragraph':
      return text;

    case 'list-item': {
      const indent = parseInt(element.getAttribute('indent') || '0', 10);
      const listType = element.getAttribute('list-type') || 'unordered';
      const indentStr = '  '.repeat(indent);
      const bullet = listType === 'ordered' ? '1.' : '-';
      return `${indentStr}${bullet} ${text}`;
    }

    case 'task-item': {
      const checked = element.getAttribute('checked') === 'true';
      return `- [${checked ? 'x' : ' '}] ${text}`;
    }

    case 'blockquote':
      return text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');

    case 'code': {
      const language = element.getAttribute('language') || '';
      return `\`\`\`${language}\n${text}\n\`\`\``;
    }

    case 'divider':
      return '---';

    case 'image': {
      const src = element.getAttribute('src') || '';
      const alt = element.getAttribute('alt') || '';
      return `![${alt}](${src})`;
    }

    case 'embed': {
      const url = element.getAttribute('url') || '';
      return `[embed](${url})`;
    }

    case 'esi': {
      const tagName = element.getAttribute('tag-name') || 'ESI';
      return `<!-- ESI:${tagName} -->`;
    }

    default:
      return text;
  }
}

/** Extract plain text from an XmlElement */
function extractText(element: any): string {
  const parts: string[] = [];
  for (let i = 0; i < element.length; i++) {
    const child = element.get(i);
    // TODO: QDoc migration — instanceof checks need QDoc equivalents
    if (child && typeof child === 'object' && 'toString' in child) {
      if ('get' in child) {
        // XmlElement-like: recurse
        parts.push(extractText(child));
      } else {
        // XmlText-like: get string
        parts.push(child.toString());
      }
    }
  }
  return parts.join('');
}
