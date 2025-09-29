export class Reporter {
  constructor() {
    this.state = this.node = null
    this.setAt = 0
  }

  clearState() {
    if (this.state) {
      document.body.removeChild(this.node)
      this.state = this.node = null
      this.setAt = 0
    }
  }

  failure(err) {
    this.show('fail', err.toString())
  }

  delay(err) {
    if (this.state == 'fail') return // 用户总是看到最严重级别的状态信息
    this.show('delay', err.toString())
  }

  show(type, message) {
    this.clearState() // 1. 清除旧报告
    this.state = type // 2. 设置新状态
    this.setAt = Date.now() // 3. 记录时间
    this.node = document.body.appendChild(document.createElement('div')) // 4. 创建并插入 DOM
    this.node.className = 'ProseMirror-report ProseMirror-report-' + type // 5. 设置样式
    this.node.textContent = message // 6. 设置内容
  }

  success() {
    // !延迟清除失败
    // 如果当前正在显示一个“失败”报告，并且这个报告显示的时间还不到 10 秒。
    // 不会立即清除这个失败报告，而是设置一个 5 秒的定时器，在 5 秒后清除它。
    // !为了防止“失败”信息一闪而过，用户还没来得及看清就消失了。
    if (this.state == 'fail' && this.setAt > Date.now() - 1000 * 10)
      setTimeout(() => this.success(), 5000)
    else this.clearState()
  }
}
