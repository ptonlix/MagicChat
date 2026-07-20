import { createV5Theme, defaultConfig } from "@tamagui/config/v5"
import { animationsReactNative } from "@tamagui/config/v5-rn"
import { createTamagui } from "tamagui"

const themes = createV5Theme({
  getTheme: ({ scheme }) => ({
    backgroundLight:
      scheme === "light"
        ? "hsla(0, 0%, 95%, 1)"
        : "hsla(0, 0%, 5%, 1)",
  }),
})

export const tamaguiConfig = createTamagui({
  ...defaultConfig,
  animations: animationsReactNative,
  themes: {
    ...themes,
    dark_teal: {
      ...themes.dark_teal,
      background: "hsla(175, 24%, 8%, 1)",
      backgroundLight: "hsla(174, 55%, 5%, 1)",
      borderColor: "hsla(174, 62%, 14%, 1)",
      gray9: themes.dark_gray.color9,
      gray12: themes.dark_gray.color12,
    },
    light_teal: {
      ...themes.light_teal,
      background: "hsla(165, 50%, 92%, 1)",
      backgroundLight: "hsla(165, 50%, 95%, 1)",
      borderColor: "hsla(166, 62%, 86%, 1)",
      gray9: themes.light_gray.color9,
      gray12: themes.light_gray.color12,
    },
  },
})

export type AppTamaguiConfig = typeof tamaguiConfig

declare module "tamagui" {
  interface TamaguiCustomConfig extends AppTamaguiConfig {}
}

export default tamaguiConfig
