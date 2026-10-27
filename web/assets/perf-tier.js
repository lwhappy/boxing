/* SilentJab — 设备档位与自适应分辨率（四个 3D 引擎共用）
 *
 * 手机 GPU 的三大开销：像素填充（DPR）、MSAA、阴影贴图（要再跑一遍蒙皮）。
 * 这里按设备给一档基础配置，运行中再按实测 FPS 自动升降 DPR：
 *   低于 45fps → 降一档（最低 0.6 倍），高于 57fps → 慢慢升回 1.0。
 * 发热降频、后台标签页恢复、低端机首帧抖动都能自动跟上。
 */

export const isMobileDevice = matchMedia('(pointer: coarse)').matches
  || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const cpuCores = navigator.hardwareConcurrency || 4;
const deviceMem = navigator.deviceMemory || 4;     // Safari 未实现，按 4 处理
export const isLowEnd = isMobileDevice && (cpuCores <= 4 || deviceMem <= 4);

export const QUALITY = {
  dprMax: isMobileDevice ? (isLowEnd ? 1 : 1.5) : 2,   // 手机上 2x 像素量是压垮帧率的主因
  dprMin: 0.6,
  antialias: !isMobileDevice,                          // 手机 MSAA 很贵，靠 DPR 收敛已够干净
  shadow: isMobileDevice ? (isLowEnd ? 'off' : 'low') : 'high',
  aniso: isMobileDevice ? 2 : 8
};

/**
 * 给一个 WebGLRenderer 挂上自适应分辨率。
 * 返回 { apply, update }：resize 时调 apply()，每帧调 update(dt)。
 */
export function attachAdaptiveDpr(renderer) {
  let scale = 1;
  let acc = 0, frames = 0, warmup = 2.5;   // 前 2.5s 是加载/编译期，不采样

  const base = () => Math.min(window.devicePixelRatio || 1, QUALITY.dprMax);
  const apply = () => renderer.setPixelRatio(base() * scale);

  apply();

  return {
    apply,
    get scale() { return scale; },
    update(dt) {
      if (warmup > 0) { warmup -= dt; return; }
      acc += dt; frames++;
      if (acc < 1.5) return;
      const fps = frames / acc;
      acc = 0; frames = 0;
      if (fps < 45 && scale > QUALITY.dprMin) {
        scale = Math.max(QUALITY.dprMin, +(scale - 0.2).toFixed(2));
        apply();
        console.log('[perf]', fps.toFixed(0) + 'fps → dpr', (base() * scale).toFixed(2));
      } else if (fps > 57 && scale < 1) {
        scale = Math.min(1, +(scale + 0.1).toFixed(2));
        apply();
        console.log('[perf]', fps.toFixed(0) + 'fps → dpr', (base() * scale).toFixed(2));
      }
    }
  };
}
