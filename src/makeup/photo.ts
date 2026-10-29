// The photo: the picture with your makeup at the best quality the device
// can give, the Made with Vincentt mark drawn in at the bottom right, then
// saved the device's way: the share sheet on a phone or tablet, a download
// on a computer. The controls are page UI, so they are never in the photo.
import { useCallback, useEffect, useRef } from "react";
import { useXRQuality } from "@vincentt-xr/sdk";

import {
  saveToDevice,
  shareMedia,
  usePhotoCapture,
  type CapturedMedia,
} from "../capture";

const MARK_URL = "/images/made-with-vincentt.png";

/**
 * The mark, in camera-ui units of a 360-unit-wide screen (the shorter side of
 * the photo): a 32-unit pill, 16 units in from the bottom-right corner.
 */
const MARK = { height: 32, inset: 16, unitsAcross: 360 };

/** JPEG quality of the saved photo. */
const JPEG_QUALITY = 0.92;

/** Frames to wait for the top quality tier to reach the picture. */
const SETTLE_FRAMES = 3;

/** Resolves after `n` animation frames. */
const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(n);
  });

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });

/** Save a capture the device's own way. */
const keep = async (media: CapturedMedia, filename: string) => {
  if (window.matchMedia?.("(pointer: coarse)").matches)
    await shareMedia(media, { filename, title: "Makeup Studio" });
  else saveToDevice(media, filename);
};

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

/** The frame with the mark drawn in, as a JPEG. */
const withMark = async (
  frame: CapturedMedia,
  mark: HTMLImageElement | null,
): Promise<CapturedMedia> => {
  const img = await loadImage(frame.dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return frame;
  ctx.drawImage(img, 0, 0);
  if (mark) {
    const unit = Math.min(canvas.width, canvas.height) / MARK.unitsAcross;
    const h = MARK.height * unit;
    const w = (h * mark.naturalWidth) / Math.max(1, mark.naturalHeight);
    const inset = MARK.inset * unit;
    ctx.drawImage(
      mark,
      canvas.width - inset - w,
      canvas.height - inset - h,
      w,
      h,
    );
  }
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const blob = await (await fetch(dataUrl)).blob();
  return { blob, dataUrl };
};

/**
 * `take()` snaps, marks and saves a photo; `onFlash` fires the moment the
 * picture is taken (for the white flash).
 */
export const usePhoto = (onFlash: () => void) => {
  const { capture } = usePhotoCapture();
  const quality = useXRQuality();
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  const mark = useRef<HTMLImageElement | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    loadImage(MARK_URL)
      .then((img) => {
        mark.current = img;
      })
      .catch(() => {});
  }, []);

  const take = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const q = qualityRef.current;
    const lock = q.tiers.length > 0;
    try {
      // The top quality tier for the frame that is captured, then back to adaptive.
      if (lock) {
        q.setTier(0);
        q.lock();
      }
      await frames(SETTLE_FRAMES);
      const frame = await capture();
      if (lock) q.unlock();
      onFlash();
      // The mark loads at mount; if that failed, one more try now.
      if (!mark.current)
        mark.current = await loadImage(MARK_URL).catch(() => null);
      const photo = await withMark(frame, mark.current);
      await keep(photo, `makeup-studio-${stamp()}.jpg`);
    } finally {
      if (lock) q.unlock();
      busy.current = false;
    }
  }, [capture, onFlash]);

  return take;
};
