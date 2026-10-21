export type ImageGridLayout = {
  rows: number;
  cols: number;
};

export const IMAGE_GRID_LAYOUTS = {
  2: { rows: 1, cols: 2 },
  4: { rows: 2, cols: 2 },
  6: { rows: 3, cols: 2 },
  9: { rows: 3, cols: 3 },
} as const satisfies Record<number, ImageGridLayout>;

export type ImageGridCount = keyof typeof IMAGE_GRID_LAYOUTS;

export type ImageGridCropRect = {
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function fitImageGridCropRectToAspectRatio(
  rect: ImageGridCropRect,
  targetAspectRatio: number,
): ImageGridCropRect {
  if (!Number.isFinite(targetAspectRatio) || targetAspectRatio <= 0) {
    throw new Error("无效的输出图片比例");
  }
  const currentAspectRatio = rect.width / rect.height;
  if (Math.abs(currentAspectRatio - targetAspectRatio) < 0.001) return rect;
  if (currentAspectRatio > targetAspectRatio) {
    const width = Math.max(1, Math.min(rect.width, Math.round(rect.height * targetAspectRatio)));
    return { ...rect, x: rect.x + Math.floor((rect.width - width) / 2), width };
  }
  const height = Math.max(1, Math.min(rect.height, Math.round(rect.width / targetAspectRatio)));
  return { ...rect, y: rect.y + Math.floor((rect.height - height) / 2), height };
}

export function getImageGridLayout(count: number): ImageGridLayout | null {
  return IMAGE_GRID_LAYOUTS[count as ImageGridCount] ?? null;
}

export function isImageGridCount(count: number): count is ImageGridCount {
  return Object.prototype.hasOwnProperty.call(IMAGE_GRID_LAYOUTS, count);
}

export function describeImageGridLayout(layout: ImageGridLayout): string {
  return `${layout.rows} 行 × ${layout.cols} 列`;
}

export function getImageGridCropRects(
  sourceWidth: number,
  sourceHeight: number,
  layout: ImageGridLayout,
  options?: { insetRatio?: number; insetXRatio?: number; insetYRatio?: number },
): ImageGridCropRect[] {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) {
    throw new Error("无效的图片尺寸");
  }
  if (!Number.isInteger(layout.rows) || !Number.isInteger(layout.cols) || layout.rows < 1 || layout.cols < 1) {
    throw new Error("无效的图片网格布局");
  }

  const insetRatio = options?.insetRatio;
  const insetXRatio = Math.max(0, Math.min(options?.insetXRatio ?? insetRatio ?? 0.04, 0.12));
  const insetYRatio = Math.max(0, Math.min(options?.insetYRatio ?? insetRatio ?? 0.06, 0.12));
  const rects: ImageGridCropRect[] = [];

  for (let row = 0; row < layout.rows; row += 1) {
    for (let col = 0; col < layout.cols; col += 1) {
      const cellLeft = Math.round((sourceWidth * col) / layout.cols);
      const cellTop = Math.round((sourceHeight * row) / layout.rows);
      const cellRight = Math.round((sourceWidth * (col + 1)) / layout.cols);
      const cellBottom = Math.round((sourceHeight * (row + 1)) / layout.rows);
      const insetX = Math.round((cellRight - cellLeft) * insetXRatio);
      const insetY = Math.round((cellBottom - cellTop) * insetYRatio);
      const x = cellLeft + (col > 0 ? insetX : 0);
      const y = cellTop + (row > 0 ? insetY : 0);
      const right = cellRight - (col < layout.cols - 1 ? insetX : 0);
      const bottom = cellBottom - (row < layout.rows - 1 ? insetY : 0);
      if (right <= x || bottom <= y) throw new Error("图片网格内缩比例过大");
      rects.push({ row, col, x, y, width: right - x, height: bottom - y });
    }
  }

  return rects;
}

type LoadedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

function loadBitmap(blob: Blob): Promise<LoadedImage> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob).then(bitmap => ({
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    }));
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        source: image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        close: () => undefined,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片解码失败"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType = "image/jpeg", quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("图片切割导出失败"));
    }, mimeType, quality);
  });
}

/**
 * Split a generated contact sheet into equal cells. This intentionally uses
 * rounded boundaries so the final row/column also receives every source pixel
 * when the source dimensions are not divisible by the layout.
 */
export async function splitImageGrid(
  source: Blob,
  layout: ImageGridLayout,
  options?: { mimeType?: string; quality?: number; insetRatio?: number; insetXRatio?: number; insetYRatio?: number; outputAspectRatio?: number },
): Promise<Blob[]> {
  if (typeof document === "undefined") throw new Error("图片切割只能在浏览器中执行");
  if (layout.rows < 1 || layout.cols < 1) throw new Error("无效的图片网格布局");

  const bitmap = await loadBitmap(source);
  const pieces: Blob[] = [];
  const mimeType = options?.mimeType ?? "image/jpeg";
  const quality = options?.quality ?? 0.92;
  const baseCropRects = getImageGridCropRects(bitmap.width, bitmap.height, layout, options);
  const cropRects = options?.outputAspectRatio
    ? baseCropRects.map(rect => fitImageGridCropRectToAspectRatio(rect, options.outputAspectRatio as number))
    : baseCropRects;

  try {
    for (const rect of cropRects) {
      const canvas = document.createElement("canvas");
      canvas.width = rect.width;
      canvas.height = rect.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法创建图片切割画布");
      context.drawImage(bitmap.source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      pieces.push(await canvasToBlob(canvas, mimeType, quality));
    }
  } finally {
    bitmap.close();
  }

  return pieces;
}

export function imageBlobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(blob);
  });
}
