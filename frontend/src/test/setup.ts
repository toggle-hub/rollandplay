import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

const canvasContext = {
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  globalCompositeOperation: "source-over",
  globalAlpha: 1,
  setLineDash: vi.fn(),
  setTransform: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  closePath: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn(),
  fillText: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  clip: vi.fn(),
  rect: vi.fn(),
  drawImage: vi.fn(),
  measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
};
Object.defineProperty(globalThis, "__canvasContext", { value: canvasContext });
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: () => canvasContext,
});
Object.defineProperty(HTMLCanvasElement.prototype, "getBoundingClientRect", {
  value: () => ({
    left: 0,
    top: 0,
    width: 720,
    height: 720,
    right: 720,
    bottom: 720,
  }),
});
