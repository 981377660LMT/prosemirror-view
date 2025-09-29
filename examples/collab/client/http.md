这是一个非常简洁而实用的网络请求封装模块。在现代 JavaScript 中，我们通常使用 `fetch` API，但这个例子为了支持更广泛的浏览器（或者只是因为编写时 `fetch` 还不普及），使用了底层的 `XMLHttpRequest` (XHR) 对象。这个模块的核心目标是**将基于事件回调的、繁琐的 XHR 操作，封装成现代的、基于 Promise 的、更易于使用的接口**。

### 核心函数：`req(conf)`

这是整个模块的基础。它接收一个配置对象 `conf`，并返回一个**带有 `abort` 方法的 Promise**。

#### 1. Promise 封装

```javascript
let result = new Promise((success, failure) => {
  // ... XHR 的事件监听和发送逻辑 ...
})
```

这是整个封装的核心。它创建了一个 Promise，将 XHR 的异步结果与 Promise 的 `success` (resolve) 和 `failure` (reject) 状态联系起来。

- 当请求成功加载（`load` 事件）且 HTTP 状态码小于 400 时，调用 `success(req.responseText)`，将 Promise 置为 resolved 状态，并将服务器返回的文本作为结果。
- 当请求加载但状态码表示错误（>= 400）时，创建一个自定义的 `Error` 对象，并将服务器返回的错误信息和状态码附加到这个错误对象上，然后调用 `failure(err)`，将 Promise 置为 rejected 状态。
- 当发生网络层面的错误（`error` 事件，如 DNS 解析失败、网络中断）时，调用 `failure(new Error("Network error"))`。

通过这种方式，调用者可以使用 `.then()` 和 `.catch()` 或者 `async/await` 来处理网络请求，而无需关心 XHR 繁琐的事件监听。

#### 2. `abort` 方法的实现

```javascript
result.abort = () => {
  if (!aborted) {
    req.abort()
    aborted = true
  }
}
return result
```

这是一个非常巧妙和重要的设计。标准的 Promise 一旦创建就无法从外部取消。但是，网络请求（尤其是长轮询）通常需要被取消。

这个模块通过在返回的 `Promise` 对象上**手动附加一个 `abort` 方法**来解决这个问题。

- `req.abort()`: 这是 XHR 对象原生支持的方法，用于立即中止请求。
- `aborted` 标志位: 当 `req.abort()` 被调用时，XHR 自身可能会触发 `load` 或 `error` 事件。`aborted` 标志位确保了在请求被手动中止后，这些事件的回调函数不会再执行 `success` 或 `failure`，从而避免了不必要的 Promise 状态改变。

在 `collab.js` 中，这个 `abort` 方法至关重要。当客户端正在进行长轮询（`poll`）等待服务器更新时，如果用户产生了新的输入需要发送（`send`），客户端必须先中止当前的长轮询请求。它就是通过调用这个 `result.abort()` 来实现的。

#### 3. 配置处理

```javascript
req.open(conf.method, conf.url, true)
// ...
if (conf.headers)
  for (let header in conf.headers) req.setRequestHeader(header, conf.headers[header])
req.send(conf.body || null)
```

这部分代码读取 `conf` 对象中的 `method`, `url`, `headers`, `body` 等属性，并据此配置和发送 XHR 请求，使得函数具有很好的通用性。

### 辅助函数

#### `makePlain(html)`

```javascript
function makePlain(html) {
  var elt = document.createElement('div')
  elt.innerHTML = html
  return elt.textContent.replace(/\n[^]*|\s+$/g, '')
}
```

这是一个安全辅助函数。当服务器返回错误时，响应体有时可能是一个 HTML 格式的错误页面。如果直接将这个 HTML 字符串显示给用户或放入错误日志，可能会引入不必要的复杂性或安全风险（如 XSS）。

这个函数利用了浏览器的 DOM 解析器：

1.  创建一个临时的 `<div>` 元素。
2.  将 HTML 字符串赋给它的 `innerHTML`。浏览器会自动解析它。
3.  然后读取它的 `textContent` 属性，这会返回所有 HTML 标签被剥离后的纯文本内容。
4.  最后的 `replace` 则是清理掉一些多余的换行和尾部空格。

这样可以确保从错误响应中提取出干净、纯文本的错误信息。

### 便捷方法：`GET(url)` 和 `POST(url, body, type)`

这两个是导出给外部使用的便捷函数。它们内部都调用了 `req` 函数，但提供了更简洁的接口，使得调用者无需每次都构建完整的 `conf` 对象。

- `GET(url)`: 封装了 GET 请求。
- `POST(url, body, type)`: 封装了 POST 请求，并自动设置了 `Content-Type` 请求头，这对于发送 JSON 或其他类型的数据非常方便。

### 总结

http.js 是一个优秀的、小而美的底层模块封装范例。它体现了软件工程中的几个重要原则：

1.  **抽象与封装**: 将原生、复杂的 `XMLHttpRequest` API 封装成简单、易用的 Promise 接口，隐藏了底层的实现细节。
2.  **接口增强**: 为标准的 Promise 对象增加了 `abort` 功能，满足了特定业务场景（取消请求）的需求，展示了 JavaScript 动态语言的灵活性。
3.  **健壮性**: 细致地处理了各种成功和失败的情况，并提供了清晰的错误信息。
4.  **可重用性**: 提供了通用的 `req` 函数和便捷的 `GET`/`POST` 函数，可以在项目的任何地方重用。

在整个协同编辑示例中，这个文件扮演了“通信兵”的角色，为上层逻辑（`collab.js`）提供了可靠、易用的网络通信能力。
