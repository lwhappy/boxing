/* SilentJab — 设备档位与自适应分辨率（四个 3D 引擎共用）
 *
 * 手机 GPU 的最大开销是像素填充（DPR），所以只动 DPR，不开 MSAA/阴影做交换。
 * 档位设计原则（v2，修复移动端"花屏"）：
 *   1. 分辨率下限 1.0 —— 永远不低于 1 CSS px/像素，杜绝低分辨率放大导致的糊屏；
 *   2. deviceMemory 在 Safari/iOS 上不存在，缺失时按高端处理，不得误判成低端机；
 *   3. 降档必须"连续 3 次采样都低于阈值"才执行，且有 6s 冷却，防止来回抖动；
 *   4. antialias 始终开启 —— 手机 tile GPU 上 MSAA 很便宜，关掉后锯齿反而更扎眼。
 */

export const isMobileDevice = matchMedia('(pointer: coarse)').matches
  || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const cores = navigator.hardwareConcurrency;      // 可能不存在
const mem = navigator.deviceMemory;               // Safari/iOS 上不存在
export const isLowEnd = isMobileDevice && (
  (typeof cores === 'number' && cores > 0 && cores <= 4)
  || (typeof mem === 'number' && mem > 0 && mem <= 2)
);

export const QUALITY = {
  dprMax: isMobileDevice ? (isLowEnd ? 1.25 : 1.5) : 2,
  dprMin: 1.0,                                    // 低于 1 就会出现肉眼可见的马赛克
  antialias: true,
  shadow: isMobileDevice ? 'low' : 'high',        // 手机 1024，桌面 2048
  aniso: isMobileDevice ? 4 : 8
};

/**
 * 给一个 WebGLRenderer 挂上自适应分辨率。
 * 返回 { apply, update }：resize 时调 apply()，每帧调 update(dt)。
 */
export function attachAdaptiveDpr(renderer) {
  let scale = 1;                                  // 有效 DPR = base() * scale
  let acc = 0, frames = 0;
  let warmup = 4;                                 // 前 4s 是加载/编译期，不采样
  let lowStreak = 0;                              // 连续低帧次数
  let cooldown = 0;                               // 调整后的冷却时间

  const base = () => Math.min(window.devicePixelRatio || 1, QUALITY.dprMax);
  const apply = () => renderer.setPixelRatio(Math.max(QUALITY.dprMin, base() * scale));
  apply();

  return {
    apply,
    get scale() { return scale; },
    update(dt) {
      if (dt > 0.2) return;                       // 切后台/长 GC，采样无效
      if (warmup > 0) { warmup -= dt; return; }
      if (cooldown > 0) cooldown -= dt;
      acc += dt; frames++;
      if (acc < 2) return;                        // 每 2s 评估一次
      const fps = frames / acc;
      acc = 0; frames = 0;

      if (fps < 42 && scale > 1) {
        lowStreak++;
      } else {
        lowStreak = 0;
      }

      // 连续 3 次（约 6s）低于 42fps 才降一档，降完冷却 6s
      if (lowStreak >= 3 && cooldown <= 0) {
        scale = Math.max(1, +(scale - 0.15).toFixed(2));
        apply();
        lowStreak = 0;
        cooldown = 6;
        console.log('[perf]', fps.toFixed(0) + 'fps → dpr', (base() * scale).toFixed(2));
      } else if (fps > 57 && scale < 1 && cooldown <= 0) {
        scale = Math.min(1, +(scale + 0.1).toFixed(2));
        apply();
        cooldown = 6;
        console.log('[perf]', fps.toFixed(0) + 'fps → dpr', (base() * scale).toFixed(2));
      }
    }
  };
}
