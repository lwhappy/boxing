"""
把场景里所有材质的 glTF alphaMode 变成 OPAQUE（Blender 5.x）

背景：
  Blender 5.x 的 glTF 导出器不再读 Material > Blend Mode / Render Method，
  而是看 Principled BSDF 的 **Alpha** 输入：
    - Alpha 是常量 1.0            -> OPAQUE  (正确)
    - Alpha 接了 Image Texture    -> BLEND   (Tripo 模型默认就是这个，导致 three.js 撕裂)
    - Alpha 接了 Math Round/比较  -> MASK

用法（任选其一）：
  A. Blender 里：Scripting 工作区 -> Open -> 选中本文件 -> Run Script
  B. 命令行：  Blender --background yourfile.blend --python blender_set_opaque.py

跑完会打印「修了哪些材质」，然后你自己 File > Export > glTF 2.0 导出即可。
"""

import bpy


def fix_alpha(mat):
    """断开 Principled BSDF 的 Alpha 连线并置 1.0。返回是否改动。"""
    if not mat.use_nodes or not mat.node_tree:
        return False
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return False
    inp = bsdf.inputs.get("Alpha")
    if inp is None:
        return False

    changed = False
    for link in list(inp.links):
        print("   断开连线: %s.%s -> %s.Alpha"
              % (link.from_node.name, link.from_socket.name, bsdf.name))
        nt.links.remove(link)
        changed = True

    if inp.default_value != 1.0:
        inp.default_value = 1.0
        changed = True
    return changed


def main():
    mats = [m for m in bpy.data.materials if m.users > 0]
    print("=== 共 %d 个在用材质 ===" % len(mats))
    fixed = []
    for mat in mats:
        if fix_alpha(mat):
            fixed.append(mat.name)
            print("  [已修] %s" % mat.name)
        else:
            print("  [跳过] %s (Alpha 已是常量 1.0 或无 Principled BSDF)" % mat.name)

    print("=== 修好 %d 个: %s ===" % (len(fixed), ", ".join(fixed) if fixed else "无"))
    print("下一步：File > Export > glTF 2.0 (.glb)，导出后检查 materials[].alphaMode 应为空(即 OPAQUE)")


if __name__ == "__main__":
    main()
