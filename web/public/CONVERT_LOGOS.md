# Logo转换说明

我已经为你创建了灵记的SVG版本Logo文件。现在需要将它们转换为所需的格式。

## 创建的SVG文件

1. `lingji-logo.svg` - 主要Logo（200x200）
2. `lingji-apple-touch-icon.svg` - iOS图标（180x180）
3. `lingji-android-192.svg` - Android小图标（192x192）
4. `lingji-android-512.svg` - Android大图标（512x512）

## 转换方法

### 方法1：使用在线转换工具
访问以下网站将SVG转换为所需格式：
- https://convertio.co/zh/svg-png/
- https://www.freeconvert.com/svg-to-png

### 方法2：使用命令行工具（推荐）
```bash
# 安装转换工具
npm install -g sharp

# 转换为PNG
npx sharp lingji-logo.svg -o logo.png
npx sharp lingji-apple-touch-icon.svg -o apple-touch-icon.png
npx sharp lingji-android-192.svg -o android-chrome-192x192.png
npx sharp lingji-android-512.svg -o android-chrome-512x512.png

# 转换为WebP
npx sharp lingji-logo.svg -o logo.webp
npx sharp lingji-full-logo.svg -o full-logo.webp
```

### 方法3：使用Inkscape（免费设计软件）
1. 下载安装Inkscape
2. 打开SVG文件
3. 文件 → 导出为 → 选择PNG格式 → 设置尺寸 → 导出

## 转换后的目标文件

转换完成后，将生成的文件重命名为：
- `logo.webp` (主要Logo)
- `full-logo.webp` (完整Logo，可复制logo.webp)
- `apple-touch-icon.png` (iOS图标)
- `android-chrome-192x192.png` (Android小图标)
- `android-chrome-512x512.png` (Android大图标)

## Logo设计说明

- **颜色**: 蓝色渐变 (#3B82F6 → #1E40AF)
- **字体**: 现代无衬线中文字体
- **风格**: 简洁圆形背景，白色文字
- **特效**: 轻微阴影增加层次感

转换完成后运行 `pnpm release` 重新构建前端即可看到效果。