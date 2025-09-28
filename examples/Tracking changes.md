好的，我们来详细讲解一下这个关于“追踪变更”（Tracking changes）的示例。

这个例子展示了 ProseMirror 一个非常强大但常常被忽视的特性：**变更（Changes）本身是“一等公民”**。这意味着你可以捕获、存储、检查、反转和重演（rebase）变更。

这个示例利用这一特性，构建了一个类似 Git 的系统，允许用户：

1.  对文档进行多次编辑。
2.  将一段时间内的编辑“提交”（commit）为一个原子单位。
3.  查看每个提交引入了哪些文本（blame/追溯）。
4.  “还原”（revert）历史中的任意一个提交。

### 核心概念

1.  **`Step`**: ProseMirror 中最小的、不可分割的变更单位。一个事务（Transaction）由一个或多个步骤（Step）组成。
2.  **`Step.invert(doc)`**: 每个 `Step` 都有一个 `invert` 方法，它接收该步骤应用前的文档 `doc`，并返回一个能够撤销该步骤效果的新 `Step`。这是实现撤销和还原功能的基础。
3.  **`Mapping`**: 一个 `Mapping` 对象记录了因一系列 `Step` 导致的文档坐标变化。它的核心作用是：如果你有一个旧的文档位置，`Mapping` 可以告诉你这个位置在新文档中对应哪里。这是在变化之上重演（rebase）变化的关键。
4.  **`Step.map(mapping)`**: 对一个 `Step` 应用一个 `Mapping`，会返回一个新的 `Step`，这个新 `Step` 在被映射过的文档上能产生同样的效果。

### 代码实现详解

#### 1. `TrackState` 类 - 插件的核心状态

这个类用于存储所有与变更追踪相关的数据。ProseMirror 的 state 是持久化数据结构，所以这个类的所有方法都返回一个新的 `TrackState` 实例，而不是修改自身。

```javascript
class TrackState {
  constructor(blameMap, commits, uncommittedSteps, uncommittedMaps) {
    // 1. Blame Map: 记录文档中每个范围是由哪个 commit 引入的。
    this.blameMap = blameMap
    // 2. Commits: 一个 Commit 对象的数组，代表提交历史。
    this.commits = commits
    // 3. Uncommitted Steps: 自上次提交以来发生的所有变更的“反向步骤”。
    this.uncommittedSteps = uncommittedSteps
    // 4. Uncommitted Maps: 与 uncommittedSteps 对应的映射。
    this.uncommittedMaps = uncommittedMaps
  }

  applyTransform(transform) {
    // a. 将当前事务中的所有步骤反转，为下一次提交做准备。
    let inverted = transform.steps.map((step, i) => step.invert(transform.docs[i]))
    // b. 更新 blame map。
    let newBlame = updateBlameMap(this.blameMap, transform, this.commits.length)
    // c. 返回一个新状态，将反转后的步骤和映射累加到“未提交”列表中。
    return new TrackState(
      newBlame,
      this.commits,
      this.uncommittedSteps.concat(inverted),
      this.uncommittedMaps.concat(transform.mapping.maps)
    )
  }

  applyCommit(message, time) {
    if (this.uncommittedSteps.length == 0) return this
    // a. 将所有“未提交”的步骤和映射打包成一个新的 Commit 对象。
    let commit = new Commit(message, time, this.uncommittedSteps, this.uncommittedMaps)
    // b. 返回一个新状态，将新 commit 添加到历史中，并清空“未提交”列表。
    return new TrackState(this.blameMap, this.commits.concat(commit), [], [])
  }
}
```

#### 2. `trackPlugin` - 变更追踪插件

这个插件的作用就是监听所有事务，并使用 `TrackState` 来更新其状态。

```javascript
const trackPlugin = new Plugin({
  state: {
    init(_, instance) {
      // 初始化状态，整个文档最初都属于 null (初始 commit)
      return new TrackState([new Span(0, instance.doc.content.size, null)], [], [], [])
    },
    apply(tr, tracked) {
      // 1. 如果文档内容改变，就调用 applyTransform
      if (tr.docChanged) tracked = tracked.applyTransform(tr)
      // 2. 检查事务元数据，看它是否是一个 commit 事务
      let commitMessage = tr.getMeta(this)
      if (commitMessage) tracked = tracked.applyCommit(commitMessage, new Date(tr.time))
      return tracked
    }
  }
})
```

这个插件的逻辑非常清晰：

1.  对于任何改变了文档的普通事务，调用 `applyTransform` 来记录其反向步骤。
2.  如果一个事务带有特殊的 `meta` 标记，就认为它是一个“提交”动作，调用 `applyCommit` 将所有未提交的变更打包成一个 commit。

#### 3. `revertCommit(commit)` 函数 - 还原提交

这是整个示例中最复杂、最能体现 ProseMirror 强大之处的部分。它的目标是撤销历史中的某一个 `commit`，即使这个 `commit` 之后已经有了很多其他的修改。

```javascript
function revertCommit(commit) {
  let trackState = trackPlugin.getState(state)
  let index = trackState.commits.indexOf(commit)
  // ... 检查 ...

  // 1. 创建一个总的映射 (remap)，它包含了从要还原的 commit 之后，一直到当前文档状态的所有变更。
  let remap = new Mapping(
    trackState.commits.slice(index).reduce((maps, c) => maps.concat(c.maps), [])
  )
  let tr = state.tr

  // 2. 倒序遍历要还原的 commit 中的所有步骤。
  for (let i = commit.steps.length - 1; i >= 0; i--) {
    // 3. 对每个步骤，应用 remap 进行“重演”(rebase)，得到一个可以在当前文档上应用的新步骤。
    //    remap.slice(i + 1) 是为了确保只映射该步骤之后的变更。
    let remapped = commit.steps[i].map(remap.slice(i + 1))
    if (!remapped) continue

    let result = tr.maybeStep(remapped)

    // 4. 如果步骤成功应用，将其产生的映射追加到 remap 中，以便后续步骤能基于这个最新的变化进行映射。
    if (result.doc) remap.appendMap(remapped.getMap(), i)
  }

  // 5. 如果文档真的发生了变化，就分发这个还原事务。
  if (tr.docChanged) dispatch(tr.setMeta(trackPlugin, `Revert '${commit.message}'`))
}
```

**`revertCommit` 的工作流程可以这样理解：**

假设历史是 `A -> B -> C -> D`，我们要还原 commit `B`。
`B` 的反向步骤是 `B'`。但我们不能直接在 `D` 上应用 `B'`，因为 `C` 和 `D` 的修改可能已经改变了 `B` 操作的位置。

1.  `revertCommit` 首先创建一个 `remap`，这个 `remap` 包含了 `C` 和 `D` 的所有坐标变换信息。
2.  它取出 `B` 的反向步骤 `B'`。
3.  它对 `B'` 调用 `.map(remap)`，相当于在问：“`B'` 这个操作，如果要在经历了 `C` 和 `D` 变换后的文档上执行，应该变成什么样子？”。这个过程就是**重演（rebasing）**。
4.  得到重演后的步骤 `remapped B'`，然后将其应用到当前文档 `D` 上。
5.  这个过程对 `B` 中的所有步骤（倒序）重复进行，最终构建出一个完整的、可以在当前文档上安全应用的“还原事务”。

### 总结

这个例子揭示了 ProseMirror 内部变更处理机制的强大威力，它不仅仅是一个简单的撤销/重做栈。

1.  **变更的原子性与可逆性**: `Step` 是原子操作，并且 `invert()` 方法保证了其可逆性。
2.  **坐标变换的追踪**: `Mapping` 对象是实现“时空穿梭”的关键，它使得在不同版本的文档之间转换坐标和操作成为可能。
3.  **插件作为状态机**: `trackPlugin` 完美地扮演了一个状态机的角色，它消费事务（输入），并根据事务的类型（普通变更或提交）来转换自己的内部状态（`TrackState`）。
4.  **声明式的变更**: `revertCommit` 的过程是声明式的。我们不关心内容具体是什么，只关心如何将一系列历史操作（`commit.steps`）在另一系列历史操作（`remap`）之上进行重演。

通过理解和运用这些底层概念，你可以构建出非常复杂的、类似 Git 或 Google Docs 版本历史记录的协同编辑和版本控制功能。
