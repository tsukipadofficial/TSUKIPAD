import { View, Text, type ViewProps, type TextProps } from "react-native";
import { c, font, OFFSET } from "../lib/theme";

/// Neo-brutalist card: a hard offset shadow drawn as a sibling, since React
/// Native has no box-shadow with a zero blur radius.
export function Card({ children, style, accent = false, ...rest }: ViewProps & { accent?: boolean }) {
  return (
    <View style={[{ position: "relative" }, style]}>
      <View
        style={{
          position: "absolute",
          top: OFFSET,
          left: OFFSET,
          right: -OFFSET,
          bottom: -OFFSET,
          backgroundColor: accent ? c.limeDim : c.line,
        }}
      />
      <View
        {...rest}
        style={{
          backgroundColor: accent ? c.lime : c.surface,
          borderWidth: 2,
          borderColor: accent ? c.void : c.line,
        }}
      >
        {children}
      </View>
    </View>
  );
}

export function Eyebrow({ children, style, ...rest }: TextProps) {
  return (
    <Text
      {...rest}
      style={[
        { fontFamily: font.monoBold, fontSize: 11, letterSpacing: 1.6, color: c.faint },
        style,
      ]}
    >
      {typeof children === "string" ? children.toUpperCase() : children}
    </Text>
  );
}

export function Mono({ children, style, ...rest }: TextProps) {
  return <Text {...rest} style={[{ fontFamily: font.mono, color: c.ink }, style]}>{children}</Text>;
}

export function Display({ children, style, ...rest }: TextProps) {
  return <Text {...rest} style={[{ fontFamily: font.display, color: c.ink }, style]}>{children}</Text>;
}

export function Tag({ label, color = c.lime }: { label: string; color?: string }) {
  return (
    <View style={{ borderWidth: 2, borderColor: color, paddingHorizontal: 7, paddingVertical: 3 }}>
      <Text style={{ fontFamily: font.monoBold, fontSize: 10, color, letterSpacing: 0.5 }}>{label}</Text>
    </View>
  );
}
