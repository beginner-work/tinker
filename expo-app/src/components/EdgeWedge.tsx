/**
 * EdgeWedge — the right-triangle that hugs the top-left corner of the
 * welcome screen, ported from the --edge-fill / --edge-clip tokens. The
 * rainbow runs along the hypotenuse (225deg); the top and left edges sit
 * flush to the bezel. Rendered as an SVG polygon filled with a linear
 * gradient so it stays crisp at any density.
 */

import Svg, { Polygon, Defs, LinearGradient, Stop } from "react-native-svg";
import { colors } from "../theme";

export function EdgeWedge({ size = 200 }: { size?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ position: "absolute", top: 0, left: 0 }}
      pointerEvents="none"
    >
      <Defs>
        {/* 225deg: bottom-right (paper) -> top-left (purple), matching
            the CSS linear-gradient(225deg, ...) stop order. */}
        <LinearGradient id="wedge" x1="100%" y1="100%" x2="0%" y2="0%">
          <Stop offset="0%" stopColor="#fffdf7" stopOpacity={0.95} />
          <Stop offset="8%" stopColor={colors.pink} />
          <Stop offset="22%" stopColor={colors.orange} />
          <Stop offset="36%" stopColor={colors.yellow} />
          <Stop offset="50%" stopColor={colors.leaf} />
          <Stop offset="63%" stopColor={colors.mint} />
          <Stop offset="76%" stopColor={colors.sky} />
          <Stop offset="100%" stopColor={colors.purple} />
        </LinearGradient>
      </Defs>
      {/* polygon(0 0, 100% 0, 0 100%) — top edge + left edge + hypotenuse */}
      <Polygon points="0,0 100,0 0,100" fill="url(#wedge)" />
    </Svg>
  );
}
