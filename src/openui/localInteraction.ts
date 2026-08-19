export const ALLOWED_LOCAL_ACTIONS = new Set(["Set", "Reset", "ToAssistant"]);
export const FORBIDDEN_OPENUI_ACTIONS = new Set(["Run", "OpenUrl"]);

export function forbiddenOpenUIActions(code: string): string[] {
  return [...FORBIDDEN_OPENUI_ACTIONS].filter((name) => new RegExp(`@${name}\\s*\\(`).test(code));
}

export function containsRawExternalUrl(code: string): boolean {
  return /https?:\/\//i.test(code);
}
