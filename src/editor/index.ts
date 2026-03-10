/**
 * Editor barrel export
 */
export {
  EditorRoot,
  EditorCtx,
  useEditor,
  type EditorRootProps,
  type EditorConfig,
  type EditorContext,
  type ViewMode,
} from './EditorRoot';
export { BlockRenderer, type BlockRendererProps } from './BlockRenderer';
export {
  WordActionMenu,
  SelectionToolbar,
  type WordActionMenuProps,
  type WordAction,
  type SelectionToolbarProps,
} from './WordActionMenu';
export {
  CommandPalette,
  useCommandPalette,
  type PaletteItem,
  type PaletteCategory,
  type CommandPaletteProps,
} from './CommandPalette';
export {
  GhostText,
  GhostSuggestEngine,
  useGhostSuggest,
  type GhostSuggestion,
  type GhostSuggestConfig,
  type GhostTextProps,
  type InferenceContext,
} from './GhostSuggest';
