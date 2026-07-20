export const THEME_SCALE_TOKENS = [
  "$color1",
  "$color2",
  "$color3",
  "$color4",
  "$color5",
  "$color6",
  "$color7",
  "$color8",
  "$color9",
  "$color10",
  "$color11",
  "$color12",
] as const

export const TEAL_SCALE_TOKENS = [
  "$teal1",
  "$teal2",
  "$teal3",
  "$teal4",
  "$teal5",
  "$teal6",
  "$teal7",
  "$teal8",
  "$teal9",
  "$teal10",
  "$teal11",
  "$teal12",
] as const

export const GRAY_SCALE_TOKENS = [
  "$gray1",
  "$gray2",
  "$gray3",
  "$gray4",
  "$gray5",
  "$gray6",
  "$gray7",
  "$gray8",
  "$gray9",
  "$gray10",
  "$gray11",
  "$gray12",
] as const

export const SEMANTIC_COLOR_TOKENS = [
  "$background",
  "$backgroundLight",
  "$backgroundHover",
  "$backgroundPress",
  "$backgroundFocus",
  "$backgroundActive",
  "$color",
  "$colorHover",
  "$colorPress",
  "$colorFocus",
  "$borderColor",
  "$borderColorHover",
  "$borderColorPress",
  "$borderColorFocus",
  "$placeholderColor",
  "$outlineColor",
  "$accentBackground",
  "$accentColor",
] as const

export const OPACITY_COLOR_TOKENS = [
  "$color0",
  "$color01",
  "$color02",
  "$color04",
  "$color06",
  "$color08",
  "$color0075",
  "$color005",
  "$color0025",
  "$color002",
  "$color001",
  "$background0",
  "$background01",
  "$background02",
  "$background04",
  "$background06",
  "$background08",
  "$background0075",
  "$background005",
  "$background0025",
  "$background002",
  "$background001",
] as const

export const RADIUS_TOKENS = [
  "$0",
  "$1",
  "$2",
  "$3",
  "$4",
  "$5",
  "$6",
  "$8",
  "$10",
  "$12",
] as const

export const SPACE_TOKENS = [
  "$0.5",
  "$1",
  "$2",
  "$3",
  "$4",
  "$5",
  "$6",
  "$8",
  "$10",
] as const

export const SIZE_TOKENS = [
  "$1",
  "$2",
  "$3",
  "$4",
  "$5",
  "$6",
  "$8",
  "$10",
] as const

export type DebugColorToken =
  | (typeof THEME_SCALE_TOKENS)[number]
  | (typeof TEAL_SCALE_TOKENS)[number]
  | (typeof GRAY_SCALE_TOKENS)[number]
  | (typeof SEMANTIC_COLOR_TOKENS)[number]
  | (typeof OPACITY_COLOR_TOKENS)[number]
