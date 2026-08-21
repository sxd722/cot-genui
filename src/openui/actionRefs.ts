/**
 * Pure action-ref helpers shared by server pipeline and client-safe builders.
 * Keep this module free of "server-only" imports.
 */
export function openUIActionRef(cardId: string, actionId: string): string {
  return `plan:${encodeURIComponent(cardId)}:${encodeURIComponent(actionId)}`;
}
