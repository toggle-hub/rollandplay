/// <reference types="vite/client" />

import type { Mock } from "vitest";

declare global {
  var __canvasContext: {
    fillText: Mock;
    fillRect: Mock;
    beginPath: Mock;
    moveTo: Mock;
    lineTo: Mock;
    stroke: Mock;
    closePath: Mock;
    fill: Mock;
    arc: Mock;
    setLineDash: Mock;
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
  };
}

export {};
