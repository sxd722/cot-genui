import { isAssignmentStatement, referencedStatementIds, splitOpenUIStatements, type OpenUIStatement } from "./statements";

export interface OpenUICardSlice {
  bodyRef: string;
  statementIds: string[];
  editableIds: string[];
  sharedIds: string[];
  source: string;
}

function dependencyClosure(bodyRef: string, byId: Map<string, OpenUIStatement>): Set<string> {
  const closure = new Set<string>();
  const knownIds = new Set(byId.keys());
  const visit = (id: string) => {
    if (closure.has(id)) return;
    const statement = byId.get(id);
    if (!statement) return;
    closure.add(id);
    referencedStatementIds(statement, knownIds).forEach(visit);
  };
  visit(bodyRef);
  return closure;
}

export function extractCardSlice(code: string, cardIndex: number): OpenUICardSlice {
  const statements = splitOpenUIStatements(code).filter(isAssignmentStatement);
  const byId = new Map(statements.map((statement) => [statement.id, statement]));
  const bodyRef = `card_${cardIndex}_body`;
  if (!byId.has(bodyRef)) throw new Error(`找不到目标卡片 body：${bodyRef}`);

  const targetClosure = dependencyClosure(bodyRef, byId);
  const otherClosures = statements
    .filter((statement) => /^card_\d+_body$/.test(statement.id) && statement.id !== bodyRef)
    .map((statement) => dependencyClosure(statement.id, byId));
  const shared = new Set([...targetClosure].filter((id) => otherClosures.some((closure) => closure.has(id))));
  const ordered = statements.filter((statement) => targetClosure.has(statement.id));
  return {
    bodyRef,
    statementIds: ordered.map((statement) => statement.id),
    editableIds: ordered.map((statement) => statement.id).filter((id) => !shared.has(id)),
    sharedIds: ordered.map((statement) => statement.id).filter((id) => shared.has(id)),
    source: ordered.map((statement) => statement.source).join("\n"),
  };
}

function assertSafeNewIdentifier(id: string) {
  if (id === "root" || /^card_\d+$/.test(id) || /^card_\d+_body$/.test(id)) {
    throw new Error(`patch 不得新增或覆盖 shell 标识符：${id}`);
  }
}

export function mergeOpenUIPatch(code: string, patch: string, allowedExistingIds: ReadonlySet<string>): string {
  const current = splitOpenUIStatements(code).filter(isAssignmentStatement);
  const currentById = new Map(current.map((statement) => [statement.id, statement]));
  const patchStatements = splitOpenUIStatements(patch);
  if (!patchStatements.length) throw new Error("模型未返回可合并的 statement patch");
  if (patchStatements.some((statement) => !isAssignmentStatement(statement))) {
    throw new Error("patch 只能包含 OpenUI assignment statements");
  }

  const seen = new Set<string>();
  const replacements: Array<{ start: number; end: number; source: string }> = [];
  const additions: string[] = [];
  for (const statement of patchStatements) {
    if (seen.has(statement.id)) throw new Error(`patch 重复定义：${statement.id}`);
    seen.add(statement.id);
    const existing = currentById.get(statement.id);
    if (existing) {
      if (!allowedExistingIds.has(statement.id)) throw new Error(`patch 越界修改：${statement.id}`);
      replacements.push({ start: existing.start, end: existing.end, source: statement.source });
    } else {
      assertSafeNewIdentifier(statement.id);
      additions.push(statement.source);
    }
  }

  let merged = code;
  replacements.sort((left, right) => right.start - left.start).forEach((replacement) => {
    merged = `${merged.slice(0, replacement.start)}${replacement.source}${merged.slice(replacement.end)}`;
  });
  if (additions.length) merged = `${merged.trimEnd()}\n${additions.join("\n")}`;
  return merged.trim();
}

