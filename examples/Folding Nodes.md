好的，我们来详细讲解一下这个关于“折叠节点”（Folding Nodes）的示例。

这个示例展示了一个非常高级且实用的技巧：如何使用**节点装饰（Node Decorations）**来影响**节点视图（Node Views）**的行为，从而实现可折叠的内容块。

### 核心目标

目标是创建一个编辑器，其中的内容由多个“章节”（section）组成。每个章节都有一个标题和一个可折叠的内容区域。用户可以通过点击章节标题旁边的一个按钮来展开或折叠该章节的内容。

### 关键技术组合

这个功能的实现是 ProseMirror 中几个核心概念协同工作的结果：

1.  **自定义 Schema**: 首先需要一个支持“章节”结构的 Schema。
2.  **节点视图 (`NodeView`)**: 需要一个自定义的 `SectionView` 来渲染每个“章节”节点，包括那个可点击的折叠按钮。
3.  **插件 (`Plugin`)**: 需要一个插件来**追踪**哪些章节是折叠的。
4.  **节点装饰 (`Node Decoration`)**: 插件通过添加或移除“节点装饰”来标记一个章节是否被折叠。这个装饰本身没有视觉效果，它只是一个附加在节点上的**元数据**。
5.  **`NodeView` 与 `Decoration` 的交互**: `SectionView` 会检查自己是否被赋予了“折叠”装饰，并据此来更新自己的外观（隐藏内容，改变按钮图标）。

### 为什么用 Decoration 来追踪状态？

文档中提出了一个重要问题：为什么不直接在 `SectionView` 实例中用一个属性（比如 `this.folded = true`）来记录折叠状态，而是要绕一圈通过插件和装饰来实现？

答案是出于**状态管理的健壮性**和**可控性**：

- **`NodeView` 的不稳定性**: `NodeView` 实例可能会因为各种原因被销毁和重建（比如 DOM 被意外修改）。如果状态只存在于 `NodeView` 内部，那么在重建时状态就会丢失。
- **单一数据源原则**: 将折叠状态统一由一个插件来管理，使其成为**唯一可信的数据源**。这样做的好处是：
  - 状态是持久的，与 `NodeView` 的生命周期解耦。
  - 可以从编辑器外部检查、修改甚至序列化这个状态（比如保存文档时一并保存折叠状态）。

### 代码实现详解

#### 1. 自定义 Schema

```javascript
const schema = new Schema({
  nodes: basicSchema.spec.nodes.append({
    doc: { content: 'section+' },
    section: {
      content: 'heading block+' // 每个 section 必须包含一个标题和至少一个块级内容
      // ... toDOM 和 parseDOM
    }
  })
  // ...
})
```

Schema 被修改，要求文档 (`doc`) 由一个或多个 `section` 组成，而每个 `section` 内部必须是一个 `heading` 紧跟着一个或多个其他块级节点。

#### 2. `SectionView` - 节点视图

这是章节节点的渲染和交互逻辑。

```javascript
class SectionView {
  constructor(node, view, getPos, deco) {
    // ... 创建 section, header, foldButton, contentDOM ...
    this.foldButton.onmousedown = e => this.foldClick(view, getPos, e)

    // 关键点1: 根据传入的装饰初始化折叠状态
    this.setFolded(deco.some(d => d.spec.foldSection))
  }

  setFolded(folded) {
    this.folded = folded
    this.foldButton.textContent = folded ? '▿' : '▵'
    this.contentDOM.style.display = folded ? 'none' : ''
  }

  update(node, deco) {
    // ...
    // 关键点2: 每次更新时，检查装饰是否有变化
    let folded = deco.some(d => d.spec.foldSection)
    if (folded != this.folded) this.setFolded(folded)
    return true
  }

  foldClick(view, getPos, event) {
    // 关键点3: 点击按钮时，调用外部函数来改变状态
    event.preventDefault()
    setFolding(view, getPos(), !this.folded)
  }
}
```

1.  **`constructor`**: 在构造函数中，它接收第四个参数 `deco`。这是一个只包含**直接应用于此节点**的装饰的数组。它通过检查 `deco` 中是否存在一个带有 `foldSection` 属性的装饰来决定初始状态是折叠还是展开。
2.  **`update`**: 在 `update` 方法中，它同样接收最新的装饰数组 `deco`。它比较新的折叠状态和当前状态，如果不同，就调用 `setFolded` 来更新 UI。
3.  **`foldClick`**: 当用户点击按钮时，它**不会直接修改自己的状态**。而是调用一个全局的 `setFolding` 函数，并告诉它“请在我的位置（`getPos()`）将折叠状态设置为 `!this.folded`”。这遵循了“数据由插件统一管理”的原则。

#### 3. `foldPlugin` - 状态管理插件

这个插件是整个系统的“大脑”。

```javascript
const foldPlugin = new Plugin({
  state: {
    init() { return DecorationSet.empty; },
    apply(tr, value) {
      // 1. 映射装饰位置
      value = value.map(tr.mapping, tr.doc);
      // 2. 检查是否有折叠/展开的指令
      let update = tr.getMeta(foldPlugin);
      if (update && update.fold) {
        // 3. 添加一个节点装饰
        value = value.add(tr.doc, [Decoration.node(update.pos, ..., {}, {foldSection: true})]);
      } else if (update) {
        // 4. 移除装饰
        let found = value.find(update.pos + 1, ...);
        if (found.length) value = value.remove(found);
      }
      return value;
    }
  },
  props: {
    // 5. 将插件状态应用为编辑器的装饰
    decorations: state => foldPlugin.getState(state),
    // 6. 告诉编辑器使用我们的 SectionView 来渲染 section 节点
    nodeViews: {section: (node, view, getPos, decorations) => new SectionView(node, view, getPos, decorations)}
  }
});
```

1.  **`map`**: 与上传示例一样，首先映射装饰集，确保位置正确。
2.  **`getMeta`**: 检查事务中是否有名为 `foldPlugin` 的元数据，这是外部与插件通信的方式。
3.  **添加装饰**: 如果指令是折叠 (`update.fold` 为 `true`)，就创建一个 `Decoration.node`。这是一个**节点装饰**，它会覆盖从 `update.pos` 到节点结束的整个范围。我们在它的 `spec` 对象中添加了一个自定义属性 `{foldSection: true}`。这个装饰本身没有视觉效果，它只是一个**标记**。
4.  **移除装饰**: 如果指令是展开，就找到并移除对应的装饰。
5.  **`props.decorations`**: 将插件状态（`DecorationSet`）提供给编辑器视图，使其生效。
6.  **`props.nodeViews`**: **非常关键**。这里将 `section` 节点类型与我们的 `SectionView` 类关联起来。当 ProseMirror 渲染 `section` 节点时，它会使用这个类，并把计算好的装饰作为第四个参数传递进去。

#### 4. `setFolding` - 动作分发函数

这个函数是 `SectionView` 和 `foldPlugin` 之间的桥梁。

```javascript
function setFolding(view, pos, fold) {
  // ...
  // 1. 创建一个带有元数据的事务
  let tr = view.state.tr.setMeta(foldPlugin, { pos, fold })
  // 2. 处理选区
  // ...
  // 3. 分发事务
  view.dispatch(tr)
}
```

1.  它创建一个事务，并通过 `setMeta` 将用户的意图（在 `pos` 位置，设置折叠状态为 `fold`）传递给 `foldPlugin`。
2.  **处理选区**: 这是一个很好的用户体验优化。如果当前用户的光标或选区在即将被折叠的区域内，代码会尝试将选区移动到折叠区域的外部，避免选区“消失”。
3.  分发事务，触发整个更新流程：`foldPlugin` 的 `apply` 方法被调用 -> 装饰集被更新 -> `SectionView` 的 `update` 方法被调用 -> UI 发生变化。

### 总结

这个例子完美地展示了 ProseMirror 中**数据流和视图分离**的思想：

1.  **状态（State）**: 折叠信息作为一种纯数据，由 `foldPlugin` 统一管理在 `DecorationSet` 中。
2.  **动作（Action）**: 用户的交互（点击按钮）通过 `setFolding` 函数被转换成一个带有 `meta` 信息的事务（Transaction），这是一个描述状态变更意图的“动作”。
3.  **更新（Update）**: 插件的 `apply` 方法像一个 Reducer，接收当前状态和动作，计算出新状态。
4.  **视图（View）**: `SectionView` 是一个纯粹的视图组件。它从 `props`（这里是 `decorations` 参数）中接收状态，并据此渲染自己。它自身不持有状态，只负责响应状态变化和分发动作。

这种模式使得代码结构清晰、状态可预测、功能可扩展，是构建复杂编辑器功能的最佳实践。
