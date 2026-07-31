# DoctorAR 性能与验证

## 1. 目标

- 普通电脑在默认配置下达到 30 FPS 以上。
- 性能较好的电脑尽量接近显示器刷新率。
- 手势到特效的视觉延迟尽量低于 100 ms。
- 摄像头识别不应长期压制 Three.js 渲染。
- 持续运行时粒子、内存和 WebGL 资源不持续增长。

这些是验收目标，不是未经测试即可声称的结果。每次发布必须记录参考硬件和真实测量。

## 2. V1 调度策略

- 推理只在视频产生新帧时运行，避免对同一帧重复 detectForVideo。
- 推理频率与 requestAnimationFrame 渲染频率分离。
- React 只处理低频 UI 状态，手部姿态和 Shader uniform 不走逐帧 setState。
- 调试文本节流刷新。
- 粒子采用预分配数据、BufferGeometry 或对象复用，并有活动数量硬上限。
- Renderer DPR 有上限，窗口改变时统一更新尺寸。
- document.hidden 时暂停推理、粒子发射和非必要统计。

## 3. 主线程限制

MediaPipe Tasks Vision Web 的 detect 和 detectForVideo 是同步调用。若 V1 在 UI 线程运行推理，即使限制频率，也可能产生短暂主线程阻塞。

因此：

- V1 应记录推理耗时和 Long Task，不能仅凭肉眼判断流畅。
- 当前实现若未迁入 Worker，不得写成“推理完全不阻塞渲染”。
- V1.1 优先评估 Worker、ImageBitmap 和可转移帧方案。
- 如果 Worker 方案带来更高复制成本，应使用相同视频、分辨率和设备进行 A/B 测量。

## 4. 性能统计定义

- FPS：实际完成的渲染帧数除以统计窗口秒数。
- Inference time：一次 Hand Landmarker 调用前后的 performance.now 差值。
- Render time：更新 Three.js 场景到 renderer.render 返回的 CPU 时间。
- Visual latency：从可观察手势变化到对应特效变化的录屏帧差；内部事件耗时不能替代端到端延迟。
- Active particles：当前参与更新和绘制的粒子数，不含空闲池。

统计窗口至少 1 秒，展示值使用滑动平均，避免单帧噪声。

## 5. 推荐参考配置

发布测试至少记录：

- CPU、GPU、内存和操作系统。
- 浏览器名称与版本。
- 摄像头实际分辨率和帧率。
- 页面容器尺寸、DPR 和全屏状态。
- Hand Landmarker 模型版本和推理频率。
- 粒子上限、主题和调试开关。

默认基准建议使用当前稳定版 Chrome 或 Edge、1280 × 720 摄像头、Balanced 思路的粒子数量以及关闭调试层。Low、Balanced、High 已可切换并实际调整推理频率、DPR 和粒子上限，但仍不得在缺少真实硬件数据时声称三档已经完成性能标定。

## 6. V1 发布测试

### 60 秒基准

预热 10 秒后记录 60 秒：

- 平均 FPS。
- 最低 1 秒 FPS。
- 平均和最大推理耗时。
- 平均和最大渲染耗时。
- 最大活动粒子数。
- Long Task 数量。

目标是在声明的参考普通电脑上平均 FPS 不低于 30，并且没有持续数秒的明显冻结。

### 手势延迟

使用 60 FPS 或更高帧率的外部录屏，至少测量五次明显张掌和握拳变化。记录从手部形态变化到法阵出现、收缩的帧数。报告中写明录屏帧率、中位数和最大值。

### 15 分钟持续运行

交替执行张掌、握拳和双手法阵：

- 活动粒子应在停止触发后回落。
- JS heap 不应呈持续单调增长。
- renderer.info.memory 中 geometry 和 texture 不应随每次手势永久增加。
- 页面停止后摄像头轨道结束，摄像头指示灯熄灭。

### 尺寸与摄像头

至少覆盖：

- 640 × 480 与 1280 × 720。
- 16:9 与 4:3。
- 普通窗口、窄窗口、缩放和全屏。
- 摄像头切换前后。

检查关键点、掌心和法阵是否继续对齐。

## 7. 构建与浏览器检查

发布前执行：

1. TypeScript 检查。
2. lint。
3. production build。
4. production preview。
5. 浏览器控制台错误检查。
6. Network 面板检查，确认摄像头帧未上传。
7. 页面隐藏/恢复和退出后的资源释放检查。

开发服务器成功不等于生产成功；必须确认 production preview 中本地 model、WASM 和 Shader 路径有效。

## 8. 浏览器限制

- getUserMedia 需要安全上下文。localhost 可用于开发，普通局域网 HTTP 地址通常不能获取摄像头。
- 摄像头约束是请求偏好，实际分辨率以 videoWidth、videoHeight 和 track settings 为准。
- requestAnimationFrame 在后台标签页通常暂停或节流。
- 全屏需要用户激活，并可能因 Esc、切换标签页或系统切换而退出。
- 后续 Web Audio 必须由用户交互解锁。

## 9. 尚未记录的结果

当前文档不虚构具体硬件成绩。最终 V1 浏览器验收完成后，应在此追加一张带日期、硬件、浏览器、分辨率、FPS、推理耗时、渲染耗时和粒子峰值的结果表。

## 10. 2026-07-31 production smoke

已在 Windows 系统 Chrome 的无头模式中使用浏览器假摄像头完成一次 production preview 功能烟测：

- 实际视频输入为 640 × 480。
- 本地 Hand Landmarker 模型与 WASM 成功加载。
- WebGL 特效 Canvas 成功创建，系统进入 `LOCAL VISION · ACTIVE`。
- 调试面板和蓝色主题切换生效。
- 未捕获运行时异常、`console.error` 或网络资源加载失败。

该环境使用 SwiftShader 软件图形，推理和渲染数字不代表真实电脑与摄像头性能，因此本次结果只证明启动闭环和生产资源路径，不计入 30 FPS 或 100 ms 目标验收。真实摄像头手势、60 秒基准和 15 分钟持续运行仍待真机完成。
