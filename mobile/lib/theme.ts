/// The palette is lifted verbatim from web/app/globals.css so the app and the
/// site read as one product. Do not introduce colours that aren't here.
export const c = {
  void: "#08080A",
  surface: "#121216",
  surface2: "#1A1A20",
  line: "#2C2C35",
  lineBright: "#43434F",
  lime: "#C8FF2E",
  limeDim: "#93BF1F",
  pink: "#FF3D8B",
  cyan: "#29E5F5",
  amber: "#FFB020",
  ink: "#F4F4F0",
  muted: "#8C8C99",
  faint: "#5B5B68",
} as const;

export const font = {
  display: "SpaceGrotesk_700Bold",
  displayMed: "SpaceGrotesk_500Medium",
  mono: "JetBrainsMono_400Regular",
  monoMed: "JetBrainsMono_500Medium",
  monoBold: "JetBrainsMono_700Bold",
} as const;

/// The neo-brutalist offset shadow used throughout the web UI. React Native
/// has no box-shadow, so it is rendered as a translated sibling View.
export const OFFSET = 4;
