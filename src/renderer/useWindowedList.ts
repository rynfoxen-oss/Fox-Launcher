import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react';

interface WindowedListOptions {
  /** Used until a real item can be measured. */
  estimateHeight: number;
  /** Fallback when the rendered container has no CSS row gap. */
  gap?: number;
  overscan?: number;
  /** Changing this resets the scroll offset (new search, instance, filter…). */
  resetKey?: string;
}

/**
 * Keeps only the visible slice of a long list/grid mounted. Uniform row heights
 * are measured from the first rendered item, so cards can keep their natural
 * height without hard-coding pixel values in CSS.
 */
export function useWindowedList<T>(items: T[], options: WindowedListOptions) {
  const { estimateHeight, gap = 8, overscan = 2, resetKey } = options;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef(0);
  const [metrics, setMetrics] = useState({
    scrollTop: 0,
    viewport: 600,
    itemHeight: estimateHeight,
    gap,
    columns: 1,
  });

  const measure = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const first = firstItemRef.current;
    const parent = first?.parentElement;
    const parentStyle = parent ? window.getComputedStyle(parent) : null;
    const isGrid = parentStyle?.display.includes('grid') ?? false;
    const templateColumns = isGrid ? parentStyle?.gridTemplateColumns ?? '' : '';
    const parsedColumns = templateColumns
      ? templateColumns.split(' ').filter(Boolean).length
      : 1;
    const columns = Math.max(1, parsedColumns);
    const itemHeight = first ? first.getBoundingClientRect().height : estimateHeight;
    const computedGap = Number.parseFloat(parentStyle?.rowGap || parentStyle?.gap || '') || gap;
    const viewport = container.clientHeight || estimateHeight * 4;

    setMetrics((current) => (
      current.viewport === viewport
      && Math.abs(current.itemHeight - itemHeight) < 0.5
      && current.gap === computedGap
      && current.columns === columns
        ? current
        : { ...current, viewport, itemHeight, gap: computedGap, columns }
    ));
  }, [estimateHeight, gap]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const scrollTop = event.currentTarget.scrollTop;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      setMetrics((current) => current.scrollTop === scrollTop ? current : { ...current, scrollTop });
    });
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, items.length, metrics.columns]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = 0;
    setMetrics((current) => current.scrollTop === 0 ? current : { ...current, scrollTop: 0 });
  }, [resetKey]);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  const rowSize = Math.max(1, metrics.itemHeight + metrics.gap);
  const rows = Math.ceil(items.length / metrics.columns);
  const startRow = Math.max(0, Math.floor(metrics.scrollTop / rowSize) - overscan);
  const endRow = Math.min(rows, Math.ceil((metrics.scrollTop + metrics.viewport) / rowSize) + overscan);
  const start = startRow * metrics.columns;
  const end = Math.min(items.length, endRow * metrics.columns);

  return useMemo(() => ({
    scrollRef,
    firstItemRef,
    onScroll,
    measure,
    visible: items.slice(start, end),
    paddingTop: startRow * rowSize,
    paddingBottom: Math.max(0, (rows - endRow) * rowSize - metrics.gap),
    columns: metrics.columns,
  }), [items, start, end, startRow, endRow, rowSize, rows, metrics.gap, metrics.columns, onScroll, measure]);
}
