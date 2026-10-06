import type { WorkspacePurpose, OpenNativeAITaskMeta } from "@opennativeai/shared";

export type OpenNativeAITaskListKind = "pinned" | "archived" | "timeline" | "active";
export type OpenNativeAITaskListSortBy = "created" | "updated";

export interface OpenNativeAITaskListWorkspaceScope {
  workspacePath: string;
  workspaceIdentity?: string;
  workspacePurpose?: WorkspacePurpose;
}

export interface OpenNativeAITaskListQuery {
  kind: OpenNativeAITaskListKind;
  workspaceScopes: OpenNativeAITaskListWorkspaceScope[];
  sortBy: OpenNativeAITaskListSortBy;
  search?: string;
  limit?: number;
}

export type OpenNativeAITaskListItem = OpenNativeAITaskMeta & {
  searchSnippet?: string;
  searchSnippets?: string[];
};

export interface OpenNativeAITaskListResult {
  items: OpenNativeAITaskListItem[];
  total: number;
  hasMore: boolean;
}

export type OpenNativeAITaskGroupColor =
  | "gray"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple";

export interface OpenNativeAITaskGroup {
  id: string;
  title: string;
  color: OpenNativeAITaskGroupColor;
  createdAt: number;
  updatedAt: number;
}

export interface OpenNativeAIGroupedTaskRef {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
}

export type OpenNativeAIGroupedTaskViewTopLevelNodeRef =
  | { type: "group"; groupId: string }
  | { type: "task"; task: OpenNativeAIGroupedTaskRef };

export type OpenNativeAIGroupedTaskViewNode =
  | {
      type: "group";
      group: OpenNativeAITaskGroup;
      tasks: OpenNativeAITaskListItem[];
      sortOrder?: number;
    }
  | {
      type: "task";
      task: OpenNativeAITaskListItem;
      sortOrder?: number;
    };

export interface OpenNativeAIGroupedTaskView {
  nodes: OpenNativeAIGroupedTaskViewNode[];
}

export interface OpenNativeAIGroupedTaskViewQuery {
  workspaceScopes: OpenNativeAITaskListWorkspaceScope[];
  includeAllWorkspaces?: boolean;
}

// ── grouped 原始结构（不 join tasks 表）──
// grouped 视图的任务数据源迁到 sessions-index 后，服务端只提供分组结构
// （task_groups / task_group_members / task_group_view_node_orders），
// 由客户端与 sessions-index 会话做 join。

/** 组成员引用（不含任务 meta；task 内容由 sessions-index 提供）。 */
export interface OpenNativeAIGroupedTaskViewStructureMember {
  groupId: string;
  /** 服务端口径 workspaceKey（resolveWorkspaceKey：identity ?? path），join 匹配键。 */
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
  /** null = 尚未落 sort_order（新加入组）；客户端按 addedAt 降序补内存序。 */
  sortOrder: number | null;
  addedAt: number;
}

/** 顶层节点排序（task_group_view_node_orders，node_key 已解析为结构化引用）。 */
export type OpenNativeAIGroupedTaskViewStructureTopOrder =
  | { type: "group"; groupId: string; sortOrder: number }
  | { type: "task"; workspaceKey: string; taskId: string; sortOrder: number };

export interface OpenNativeAIGroupedTaskViewStructure {
  /** 已按 workspaceScopes 可见性过滤的 group（bootstrap workspace group 只在其 workspace 可见）。 */
  groups: OpenNativeAITaskGroup[];
  /** 全量组成员（含不可见 group 的成员——顶层排除规则需要全量判断）。 */
  members: OpenNativeAIGroupedTaskViewStructureMember[];
  topLevelOrders: OpenNativeAIGroupedTaskViewStructureTopOrder[];
}

export interface OpenNativeAIGroupedTaskViewOrderInput {
  workspaceScopes: OpenNativeAITaskListWorkspaceScope[];
  topLevelNodes: OpenNativeAIGroupedTaskViewTopLevelNodeRef[];
  groups: Array<{
    groupId: string;
    taskRefs: OpenNativeAIGroupedTaskRef[];
  }>;
}

export interface OpenNativeAIWorkspaceEventSubscriptionParams {
  workspacePath: string;
  workspaceIdentity?: string;
}
