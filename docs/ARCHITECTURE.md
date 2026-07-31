# DoctorAR 架构说明

## 1. 设计目标

DoctorAR V1 的架构围绕四个原则：

- 摄像头帧和模型推理在浏览器本地完成。
- 手势识别与视觉特效解耦。
- 识别频率、渲染频率和 React UI 更新频率彼此独立。
- 所有摄像头、动画和 WebGL 资源都有明确生命周期。

## 2. 数据流

主数据流如下：

Camera MediaStream
→ Video Element
→ HandTracker
→ Hand Feature Derivation
→ Smoothing
→ Gesture Recognizer / State Machine
→ Gesture State and Events
→ Effect Manager
→ Three.js / Shader / Particle Renderer

调试层订阅平滑后的手部数据和状态；控制面板只修改配置，不参与逐帧计算。

## 3. 五层画面

从后到前依次为：

1. 摄像头视频层：显示镜像视频。
2. 手势调试层：绘制关键点和骨架，默认关闭。
3. Three.js 特效层：透明 WebGL Canvas。
4. UI 控制层：开始、停止和配置交互。
5. 性能信息层：显示 FPS、推理、渲染和粒子数据。

五层必须挂在同一显示容器下，共享 CSS 尺寸。视频镜像、object-fit 裁剪、窗口缩放和全屏变化只由统一坐标映射处理，不能由各图层自行猜测。

## 4. 模块职责

### Camera / Hooks

- 请求和停止 MediaStream。
- 授权后枚举摄像头。
- 切换设备或约束时先释放旧轨道。
- 提供实际 videoWidth、videoHeight 和 track settings。
- 监听设备结束、页面可见性和组件卸载。

### HandTracker

- 初始化本地 MediaPipe WASM 和 hand_landmarker.task。
- 以 VIDEO 模式处理新视频帧，最多识别两只手。
- 输出原始 landmarks、world landmarks 和 handedness。
- 不生成视觉特效，也不直接写入 React 组件状态。

### Hand Feature / Filter

- 计算掌心、掌宽、旋转角、手指伸展、速度和双手距离。
- 使用可替换的滤波接口；V1 默认指数平滑。
- 保存短暂丢失期间的最后有效姿态，并产生透明度衰减。

### Gesture Recognizer / State Machine

- 根据平滑姿态产生张掌、握拳和双手交互状态。
- 使用 Candidate、Active、Released、Cooldown 等时序状态，禁止单帧直接触发。
- 负责手势冲突优先级和一次性事件去重。
- 输出框架无关的共享类型；不得输出 MediaPipe 类实例。

### Effect Manager

- 只消费手势状态、事件和归一化姿态。
- 创建、更新、渐隐和销毁法阵、爆裂及粒子效果。
- 管理粒子硬上限、效果复用和 Three.js dispose。
- 不导入 MediaPipe，也不读取视频元素。

### React UI

- 管理启动状态、错误提示和低频配置。
- 逐帧姿态通过 ref、外部对象或渲染循环传递，避免 React 每帧重新渲染。
- 调试和性能文本应节流刷新。

## 5. 坐标约定

MediaPipe 返回未镜像输入图像中的归一化坐标，原点在左上角。V1 摄像头 UI 默认镜像，因此坐标映射需要同时考虑：

- 视频原始宽高。
- 显示容器宽高。
- cover 或 contain 的缩放比例。
- 裁剪偏移或留黑偏移。
- 水平镜像。
- Canvas CSS 尺寸与设备像素比例。

镜像只应发生一次。若视频通过 CSS 镜像，则调试和 WebGL 坐标必须用同一规则翻转；不得同时翻转输入帧、Canvas 和坐标。handedness 是模型语义，界面显示的“左手/右手”约定应在 GESTURE_RULES.md 中固定。

## 6. 事件与连续更新

一次性事件用于进入、释放和爆裂，例如：

- PALM_OPEN_START
- FIST_TRIGGER
- PALM_END
- TWO_HAND_START
- TWO_HAND_END

跟随效果还需要连续更新的平滑姿态，例如：

- hand、position、scale、rotation、opacity
- center、distance、relativeVelocity

只发送开始事件会导致法阵无法继续跟随；只发送逐帧事件又会让爆裂重复触发。因此 V1 明确区分离散生命周期事件和连续姿态更新。

## 7. 调度模型

- Three.js 使用 requestAnimationFrame 持续渲染。
- 手部推理只处理新视频帧，并可限制到低于显示刷新率的频率。
- UI 统计以较低频率更新。
- document.hidden 时暂停推理、粒子发射和非必要更新，恢复时重置时间基准。

MediaPipe Web 的 detectForVideo 为同步调用。V1 可通过跳过重复帧和限制推理频率降低影响，但这不等于完全不阻塞主线程。Worker 化列入 V1.1。

## 8. 本地资产与隐私

V1 将模型和 MediaPipe WASM 放在 public 下的本地路径。页面加载后，摄像头帧不需要发送到任何服务。依赖、模型来源和许可证应在 README 中记录。

如果未来改用 CDN，必须固定版本并明确联网、CORS 和 CSP 风险；不得把远程模型推理引入默认路径。

## 9. 生命周期与释放

停止或卸载顺序：

1. 停止提交新推理。
2. 取消 requestAnimationFrame 和其他计时器。
3. 停止 MediaStream 的全部 tracks，并清空 video.srcObject。
4. 关闭 Hand Landmarker 和 Worker。
5. 移除 resize、visibilitychange、devicechange 等监听器。
6. dispose geometry、material、texture、render target 和 renderer。
7. 清空活动效果、粒子和缓存引用。

切换摄像头属于一次局部重启，同样必须先停止旧轨道。

## 10. 后续扩展边界

- V1.1 在手势层增加捏合、轨迹和快速展开事件，在特效层增加轨迹、冲击波和音频。
- V2 在视频与特效层之间增加人物 mask/depth 输入，并引入后处理管线。
- 桌面和移动封装只替换摄像头、文件和窗口适配层，不改变手势事件与特效核心。
