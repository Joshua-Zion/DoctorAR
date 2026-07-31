# DoctorAR 第三方资源与原创声明

本文件记录 DoctorAR V1 直接依赖的运行时资源。法阵图形、Shader 组合、粒子参数和 Web Audio 音色均由本项目代码程序化生成，不包含电影截图、角色 Logo、电影原声、静态法阵 PNG 或外部素材包。

## MediaPipe Tasks Vision

- npm 包：`@mediapipe/tasks-vision@1.0.0`
- 项目：[google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe)
- 许可证：Apache License 2.0
- 本地文件：`public/mediapipe/wasm/*`

WASM 文件从已锁定版本的 npm 包复制到 `public/mediapipe/wasm/`，用于离线加载手部识别运行时。

## Hand Landmarker 模型

- 本地文件：`public/models/hand_landmarker.task`
- 官方下载：[MediaPipe Hand Landmarker full float16 model](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task)
- 官方说明：[Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)
- 模型卡：[Model Card — Hand Tracking Lite/Full](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf)
- 模型卡所列许可证：Apache License 2.0
- 2026-07-31 本地文件 SHA-256：`FBC2A30080C3C557093B5DDFC334698132EB341044CCEE322CCF8BCF3607CDE1`

模型仅在浏览器本地处理摄像头帧。DoctorAR 不将视频帧上传到服务器。

## Three.js

- npm 包：`three@0.185.1`
- 项目：[three.js](https://github.com/mrdoob/three.js)
- 许可证：MIT

Three.js 用于透明 WebGL 场景、程序化法阵 Shader 与固定容量粒子系统。

## React 与 Vite

- `react@19.2.8` / `react-dom@19.2.8`：MIT
- `vite@8.2.0`：MIT

版本以 `package-lock.json` 为安装基准。各第三方组件的完整许可证文本与传递依赖信息可在安装后的 `node_modules` 包目录中查看。

## DoctorAR 原创内容

- `src/effects/shaders/magicCircle.ts`：原创程序化同心环、刻度、放射线、几何符号、核心和呼吸亮度逻辑。
- `src/effects/ParticleSystem.ts`：本项目实现的固定容量粒子池与粒子 Shader。
- `src/audio/AudioManager.ts`：运行时振荡器、滤波器和包络合成音，不引用任何录音素材。
- UI 图形与 `public/favicon.svg`：项目内原创几何图形。

后续如果加入纹理、字体、录音、模型或其他素材，必须先在本文件登记来源、版本、许可证和对应本地文件。
