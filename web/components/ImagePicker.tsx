"use client";

import { useCallback, useRef, useState } from "react";
import { Button, cx } from "./ui";
import {
  processImageFile,
  formatBytes,
  MAX_IMAGE_BYTES,
  type ProcessedImage,
} from "@/lib/image";
import { useT } from "@/lib/i18n";

/// Picks an image, shrinks it in the browser, and hands back a data URI small
/// enough to live in contract storage. Nothing is uploaded anywhere.
export function ImagePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (dataUri: string) => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<ProcessedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        const processed = await processImageFile(file);
        setInfo(processed);
        onChange(processed.dataUri);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not process that image.");
        setInfo(null);
        onChange("");
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  function clear() {
    setInfo(null);
    setError(null);
    onChange("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      {value ? (
        <div className="flex items-center gap-3 border-2 border-line p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt=""
            className="size-16 shrink-0 border-2 border-void object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-lime">{t("image.stored")}</p>
            {info ? (
              <p className="tabular mt-0.5 text-xs text-muted">
                {formatBytes(info.bytes)} · {info.format.toUpperCase()} · adds ~$
                {info.estimatedUsd.toFixed(3)} gas
              </p>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" onClick={clear}>
            {t("image.remove")}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void handleFile(e.dataTransfer.files?.[0]);
          }}
          className={cx(
            "flex w-full flex-col items-center justify-center gap-1 border-2 border-dashed px-4 py-6 transition-colors",
            dragging ? "border-lime bg-lime/5" : "border-line hover:border-line-bright",
          )}
        >
          <span className="text-sm font-bold">
            {busy ? t("image.processing") : t("image.choose")}
          </span>
          <span className="text-xs text-muted">
            {t("image.drop")}
          </span>
        </button>
      )}

      {error ? <p className="mt-2 text-xs text-pink">{error}</p> : null}

      {info && info.bytes > MAX_IMAGE_BYTES * 0.8 ? (
        <p className="mt-2 text-xs text-amber">
          {t("image.nearLimit")}
        </p>
      ) : null}
    </div>
  );
}
