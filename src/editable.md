好的，我们来深入分析和讲解 ProseMirror 中 `editable` 的设计思路与方法论。

`editable` 在 ProseMirror 中绝不是一个简单的布尔开关。它是一个贯穿整个视图（View）层、多层次、精细化的权限控制系统。其设计思想完美体现了 ProseMirror 在处理 `contenteditable` 这一“沼泽地”时务实而优雅的工程哲学。

### 核心方法论：从“全局”到“局部”的层级化权限控制

ProseMirror 没有将“可编辑性”视为一个单一属性，而是将其分解为一个立体的、可层层否决的权限模型。这个模型至少包含四个关键层次，从宏观到微观，逐级收紧控制权。

---

### 第一层：全局开关 - `EditorProps.editable`

这是最顶层的控制，决定了整个编辑器的基本状态。

- **作用**: 控制整个编辑器实例是否可编辑。
- **实现**:
  1.  **设置 DOM 属性**: 在 `EditorView` 初始化和更新时，会调用 `getEditable(this)` 函数（`/Users/bytedance/coding/pm/prosemirror-view/src/index.ts:654`）。这个函数会检查 `editable` prop。如果返回 `false`，ProseMirror 会在编辑器的根 DOM 元素上设置 `contenteditable="false"`。这是最直接的浏览器层面的“只读”实现。
  2.  **作为内部状态**: `view.editable` 属性被缓存起来，成为后续所有权限检查的第一个、也是最重要的依据。

```typescript
// ...existing code...
function getEditable(view: EditorView) {
  return !view.someProp('editable', value => value(view.state) === false)
}
// ...existing code...
```

- **设计思路**:
  - **提供最高优先级**: 这是最简单、最明确的控制方式，满足了“整个文档设为只读”这一最常见的需求。
  - **支持动态性**: `editable` prop 可以是一个返回布尔值的函数 `(state) => boolean`。这意味着“可编辑性”可以依赖于应用的状态（例如，用户的权限、文档的审批状态等），并在 `view.update()` 时动态改变。

---

### 第二层：事件分发器 - input.ts 中的 `editHandlers`

这是 ProseMirror 设计中的一个精髓。它在事件处理的入口处就对“编辑性”和“非编辑性”的**用户意图**进行了分类。

- **作用**: 即使在 `view.editable` 为 `true` 的情况下，也能区分哪些事件**意图修改文档**，哪些只是**导航或交互**。
- **实现**:

  - 在 `input.ts` 中，事件处理器被分为两类：`handlers`（所有事件）和 `editHandlers`（仅包含会产生编辑行为的事件，如 `keydown`, `paste`, `cut`, `drop`）。
  - 在 `initInput` 中添加事件监听器时，有这样一行关键的守卫代码：

  ```typescript
  // filepath: /Users/bytedance/coding/pm/prosemirror-view/src/input.ts
  // ...existing code...
  if (
    eventBelongsToView(view, event) &&
    !runCustomHandler(view, event) &&
    (view.editable || !(event.type in editHandlers)) // 关键检查
  )
    handler(view, event)
  // ...existing code...
  ```

- **设计思路**:
  - **意图分离**: 这行代码的逻辑是：“**如果编辑器是可编辑的，或者，即使不可编辑，当前事件也不属于编辑类事件，那么就执行它。**”
  - **优雅的只读体验**: 这使得在只读模式下（`view.editable` 为 `false`），用户依然可以进行非编辑操作，例如：
    - 点击以移动光标（`mousedown` 不在 `editHandlers` 中）。
    - 选中文字并复制（`copy` 在 `handlers` 中，但 `cut` 在 `editHandlers` 中）。
    - 聚焦/失焦编辑器。
  - 相比于简单粗暴地禁用所有事件，这种设计提供了更友好、更符合直觉的只读交互体验。

---

### 第三层：节点级控制 - `NodeView` 与 `contenteditable="false"`

这是实现“文档部分区域不可编辑”的核心机制，例如在一个文档中嵌入一个不可修改的 mention 标签或一个复杂的自定义组件。

- **作用**: 将编辑器 DOM 树中的某个或某些部分标记为不可编辑的“孤岛”。
- **实现**:

  1.  **NodeView 的角色**: 当 ProseMirror 渲染文档节点时，它会检查是否为该节点类型提供了自定义的 `NodeView`。
  2.  **自动设置**: 如果没有提供 `NodeView`，ProseMirror 的默认渲染逻辑（在 `viewdesc.ts` 中）会对非文本、非叶子节点自动添加 `contenteditable="false"` 属性。这是为了防止用户意外地将光标移入并破坏由 ProseMirror 管理的复杂节点结构。
  3.  **手动设置**: 在自定义 `NodeView` 时，开发者可以完全控制其 DOM 结构，并可以（也应该）在最外层容器上设置 `contenteditable="false"`。

- **设计思路**:
  - **利用浏览器原生机制**: `contenteditable="false"` 是 `contenteditable` 规范的一部分，浏览器原生支持在一个可编辑区域内创建不可编辑的子区域。ProseMirror 充分利用了这一特性。
  - **封装与隔离**: `NodeView` 的设计理念就是将一个 ProseMirror 节点及其对应的 DOM 结构封装成一个独立的、自洽的组件。将其设为 `contenteditable="false"` 可以有效保护其内部 DOM 不被外部的编辑操作所干扰，确保数据流的单向性（State -> View）。
  - **事件拦截**: `NodeView` 还可以通过 `stopEvent` 方法来阻止特定事件从其内部冒泡到 `EditorView`，从而实现更精细的交互控制。

---

### 第四层：操作的“逃生舱” - 临时解除限制

这是 ProseMirror 应对浏览器怪异行为的务实之举，体现了其设计的灵活性和对现实世界复杂性的妥协。

- **作用**: 在某些特殊情况下，为了完成一个合法的操作（通常是选区操作），需要临时、短暂地将一个不可编辑的元素变为可编辑。
- **实现**:

  - 在 `selection.ts` 中，有一个名为 `temporarilyEditableNear` 的函数。
  - **场景**: 当试图将光标（DOM Selection）放置在一个 `contenteditable="false"` 的节点旁边时，很多浏览器会失败或行为异常。
  - **解决方案**: `temporarilyEditableNear` 会找到这个不可编辑的节点，通过 `setEditable` 函数（`/Users/bytedance/coding/pm/prosemirror-view/src/selection.ts:123`）将其 `contenteditable` 临时设为 `true`。在 `selectionToDOM` 完成选区设置后，会立即通过 `resetEditable`（`/Users/bytedance/coding/pm/prosemirror-view/src/selection.ts:127`）将其恢复为 `false`。

- **设计思路**:
  - **实用主义至上**: 承认 `contenteditable` 的不完美，并寻找最直接有效的 hack 手段来绕过它，而不是试图构建一个“纯粹”但无法在所有浏览器上正常工作的系统。
  - **最小化副作用**: 这种修改是瞬时的、同步的，并且有明确的恢复机制，将副作用控制在最小范围内。

### 总结：`editable` 的设计方法论

1.  **分层授权 (Layered Permissions)**: 将单一的“可编辑”概念分解为全局、事件、节点等多个层次，每一层都可以独立控制，下层服从上层，实现了从粗到细的权限管理。
2.  **意图驱动 (Intent-Driven)**: 通过 `editHandlers` 的设计，ProseMirror 不仅仅关心事件本身，更关心事件背后的**用户意图**（是想修改内容还是只想交互），从而实现了更智能、更人性化的只读模式。
3.  **封装与隔离 (Encapsulation and Isolation)**: 利用 `NodeView` 和 `contenteditable="false"`，将文档中的复杂部分封装成不可侵犯的“黑盒”，保护了视图层与数据层的一致性。
4.  **务实的妥协 (Pragmatic Compromise)**: 在理想的架构和浏览器的现实行为之间，ProseMirror 选择了务实。它不回避使用临时的 hack 手段（如 `temporarilyEditableNear`）来解决实际问题，确保了最终的用户体验。

综上所述，ProseMirror 的 `editable` 设计是一个多层次、上下文感知、高度可扩展且务实的系统，它是在与 `contenteditable` 这个“野兽”长期搏斗后沉淀下来的宝贵工程经验。
