/**
 * Core barrel export for the Embedding Core
 */
export {
  EmbeddingDocument,
  cosineSimilarity,
  createEmbeddedNode,
  type EmbeddedNode,
  type Entity,
  type EntityType,
  type Classification,
  type NodeMetadata,
  type BlockType,
  type HeadingMeta,
  type CodeMeta,
  type ESIMeta,
  type SerializedEmbeddedNode,
  type SerializedEmbeddingDocument,
} from './EmbeddingDocument';

export {
  EmbeddingPipeline,
  type EmbeddingService,
  type EntityExtractionService,
  type ClassificationService,
  type PipelineConfig,
  type PipelineEvent,
  type PipelineListener,
} from './EmbeddingPipeline';

export {
  SemanticGraph,
  type SemanticEdge,
  type SemanticCluster,
  type EdgeType,
  type GraphStats,
} from './SemanticGraph';

export {
  EntityLayer,
  type CanonicalEntity,
  type PIIDetection,
  type PIICategory,
  type EntityEvent,
  type EntityListener,
} from './EntityLayer';
