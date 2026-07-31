import { forwardRef } from 'react'

export const CameraView = forwardRef<HTMLVideoElement>(function CameraView(_props, ref) {
  return <video ref={ref} className="camera-layer" autoPlay muted playsInline aria-label="实时摄像头画面" />
})
