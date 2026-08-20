/// Client-side image processing for fully on-chain token art.
///
/// Storing an image in contract storage costs roughly $0.015 per KB on Arc, so
/// the goal is a recognisable square avatar in as few bytes as possible — not a
/// faithful reproduction of the original upload. Everything happens in the
/// browser; no upload server, no IPFS pin, nothing to rot.

/// Dimension ladder. 128px is the largest the token page displays.
///
/// Measured in-browser: for a detailed photo, dropping quality from 0.82 to 0.30
/// only saves ~40% of the bytes, while dropping 128px to 80px saves ~55%. So the
/// search walks quality first (cheap, invisible at avatar size) and falls back to
/// smaller dimensions when quality alone cannot hit the budget.
const SIZE_STEPS = [128, 112, 96, 80];

/// Soft budget the search aims for: ~$0.08 of gas on Arc. A flat logo lands far
/// under this at full quality; only noisy photographs ever need the fallbacks.
const TARGET_BYTES = 6_000;

/// Hard ceiling. Past this a launch costs more in image storage than in
/// everything else combined, so it is rejected rather than quietly charged.
export const MAX_IMAGE_BYTES = 12_000;

/// Quality ladder walked from best to worst at each size.
const QUALITY_STEPS = [0.82, 0.72, 0.62, 0.5, 0.4];

export type ProcessedImage = {
  /// A `data:image/...;base64,…` URI, ready to embed in on-chain metadata.
  dataUri: string;
  /// Byte length of the URI as it will be stored.
  bytes: number;
  /// Estimated added gas cost in USD, at Arc's ~21 gwei.
  estimatedUsd: number;
  format: "webp" | "jpeg";
};

/// Resize to a centre-cropped square and compress until it fits the budget.
export async function processImageFile(file: File): Promise<ProcessedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("That file is not an image.");
  }
  // Guard against someone selecting a 50MB RAW before we even decode it.
  if (file.size > 25 * 1024 * 1024) {
    throw new Error("Image is too large to process. Try one under 25MB.");
  }

  const bitmap = await loadBitmap(file);

  try {
    // Probe once for WebP support; it is typically 25-35% smaller than JPEG at
    // equal quality, but some browsers quietly hand back a PNG instead.
    const probe = document.createElement("canvas");
    probe.width = 8;
    probe.height = 8;
    const format: "webp" | "jpeg" = probe
      .toDataURL("image/webp", 0.5)
      .startsWith("data:image/webp")
      ? "webp"
      : "jpeg";
    const mime = `image/${format}`;

    let smallest: string | null = null;

    for (const px of SIZE_STEPS) {
      const encoded = renderAt(bitmap, px);
      for (const q of QUALITY_STEPS) {
        const candidate = encoded(mime, q);
        if (smallest === null || candidate.length < smallest.length) smallest = candidate;
        if (candidate.length <= TARGET_BYTES) {
          return {
            dataUri: candidate,
            bytes: candidate.length,
            estimatedUsd: estimateStorageUsd(candidate.length),
            format,
          };
        }
      }
    }

    // Nothing hit the soft budget. Accept the smallest we found if it is still
    // under the hard cap; otherwise the image is simply too detailed.
    if (smallest && smallest.length <= MAX_IMAGE_BYTES) {
      return {
        dataUri: smallest,
        bytes: smallest.length,
        estimatedUsd: estimateStorageUsd(smallest.length),
        format,
      };
    }

    throw new Error(
      "This picture is too detailed to store on-chain affordably. Try a simpler image, a logo, or one with flatter colours.",
    );
  } finally {
    if ("close" in bitmap) bitmap.close();
  }
}

/// Centre-crop to a square at `px` and return an encoder for it, so the same
/// render can be re-encoded at several qualities without redrawing.
function renderAt(
  bitmap: ImageBitmap | HTMLImageElement,
  px: number,
): (mime: string, quality: number) => string {
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the image in this browser.");

  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Flatten onto white: transparent PNGs otherwise turn black once encoded.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, px, px);
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, px, px);

  return (mime, quality) => canvas.toDataURL(mime, quality);
}

/// Storage dominates the cost: 20,000 gas per 32-byte word, at ~21 gwei.
export function estimateStorageUsd(bytes: number): number {
  const words = Math.ceil(bytes / 32);
  const gas = words * 20_000 + bytes * 16; // storage + calldata
  return (gas * 21e9) / 1e18;
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Safari occasionally refuses certain formats; fall through to <img>.
    }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
