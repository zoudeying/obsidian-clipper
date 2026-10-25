# AGENTS.md - Obsidian Clipper 定制分支开发规范

本仓库是 [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) 的定制开发分支，集成了**网页图片转 Base64 嵌入**功能。

完整架构、协同工作原理、文件修改清单与 Rebase 指南，请参阅：
* **[CUSTOM_FEATURES.md](./CUSTOM_FEATURES.md)**
* **[上级工作区规则文档](../AGENTS.md)**

---

## 核心开发与维护准则

1. **配置依赖完整性**：
   * `src/types/types.ts` 中的 `Settings` 添加字段时，**必须同步在 `src/utils/cli-stubs.ts` 中补齐默认值**，否则 `npm run build` 会触发 TypeScript 编译错误。
2. **下载与格式化安全**：
   * 必须使用 `src/utils/image-downloader.ts` 中的 `parseImageTarget` 处理图片链接，自动剥离标题属性、去除查询参数 `?` 与哈希 `#` 避免 MIME 识别失效。
   * Markdown 表格（行内含有 `|`）中的图片必须输出为 HTML `<img src="data:..." alt="..." title="...">`，严禁在表格内输出超长 Markdown 格式。
3. **测试要求**：
   * 修改相关逻辑后必须运行：
     ```bash
     npx vitest run src/utils/image-downloader.test.ts
     npm run build
     ```
   * 确保 9 项测试用例全部通过，且三端包构建正常。
