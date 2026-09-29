import type { Game } from './engine.ts';
import type { AudioEngine } from './audio.ts';
import type { Tool } from './types.ts';

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
    // Installed only by the development entry point for browser diagnostics.
    __NEON_CONVOY__: {
      readonly game: Game;
      readonly audio: AudioEngine;
      loadLevel(index: number): void;
      selectTool(tool: Tool): void;
    };
  }
}
