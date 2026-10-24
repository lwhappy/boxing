import bpy
import sys

blend = sys.argv[sys.argv.index("--") + 1:][1] if "--" in sys.argv else "motion-combine/index.blend"
bpy.ops.wm.open_mainfile(filepath=blend)
print("Actions:", [a.name for a in bpy.data.actions])
