export const RESULT_VIEWS = ["cardplan-markdown", "cardplan-json", "openui", "openui-source"] as const;
export type ResultView = (typeof RESULT_VIEWS)[number];
