import { useEffect, useRef, useState } from 'react';

/**
 * A 64x32 cape sheet holds the cloth faces side by side. The 10x16 panel at
 * (1,1) is the *outside* face (the cape mesh is rotated 180 degrees, so this is
 * the side other players see); the panel at (12,1) is the plain inside lining.
 * Show the textured outside face only — never the whole sheet or the lining.
 */
export function CapeThumb({ src, alt }: { src: string; alt: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;
    const image = new Image();

    const draw = () => {
      if (!active || !image.naturalWidth) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Redraw at the box's real pixel size so the cape is never stretched.
      const boxWidth = canvas.clientWidth || 160;
      const boxHeight = canvas.clientHeight || 76;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(boxWidth * ratio));
      canvas.height = Math.max(1, Math.round(boxHeight * ratio));

      const scaleX = image.naturalWidth / 64;
      const scaleY = image.naturalHeight / 32;
      // Outside face: x=1..11, y=1..17 in a 64x32 cape texture (scaled for HD).
      const sourceX = 1 * scaleX;
      const sourceY = 1 * scaleY;
      const cropWidth = 10 * scaleX;
      const cropHeight = 16 * scaleY;
      const scale = Math.min(canvas.width / cropWidth, canvas.height / cropHeight);
      const drawWidth = Math.max(1, Math.round(cropWidth * scale));
      const drawHeight = Math.max(1, Math.round(cropHeight * scale));

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        image,
        sourceX, sourceY, cropWidth, cropHeight,
        Math.round((canvas.width - drawWidth) / 2),
        Math.round((canvas.height - drawHeight) / 2),
        drawWidth, drawHeight,
      );
      setFailed(false);
    };

    image.onload = draw;
    image.onerror = () => { if (active) setFailed(true); };
    image.src = src;

    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [src]);

  if (failed) {
    return <span className="cape-thumb-fallback" role="img" aria-label={alt} />;
  }
  return <canvas ref={canvasRef} className="cape-thumb-canvas" role="img" aria-label={alt} />;
}
