这个文件是协同编辑示例中**评论功能的服务器端核心逻辑**。它与客户端的 `client/comment.js` 文件相对应，共同构成了一个完整的、独立于主文档协同之外的评论协同系统。它的职责是作为评论数据的**权威数据源（Source of Truth）**。

### 一、 核心设计思想

1.  **独立状态管理**: 评论数据（位置、文本、ID）及其变更历史被封装在 `Comments` 类中，与主文档的 `doc` 和 `steps` 分开管理。
2.  **独立版本控制**: `Comments` 类维护着自己的 `version` 号。每当有评论被创建或删除，这个版本号就会递增。这使得客户端可以像同步主文档一样，通过版本号来同步评论区的状态。
3.  **与主文档的联动**: 评论是依附于主文档特定范围的。当主文档内容发生变化时，评论的位置必须随之更新。`mapThrough` 方法就是实现这种联动的关键。
4.  **事件日志 (Event Sourcing)**: `Comments` 类不直接将评论对象发送给客户端，而是维护一个 `events` 数组，记录下每一次“创建”或“删除”操作。客户端通过拉取这些事件来更新自己的状态。

---

### 二、 `Comment` 类详解

这是一个非常简单的**数据模型类**，用于表示单个评论。

```javascript
class Comment {
  constructor(from, to, text, id) {
    this.from = from // 评论在文档中的起始位置
    this.to = to // 评论在文档中的结束位置
    this.text = text // 评论的文本内容
    this.id = id // 评论的唯一标识符
  }

  static fromJSON(json) {
    return new Comment(json.from, json.to, json.text, json.id)
  }
}
```

- `constructor`: 定义了一个评论所需的基本属性。
- `fromJSON`: 一个标准的辅助静态方法，用于从纯 JSON 对象反序列化成 `Comment` 类的实例。

---

### 三、 `Comments` 类详解

这是整个文件的核心，是所有评论数据的**管理器和状态机**。

#### `constructor(comments)`

```javascript
constructor(comments) {
  this.comments = comments || [] // 存储所有 Comment 对象的数组
  this.events = []               // 记录所有变更事件的日志
  this.version = 0               // 当前评论状态的版本号
}
```

构造函数初始化了三个关键属性，它们共同定义了一个文档实例中评论区的完整状态。

#### `mapThrough(mapping)` - 最关键的联动方法

```javascript
mapThrough(mapping) {
  for (let i = this.comments.length - 1; i >= 0; i--) {
    let comment = this.comments[i]
    let from = mapping.map(comment.from, 1), to = mapping.map(comment.to, -1)
    if (from >= to) {
      this.comments.splice(i, 1)
    } else {
      comment.from = from
      comment.to = to
    }
  }
}
```

这个方法是**实现评论与主文档内容同步的魔法所在**。

- **何时调用**: 当服务器上的主文档因应用了新的 `steps` 而发生变化时，`instance.js` 会调用这个方法，并将变更产生的 `mapping` 对象传递进来。
- **作用**: `mapping` 对象记录了主文档中所有坐标的变化。`mapThrough` 的任务就是遍历每一个评论，使用这个 `mapping` 来更新评论的 `from` 和 `to` 位置，确保它们在文档被编辑后仍然“粘”在正确的位置上。
- **`mapping.map(pos, bias)`**: 这是 ProseMirror 的核心功能。`bias` 参数（偏向）非常重要，它决定了当内容恰好在边界插入时，位置如何移动。
  - `bias: 1` (for `from`): 意味着如果内容在评论的起始位置插入，新的起始位置会移动到插入内容的后面。
  - `bias: -1` (for `to`): 意味着如果内容在评论的结束位置插入，新的结束位置会保持在插入内容的前面。
- **`if (from >= to)`**: 这个条件判断的是，经过映射后，评论的范围是否已经无效（例如，它所附着的文本被完全删除了）。如果是，那么这个评论就应该被删除。
- **倒序循环**: `for (let i = ...; i >= 0; i--)` 是一个标准技巧。当你在遍历一个数组的同时可能会删除其中的元素时，倒序遍历可以避免因数组长度变化而导致的索引错乱问题。

#### `created(data)` 和 `deleted(id)` - 处理变更

这两个方法用于响应客户端发来的创建和删除评论的请求。

```javascript
created(data) {
  this.comments.push(...)
  this.events.push({type: "create", id: data.id})
  this.version++
}

deleted(id) {
  // ... 找到并删除评论 ...
  this.version++
  this.events.push({type: "delete", id: id})
}
```

它们的逻辑非常清晰：

1.  修改 `this.comments` 数组（添加或删除）。
2.  在 `this.events` 日志中记录下这次操作（`"create"` 或 `"delete"`）。
3.  将 `this.version` 加一，表示状态已更新。

#### `eventsAfter(startIndex)` - 获取事件

```javascript
eventsAfter(startIndex) {
  let result = []
  for (let i = startIndex; i < this.events.length; i++) {
    let event = this.events[i]
    if (event.type == "delete") {
      result.push(event)
    } else { // event.type == "create"
      let found = this.index(event.id)
      if (found != null) {
        let comment = this.comments[found]
        result.push({type: "create", id: event.id, ...comment})
      }
    }
  }
  return result
}
```

这个方法是服务器向客户端提供更新的接口。

- **`startIndex`**: 客户端在轮询时会带上它已知的事件版本号，这个版本号就对应着 `events` 数组的索引。
- **逻辑**: 它从 `startIndex` 开始遍历 `events` 日志，并为客户端构建一个准备发送的事件列表 `result`。
- **数据补全**: 注意，`events` 日志中只记录了 `create` 事件的 `id`。当 `eventsAfter` 准备将一个 `create` 事件发送给客户端时，它会从当前的 `this.comments` 数组中找到这个评论的完整数据（`from`, `to`, `text`），并将其补全后放入 `result`。这确保了客户端总是能收到创建评论所需的全部信息。

### 四、 总结

comments.js 是服务器端数据管理的一个优秀范例。它与 `instance.js` 紧密协作，构成了评论功能的后端。

- **作为数据模型**: 它清晰地定义了评论的数据结构和状态（`Comment` 和 `Comments` 类）。
- **作为状态机**: 它通过 `created` 和 `deleted` 方法响应外部输入，并通过递增 `version` 来转换状态。
- **作为同步桥梁**:
  - 通过 `mapThrough`，它被动地响应主文档的变化，保持了自身数据与主文档的同步。
  - 通过 `eventsAfter`，它主动地向客户端提供增量更新，实现了评论区的协同。

理解了这个文件，就能明白 ProseMirror 的协同模型是如何被扩展，以支持除核心文档内容之外的、更丰富的协同功能的。
