import type { OpenNativeAISessionFile, OpenNativeAITaskMeta } from "@opennativeai/shared";
import { opennativeaiSessionFileSchema, opennativeaiTaskMetaSchema, opennativeaiTaskModeSchema } from "@opennativeai/shared";

export type LegacyTaskSessionFile = Omit<OpenNativeAISessionFile, "meta"> & {
  meta: Omit<OpenNativeAITaskMeta, "mode"> & { mode?: OpenNativeAITaskMeta["mode"] };
};

const legacyTaskSessionFileSchema = opennativeaiSessionFileSchema.extend({
  // Claude 原生迁移会按清洗路径删除 meta.mode。
  // legacy snapshot 读取/写入仍要校验其它必需字段，但不能再强制把被过滤字段补回文件。
  meta: opennativeaiTaskMetaSchema.extend({
    mode: opennativeaiTaskModeSchema.optional(),
  }),
});

export function parseLegacyTaskSessionFile(input: unknown): LegacyTaskSessionFile {
  return legacyTaskSessionFileSchema.parse(input);
}

export function safeParseLegacyTaskSessionFile(input: unknown) {
  return legacyTaskSessionFileSchema.safeParse(input);
}
