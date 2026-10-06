import { z } from "zod";

/**
 * OpenNativeAI agent 提供方的单一真源。
 *
 * 类型 OpenNativeAIProvider、运行时 schema opennativeaiProviderSchema 都从这里派生,
 * 避免各处内联 z.enum([...]) 副本随新增/删除 provider 漂移。
 * 本模块只依赖 zod(叶子),可被 validation / opennativeai-protocol 等无环引用。
 */
const OPENNATIVEAI_PROVIDERS = ["glm"] as const;

export const opennativeaiProviderSchema = z.enum(OPENNATIVEAI_PROVIDERS);

export type OpenNativeAIProvider = (typeof OPENNATIVEAI_PROVIDERS)[number];
