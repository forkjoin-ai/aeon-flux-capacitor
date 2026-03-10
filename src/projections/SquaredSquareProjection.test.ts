import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SquaredSquareProjection,
  type TilingConfig,
  type TilableBlock,
  type AspectRatio,
} from './SquaredSquareProjection';

// ── Helpers ─────────────────────────────────────────────────────────

function makeBlock(
  id: string,
  value: number,
  embedding?: number[]
): TilableBlock {
  return {
    id,
    text: `Block ${id}`,
    value,
    embedding: embedding ? new Float32Array(embedding) : undefined,
  };
}

function makeConfig(overrides?: Partial<TilingConfig>): TilingConfig {
  return {
    container: 'body',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('SquaredSquareProjection', () => {
  let projection: SquaredSquareProjection;

  beforeEach(() => {
    projection = new SquaredSquareProjection(makeConfig());
  });

  describe('construction', () => {
    it('creates with default config', () => {
      expect(projection.getAspectRatio()).toEqual({ w: 1, h: 1 });
      expect(projection.getZoomDepth()).toBe(0);
      expect(projection.getZoomStack()).toEqual([]);
    });

    it('accepts custom aspect ratio', () => {
      const proj = new SquaredSquareProjection(
        makeConfig({ aspectRatio: '2:1' })
      );
      expect(proj.getAspectRatio()).toEqual({ w: 2, h: 1 });
    });

    it('accepts custom aspect ratio object', () => {
      const proj = new SquaredSquareProjection(
        makeConfig({ aspectRatio: { w: 16, h: 9 } })
      );
      expect(proj.getAspectRatio()).toEqual({ w: 16, h: 9 });
    });
  });

  describe('projectBlocks', () => {
    it('tiles multiple blocks with no overlap', () => {
      const blocks = [
        makeBlock('a', 10),
        makeBlock('b', 5),
        makeBlock('c', 3),
        makeBlock('d', 1),
      ];

      const result = projection.projectBlocks(blocks);

      expect(result.tiles.length).toBe(4);
      expect(result.utilization).toBeGreaterThan(0);
      expect(result.zoomDepth).toBe(0);

      // Verify no overlap: brute-force check all pairs
      for (let i = 0; i < result.tiles.length; i++) {
        for (let j = i + 1; j < result.tiles.length; j++) {
          const a = result.tiles[i];
          const b = result.tiles[j];
          const overlapX = a.x < b.x + b.size && a.x + a.size > b.x;
          const overlapY = a.y < b.y + b.size && a.y + a.size > b.y;
          expect(overlapX && overlapY).toBe(false);
        }
      }
    });

    it('produces empty result for empty input', () => {
      const result = projection.projectBlocks([]);
      expect(result.tiles).toEqual([]);
      expect(result.containerWidth).toBe(0);
      expect(result.containerHeight).toBe(0);
      expect(result.utilization).toBe(0);
    });

    it('single block fills available space', () => {
      const result = projection.projectBlocks([makeBlock('solo', 10)]);
      expect(result.tiles.length).toBe(1);
      expect(result.tiles[0].blockId).toBe('solo');
      expect(result.tiles[0].x).toBe(0);
      expect(result.tiles[0].y).toBe(0);
    });

    it('assigns colors to each tile', () => {
      const result = projection.projectBlocks([
        makeBlock('a', 10),
        makeBlock('b', 5),
      ]);

      for (const tile of result.tiles) {
        expect(tile.color).toBeTruthy();
        expect(tile.color.startsWith('hsl')).toBe(true);
      }
    });

    it('higher-value blocks get larger tiles', () => {
      const result = projection.projectBlocks([
        makeBlock('big', 100),
        makeBlock('small', 1),
      ]);

      const big = result.tiles.find((t) => t.blockId === 'big')!;
      const small = result.tiles.find((t) => t.blockId === 'small')!;
      expect(big.area).toBeGreaterThan(small.area);
    });
  });

  describe('aspect ratios', () => {
    const ratios: AspectRatio[] = ['1:1', '1:2', '1:3', '2:1', '3:1'];

    for (const ratio of ratios) {
      it(`tiles correctly with ${ratio} aspect ratio`, () => {
        const proj = new SquaredSquareProjection(
          makeConfig({ aspectRatio: ratio })
        );
        const blocks = [
          makeBlock('a', 10),
          makeBlock('b', 7),
          makeBlock('c', 4),
        ];

        const result = proj.projectBlocks(blocks);
        expect(result.tiles.length).toBe(3);
        expect(result.containerWidth).toBeGreaterThan(0);
        expect(result.containerHeight).toBeGreaterThan(0);
      });
    }

    it('can update aspect ratio dynamically', () => {
      projection.projectBlocks([makeBlock('a', 10), makeBlock('b', 5)]);
      const original = projection.getAspectRatio();

      const newResult = projection.setAspectRatio('3:1');
      const updated = projection.getAspectRatio();

      expect(original).toEqual({ w: 1, h: 1 });
      expect(updated).toEqual({ w: 3, h: 1 });
      expect(newResult.tiles.length).toBe(2);
    });
  });

  describe('zoom (recursive tiling)', () => {
    it('zooms into a block with an embedding', () => {
      const blocks = [
        makeBlock(
          'parent',
          10,
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
        ),
      ];

      projection.projectBlocks(blocks);
      const result = projection.zoomInto('parent');

      expect(result).not.toBeNull();
      expect(result!.zoomDepth).toBe(1);
      expect(result!.tiles.length).toBeGreaterThan(0);

      // Sub-tiles should reference parent
      for (const tile of result!.tiles) {
        expect(tile.blockId.startsWith('parent:')).toBe(true);
      }
    });

    it('returns null when zooming into block without embedding', () => {
      projection.projectBlocks([makeBlock('no-embed', 10)]);
      const result = projection.zoomInto('no-embed');
      expect(result).toBeNull();
    });

    it('returns null when at max zoom depth', () => {
      const proj = new SquaredSquareProjection(makeConfig({ maxZoomDepth: 1 }));
      const blocks = [
        makeBlock(
          'p',
          10,
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
        ),
      ];

      proj.projectBlocks(blocks);
      proj.zoomInto('p'); // depth 1
      const result = proj.zoomInto('p:dim-0'); // depth 2 → denied
      expect(result).toBeNull();
    });

    it('zoom out pops the stack', () => {
      const blocks = [
        makeBlock(
          'p',
          10,
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
        ),
      ];

      projection.projectBlocks(blocks);
      projection.zoomInto('p');
      expect(projection.getZoomDepth()).toBe(1);

      projection.zoomOut();
      expect(projection.getZoomDepth()).toBe(0);
    });

    it('zoom out returns null at root', () => {
      expect(projection.zoomOut()).toBeNull();
    });

    it('resetZoom returns to root from any depth', () => {
      const blocks = [
        makeBlock(
          'p',
          10,
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
        ),
      ];

      projection.projectBlocks(blocks);
      projection.zoomInto('p');
      expect(projection.getZoomDepth()).toBe(1);

      projection.resetZoom();
      expect(projection.getZoomDepth()).toBe(0);
      expect(projection.getZoomStack()).toEqual([]);
    });

    it('fires onZoomChange callback', () => {
      const onZoom = vi.fn();
      const proj = new SquaredSquareProjection(
        makeConfig({ onZoomChange: onZoom })
      );
      const blocks = [makeBlock('p', 10, [1, 2, 3, 4, 5, 6, 7, 8])];

      proj.projectBlocks(blocks);
      proj.zoomInto('p');

      expect(onZoom).toHaveBeenCalledWith(1, ['p']);
    });
  });

  describe('events', () => {
    it('onChange fires on projectBlocks', () => {
      const listener = vi.fn();
      projection.onChange(listener);
      projection.projectBlocks([makeBlock('a', 10)]);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe prevents future calls', () => {
      const listener = vi.fn();
      const unsub = projection.onChange(listener);
      unsub();
      projection.projectBlocks([makeBlock('a', 10)]);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('getters', () => {
    it('getTiles returns placed tiles', () => {
      projection.projectBlocks([makeBlock('a', 10)]);
      const tiles = projection.getTiles();
      expect(tiles.length).toBe(1);
    });

    it('getLastResult returns last result', () => {
      expect(projection.getLastResult()).toBeNull();
      projection.projectBlocks([makeBlock('a', 10)]);
      expect(projection.getLastResult()).not.toBeNull();
    });
  });

  describe('destroy', () => {
    it('clears all state', () => {
      projection.projectBlocks([makeBlock('a', 10)]);
      projection.destroy();
      expect(projection.getTiles()).toEqual([]);
      expect(projection.getLastResult()).toBeNull();
      expect(projection.getZoomStack()).toEqual([]);
    });
  });

  describe('custom colorFn', () => {
    it('uses provided color function', () => {
      const proj = new SquaredSquareProjection(
        makeConfig({
          colorFn: (id, _v) => `color-${id}`,
        })
      );

      const result = proj.projectBlocks([makeBlock('x', 10)]);
      expect(result.tiles[0].color).toBe('color-x');
    });
  });
});
