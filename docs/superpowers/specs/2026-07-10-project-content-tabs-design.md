# 项目内容 Tab 组件拆分设计

## 背景

项目详情当前使用 shadcn Tabs，但只有任务 Tab 可用，任务工具栏、视图切换和表格仍全部定义在 `projects-page.tsx`。话题、群组和成员后续会承载复杂功能，需要在继续实现前建立清晰的组件边界。

## 目标

- 任务、话题、群组和成员四个 Tab 均可选择。
- 每个 Tab 使用独立组件文件，不把具体内容继续堆叠在 `projects-page.tsx`。
- 保留现有任务页面的视觉和静态交互。
- 话题、群组和成员当前显示居中的“待完善”占位内容。
- 共享项目类型不依赖页面组件。

## 非目标

- 不实现话题、群组或成员的真实业务功能。
- 不接入项目后端接口或持久化 Tab 状态。
- 不改变项目 Sidebar、Header 和任务数据内容。
- 不新增前端测试。

## 组件结构

项目内容组件放在 `client-web/src/components/projects/`：

- `project-tasks-tab.tsx`：任务工具栏、任务视图切换、任务表格及任务行。
- `project-topics-tab.tsx`：话题占位内容。
- `project-groups-tab.tsx`：群组占位内容。
- `project-members-tab.tsx`：成员占位内容。
- `project-types.ts`：`ProjectMember` 和 `ProjectTask` 共享类型。

`projects-page.tsx` 保留项目列表、项目 Header、Tab 导航和 mock 项目数据，只负责把当前项目数据传给对应内容组件。

## Tabs 行为

Tabs 默认值保持为 `tasks`。四个 `TabsTrigger` 都可点击，并分别对应一个 `TabsContent`：

- `tasks` 渲染 `ProjectTasksTab`，接收当前项目的 `tasks`。
- `topics` 渲染 `ProjectTopicsTab`。
- `groups` 渲染 `ProjectGroupsTab`。
- `members` 渲染 `ProjectMembersTab`。

项目切换时，现有的 `ProjectPanel` key 会重新挂载详情面板，因此 Tab 自动回到任务页，不增加额外状态。

## 布局

四个内容组件都占满 Tab 下方的剩余空间。任务页保持当前工具栏和可滚动表格区域；其余三个组件使用空白背景，在内容区域水平和垂直居中显示弱化文字“待完善”。

## 验证

- 运行 `pnpm typecheck`。
- 运行 `pnpm lint`。
- 运行 `pnpm build`。
- 确认四个 Tab 可切换，任务内容保持不变，三个占位页均正确显示。
