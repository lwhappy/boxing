import{i as e,r as t}from"./actions-mG5uJ0P7.js";var n=[{key:`x`,label:`Position`,min:-2.4,max:2.4,step:.01,unit:`m`},{key:`z`,label:`Side`,min:-1.5,max:1.5,step:.01,unit:`m`},{key:`yaw`,label:`Rotation`,min:-60,max:60,step:1,unit:`°`},{key:`scale`,label:`Scale`,min:.7,max:1.4,step:.01,unit:`×`}],r=e=>e.replace(/[&<>"]/g,e=>`&#${e.charCodeAt(0)};`),i={in:e=>e.step(1),out:e=>e.step(-1),left:e=>e.strafe(-1),right:e=>e.strafe(1)},a=130,o=class{root;hooks;buttons=new Map;inputs=[];adjust;active=`idle`;stance=`idle`;held=new Set;moveTimer=null;constructor(i,a){this.root=i,this.hooks=a,i.innerHTML=`
      <div class="deck-row moves" role="group" aria-label="Black fighter actions">
        ${e.map(e=>`<button type="button" class="slab kind-${e.kind}" data-action="${e.id}" aria-keyshortcuts="${e.keyLabel}">
          <span class="key">${r(e.keyLabel)}</span><span class="label">${r(e.label)}</span></button>`).join(``)}
      </div>
      <div class="deck-row tools" role="group" aria-label="Setup">
        <button type="button" class="slab toggle is-on" data-toggle="robot" aria-pressed="true"><span class="label">Robot</span></button>
        <button type="button" class="slab toggle is-on" data-toggle="reach" aria-pressed="true"><span class="label">Auto Reach</span></button>
        <button type="button" class="slab toggle is-on" data-toggle="anchors" aria-pressed="true"><span class="label">Anchors</span></button>
        <button type="button" class="slab toggle" data-toggle="adjust" aria-pressed="false" aria-controls="adjust-panel"><span class="label">Adjust</span></button>
      </div>
      <div class="adjust" id="adjust-panel" hidden>
        ${[`black`,`red`].map(e=>`
          <fieldset class="adjust-side side-${e}">
            <legend>${e===`black`?`Black`:`Red`}</legend>
            ${n.map(t=>`<label class="adj">
              <span>${t.label}</span>
              <input type="range" data-side="${e}" data-key="${t.key}" min="${t.min}" max="${t.max}" step="${t.step}" />
              <output></output>
            </label>`).join(``)}
          </fieldset>`).join(``)}
        <button type="button" class="slab tool reset" data-reset><span class="label">Reset</span></button>
      </div>
      <div class="pads" aria-label="Touch controls">
        <div class="pad pad-left" role="group" aria-label="Footwork">
          <button type="button" class="pad-btn" data-move="left" aria-label="Move left"><span>◀</span><small>A</small></button>
          <button type="button" class="pad-btn" data-move="out" aria-label="Step back"><span>▼</span><small>S</small></button>
          <button type="button" class="pad-btn" data-move="in" aria-label="Step in"><span>▲</span><small>W</small></button>
          <button type="button" class="pad-btn" data-move="right" aria-label="Move right"><span>▶</span><small>D</small></button>
        </div>
        <div class="pad pad-right" role="group" aria-label="Punches">
          <button type="button" class="pad-btn kind-stance" data-action="guard"><span>GUARD</span><small>E</small></button>
          ${t.map(e=>`<button type="button" class="pad-btn kind-attack" data-action="${e.id}"><span>${r(e.label)}</span><small>${r(e.keyLabel)}</small></button>`).join(``)}
        </div>
      </div>`,this.adjust=i.querySelector(`.adjust`);for(let e of i.querySelectorAll(`[data-action]`))this.buttons.set(e.dataset.action,e),e.addEventListener(`click`,()=>{a.press(),a.action(e.dataset.action),this.pulse(e)});for(let e of i.querySelectorAll(`[data-move]`)){let t=e.dataset.move,n=n=>{n.preventDefault(),e.setPointerCapture(n.pointerId),this.startMove(t),this.pulse(e)},r=()=>this.stopMove(t);e.addEventListener(`pointerdown`,n),e.addEventListener(`pointerup`,r),e.addEventListener(`pointercancel`,r),e.addEventListener(`lostpointercapture`,r)}for(let e of i.querySelectorAll(`[data-toggle]`))e.addEventListener(`click`,()=>{a.press();let t=!e.classList.contains(`is-on`);e.classList.toggle(`is-on`,t),e.setAttribute(`aria-pressed`,String(t));let n=e.dataset.toggle;n===`adjust`?(this.adjust.hidden=!t,t&&this.sync()):a.toggle(n,t)});i.querySelector(`[data-reset]`).addEventListener(`click`,()=>{a.press(),a.reset(),this.sync()});for(let e of i.querySelectorAll(`input[type=range]`)){let t=e.dataset.side,r={...n.find(t=>t.key===e.dataset.key),side:t},i=e.parentElement.querySelector(`output`);this.inputs.push({s:r,input:e,out:i}),e.addEventListener(`input`,()=>{let n=Number(e.value);a.transform(t,{[r.key]:n}),i.textContent=this.format(r,n)})}let o={KeyW:`in`,ArrowUp:`in`,KeyS:`out`,ArrowDown:`out`,KeyA:`left`,ArrowLeft:`left`,KeyD:`right`,ArrowRight:`right`};window.addEventListener(`keydown`,t=>{if(t.ctrlKey||t.metaKey||t.altKey||t.target?.tagName===`INPUT`)return;let n=o[t.code];if(n){t.repeat||this.startMove(n),t.preventDefault();return}if(t.repeat)return;let r=e.find(e=>e.key===t.code);r&&(a.press(),a.action(r.id),this.pulse(this.buttons.get(r.id)),t.preventDefault())}),window.addEventListener(`keyup`,e=>{let t=o[e.code];t&&this.stopMove(t)}),window.addEventListener(`blur`,()=>this.stopAllMoves()),this.setActive(e[0])}startMove(e){this.hooks.press(),this.held.add(e),i[e](this.hooks),this.moveTimer===null&&(this.moveTimer=window.setInterval(()=>{for(let e of this.held)i[e](this.hooks)},a))}stopMove(e){this.held.delete(e),this.held.size===0&&this.moveTimer!==null&&(window.clearInterval(this.moveTimer),this.moveTimer=null)}stopAllMoves(){this.held.clear(),this.moveTimer!==null&&(window.clearInterval(this.moveTimer),this.moveTimer=null)}format(e,t){return`${e.key===`yaw`?t.toFixed(0):t.toFixed(2)}${e.unit}`}pulse(e){e.classList.remove(`pressed`),e.offsetWidth,e.classList.add(`pressed`)}sync(){if(!this.adjust.hidden)for(let{s:e,input:t,out:n}of this.inputs){let r=this.hooks.read(e.side)[e.key];document.activeElement!==t&&(t.value=String(r)),n.textContent=this.format(e,r)}}setActive(e){e.kind===`stance`&&(this.stance=e.id),this.active=e.id;for(let[t,n]of this.buttons)n.classList.toggle(`is-running`,t===this.active&&e.kind!==`stance`),n.classList.toggle(`is-stance`,t===this.stance)}get element(){return this.root}};export{o as Controls};