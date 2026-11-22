import { useEffect, useRef, useState } from 'react';
import {
  Eye,
  Pause,
  Play,
  RotateCcw,
  Shirt,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  IdleAnimation,
  RotatingAnimation,
  SkinViewer,
  createOrbitControls,
  type SubAnimationHandle,
} from 'skinview3d';
import steveSkinUrl from '../assets/steve.png';
import type { SkinModel } from '../../shared/types';
import { useT } from '../i18n';

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
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);
  const rotationRef = useRef<SubAnimationHandle | null>(null);
  const controlsRef = useRef<ReturnType<typeof createOrbitControls> | null>(null);
  const [zoom, setZoom] = useState(initialZoom);
  const [textureUrl, setTextureUrl] = useState(skinUrl || steveSkinUrl);
  const [spinning, setSpinning] = useState(animate);
  const [capeVisible, setCapeVisible] = useState(Boolean(capeUrl));
  const [backView, setBackView] = useState(false);
  const [failed, setFailed] = useState(false);
  const t = useT();

  useEffect(() => setSpinning(animate), [animate]);

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

  useEffect(() => {
    setCapeVisible(Boolean(capeUrl));
    setBackView(false);
    setZoom(initialZoom);
  }, [capeUrl, textureUrl, model, initialZoom]);

  useEffect(() => {
    if (!canvasRef.current) return;
    let viewer: SkinViewer | null = null;
    const modelType = model === 'alex' ? 'slim' : 'default';
    try {
      viewer = new SkinViewer({
        canvas: canvasRef.current,
        width,
        height,
        model: modelType,
        skin: textureUrl,
        cape: capeUrl,
      });
      viewer.zoom = initialZoom;
      viewer.animations.add(IdleAnimation);
      rotationRef.current = viewer.animations.add(RotatingAnimation);
      rotationRef.current.paused = !spinning;
      const controls = createOrbitControls(viewer);
      controls.enableRotate = true;
      controls.enableZoom = true;
      controls.enablePan = false;
      controlsRef.current = controls;
      viewerRef.current = viewer;
      setFailed(false);
    } catch (error) {
      console.error('Skin preview failed:', error);
      setFailed(true);
    }
    return () => {
      controlsRef.current?.dispose();
      controlsRef.current = null;
      rotationRef.current = null;
      viewerRef.current = null;
      viewer?.dispose();
    };
    // Viewer recreation is intentional when the texture or size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textureUrl, capeUrl, model, width, height]);

  useEffect(() => {
    if (viewerRef.current) viewerRef.current.zoom = zoom;
  }, [zoom]);

  useEffect(() => {
    if (rotationRef.current) rotationRef.current.paused = !spinning;
  }, [spinning]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    try {
      if (capeVisible && capeUrl) void viewer.loadCape(capeUrl).catch(() => undefined);
      else viewer.loadCape(null);
    } catch {
      viewer.loadCape(null);
    }
  }, [capeVisible, capeUrl]);

  function setAngle(back: boolean) {
    setBackView(back);
    setSpinning(false);
    if (viewerRef.current) viewerRef.current.playerWrapper.rotation.y = back ? Math.PI : 0;
  }

  function resetView() {
    setAngle(false);
    setZoom(initialZoom);
  }

  const fallbackUrl = textureUrl;

  return (
    <div
      className={`skin-preview-wrap ${showGrid ? 'skin-preview-grid' : ''} ${className}`}
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
          {capeUrl && (
            <button className={capeVisible ? 'active' : ''} onClick={() => setCapeVisible((value) => !value)} title={t('capeVisible')}>
              <Shirt size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
