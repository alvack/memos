# PWA 功能测试清单

## 1. 基础 PWA 功能测试

### ✅ Service Worker 注册
- [ ] 打开浏览器开发者工具 → Application → Service Workers
- [ ] 确认 "activated" 状态显示为绿色
- [ ] 确认 "is active" 复选框被勾选

### ✅ Web Manifest 验证
- [ ] 打开浏览器开发者工具 → Application → Manifest
- [ ] 确认应用名称、图标、主题色等信息正确显示
- [ ] 确认 "Add to home screen" 功能可用

### ✅ 缓存策略测试
- [ ] 访问应用并加载一些页面
- [ ] 打开开发者工具 → Application → Cache Storage
- [ ] 确认存在以下缓存：
  - `static-cache-v1` (静态资源)
  - `api-cache-v1` (API 响应)
  - `images-cache-v1` (图片资源)

## 2. 离线功能测试

### ✅ 离线访问测试
- [ ] 在开发者工具 → Network 标签页选择 "Offline"
- [ ] 刷新页面，确认可以访问已缓存的内容
- [ ] 确认显示离线页面而不是浏览器错误页面

### ✅ 离线页面测试
- [ ] 确认离线时显示友好的离线页面
- [ ] 确认页面说明可用的功能
- [ ] 确认 "重新连接" 按钮正常工作

## 3. 应用安装测试

### ✅ 安装提示
- [ ] 在 Chrome/Edge 等支持的浏览器中访问应用
- [ ] 确认地址栏显示安装图标
- [ ] 确认点击安装图标后出现安装提示

### ✅ 安装流程
- [ ] 确认安装提示显示正确的应用信息
- [ ] 确认安装成功后应用出现在桌面/启动器
- [ ] 确认独立窗口模式下应用正常运行

## 4. 更新机制测试

### ✅ 应用更新
- [ ] 修改应用代码并重新构建
- [ ] 确认显示更新提示
- [ ] 确认点击更新后应用正常刷新

## 5. 性能测试

### ✅ 加载性能
- [ ] 使用 Lighthouse 进行性能测试
- [ ] 确认 Performance 分数 > 90
- [ ] 确认 PWA 相关指标达标

## 6. 浏览器兼容性测试

### ✅ 支持的浏览器
- [ ] Chrome/Edge (完全支持)
- [ ] Firefox (基础支持)
- [ ] Safari (有限支持)

## 测试环境设置

1. **开发环境**: http://localhost:3001
2. **HTTPS 要求**: 生产环境需要 HTTPS
3. **浏览器版本**: Chrome 80+, Firefox 75+, Safari 13.1+

## 验证命令

```bash
# 检查 Service Worker 状态
navigator.serviceWorker.getRegistrations().then(console.log)

# 检查 PWA 安装状态
window.matchMedia('(display-mode: standalone)').matches

# 检查缓存
caches.keys().then(console.log)
```