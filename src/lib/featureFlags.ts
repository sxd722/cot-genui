function enabled(env: Record<string, string | undefined>, name: string, fallback: boolean): boolean {
  const value = env[`NEXT_PUBLIC_${name}`];
  if (value === undefined) return fallback;
  return !["0", "false", "off", "no"].includes(value.toLowerCase());
}

export function resolveFeatureFlags(env: Record<string, string | undefined>) {
  return Object.freeze({
    ADAPTIVE_QUERY_CLASSIFICATION: enabled(env, "ADAPTIVE_QUERY_CLASSIFICATION", true),
    ADAPTIVE_STEERING: enabled(env, "ADAPTIVE_STEERING", true),
    PROFILE_VIEW_V2: enabled(env, "PROFILE_VIEW_V2", true),
    WEB_FACTS_OPTIONAL: enabled(env, "WEB_FACTS_OPTIONAL", true),
    OPENUI_CARD_EDIT: enabled(env, "OPENUI_CARD_EDIT", true),
    OPENUI_ASSETS: enabled(env, "OPENUI_ASSETS", true),
    OPENUI_LOCAL_BINDINGS: enabled(env, "OPENUI_LOCAL_BINDINGS", false),
    REFLECTION_ATTRIBUTION: enabled(env, "REFLECTION_ATTRIBUTION", true),
    REFLECTION_GRADIENT: enabled(env, "REFLECTION_GRADIENT", true),
    GUARDED_AUTO_LEARN: enabled(env, "GUARDED_AUTO_LEARN", false),
    SKILL_REUSE: enabled(env, "SKILL_REUSE", true),
  });
}

export const FEATURE_FLAGS = resolveFeatureFlags({
  NEXT_PUBLIC_ADAPTIVE_QUERY_CLASSIFICATION: process.env.NEXT_PUBLIC_ADAPTIVE_QUERY_CLASSIFICATION,
  NEXT_PUBLIC_ADAPTIVE_STEERING: process.env.NEXT_PUBLIC_ADAPTIVE_STEERING,
  NEXT_PUBLIC_PROFILE_VIEW_V2: process.env.NEXT_PUBLIC_PROFILE_VIEW_V2,
  NEXT_PUBLIC_WEB_FACTS_OPTIONAL: process.env.NEXT_PUBLIC_WEB_FACTS_OPTIONAL,
  NEXT_PUBLIC_OPENUI_CARD_EDIT: process.env.NEXT_PUBLIC_OPENUI_CARD_EDIT,
  NEXT_PUBLIC_OPENUI_ASSETS: process.env.NEXT_PUBLIC_OPENUI_ASSETS,
  NEXT_PUBLIC_OPENUI_LOCAL_BINDINGS: process.env.NEXT_PUBLIC_OPENUI_LOCAL_BINDINGS,
  NEXT_PUBLIC_REFLECTION_ATTRIBUTION: process.env.NEXT_PUBLIC_REFLECTION_ATTRIBUTION,
  NEXT_PUBLIC_REFLECTION_GRADIENT: process.env.NEXT_PUBLIC_REFLECTION_GRADIENT,
  NEXT_PUBLIC_GUARDED_AUTO_LEARN: process.env.NEXT_PUBLIC_GUARDED_AUTO_LEARN,
  NEXT_PUBLIC_SKILL_REUSE: process.env.NEXT_PUBLIC_SKILL_REUSE,
});
