# DoctorAR 性能与验证

## 1. 目标

- 普通电脑在默认配置下达到 30 FPS 以上。
- 性能较好的电脑尽量接近显示器刷新率。
- 手势到特效的视觉延迟尽量低于 100 ms。
- 摄像头识别不应长期压制 Three.js 渲染。
- 持续运行时粒子、内存和 WebGL 资源不持续增长。

这些是验收目标，不是未经测试即可声称的结果。每次发布必须记录参考硬件和真实测量。

## 2. V1 / V1.1 调度策略

- 推理优先由 `requestVideoFrameCallback` 在视频产生新帧时运行，避免对同一帧重复 `detectForVideo`；不支持时回退 requestAnimationFrame。
- 推理频率与 requestAnimationFrame 渲染频率分离。
- 视频帧按预设输入长边缩放为可转移 `ImageBitmap`，交给 Worker 内的 MediaPipe Hand Landmarker。
- 主线程与 Worker 间只允许单个 in-flight 请求；Worker 忙碌时丢弃新推理帧并计数，不排队累积延迟。
- React 只处理低频 UI 状态，手部姿态和 Shader uniform 不走逐帧 setState。
- 调试文本节流刷新。
- 粒子、轨迹段和冲击波采用固定容量 BufferGeometry / 槽位复用，并有分档活动数量硬上限。
- Renderer DPR 有上限，窗口改变时统一更新尺寸。
- document.hidden 时暂停推理、粒子发射和非必要统计。

## 3. Worker 与主线程回退

MediaPipe Tasks Vision Web 的 `detect` 和 `detectForVideo` 是同步调用。V1.1 默认在 Worker 内运行 Hand Landmarker，使同步模型调用不直接占用 UI 线程；帧准备、ImageBitmap 创建和消息处理仍有主线程成本。

因此：

- 调试面板必须显示当前后端 `WORKER` 或 `MAIN`、Worker 往返耗时、推理 FPS 和丢弃帧数。
- Worker 初始化或首次运行失败时只执行一次受控主线程回退；回退固定限制为最高 18 FPS 和低档输入尺寸，但同步推理仍可能产生短帧。
- 单 in-flight 只保证不积压旧帧，不代表端到端视觉延迟已在所有设备低于 100 ms。
- Worker 与主线程回退应使用相同视频、分辨率和设备进行 A/B 测量，不能只凭肉眼判断流畅。

## 4. 性能统计定义

- FPS：实际完成的渲染帧数除以统计窗口秒数。
- Inference time：一次 Hand Landmarker 调用前后的 performance.now 差值。
- Render time：更新 Three.js 场景到 renderer.render 返回的 CPU 时间。
- Visual latency：从可观察手势变化到对应特效变化的录屏帧差；内部事件耗时不能替代端到端延迟。
- Active particles：当前参与更新和绘制的粒子数，不含空闲池。
- Worker round trip：从提交 ImageBitmap 到收到 Worker 结果的耗时，包含 Worker 推理与消息往返。
- Inference FPS：实际完成的推理次数除以统计窗口秒数。
- Dropped inference frames：由于已有请求在途而主动跳过的新视频帧累计数。
- Active trail segments / shockwaves：当前可见的轨迹段与冲击波实例数，不含空闲槽位。

统计窗口至少 1 秒，展示值使用滑动平均，避免单帧噪声。

## 5. 推荐参考配置

发布测试至少记录：

- CPU、GPU、内存和操作系统。
- 浏览器名称与版本。
- 摄像头实际分辨率和帧率。
- 页面容器尺寸、DPR 和全屏状态。
- Hand Landmarker 模型版本和推理频率。
- 粒子上限、主题和调试开关。

默认基准建议使用当前稳定版 Chrome 或 Edge、1280 × 720 摄像头、Balanced 配置以及关闭调试层。当前三档限制如下：

| 预设 | 推理上限 | 输入长边 | DPR 上限 | 粒子 | 轨迹段 | 轨迹间距 | 冲击波 | 默认摄像头 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Low | 18 FPS | 512 px | 1.0 | 360 | 96 | 9 px | 2 | 480p |
| Balanced | 28 FPS | 640 px | 1.5 | 720 | 192 | 6 px | 4 | 720p |
| High | 40 FPS | 960 px | 2.0 | 1200 | 320 | 4 px | 6 | 1080p |

三档参数已经真实生效，但仍不得在缺少真实硬件数据时声称已完成跨设备性能标定。

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
3. Vitest 8 项手势与 Worker 生命周期测试。
4. production build。
5. production preview。
6. 浏览器控制台错误检查。
7. Network 面板检查，确认摄像头帧未上传。
8. 页面隐藏/恢复和退出后的资源释放检查。

开发服务器成功不等于生产成功；必须确认 production preview 中本地 model、WASM 和 Shader 路径有效。

## 8. 浏览器限制

- getUserMedia 需要安全上下文。localhost 可用于开发，普通局域网 HTTP 地址通常不能获取摄像头。
- 摄像头约束是请求偏好，实际分辨率以 videoWidth、videoHeight 和 track settings 为准。
- requestAnimationFrame 在后台标签页通常暂停或节流。
- 全屏需要用户激活，并可能因 Esc、切换标签页或系统切换而退出。
- Web Audio 必须由用户交互解锁。

## 9. 尚未记录的结果

当前文档不虚构具体硬件成绩。最终真实设备验收完成后，应在此追加一张带日期、硬件、浏览器、分辨率、后端、FPS、Worker 往返耗时、推理耗时、渲染耗时、丢帧、粒子、轨迹和冲击波峰值的结果表。

## 10. 2026-08-01 自动验证记录

Vitest 共 8 项通过，覆盖严格快速展开成功与拒绝路径、失效/陈旧双手拒绝、释放事件顺序、捏合生命周期与两指尖中点，以及 Worker reset 旧结果隔离。

Windows 无头 Edge 假摄像头生产预览烟测确认：

- 本地 Hand Landmarker 模型与 WASM 成功加载，调试面板后端为 `WORKER`。
- V1.1 捏合轨迹和冲击波进入真实 Three.js / WebGL 绘制路径，活动轨迹段与冲击波指标非零，不是静态占位图。
- 未捕获页面控制台错误或失败的网络资源请求。

假摄像头与无头软件图形环境不代表真实摄像头、真实 GPU 或跨浏览器性能，因此本次结果只证明开发环境启动、Worker 和 V1.1 实绘闭环。真实摄像头手势、60 秒基准、15 分钟持续运行和跨浏览器验证仍待完成。
