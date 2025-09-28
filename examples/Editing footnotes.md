好的，我们来详细讲解一下这个关于“编辑脚注”（Editing footnotes）的示例。

这个例子非常高级，它解决了一个在富文本编辑中颇具挑战性的问题：如何实现像“脚注”这样既是内联元素（出现在文本流中）又自身包含可编辑内容的节点。

### 核心挑战

ProseMirror 的默认行为并不擅长处理“带有内容的内联节点”。通常，内联节点要么是纯文本，要么是像图片一样的“叶子”节点（leaf node），不包含自己的内容。

脚注的特殊之处在于：

1.  它在主文档中表现为一个简单的标记（比如一个数字），像一个单词一样。
2.  但它本身又包含一段可以独立编辑的文本。

为了解决这个问题，这个例子采用了一种“编辑器中的编辑器”的巧妙方案。

### 关键技术与设计思路

1.  **`atom: true`**: 在 Schema 中将脚注节点标记为 `atom`。这告诉 ProseMirror 将这个节点视为一个不可分割的原子单位。当用户用方向键导航时，光标会整个跳过它，或者将它作为一个整体选中，而不会进入其内部。这是实现“点击或移动光标到脚注上以编辑它”这一交互的基础。
2.  **`NodeView`**: 由于 `atom` 节点的特殊性，必须为其提供一个自定义的节点视图 (`FootnoteView`) 来完全接管其渲染和交互。
3.  **弹出式子编辑器**: 当脚注节点被选中时 (`selectNode` 被调用)，`FootnoteView` 会动态创建一个小型的、临时的、弹出的 ProseMirror 编辑器实例（`innerView`）。这个子编辑器的文档内容就是脚注节点自身的内容。
4.  **事务转发**: 这是整个方案最核心、最精妙的部分。
    - **从内到外**: 当用户在子编辑器中修改内容时，产生的事务（Transaction）不会直接应用。`FootnoteView` 会拦截这个事务，提取出其中的步骤（Steps），然后将这些步骤**映射**（map）到主编辑器（`outerView`）的文档坐标系中，并应用到主编辑器上。这保证了所有的修改都记录在主编辑器的撤销历史中，并且能被协同编辑等功能正确处理。
    - **从外到内**: 当主编辑器的状态发生变化（比如用户撤销了一个操作，或者协同编辑传来了变更）并影响到脚注内容时，`FootnoteView` 的 `update` 方法会被调用。它会智能地计算出新旧内容之间的差异，并只将差异部分应用到子编辑器中，从而尽可能地保留子编辑器中的光标位置等状态。

### 代码实现详解

#### 1. `footnoteSpec` - Schema 定义

```javascript
const footnoteSpec = {
  group: 'inline',
  content: 'text*', // 它包含文本内容
  inline: true,
  atom: true, // 关键点：将其视为原子节点
  toDOM: () => ['footnote', 0],
  parseDOM: [{ tag: 'footnote' }]
}
```

`atom: true` 是这里的关键。它强制 ProseMirror 将脚注视为一个黑盒，并将所有交互委托给我们的 `FootnoteView`。

#### 2. `FootnoteView` 类

##### `constructor`, `selectNode`, `deselectNode`

- `constructor`: 初始化 `FootnoteView`，创建一个空的 `<footnote>` DOM 元素。此时子编辑器 `innerView` 为 `null`。
- `selectNode`: 当用户通过点击或方向键选中这个脚注节点时被调用。它会给 DOM 添加选中样式，并调用 `this.open()` 来创建和显示子编辑器。
- `deselectNode`: 当脚注节点失去选中状态时被调用。它会移除选中样式，并调用 `this.close()` 来销毁子编辑器。

##### `open()` 和 `close()` - 子编辑器的生命周期

- `open()`:
  1.  创建一个 `tooltip` DOM 元素并附加到脚注的 DOM 上。
  2.  **创建子编辑器**: `this.innerView = new EditorView(...)`。
      - `state`: 子编辑器的状态。它的 `doc` 直接就是当前的脚注节点 `this.node`。ProseMirror 的一个强大之处在于，任何节点都可以被当作一个独立的文档来编辑。
      - **`dispatchTransaction: this.dispatchInner.bind(this)`**: **魔法所在**。这里我们覆盖了子编辑器默认的事务分发行为。子编辑器中产生的任何事务都不会自己处理，而是会调用我们的 `dispatchInner` 方法。
- `close()`: 销毁子编辑器实例，清理 DOM。

##### `dispatchInner(tr)` - 将变更从“内”同步到“外”

这是从子编辑器向主编辑器同步数据的核心。

```javascript
dispatchInner(tr) {
  // 1. 先在内部应用事务，获取新状态，并更新子编辑器视图
  let {state, transactions} = this.innerView.state.applyTransaction(tr);
  this.innerView.updateState(state);

  // 2. 如果事务不是来自外部，则需要将其传播到外部
  if (!tr.getMeta("fromOutside")) {
    let outerTr = this.outerView.state.tr;
    // 3. 创建一个偏移量映射
    let offsetMap = StepMap.offset(this.getPos() + 1);
    // 4. 遍历所有步骤，并用偏移量映射它们
    for (...) {
      outerTr.step(steps[j].map(offsetMap));
    }
    // 5. 如果文档有变化，则分发外部事务
    if (outerTr.docChanged) this.outerView.dispatch(outerTr);
  }
}
```

1.  首先，它还是会调用 `applyTransaction` 来计算出子编辑器的新状态，并用 `updateState` 更新子编辑器的视图。这让用户能立刻看到自己的输入。
2.  `!tr.getMeta("fromOutside")`: 这是一个防止无限循环的标志。我们只传播由用户在子编辑器中直接产生的事务。
3.  `StepMap.offset(this.getPos() + 1)`: 创建一个 `StepMap`。`this.getPos()` 获取脚注节点在主文档中的起始位置，`+1` 是为了跳过节点的起始标签，进入其内容区域。这个 `offsetMap` 的作用就是将子编辑器中从 0 开始的坐标，加上一个偏移量，转换成在主文档中的绝对坐标。
4.  `steps[j].map(offsetMap)`: 对事务中的每一个步骤（step）应用这个偏移量映射，得到一个新坐标系的步骤。
5.  `outerTr.step(...)` 和 `this.outerView.dispatch(outerTr)`: 将映射后的步骤应用到主编辑器的事务中，并分发。这样，修改就正式记录在了主文档和其历史记录中。

##### `update(node)` - 将变更从“外”同步到“内”

当主编辑器状态变化（如撤销、协同编辑）导致脚注节点更新时，此方法被调用。

```javascript
update(node) {
  // ...
  if (this.innerView) {
    let state = this.innerView.state;
    // 1. 智能地找出新旧内容之间的差异范围
    let start = node.content.findDiffStart(state.doc.content);
    if (start != null) {
      let {a: endA, b: endB} = node.content.findDiffEnd(...);
      // 2. 创建一个只替换差异部分的事务
      this.innerView.dispatch(
        state.tr
          .replace(start, endB, node.slice(start, endA))
          // 3. 标记此事务来自外部，防止无限循环
          .setMeta("fromOutside", true)
      );
    }
  }
  return true;
}
```

1.  `findDiffStart` 和 `findDiffEnd`: ProseMirror 提供的强大工具，用于高效地比较两段内容并找出它们开始和结束不同的位置。
2.  `tr.replace(...)`: 创建一个只替换变化部分的事务，而不是全量更新。这能最大程度地保留子编辑器中的光标位置等状态。
3.  `setMeta("fromOutside", true)`: **极其重要**。给这个事务打上标记，告诉 `dispatchInner` 方法：“这个变更是我从外部同步过来的，你不需要再把它传播回外部了”，从而避免了死循环。

### 总结

这个脚注示例是 ProseMirror 高级用法的一个典范，它展示了：

1.  **`atom` 节点与 `NodeView` 的结合**: 如何处理那些在结构上很特殊、需要完全自定义交互的节点。
2.  **嵌套编辑器模式**: 通过在一个 `NodeView` 中创建另一个 `EditorView` 实例，实现了“组件化”的编辑体验。
3.  **精巧的事务和步骤操作**: 核心在于理解并操作 ProseMirror 的事务（Transaction）和步骤（Step）。通过 `StepMap` 进行坐标系转换，实现了内外两个编辑器状态的无缝、无损同步。
4.  **双向数据流与防循环机制**: 通过 `setMeta` 设置标志位，清晰地管理了双向数据同步中的循环依赖问题。

虽然实现起来比较复杂，但这个模式为在 ProseMirror 中实现各种复杂的、带有内部状态和独立编辑界面的“嵌入式”内容（如数学公式编辑器、代码块、可交互图表等）提供了坚实的蓝图。
