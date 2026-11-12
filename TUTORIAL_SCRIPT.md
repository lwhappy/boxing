# Video Tutorial Script — my style（照读版）

> 口播稿：按你的说话习惯写的，小写、短句、ok 过渡，直接照着念就是你的语气。
> `[SCENE]` 是画面提示，不用念。加粗 = 重音。文末有 4 条录制备忘。

---

## SCENE 1 — opening, the finished page

*[首页 hero，依次点按钮，拖拽，滚轮]*

first let me open this site, look at this animation. this is what we will do later, let's experience it first.

now, click jab — the boxer throws a jab, and look, she goes back to the guard pose **by herself**. click cross, same thing. this is not just playing a clip — every punch plays **one time**, then the page blends it back to idle in about **0.1 second**. this small blend is what makes it feel smooth, keep this in mind, we will do it later.

also the stage supports the mouse: drag it, it rotates; scroll the wheel on the mouse, it zooms in and zooms out. ok, we will implement all of these features later in this video.

---

## SCENE 2 — prepare the model

*[AI 3D 工具，右侧已生成列表]*

ok, after we experience the animation, the first thing, we must prepare the materials. we generate the 3d model first. let me open this site — you can generate the model by writing natural language, but i jump this step. look at the right panel, i have generated some characters here.

before we export, **two things** we must check. first, the model must be **t-pose**, arms straight out — otherwise mixamo cannot find the shoulders, and the rig will be wrong, every animation will look broken. second, **one mesh only** — if the tool gives you the body, the hair, the gloves as separate pieces, merge them first, or the auto-rigger will fail.

ok, let's choose one — this one. select export, the format we choose **mixamo fbx**, click on export. ok, another model, do the same things too.

---

## SCENE 3 — rig in mixamo

*[mixamo 上传与打点]*

after we exported the models we need, we open the mixamo website, and upload this model. first we must rig the bones to the model. mixamo will ask you to drop the markers: **chin** first, then **both wrists**, then **elbows**, then **knees**, then the **groin** — just follow the order on the screen. ok, completed, click on next, and mixamo gives us a full skeleton in a few seconds. you can drag the timeline, see the skin moves with the bones — the rig is done, for free.

---

## SCENE 4 — download the animations

*[animations 标签页，搜索 boxing]*

then we switch to **animation** on the navigation, search **boxing**. there are more than one hundred, but we only need **seven**: idle, jab, cross, lead hook, rear hook, lead uppercut, rear uppercut.

now here is one thing many people do wrong: they download every animation with skin and never clean up. with skin means every file carries a **full copy of the model** — your folder becomes gigabytes, and blender will be very very slow. so my way is: download them all with skin, but in blender we take the animation and delete the model right away — i will show you in one minute. and if you need dozens of animations one day, mixamo has a **without skin** option — animation only, much smaller — you can use that for the rest, keep this in mind.

in this dialog, we must choose some options: format **fbx binary**, **with skin**, **30 fps**, and keyframe reduction — choose **none**, because reduction can delete some keys and the motion will jitter. and keep the options **the same for all files** — if you mix 24 fps and 30 fps, some actions will play faster than others. ok, let's download them one by one.

---

## SCENE 5 — import into blender, rename

*[blender 新建 general]*

ok, we have downloaded all the animations to this directory. the next step, combine these animations in blender. we open blender, select general. press a, select all objects — **include the camera and the light** — press x, remove all. ok, empty stage.

click on file, import, fbx. we find the directory, and choose the idle one first — this one has the skin, so it is our **main model**.

after importing each action, we had better rename the action — it comes in with a name like *mixamo.com*, useless. select the armature, open the **action editor**, and rename it to **idle**. keep in mind: rename the **action**, not the armature — the name we change is this one, here in the action editor. why so serious? because later, the web page finds the animation **by name** — remember this.

ok, the next action, we do the same operations: import, rename. jab, cross, lead hook... always rename, ok.

---

## SCENE 6 — fake user, remove the models, assign

*[action editor 特写]*

after we imported all the actions, we noticed there are many models on the stage. actually we just need one — the main model and the animation data. so we can remove the redundant models, otherwise the file will be very big.

but **before we delete**, one important step, many people miss this: open the action editor, and click this **shield icon** on every action — this is called **fake user**. why? because when we delete the armature, the action has no user anymore, and blender will delete it **automatically** the next time you save and open the file. many people say "my animations disappeared" — this is the reason. ok, shield icon on every action, done.

now select the armature **and the mesh together**, press x, remove. sometimes we must remove two times. ok. then file, clean up, unused data-blocks, sweep the rest.

last thing in blender: the actions are still in the file, but they are not on our main character yet. with the main armature selected, open the action editor, and **assign each action to her one by one**. this works because all mixamo skeletons use the **same bone names**, so the actions can jump to the main armature, no problem.

---

## SCENE 7 — export the glb

*[导出面板特写]*

ok, it is clear now. let's move to the next step, export the glb file. click file, export, glTF 2.0, format **glTF binary**. four settings here, keep in mind:

first, **selected objects** only — we don't want other things inside the file. second, animation mode, choose **actions** — this way every action becomes its own clip. third, **uncheck limit to playback range** — otherwise blender will cut your actions to the scene frame range, and some actions become shorter. fourth, keep **+y up** on — this is the direction the web page expects. ok, export.

one more thing: this file is about **40 megabytes**, most of it is the 4k texture. compress the texture to 2048, it drops to about **6 megabytes** — much better for the web page, especially on the phone.

---

## SCENE 8 — build the page with one prompt

*[编辑器贴 prompt，生成的页面]*

after we exported the glb, we open the ai tool, and describe what we want in the editor. the prompt must say **three things** clearly.

first, **how to render**: load the glb file, compute the model size, put the feet on the ground and the model in the center of the stage — don't write the height by hand. transparent background, antialias.

second, **how to toggle the action**: the action called idle plays in **loop**; every other action plays **one time**, then blends back to idle. the ai must use "loop once" and the **finished event** — if you skip this, the character will freeze at the last frame of the punch, keep this in mind. and the buttons must be generated **from the action names in the glb file**, not hardcoded — this is why we renamed the actions in blender.

third, **how to place the camera**: three-quarter view, full body in the frame, drag to rotate, scroll wheel to zoom, and clamp the camera so it cannot go under the floor.

ok, my prompt is like this:

> help me create a 3d animation page with three.js. load the glb file, compute its bounding box, put the feet on the ground and the model in the center of the stage — don't hardcode the height. render with transparent background and antialias. read the animation names from the glb data, log them to the console, and make one button for each name at the bottom of the stage — don't hardcode the names. the action called "idle" plays in loop; when the user clicks another button, play that action one time only, then blend back to idle when it finishes — if you skip this the character will freeze at the last frame. also support mouse operations on the stage: drag to rotate, scroll wheel to zoom in and out, no pan, and the camera cannot go below the floor. add a loading state until the model is ready.

ok, paste it, and the page is done. if the result is wrong, don't start over — tell the ai **exactly** what is wrong. "all buttons play the same punch" — that means two actions have the same name in the glb. "the character freezes mid-punch" — that means the finished event is missing. one sentence, and the ai fixes it.

---

## SCENE 9 — outro

*[回到首页，完整点一遍]*

ok, that's the whole process. we generated the model, rigged it in mixamo, downloaded the animations, combined them in blender, exported one glb file, and used one prompt to build the page. now look — same as what we saw at the beginning. next video, we add the second boxer, and make them fight. see you.

---

## 录制备忘（不用念）

1. 全片说 **the boxer / she**，不要说 the guy（角色是女性拳手）。
2. SCENE 6 的「shield icon 先点、再删模型」顺序不能反——先删后补也有救，但演示时按安全顺序来。
3. SCENE 4 提到 without skin 那句是给进阶观众的一句话，时间紧可砍，但 keyframe reduction = none 必须保留。
4. SCENE 1 演示顺滑时镜头拉近，让观众看见 crossfade 的过渡瞬间。
