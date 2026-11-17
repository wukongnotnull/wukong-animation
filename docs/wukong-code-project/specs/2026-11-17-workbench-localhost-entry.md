# 工作台 localhost 入口修复

## 问题与目标

浏览器打开 `http://localhost:63711/` 时，工作台在页面返回之前按 `127.0.0.1:63711` 精确校验 Host，导致 403 和“仅接受本机工作台的同源请求”。本规格按项目规则默认通过并实施。

目标：输入 localhost 的当前工作台端口即可打开页面、连接已有影片。页面最终使用服务公开的 `http://127.0.0.1:<port>/` 地址。

## 设计与实施

- 在现有 Host 拒绝检查之前，仅对精确 `localhost:<实际监听端口>` 的根路径 GET/HEAD、没有 Origin、Fetch Destination 缺失或为 document 的请求返回 307 临时跳转。
- Location 由已知服务 origin 与根路径查询参数组成，保留 `?film=...`，不采用请求 Host 或外部 URL 作为跳转目标。
- 不对 API、静态资源、控制路由或 POST 做别名放行；跟随跳转后的浏览器继续使用已有同源来源和 Fetch Metadata 校验。
- 保留 no-store、CSP、无 CORS 和 127.0.0.1 监听。服务复用、影片签批和插件版本不变。
- 使用现有 Node HTTP/URL API，不新增依赖。参考 [MDN 307](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/307) 的方法保持语义。

## 验收与顺序

先增加 HTTP 回归并确认现有实现失败，再实现最小跳转；检查 GET/HEAD、影片查询参数、无响应体和 no-store。负向覆盖其他主机与端口、外来 Origin、iframe、POST、API、静态资源、控制路由。

运行工作台相关集成测试，通过浏览器从 localhost 导航到标准地址，验证影片、文档读取和隔离样本的意见提交。审查差异后提交本次修复；保留原有 README、outputs 和 tmp 工作，不更改安装缓存，不升版本或发布。
