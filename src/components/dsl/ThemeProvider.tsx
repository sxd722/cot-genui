"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Theme } from "@/dsl/types";

/** spec §10 默认主题 */
const DEFAULT_THEME: Required<Theme> = {
  preset: "black-gold",
  accentToken: "#D7AE59",
  surfaceToken: "#0B0D10",
  dangerToken: "#E88A73",
};

interface ThemeCtx {
  theme: Required<Theme>;
}

const Ctx = createContext<ThemeCtx>({ theme: DEFAULT_THEME });

/** 提供 DSL 主题。把 token 注入 CSS 变量，子组件用 var(--dsl-accent) 等。 */
export function DslThemeProvider({
  theme,
  children,
}: {
  theme?: Theme;
  children: ReactNode;
}) {
  const full = useMemo<Required<Theme>>(
    () => ({ ...DEFAULT_THEME, ...(theme ?? {}) }),
    [theme],
  );
  const style = useMemo(
    () =>
      ({
        "--dsl-accent": full.accentToken,
        "--dsl-surface": full.surfaceToken,
        "--dsl-danger": full.dangerToken,
      }) as React.CSSProperties,
    [full],
  );
  return (
    <Ctx.Provider value={{ theme: full }}>
      <div style={style} className="contents">
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function useDslTheme(): Required<Theme> {
  return useContext(Ctx).theme;
}
