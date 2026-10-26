import type { RendererApi } from '../shared/types';

export interface GitPlusBridge extends RendererApi {
  window?: {
    minimize(): Promise<void>;
    maximize(): Promise<{ maximized: boolean }>;
    close(): Promise<void>;
    isMaximized(): Promise<{ maximized: boolean }>;
    onMaximized(listener: (maximized: boolean) => void): () => void;
  };
  startup?: () => Promise<{ warnings: string[] }>;
  onMenuCommand?: (listener: (command: string) => void) => () => void;
}

declare global {
  interface Window {
    gitpp?: GitPlusBridge;
  }
}

export {};
