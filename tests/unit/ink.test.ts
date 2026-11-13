import { describe, expect, it } from 'vitest';
import { quantize, simplify, touches, validInk, type Stroke } from '../../src/media/ink-core.ts';

const line = (n: number): number[] => {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) pts.push(0.1 + (0.8 * i) / (n - 1), 0.5 + Math.sin(i / 3) * 0.00005);
  return pts;
};

describe('ink', () => {
  it('a straight stroke keeps its two ends; a curve keeps its shape', () => {
    expect(simplify(line(200))).toHaveLength(4);
    const arc: number[] = [];
    for (let i = 0; i <= 100; i++)
      arc.push(0.5 + 0.3 * Math.cos((i / 100) * Math.PI), 0.5 + 0.3 * Math.sin((i / 100) * Math.PI));
    const s = simplify(arc);
    expect(s.length).toBeLessThan(arc.length / 2);
    expect(s.length).toBeGreaterThan(10);
  });

  it('points are kept to a tenth of a per mille, inside the page', () => {
    expect(quantize([0.123456, 1.2, -0.1])).toEqual([0.1235, 1, 0]);
  });

  it('the eraser takes what it touches, not what is near', () => {
    const s: Stroke = {
      id: 'a',
      by: 'x',
      page: 0,
      tool: 'pen',
      color: '#000000',
      width: 0.003,
      pts: [0.1, 0.5, 0.9, 0.5],
    };
    expect(touches(s, 0.5, 0.505, 0.01)).toBe(true);
    expect(touches(s, 0.5, 0.56, 0.01)).toBe(false);
    // on a tall page, a vertical distance counts for more (measured in page widths)
    expect(touches(s, 0.5, 0.51, 0.01, 1.414)).toBe(false);
  });

  it('only well-formed ink comes in', () => {
    expect(validInk({ id: 'a', by: 'b', page: 0, pts: [0.1, 0.2, 0.3], color: '#fff' })).toBeNull();
    expect(validInk({ id: 'a', by: 'b', page: -1, pts: [0.1, 0.2] })).toBeNull();
    const k = validInk({
      id: 'a',
      by: 'b',
      page: 2,
      pts: [0.1, 0.2],
      color: 'red',
      tool: 'marker',
      width: 9,
    }) as Stroke;
    expect(k).toMatchObject({ tool: 'marker', width: 0.05, color: '#e5484d' });
    expect(
      validInk({ kind: 'text', id: 't', by: 'b', page: 0, x: 0.2, y: 0.3, text: 'rit.', color: '#2f6fed' }),
    ).toMatchObject({
      kind: 'text',
      text: 'rit.',
    });
  });
});
