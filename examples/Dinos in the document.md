好的，我们来详细讲解一下这段关于在 ProseMirror 中创建自定义节点的“恐龙”示例。

### 核心目标

这个示例的核心目标是演示如何**扩展 ProseMirror 的文档结构（Schema）**，以支持一种全新的、自定义的节点类型。在这里，这种自定义节点被趣味性地命名为“恐龙”（dino）。

这在实际应用中非常有用，比如你需要在文档中插入：

- 一个指向系统中其他对象（如用户、任务、文件）的引用（@mention）。
- 一个特殊的、可交互的领域特定小部件（如一个股票代码、一个数学公式）。
- 任何不属于标准文本格式的自定义内容。

### 关键技术：`Schema` 和 `NodeSpec`

ProseMirror 的核心是其 **Schema（模式）**。Schema 定义了哪些类型的节点（如段落、标题、图片）和标记（如粗体、斜体）是合法的，以及它们之间如何嵌套。

要创建一个新的节点类型，你需要定义一个 **`NodeSpec`**（节点规范）对象，它描述了该节点的一切。

### `dinoNodeSpec` 详解

这是创建自定义节点的第一步，也是最关键的一步。它是一个描述“恐龙”节点行为和表现的对象。

```javascript
const dinoNodeSpec = {
  // ... 属性 ...
}
```

我们来逐一分析它的属性：

- `attrs: {type: {default: "brontosaurus"}}`:

  - `attrs` (Attributes) 定义了该节点可以拥有的属性，类似于 HTML 标签的属性。
  - 这里我们定义了一个名为 `type` 的属性，它用来区分是哪种恐龙。
  - `default: "brontosaurus"` 指定了如果没有提供 `type` 属性，默认就是“雷龙”。

- `inline: true`:

  - 这声明了“恐龙”是一个**内联（inline）节点**。
  - 这意味着它会和文本在同一行内流动，就像一个单词或一个表情符号（emoji）一样，而不是像段落或标题那样独占一行（块级节点）。

- `group: "inline"`:

  - 将此节点归类到 "inline" 组中。Schema 使用组来定义内容规则（例如，一个段落可以包含 "inline" 组中的任何节点）。

- `draggable: true`:

  - 允许用户通过鼠标拖放来移动这个节点。

- `toDOM: node => [...]`:

  - **非常重要**。这个函数定义了如何将 ProseMirror 内部的节点对象**渲染**成一个真实的 DOM 元素。
  - 它接收一个 `node` 对象作为参数。
  - 它返回一个数组，描述了要创建的 DOM 结构：`["img", { ...attributes... }]`。这会被 ProseMirror 转换成一个 `<img>` 标签。
  - 注意 `src` 和 `title` 等属性是如何通过 `node.attrs.type` 动态生成的。这正是 `attrs` 的用处。

- `parseDOM: [{...}]`:
  - **非常重要**。这是 `toDOM` 的逆向操作。它定义了如何将一个 DOM 元素**解析**回 ProseMirror 的节点对象。这在从 HTML 粘贴内容或加载初始内容时非常关键。
  - `tag: "img[dino-type]"`: 这是一个 CSS 选择器。它告诉解析器，任何带有 `dino-type` 属性的 `<img>` 标签都可能是一个“恐龙”节点。
  - `getAttrs: dom => {...}`: 当找到一个匹配的 DOM 元素时，这个函数被调用来提取节点的属性。它从 DOM 元素上获取 `dino-type` 属性的值，检查它是否是已知的恐龙类型之一。如果是，就返回包含 `type` 属性的对象；如果不是，返回 `false`，解析器就会忽略这个 DOM 标签。

### 步骤分解

现在我们来看一下将这个自定义节点集成到编辑器中的完整步骤。

#### 1. 创建新 Schema (`dinoSchema`)

我们不能直接修改现有的 `schema`，而是需要基于它创建一个新的 `dinoSchema`。

```javascript
const dinoSchema = new Schema({
  nodes: schema.spec.nodes.addBefore('image', 'dino', dinoNodeSpec),
  marks: schema.spec.marks
})
```

- `schema.spec.nodes` 获取了基础 schema 中所有节点的定义。
- `.addBefore("image", "dino", dinoNodeSpec)` 是一个辅助方法，它在现有的 "image" 节点之前，添加了一个名为 "dino" 的新节点，其定义就是我们上面创建的 `dinoNodeSpec`。
- `marks` 保持不变，我们继续使用基础 schema 的所有标记（粗体、斜体等）。

#### 2. 创建插入命令 (`insertDino`)

我们需要一种方式来告诉编辑器在光标位置插入一个新的恐龙。这就是“命令”（Command）的作用。

```javascript
function insertDino(type) {
  return function (state, dispatch) {
    // ...
    if (dispatch) dispatch(state.tr.replaceSelectionWith(dinoType.create({ type })))
    return true
  }
}
```

- 这是一个返回命令函数的高阶函数。`insertDino("triceratops")` 会返回一个专门用于插入三角龙的命令。
- `state.tr.replaceSelectionWith(...)` 是核心操作。它创建一个事务（`tr`），用一个新的节点替换掉当前的选区（通常是光标）。
- `dinoType.create({type})` 使用 schema 中的节点类型 (`dinoType` 就是 `dinoSchema.nodes.dino`) 来创建一个新的恐龙节点实例，并传入 `type` 属性。
- `dispatch(...)` 执行这个事务，更新编辑器状态。

#### 3. 创建菜单项

为了让用户能方便地使用 `insertDino` 命令，我们为每种恐龙创建一个菜单项。

```javascript
dinos.forEach(name =>
  menu.insertMenu.content.push(
    new MenuItem({
      // ...
      run: insertDino(name)
    })
  )
)
```

这段代码遍历了所有恐龙的名字，为每一种都创建了一个 `MenuItem`。关键在于 `run` 属性，它被设置为我们刚刚创建的 `insertDino(name)` 命令。当用户点击这个菜单项时，对应的命令就会被执行。

#### 4. 初始化编辑器

最后一步，用我们自定义的 `dinoSchema` 和包含新菜单项的 `menuContent` 来创建 `EditorView`。

```javascript
window.view = new EditorView(document.querySelector('#editor'), {
  state: EditorState.create({
    doc: startDoc,
    plugins: exampleSetup({ schema: dinoSchema, menuContent: menu.fullMenu })
  })
})
```

通过向 `exampleSetup` 插件传递我们自定义的 `schema` 和 `menuContent`，ProseMirror 就会知道如何理解、渲染、解析和插入我们的“恐龙”节点。

### 总结

这个例子清晰地展示了 ProseMirror 强大的可扩展性。通过以下四个步骤，你可以向编辑器中添加任何你需要的自定义内容：

1.  **定义 `NodeSpec`**: 描述节点的属性、DOM 表现形式以及如何从 DOM 解析。
2.  **创建新 `Schema`**: 将你的 `NodeSpec` 集成到 schema 中。
3.  **编写 `Command`**: 创建用于操作（如插入）新节点的逻辑。
4.  **集成到 UI**: 将命令绑定到菜单、按钮或快捷键上，并使用自定义的 schema 初始化编辑器。
