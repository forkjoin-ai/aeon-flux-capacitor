/**
 * @affectively/capacitor — Top-level barrel export
 *
 * The Embedding Editor: where text is a derivative of the vector space.
 */

// Embedding Core
export * from './core';

// Document Model & CRDT Surface
export * from './document';

// Revisions
export * from './revisions';

// Editor UI
export * from './editor';

// ESI
export {
  ESIRegistry,
  type ESITagDefinition,
  type ESIInvocation,
  type ESIConfig,
} from './esi/ESIRegistry';

// Voice Engine
export {
  VoiceEngine,
  type VoiceModel,
  type VoiceFeatures,
  type VoiceTrainingConfig,
} from './voice/VoiceEngine';

// Design Tokens
export * as tokens from './ui/tokens';

// Code Runtime
export {
  CodeRuntime,
  type CodeSymbol,
  type ImaginedResult,
  type CodeBlockMeta,
  type CodeAction,
} from './code/CodeRuntime';

// DevMode
export {
  DevModeController,
  DevModeIndicator,
  useDevMode,
  type DevModeConfig,
  type SaveResult,
  type PageDataObject,
} from './devmode/DevMode';

// Projections
export {
  AudioProjection,
  type AudioProjectionConfig,
  type BlockVoicing,
  type MusicalScale,
} from './projections/AudioProjection';
export {
  SpatialProjection,
  type SpatialProjectionConfig,
  type SpatialNode,
  type SpatialEdge,
  type NodeShape,
} from './projections/SpatialProjection';
export {
  ReadingProjection,
  type ReadingConfig,
  type ReadingMetrics,
  type Footnote,
  type TableOfContentsEntry,
  type ReadingEvent,
} from './projections/ReadingProjection';
export {
  SquaredSquareProjection,
  type TilingConfig,
  type TiledSquare,
  type TilingResult,
  type TilableBlock,
  type AspectRatio,
} from './projections/SquaredSquareProjection';
export {
  HypercubeProjection,
  type HypercubeConfig,
  type HypercubeNode,
  type HypercubeEdge,
  type HypercubeRotationPlane,
  type ProjectableBlock4D,
} from './projections/HypercubeProjection';

// Collaboration
export {
  CollaborationPresence,
  type Collaborator,
  type CursorPosition,
  type CollaboratorActivity,
  type PresenceConfig,
} from './collaboration/CollaborationPresence';
export {
  CommentManager,
  type InlineComment,
  type SuggestedEdit,
  type CommentState,
  type CommentThreadConfig,
} from './collaboration/InlineComments';

// Publishing
export {
  PublishingPipeline,
  type PublishRecord,
  type PublishState,
  type PublishProjection,
  type SEOMetadata,
  type SocialCards,
} from './publishing/PublishingPipeline';

// Intelligence
export {
  SemanticBacklinks,
  type Backlink,
  type BacklinkType,
  type BacklinkConfig,
} from './intelligence/SemanticBacklinks';
export {
  DocumentSearch,
  type SearchResult,
  type SearchConfig,
  type SearchScope,
} from './intelligence/DocumentSearch';

// Provenance
export {
  ContentProvenance,
  type ProvenanceRecord,
  type ProvenanceChain,
  type ProvenanceConfig,
} from './provenance/ContentProvenance';

// Analytics
export {
  ReadingAnalytics,
  type ReadingSession,
  type DocumentAnalytics,
  type BlockEngagement,
} from './analytics/ReadingAnalytics';

// Dual Index (Amygdala / Hippocampus)
export {
  DualIndex,
  type AmygdalaEntry,
  type HippocampusEntry,
  type RenderSample,
  type InterpolatedSample,
  type SomaticMarker,
} from './core/DualIndex';

// Temporal
export {
  TemporalNavigation,
  type TemporalSnapshot,
  type TemporalDiff,
  type TemporalCurve,
  type TemporalBlockState,
} from './temporal/TemporalNavigation';

// Document Intelligence
export {
  DocumentOracle,
  type OracleInsight,
  type OracleInsightType,
  type DocumentProfile,
} from './intelligence/DocumentOracle';
export {
  EmotionalResonance,
  type EmotionalImpact,
  type EmotionalArc,
  type ArcType,
  type Emotion,
} from './intelligence/EmotionalResonance';
export {
  ReaderWriterSymbiosis,
  type ReaderSignal,
  type SymbiosisAnnotation,
  type AggregatedReaderData,
} from './intelligence/ReaderWriterSymbiosis';
export {
  DocumentMetabolism,
  type BlockFreshness,
  type DocumentHealth,
  type ContentLifespan,
} from './intelligence/DocumentMetabolism';
export {
  KnowledgeFabric,
  type FabricSuggestion,
  type FabricRelationship,
  type FabricUsage,
} from './intelligence/KnowledgeFabric';

// Capability Sharing
export {
  CapabilitySharing,
  type ShareLink,
  type Group,
  type GroupMember,
  type Capability,
  type ShareAudience,
  type CapabilityGrant,
} from './sharing/CapabilitySharing';

// Voice Interface (Edgework STT)
export {
  VoiceInterface,
  type VoiceMode,
  type VoiceCommand,
  type VoiceIntent,
  type VoiceState,
  type VoiceEvent,
} from './voice/VoiceInterface';

// Layout (Information Economics + ESI Personalization)
export {
  ContentKnapsack,
  type ContentItem,
  type ContentValue,
  type ContentWeight,
  type LayoutDecision,
  type LayoutResult,
  type RenderMode,
  type LayoutManifest,
  type PersonalizationContext,
  type ESIValueOverride,
  type ESIKnapsackConfig,
} from './layout/ContentKnapsack';

// Container (The Intelligent Wrapper)
export {
  Capacitor,
  type CapacitorConfig,
  type CapacitorBlock,
  type CapacitorEvent,
  type CapacitorState,
  type ProjectionType,
} from './container/Capacitor';
