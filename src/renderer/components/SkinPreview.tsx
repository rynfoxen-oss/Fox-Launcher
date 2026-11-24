import { useEffect, useRef, useState } from 'react';
import {
  Eye,
  Pause,
  Play,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  IdleAnimation,
  RotatingAnimation,
  SkinViewer,
  createOrbitControls,
  type PlayerObject,
  type SubAnimationHandle,
} from 'skinview3d';
import steveSkinUrl from '../assets/steve.png';
import type { SkinModel } from '../../shared/types';
import { IS_MAC } from '../theme';
import { useT } from '../i18n';
import { useApp } from '../store';

/**
 * The vanilla cape keeps waving while the player stands still. skinview3d's
 * IdleAnimation only nudges it by 0.01 rad, which reads as a frozen cape, so
 * this supplies the normal flutter on top of it.
 */
const CapeFlutterAnimation = (player: PlayerObject, time: number) => {
  player.cape.rotation.x = Math.sin(time * 2.1) * 0.11 + Math.PI * 0.06;
  player.cape.rotation.z = Math.sin(time * 1.3) * 0.035;
};

export function SkinPreview({
  skinUrl,
  capeUrl,
  model = 'steve',
  width = 260,
  height = 360,
  animate = false,
  showControls = false,
  showGrid = false,
  initialZoom = 0.82,
  showcase = false,
  className = '',
}: {
  skinUrl?: string;
  capeUrl?: string;
  model?: SkinModel;
  width?: number;
  height?: number;
  animate?: boolean;
  showControls?: boolean;
  showGrid?: boolean;
  initialZoom?: number;
  showcase?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);
  const rotationRef = useRef<SubAnimationHandle | null>(null);
  const controlsRef = useRef<ReturnType<typeof createOrbitControls> | null>(null);
  const repaintRef = useRef<(() => void) | null>(null);
  const [zoom, setZoom] = useState(initialZoom);
  const [textureUrl, setTextureUrl] = useState(skinUrl || steveSkinUrl);
  const [capeTextureUrl, setCapeTextureUrl] = useState('');
  const [spinning, setSpinning] = useState(animate);
  const [backView, setBackView] = useState(false);
  const [failed, setFailed] = useState(false);
  const t = useT();
  const animationsEnabled = useApp((state) => state.settings.appearance.animations);

  useEffect(() => setSpinning(animate && animationsEnabled), [animate, animationsEnabled]);

  // Load the texture before creating the viewer so the model never starts as
  // Steve and then swaps later. This also catches corrupt/missing textures.
  useEffect(() => {
    if (!skinUrl) {
      setTextureUrl(steveSkinUrl);
      return;
    }
    let active = true;
    const image = new Image();
    image.onload = () => { if (active) setTextureUrl(skinUrl); };
    image.onerror = () => {
      if (!active) return;
      console.warn('[SkinPreview] skin texture could not be loaded, using Steve');
      setTextureUrl(steveSkinUrl);
    };
    image.src = skinUrl;
    return () => { active = false; };
  }, [skinUrl]);

  // Cape textures are optional; a missing one must never break the skin preview.
  useEffect(() => {
    if (!capeUrl) {
      setCapeTextureUrl('');
      return;
    }
    let active = true;
    const image = new Image();
    image.onload = () => { if (active) setCapeTextureUrl(capeUrl); };
    image.onerror = () => {
      if (!active) return;
      console.warn('[SkinPreview] cape texture could not be loaded');
      setCapeTextureUrl('');
    };
    image.src = capeUrl;
    return () => { active = false; };
  }, [capeUrl]);

  useEffect(() => {
    setBackView(false);
    setZoom(initialZoom);
    if (viewerRef.current) viewerRef.current.playerObject.rotation.y = 0;
    if (rotationRef.current) rotationRef.current.progress = 0;
  }, [textureUrl, capeTextureUrl, model, initialZoom]);

  useEffect(() => {
    if (!canvasRef.current) return;
    let viewer: SkinViewer | null = null;
    let controls: ReturnType<typeof createOrbitControls> | null = null;
    const modelType = model === 'alex' ? 'slim' : 'default';
    try {
      viewer = new SkinViewer({
        canvas: canvasRef.current,
        width,
        height,
        model: modelType,
        // On Mac a static preview does not need a continuous RAF loop.
        renderPaused: IS_MAC,
      });
      // Load textures explicitly so a paused Mac preview is repainted once the
      // images are ready; passing them via options alone can leave a blank canvas.
      const loads: Promise<void>[] = [viewer.loadSkin(textureUrl, modelType)];
      if (capeTextureUrl) loads.push(viewer.loadCape(capeTextureUrl));
      void Promise.all(loads)
        .then(() => { if (viewer?.renderPaused) viewer.render(); })
        .catch(() => undefined);
      viewer.zoom = initialZoom;
      if (animationsEnabled) {
        viewer.animations.add(IdleAnimation);
        // Added after IdleAnimation so the stronger flutter wins the cape angle.
        if (capeTextureUrl) viewer.animations.add(CapeFlutterAnimation);
      }
      rotationRef.current = viewer.animations.add(RotatingAnimation);
      rotationRef.current.speed = 0.35;
      rotationRef.current.paused = !spinning;
      controls = createOrbitControls(viewer);
      controls.enableRotate = true;
      controls.enableZoom = true;
      controls.enablePan = false;
      controlsRef.current = controls;
      viewerRef.current = viewer;
      setFailed(false);

      // Paused rendering still needs to repaint after direct interaction.
      const repaint = () => {
        if (viewer?.renderPaused) viewer.render();
      };
      controls.addEventListener('change', repaint);
      canvasRef.current.addEventListener('wheel', repaint, { passive: true });
      repaintRef.current = repaint;
    } catch (error) {
      console.error('Skin preview failed:', error);
      setFailed(true);
    }
    return () => {
      const repaint = repaintRef.current;
      if (controls && repaint) controls.removeEventListener('change', repaint);
      if (canvasRef.current && repaint) canvasRef.current.removeEventListener('wheel', repaint);
      repaintRef.current = null;
      controlsRef.current?.dispose();
      controlsRef.current = null;
      rotationRef.current = null;
      viewerRef.current = null;
      viewer?.dispose();
    };
    // Viewer recreation is intentional when the texture or size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textureUrl, capeTextureUrl, model, width, height]);

  // Mac: only run the WebGL loop while the character is actually spinning and
  // the window is visible. Everything else is rendered once on demand.
  useEffect(() => {
    if (!IS_MAC) return;
    const update = () => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      // A waving cape needs the animation loop even when the model is still;
      // a cape-less static preview only renders on demand.
      const capeWaving = Boolean(capeTextureUrl) && animationsEnabled;
      const shouldPause = document.hidden || (!spinning && !capeWaving);
      viewer.renderPaused = shouldPause;
      if (shouldPause) viewer.render();
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [spinning, animationsEnabled, textureUrl, capeTextureUrl, model, width, height, zoom]);

  useEffect(() => {
    if (viewerRef.current) {
      viewerRef.current.zoom = zoom;
      if (viewerRef.current.renderPaused) viewerRef.current.render();
    }
  }, [zoom]);

  useEffect(() => {
    if (rotationRef.current) rotationRef.current.paused = !spinning;
  }, [spinning]);

  function setAngle(back: boolean) {
    setBackView(back);
    setSpinning(false);
    const angle = back ? Math.PI : 0;
    if (viewerRef.current) {
      viewerRef.current.playerObject.rotation.y = angle;
      if (viewerRef.current.renderPaused) viewerRef.current.render();
    }
    if (rotationRef.current) rotationRef.current.progress = angle;
  }

  function resetView() {
    setAngle(false);
    setZoom(initialZoom);
  }

  const fallbackUrl = textureUrl;

  return (
    <div
      className={`skin-preview-wrap ${showGrid ? 'skin-preview-grid' : ''} ${showcase ? 'skin-preview-showcase' : ''} ${className}`}
      style={{ width, height }}
    >
      <canvas ref={canvasRef} className="skin-preview" style={{ width, height, display: failed ? 'none' : 'block' }} />
      {failed && (
        <div className="skin-preview-fallback">
          <img src={fallbackUrl} alt="Skin texture" />
        </div>
      )}
      {showControls && (
        <div className="skin-preview-controls">
          <button onClick={() => setZoom((value) => Math.max(0.35, Number((value - 0.12).toFixed(2))))} title={t('zoomOut')}>
            <ZoomOut size={15} />
          </button>
          <button onClick={() => setZoom((value) => Math.min(1.6, Number((value + 0.12).toFixed(2))))} title={t('zoomIn')}>
            <ZoomIn size={15} />
          </button>
          <button onClick={resetView} title={t('resetView')}><RotateCcw size={15} /></button>
          <button onClick={() => setSpinning((value) => !value)} title={t('toggleRotation')}>
            {spinning ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button onClick={() => setAngle(!backView)} title={backView ? t('frontView') : t('backView')}>
            <Eye size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
