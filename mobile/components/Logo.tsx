import Svg, { Rect, Path } from "react-native-svg";
import { c } from "../lib/theme";

/// The product mark: the price curve every launch walks. Same geometry as
/// web/components/Logo.tsx, so the app and site show an identical mark.
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 52 52">
      <Rect x={6} y={6} width={44} height={44} fill={c.limeDim} />
      <Rect x={2} y={2} width={44} height={44} fill={c.lime} stroke={c.void} strokeWidth={2.5} />
      <Path d="M8 39 C 22 39, 31 34, 38 10" fill="none" stroke={c.void} strokeWidth={6.5} strokeLinecap="square" />
      <Rect x={33} y={6} width={9} height={9} fill={c.void} />
      <Rect x={6} y={36} width={6} height={6} fill={c.pink} />
    </Svg>
  );
}
