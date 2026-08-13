'use client'

import * as React from 'react'

type Theme = 'light' | 'dark'

const themeStorageKey = 'hookfish-chat-theme'

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function storedTheme(): Theme | undefined {
  const value = window.localStorage.getItem(themeStorageKey)
  return value === 'light' || value === 'dark' ? value : undefined
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

function ThemeProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    applyTheme(storedTheme() ?? systemTheme())

    function onSystemThemeChange() {
      if (!storedTheme()) applyTheme(systemTheme())
    }

    function onStorage(event: StorageEvent) {
      if (event.key === themeStorageKey) {
        applyTheme(storedTheme() ?? systemTheme())
      }
    }

    media.addEventListener('change', onSystemThemeChange)
    window.addEventListener('storage', onStorage)

    return () => {
      media.removeEventListener('change', onSystemThemeChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.key.toLowerCase() !== 'd' ||
        isTypingTarget(event.target)
      ) {
        return
      }

      const theme = document.documentElement.classList.contains('dark')
        ? 'light'
        : 'dark'
      window.localStorage.setItem(themeStorageKey, theme)
      applyTheme(theme)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return children
}

export { ThemeProvider }
