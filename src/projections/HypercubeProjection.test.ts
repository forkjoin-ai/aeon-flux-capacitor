import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HypercubeProjection,
  type HypercubeConfig,
  type ProjectableBlock4D,
} from './HypercubeProjection';

// ── Helpers ─────────────────────────────────────────────────────────

function makeBlock(
  id: string,
  embedding: number[],
  sentiment = 0
): ProjectableBlock4D {
  return {
    id,
    text: `Block ${id}`,
    embedding: new Float32Array(embedding),
    sentiment,
  };
}

function makeConfig(overrides?: Partial<HypercubeConfig>): HypercubeConfig {
  return {
    container: 'body',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('HypercubeProjection', () => {
  let projection: HypercubeProjection;

  beforeEach(() => {
    projection = new HypercubeProjection(makeConfig());
  });

  describe('tesseract geometry', () => {
    it('has 16 vertices', () => {
      const geo = HypercubeProjection.getGeometry();
      expect(geo.vertexCount).toBe(16);
      expect(geo.vertices.length).toBe(16);
    });

    it('has 32 edges', () => {
      const geo = HypercubeProjection.getGeometry();
      expect(geo.edgeCount).toBe(32);
      expect(geo.edges.length).toBe(32);
    });

    it('vertices are all ±1 in 4 dimensions', () => {
      const geo = HypercubeProjection.getGeometry();
      for (const v of geo.vertices) {
        expect(v.length).toBe(4);
        for (const coord of v) {
          expect(Math.abs(coord)).toBe(1);
        }
      }
    });

    it('all vertices are unique', () => {
      const geo = HypercubeProjection.getGeometry();
      const keys = new Set(geo.vertices.map((v) => v.join(',')));
      expect(keys.size).toBe(16);
    });

    it('edges connect vertices differing in exactly 1 coordinate', () => {
      const geo = HypercubeProjection.getGeometry();
      for (const [i, j] of geo.edges) {
        let diff = 0;
        for (let d = 0; d < 4; d++) {
          if (geo.vertices[i][d] !== geo.vertices[j][d]) diff++;
        }
        expect(diff).toBe(1);
      }
    });

    it('each vertex connects to exactly 4 edges', () => {
      const geo = HypercubeProjection.getGeometry();
      const degree = new Array(16).fill(0);
      for (const [i, j] of geo.edges) {
        degree[i]++;
        degree[j]++;
      }
      for (const d of degree) {
        expect(d).toBe(4);
      }
    });
  });

  describe('projectDocument', () => {
    it('projects blocks into 4D coordinates', () => {
      const blocks = [
        makeBlock('a', [1, 0, 0, 0, 0, 0, 0, 0]),
        makeBlock('b', [0, 1, 0, 0, 0, 0, 0, 0]),
        makeBlock('c', [0, 0, 1, 0, 0, 0, 0, 0]),
      ];

      const { nodes, edges } = projection.projectDocument(blocks);

      expect(nodes.length).toBe(3);
      expect(edges.length).toBe(32); // tesseract wireframe

      for (const node of nodes) {
        expect(node.position4D.length).toBe(4);
        expect(node.projected3D.length).toBe(3);
        expect(node.cell).toBeGreaterThanOrEqual(0);
        expect(node.cell).toBeLessThan(8);
      }
    });

    it('returns empty for no blocks', () => {
      const { nodes, edges } = projection.projectDocument([]);
      expect(nodes).toEqual([]);
      expect(edges).toEqual([]);
    });

    it('assigns each node a cell (0-7)', () => {
      const blocks = Array.from({ length: 8 }, (_, i) => {
        const emb = new Array(8).fill(0);
        emb[i % 8] = 1;
        return makeBlock(`b${i}`, emb);
      });

      const { nodes } = projection.projectDocument(blocks);
      for (const node of nodes) {
        expect(node.cell).toBeGreaterThanOrEqual(0);
        expect(node.cell).toBeLessThan(8);
      }
    });

    it('stores nodes retrievable by getNode', () => {
      projection.projectDocument([makeBlock('x', [1, 2, 3, 4])]);
      const node = projection.getNode('x');
      expect(node).toBeDefined();
      expect(node!.blockId).toBe('x');
    });

    it('getNodes returns all nodes', () => {
      projection.projectDocument([
        makeBlock('a', [1, 0, 0, 0]),
        makeBlock('b', [0, 1, 0, 0]),
      ]);
      expect(projection.getNodes().length).toBe(2);
    });
  });

  describe('4D → 3D projection', () => {
    it('stereographic produces valid 3D points', () => {
      const proj = new HypercubeProjection(
        makeConfig({ projectionMethod: 'stereographic' })
      );
      const result = proj.project4Dto3D([1, 1, 1, 0], 0);
      expect(result.length).toBe(3);
      for (const v of result) {
        expect(isFinite(v)).toBe(true);
      }
    });

    it('orthographic drops W coordinate', () => {
      const proj = new HypercubeProjection(
        makeConfig({ projectionMethod: 'orthographic' })
      );
      const result = proj.project4Dto3D([1, 2, 3, 99], 0);
      expect(result).toEqual([1, 2, 3]);
    });

    it('rotation changes projected coordinates', () => {
      const p0 = projection.project4Dto3D([1, 0, 0, 1], 0);
      const p1 = projection.project4Dto3D([1, 0, 0, 1], Math.PI / 4);
      // At least one coordinate should differ
      const same = p0.every((v, i) => Math.abs(v - p1[i]) < 1e-10);
      expect(same).toBe(false);
    });
  });

  describe('PCA reduction', () => {
    it('reduces high-dimensional embeddings to 4D', () => {
      const embeddings = [
        new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]),
        new Float32Array([0, 1, 0, 0, 0, 0, 0, 0]),
        new Float32Array([0, 0, 1, 0, 0, 0, 0, 0]),
      ];

      const result = projection.reduceToXYZW(embeddings);
      expect(result.length).toBe(3);
      for (const point of result) {
        expect(point.length).toBe(4);
      }
    });

    it('passes through 4D or lower without reduction', () => {
      const embeddings = [new Float32Array([1, 2, 3, 4])];

      const result = projection.reduceToXYZW(embeddings);
      expect(result[0]).toEqual([1, 2, 3, 4]);
    });

    it('returns empty for no embeddings', () => {
      expect(projection.reduceToXYZW([])).toEqual([]);
    });
  });

  describe('rotation', () => {
    it('rotate increments internal angle', () => {
      projection.projectDocument([makeBlock('a', [1, 2, 3, 4])]);

      const before = projection.getNode('a')!.projected3D;
      projection.rotate(Math.PI / 2);
      const after = projection.getNode('a')!.projected3D;

      // Position should have changed
      const same = before.every((v, i) => Math.abs(v - after[i]) < 1e-10);
      expect(same).toBe(false);
    });

    it('setRotationPlane changes rotation behavior', () => {
      projection.setRotationPlane('yz');
      // Just verify it doesn't throw
      expect(() => projection.rotate(0.1)).not.toThrow();
    });
  });

  describe('events', () => {
    it('onChange fires on rotate', () => {
      const listener = vi.fn();
      projection.onChange(listener);
      projection.projectDocument([makeBlock('a', [1, 2, 3, 4])]);
      projection.rotate(0.1);

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('clears all state', () => {
      projection.projectDocument([makeBlock('a', [1, 2, 3, 4])]);
      projection.destroy();

      expect(projection.getNodes()).toEqual([]);
    });
  });
});
