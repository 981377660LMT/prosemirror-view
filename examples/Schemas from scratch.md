好的，我们来详细讲解一下这个关于“从零开始创建 Schema”（Schemas from scratch）的示例。

这个文档通过三个逐步复杂的例子，深入地解释了 ProseMirror 的核心概念——**Schema（模式）**。Schema 就像一篇文档的“语法规则”，它定义了哪些节点和标记是合法的，以及它们之间如何组合。

---

### 示例一：最简单的 `textSchema`

```javascript
const textSchema = new Schema({
  nodes: {
    text: {},
    doc: { content: 'text*' }
  }
})
```

这是最基础的 Schema，它只定义了两种节点：

1.  `text`: 这是 ProseMirror 内置的一种特殊节点类型，代表纯文本。它不需要任何额外配置。
2.  `doc`: 这是每个 Schema 都必须有的**根节点**，代表整个文档。
    - `content: "text*"`: 这是**内容表达式（Content Expression）**，是 Schema 的核心。它使用一种类似正则表达式的语法来描述该节点可以包含哪些子节点。
      - `text` 指的是 `text` 节点。
      - `*` 表示 `text` 节点可以出现零次或多次。
      - 所以，`"text*"` 意味着 `doc` 节点可以直接包含任意数量的文本，但不能有其他任何块级结构（如段落）。这实际上创建了一个只能编辑单行内联内容的编辑器。

---

### 示例二：包含块级节点的 `noteSchema`

这个例子引入了块级结构，创建了一个类似待办事项列表的编辑器。

```javascript
const noteSchema = new Schema({
  nodes: {
    text: {},
    note: {
      content: 'text*',
      toDOM() {
        return ['note', 0]
      },
      parseDOM: [{ tag: 'note' }]
    },
    notegroup: {
      content: 'note+',
      toDOM() {
        return ['notegroup', 0]
      },
      parseDOM: [{ tag: 'notegroup' }]
    },
    doc: {
      content: '(note | notegroup)+'
    }
  }
})
```

#### 节点定义：

- `note`: 一个“笔记”节点。
  - `content: "text*"`: 每个 `note` 节点内部可以包含任意文本。
  - `toDOM()`: 定义如何将此节点渲染为 DOM。`["note", 0]` 表示渲染成一个 `<note>` 标签，`0` 是一个“内容洞”，表示此节点的子节点应该被渲染到这个位置。
  - `parseDOM`: 定义如何从 DOM 解析回此节点。`[{tag: "note"}]` 表示任何 `<note>` 标签都应该被解析成一个 `note` 节点。
- `notegroup`: 一个“笔记组”节点。
  - `content: "note+"`: 内容表达式。`+` 表示 `note` 节点必须出现**一次或多次**。这意味着一个 `notegroup` 不能为空，必须至少包含一个 `note`。
- `doc`: 根节点。
  - `content: "(note | notegroup)+"`: 内容表达式。
    - `|` 表示“或”。
    - `()` 用于分组。
    - 所以，`doc` 节点可以直接包含一个或多个 `note` 节点**或** `notegroup` 节点。

#### 命令（Command）：`makeNoteGroup`

这个例子还展示了如何创建一个自定义命令来将选中的多个 `note` 包装进一个 `notegroup`。

```javascript
function makeNoteGroup(state, dispatch) {
  // 1. 获取选中块的范围
  let range = state.selection.$from.blockRange(state.selection.$to)
  // 2. 检查是否可以将此范围包装成 notegroup
  let wrapping = findWrapping(range, noteSchema.nodes.notegroup)
  if (!wrapping) return false
  // 3. 如果可以，则执行包装操作
  if (dispatch) dispatch(state.tr.wrap(range, wrapping).scrollIntoView())
  return true
}
```

- `$from.blockRange($to)`: 获取一个能完整包裹当前选区中所有块级节点的范围。
- `findWrapping(range, nodeType)`: ProseMirror 的一个强大辅助函数。它会检查给定的 `range` 是否可以被指定的 `nodeType`（这里是 `notegroup`）所包裹，如果可以，它会返回一个描述如何进行包裹的对象。
- `tr.wrap(range, wrapping)`: 在事务中应用这个包裹操作。

---

### 示例三：包含组和标记的 `starSchema`

这个例子最复杂，也最全面，引入了**组（groups）**和**标记（marks）**的概念。

```javascript
let starSchema = new Schema({
  nodes: {
    text: { group: "inline" },
    star: { inline: true, group: "inline", ... },
    paragraph: { group: "block", content: "inline*", ... },
    boring_paragraph: { group: "block", content: "text*", marks: "", ... },
    doc: { content: "block+" }
  },
  marks: {
    shouting: { ... },
    link: { ... }
  }
})
```

#### 节点和组（Groups）：

- **`group: "inline"`**: `text` 和 `star` 节点都被标记为属于 `"inline"` 组。
- **`group: "block"`**: `paragraph` 和 `boring_paragraph` 节点都被标记为属于 `"block"` 组。
- **`content: "inline*"`**: `paragraph` 节点的内容表达式现在可以使用组名。`"inline*"` 意味着它可以包含任意数量的、属于 `"inline"` 组的节点（即 `text` 或 `star`）。这比写 `"text* | star*"` 要简洁得多，也更具扩展性。
- **`content: "block+"`**: `doc` 节点的内容表达式现在可以引用 `"block"` 组，意味着它可以包含任意属于 `"block"` 组的节点。

#### 标记（Marks）：

标记是附加在内联内容上的一种信息，比如粗体、斜体、链接。它们不改变文档结构，只“标记”一段文本。

- `boring_paragraph`:
  - `marks: ""`: 这个属性非常重要。默认情况下，所有允许内联内容的节点都允许所有已定义的标记。通过将 `marks` 设置为空字符串，`boring_paragraph` **显式地禁止**了任何标记，所以它内部的文本不能被加粗或添加链接。
- `shouting` mark:
  - 一个简单的标记，类似于粗体。它没有属性，只是简单地将文本包裹在 `<shouting>` 标签中。
- `link` mark:
  - 一个带有属性的标记。
  - `attrs: {href: {}}`: 定义了一个名为 `href` 的必需属性。
  - `toDOM(node)`: 渲染时，需要从 `node.attrs.href` 中读取链接地址并设置到 `<a>` 标签的 `href` 属性上。
  - `parseDOM`: 解析时，需要用 `getAttrs` 从 `<a>` 标签上提取 `href` 属性。
  - `inclusive: false`: 这是一个重要的概念。
    - **Inclusive (包含性) Marks (默认)**: 当你在一个被标记的范围末尾输入文字时，新输入的文字会自动应用相同的标记。例如，在加粗文本的末尾继续打字，新字也是粗体。
    - **Non-inclusive Marks**: 将 `inclusive` 设为 `false` 后，在标记范围的末尾输入文字，新文字**不会**应用该标记。这对于链接非常合适，因为你通常不希望在链接的末尾继续输入时，新文字也成为链接的一部分。

#### 命令（Commands）：

- `toggleMark`: ProseMirror 提供的一个内置命令，用于切换标记的开关状态。对于简单的 `shouting` 标记，可以直接使用 `toggleMark(starSchema.marks.shouting)`。
- `toggleLink`: 对于 `link` 这种需要额外信息（URL）的标记，需要自定义命令。
  - `doc.rangeHasMark(...)`: 检查当前选区是否已经有了链接标记。
  - 如果没有，就 `prompt` 用户输入 URL。
  - 最后，调用 `toggleMark` 并传入 `attrs` 对象来添加或移除链接。
- `insertStar`: 插入一个 `star` 节点。
  - `$from.parent.canReplaceWith(...)`: 在执行操作前，先检查 Schema 规则是否允许在当前位置插入一个 `star` 节点。这是一个非常好的实践，可以防止创建无效的文档状态。

### 总结

这个文档通过三个层次递进的例子，系统地讲解了如何构建 ProseMirror Schema：

1.  **基础**: 所有 Schema 都需要 `doc` 和 `text` 节点，并使用**内容表达式**定义节点间的关系。
2.  **块级结构**: 通过定义 `toDOM` 和 `parseDOM`，可以创建自定义的块级和内联节点，并用内容表达式（如 `+`, `*`, `|`, `()`）来约束它们的组合方式。
3.  **组和标记**:
    - **组（Groups）**提供了一种强大的方式来分类节点，简化内容表达式。
    - **标记（Marks）**用于为内联内容添加样式和元数据，可以通过 `attrs` 定义属性，并通过 `inclusive` 控制其行为。

理解并熟练运用 Schema 是掌握 ProseMirror 的关键，因为它决定了你的编辑器的能力边界和所有编辑操作的基础。
