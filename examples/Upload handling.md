好的，我们来详细讲解一下这个关于在 ProseMirror 中处理“文件上传”（Upload handling）的示例。

### 核心目标

这个示例旨在解决一个在现代 Web 编辑器中非常常见的异步操作问题：**如何在不打断用户编辑流程的情况下，优雅地处理文件（如图片）上传？**

直接的做法是：用户选择图片 -> 等待上传完成 -> 上传成功后将图片插入文档。这种做法体验很差，因为用户在等待期间无法进行其他编辑。

理想的流程应该是：

1.  用户选择一张图片。
2.  编辑器**立即**在光标位置插入一个临时的**占位符（placeholder）**。
3.  文件上传在后台开始进行。
4.  用户可以继续编辑文档的其他部分，占位符会随着周围内容的增删而移动。
5.  上传成功后，用真实的图片**替换**掉那个占位符，无论它现在移动到了哪里。
6.  如果上传失败，或者用户在上传期间删除了占位符周围的内容，就静默地移除占位符，不插入任何东西。

### 关键技术：`Plugin` 和 `Decoration`

这个优雅流程的实现，核心在于 ProseMirror 的**插件（Plugin）**和**装饰（Decoration）**系统。

- **`Decoration`**: 装饰允许你在编辑器视图中添加额外的信息，而**不改变实际的文档内容**。这正是我们需要的！占位符不应该是文档的真实内容（因为它最终会被替换），它只是一种临时的视觉状态。`Decoration.widget` 类型的装饰可以在文档的特定位置插入一个 DOM 节点，非常适合用作占位符。

- **`Plugin`**: 我们需要一个插件来管理这些占位符装饰的生命周期。这个插件需要：
  - 维护一个所有当前存在的占位符的集合（`DecorationSet`）。
  - 当有新的上传开始时，添加一个新的占位符装饰。
  - 当上传完成或失败时，移除对应的占位符装饰。
  - 最重要的是，当文档被编辑时，插件需要**自动更新**所有占位符的位置，确保它们始终跟随正确的位置。

### 代码实现详解

#### 1. `placeholderPlugin` - 占位符管理插件

这是整个系统的核心控制器。

```javascript
let placeholderPlugin = new Plugin({
  state: {
    init() {
      return DecorationSet.empty
    },
    apply(tr, set) {
      // 1. 映射(Map)装饰位置
      set = set.map(tr.mapping, tr.doc)

      // 2. 检查是否有添加或移除占位符的动作
      let action = tr.getMeta(this)
      if (action && action.add) {
        // 3. 添加新的占位符装饰
        let widget = document.createElement('placeholder')
        let deco = Decoration.widget(action.add.pos, widget, { id: action.add.id })
        set = set.add(tr.doc, [deco])
      } else if (action && action.remove) {
        // 4. 移除指定的占位符装饰
        set = set.remove(set.find(null, null, spec => spec.id == action.remove.id))
      }
      return set
    }
  },
  props: {
    // 5. 将插件状态应用为编辑器的装饰
    decorations(state) {
      return this.getState(state)
    }
  }
})
```

1.  **`set = set.map(tr.mapping, tr.doc)`**: 这是**最关键的一行**。每当有事务（`tr`）发生时（即用户编辑了文档），`apply` 方法会被调用。`set.map` 会根据事务中的变更信息（`tr.mapping`），自动计算出 `DecorationSet` 中所有装饰的新位置。这确保了即使在上传过程中文档被大量修改，我们的占位符也能被“追踪”到正确的位置。
2.  **`tr.getMeta(this)`**: 插件通过事务的 `meta` 属性来接收外部指令。这是一种插件与外部世界通信的标准方式。我们约定，如果 `meta` 中有 `add` 或 `remove` 动作，就执行相应操作。
3.  **添加装饰**: 当收到 `add` 指令时，创建一个 `placeholder` DOM 元素，然后用 `Decoration.widget` 创建一个部件装饰。注意，我们给这个装饰附加了一个唯一的 `id`，以便之后能找到并移除它。
4.  **移除装饰**: 当收到 `remove` 指令时，使用 `set.find` 通过 `id` 找到对应的装饰，然后用 `set.remove` 将其从集合中移除。
5.  **`props: { decorations(...) }`**: 这个属性告诉 ProseMirror，这个插件管理的状态（`DecorationSet`）应该被应用为编辑器视图的装饰。ProseMirror 会自动渲染这些装饰。

#### 2. `findPlaceholder(state, id)` - 查找占位符

这是一个辅助函数，用于在上传成功后找到占位符的最终位置。

```javascript
function findPlaceholder(state, id) {
  let decos = placeholderPlugin.getState(state)
  let found = decos.find(null, null, spec => spec.id == id)
  return found.length ? found[0].from : null
}
```

它从插件状态中获取当前的装饰集合，通过 `id` 查找。如果找到了，返回它的起始位置 (`from`)；如果没找到（可能因为用户删除了它周围的内容，导致装饰被自动清除），则返回 `null`。

#### 3. `startImageUpload(view, file)` - 核心上传流程

当用户选择了文件，这个函数被调用，它编排了整个异步流程。

```javascript
function startImageUpload(view, file) {
  // 1. 创建一个唯一的 ID 用于本次上传
  let id = {}

  // 2. 立即在视图中插入占位符
  let tr = view.state.tr
  if (!tr.selection.empty) tr.deleteSelection()
  tr.setMeta(placeholderPlugin, { add: { id, pos: tr.selection.from } })
  view.dispatch(tr)

  // 3. 开始异步上传
  uploadFile(file).then(
    url => {
      // 4. 上传成功后，找到占位符的当前位置
      let pos = findPlaceholder(view.state, id)
      if (pos == null) return // 如果占位符已不存在，则中止

      // 5. 创建一个新事务：用真实图片替换占位符，并移除占位符装饰
      view.dispatch(
        view.state.tr
          .replaceWith(pos, pos, schema.nodes.image.create({ src: url }))
          .setMeta(placeholderPlugin, { remove: { id } })
      )
    },
    () => {
      // 6. 上传失败后，只移除占位符装饰
      view.dispatch(tr.setMeta(placeholderPlugin, { remove: { id } }))
    }
  )
}
```

1.  **唯一 ID**: `let id = {}` 是一个创建唯一引用的巧妙技巧。每个新的空对象在内存中都是唯一的。
2.  **立即反馈**: 创建一个事务，通过 `setMeta` 向 `placeholderPlugin` 发送 `add` 指令，在当前光标位置添加一个占位符。然后立即 `dispatch` 这个事务，用户会马上看到占位符出现，感觉操作是即时的。
3.  **异步操作**: `uploadFile` 是一个模拟上传的函数，它返回一个 Promise。
4.  **查找位置**: Promise resolve 后（上传成功），调用 `findPlaceholder` 获取占位符的**最新位置**。由于插件的 `map` 功能，这个 `pos` 是绝对准确的。
5.  **替换操作**: 创建一个新的事务。这个事务做了两件事：
    - `replaceWith(...)`: 在 `pos` 位置插入真实的图片节点。
    - `setMeta(..., {remove: {id}})`: 向插件发送 `remove` 指令，以移除占位符装饰。
      这两步在同一个事务中完成，保证了操作的原子性。
6.  **失败处理**: 如果 Promise reject（上传失败），则只发送 `remove` 指令来清理占位符。

### 总结

这个例子完美地展示了如何利用 ProseMirror 的核心特性来构建复杂的、用户友好的异步交互：

1.  **分离视图与内容**: 使用 `Decoration` 来显示临时的视觉元素（占位符），而不污染实际的文档数据。
2.  **状态追踪**: 使用 `Plugin` 的 `state` 和 `apply` 方法来管理这些临时元素的状态。
3.  **位置映射**: 依赖 `DecorationSet.map()` 自动追踪因文档编辑而发生的位置变化，这是实现该功能最关键、最神奇的部分。
4.  **插件通信**: 通过事务的 `meta` 属性，实现外部逻辑（如上传函数）与插件内部状态管理的解耦通信。

通过这种模式，你可以将任何需要时间的异步操作（文件上传、数据请求等）都包装成对用户而言是即时和无缝的体验。
