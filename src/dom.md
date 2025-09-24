好的，我们来深入讲解 dom.ts 这个文件。

这个文件是 ProseMirror 视图层最底层的基石，可以称之为 **DOM 工具箱 (DOM Toolkit)**。它不包含任何 ProseMirror 的高级逻辑，而是提供了一系列纯粹的、可复用的底层 DOM 操作函数。它的核心职责是：

1.  **抽象化**: 将原生、繁琐的 DOM API 封装成更易于使用和理解的函数。
2.  **跨浏览器兼容**: 抹平不同浏览器在 DOM API 实现上的差异和怪癖 (quirks)。
3.  **性能优化**: 提供一些经过优化的方法来处理性能敏感的 DOM 操作。
4.  **提供基础能力**: 为其他更高级的模块（如 `domcoords.ts`, `selection.ts`, `input.ts`）提供它们所需要的基础 DOM 查询和遍历能力。

---

### 核心功能模块分析

我们可以将这个文件中的函数按功能分为几个核心类别：

#### 1. DOM 遍历与检查 (Traversal and Inspection)

这是最基础的一类函数，用于在 DOM 树中移动和获取信息。

- **`domIndex(node)`**:

  - **作用**: 计算一个节点在它的父节点中的索引位置。
  - **实现**: 通过一个简单的 `while` 循环，不断访问 `previousSibling` 并计数。这是一个非常基础但使用频率极高的操作。

- **`parentNode(node)`**:

  - **作用**: 获取一个节点的父节点，但**特别处理了 Shadow DOM**。
  - **实现**: 它不直接使用 `node.parentNode`，而是优先检查 `(node as HTMLSlotElement).assignedSlot`。如果一个元素被分配到了一个 `<slot>` 中，它的逻辑父节点应该是这个 slot。如果父节点是 ShadowRoot (`nodeType == 11`)，它会返回宿主元素 (`host`)。
  - **设计思路**: 这是 ProseMirror 能够良好地在 Web Components 或其他使用 Shadow DOM 的环境中工作的关键。它正确地理解了“视觉上”的父子关系，而非仅仅是 DOM 树结构上的关系。

- **`nodeSize(node)`**:
  - **作用**: 提供一个统一的方式来获取节点的“大小”。
  - **实现**: 对两种主要节点类型进行了区分：
    - 文本节点 (`nodeType == 3`): 大小是其文本内容的长度 (`node.nodeValue.length`)。
    - 元素节点: 大小是其子节点的数量 (`node.childNodes.length`)。
  - **设计思路**: 这个函数为遍历逻辑提供了一个统一的“边界”概念，无论是在文本中移动偏移量，还是在元素中移动子节点索引。

#### 2. DOM 位置的等价性判断 (`isEquivalentPosition`)

这是 dom.ts 中最复杂也最精妙的函数之一，它解决了一个核心问题：**DOM 中的位置是模糊的**。

- **问题**: “文本节点 A 的末尾”和“紧跟其后的元素节点 B 的开头”在视觉上是同一个位置。但它们的 DOM 表示是不同的（`{node: A, offset: A.length}` vs `{node: B.parentNode, offset: domIndex(B)}`）。在处理选区时，必须能够判断这两个不同的表示是否指向同一个“逻辑位置”。

- **`isEquivalentPosition(node, off, targetNode, targetOff)`**:

  - **作用**: 判断两个 DOM 位置 `(node, off)` 和 `(targetNode, targetOff)` 是否等价。
  - **实现**: 它通过 `scanFor` 函数，从一个位置开始，向两个方向（`dir: -1` 和 `dir: 1`）进行“标准化”的移动，看是否能到达另一个位置。
  - **`scanFor` 的逻辑**:
    1.  如果当前位置在节点的边界（开头或末尾），并且该节点不是块级节点或原子节点（如 `<img>`），它会“跳出”到父节点中，将位置转换为父节点中的索引。
    2.  如果当前位置在元素节点内部，它会“跳入”到相应的子节点中，并将位置设置为子节点的开头或末尾。
    3.  这个过程会一直持续，直到找到目标位置（返回 `true`），或者遇到无法跨越的边界（如块级节点、`contenteditable="false"` 的元素），则返回 `false`。

- **`selectionCollapsed(domSel)`**:
  - **作用**: 判断一个浏览器选区是否是折叠的（即光标状态）。
  - **实现**: 它不直接使用 `domSel.isCollapsed`，因为在 Shadow DOM 中这个属性存在 bug。它转而使用 `isEquivalentPosition` 来判断选区的 `anchor` 和 `focus` 是否在等价的位置上，这更加健壮和准确。

#### 3. 寻找相邻文本节点 (`textNodeBefore` / `textNodeAfter`)

这两个函数对于处理输入法（IME）至关重要。当输入法组合发生时，ProseMirror 需要找到光标附近实际发生文本变化的那个文本节点。

- **`textNodeBefore(node, offset)` / `textNodeAfter(node, offset)`**:
  - **作用**: 从一个给定的 DOM 位置开始，向前或向后搜索，找到第一个遇到的文本节点。
  - **实现**: 这是一个状态机式的循环。它会根据当前节点类型和偏移量，决定是继续在当前节点内搜索，还是移动到兄弟节点或父节点中继续搜索。它会智能地跳过 `contenteditable="false"` 的区域。

#### 4. 浏览器 API 抽象与 Polyfill

- **`caretFromPoint(doc, x, y)`**:

  - **作用**: 提供一个统一的接口来调用浏览器根据屏幕坐标获取光标位置的 API。
  - **实现**: 它优先尝试 `doc.caretPositionFromPoint` (Firefox)，如果失败或不存在，则回退到 `doc.caretRangeFromPoint` (Chrome/Safari)。它还包含了对 API 返回值的一些修正，例如裁剪不合法的偏移量。这是 `domcoords.ts` 中 `posAtCoords` 函数的基石。

- **`deepActiveElement(doc)`**:

  - **作用**: 获取当前文档中真正获得焦点的元素，同样**支持 Shadow DOM**。
  - **实现**: 它会从 `doc.activeElement` 开始，如果该元素有 `shadowRoot`，则会继续深入到 `shadowRoot` 内部去寻找真正的活动元素。

- **`keyEvent(keyCode, key)`**:
  - **作用**: 以编程方式创建一个 `KeyboardEvent` 对象。
  - **实现**: 使用 `document.createEvent`。主要用于 ProseMirror 的内部测试，模拟用户按键。

#### 5. 性能优化 (`textRange`)

- **`textRange(node, from, to)`**:
  - **作用**: 创建一个包裹文本节点一部分的 `Range` 对象。
  - **实现**: 它包含一个非常重要的性能优化。它不会每次都调用 `document.createRange()`，而是会**复用一个全局的 `Range` 对象 (`reusedRange`)**。
  - **原因**: 根据注释和 ProseMirror 社区的经验，频繁创建 `Range` 对象在某些浏览器中会带来显著的性能开销，甚至会拖慢后续的 DOM 更新。通过复用同一个对象，可以避免这种开销。`clearReusedRange` 函数则用于在适当的时候（例如，在一次更新流程结束后）清除这个缓存。

### 总结

dom.ts 是 ProseMirror 视图层优雅架构的体现。它将所有与原生 DOM 交互的“脏活累活”都集中在了这个文件中，并用清晰、健壮的函数进行了封装。这使得上层模块可以：

- **忽略浏览器差异**: 上层逻辑可以编写得更加纯粹，无需关心各种浏览器的怪癖。
- **代码更具可读性**: `isEquivalentPosition(a, b)` 远比一长串复杂的 DOM 比较逻辑要清晰。
- **受益于底层优化**: 上层模块调用 `textRange` 时，自动获得了性能优化，而无需关心其内部实现。

可以说，`dom.ts` 是 ProseMirror 能够稳定、高效地在复杂多变的 DOM 环境中运行的坚实地基。
