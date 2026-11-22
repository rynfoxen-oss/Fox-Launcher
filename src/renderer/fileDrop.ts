import type { DragEvent } from 'react';

export type DropKind = 'png' | 'image';

export function isFileDrag(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

export function droppedFile(event: DragEvent<HTMLElement>, kind: DropKind): File | null {
  const files = Array.from(event.dataTransfer.files);
  return files.find((file) => kind === 'png'
    ? file.type === 'image/png' || /\.png$/i.test(file.name)
    : file.type.startsWith('image/')) ?? null;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}
