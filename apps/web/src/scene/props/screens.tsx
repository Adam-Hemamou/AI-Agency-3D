import { getMaterial, screenMaterial } from '../materials';
import type { ScreenContent } from './catalog';
import { Panel } from './primitives';

/**
 * Contenu stylisé d'un écran (icônes simples, sans texte), dessiné sur un plan
 * de largeur w et hauteur h, centré à l'origine et tourné vers +z.
 */

const BG: Record<ScreenContent, string> = {
  play: '#1f2a36',
  thumbnails: '#1c2430',
  chart: '#f4f7fb',
  barChart: '#1d2738',
  worldMap: '#173a5e',
  wave: '#1b1730',
  mail: '#fdf7e4',
  inbox: '#fbf3dc',
  doc: '#ffffff',
  kanban: '#f3f6f2',
  phone: '#eaf5ea',
};

const Z = 0.002;

function Icon({
  content,
  w,
  h,
  accent,
}: {
  content: ScreenContent;
  w: number;
  h: number;
  accent: string;
}) {
  const a = screenMaterial(accent);
  const soft = getMaterial('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.4 });
  const dim = getMaterial('#9aa4b2', { emissive: '#9aa4b2', emissiveIntensity: 0.3 });

  switch (content) {
    case 'play':
      return (
        <mesh position={[0, 0, Z]} rotation={[0, 0, -Math.PI / 2]} material={a}>
          <circleGeometry args={[Math.min(w, h) * 0.22, 3]} />
        </mesh>
      );
    case 'thumbnails': {
      const cols = 4;
      const rows = 2;
      const cw = (w * 0.86) / cols;
      const ch = (h * 0.7) / rows;
      const colors = [
        accent,
        '#f4a261',
        '#e9c46a',
        '#8ecae6',
        '#ffb4a2',
        '#90be6d',
        accent,
        '#cdb4db',
      ];
      return (
        <>
          {Array.from({ length: cols * rows }, (_, i) => (
            <Panel
              key={i}
              size={[cw * 0.82, ch * 0.78]}
              position={[
                -w * 0.43 + cw * ((i % cols) + 0.5),
                h * 0.35 - ch * (Math.floor(i / cols) + 0.5),
                Z,
              ]}
              material={screenMaterial(colors[i] ?? accent)}
            />
          ))}
        </>
      );
    }
    case 'chart':
    case 'barChart': {
      const heights = [0.35, 0.55, 0.45, 0.75, 0.62];
      const bw = (w * 0.7) / heights.length;
      return (
        <>
          {heights.map((v, i) => (
            <Panel
              key={i}
              size={[bw * 0.7, h * 0.7 * v]}
              position={[-w * 0.35 + bw * (i + 0.5), -h * 0.35 + (h * 0.7 * v) / 2, Z]}
              material={i === heights.length - 2 ? a : content === 'chart' ? dim : soft}
            />
          ))}
        </>
      );
    }
    case 'worldMap': {
      const blobs: [number, number, number][] = [
        [-0.3, 0.12, 0.13],
        [-0.22, -0.18, 0.09],
        [0.02, 0.15, 0.1],
        [0.05, -0.08, 0.1],
        [0.28, 0.1, 0.14],
        [0.33, -0.25, 0.07],
      ];
      return (
        <>
          {blobs.map(([x, y, r], i) => (
            <mesh key={i} position={[x * w, y * h, Z]} material={screenMaterial('#7fc8a9')}>
              <circleGeometry args={[r * Math.min(w, h * 2), 6]} />
            </mesh>
          ))}
          {[-0.28, 0.04, 0.3].map((x, i) => (
            <mesh key={`pin${i}`} position={[x * w, 0.05 * h, Z * 2]} material={a}>
              <circleGeometry args={[0.025 * w, 6]} />
            </mesh>
          ))}
        </>
      );
    }
    case 'wave': {
      const bars = [0.2, 0.5, 0.8, 0.45, 0.9, 0.6, 0.3, 0.7, 0.4, 0.2];
      const bw = (w * 0.8) / bars.length;
      return (
        <>
          {bars.map((v, i) => (
            <Panel
              key={i}
              size={[bw * 0.6, h * 0.7 * v]}
              position={[-w * 0.4 + bw * (i + 0.5), 0, Z]}
              material={a}
            />
          ))}
        </>
      );
    }
    case 'mail':
    case 'inbox': {
      const ew = w * (content === 'mail' ? 0.5 : 0.32);
      const eh = ew * 0.62;
      const envelopes =
        content === 'mail'
          ? [[0, 0]]
          : [
              [-0.25, 0.12],
              [0.08, 0.12],
              [-0.08, -0.2],
              [0.25, -0.2],
            ];
      return (
        <>
          {envelopes.map(([x = 0, y = 0], i) => (
            <group key={i} position={[x * w, y * h, Z]}>
              <Panel size={[ew, eh]} material={i === 0 ? a : soft} />
              <mesh
                position={[0, eh * 0.18, Z]}
                rotation={[0, 0, Math.PI]}
                material={getMaterial('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.6 })}
              >
                <circleGeometry args={[ew * 0.45, 3, Math.PI / 2]} />
              </mesh>
            </group>
          ))}
        </>
      );
    }
    case 'doc':
      return (
        <>
          <Panel size={[w * 0.5, h * 0.08]} position={[-w * 0.12, h * 0.3, Z]} material={a} />
          {[0.12, -0.02, -0.16, -0.3].map((y, i) => (
            <Panel
              key={i}
              size={[w * (i === 3 ? 0.45 : 0.74), h * 0.05]}
              position={[i === 3 ? -w * 0.14 : 0, y * h, Z]}
              material={dim}
            />
          ))}
        </>
      );
    case 'kanban': {
      const colors = ['#f6bd60', '#84a59d', '#f28482'];
      return (
        <>
          {colors.map((c, col) =>
            Array.from({ length: 3 - col }, (_, n) => (
              <Panel
                key={`${col}-${n}`}
                size={[w * 0.24, h * 0.18]}
                position={[-w * 0.3 + col * w * 0.3, h * 0.28 - n * h * 0.25, Z]}
                material={screenMaterial(c)}
              />
            )),
          )}
        </>
      );
    }
    case 'phone':
      return (
        <>
          <mesh position={[0, h * 0.05, Z]} material={a}>
            <circleGeometry args={[Math.min(w, h) * 0.26, 16]} />
          </mesh>
          <Panel size={[w * 0.6, h * 0.08]} position={[0, -h * 0.34, Z]} material={dim} />
        </>
      );
  }
}

export function ScreenDisplay({
  content,
  width,
  height,
  accent,
}: {
  content: ScreenContent;
  width: number;
  height: number;
  accent: string;
}) {
  return (
    <group>
      <Panel size={[width, height]} material={screenMaterial(BG[content])} />
      <Icon content={content} w={width} h={height} accent={accent} />
    </group>
  );
}
