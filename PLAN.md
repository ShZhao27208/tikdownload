# TikDownload 增强计划

## 实施阶段

### Phase 1: 存储层 & 迁移
- 扩展 storage schema (buttonConfig, queueSettings, downloadHistory)
- 向后兼容迁移函数

### Phase 2: 按钮位置自定义
- options.html/js (9宫格选择器 + 实时预览)
- content.js 动态位置系统 (applyPosition + storage监听)
- content.css 移除硬编码

### Phase 3: 引擎增强(第一档)
- 修复画质假设置 bug
- 按钮状态反馈 (loading/success/error)
- 下载失败重试
- 完成通知

### Phase 4: 引擎增强(第二档)
- DownloadQueue 类 (并发控制)
- 下载历史 + 去重
- 批量下载
- 图集归类

### Phase 5-6: UI 整合
- Options 完整功能 (tab分区)
- Popup 快捷面板

---

## 关键技术决策

**按钮位置方案**: Storage驱动 + 内联样式 + onChanged监听  
**队列实现**: 轻量级类 + Set追踪运行中任务  
**历史存储**: 数组 + FIFO淘汰 (最多1000条)
