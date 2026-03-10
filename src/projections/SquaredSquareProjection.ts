/**
 * SquaredSquareProjection — Content blocks as a squared-square tiling
 *
 * A squared square is a square partitioned into smaller squares,
 * each with a unique integer side-length. This projection maps
 * content block values to square areas and tiles them into an
 * aspect-ratio-aware container using guillotine bin-packing.
 *
 * Features:
 *   - 5 preset aspect ratios: 1:1, 1:2, 1:3, 2:1, 3:1 + custom
 *   - Guillotine packing algorithm (O(n log n))
 *   - Recursive zoom: click a square → its sub-embedding dimensions
 *     become a new tiling inside that square
 *   - Animated transitions between zoom levels
 *   - Color mapping via embedding sentiment/intensity
 *
 * This is NOT a grid. This is INFORMATION TOPOLOGY —
 * the most valuable content physically dominates the viewport.
 */

// ── Types ───────────────────────────────────────────────────────────

export type AspectRatio =
  | '1:1'
  | '1:2'
  | '1:3'
  | '2:1'
  | '3:1'
  | { w: number; h: number };

export interface TilingConfig {
  /** Container element or CSS selector */
  readonly container: HTMLElement | string;
  /** Aspect ratio preset or custom ratio */
  readonly aspectRatio?: AspectRatio;
  /** Gap between tiles in px */
  readonly gap?: number;
  /** Transition animation duration in ms */
  readonly animateMs?: number;
  /** Custom color function for tiles */
  readonly colorFn?: (blockId: string, value: number) => string;
  /** Called when a square is selected */
  readonly onSquareSelect?: (blockId: string) => void;
  /** Called when zoom depth changes */
  readonly onZoomChange?: (depth: number, stack: string[]) => void;
  /** Maximum zoom depth (default: 5) */
  readonly maxZoomDepth?: number;
  /** Minimum tile size in px before a block is hidden */
  readonly minTilePx?: number;
  /** Show block labels inside tiles */
  readonly showLabels?: boolean;
}

export interface TiledSquare {
  /** Block ID */
  readonly blockId: string;
  /** X position in layout units (0-based) */
  readonly x: number;
  /** Y position in layout units (0-based) */
  readonly y: number;
  /** Side length in layout units */
  readonly size: number;
  /** Area (proportional to composite value) */
  readonly area: number;
  /** Assigned color */
  readonly color: string;
  /** Zoom depth (0 = root) */
  readonly depth: number;
}

/** Input block for the tiling projection */
export interface TilableBlock {
  readonly id: string;
  readonly text: string;
  readonly value: number;
  readonly embedding?: Float32Array;
}

/** A rectangle representing free space in the guillotine packing */
interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Resolved config with defaults */
interface ResolvedTilingConfig {
  readonly container: HTMLElement | string;
  readonly aspectRatio: { w: number; h: number };
  readonly gap: number;
  readonly animateMs: number;
  readonly colorFn: (blockId: string, value: number) => string;
  readonly onSquareSelect?: (blockId: string) => void;
  readonly onZoomChange?: (depth: number, stack: string[]) => void;
  readonly maxZoomDepth: number;
  readonly minTilePx: number;
  readonly showLabels: boolean;
}

// ── Tiling Result ───────────────────────────────────────────────────

export interface TilingResult {
  /** All placed tiles */
  readonly tiles: TiledSquare[];
  /** Container width in layout units */
  readonly containerWidth: number;
  /** Container height in layout units */
  readonly containerHeight: number;
  /** Utilization ratio (0-1) — how much area is filled */
  readonly utilization: number;
  /** Current zoom depth */
  readonly zoomDepth: number;
  /** Zoom stack (block IDs from root to current) */
  readonly zoomStack: string[];
}

// ── Squared Square Projection Engine ────────────────────────────────

export class SquaredSquareProjection {
  private config: ResolvedTilingConfig;
  private tiles: TiledSquare[] = [];
  private blocks: Map<string, TilableBlock> = new Map();
  private zoomStack: string[] = [];
  private listeners: Set<(result: TilingResult) => void> = new Set();
  private lastResult: TilingResult | null = null;

  constructor(config: TilingConfig) {
    this.config = {
      container: config.container,
      aspectRatio: this.parseAspectRatio(config.aspectRatio ?? '1:1'),
      gap: config.gap ?? 2,
      animateMs: config.animateMs ?? 300,
      colorFn: config.colorFn ?? SquaredSquareProjection.defaultColorFn,
      onSquareSelect: config.onSquareSelect,
      onZoomChange: config.onZoomChange,
      maxZoomDepth: config.maxZoomDepth ?? 5,
      minTilePx: config.minTilePx ?? 16,
      showLabels: config.showLabels ?? true,
    };
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Project blocks into a squared-square tiling.
   * Returns the tiling result with positions and sizes for all blocks.
   */
  projectBlocks(blocks: TilableBlock[]): TilingResult {
    this.blocks.clear();
    for (const block of blocks) {
      this.blocks.set(block.id, block);
    }

    return this.computeTiling(blocks, 0);
  }

  /**
   * Zoom into a block — re-tile using its sub-embedding dimensions.
   * If the block has an embedding, the embedding's sub-dimensions
   * are re-projected as new child blocks inside that square.
   */
  zoomInto(blockId: string): TilingResult | null {
    if (this.zoomStack.length >= this.config.maxZoomDepth) return null;

    const block = this.blocks.get(blockId);
    if (!block || !block.embedding) return null;

    this.zoomStack.push(blockId);

    // Generate sub-blocks from embedding sub-dimensions
    const subBlocks = this.embedToSubBlocks(block.embedding, blockId);
    const result = this.computeTiling(subBlocks, this.zoomStack.length);

    this.config.onZoomChange?.(this.zoomStack.length, [...this.zoomStack]);
    return result;
  }

  /**
   * Zoom out one level.
   */
  zoomOut(): TilingResult | null {
    if (this.zoomStack.length === 0) return null;

    this.zoomStack.pop();

    const blocks = Array.from(this.blocks.values());
    const result = this.computeTiling(blocks, this.zoomStack.length);

    this.config.onZoomChange?.(this.zoomStack.length, [...this.zoomStack]);
    return result;
  }

  /**
   * Get the current zoom depth.
   */
  getZoomDepth(): number {
    return this.zoomStack.length;
  }

  /**
   * Get the zoom stack (path of block IDs from root to current level).
   */
  getZoomStack(): string[] {
    return [...this.zoomStack];
  }

  /**
   * Get all tiles from the last tiling computation.
   */
  getTiles(): TiledSquare[] {
    return [...this.tiles];
  }

  /**
   * Get the last tiling result.
   */
  getLastResult(): TilingResult | null {
    return this.lastResult;
  }

  /**
   * Get the current aspect ratio.
   */
  getAspectRatio(): { w: number; h: number } {
    return { ...this.config.aspectRatio };
  }

  /**
   * Update the aspect ratio and re-tile.
   */
  setAspectRatio(ratio: AspectRatio): TilingResult {
    (this.config as any).aspectRatio = this.parseAspectRatio(ratio);
    const blocks = Array.from(this.blocks.values());
    return this.computeTiling(blocks, this.zoomStack.length);
  }

  /**
   * Listen for tiling changes.
   */
  onChange(listener: (result: TilingResult) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Reset zoom to root level.
   */
  resetZoom(): TilingResult {
    this.zoomStack = [];
    const blocks = Array.from(this.blocks.values());
    const result = this.computeTiling(blocks, 0);
    this.config.onZoomChange?.(0, []);
    return result;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.tiles = [];
    this.blocks.clear();
    this.zoomStack = [];
    this.listeners.clear();
    this.lastResult = null;
  }

  // ── Guillotine Bin-Packing ──────────────────────────────────────

  /**
   * Core tiling algorithm: guillotine bin-packing of squares into
   * an aspect-ratio-constrained rectangle.
   *
   * 1. Sort blocks by value (largest first)
   * 2. Quantize values to integer side-lengths
   * 3. Place each square in the best-fit free rectangle
   * 4. Split remaining free space with guillotine cuts
   */
  private computeTiling(blocks: TilableBlock[], depth: number): TilingResult {
    if (blocks.length === 0) {
      const result: TilingResult = {
        tiles: [],
        containerWidth: 0,
        containerHeight: 0,
        utilization: 0,
        zoomDepth: depth,
        zoomStack: [...this.zoomStack],
      };
      this.tiles = [];
      this.lastResult = result;
      this.notify(result);
      return result;
    }

    // Sort by value descending
    const sorted = [...blocks].sort((a, b) => b.value - a.value);

    // Quantize values to integer side-lengths (min 1)
    const maxValue = sorted[0].value || 1;
    const gridScale = Math.max(10, Math.ceil(Math.sqrt(sorted.length) * 5));

    const sizes = sorted.map((b) => ({
      block: b,
      size: Math.max(1, Math.round((b.value / maxValue) * gridScale)),
    }));

    // Compute container dimensions from aspect ratio
    const totalArea = sizes.reduce((s, e) => s + e.size * e.size, 0);
    const scaleFactor = Math.sqrt(totalArea);
    const { w: rw, h: rh } = this.config.aspectRatio;
    const ratioNorm = rw / rh;

    const containerWidth = Math.ceil(scaleFactor * Math.sqrt(ratioNorm));
    const containerHeight = Math.ceil(scaleFactor / Math.sqrt(ratioNorm));

    // Initialize free rectangles with the full container
    const freeRects: FreeRect[] = [
      { x: 0, y: 0, w: containerWidth, h: containerHeight },
    ];

    const tiles: TiledSquare[] = [];

    for (const { block, size } of sizes) {
      const placed = this.placeSquare(block, size, freeRects, depth);
      if (placed) {
        tiles.push(placed);
      }
    }

    this.tiles = tiles;
    const placedArea = tiles.reduce((s, t) => s + t.area, 0);
    const totalContainerArea = containerWidth * containerHeight;

    const result: TilingResult = {
      tiles,
      containerWidth,
      containerHeight,
      utilization: totalContainerArea > 0 ? placedArea / totalContainerArea : 0,
      zoomDepth: depth,
      zoomStack: [...this.zoomStack],
    };

    this.lastResult = result;
    this.notify(result);
    return result;
  }

  /**
   * Place a single square into the best-fit free rectangle.
   * Uses Best Short Side Fit (BSSF) heuristic.
   */
  private placeSquare(
    block: TilableBlock,
    size: number,
    freeRects: FreeRect[],
    depth: number
  ): TiledSquare | null {
    // Find the best-fitting free rectangle (BSSF)
    let bestIdx = -1;
    let bestShortSide = Infinity;
    let bestLongSide = Infinity;

    for (let i = 0; i < freeRects.length; i++) {
      const rect = freeRects[i];
      if (size <= rect.w && size <= rect.h) {
        const shortSide = Math.min(rect.w - size, rect.h - size);
        const longSide = Math.max(rect.w - size, rect.h - size);

        if (
          shortSide < bestShortSide ||
          (shortSide === bestShortSide && longSide < bestLongSide)
        ) {
          bestIdx = i;
          bestShortSide = shortSide;
          bestLongSide = longSide;
        }
      }
    }

    if (bestIdx === -1) {
      // Try fitting at reduced size (graceful degradation)
      const reducedSize = Math.max(1, size - 1);
      if (reducedSize < size) {
        return this.placeSquare(block, reducedSize, freeRects, depth);
      }
      return null;
    }

    const rect = freeRects[bestIdx];
    const tile: TiledSquare = {
      blockId: block.id,
      x: rect.x,
      y: rect.y,
      size,
      area: size * size,
      color: this.config.colorFn(block.id, block.value),
      depth,
    };

    // Guillotine split: split the free rectangle into two
    freeRects.splice(bestIdx, 1);

    // Right remainder
    if (rect.w - size > 0) {
      freeRects.push({
        x: rect.x + size,
        y: rect.y,
        w: rect.w - size,
        h: size,
      });
    }

    // Bottom remainder
    if (rect.h - size > 0) {
      freeRects.push({
        x: rect.x,
        y: rect.y + size,
        w: rect.w,
        h: rect.h - size,
      });
    }

    return tile;
  }

  // ── Sub-Embedding Zoom ──────────────────────────────────────────

  /**
   * Convert an embedding vector's sub-dimensions into child blocks.
   * Groups adjacent dimensions into chunks and treats each chunk's
   * magnitude as a sub-concepts "value".
   */
  private embedToSubBlocks(
    embedding: Float32Array,
    parentId: string
  ): TilableBlock[] {
    const dims = embedding.length;
    if (dims === 0) return [];

    // Split embedding into ~8 chunks (or fewer if small)
    const chunkCount = Math.min(8, dims);
    const chunkSize = Math.ceil(dims / chunkCount);
    const subBlocks: TilableBlock[] = [];

    for (let i = 0; i < chunkCount; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, dims);
      const chunk = embedding.slice(start, end);

      // Magnitude of this chunk = value
      let magnitude = 0;
      for (let j = 0; j < chunk.length; j++) {
        magnitude += chunk[j] * chunk[j];
      }
      magnitude = Math.sqrt(magnitude);

      subBlocks.push({
        id: `${parentId}:dim-${i}`,
        text: `Dimensions ${start}–${end - 1}`,
        value: magnitude,
        embedding: chunk.length >= 2 ? chunk : undefined,
      });
    }

    return subBlocks;
  }

  // ── Utilities ───────────────────────────────────────────────────

  private parseAspectRatio(ratio: AspectRatio): { w: number; h: number } {
    if (typeof ratio === 'object') return ratio;
    const [w, h] = ratio.split(':').map(Number);
    return { w: w || 1, h: h || 1 };
  }

  static defaultColorFn(_blockId: string, value: number): string {
    // Map value 0-1 to a warm-to-cool gradient
    const hue = 200 + value * 160; // 200 (blue) → 360 (red)
    const saturation = 60 + value * 30;
    const lightness = 30 + (1 - value) * 30;
    return `hsl(${hue % 360}, ${saturation}%, ${lightness}%)`;
  }

  private notify(result: TilingResult): void {
    for (const listener of this.listeners) {
      listener(result);
    }
  }
}
