/**
 * tool_call 参数校验。
 * 依据 ToolDefinition.parameters.required 判断 tool_call 参数是否完整；不完整时返回
 * 一段面向模型的中文失败提示，上层会把它作为 tool_result 回注，让模型下一轮自己修正。
 * 未知工具 / 无 required 定义时返回 null，不阻断主链路。
 *
 * 修复依据：小模型（9B Q4）在零推理预算下经常输出不带参数的 tool_call，直接执行会
 * 退化为 `bash -c ""` 没输出，模型幻觉为"沙箱吞输出"（参见记忆 63ca63e4、0f7e626e）。
 */

function isEmptyArgValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length === 0;
  }
  return false;
}

export function validateToolCallArgs(
  call: { name: string; args?: unknown },
  defs: { name: string; parameters: unknown }[],
): string | null {
  const def = defs.find((t) => t.name === call.name);
  if (!def) return null;
  const paramsObj =
    def.parameters && typeof def.parameters === "object" && !Array.isArray(def.parameters)
      ? (def.parameters as { required?: unknown })
      : null;
  const rawRequired = paramsObj ? paramsObj.required : undefined;
  if (!Array.isArray(rawRequired) || rawRequired.length === 0) return null;
  const rawArgs = call.args;
  const args: Record<string, unknown> =
    rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
  const missing: string[] = [];
  for (const field of rawRequired) {
    if (typeof field !== "string") continue;
    if (isEmptyArgValue(args[field])) missing.push(field);
  }
  if (missing.length === 0) return null;
  const received = JSON.stringify(rawArgs ?? {});
  return `工具 ${call.name} 缺必填参数: ${missing.join(", ")}（实际收到 arguments=${received}）。请重新调用并在参数里填入具体值，不要交空对象。`;
}
