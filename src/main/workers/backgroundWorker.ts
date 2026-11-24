import { parentPort } from 'worker_threads';
import {
  extractMacAppArchiveLocal,
  extractNativesLocal,
  extractZipArchiveLocal,
  readZipArchiveLocal,
} from '../archiveCore';
import { inferSkinModelLocal, normalizePngLocal, type TextureKind } from '../skinImage';

type Request =
  | { id: number; type: 'png'; buffer: Buffer; kind: TextureKind }
  | { id: number; type: 'extractNatives'; jarPath: string; outputDir: string }
  | { id: number; type: 'readZip'; file: string }
  | { id: number; type: 'extractZip'; file: string; outputDir: string }
  | { id: number; type: 'extractMac'; file: string; outputDir: string };

if (!parentPort) throw new Error('Background worker must run in a worker thread');

function toBuffer(value: Uint8Array | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

parentPort.on('message', (request: Request) => {
  void (async () => {
    switch (request.type) {
      case 'png': {
        const sanitized = normalizePngLocal(toBuffer(request.buffer), request.kind);
        parentPort!.postMessage({
          id: request.id,
          ok: true,
          sanitized,
          model: sanitized ? inferSkinModelLocal(sanitized) : 'steve',
        });
        return;
      }
      case 'extractNatives': {
        const paths = await extractNativesLocal(request.jarPath, request.outputDir);
        parentPort!.postMessage({ id: request.id, ok: true, paths });
        return;
      }
      case 'readZip': {
        const entries = await readZipArchiveLocal(request.file);
        parentPort!.postMessage({ id: request.id, ok: true, entries });
        return;
      }
      case 'extractZip': {
        const paths = await extractZipArchiveLocal(request.file, request.outputDir);
        parentPort!.postMessage({ id: request.id, ok: true, paths });
        return;
      }
      case 'extractMac': {
        const result = await extractMacAppArchiveLocal(request.file, request.outputDir);
        parentPort!.postMessage({ id: request.id, ok: true, result });
        return;
      }
    }
  })().catch((error: unknown) => {
    parentPort!.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  });
});
