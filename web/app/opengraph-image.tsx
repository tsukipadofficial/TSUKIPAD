import { ImageResponse } from "next/og";
import { NAME_HEAD, NAME_TAIL, TAGLINE } from "@/lib/brand";

/// Social preview card. Generated at request time rather than shipped as a PNG
/// so the wordmark and tagline stay in sync with the app.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = TAGLINE;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#08080a",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width="96" height="96" viewBox="0 0 52 52">
            <rect x="6" y="6" width="44" height="44" fill="#93bf1f" />
            <rect x="2" y="2" width="44" height="44" fill="#c8ff2e" stroke="#08080a" strokeWidth="2.5" />
            <path d="M8 39 C 22 39, 31 34, 38 10" fill="none" stroke="#08080a" strokeWidth="6.5" strokeLinecap="square" />
            <rect x="33" y="6" width="9" height="9" fill="#08080a" />
            <rect x="6" y="36" width="6" height="6" fill="#ff3d8b" />
          </svg>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color: "#f4f4f0" }}>
            {NAME_HEAD}<span style={{ color: "#c8ff2e" }}>{NAME_TAIL}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 84, fontWeight: 700, color: "#f4f4f0", lineHeight: 1.05 }}>
            Launch at $3K.
          </div>
          <div style={{ fontSize: 84, fontWeight: 700, color: "#c8ff2e", lineHeight: 1.05 }}>
            Tradeable everywhere.
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 30, color: "#8c8c99" }}>
            Built on Arc Network · Uniswap V3 · liquidity locked forever
          </div>
          <div
            style={{
              display: "flex",
              border: "3px solid #c8ff2e",
              color: "#c8ff2e",
              fontSize: 26,
              fontWeight: 700,
              padding: "10px 20px",
            }}
          >
            $0 TO LAUNCH
          </div>
        </div>
      </div>
    ),
    size,
  );
}
