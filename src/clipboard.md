好的，我们来深入讲解 clipboard.ts。

这个文件是 ProseMirror 实现高质量复制粘贴功能的核心。它的设计目标远不止于简单地将文本或 HTML 放入/取出剪贴板，而是要解决两个核心问题：

1.  **保真性 (Fidelity)**: 当从一个 ProseMirror 编辑器复制内容，再粘贴到另一个（或同一个）ProseMirror 编辑器时，如何确保内容（包括节点、标记、结构）**100% 无损**？
2.  **兼容性 (Compatibility)**: 当从外部应用（如 Word, Google Docs, 网页）粘贴内容时，如何将其混乱、不规范的 HTML 清理、转换并安全地融入到当前编辑器的 Schema 结构中？

clipboard.ts 通过一套精巧的序列化和解析机制，完美地回答了这两个问题。它主要由两个核心函数构成：`serializeForClipboard` (复制/剪切) 和 `parseFromClipboard` (粘贴/拖放)。

---

### 第一部分：序列化 - `serializeForClipboard` (PM → 剪贴板)

这个函数负责将一个 ProseMirror 的 `Slice` 对象（代表了用户选中的内容）转换为可以放入系统剪贴板的 HTML 和纯文本。

#### 设计思路：在通用 HTML 中嵌入“秘密信息”

为了实现无损复制，ProseMirror 不能只生成普通的 HTML。它需要在生成的 HTML 中嵌入足够多的元数据，以便在粘贴时能够完美地重建原始的 `Slice`。

#### 工作流程：

1.  **预处理 (`transformCopied`)**:

    - 提供了一个 `transformCopied` 的 prop 钩子，允许用户在内容被序列化之前对其进行最后的修改。例如，你可以在复制时去掉某些特定的标记或节点。

2.  **上下文剥离 (Context Stripping)**:

    - 一个 `Slice` 对象有 `openStart` 和 `openEnd` 属性，表示其内容的“开放深度”。例如，如果你只复制了一个列表项中的部分文字，`openStart` 可能为 2（因为内容被 `<ul>` 和 `<li>` 包裹）。
    - 这段代码通过一个 `while` 循环，将这些外层的包裹节点（如 `<li>`, `<blockquote>`）从 `slice.content` 中“剥离”出来，并将它们的类型和属性信息存储在一个 `context` 数组中。
    - **目的**: 这样做可以简化核心内容，使其更容易被序列化，同时将结构信息保存下来，以备后用。

3.  **序列化为 DOM**:

    - 使用 `DOMSerializer` 将被剥离后的核心内容（`content`）序列化为 DOM 片段。
    - 这个过程在一个**脱离文档的 (`detachedDoc`)** `div` 中进行，以避免影响当前页面，并提升性能。

4.  **HTML 结构修正 (`wrapMap`)**:

    - 这是一个非常巧妙的工程细节。直接将 `<td>` 放入 `div.innerHTML` 是无效的，浏览器会忽略它。
    - `wrapMap` 定义了哪些元素必须被特定的父元素包裹才能被浏览器正确解析。例如，`<td>` 需要被 `<table><tbody><tr>` 包裹。
    - 函数会检查序列化后的第一个元素，如果需要，就自动添加这些必需的包裹层，确保生成的 HTML 字符串是有效的。

5.  **嵌入元数据 (`data-pm-slice`)**:

    - **这是实现无损复制的核心！** 函数会在最顶层的 HTML 元素上添加一个 `data-pm-slice` 属性。
    - 这个属性的值是一个字符串，包含了重建 `Slice` 所需的所有信息：
      - 原始的 `openStart` 和 `openEnd`。
      - `wrapMap` 添加的额外包裹层数量。
      - 之前被剥离的**上下文节点**的 JSON 字符串。
    - 这个 `data-` 属性就是 ProseMirror 编辑器之间传递的“秘密信息”。

6.  **生成纯文本**:
    - 同时，它也会生成一个纯文本版本，用于粘贴到不支持 HTML 的地方（如记事本）。这可以通过 `clipboardTextSerializer` prop 自定义。

**总结 `serializeForClipboard`**: 它生成了两种产物：一份是带有 ProseMirror “数字水印” (`data-pm-slice`) 的、结构正确的富文本 HTML；另一份是纯文本。前者用于在 ProseMirror 生态内实现完美粘贴，后者则保证了广泛的兼容性。

---

### 第二部分：解析 - `parseFromClipboard` (剪贴板 → PM)

这个函数负责读取剪贴板中的数据（HTML 或纯文本），并将其解析为一个可以插入到文档中的 `Slice`。

#### 设计思路：优先信任“自己人”，谨慎对待“外来者”

解析逻辑是一个带有优先级的多分支流程，体现了对数据来源的不同信任程度。

#### 工作流程：

1.  **判断粘贴类型**:

    - 首先判断是应该作为纯文本粘贴（`asText`）还是富文本粘贴。如果用户按住了 Shift，或者当前光标在代码块中，或者没有 HTML 数据，都会强制作为纯文本处理。

2.  **纯文本粘贴路径**:

    - 文本会经过 `transformPastedText` 钩子处理。
    - 如果是在代码块中，直接创建一个包含文本的 `Slice`。
    - 否则，会尝试使用 `clipboardTextParser` 钩子进行解析（例如，解析 Markdown）。
    - 如果钩子不存在，它会执行一个默认行为：将文本按行分割，每一行创建一个段落（`<p>`），并应用当前光标位置的 marks。

3.  **富文本粘贴路径 (HTML)**:

    - **清理 HTML**: HTML 会经过 `transformPastedHTML` 钩子处理，并使用 `readHTML` 函数进行解析。`readHTML` 内部同样使用了 `wrapMap` 来确保 DOM 解析的正确性。
    - **寻找“秘密信息”**: 解析后的 DOM 会被立即搜索是否存在 `[data-pm-slice]` 属性。
    - **分支 A：发现 `data-pm-slice` (来自 ProseMirror)**
      1.  **解析元数据**: 从属性值中提取出 `openStart`, `openEnd` 和 `context`。
      2.  **解析 DOM**: 使用 `DOMParser` 将 DOM 解析为初步的 `Slice`。
      3.  **重建 `Slice`**: 调用 `closeSlice` 和 `addContext`，利用元数据将初步的 `Slice` 完美地恢复成原始的、具有正确开放深度的 `Slice`。这个过程是 `serializeForClipboard` 的逆操作。
    - **分支 B：未发现 `data-pm-slice` (来自外部)**
      1.  **解析 DOM**: 使用 `DOMParser` 将外部 HTML 解析为 `Slice`。这是一个尽力而为的过程，parser 会根据 schema 规则丢弃不认识的标签和属性。
      2.  **规范化兄弟节点 (`normalizeSiblings`)**: 这是处理外部 HTML 的关键步骤。外部 HTML 的顶级节点经常不符合当前光标位置的 schema 约束（例如，你不能直接在段落中粘贴两个 `<li>`）。`normalizeSiblings` 会尝试在当前上下文中寻找一个合适的父节点，并自动为这些不匹配的兄弟节点添加所需的包裹节点（例如，为两个 `<li>` 包裹上 `<ul>`），从而生成一个**符合 schema 规范的、连贯的 `Slice`**。
      3.  **修正开放深度**: 对生成的 `Slice` 的开放深度进行最后的修正，确保它不会过度开放。

4.  **最终处理 (`transformPasted`)**:
    - 无论通过哪条路径生成的 `Slice`，在返回之前都会经过 `transformPasted` 钩子，允许用户做最后的调整。

**总结 `parseFromClipboard`**: 它是一个智能的、多层次的解析系统。它优先识别并完美还原“自己人”的数据，对于“外来者”的数据，则通过一套强大的规范化和包裹逻辑，尽最大努力将其“收编”到自己的 schema 体系中，从而在保证文档结构合法性的前提下，最大程度地保留粘贴的内容。
