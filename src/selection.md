好的，我们来深入讲解 selection.ts 这个文件。

这个文件是 ProseMirror 视图层的心脏之一，其重要性与 `input.ts` 和 `domchange.ts` 并驾齐驱。它的核心职责是充当**“翻译官”**和**“外交官”**，在 ProseMirror 内部抽象的、基于文档位置的 `Selection` 模型与浏览器混乱的、基于 DOM 节点的原生 `Selection` API 之间建立一座双向同步的桥梁。

### 核心设计思路：在两个世界之间进行精确翻译

ProseMirror 面临两个截然不同的“选区”世界：

1.  **ProseMirror 的世界（抽象、精确）**:

    - 选区由 prosemirror-state 定义，如 `TextSelection`, `NodeSelection`。
    - 位置由单一的、从 0 开始的整数表示（`pos`）。
    - `anchor` 和 `head` 都是精确的文档位置。
    - 这是一个纯粹的数据结构，与 UI 无关。

2.  **浏览器的世界（具体、混乱）**:
    - 选区由 `window.getSelection()` 返回。
    - 位置由 DOM 节点（`anchorNode`, `focusNode`）和节点内的偏移量（`anchorOffset`, `focusOffset`）表示。
    - 充满了各种浏览器的怪异行为（quirks），尤其是在 `contenteditable="false"` 的元素周围。

selection.ts 的核心任务就是在这两个世界之间进行无损、可靠的双向翻译。

---

### 第一部分：从 DOM 到 ProseMirror 的翻译 - `selectionFromDOM()`

这个函数负责**读取**浏览器当前的选区，并将其转换为一个 ProseMirror 的 `Selection` 对象。

- **触发时机**:

  - 当 `DOMObserver` 检测到 `selectionchange` 事件时。
  - 在处理完一次 DOM 变更后 (`readDOMChange`)，需要同步最新的选区状态。
  - 在处理某些输入事件（如鼠标点击）后，需要根据 DOM 的实际情况来更新 ProseMirror 的状态。

- **工作流程**:
  1.  **获取原生选区**: 通过 `view.domSelectionRange()` 获取浏览器的 `Selection` 对象。
  2.  **翻译坐标**: 调用 `view.docView.posFromDOM()`，将 DOM 坐标（`focusNode`, `focusOffset`）和（`anchorNode`, `anchorOffset`）分别翻译成 ProseMirror 的文档位置 `head` 和 `anchor`。这是整个流程中最关键也最复杂的一步，它需要遍历 `ViewDesc` 树来找到 DOM 节点对应的文档位置。
  3.  **处理特殊情况**:
      - **折叠选区（光标）**: 如果选区是折叠的（`selectionCollapsed(domSel)`），它会特别检查光标是否落在一个原子节点（atom node）上。如果是，它会创建一个 `NodeSelection` 来选中整个节点，而不是在节点旁边创建一个文本光标。
      - **多范围选区**: 在某些浏览器（如 Firefox）中，用户可以按住 `Ctrl/Cmd` 创建多个不连续的选区。ProseMirror 不支持这个概念，所以它会取所有范围的最小和最大位置，创建一个覆盖所有范围的单一 `TextSelection`。
  4.  **创建选区对象**:
      - 如果前面识别出了节点选区，则直接使用。
      - 否则，调用 `selectionBetween()` 来创建一个最合适的选区。`selectionBetween` 默认会创建 `TextSelection`，但也允许用户通过 `createSelectionBetween` prop 注入自定义的选区类型（例如 `prosemirror-tables` 的 `CellSelection`）。

---

### 第二部分：从 ProseMirror 到 DOM 的翻译 - `selectionToDOM()`

这个函数负责**写入**，将 ProseMirror `state.selection` 的状态同步到浏览器的可视化选区上。

- **触发时机**:

  - 当 `view.updateState()` 被调用，且新的 state 中包含了一个与旧 state 不同的选区时。
  - 当编辑器获得焦点时，需要确保 DOM 选区与 PM 状态一致。

- **工作流程**:
  1.  **权限检查 (`editorOwnsSelection`)**: 首先检查编辑器是否应该控制选区。如果编辑器不可编辑且没有焦点，或者焦点在编辑器外部，则不进行任何操作，避免干扰外部页面的选区。
  2.  **处理 `NodeSelection` (`syncNodeSelection`)**: 如果是节点选区，它不会去设置浏览器的范围选区，而是通过给节点的 DOM 添加/移除一个特定的 CSS 类（如 `ProseMirror-selectednode`）来高亮它。这是通过调用 `NodeViewDesc` 的 `selectNode`/`deselectNode` 方法实现的。
  3.  **处理 `TextSelection`**:
      - **翻译坐标**: 调用 `view.docView.setSelection()`，这个函数内部会调用 `domFromPos` 将 ProseMirror 的 `anchor` 和 `head` 位置反向翻译成 DOM 节点和偏移量。
      - **设置原生选区**: 使用 `domSel.removeAllRanges()` 和 `domSel.addRange()` 将计算出的 DOM 范围应用到浏览器。
  4.  **处理“隐藏选区”**: 如果 `sel.visible` 为 `false`（例如 prosemirror-gapcursor），它会给编辑器根节点添加 `ProseMirror-hideselection` 类，通过 CSS 隐藏原生选区，同时自己渲染一个模拟的光标。
  5.  **断开/连接 `DOMObserver`**: 在修改 DOM 选区前后，会临时断开和重连 `DOMObserver` 对 `selectionchange` 事件的监听。这是为了防止自己触发的选区变更又被自己捕获，从而造成无限循环。

---

### 第三部分：处理浏览器的“沼泽地” - `temporarilyEditableNear`

这是 selection.ts 中最能体现 `contenteditable` 开发之痛的部分，也是 ProseMirror 工程智慧的结晶。

- **问题背景 (`brokenSelectBetweenUneditable`)**: 在 Webkit 内核（Safari, 旧版 Chrome）中，你**无法**通过编程方式将选区的边界（`anchor` 或 `head`）设置在两个 `contenteditable="false"` 的块级节点之间。浏览器会拒绝执行或将选区放置到错误的位置。

- **解决方案 (`temporarilyEditableNear`)**:

  1.  **检测问题**: 在 `selectionToDOM` 中，如果检测到是问题浏览器，并且要设置的选区跨越了非内联内容。
  2.  **寻找目标**: 调用 `temporarilyEditableNear` 找到那个 `contenteditable="false"` 的障碍节点。
  3.  **临时“解锁”**: 调用 `setEditable`，**临时**将该节点的 `contenteditable` 属性设为 `"true"`。
  4.  **设置选区**: 在节点变为可编辑后，正常执行 `view.docView.setSelection()`，此时浏览器就不会再阻拦。
  5.  **立即“上锁”**: 操作完成后，立即调用 `resetEditable` 将节点的 `contenteditable` 属性恢复为 `"false"`。

- **设计思路**:
  - **外科手术式的 Hack**: 这是一个典型的“外科手术”式的解决方案。它不试图改变整体架构，而是精确地定位问题点，用最小的、临时的、有状态的修改来绕过浏览器 bug，并在操作完成后立刻清理现场，将副作用降到最低。
  - **实用主义**: 这体现了 ProseMirror 的核心哲学：承认 `contenteditable` 的不完美，并用务实的工程手段去解决它，而不是追求一个在理论上纯净但无法在现实中良好工作的模型。

### 总结

selection.ts 是一个在理想模型和混乱现实之间穿梭的“外交官”。它的设计充满了对细节的把控和对浏览器行为的深刻理解：

1.  **双向绑定**: 通过 `selectionFromDOM` 和 `selectionToDOM` 实现了数据（ProseMirror State）和视图（DOM Selection）之间的双向同步。
2.  **职责清晰**: 读和写被清晰地分离在两个主函数中，逻辑明确。
3.  **特殊情况处理**: 对 `NodeSelection`、折叠选区、隐藏选区等都做了专门的、精细化的处理。
4.  **务实的 Bug 修复**: 通过 `temporarilyEditableNear` 等函数，勇敢地直面并解决了 `contenteditable` 中最棘手的跨浏览器兼容性问题，保证了用户体验的一致性。

理解 selection.ts 的工作原理，是理解 ProseMirror 如何驯服 `contenteditable` 这头“猛兽”的关键。
