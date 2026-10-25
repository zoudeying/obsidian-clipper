# Obsidian Web Clipper - 本地定制特性与维护指南 (Local Customizations & Maintenance Guide)

本项目在官方 [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) 基础上集成了**网页图片转 Base64 嵌入**功能，旨在与下游 Obsidian 插件 [obsidian-custom-attachment-location](https://github.com/renmu123/obsidian-custom-attachment-location) 协同工作，实现完全离线、自动重命名和附件归档的剪藏工作流。

---

## 目录
1. [核心定制功能概述](#1-核心定制功能概述)
2. [跨插件协同工作机制 (Synergy)](#2-跨插件协同工作机制-synergy)
3. [核心实现与修改文件清单](#3-核心实现与修改文件清单)
4. [关键边缘场景处理机制](#4-关键边缘场景处理机制)
5. [自动化测试与构建](#5-自动化测试与构建)
6. [上游同步与 Rebase 维护指南](#6-上游同步与-rebase-维护指南)

---

## 1. 核心定制功能概述

* **功能开关**：在插件“General（常规设置）”中增加 `Download images` 开关（默认关闭）。
* **功能行为**：开启后，剪藏网页内容时，插件会自动并发下载正文中引用的外部网络图片，并转换为 `data:image/...;base64,...` 嵌入到输出的 Markdown 文档中。
* **背景下载与 CORS 穿透**：通过 Background Script 发起 `fetch()` 下载，利用 WebExtension 特权绕过浏览器跨域 CORS 拦截。

---

## 2. 跨插件协同工作机制 (Synergy)

Web Clipper 与下游 Obsidian 插件 `obsidian-custom-attachment-location` 形成双向配合：

1. **Web Clipper 侧**：
   - 提取原始图片的文件名（剥离查询参数与哈希），并将其以 Markdown Title 形式嵌入：
     ```markdown
     ![<alt-text>](data:image/<type>;base64,<data> "<original_filename>")
     ```
   - 若图片位于 Markdown 表格内，为避免超长 Base64 导致表格排版断裂，自动输出为 HTML `<img>` 格式：
     ```html
     | <img src="data:image/<type>;base64,<data>" alt="<alt>" title="<original_filename>"> |
     ```
2. **Obsidian 插件侧 (`obsidian-custom-attachment-location`)**：
   - 在 Obsidian 内打开该笔记时，插件可扫描匹配内嵌的 Base64 图片，提取二进制数据并保存为本地物理文件。
   - 读取 `<original_filename>` 作为原文件名，结合用户配置的规则（如 `${noteFileName}`、日期时间、去重递增等）重命名并移动到指定的附件文件夹，最后将 Markdown 中的 Base64 替换为本地附件相对路径。

---

## 3. 核心实现与修改文件清单

| 文件路径 | 修改内容 |
| :--- | :--- |
| `src/utils/image-downloader.ts` | **新增核心模块**。提供 `parseImageTarget`（URL清洗与标题提取）、`extractImageMatches`（多语法正则提取与表格行识别）、`replaceImagesWithBase64` 并发下载与替换等。 |
| `src/utils/image-downloader.test.ts` | **新增单元测试**。覆盖表格图片转 HTML、带查询参数/中文标题/特殊引号的各种边界 Case。 |
| `src/background.ts` | 增加 `downloadImageAsBase64` 消息监听器，利用后台权限执行跨域图片下载、Base64 编码与 MIME 类型智能推断。 |
| `src/core/popup.ts` | 在 `saveFile` 和 `handleClipObsidian` 流程中注入拦截逻辑：在最终保存或推送到 Obsidian 前调用 `replaceImagesWithBase64`。 |
| `src/types/types.ts` | `Settings` 接口新增 `downloadImages: boolean` 字段。 |
| `src/utils/storage-utils.ts` | 默认设置配置项加入 `downloadImages: false`。 |
| `src/managers/general-settings.ts` | General 设置项管理器中绑定并持久化 `downloadImages` 配置。 |
| `src/settings.html` | 在常规设置界面中添加 "Download images" 的 UI 复选框/开关。 |
| `src/_locales/en/messages.json` | 增加相关配置项英文文案。 |
| `src/_locales/zh_CN/messages.json` | 增加相关配置项中文文案（"下载图片"）。 |
| `src/utils/cli-stubs.ts` | 存根对象中同步新增 `downloadImages: false`（避免 CLI 编译报错）。 |

---

## 4. 关键边缘场景处理机制

1. **Markdown 表格容错**：
   - 原生 Markdown 表格中嵌入几万字符的 Base64 URL 会破坏表格对齐与解析。
   - 解决方案：识别图片处于包含 `|` 的表格行中时，自动转为 HTML `<img src="data:..." alt="..." title="...">` 标签，既能完整保存 Base64，又保留表格渲染。
2. **URL 后缀带参数或标题属性**：
   - 网页中常包含类似 `https://xxx.png?_=1762738032324` 或 `![alt](url "title.png")` 形式。
   - 解决方案：`parseImageTarget` 能够正确分离 URL 实体与标题描述，剥离 `?` 和 `#` 后准确推断 `image/png`、`image/jpeg` 等 MIME 类型。
3. **中文描述与特殊字符**：
   - 支持 `"长按可移动图片，拉伸锚点可缩放图片"` 等宽字符描述，对包裹的 `<...>` 或首尾多余引号进行清洗。

---

## 5. 自动化测试与构建

### 运行定制特性测试
```bash
npx vitest run src/utils/image-downloader.test.ts
```

### 全平台生产打包
```bash
npm run build
```
打包输出目录：
* `dist/`（可直接在 Chrome/Firefox 开发者模式加载的解压扩展）
* `builds/obsidian-web-clipper-<version>-chrome.zip`
* `builds/obsidian-web-clipper-<version>-firefox.zip`
* `builds/obsidian-web-clipper-<version>-safari.zip`

---

## 6. 上游同步与 Rebase 维护指南

当上游仓库（`https://github.com/obsidianmd/obsidian-clipper`）有新版本更新时，维护流程如下：

1. **拉取上游最新分支与标签**：
   ```bash
   git fetch origin
   # 若因网络原因无法直连 github.com，可使用代理镜像：
   git fetch https://ghfast.top/https://github.com/obsidianmd/obsidian-clipper.git main:refs/remotes/origin/main
   ```
2. **检查上游变动**：
   ```bash
   git log HEAD..origin/main --oneline
   ```
3. **执行变基 (Rebase)**：
   ```bash
   git rebase origin/main
   ```
4. **常见冲突排查**：
   * `package-lock.json`：直接使用 `git checkout --ours package-lock.json && npm install` 重新生成。
   * `src/utils/cli-stubs.ts`：若上游增删了 `Settings` 属性，确保 `cli-stubs.ts` 保持同步。
   * `src/background.ts`：保留上游新的监听逻辑（如 lazy loader 等），同时保留 `downloadImageAsBase64` 的 action 分支。
5. **验证并重新打包**：
   ```bash
   npm test
   npx vitest run src/utils/image-downloader.test.ts
   npm run build
   ```
