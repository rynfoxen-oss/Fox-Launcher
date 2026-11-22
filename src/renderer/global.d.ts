/// <reference types="vite/client" />

import type { IpcApi } from '../shared/types';

declare global {
  interface Window {
    fox: IpcApi;
  }
}

export {};
