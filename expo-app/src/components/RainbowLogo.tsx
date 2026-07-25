/**
 * RainbowLogo — tinker's multi-colored globe mark, ported 1:1 from the SVG
 * in src/renderer/index.html (.welcome__logo). A rounded cream tile with
 * meridians and parallels struck in the rainbow-web palette.
 */

import Svg, { Rect, Circle, Line, Ellipse } from "react-native-svg";
import { colors } from "../theme";

export function RainbowLogo({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" fill="none">
      <Rect width={200} height={200} rx={44} fill="#f5f3ef" />
      <Circle cx={100} cy={100} r={76} stroke={colors.purple} strokeWidth={9} />
      <Line x1={24} y1={100} x2={176} y2={100} stroke={colors.orange} strokeWidth={9} strokeLinecap="round" />
      <Line x1={34.2} y1={62} x2={165.8} y2={62} stroke={colors.pink} strokeWidth={9} strokeLinecap="round" />
      <Line x1={34.2} y1={138} x2={165.8} y2={138} stroke={colors.yellow} strokeWidth={9} strokeLinecap="round" />
      <Line x1={100} y1={24} x2={100} y2={176} stroke={colors.mint} strokeWidth={9} strokeLinecap="round" />
      <Ellipse cx={100} cy={100} rx={26} ry={76} stroke={colors.sky} strokeWidth={9} />
      <Ellipse cx={100} cy={100} rx={52} ry={76} stroke={colors.leaf} strokeWidth={9} />
    </Svg>
  );
}
