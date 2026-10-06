import type { OpenNativeAIProvider } from "@opennativeai/shared";

export const OPENNATIVEAI_MODE_OPTION_LABEL_IDS: Record<OpenNativeAIProvider, Record<string, string>> = {
  glm: {
    build: "mode.label.glm.build",
    edit: "mode.label.glm.edit",
    plan: "mode.label.glm.plan",
    yolo: "mode.label.glm.yolo",
  },
};

export const OPENNATIVEAI_MODE_OPTION_DESCRIPTION_IDS: Record<OpenNativeAIProvider, Record<string, string>> = {
  glm: {
    build: "mode.description.glm.build",
    edit: "mode.description.glm.edit",
    plan: "mode.description.glm.plan",
    yolo: "mode.description.glm.yolo",
  },
};
