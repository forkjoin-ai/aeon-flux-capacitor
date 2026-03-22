/**
 * SemanticGraph — The document's semantic structure as a graph
 *
 * Nodes are embedded blocks. Edges represent semantic similarity,
 * entity co-reference, and narrative flow. This graph powers:
 * - "What else talks about the same thing?" queries
 * - Spatial preview clustering (semantically related blocks cluster in 3D)
 * - AI suggestions ("This paragraph contradicts paragraph 7")
 * - Cross-document semantic search
 */

import {
  cosineSimilarity,
  type EmbeddingDocument,
  type EmbeddedNode,
} from './EmbeddingDocument';

// ── Types ───────────────────────────────────────────────────────────

/** Edge type in the semantic graph */
export type EdgeType =
  | 'similarity' // Cosine similarity above threshold
  | 'co-reference' // Same entity mentioned in both blocks
  | 'narrative-flow' // Sequential blocks in document order
  | 'contradiction' // AI-detected contradiction
  | 'elaboration'; // One block elaborates on another

/** An edge connecting two embedded nodes */
export interface SemanticEdge {
  /** Source node ID */
  readonly source: string;
  /** Target node ID */
  readonly target: string;
  /** Type of semantic relationship */
  readonly type: EdgeType;
  /** Strength of the relationship (0-1) */
  readonly weight: number;
  /** Optional label (e.g., shared entity name) */
  readonly label?: string;
}

/** A cluster of semantically related nodes */
export interface SemanticCluster {
  /** Cluster ID */
  readonly id: string;
  /** Node IDs in this cluster */
  readonly nodeIds: string[];
  /** Cluster centroid embedding */
  readonly centroid: Float32Array;
  /** Dominant topic */
  readonly topic: string;
}

/** Graph statistics */
export interface GraphStats {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly clusterCount: number;
  readonly avgDegree: number;
  readonly density: number;
}

// ── Semantic Graph ──────────────────────────────────────────────────

export class SemanticGraph {
  /** All edges in the graph */
  private edges: SemanticEdge[] = [];

  /** Adjacency list: node ID → connected edges */
  private adjacency: Map<string, SemanticEdge[]> = new Map();

  /** Computed clusters */
  private clusters: SemanticCluster[] = [];

  /** Similarity threshold for automatic edge creation */
  private readonly similarityThreshold: number;

  /** Co-reference threshold for entity linking edges */
  private readonly coReferenceMinOccurrences: number;

  constructor(
    similarityThreshold: number = 0.72,
    coReferenceMinOccurrences: number = 2
  ) {
    this.similarityThreshold = similarityThreshold;
    this.coReferenceMinOccurrences = coReferenceMinOccurrences;
  }

  /**
   * Rebuild the entire graph from an EmbeddingDocument.
   * Computes similarity edges, co-reference edges, and narrative flow.
   */
  rebuild(doc: EmbeddingDocument): void {
    this.edges = [];
    this.adjacency.clear();
    this.clusters = [];

    const nodes = doc.getOrderedNodes();
    if (nodes.length === 0) return;

    // 1. Similarity edges (pairwise cosine)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const sim = cosineSimilarity(nodes[i].embedding, nodes[j].embedding);
        if (sim >= this.similarityThreshold) {
          this.addEdge({
            source: nodes[i].id,
            target: nodes[j].id,
            type: 'similarity',
            weight: sim,
          });
        }
      }
    }

    // 2. Co-reference edges (shared entities)
    const entityNodes = new Map<string, string[]>();
    for (const node of nodes) {
      for (const entity of node.entities) {
        if (!entity.canonicalId) continue;
        const existing = entityNodes.get(entity.canonicalId) || [];
        if (!existing.includes(node.id)) {
          existing.push(node.id);
        }
        entityNodes.set(entity.canonicalId, existing);
      }
    }
    for (const [entityId, nodeIds] of entityNodes) {
      if (nodeIds.length < this.coReferenceMinOccurrences) continue;
      for (let i = 0; i < nodeIds.length; i++) {
        for (let j = i + 1; j < nodeIds.length; j++) {
          this.addEdge({
            source: nodeIds[i],
            target: nodeIds[j],
            type: 'co-reference',
            weight: 0.8,
            label: entityId,
          });
        }
      }
    }

    // 3. Narrative flow edges (sequential document order)
    for (let i = 0; i < nodes.length - 1; i++) {
      this.addEdge({
        source: nodes[i].id,
        target: nodes[i + 1].id,
        type: 'narrative-flow',
        weight: 0.5,
      });
    }

    // 4. Compute clusters
    this.computeClusters(nodes);
  }

  /**
   * Incrementally update the graph when a single node changes.
   * More efficient than full rebuild for single-node edits.
   */
  updateNode(doc: EmbeddingDocument, nodeId: string): void {
    // Remove existing edges for this node
    this.removeEdgesFor(nodeId);

    const node = doc.getNode(nodeId);
    if (!node) return;

    const nodes = doc.getOrderedNodes();

    // Recompute similarity edges for this node
    for (const other of nodes) {
      if (other.id === nodeId) continue;
      if (other.embedding.length === 0 || node.embedding.length === 0) continue;
      const sim = cosineSimilarity(node.embedding, other.embedding);
      if (sim >= this.similarityThreshold) {
        this.addEdge({
          source: node.id,
          target: other.id,
          type: 'similarity',
          weight: sim,
        });
      }
    }

    // Recompute co-reference edges
    for (const entity of node.entities) {
      if (!entity.canonicalId) continue;
      const relatedNodes = doc.findByEntity(entity.canonicalId);
      for (const related of relatedNodes) {
        if (related.id === nodeId) continue;
        this.addEdge({
          source: node.id,
          target: related.id,
          type: 'co-reference',
          weight: 0.8,
          label: entity.canonicalId,
        });
      }
    }

    // Recompute narrative flow edges
    const position = nodes.findIndex((n) => n.id === nodeId);
    if (position > 0) {
      this.addEdge({
        source: nodes[position - 1].id,
        target: nodeId,
        type: 'narrative-flow',
        weight: 0.5,
      });
    }
    if (position < nodes.length - 1) {
      this.addEdge({
        source: nodeId,
        target: nodes[position + 1].id,
        type: 'narrative-flow',
        weight: 0.5,
      });
    }
  }

  // ── Queries ───────────────────────────────────────────────────

  /** Get all edges for a node */
  getEdgesFor(nodeId: string): SemanticEdge[] {
    return this.adjacency.get(nodeId) || [];
  }

  /** Get nodes semantically related to a given node */
  getRelatedNodes(
    nodeId: string,
    edgeTypes?: EdgeType[]
  ): Array<{ nodeId: string; edge: SemanticEdge }> {
    const edges = this.getEdgesFor(nodeId);
    const filtered = edgeTypes
      ? edges.filter((e) => edgeTypes.includes(e.type))
      : edges;

    return filtered.map((edge) => ({
      nodeId: edge.source === nodeId ? edge.target : edge.source,
      edge,
    }));
  }

  /** Get all clusters */
  getClusters(): SemanticCluster[] {
    return [...this.clusters];
  }

  /** Get the cluster a node belongs to */
  getClusterFor(nodeId: string): SemanticCluster | undefined {
    return this.clusters.find((c) => c.nodeIds.includes(nodeId));
  }

  /** Get graph statistics */
  getStats(): GraphStats {
    const nodeIds = new Set<string>();
    for (const edge of this.edges) {
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }

    const nodeCount = nodeIds.size;
    const edgeCount = this.edges.length;
    const maxEdges = (nodeCount * (nodeCount - 1)) / 2;

    return {
      nodeCount,
      edgeCount,
      clusterCount: this.clusters.length,
      avgDegree: nodeCount > 0 ? (2 * edgeCount) / nodeCount : 0,
      density: maxEdges > 0 ? edgeCount / maxEdges : 0,
    };
  }

  /** Get all edges */
  getAllEdges(): SemanticEdge[] {
    return [...this.edges];
  }

  // ── Private ───────────────────────────────────────────────────

  private addEdge(edge: SemanticEdge): void {
    // Prevent duplicate edges
    const existing = this.edges.find(
      (e) =>
        e.source === edge.source &&
        e.target === edge.target &&
        e.type === edge.type
    );
    if (existing) return;

    this.edges.push(edge);

    // Update adjacency list for both directions
    const sourceEdges = this.adjacency.get(edge.source) || [];
    sourceEdges.push(edge);
    this.adjacency.set(edge.source, sourceEdges);

    const targetEdges = this.adjacency.get(edge.target) || [];
    targetEdges.push(edge);
    this.adjacency.set(edge.target, targetEdges);
  }

  private removeEdgesFor(nodeId: string): void {
    this.edges = this.edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId
    );

    // Rebuild adjacency for affected nodes
    this.adjacency.delete(nodeId);
    for (const [id, edges] of this.adjacency) {
      const filtered = edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId
      );
      if (filtered.length === 0) {
        this.adjacency.delete(id);
      } else {
        this.adjacency.set(id, filtered);
      }
    }
  }

  /**
   * Simple agglomerative clustering based on similarity edges.
   * Groups nodes connected by high-similarity edges.
   */
  private computeClusters(nodes: EmbeddedNode[]): void {
    // Union-Find for clustering
    const parent = new Map<string, string>();
    for (const node of nodes) {
      parent.set(node.id, node.id);
    }

    function find(id: string): string {
      let root = id;
      let guard = 0;
      while (parent.get(root) !== root) {
        root = parent.get(root)!;
        if (++guard > parent.size) break; // Law 7: cycle guard
      }
      // Path compression
      let current = id;
      while (current !== root) {
        const next = parent.get(current)!;
        parent.set(current, root);
        current = next;
      }
      return root;
    }

    function union(a: string, b: string): void {
      parent.set(find(a), find(b));
    }

    // Union nodes connected by similarity edges
    const SIMILARITY_UNION_THRESHOLD = 4/5; // Law 6: discrete rational boundary for clustering
    for (const edge of this.edges) {
      if (edge.type === 'similarity' && edge.weight >= SIMILARITY_UNION_THRESHOLD) {
        union(edge.source, edge.target);
      }
    }

    // Group nodes by cluster root
    const groups = new Map<string, string[]>();
    for (const node of nodes) {
      const root = find(node.id);
      const group = groups.get(root) || [];
      group.push(node.id);
      groups.set(root, group);
    }

    // Build cluster objects (skip singletons)
    this.clusters = [];
    let clusterId = 0;
    for (const [, nodeIds] of groups) {
      if (nodeIds.length < 2) continue;

      // Compute centroid
      const dim = 384;
      const centroid = new Float32Array(dim);
      let count = 0;
      for (const nodeId of nodeIds) {
        const node = nodes.find((n) => n.id === nodeId);
        if (!node || node.embedding.length === 0) continue;
        for (let d = 0; d < dim; d++) {
          centroid[d] += node.embedding[d];
        }
        count++;
      }
      if (count > 0) {
        for (let d = 0; d < dim; d++) {
          centroid[d] /= count;
        }
      }

      // Dominant topic from nodes
      const topicCounts = new Map<string, number>();
      for (const nodeId of nodeIds) {
        const node = nodes.find((n) => n.id === nodeId);
        if (!node?.classification.topic) continue;
        topicCounts.set(
          node.classification.topic,
          (topicCounts.get(node.classification.topic) || 0) + 1
        );
      }
      let dominantTopic = '';
      let maxCount = 0;
      for (const [topic, count] of topicCounts) {
        if (count > maxCount) {
          dominantTopic = topic;
          maxCount = count;
        }
      }

      this.clusters.push({
        id: `cluster-${clusterId++}`,
        nodeIds,
        centroid,
        topic: dominantTopic,
      });
    }
  }
}
