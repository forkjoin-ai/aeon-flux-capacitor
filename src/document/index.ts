/**
 * Document barrel export
 */
export {
  AeonDocument,
  DOCUMENT_SCHEMA,
  SCHEMA_VERSION,
  type BlockSchema,
  type InlineMark,
  type DocumentEvent,
  type DocumentListener,
} from './document';

export {
  XPathEngine,
  type XPathAddress,
  type XPathPermission,
  type PermissionLevel,
  type PermissionCheckResult,
} from './xpath';

export { markdownToDocument, documentToMarkdown } from './MarkdownIO';
