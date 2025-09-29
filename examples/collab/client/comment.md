好的，我们来详细讲解 comment.js 这个文件。

这个文件非常巧妙，它在主文档的协同编辑系统之外，**独立实现了一套完整的、平行的协同系统，专门用于管理评论**。这展示了 ProseMirror 协同模型的灵活性和可扩展性。

### 核心思想：将评论作为 `Decoration`

与将内容直接写入文档不同，评论在这里被实现为**装饰（Decorations）**。

- **优点**:
  1.  **内容与元数据分离**: 评论不属于文档的“正式”内容，它们是附加在内容之上的元数据。将它们作为 Decoration 可以保持主文档的纯净。
  2.  **灵活的渲染**: Decoration 允许你用任意的 DOM 结构来渲染评论，比如高亮文本、弹出气泡等，而不会影响文档的结构。
- **实现**:
  - `deco(from, to, comment)` 函数创建了一个 `Decoration.inline`。
  - 它将从 `from` 到 `to` 的文本用一个带有 `comment` CSS 类的 `<span>` 包裹起来，实现高亮。
  - 最关键的是，它通过 `spec` 对象的第四个参数 `{ comment }`，将 `Comment` 对象实例直接附加到了这个 Decoration 上。这使得之后可以轻松地从 Decoration 中取回评论数据。

---

### `CommentState` 类：评论系统的“大脑”

这个类是评论插件的状态核心，其设计与主协同逻辑中的 `TrackState` 和 `EditorConnection` 的状态部分非常相似，都遵循了持久化数据结构和版本控制的思想。

#### 属性:

- `version`: 数字，表示当前评论集所基于的服务器版本。
- `decos`: 一个 `DecorationSet`，存储了当前所有的评论装饰。这是唯一可信的数据源。
- `unsent`: 一个数组，存储了在本地创建或删除、但还未被服务器确认的评论操作。这与主协同系统中的 `unconfirmed steps` 概念完全相同。

#### `apply(tr)` 方法 - 状态更新的核心

这是评论状态机的 Reducer。每当有事务发生时，它会计算出新的 `CommentState`。

1.  **映射（Mapping）**: `decos = decos.map(tr.mapping, tr.doc)`。这是**至关重要**的一步。当主文档内容被编辑时（比如在评论区域前后插入或删除文本），这个 `map` 操作会自动更新所有评论 Decoration 的位置，确保它们始终附着在正确的文本上。
2.  **处理本地操作**:
    - 它通过 `tr.getMeta(commentPlugin)` 检查事务中是否有针对评论的 `action`。
    - `'newComment'`: 如果是创建新评论，它会创建一个新的 Decoration 并添加到 `decos` 中，同时将这个 `action` 存入 `unsent` 数组。
    - `'deleteComment'`: 如果是删除评论，它会从 `decos` 中移除对应的 Decoration，并将删除 `action` 存入 `unsent` 数组。
3.  **处理服务器事件 (`'receive'`)**:
    - 当从服务器拉取到新的评论事件时，会分发一个带有 `'receive'` action 的事务。
    - `apply` 方法会先调用 `this.receive(...)` 来处理这些外部事件。

#### `receive({ version, events, sent }, doc)` 方法

这个方法负责将从服务器收到的变更合并到本地状态中。

- 它遍历服务器发来的 `events` 数组。
- `'delete'`: 如果是删除事件，它会根据 `id` 找到并移除本地的 Decoration。
- `'create'`: 如果是创建事件，它会先检查本地是否已存在该 `id` 的评论（防止重复创建），然后创建一个新的 Decoration 并添加。
- **更新 `unsent`**: `this.unsent.slice(sent)`。`sent` 是一个数字，表示这次服务器响应确认了多少个你之前发送的 `unsent` 事件。通过 `slice` 操作，它将已经被服务器确认的事件从 `unsent` 队列中移除。
- 最后，它用服务器的最新 `version` 更新本地的 `version`。

#### `unsentEvents()` 方法

这个方法的作用是将 `unsent` 队列中的内部 `action` 对象，转换成准备发送给服务器的、标准化的事件格式（`{ type, id, from, to, text }`）。`collab.js` 会调用这个方法来获取需要推送给服务器的评论数据。

---

### `commentPlugin` - 核心插件

这是一个标准的 ProseMirror 插件，它将 `CommentState` 集成到编辑器中。

- `state`: 定义了插件的状态管理，`init` 和 `apply` 方法直接委托给了 `CommentState` 类。
- `props.decorations`: 告诉 ProseMirror：“请将我 state 中的 `decos` (`DecorationSet`) 渲染到编辑器视图中”。

---

### UI 部分

#### `addAnnotation` - 创建评论的命令

这是一个标准的 ProseMirror 命令。

- 当被调用时，它会弹出一个 `prompt` 对话框让用户输入评论文本。
- 然后，它创建一个事务，并通过 `setMeta` 将一个 `'newComment'` action 附加到事务上。
- 当这个事务被分发时，`commentPlugin` 的 `apply` 方法就会捕捉到这个 action，并更新评论状态。

#### `commentUI` 插件和 `commentTooltip` - 显示评论详情

这是一个独立的 UI 插件，专门负责在用户光标移动到评论上时，显示一个包含评论内容和删除按钮的工具提示（Tooltip）。

- `commentTooltip` 函数检查当前光标位置 (`sel.from`)。
- 它调用 `commentPlugin.getState(state).commentsAt(sel.from)` 来获取当前光标下的所有评论 Decoration。
- 如果找到了评论，它会创建一个 `Decoration.widget`。这个 widget 的内容就是通过 `renderComments` 函数动态创建的 DOM 元素（一个 `<ul>` 列表）。
- `renderComment` 函数为每条评论创建一个 `<li>`，并为其添加一个删除按钮。点击删除按钮会分发一个 `'deleteComment'` action，从而触发删除逻辑。

### 总结

comment.js 是一个设计精妙的模块，它展示了如何在一个 ProseMirror 应用中实现“第二套”协同系统：

1.  **平行的协同模型**: 它完整地复制了主文档协同的核心思想：版本号、未发送事件队列（`unsent`）、接收外部事件并与本地状态合并。
2.  **Decoration 作为数据载体**: 巧妙地利用 Decoration 不仅能改变外观，还能通过 `spec` 携带任意元数据的特性，将评论数据与文档位置绑定在一起。
3.  **关注点分离**:
    - `CommentState` 和 `commentPlugin` 负责核心的状态管理和数据同步逻辑。
    - `commentUI` 插件则完全负责 UI 的渲染（工具提示），它只读取 `commentPlugin` 的状态，并通过分发 action 来触发变更，实现了逻辑和视图的解耦。
4.  **与主文档的联动**: 通过 `decos.map(tr.mapping, tr.doc)`，评论系统能够自动响应主文档的结构变化，保持了数据的一致性。

这个文件是学习如何在 ProseMirror 中处理复杂元数据协同的绝佳范例。它告诉你，ProseMirror 的协同能力远不止同步文本，任何可以被结构化、版本化的数据，都可以用这套模型来进行协同编辑。
