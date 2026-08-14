import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach, vi } from "vitest"

vi.mock("@/components/locale-provider", async () => {
  const { createElement, Fragment } = await import("react")
  const { translate } = await import("@/lib/i18n")
  const value = {
    fontScale: "normal" as const,
    locale: "zh-CN" as const,
    t: (key: string, params?: Record<string, string | number>) =>
      translate("zh-CN", key as never, params),
  }
  return {
    LocaleProvider: ({ children }: { children: React.ReactNode }) =>
      createElement(Fragment, null, children),
    useLocale: () => value,
  }
})

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()

  return {
    get length() {
      return items.size
    },
    clear: () => {
      items.clear()
    },
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => Array.from(items.keys())[index] ?? null,
    removeItem: (key: string) => {
      items.delete(key)
    },
    setItem: (key: string, value: string) => {
      items.set(key, value)
    },
  }
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createMemoryStorage(),
  })

  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      value: (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
      writable: true,
    })
  }

  if (!window.ResizeObserver) {
    class ResizeObserverMock implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: ResizeObserverMock,
    })
  }

  const elementCompatibility: PropertyDescriptorMap = {}
  if (!HTMLElement.prototype.hasPointerCapture) {
    elementCompatibility.hasPointerCapture = {
      configurable: true,
      value: () => false,
      writable: true,
    }
    elementCompatibility.releasePointerCapture = {
      configurable: true,
      value: () => undefined,
      writable: true,
    }
    elementCompatibility.setPointerCapture = {
      configurable: true,
      value: () => undefined,
      writable: true,
    }
  }
  if (!HTMLElement.prototype.scrollIntoView) {
    elementCompatibility.scrollIntoView = {
      configurable: true,
      value: () => undefined,
      writable: true,
    }
  }
  if (Object.keys(elementCompatibility).length > 0) {
    Object.defineProperties(HTMLElement.prototype, elementCompatibility)
  }
}

afterEach(() => {
  if (typeof document !== "undefined") cleanup()
})
