/**
 * SpatialProjection — Embeddings projected as 3D space
 *
 * Text is one projection surface. 3D space is another.
 * Same embedding vectors, Three.js renderer.
 *
 * Maps embedding dimensions to spatial coordinates:
 *   - PCA reduction → x, y, z position
 *   - Semantic similarity → edge connections (glowing lines)
 *   - Sentiment → color (warm ↔ cool)
 *   - Confidence → opacity/size
 *   - Entity type → geometry
 *   - Cluster membership → spatial proximity
 *
 * Navigate the document by flying through meaning-space.
 * Click a node to jump to that block in the text editor.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ── Types ───────────────────────────────────────────────────────────

export interface SpatialProjectionConfig {
  /** Container element or CSS selector */
  readonly container: HTMLElement | string;
  /** Background color (default: 0x0a0c14) */
  readonly backgroundColor?: number;
  /** Camera field of view (default: 60) */
  readonly fov?: number;
  /** Whether to show semantic edges (default: true) */
  readonly showEdges?: boolean;
  /** Edge opacity 0-1 (default: 0.15) */
  readonly edgeOpacity?: number;
  /** Node base size (default: 0.3) */
  readonly nodeSize?: number;
  /** Whether to auto-rotate the scene (default: true) */
  readonly autoRotate?: boolean;
  /** Rotation speed (default: 0.3) */
  readonly rotateSpeed?: number;
  /** Whether to show text labels (default: true) */
  readonly showLabels?: boolean;
  /** Max label character length (default: 30) */
  readonly maxLabelLength?: number;
  /** Click handler when a node is clicked */
  readonly onNodeClick?: (blockId: string) => void;
  /** Hover handler when a node is hovered */
  readonly onNodeHover?: (blockId: string | null) => void;
}

/** A node in 3D space */
export interface SpatialNode {
  readonly blockId: string;
  readonly position: [number, number, number];
  readonly color: number;
  readonly size: number;
  readonly opacity: number;
  readonly label: string;
  readonly shape: NodeShape;
  readonly clusterId?: string;
}

/** An edge between two nodes */
export interface SpatialEdge {
  readonly from: string;
  readonly to: string;
  readonly strength: number;
  readonly color: number;
  readonly type: 'similarity' | 'coref' | 'flow';
}

export type NodeShape =
  | 'sphere'
  | 'cube'
  | 'tetrahedron'
  | 'torus'
  | 'octahedron'
  | 'diamond';

/** Block data fed into the projection */
export interface ProjectableBlock {
  readonly id: string;
  readonly embedding: Float32Array;
  readonly text: string;
  readonly classification: {
    sentiment: number;
    topic: string;
    confidence: number;
  };
  readonly entities: Array<{ type: string }>;
}

/** Semantic edge data fed into the projection */
export interface ProjectableEdge {
  readonly sourceId: string;
  readonly targetId: string;
  readonly weight: number;
  readonly type: 'similarity' | 'coref' | 'flow';
}

// ── Resolved config with defaults applied ───────────────────────────

interface ResolvedConfig {
  readonly container: HTMLElement | string;
  readonly backgroundColor: number;
  readonly fov: number;
  readonly showEdges: boolean;
  readonly edgeOpacity: number;
  readonly nodeSize: number;
  readonly autoRotate: boolean;
  readonly rotateSpeed: number;
  readonly showLabels: boolean;
  readonly maxLabelLength: number;
  readonly onNodeClick: (blockId: string) => void;
  readonly onNodeHover: (blockId: string | null) => void;
}

// ── Geometry Cache ──────────────────────────────────────────────────

interface GeometrySet {
  sphere: THREE.SphereGeometry;
  cube: THREE.BoxGeometry;
  tetrahedron: THREE.TetrahedronGeometry;
  torus: THREE.TorusGeometry;
  octahedron: THREE.OctahedronGeometry;
  diamond: THREE.OctahedronGeometry;
}

// ── Spatial Projection Engine ───────────────────────────────────────

export class SpatialProjection {
  private config: ResolvedConfig;
  private nodes: Map<string, SpatialNode> = new Map();
  private edges: SpatialEdge[] = [];
  private animationId: number | null = null;

  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private controls: OrbitControls | null = null;
  private nodeMeshes: Map<
    string,
    THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  > = new Map();
  private edgeLines: THREE.Line<
    THREE.BufferGeometry,
    THREE.LineBasicMaterial
  >[] = [];
  private raycaster: THREE.Raycaster;
  private mouseNdc: THREE.Vector2 = new THREE.Vector2();
  private geometries: GeometrySet | null = null;
  private containerEl: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private hoveredId: string | null = null;

  constructor(config: SpatialProjectionConfig) {
    this.config = {
      container: config.container,
      backgroundColor: config.backgroundColor ?? 0x0a0c14,
      fov: config.fov ?? 60,
      showEdges: config.showEdges ?? true,
      edgeOpacity: config.edgeOpacity ?? 0.15,
      nodeSize: config.nodeSize ?? 0.3,
      autoRotate: config.autoRotate ?? true,
      rotateSpeed: config.rotateSpeed ?? 0.3,
      showLabels: config.showLabels ?? true,
      maxLabelLength: config.maxLabelLength ?? 30,
      onNodeClick: config.onNodeClick ?? (() => {}),
      onNodeHover: config.onNodeHover ?? (() => {}),
    };

    this.raycaster = new THREE.Raycaster();
  }

  /**
   * Project document blocks into 3D space.
   * Reduces embeddings to 3 coordinates via variance-ordered PCA.
   */
  projectDocument(
    blocks: ProjectableBlock[],
    semanticEdges?: ProjectableEdge[]
  ): { nodes: SpatialNode[]; edges: SpatialEdge[] } {
    const positions = this.reduceToXYZ(blocks.map((b) => b.embedding));
    const maxLabel = this.config.maxLabelLength;

    const spatialNodes: SpatialNode[] = blocks.map((block, i) => {
      const entityTypes = new Set(block.entities.map((e) => e.type));

      const node: SpatialNode = {
        blockId: block.id,
        position: positions[i],
        color: this.sentimentToColor(block.classification.sentiment),
        size:
          this.config.nodeSize * (0.5 + block.classification.confidence * 0.5),
        opacity: 0.4 + block.classification.confidence * 0.6,
        label:
          block.text.length > maxLabel
            ? block.text.slice(0, maxLabel) + '…'
            : block.text,
        shape: this.entityTypeToShape(entityTypes),
      };

      this.nodes.set(block.id, node);
      return node;
    });

    const spatialEdges: SpatialEdge[] = (semanticEdges ?? []).map((edge) => ({
      from: edge.sourceId,
      to: edge.targetId,
      strength: edge.weight,
      color:
        edge.type === 'similarity'
          ? 0x6e56cf
          : edge.type === 'coref'
          ? 0x3b9aea
          : 0x4ade80,
      type: edge.type,
    }));

    this.edges = spatialEdges;
    return { nodes: spatialNodes, edges: spatialEdges };
  }

  /**
   * Initialize the Three.js scene, attach to DOM, and start rendering.
   */
  init(): void {
    this.containerEl =
      typeof this.config.container === 'string'
        ? (document.querySelector(this.config.container) as HTMLElement)
        : this.config.container;

    if (!this.containerEl) {
      throw new Error('SpatialProjection: container element not found');
    }

    const width = this.containerEl.clientWidth;
    const height = this.containerEl.clientHeight;

    // ── Scene ────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.config.backgroundColor);
    this.scene.fog = new THREE.FogExp2(this.config.backgroundColor, 0.02);

    // ── Camera ───────────────────────────────────────────────
    this.camera = new THREE.PerspectiveCamera(
      this.config.fov,
      width / height,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 30);

    // ── Renderer ─────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.containerEl.appendChild(this.renderer.domElement);

    // ── Controls ─────────────────────────────────────────────
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.autoRotate = this.config.autoRotate;
    this.controls.autoRotateSpeed = this.config.rotateSpeed;

    // ── Lighting ─────────────────────────────────────────────
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const pointLight = new THREE.PointLight(0x6e56cf, 1, 100);
    pointLight.position.set(10, 10, 10);
    this.scene.add(pointLight);

    const rimLight = new THREE.PointLight(0x3b9aea, 0.5, 80);
    rimLight.position.set(-10, -5, -10);
    this.scene.add(rimLight);

    // ── Shared geometries ────────────────────────────────────
    this.geometries = {
      sphere: new THREE.SphereGeometry(1, 32, 32),
      cube: new THREE.BoxGeometry(1.4, 1.4, 1.4),
      tetrahedron: new THREE.TetrahedronGeometry(1.2),
      torus: new THREE.TorusGeometry(0.8, 0.3, 16, 32),
      octahedron: new THREE.OctahedronGeometry(1.1),
      diamond: new THREE.OctahedronGeometry(1.0),
    };

    // ── Build meshes ─────────────────────────────────────────
    this.buildNodeMeshes();
    if (this.config.showEdges) this.buildEdgeLines();

    // ── Interaction ──────────────────────────────────────────
    this.containerEl.addEventListener('mousemove', this.handleMouseMove);
    this.containerEl.addEventListener('click', this.handleClick);

    // ── Responsive ───────────────────────────────────────────
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.containerEl);

    // ── Run ──────────────────────────────────────────────────
    this.animate();
  }

  /**
   * Update a node's position or visual properties at runtime.
   */
  updateNode(blockId: string, updates: Partial<SpatialNode>): void {
    const node = this.nodes.get(blockId);
    if (!node) return;

    const updated: SpatialNode = { ...node, ...updates };
    this.nodes.set(blockId, updated);

    const mesh = this.nodeMeshes.get(blockId);
    if (mesh && updates.position) {
      mesh.position.set(
        updates.position[0],
        updates.position[1],
        updates.position[2]
      );
    }
    if (mesh && updates.color !== undefined) {
      mesh.material.color.setHex(updates.color);
      mesh.material.emissive.setHex(updates.color);
    }
  }

  /**
   * Highlight a specific node (the currently edited block).
   */
  highlightNode(blockId: string | null): void {
    for (const [id, mesh] of this.nodeMeshes) {
      const isTarget = id === blockId;
      mesh.material.emissiveIntensity = isTarget ? 1.0 : 0.1;
      const node = this.nodes.get(id);
      if (node) {
        mesh.scale.setScalar(isTarget ? node.size * 1.5 : node.size);
      }
    }
  }

  /**
   * Add a node dynamically (e.g., when a new block is created).
   */
  addNode(block: ProjectableBlock): SpatialNode | null {
    if (!this.scene || !this.geometries) return null;

    const [existing] = this.reduceToXYZ([block.embedding]);
    const entityTypes = new Set(block.entities.map((e) => e.type));

    const node: SpatialNode = {
      blockId: block.id,
      position: existing,
      color: this.sentimentToColor(block.classification.sentiment),
      size:
        this.config.nodeSize * (0.5 + block.classification.confidence * 0.5),
      opacity: 0.4 + block.classification.confidence * 0.6,
      label: block.text.slice(0, this.config.maxLabelLength),
      shape: this.entityTypeToShape(entityTypes),
    };

    this.nodes.set(block.id, node);
    this.buildSingleMesh(node);
    return node;
  }

  /**
   * Remove a node.
   */
  removeNode(blockId: string): void {
    const mesh = this.nodeMeshes.get(blockId);
    if (mesh && this.scene) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.nodeMeshes.delete(blockId);
    this.nodes.delete(blockId);
  }

  /**
   * Clean up everything — DOM, GPU resources, listeners.
   */
  destroy(): void {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);

    // Remove listeners
    this.containerEl?.removeEventListener('mousemove', this.handleMouseMove);
    this.containerEl?.removeEventListener('click', this.handleClick);
    this.resizeObserver?.disconnect();

    // Dispose meshes
    for (const [, mesh] of this.nodeMeshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.nodeMeshes.clear();

    // Dispose edge lines
    for (const line of this.edgeLines) {
      line.geometry.dispose();
      line.material.dispose();
    }
    this.edgeLines = [];

    // Dispose shared geometries
    if (this.geometries) {
      (Object.values(this.geometries) as THREE.BufferGeometry[]).forEach((g) =>
        g.dispose()
      );
      this.geometries = null;
    }

    // Dispose renderer
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }

    this.controls?.dispose();

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
  }

  // ── Private: Dimensionality Reduction ─────────────────────────

  /**
   * Variance-ordered PCA projection from high dimensions to 3D.
   * Picks the 3 dimensions with greatest variance (most informative).
   * For production, swap in UMAP/t-SNE via WASM worker.
   */
  private reduceToXYZ(
    embeddings: Float32Array[]
  ): Array<[number, number, number]> {
    if (embeddings.length === 0) return [];
    const dim = embeddings[0].length;

    if (dim < 3) {
      return embeddings.map(
        (e) => [e[0] ?? 0, e[1] ?? 0, e[2] ?? 0] as [number, number, number]
      );
    }

    // Compute mean per dimension
    const mean = new Float32Array(dim);
    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) mean[i] += emb[i];
    }
    for (let i = 0; i < dim; i++) mean[i] /= embeddings.length;

    // Compute variance per dimension
    const variances = new Float32Array(dim);
    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) {
        const diff = emb[i] - mean[i];
        variances[i] += diff * diff;
      }
    }

    // Sort dimensions by variance descending, pick top 3
    const ranked = Array.from({ length: dim }, (_, i) => i);
    ranked.sort((a, b) => variances[b] - variances[a]);
    const axes: [number, number, number] = [ranked[0], ranked[1], ranked[2]];

    // Project onto these 3 axes, centered and scaled
    const spread = 15;
    return embeddings.map(
      (emb) =>
        [
          (emb[axes[0]] - mean[axes[0]]) * spread,
          (emb[axes[1]] - mean[axes[1]]) * spread,
          (emb[axes[2]] - mean[axes[2]]) * spread,
        ] as [number, number, number]
    );
  }

  // ── Private: Mapping Functions ────────────────────────────────

  private sentimentToColor(sentiment: number): number {
    if (sentiment > 0.2) return 0xf59e0b; // warm amber
    if (sentiment < -0.2) return 0x3b82f6; // cool blue
    return 0x8b5cf6; // neutral purple
  }

  private entityTypeToShape(types: Set<string>): NodeShape {
    if (types.has('person')) return 'sphere';
    if (types.has('organization')) return 'cube';
    if (types.has('location')) return 'diamond';
    if (types.has('event')) return 'tetrahedron';
    if (types.has('concept')) return 'octahedron';
    return 'sphere';
  }

  // ── Private: Mesh Construction ────────────────────────────────

  private buildNodeMeshes(): void {
    for (const [, node] of this.nodes) {
      this.buildSingleMesh(node);
    }
  }

  private buildSingleMesh(node: SpatialNode): void {
    if (!this.scene || !this.geometries) return;

    const geometry = this.geometries[node.shape];
    const material = new THREE.MeshStandardMaterial({
      color: node.color,
      emissive: node.color,
      emissiveIntensity: 0.1,
      transparent: true,
      opacity: node.opacity,
      roughness: 0.3,
      metalness: 0.7,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(node.position[0], node.position[1], node.position[2]);
    mesh.scale.setScalar(node.size);
    mesh.userData = { blockId: node.blockId };

    this.scene.add(mesh);
    this.nodeMeshes.set(node.blockId, mesh);
  }

  private buildEdgeLines(): void {
    if (!this.scene) return;

    for (const edge of this.edges) {
      const fromNode = this.nodes.get(edge.from);
      const toNode = this.nodes.get(edge.to);
      if (!fromNode || !toNode) continue;

      const points = [
        new THREE.Vector3(
          fromNode.position[0],
          fromNode.position[1],
          fromNode.position[2]
        ),
        new THREE.Vector3(
          toNode.position[0],
          toNode.position[1],
          toNode.position[2]
        ),
      ];

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: edge.color,
        transparent: true,
        opacity: this.config.edgeOpacity * edge.strength,
      });

      const line = new THREE.Line(geometry, material);
      this.scene.add(line);
      this.edgeLines.push(line);
    }
  }

  // ── Private: Interaction ──────────────────────────────────────

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.containerEl) return;
    const rect = this.containerEl.getBoundingClientRect();
    this.mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  };

  private handleClick = (): void => {
    const hitId = this.castRay();
    if (hitId) this.config.onNodeClick(hitId);
  };

  private castRay(): string | null {
    if (!this.camera) return null;

    this.raycaster.setFromCamera(this.mouseNdc, this.camera);
    const meshes = Array.from(this.nodeMeshes.values());
    const intersects = this.raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
      const hit = intersects[0].object as THREE.Mesh;
      return (hit.userData as { blockId: string }).blockId;
    }
    return null;
  }

  private handleResize = (): void => {
    if (!this.containerEl || !this.camera || !this.renderer) return;
    const w = this.containerEl.clientWidth;
    const h = this.containerEl.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  // ── Private: Render Loop ──────────────────────────────────────

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);

    const time = performance.now() * 0.001;

    // Subtle breathing animation
    for (const [id, mesh] of this.nodeMeshes) {
      const node = this.nodes.get(id);
      if (node) {
        const breathe = 1 + Math.sin(time + node.position[0]) * 0.03;
        mesh.scale.setScalar(node.size * breathe);
      }
    }

    // Hover detection
    const hitId = this.castRay();
    if (hitId !== this.hoveredId) {
      // Restore previous hover
      if (this.hoveredId) {
        const prevMesh = this.nodeMeshes.get(this.hoveredId);
        if (prevMesh) prevMesh.material.emissiveIntensity = 0.1;
      }
      // Highlight new hover
      if (hitId) {
        const mesh = this.nodeMeshes.get(hitId);
        if (mesh) mesh.material.emissiveIntensity = 0.5;
      }
      this.hoveredId = hitId;
      this.config.onNodeHover(hitId);
    }

    this.controls?.update();

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };
}
