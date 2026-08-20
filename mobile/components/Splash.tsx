import { useEffect, useRef, useState } from "react";
import { View, Text, Animated, Easing, Dimensions } from "react-native";
import Svg, { Rect, Path } from "react-native-svg";
import { c, font } from "../lib/theme";

const AnimatedPath = Animated.createAnimatedComponent(Path);

/// Arc length of the mark's curve in its 52-unit viewBox, measured by dense
/// sampling of the cubic. react-native-svg has no pathLength prop, so the dash
/// has to be sized to the real curve or the draw starts part-way through.
const CURVE_LEN = 45.8;
const { width: W, height: H } = Dimensions.get("window");

/// Launch screen. The curve draws itself, the wordmark lands, then the whole
/// thing lifts away — the same beat order as the trailer, so the app opens the
/// way the brand moves everywhere else.
///
/// strokeDashoffset can't run on the native driver (it isn't a transform or
/// opacity), so the draw uses the JS driver while the fades use the native one.
export function Splash({ onDone }: { onDone: () => void }) {
  const draw = useRef(new Animated.Value(CURVE_LEN)).current; // -> 0 as it draws
  const markIn = useRef(new Animated.Value(0)).current;
  const wordIn = useRef(new Animated.Value(0)).current;
  const tagIn = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(1)).current;
  const [gone, setGone] = useState(false);

  useEffect(() => {
    Animated.sequence([
      Animated.timing(markIn, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(draw, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      Animated.timing(wordIn, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(tagIn, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(420),
      Animated.timing(out, { toValue: 0, duration: 420, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(() => { setGone(true); onDone(); });
  }, []);

  if (gone) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute", width: W, height: H, backgroundColor: c.void,
        alignItems: "center", justifyContent: "center", zIndex: 100,
        opacity: out,
        transform: [{ scale: out.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1] }) }],
      }}
    >
      <Animated.View
        style={{
          opacity: markIn,
          transform: [{ scale: markIn.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }],
        }}
      >
        <Svg width={132} height={132} viewBox="0 0 52 52">
          <Rect x={6} y={6} width={44} height={44} fill={c.limeDim} />
          <Rect x={2} y={2} width={44} height={44} fill={c.lime} stroke={c.void} strokeWidth={2.5} />
          <AnimatedPath
            d="M8 39 C 22 39, 31 34, 38 10"
            fill="none" stroke={c.void} strokeWidth={6.5} strokeLinecap="square"
            strokeDasharray={CURVE_LEN}
            strokeDashoffset={draw as unknown as number}
          />
          {/* Optically corrected for this size: the header mark's 9x9 marker
              is 1.35x the stroke, which cannot contain the curve's rotated
              square cap. Invisible at 32px, a notch at 132px. */}
          <Rect x={32} y={4.6} width={11.5} height={11.5} fill={c.void} />
          <Rect x={6} y={36} width={6} height={6} fill={c.pink} />
        </Svg>
      </Animated.View>

      <Animated.View
        style={{
          marginTop: 26, flexDirection: "row", alignItems: "baseline",
          opacity: wordIn,
          transform: [{ translateY: wordIn.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        }}
      >
        <Text style={{ fontFamily: font.display, fontSize: 42, letterSpacing: -1.6, color: c.ink }}>
          TSUKI<Text style={{ color: c.lime }}>PAD</Text>
        </Text>
        <Text style={{ fontFamily: font.display, fontSize: 25, color: c.limeDim, marginLeft: 11 }}>月</Text>
      </Animated.View>

      <Animated.Text
        style={{
          marginTop: 12, fontFamily: font.mono, fontSize: 12.5, color: c.faint,
          letterSpacing: 0.7, opacity: tagIn,
        }}
      >
        fair launches on Arc Network
      </Animated.Text>
    </Animated.View>
  );
}
