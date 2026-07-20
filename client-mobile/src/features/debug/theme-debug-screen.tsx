import { useRouter } from "expo-router"
import { ChevronRight, Palette } from "lucide-react-native"
import type { ReactNode } from "react"
import {
  Button,
  Card,
  type ColorTokens,
  Input,
  ListItem,
  Paragraph,
  type RadiusTokens,
  ScrollView,
  Separator,
  type SizeTokens,
  SizableText,
  type SpaceTokens,
  useTheme,
  useThemeName,
  XStack,
  YStack,
} from "tamagui"

import { ThemedIcon } from "@/components/icons/themed-icon"
import { PageHeader } from "@/components/navigation/page-header"
import {
  type DebugColorToken,
  GRAY_SCALE_TOKENS,
  OPACITY_COLOR_TOKENS,
  RADIUS_TOKENS,
  SEMANTIC_COLOR_TOKENS,
  SIZE_TOKENS,
  SPACE_TOKENS,
  TEAL_SCALE_TOKENS,
  THEME_SCALE_TOKENS,
} from "@/features/debug/theme-debug-model"

type ThemeVariable = { val: string | number }

export function ThemeDebugScreen() {
  const router = useRouter()
  const theme = useTheme()
  const themeName = useThemeName()

  function resolveToken(token: DebugColorToken) {
    const key = token.slice(1) as keyof typeof theme
    const variable = theme[key] as ThemeVariable | undefined
    return variable ? String(variable.val) : token
  }

  return (
    <YStack bg="$background" flex={1}>
      <PageHeader onBackPress={() => router.back()} title="主题调试" />

      <ScrollView flex={1}>
        <YStack
          gap="$6"
          maxW={720}
          p="$4"
          pb="$10"
          self="center"
          width="100%"
        >
          <Card bg="$color2" gap="$2" p="$4" rounded="$5">
            <XStack gap="$2" items="center">
              <ThemedIcon icon={Palette} size={20} />
              <SizableText fontWeight="600" size="$4">
                当前主题：{themeName}
              </SizableText>
            </XStack>
            <Paragraph color="$color10" size="$2">
              颜色值会跟随系统亮色或暗色模式实时变化。
            </Paragraph>
          </Card>

          <ColorSection
            description="推荐优先使用的主题色阶，会自动适配亮色和暗色模式。"
            resolveToken={resolveToken}
            title="当前主题色阶"
            tokens={THEME_SCALE_TOKENS}
          />
          <ColorSection
            description="指定的 teal 色板，适合需要明确色阶的场景。"
            resolveToken={resolveToken}
            title="Teal 色板"
            tokens={TEAL_SCALE_TOKENS}
          />
          <ColorSection
            description="中性色板；项目另外将 $gray9 和 $gray12 映射为当前模式的灰色文字。"
            resolveToken={resolveToken}
            title="Gray 色板"
            tokens={GRAY_SCALE_TOKENS}
          />
          <ColorSection
            description="组件应优先使用这些具有明确用途的变量。"
            resolveToken={resolveToken}
            title="语义颜色"
            tokens={SEMANTIC_COLOR_TOKENS}
          />
          <ColorSection
            description="透明颜色叠加在灰色底板上，便于观察实际透明度。"
            resolveToken={resolveToken}
            title="透明度颜色"
            tokens={OPACITY_COLOR_TOKENS}
          />

          <TokenSection title="圆角">
            <XStack flexWrap="wrap" gap="$3">
              {RADIUS_TOKENS.map((token) => (
                <YStack gap="$1" items="center" key={token}>
                  <YStack
                    bg="$color4"
                    borderColor="$borderColor"
                    borderWidth={1}
                    height={52}
                    rounded={token as RadiusTokens}
                    width={52}
                  />
                  <SizableText color="$color10" size="$1">
                    {token}
                  </SizableText>
                </YStack>
              ))}
            </XStack>
          </TokenSection>

          <TokenSection title="间距">
            <YStack gap="$3">
              {SPACE_TOKENS.map((token) => (
                <XStack items="center" key={token}>
                  <SizableText color="$color10" size="$2" width={48}>
                    {token}
                  </SizableText>
                  <XStack gap={token as SpaceTokens} items="center">
                    <YStack bg="$color9" height={20} rounded="$2" width={20} />
                    <YStack bg="$color9" height={20} rounded="$2" width={20} />
                  </XStack>
                </XStack>
              ))}
            </YStack>
          </TokenSection>

          <TokenSection title="尺寸">
            <YStack gap="$3">
              {SIZE_TOKENS.map((token) => (
                <XStack gap="$3" items="center" key={token}>
                  <SizableText color="$color10" size="$2" width={48}>
                    {token}
                  </SizableText>
                  <YStack
                    bg="$color9"
                    height="$2"
                    rounded="$2"
                    width={token as SizeTokens}
                  />
                </XStack>
              ))}
            </YStack>
            <Paragraph color="$color10" size="$2">
              zIndex 可用范围为 $0～$5。
            </Paragraph>
          </TokenSection>

          <ComponentPreview />
        </YStack>
      </ScrollView>
    </YStack>
  )
}

function ColorSection({
  description,
  resolveToken,
  title,
  tokens,
}: {
  description: string
  resolveToken: (token: DebugColorToken) => string
  title: string
  tokens: readonly DebugColorToken[]
}) {
  return (
    <TokenSection description={description} title={title}>
      <XStack flexWrap="wrap" gap="$2">
        {tokens.map((token) => (
          <ColorSwatch key={token} token={token} value={resolveToken(token)} />
        ))}
      </XStack>
    </TokenSection>
  )
}

function ColorSwatch({
  token,
  value,
}: {
  token: DebugColorToken
  value: string
}) {
  return (
    <YStack
      bg="$background"
      borderColor="$borderColor"
      borderWidth={1}
      flexBasis="47%"
      grow={1}
      minW={150}
      overflow="hidden"
      rounded="$4"
    >
      <YStack bg="$gray5" height={48}>
        <YStack bg={token as ColorTokens} flex={1} />
      </YStack>
      <YStack gap="$0.5" p="$2">
        <SizableText fontWeight="500" size="$2">
          {token}
        </SizableText>
        <SizableText color="$color10" size="$1">
          {value}
        </SizableText>
      </YStack>
    </YStack>
  )
}

function TokenSection({
  children,
  description,
  title,
}: {
  children: ReactNode
  description?: string
  title: string
}) {
  return (
    <YStack gap="$3">
      <YStack gap="$1">
        <SizableText fontWeight="600" size="$5">
          {title}
        </SizableText>
        {description ? (
          <Paragraph color="$color10" size="$2">
            {description}
          </Paragraph>
        ) : null}
      </YStack>
      {children}
    </YStack>
  )
}

function ComponentPreview() {
  return (
    <TokenSection
      description="使用当前主题默认样式渲染，方便观察变量在真实组件中的组合效果。"
      title="组件预览"
    >
      <Card gap="$4" p="$4" rounded="$5">
        <XStack flexWrap="wrap" gap="$2">
          <Button theme="teal">主题按钮</Button>
          <Button theme="accent">Accent</Button>
          <Button variant="outlined">描边按钮</Button>
        </XStack>
        <Input placeholder="输入框 placeholder" />
        <Separator />
        <ListItem
          icon={<ThemedIcon icon={Palette} />}
          iconAfter={<ThemedIcon icon={ChevronRight} />}
          subTitle="使用当前主题语义颜色"
          title="ListItem 示例"
        />
      </Card>
    </TokenSection>
  )
}
