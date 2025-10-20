# 灵记 Logo 替换指南

本文档说明如何将 Memos 的品牌标识替换为灵记品牌标识。

## 需要替换的文件

以下Logo文件需要替换为灵记品牌标识：

### 主要Logo文件
1. **web/public/logo.webp** - 主要Logo，用于登录页面和头部导航
2. **web/public/full-logo.webp** - 完整Logo（如果存在）

### 应用图标文件
3. **web/public/apple-touch-icon.png** - iOS设备图标（180x180px）
4. **web/public/android-chrome-192x192.png** - Android小图标（192x192px）
5. **web/public/android-chrome-512x512.png** - Android大图标（512x512px）

## 技术要求

### 文件格式要求
- **PNG格式**: iOS和Android图标
- **WebP格式**: 主要Logo（推荐，文件更小）
- **尺寸**: 按照文件名中的尺寸要求

### 设计建议
- 保持简洁的识别性
- 在小尺寸下仍清晰可辨
- 建议使用透明背景
- 符合现代应用图标设计趋势

## 替换步骤

1. 准备灵记Logo文件
2. 直接替换上述文件
3. 清除浏览器缓存测试效果
4. 运行 `pnpm release` 重新构建前端

## 注意事项

- 无需修改代码引用，文件路径保持不变
- 图标文件名和格式必须保持一致
- 建议保留原始文件备份

## 测试验证

替换后请在以下场景测试显示效果：
- 浏览器标签页
- iOS设备主屏幕
- Android设备主屏幕
- 移动设备添加到主屏幕功能