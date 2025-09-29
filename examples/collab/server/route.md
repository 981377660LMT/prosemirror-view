好的，我们来详细讲解 route.js 这个文件。

这个文件实现了一个小型的、自定义的 URL **路由器（Router）**。在 Node.js 的世界里，我们通常会使用像 Express.js 或 Koa 这样的成熟框架来处理路由，但这个示例为了保持轻量和自包含，自己动手实现了一个。它的功能虽然简单，但设计得非常巧妙，足以满足这个协同编辑服务器的需求。

### 一、 核心目标与作用

`Router` 类的核心目标是：**将收到的 HTTP 请求，根据其请求方法（`GET`, `POST` 等）和 URL 路径，分发给预先注册好的、正确的处理函数（handler）**。

它在整个服务器架构中扮演着“交通警察”或“电话总机”的角色。`server.js` 会用它来定义所有的 API 端点，而 `Router` 则负责确保每个来访的请求都能被正确地引导。

### 二、 `Router` 类详解

#### `constructor()`

```javascript
constructor() { this.routes = [] }
```

构造函数非常简单，它只是初始化一个空数组 `this.routes`。这个数组将用来存储所有被定义的路由规则。

#### `add(method, url, handler)`

这是用来**定义一条新路由**的方法。

```javascript
add(method, url, handler) {
  this.routes.push({method, url, handler})
}
```

它接收三个参数：

- `method`: HTTP 请求方法，如 `'GET'` 或 `'POST'`。
- `url`: 一个 URL 匹配模式。这个模式可以是字符串、正则表达式，或者一个特殊的数组格式。
- `handler`: 当请求匹配该路由时，需要被执行的处理函数。

它将这三个信息打包成一个对象，并存入 `this.routes` 数组。

#### `match(pattern, path)` - 路由匹配的核心逻辑

这是整个路由器中最复杂、最核心的方法。它负责判断一个给定的 URL 路径 `path` 是否符合某条路由的 `pattern`。它支持三种不同类型的匹配模式：

1.  **精确字符串匹配 (`typeof pattern == "string"`)**:

    - `if (pattern == path) return []`
    - 这是最简单的匹配。例如，如果 `pattern` 是 `"/docs"`，那么它只匹配路径完全等于 `"/docs"` 的请求。
    - 匹配成功时返回一个空数组 `[]`。

2.  **正则表达式匹配 (`pattern instanceof RegExp`)**:

    - `let match = pattern.exec(path)`
    - `return match && match.slice(1)`
    - 这允许使用正则表达式进行更灵活的匹配。
    - **关键点**: `match.slice(1)`。`exec` 方法返回的数组中，第一个元素是整个匹配的字符串，后续元素是正则表达式中的**捕获组（capturing groups）**。通过 `slice(1)`，它只返回捕获组的内容。这是一种从 URL 中提取动态参数（如 ID）的强大方式。

3.  **自定义数组模式匹配 (`else`)**:
    - 这是该路由器特有的一种模式，在 `server.js` 中被广泛使用。它通过一个由字符串和 `null` 组成的数组来定义 URL 结构。
    - **工作原理**:
      - 它首先将请求的 URL 路径按 `/` 分割成段（parts）。例如，`/docs/my-doc-id/events` 会被分割成 `['docs', 'my-doc-id', 'events']`。
      - 然后，它逐一比较路径的每一段和模式数组的每一项。
      - 如果模式中的项是一个**字符串**（如 `'docs'`），那么路径中对应位置的段必须与该字符串**完全相等**。
      - 如果模式中的项是 **`null`**，那么它就扮演一个**通配符/捕获符**的角色。路径中对应位置的段会被捕获，并放入 `result` 数组中。
    - **示例**: 在 `server.js` 中，我们看到这样的定义：`handle('GET', ['docs', null, 'events'], ...)`。这里的 `['docs', null, 'events']` 就是一个数组模式。
      - 当一个请求路径为 `/docs/xyz-123/events` 时：
        - `'docs'` 匹配 `'docs'`。
        - `null` 匹配 `'xyz-123'`，并将 `'xyz-123'` 捕获。
        - `'events'` 匹配 `'events'`。
      - 匹配成功，`match` 方法会返回 `['xyz-123']`。

#### `resolve(request, response)` - 入口与分发器

这是路由器的**公共入口方法**。当服务器收到一个新请求时，会调用这个方法。

```javascript
resolve(request, response) {
  // 1. 解析 URL
  let parsed = parse(request.url, true)
  let path = parsed.pathname
  request.query = parsed.query

  // 2. 遍历所有已注册的路由
  return this.routes.some(route => {
    // 3. 检查方法和 URL 是否都匹配
    let match = route.method == request.method && this.match(route.url, path)
    if (!match) return false

    // 4. 解码捕获的 URL 参数
    let urlParts = match.map(decodeURIComponent)
    // 5. 调用处理函数
    route.handler(request, response, ...urlParts)
    return true
  })
}
```

1.  **解析 URL**: 使用 Node.js 内置的 `url.parse` 模块，从请求的 URL 中分离出路径 `pathname` 和查询参数 `query`。它还将 `query` 对象直接附加到 `request` 对象上，方便后续处理函数使用。
2.  **遍历路由**: 使用 `Array.prototype.some` 来遍历 `this.routes` 数组。`some` 会在找到第一个匹配项后立即停止，效率较高。
3.  **匹配检查**: 对每一条路由规则，它都检查 `method` 是否相符，并调用 `this.match()` 方法检查 `path` 是否相符。
4.  **参数解码**: 如果匹配成功，`this.match()` 会返回一个包含所有从 URL 中捕获的参数的数组。`map(decodeURIComponent)` 会对这些参数进行 URL 解码（例如，将 `%20` 转换回空格）。
5.  **调用 Handler**: **最关键的一步**。它调用匹配到的路由的处理函数 `route.handler`，并将 `request`, `response` 对象，以及通过**展开语法（spread syntax `...`）** 解码后的 URL 参数依次传递过去。这就是 `server.js` 中的处理函数能直接拿到 `id` 等参数的原因。

### 三、 总结

route.js 是一个轻量级但功能完备的路由器。它虽然不是一个通用的生产级框架，但为这个特定的项目提供了恰到好处的功能。

- **设计精巧**: 它通过支持三种不同的匹配模式（字符串、正则、自定义数组），提供了足够的灵活性。特别是自定义的数组模式，使得在 `server.js` 中定义带参数的 URL 变得非常直观。
- **职责单一**: 它只做路由分发这一件事，并且做得很好。它不关心请求体如何解析，也不关心响应如何构建，这些都由 `server.js` 中的 `handle` 函数和 `Output` 类来负责，体现了良好的关注点分离。
- **解耦作用**: 它将 `server.js` 中“定义 API 端点”的意图和“如何匹配并执行”的底层实现分离开来。`server.js` 只需声明式地调用 `handle()`，而无需关心 URL 解析和匹配的细节。

总而言之，`route.js` 是服务器端架构中一个虽小但不可或缺的组件，是理解服务器如何组织和响应不同 API 请求的关键。
