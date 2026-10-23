# -*- coding: utf-8 -*-
"""
把手动摆好的 Empty（命中标记点）绑定到「对手」的胸腔骨骼上，保持世界位置不变。

为什么需要这个脚本：Shift+Ctrl+P 手动绑定容易选错骨架（两个角色挨得很近），
所以这里强制用下面的常量指定目标，不做任何猜测。

用法（Blender 5.x）：
  1. 时间轴跳到命中那一帧（本项目第 280 帧）
  2. Shift+A → Empty → Sphere，拖到对手被击中的位置，缩放到大约拳头大小
  3. 物体改名，例如 black 被打叫 hit_black，red 被打叫 hit_red
  4. 选中这个 Empty，改下面 ARMATURE_NAME / BONE_NAME，Run Script
  5. 脚本会绑定并打印世界位置、漂移量、跨帧跟随校验

对照表（本项目）：
  对手是黑衣 → ARMATURE_NAME = 'Armature'      （41 根骨骼）
  对手是红衣 → ARMATURE_NAME = 'Armature.001'  （33 根骨骼）
"""
import bpy
import mathutils

ARMATURE_NAME = 'Armature'          # 被打的那个角色的骨架
BONE_NAME = 'mixamorig:Spine2'      # 挂在胸腔上，跟着呼吸/弯腰一起动

obj = bpy.context.active_object
if obj is None or obj.type != 'EMPTY':
    print('[HIT_ANCHOR] 请先选中一个 Empty 对象再运行')
    raise SystemExit

arm = bpy.data.objects.get(ARMATURE_NAME)
if arm is None or arm.type != 'ARMATURE':
    print('[HIT_ANCHOR] 找不到骨架 %r，检查名字（大小写、.001 后缀）' % ARMATURE_NAME)
    raise SystemExit

if BONE_NAME not in arm.pose.bones:
    print('[HIT_ANCHOR] %s 里没有骨骼 %r，可选：%s'
          % (ARMATURE_NAME, BONE_NAME,
             [b.name for b in arm.pose.bones if 'Spine' in b.name or 'Chest' in b.name]))
    raise SystemExit

if obj.parent is not None:
    print('[HIT_ANCHOR] %s 已经有父级（%s），跳过绑定' % (obj.name, obj.parent.name))
else:
    world_before = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = 'BONE'
    obj.parent_bone = BONE_NAME
    obj.matrix_world = world_before      # 保持世界位置
    bpy.context.view_layer.update()
    drift = (obj.matrix_world.translation - world_before.translation).length
    print('[HIT_ANCHOR] 已绑定 %s -> %s / %s' % (obj.name, ARMATURE_NAME, BONE_NAME))
    print('[HIT_ANCHOR] 世界位置 %s   漂移 %.6f m'
          % ([round(v, 4) for v in obj.matrix_world.translation], drift))

# 跨帧校验：确认它真的被骨骼带着动
scn = bpy.context.scene
f0 = int(scn.frame_current)


def sweep(frames):
    pts = []
    for f in frames:
        scn.frame_set(f)
        bpy.context.view_layer.update()
        pts.append(obj.matrix_world.translation.copy())
    return max((p - pts[0]).length for p in pts)


moved = sweep((f0, f0 + 8, f0 + 16))
print('[HIT_ANCHOR] 命中帧附近位移 %.5f m' % moved)
if moved < 1e-5:
    moved2 = sweep((10, 25, 40))
    print('[HIT_ANCHOR] 该帧段骨架静止（本项目 black 的 NLA 只排到 188 帧，属正常）；'
          '在 10~40 帧复验位移 %.5f m' % moved2)
    if moved2 < 1e-5:
        print('[HIT_ANCHOR] 警告：未检测到跟随，检查 ARMATURE_NAME 是否写对')

scn.frame_set(f0)
bpy.context.view_layer.update()
print('[HIT_ANCHOR] 完成。导出 glb 时用整个场景导出，不要勾 Selected Objects')
